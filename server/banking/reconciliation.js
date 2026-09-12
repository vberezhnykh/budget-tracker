const mongoose = require('mongoose');
const crypto = require('node:crypto');
const Transaction = require('../models/Transaction');
const Category = require('../models/Category');
const PlannedPayment = require('../models/PlannedPayment');
const { lockAccountReferences } = require('../accountRefs');
const { BankAccount, BankEntry, BankLink, BankControl } = require('./models');

const DAY = 86_400_000;
const MATCH_WINDOW_DAYS = 7;

function problem(status, code, message, extra = {}) {
    return Object.assign(new Error(message), { status, code, ...extra });
}

function cents(value) {
    const text = String(value);
    if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
    const [whole, fraction = ''] = text.split('.');
    if (/[1-9]/.test(fraction.slice(2))) return null;
    const amount = BigInt(whole) * 100n + BigInt(fraction.slice(0, 2).padEnd(2, '0'));
    return amount > 0n && amount <= BigInt(Number.MAX_SAFE_INTEGER) ? amount : null;
}

async function withLedgerTransaction(work) {
    // Bank approvals and manual ledger writes serialize on this document.
    // Mongo retries a write conflict with a fresh snapshot, so either the
    // manual row is found by the importer or the caller sees BANK_DUPLICATE.
    await BankControl.updateOne({ _id: 'ledger' }, { $setOnInsert: { revision: 0 } }, { upsert: true });
    const session = await mongoose.startSession();
    try {
        let result;
        await session.withTransaction(async () => {
            await BankControl.updateOne({ _id: 'ledger' }, { $inc: { revision: 1 } }, { session });
            result = await work(session);
        });
        return result;
    } finally {
        await session.endSession();
    }
}

function slot(account, tx, direction) {
    return `${account._id}:${tx._id}:${direction}`;
}

async function candidatesFor(entry, account, session) {
    if (!account.accountId || entry.currency !== 'EUR' || cents(entry.amount) === null) return [];
    const date = new Date(entry.date).getTime();
    const rows = await Transaction.find({
        date: { $gte: new Date(date - MATCH_WINDOW_DAYS * DAY), $lte: new Date(date + MATCH_WINDOW_DAYS * DAY) },
        $or: [
            { account: account.accountId, type: entry.direction },
            entry.direction === 'expense'
                ? { account: account.accountId, type: 'transfer' }
                : { toAccount: account.accountId, type: 'transfer' }
        ]
    }).session(session || null).lean();
    const groups = new Map();
    for (const tx of rows) {
        const key = tx.splitId ? `split:${tx.splitId}:${tx.type}:${tx.account}:${Boolean(tx.deletedAt)}` : String(tx._id);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(tx);
    }
    const result = [];
    for (const group of groups.values()) {
        const amounts = group.map(tx => cents(tx.amount));
        if (amounts.some(amount => amount === null) || amounts.reduce((a, b) => a + b, 0n) !== cents(entry.amount)) continue;
        const linked = await BankLink.exists({ _id: { $in: group.map(tx => slot(account, tx, entry.direction)) } }).session(session || null);
        if (linked) continue;
        const first = group[0];
        result.push({
            transactionId: String(first._id), version: first.__v || 0,
            amount: Number(entry.amount), date: first.date,
            title: group.length > 1 ? `Разделённая операция (${group.length})` : first.companyName || first.title,
            category: [...new Set(group.map(tx => tx.category).filter(Boolean))].join(', '),
            deleted: Boolean(first.deletedAt), groupCount: group.length,
            transactions: group
        });
    }
    return result;
}

function candidateToken(candidates) {
    const snapshots = candidates.flatMap(candidate => candidate.transactions.map(tx =>
        [String(tx._id), tx.__v || 0, tx.deletedAt ? new Date(tx.deletedAt).toISOString() : null]
    )).sort((a, b) => a[0].localeCompare(b[0]));
    return crypto.createHash('sha256').update(JSON.stringify(snapshots)).digest('hex');
}

async function linkEntry(entry, account, transactions, status, session) {
    for (const tx of transactions) {
        await BankLink.create([{ _id: slot(account, tx, entry.direction), entryId: entry._id, transactionId: tx._id }], { session });
    }
    await BankEntry.updateOne({ _id: entry._id }, {
        $set: { status, transactionIds: transactions.map(tx => tx._id), reason: '' },
        $inc: { version: 1 }
    }, { session });
}

async function importEntry(entry, account, session, { category = 'Без категории', description, transferAccountId } = {}) {
    if (entry.currency !== 'EUR' || cents(entry.amount) === null || cents(String(Number(entry.amount))) !== cents(entry.amount)) {
        throw problem(400, 'UNSUPPORTED_AMOUNT', 'В бюджет можно добавить только суммы в EUR с точностью до цента.');
    }
    const accountIds = [account.accountId, transferAccountId].filter(Boolean);
    const check = await lockAccountReferences(accountIds, { session });
    if (!account.accountId || check.error) throw problem(409, 'ACCOUNT_MISSING', 'Сначала выберите счёт приложения.');
    if (transferAccountId === account.accountId) throw problem(400, 'SAME_ACCOUNT', 'Для перевода нужны разные счета.');
    if (description !== undefined && (typeof description !== 'string' || description.length > 1000)) {
        throw problem(400, 'INVALID_DESCRIPTION', 'Описание должно быть короче 1000 символов.');
    }
    const ledgerDescription = description === undefined ? (entry.description || '') : description.trim();
    let data = {
        title: ledgerDescription || category || 'Операция из банка', amount: Number(entry.amount),
        type: entry.direction, category, description: ledgerDescription,
        account: account.accountId, date: entry.date
    };
    if (transferAccountId) {
        data = { ...data, type: 'transfer', category: undefined,
            account: entry.direction === 'expense' ? account.accountId : transferAccountId,
            toAccount: entry.direction === 'income' ? account.accountId : transferAccountId };
    } else {
        if (typeof category !== 'string' || !category.trim() || category.length > 120) {
            throw problem(400, 'INVALID_CATEGORY', 'Выберите категорию.');
        }
        const existing = await Category.findOne({ name: category, type: entry.direction }).session(session);
        if (!existing && category !== 'Без категории') throw problem(400, 'INVALID_CATEGORY', 'Категория не существует.');
        if (!existing) await Category.create([{ name: category, type: entry.direction, order: 999 }], { session });
    }
    const [transaction] = await Transaction.create([data], { session });
    await linkEntry(entry, account, [transaction], 'imported', session);
    return transaction;
}

async function resolveEntry(id, body) {
    return withLedgerTransaction(async session => {
        const entry = await BankEntry.findById(id).session(session).lean();
        if (!entry) throw problem(404, 'NOT_FOUND', 'Операция не найдена.');
        if (!['new', 'pending'].includes(entry.status)) return { resolved: true };
        if (body.version !== entry.version) throw problem(409, 'STALE_ENTRY', 'Список изменился. Обновите его и повторите выбор.');
        const account = await BankAccount.findById(entry.bankAccountId).session(session).lean();
        if (body.action === 'ignore') {
            await BankEntry.updateOne({ _id: id }, { $set: { status: 'ignored', reason: '' }, $inc: { version: 1 } }, { session });
        } else if (body.action === 'match') {
            const candidate = (await candidatesFor(entry, account, session)).find(value => value.transactionId === body.transactionId);
            if (!candidate || candidate.version !== body.transactionVersion) throw problem(409, 'STALE_CANDIDATE', 'Ручная операция изменилась или уже сопоставлена.');
            // Touch all split members so a concurrent edit/delete retries
            // this whole decision with a fresh snapshot.
            await Transaction.updateMany({ _id: { $in: candidate.transactions.map(tx => tx._id) } }, { $inc: { __v: 1 } }, { session });
            await linkEntry(entry, account, candidate.transactions, 'matched', session);
        } else if (body.action === 'import' || body.action === 'transfer') {
            const currentCandidates = await candidatesFor(entry, account, session);
            if (body.candidateToken !== candidateToken(currentCandidates)) {
                throw problem(409, 'CANDIDATES_CHANGED', 'Появилась или изменилась похожая ручная операция. Обновите предложения и проверьте совпадения.');
            }
            const transferAccountId = body.action === 'transfer'
                ? (entry.direction === 'expense' ? body.toAccountId : body.fromAccountId) : undefined;
            if (body.action === 'transfer' && !transferAccountId) throw problem(400, 'ACCOUNT_MISSING', 'Выберите второй счёт перевода.');
            await importEntry(entry, account, session, { category: body.category, description: body.description, transferAccountId });
        } else {
            throw problem(400, 'INVALID_ACTION', 'Неизвестное действие.');
        }
        return { resolved: true };
    });
}

async function saveManualTransactions(transactions, options = {}) {
    return withLedgerTransaction(async session => {
        const check = await lockAccountReferences(transactions.flatMap(tx => [tx.account, tx.toAccount]), { session });
        if (check.error) throw problem(400, 'ACCOUNT_MISSING', check.error);
        const first = transactions[0];
        const eligible = ['income', 'expense'].includes(first.type) && transactions.every(tx =>
            tx.account === first.account && tx.type === first.type &&
            new Date(tx.date).getTime() === new Date(first.date).getTime() &&
            (transactions.length === 1 || (tx.splitId && tx.splitId === first.splitId)));
        let duplicates = [];
        if (eligible) {
            const account = await BankAccount.findOne({ accountId: first.account }).session(session).lean();
            const amountParts = transactions.map(tx => cents(tx.amount));
            if (account && amountParts.every(amount => amount !== null)) {
                const amount = amountParts.reduce((a, b) => a + b, 0n);
                const date = new Date(first.date).getTime();
                const entries = await BankEntry.find({ bankAccountId: account._id, status: 'imported',
                    currency: 'EUR', direction: first.type,
                    date: { $gte: new Date(date - MATCH_WINDOW_DAYS * DAY), $lte: new Date(date + MATCH_WINDOW_DAYS * DAY) }
                }).session(session).lean();
                for (const entry of entries) {
                    if (cents(entry.amount) !== amount || entry.transactionIds.length !== 1) continue;
                    const tx = await Transaction.findOne({ _id: entry.transactionIds[0], deletedAt: null }).session(session).lean();
                    if (tx && tx.type === first.type && tx.account === first.account && cents(tx.amount) === amount) {
                        duplicates.push({ entry, account, tx, entryId: String(entry._id), transactionId: String(tx._id), version: tx.__v || 0, title: tx.companyName || tx.title, amount: tx.amount, date: tx.date });
                    }
                }
            }
        }
        if (options.bankMatchEntryId) {
            const duplicate = duplicates.find(item => item.entryId === options.bankMatchEntryId);
            if (!duplicate || duplicate.version !== options.bankTransactionVersion) throw problem(409, 'STALE_CANDIDATE', 'Банковская операция изменилась. Обновите данные.');
            if (await PlannedPayment.exists({ transactionId: duplicate.tx._id }).session(session)) {
                throw problem(409, 'LINKED_PAYMENT', 'Операция связана с плановым платежом. Измените её в списке операций.');
            }
            // The user explicitly chose to replace the bank-generated row
            // with their own fields (or split). Keep the first ledger id.
            const replacementUnset = {};
            if (first.logoMode !== 'domain') replacementUnset.merchantDomain = '';
            for (const field of ['companyId', 'companyName']) {
                if (first[field] === undefined) replacementUnset[field] = '';
            }
            const updated = await Transaction.findByIdAndUpdate(duplicate.tx._id,
                { $set: first, $inc: { __v: 1 },
                    ...(Object.keys(replacementUnset).length ? { $unset: replacementUnset } : {}) },
                { new: true, runValidators: true, session });
            const extra = transactions.length > 1 ? await Transaction.create(transactions.slice(1), { session, ordered: true }) : [];
            const saved = [updated, ...extra];
            await BankLink.deleteMany({ entryId: duplicate.entry._id }, { session });
            await linkEntry(duplicate.entry, duplicate.account, saved, 'matched', session);
            return saved;
        }
        if (duplicates.length && options.bankDuplicateAction !== 'separate') {
            throw problem(409, 'BANK_DUPLICATE', 'Похожая операция уже загружена из банка.', {
                candidates: duplicates.map(({ entryId, transactionId, version, title, amount, date }) => ({ entryId, transactionId, version, title, amount, date }))
            });
        }
        return Transaction.create(transactions, { session, ordered: true });
    });
}

module.exports = { cents, problem, candidatesFor, candidateToken, resolveEntry, saveManualTransactions, withLedgerTransaction };
