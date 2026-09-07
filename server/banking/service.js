const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { getConfig, createProvider, encrypt, decrypt } = require('./provider');
const { isBankingEnabled } = require('./feature');
const { BankConnection, BankAccount, BankEntry, BankAuthorization } = require('./models');
const { cents, problem, candidatesFor, candidateToken, resolveEntry, withLedgerTransaction } = require('./reconciliation');
const { lockAccountReferences } = require('../accountRefs');
const { TIME_ZONE, MIN_INTERVAL, inSyncWindow, nextSyncTime } = require('./schedule');

const NAMES = { boc: 'Bank of Cyprus', revolut: 'Revolut' };
const DAY = 86_400_000;
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const ibanHash = value => digest(value.replace(/\s/g, '').toUpperCase());
const objectId = value => typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value);
const safeErrorCode = error => /^[A-Z_]{1,60}$/.test(error?.code || '') ? error.code : 'SYNC_FAILED';

function createBankingService({ configFactory = getConfig, providerFactory = createProvider, now = () => new Date() } = {}) {
    let running = null;
    function requireEnabled() {
        if (!isBankingEnabled()) throw problem(404, 'BANKING_DISABLED', 'Банковская интеграция выключена.');
    }
    function configured() {
        requireEnabled();
        const config = configFactory();
        if (!config) throw problem(503, 'NOT_CONFIGURED', 'Подключение банков ещё не настроено на сервере.');
        return { config, provider: providerFactory(config) };
    }

    async function status() {
        requireEnabled();
        let isConfigured = false;
        try { isConfigured = Boolean(configFactory()); } catch { /* Return safe setup state, never the key. */ }
        const connections = await BankConnection.find().lean();
        const accounts = await BankAccount.find({ active: true }).lean();
        return {
            configured: isConfigured, syncIntervalHours: 6, timeZone: TIME_ZONE,
            scheduleLabel: 'Около 08:00, 14:00 и 20:00 · местное время',
            pendingReviewCount: await BankEntry.countDocuments({ status: { $in: ['new', 'pending'] } }),
            connections: connections.map(connection => ({
                id: String(connection._id), bank: connection.bank, name: NAMES[connection.bank],
                syncing: connection.leaseUntil > now() && connection.status !== 'disconnecting',
                status: connection.status === 'connected' && connection.consentExpiresAt <= now() ? 'expired' : connection.status,
                lastSuccessfulSyncAt: connection.lastSuccessfulSyncAt, nextSyncAt: connection.nextSyncAt,
                consentExpiresAt: connection.consentExpiresAt, lastErrorCode: connection.lastErrorCode,
                warningsCount: connection.warningsCount || 0,
                accounts: accounts.filter(account => String(account.connectionId) === String(connection._id)).map(account => ({
                    id: String(account._id), name: account.name, maskedNumber: account.maskedNumber,
                    currency: account.currency, accountId: account.accountId || null,
                    balances: account.balances || [], balancesUpdatedAt: account.balancesUpdatedAt
                }))
            }))
        };
    }

    async function connect(bank, importFrom, browserNonce) {
        const { config, provider } = configured();
        if (!NAMES[bank]) throw problem(400, 'INVALID_BANK', 'Этот банк не поддерживается.');
        if (typeof browserNonce !== 'string' || browserNonce.length < 32) throw problem(400, 'INVALID_STATE', 'Не удалось начать авторизацию.');
        const date = typeof importFrom === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(importFrom) ? new Date(`${importFrom}T00:00:00.000Z`) : new Date(NaN);
        const earliestDay = new Date(now().getTime() - 90 * DAY).toISOString().slice(0, 10);
        if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== importFrom || date > now() || importFrom < earliestDay) {
            throw problem(400, 'INVALID_PERIOD', 'Выберите дату начала за последние 90 дней.');
        }
        const connection = await BankConnection.findOne({ bank }).lean();
        if (connection?.leaseUntil > now()) throw problem(409, 'BUSY', 'Банк сейчас обновляется. Подождите завершения.');
        const recent = await BankAuthorization.exists({ bank, expiresAt: { $gt: new Date(now().getTime() + 9 * 60_000) } });
        if (recent) throw problem(429, 'AUTH_RATE_LIMIT', 'Подождите минуту перед повторным подключением.');
        const state = crypto.randomBytes(32).toString('hex');
        const authorization = { _id: digest(state), bank, nonceHash: digest(browserNonce), importFrom: date, expiresAt: new Date(now().getTime() + 10 * 60_000) };
        await BankAuthorization.create(authorization);
        try {
            const { url } = await provider.createAuthorization({ bank, state, validUntil: new Date(now().getTime() + 180 * DAY).toISOString() });
            // Config already enforces a public, exact registered callback.
            if (!config.redirectUrl) throw problem(503, 'NOT_CONFIGURED', 'Не настроен адрес возврата банка.');
            return { authorizationUrl: url };
        } catch (error) {
            await BankAuthorization.deleteOne({ _id: authorization._id });
            throw error;
        }
    }

    async function completeAuthorization({ code, state, browserNonce }) {
        const { config, provider } = configured();
        if (typeof state !== 'string' || !/^[a-f0-9]{64}$/.test(state) || typeof browserNonce !== 'string' || browserNonce.length < 32) {
            throw problem(400, 'INVALID_STATE', 'Авторизация устарела. Начните подключение из приложения.');
        }
        const authorization = await BankAuthorization.findOneAndDelete({ _id: digest(state), nonceHash: digest(browserNonce), expiresAt: { $gt: now() } }).lean();
        if (!authorization) throw problem(400, 'INVALID_STATE', 'Авторизация устарела или уже использована.');
        const sessionData = await provider.exchangeCode(code);
        if (!sessionData.accounts.length) {
            try { await provider.closeSession(sessionData.sessionId); } catch { /* No usable account was selected. */ }
            throw problem(400, 'NO_ACCOUNTS', 'Банк не передал доступный счёт. Подключите банк снова и выберите счёт.');
        }
        let previousSession;
        let connectionId;
        try {
            await withLedgerTransaction(async session => {
                const previous = await BankConnection.findOne({ bank: authorization.bank }).session(session).lean();
                if (previous?.leaseUntil > now()) throw problem(409, 'BUSY', 'Банк сейчас обновляется. Повторите подключение позже.');
                previousSession = previous?.sessionCiphertext;
                // Reconnecting must not reset a consumed six-hour quota.
                const nextSyncAt = previous?.lastAttemptAt && now().getTime() - previous.lastAttemptAt.getTime() < MIN_INTERVAL
                    ? nextSyncTime(previous.lastAttemptAt) : now();
                const connection = await BankConnection.findOneAndUpdate({ bank: authorization.bank }, {
                    $set: { status: 'connected', sessionCiphertext: encrypt(sessionData.sessionId, config),
                        consentExpiresAt: new Date(sessionData.validUntil), importFrom: authorization.importFrom, historyReset: true,
                        nextSyncAt, lastErrorCode: '', leaseUntil: null, leaseToken: null }
                }, { new: true, upsert: true, session });
                connectionId = connection._id;
                await BankAccount.updateMany({ connectionId }, { $set: { active: false } }, { session });
                for (const account of sessionData.accounts) {
                    await BankAccount.findOneAndUpdate({ identificationHash: `${authorization.bank}:${account.identificationHash}` }, {
                        $set: { connectionId, uidCiphertext: encrypt(account.uid, config),
                            ...(account.iban ? { ibanHash: ibanHash(account.iban) } : {}),
                            name: account.name, maskedNumber: account.maskedNumber, currency: account.currency, active: true }
                    }, { upsert: true, session });
                }
            });
        } catch (error) {
            try { await provider.closeSession(sessionData.sessionId); } catch { /* A failed save never exposes its session. */ }
            throw error;
        }
        if (previousSession) {
            try { await provider.closeSession(decrypt(previousSession, config)); } catch { /* New session is already safely persisted. */ }
        }
        // The consent flow itself is user initiated. Its first fetch is
        // allowed immediately; subsequent background fetches use the clock.
        void syncConnection(String(connectionId)).catch(() => {});
    }

    async function mapAccount(id, accountId) {
        requireEnabled();
        if (!objectId(id) || !objectId(accountId)) throw problem(400, 'INVALID_ACCOUNT', 'Выберите существующий счёт приложения.');
        await withLedgerTransaction(async session => {
            const account = await BankAccount.findById(id).session(session).lean();
            if (!account) throw problem(404, 'NOT_FOUND', 'Банковский счёт не найден.');
            if (account.accountId && account.accountId !== accountId) throw problem(409, 'MAPPING_LOCKED', 'Этот банковский счёт уже привязан.');
            const check = await lockAccountReferences([accountId], { session });
            if (check.error) throw problem(400, 'INVALID_ACCOUNT', check.error);
            if (await BankAccount.exists({ accountId, _id: { $ne: account._id } }).session(session)) {
                throw problem(409, 'MAPPING_USED', 'К этому счёту уже привязан другой банковский счёт.');
            }
            await BankAccount.updateOne({ _id: id }, { $set: { accountId } }, { session });
        });
        return { mapped: true };
    }

    async function withConnectionTransaction(id, token, work) {
        const session = await mongoose.startSession();
        try {
            await session.withTransaction(async () => {
                const owned = await BankConnection.updateOne({ _id: id, leaseToken: token },
                    { $set: { leaseUntil: new Date(now().getTime() + 10 * 60_000) } }, { session });
                if (!owned.matchedCount) throw problem(409, 'LEASE_LOST', 'Подключение изменилось.');
                await work(session);
            });
        } finally { await session.endSession(); }
    }

    async function storeRows(account, response, token) {
        if (response.complete !== true) throw problem(502, 'INCOMPLETE_TRANSACTIONS', 'Банк вернул неполный список операций.');
        const occurrence = new Map();
        const operations = [];
        for (const row of response.rows) {
            const number = occurrence.get(row.fingerprint) || 0;
            if (!row.reference) occurrence.set(row.fingerprint, number + 1);
            const key = row.reference ? `ref:${digest(row.reference)}` : `unidentified:${row.fingerprint}:${number}`;
            operations.push({ updateOne: { filter: { bankAccountId: account._id, key }, update: { $setOnInsert: {
                amount: row.amount, currency: row.currency, direction: row.direction, date: new Date(row.date),
                description: row.description, ...(row.counterpartyIban ? { counterpartyHash: ibanHash(row.counterpartyIban) } : {}),
                reviewReasons: row.reviewReasons || [], status: 'pending', reason: 'new', version: 0
            } }, upsert: true } });
        }
        // Fence the whole save with the connection claim. Reconnection or
        // disconnect cannot let an old response write into the new session.
        await withConnectionTransaction(account.connectionId, token, async session => {
            if (operations.length) await BankEntry.bulkWrite(operations, { session, ordered: true });
        });
    }

    async function syncConnection(id) {
        const { config, provider } = configured();
        if (!objectId(id)) throw problem(400, 'INVALID_CONNECTION', 'Подключение не найдено.');
        const startedAt = now();
        const token = crypto.randomBytes(24).toString('hex');
        const connection = await BankConnection.findOneAndUpdate({
            _id: id, status: { $in: ['connected', 'error'] }, sessionCiphertext: { $type: 'string' },
            nextSyncAt: { $lte: startedAt },
            $or: [{ leaseUntil: null }, { leaseUntil: { $lt: startedAt } }]
        }, { $set: { leaseToken: token, leaseUntil: new Date(startedAt.getTime() + 10 * 60_000),
            lastAttemptAt: startedAt, nextSyncAt: nextSyncTime(startedAt) } }, { new: true }).lean();
        if (!connection) {
            const current = await BankConnection.findById(id).lean();
            if (!current) throw problem(404, 'NOT_FOUND', 'Подключение не найдено.');
            return { status: 'not_due', nextSyncAt: current.nextSyncAt };
        }
        try {
            if (connection.consentExpiresAt <= startedAt) throw problem(401, 'AUTH_REQUIRED', 'Нужно снова подтвердить доступ в банке.');
            const accounts = await BankAccount.find({ connectionId: id, active: true }).lean();
            let warningsCount = 0;
            for (const account of accounts) {
                // Renew only our own lease; an old task must never write
                // results after a disconnect or a replacement consent.
                const renewed = await BankConnection.updateOne({ _id: id, leaseToken: token }, { $set: { leaseUntil: new Date(now().getTime() + 10 * 60_000) } });
                if (!renewed.matchedCount) throw problem(409, 'LEASE_LOST', 'Подключение изменилось.');
                const uid = decrypt(account.uidCiphertext, config);
                const dateFrom = new Date(Math.max(connection.importFrom.getTime(),
                    connection.lastSuccessfulSyncAt && !connection.historyReset ? connection.lastSuccessfulSyncAt.getTime() - 14 * DAY : connection.importFrom.getTime()));
                const result = await provider.getTransactions(uid, { dateFrom: dateFrom.toISOString().slice(0, 10), dateTo: startedAt.toISOString().slice(0, 10) });
                if (!(await BankConnection.exists({ _id: id, leaseToken: token }))) throw problem(409, 'LEASE_LOST', 'Подключение изменилось.');
                await storeRows(account, result, token);
                warningsCount += (result.warnings || []).filter(item => !['pending_ignored', 'outside_period', 'duplicate_reference'].includes(item.code)).reduce((sum, item) => sum + item.count, 0);
                try {
                    const balances = await provider.getBalances(uid);
                    await withConnectionTransaction(id, token, session =>
                        BankAccount.updateOne({ _id: account._id }, { $set: { balances, balancesUpdatedAt: now() } }, { session }));
                } catch (error) {
                    // A missing balance does not discard downloaded proposals.
                    // Keep the previous snapshot visibly dated.
                    if (['AUTH_REQUIRED', 'SESSION_EXPIRED', 'LEASE_LOST'].includes(error.code)) throw error;
                    warningsCount++;
                }
            }
            const finished = await BankConnection.updateOne({ _id: id, leaseToken: token }, { $set: {
                status: 'connected', lastSuccessfulSyncAt: now(), historyReset: false, warningsCount, lastErrorCode: '', leaseUntil: null, leaseToken: null
            } });
            if (!finished.matchedCount) throw problem(409, 'LEASE_LOST', 'Подключение изменилось.');
            return { status: 'updated', nextSyncAt: connection.nextSyncAt };
        } catch (error) {
            await BankConnection.updateOne({ _id: id, leaseToken: token }, { $set: {
                status: ['AUTH_REQUIRED', 'SESSION_EXPIRED'].includes(error.code) ? 'expired' : 'error',
                lastErrorCode: safeErrorCode(error), leaseUntil: null, leaseToken: null
            } });
            throw problem(502, safeErrorCode(error), 'Не удалось обновить банк. Следующая попытка будет по расписанию.');
        }
    }

    async function runDueSyncs() {
        if (!isBankingEnabled()) return { checked: 0 };
        if (!inSyncWindow(now())) return { checked: 0 };
        let config;
        try { config = configFactory(); } catch { return { checked: 0 }; }
        if (!config) return { checked: 0 };
        const connections = await BankConnection.find({ status: { $in: ['connected', 'error'] }, nextSyncAt: { $lte: now() } }).select('_id').lean();
        for (const connection of connections) {
            try { await syncConnection(String(connection._id)); } catch { /* Safe status is persisted for the UI. */ }
        }
        return { checked: connections.length };
    }

    function kickDueSyncs() {
        if (!isBankingEnabled()) return { status: 'disabled' };
        if (!running) running = runDueSyncs().catch(() => {}).finally(() => { running = null; });
        return { status: 'scheduled' };
    }

    async function disconnect(id) {
        const { config, provider } = configured();
        if (!objectId(id)) throw problem(400, 'INVALID_CONNECTION', 'Подключение не найдено.');
        const token = crypto.randomBytes(24).toString('hex');
        const connection = await BankConnection.findOneAndUpdate({ _id: id,
            $or: [{ leaseUntil: null }, { leaseUntil: { $lt: now() } }]
        }, { $set: { status: 'disconnecting', leaseToken: token, leaseUntil: new Date(now().getTime() + 10 * 60_000) } }, { new: false }).lean();
        if (!connection) throw problem(409, 'BUSY', 'Дождитесь завершения обновления банка.');
        try {
            if (connection.sessionCiphertext) await provider.closeSession(decrypt(connection.sessionCiphertext, config));
        } catch (error) {
            if (!['SESSION_EXPIRED', 'AUTH_REQUIRED'].includes(error.code)) {
                await BankConnection.updateOne({ _id: id, leaseToken: token }, { $set: { status: connection.status, leaseUntil: null, leaseToken: null } });
                throw problem(502, safeErrorCode(error), 'Не удалось отключить банк. Повторите попытку.');
            }
        }
        await BankConnection.updateOne({ _id: id, leaseToken: token }, {
            $set: { status: 'disconnected', leaseUntil: null, leaseToken: null }, $unset: { sessionCiphertext: '', nextSyncAt: '' }
        });
        return { disconnected: true };
    }

    async function listReview() {
        requireEnabled();
        const filter = { status: { $in: ['new', 'pending'] } };
        const entries = await BankEntry.find(filter).sort({ date: -1, _id: -1 }).limit(100).lean();
        const items = [];
        for (const entry of entries) {
            const account = await BankAccount.findById(entry.bankAccountId).lean();
            const candidates = account ? await candidatesFor(entry, account) : [];
            let reason = 'new';
            if (!account?.accountId) reason = 'unmapped';
            else if (entry.currency !== 'EUR') reason = 'non_eur';
            else if (cents(entry.amount) === null) reason = 'amount_precision';
            else if (candidates.length) reason = 'possible_duplicate';
            else if (entry.reviewReasons?.length) reason = entry.reviewReasons[0];
            else if (entry.counterpartyHash && await BankAccount.exists({ ibanHash: entry.counterpartyHash })) reason = 'own_transfer';
            else if (/transfer|top[ -]?up|cash\s?withdraw|\batm\b|перевод|снятие/i.test(entry.description || '')) reason = 'possible_transfer';
            items.push({ id: String(entry._id), version: entry.version, bankAccountId: String(entry.bankAccountId),
                accountId: account?.accountId || null, amount: entry.amount, currency: entry.currency,
                direction: entry.direction, date: entry.date, description: entry.description, reason,
                candidateToken: candidateToken(candidates),
                candidates: candidates.map(candidate => { const publicCandidate = { ...candidate }; delete publicCandidate.transactions; return publicCandidate; }) });
        }
        return { items, total: await BankEntry.countDocuments(filter) };
    }

    async function resolveReview(id, body) {
        requireEnabled();
        if (!objectId(id)) throw problem(400, 'INVALID_ENTRY', 'Операция не найдена.');
        return resolveEntry(id, body);
    }

    return { status, connect, completeAuthorization, mapAccount, syncConnection, runDueSyncs, kickDueSyncs, disconnect, listReview, resolveReview };
}

module.exports = { createBankingService, ibanHash };
