// Enable Banking boundary: no database, logging, conversion or persisted secrets.
const crypto = require('node:crypto');
const { createJwt } = require('../banking-trial');

const API = 'https://api.enablebanking.com';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CONSENT_SECONDS = 180 * 86400;
const BANKS = Object.freeze({ boc: { name: 'Bank of Cyprus', country: 'CY' }, revolut: { name: 'Revolut', country: 'LT' } });
const AUTH_ORIGINS = new Set(['https://auth.enablebanking.com', 'https://tilisy.enablebanking.com']);

class ProviderError extends Error {
    constructor(code, message, status = null) {
        super(message);
        this.name = 'ProviderError';
        this.code = code;
        this.status = status;
    }
}
const fail = (code, message, status) => { throw new ProviderError(code, message, status); };
const invalid = () => fail('INVALID_RESPONSE', 'Enable Banking вернул некорректные данные.');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max = 250) => typeof value === 'string' ? value.replace(/[\p{Cc}\p{Cf}]/gu, ' ').trim().slice(0, max) : '';
const currency = value => typeof value === 'string' && /^[A-Z]{3}$/.test(value) && value !== 'XXX' ? value : null;
const iban = value => typeof value === 'string' && /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(value) ? value : null;
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)) && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
function validInstant(value) {
    if (typeof value !== 'string') return false;
    // RFC3339 permits arbitrary fractional-second precision. Enable Banking
    // documents microseconds; Date preserves the corresponding milliseconds.
    const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/i.exec(value);
    return Boolean(match && validDate(match[1]) && Number(match[2]) < 24 && Number(match[3]) < 60 && Number(match[4]) < 60
        && (match[5] === undefined || (Number(match[5]) < 24 && Number(match[6]) < 60)) && Number.isFinite(Date.parse(value)));
}

function getConfig(env = process.env) {
    const values = ['ENABLE_BANKING_APPLICATION_ID', 'ENABLE_BANKING_PRIVATE_KEY', 'ENABLE_BANKING_REDIRECT_URL', 'BANKING_ENCRYPTION_KEY'].map(key => env[key]);
    if (values.every(value => value === undefined || value === '')) return null;
    if (values.some(value => typeof value !== 'string' || !value.trim())) fail('CONFIGURATION', 'Настройка банковского подключения не завершена.');
    const [applicationId, pem, redirectUrl, encodedKey] = values;
    let privateKey, redirect, encryptionKey;
    try {
        redirect = new URL(redirectUrl);
        privateKey = crypto.createPrivateKey(pem.replace(/\\n/g, '\n'));
        encryptionKey = Buffer.from(encodedKey, 'base64');
    } catch { fail('CONFIGURATION', 'Некорректная конфигурация банковского подключения.'); }
    if (!UUID.test(applicationId) || privateKey.asymmetricKeyType !== 'rsa' || privateKey.asymmetricKeyDetails?.modulusLength < 2048
        || redirect.protocol !== 'https:' || redirect.username || redirect.password || redirect.search || redirect.hash
        || redirect.pathname !== '/banking/callback.html' || redirect.href !== redirectUrl
        || encryptionKey.length !== 32 || encryptionKey.toString('base64') !== encodedKey) {
        fail('CONFIGURATION', 'Некорректная конфигурация банковского подключения.');
    }
    return { applicationId, privateKey, redirectUrl, encryptionKey };
}

function encrypt(value, config) {
    try {
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', config.encryptionKey, iv);
        cipher.setAAD(Buffer.from(`budget-tracker:banking:v1:${config.applicationId}`));
        const plain = JSON.stringify(value);
        if (typeof plain !== 'string' || Buffer.byteLength(plain) > 2_000_000) throw new Error();
        const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
        return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
    } catch { fail('ENCRYPTION', 'Не удалось защитить данные банковской сессии.'); }
}

function decrypt(value, config) {
    try {
        if (typeof value !== 'string' || value.length > 3_000_000) throw new Error();
        const parts = value.split('.');
        if (parts.length !== 4 || parts[0] !== 'v1' || parts.slice(1).some(part => !/^[A-Za-z0-9_-]+$/.test(part))) throw new Error();
        const [iv, tag, ciphertext] = parts.slice(1).map(part => Buffer.from(part, 'base64url'));
        if (iv.length !== 12 || tag.length !== 16 || parts.slice(1).some((part, index) => [iv, tag, ciphertext][index].toString('base64url') !== part)) throw new Error();
        const decipher = crypto.createDecipheriv('aes-256-gcm', config.encryptionKey, iv);
        decipher.setAAD(Buffer.from(`budget-tracker:banking:v1:${config.applicationId}`));
        decipher.setAuthTag(tag);
        return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'));
    } catch { fail('DECRYPTION', 'Не удалось открыть сохранённую банковскую сессию.'); }
}

// Canonical decimal strings preserve every supplied digit without floating point.
function decimal(value, signed = false) {
    if (typeof value !== 'string' || !(signed ? /^-?\d{1,30}(\.\d{1,18})?$/ : /^\d{1,30}(\.\d{1,18})?$/).test(value)) return null;
    const negative = value.startsWith('-');
    const [rawWhole, rawFraction = ''] = value.replace(/^-/, '').split('.');
    const whole = rawWhole.replace(/^0+(?=\d)/, '');
    const fraction = rawFraction.replace(/0+$/, '');
    const zero = whole === '0' && !fraction;
    if (!signed && zero) return null;
    return `${negative && !zero ? '-' : ''}${whole}.${fraction.padEnd(2, '0')}`;
}

function createProvider(config, { fetchImpl = global.fetch } = {}) {
    if (!config || typeof fetchImpl !== 'function') fail('CONFIGURATION', 'Банковское подключение не настроено.');
    async function api(endpoint, method = 'GET', body) {
        let response;
        try {
            response = await fetchImpl(`${API}${endpoint}`, {
                method, redirect: 'error', signal: AbortSignal.timeout(30_000),
                headers: { Authorization: `Bearer ${createJwt(config)}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
                ...(body ? { body: JSON.stringify(body) } : {})
            });
        } catch { fail('NETWORK', 'Не удалось связаться с Enable Banking.'); }
        // The service schedules retries: an uncertain GET may already consume a bank read.
        if (!response.ok) {
            const status = Number.isInteger(response.status) ? response.status : 0;
            const retryAfter = response.headers?.get?.('retry-after');
            const seconds = typeof retryAfter === 'string' && /^\d+$/.test(retryAfter) ? Number(retryAfter) : null;
            const code = [401, 403].includes(status) ? 'AUTH_REQUIRED' : status === 429 ? 'RATE_LIMITED'
                : [404, 410].includes(status) && /^\/(?:accounts|sessions)\//.test(endpoint) ? 'SESSION_EXPIRED' : 'API_ERROR';
            const error = new ProviderError(code, `Enable Banking: HTTP ${status}.`, status);
            if (status === 429 && seconds !== null && Number.isSafeInteger(seconds)) error.retryAfterSeconds = seconds;
            throw error;
        }
        if (response.status === 204) return {};
        try {
            const raw = await response.text();
            if (raw.length > 4_000_000) invalid();
            const result = JSON.parse(raw);
            if (!object(result)) invalid();
            return result;
        } catch { invalid(); }
    }
    const checkUid = uid => { if (typeof uid !== 'string' || !UUID.test(uid)) fail('INVALID_ARGUMENT', 'Некорректный идентификатор банковского ресурса.'); };

    async function createAuthorization({ bank, state, validUntil } = {}) {
        if (!Object.hasOwn(BANKS, bank) || typeof state !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(state)) fail('INVALID_ARGUMENT', 'Некорректные параметры банковского подключения.');
        const requested = validUntil instanceof Date ? validUntil.getTime() : validInstant(validUntil) ? Date.parse(validUntil) : NaN;
        if (!Number.isFinite(requested) || requested <= Date.now()) fail('INVALID_ARGUMENT', 'Некорректный срок банковского согласия.');
        const selected = BANKS[bank];
        const application = await api('/application');
        if (application.active !== true || !Array.isArray(application.redirect_urls) || !application.redirect_urls.includes(config.redirectUrl)) fail('APPLICATION_INACTIVE', 'Проверьте активацию приложения и адрес возврата в Enable Banking.');
        const catalogue = await api(`/aspsps?${new URLSearchParams({ country: selected.country, psu_type: 'personal', service: 'AIS' })}`);
        const matches = Array.isArray(catalogue.aspsps) ? catalogue.aspsps.filter(item => item?.name === selected.name && item.country === selected.country && Array.isArray(item.psu_types) && item.psu_types.includes('personal')) : [];
        if (matches?.length !== 1 || !Number.isInteger(matches[0].maximum_consent_validity) || matches[0].maximum_consent_validity < 1) fail('BANK_UNAVAILABLE', 'Банк не доступен для личного подключения.');
        const expiresAt = Math.min(requested, Date.now() + Math.min(MAX_CONSENT_SECONDS, matches[0].maximum_consent_validity) * 1000);
        const auth = await api('/auth', 'POST', { access: { valid_until: new Date(expiresAt).toISOString(), transactions: true, balances: true }, aspsp: selected, psu_type: 'personal', state, redirect_url: config.redirectUrl });
        let url;
        try { url = new URL(auth.url); } catch { invalid(); }
        if (!AUTH_ORIGINS.has(url.origin) || url.username || url.password) fail('INVALID_RESPONSE', 'Неожиданный адрес банковской авторизации.');
        return { url: url.href };
    }

    async function closeSession(sessionId) {
        checkUid(sessionId);
        try { await api(`/sessions/${sessionId}`, 'DELETE'); }
        catch (error) { if (![404, 410].includes(error.status)) throw error; }
    }

    async function exchangeCode(code) {
        if (typeof code !== 'string' || !code || code.length > 8192 || /[\p{Cc}]/u.test(code)) fail('INVALID_ARGUMENT', 'Некорректный код банковской авторизации.');
        const session = await api('/sessions', 'POST', { code });
        if (typeof session.session_id !== 'string' || !UUID.test(session.session_id)) invalid();
        try {
            if (!Array.isArray(session.accounts) || session.accounts.length > 100 || !validInstant(session.access?.valid_until) || Date.parse(session.access.valid_until) <= Date.now()) invalid();
            const accounts = [], seen = new Set();
            for (const account of session.accounts) {
                if (!object(account)) invalid();
                if (account.uid === undefined || account.uid === null || account.uid === '') continue;
                if (typeof account.uid !== 'string' || !UUID.test(account.uid) || typeof account.identification_hash !== 'string'
                    || !account.identification_hash || account.identification_hash.length > 512 || /[\p{Cc}\p{Cf}]/u.test(account.identification_hash)) invalid();
                if (seen.has(account.uid)) invalid();
                seen.add(account.uid);
                const number = iban(account.account_id?.iban);
                const other = text(account.account_id?.other?.identification, 100);
                accounts.push({ uid: account.uid, identificationHash: account.identification_hash,
                    name: text(account.details) || text(account.name) || 'Банковский счёт',
                    maskedNumber: number || other ? `•••• ${(number || other).slice(-4)}` : '',
                    currency: currency(account.currency) || null, ...(number ? { iban: number } : {}) });
            }
            return { sessionId: session.session_id, validUntil: new Date(session.access.valid_until).toISOString(), accounts };
        } catch (error) {
            try { await closeSession(session.session_id); } catch { /* Preserve the original safe response error. */ }
            throw error;
        }
    }

    async function getTransactions(uid, { dateFrom, dateTo } = {}) {
        checkUid(uid);
        if (!validDate(dateFrom) || !validDate(dateTo) || dateFrom > dateTo) fail('INVALID_ARGUMENT', 'Некорректный период банковских операций.');
        const rows = [], warningCounts = new Map(), references = new Map(), cursors = new Set();
        const warn = code => warningCounts.set(code, (warningCounts.get(code) || 0) + 1);
        let cursor, total = 0;
        for (let page = 0; page < 20; page++) {
            const query = new URLSearchParams({ date_from: dateFrom, date_to: dateTo, transaction_status: 'BOOK' });
            if (cursor) query.set('continuation_key', cursor);
            const data = await api(`/accounts/${uid}/transactions?${query}`);
            if (!Array.isArray(data.transactions)) invalid();
            total += data.transactions.length;
            if (total > 5000) fail('INCOMPLETE_TRANSACTIONS', 'Превышен предел чтения операций. Сократите период синхронизации.');
            for (const item of data.transactions) {
                if (!object(item)) { warn('invalid_row'); continue; }
                if (item.status !== 'BOOK') { warn(['PDNG', 'HOLD'].includes(item.status) ? 'pending_ignored' : 'invalid_status'); continue; }
                const day = item.booking_date ?? item.transaction_date ?? item.value_date;
                if (!validDate(day)) { warn('invalid_date'); continue; }
                if (day < dateFrom || day > dateTo) { warn('outside_period'); continue; }
                const amount = decimal(item.transaction_amount?.amount);
                if (amount === null) { warn('invalid_amount'); continue; }
                const code = currency(item.transaction_amount?.currency);
                if (!code) { warn('invalid_currency'); continue; }
                if (!['DBIT', 'CRDT'].includes(item.credit_debit_indicator)) { warn('invalid_direction'); continue; }
                const expense = item.credit_debit_indicator === 'DBIT';
                const name = text((expense ? item.creditor : item.debtor)?.name);
                const counterpartyIban = iban((expense ? item.creditor_account : item.debtor_account)?.iban);
                const remittance = Array.isArray(item.remittance_information) ? item.remittance_information.map(value => text(value, 500)).filter(Boolean).join(' ').slice(0, 1000) : '';
                const description = remittance || name || 'Банковская операция';
                const direction = expense ? 'expense' : 'income';
                const date = `${day}T00:00:00.000Z`;
                const reference = typeof item.entry_reference === 'string' && item.entry_reference.length > 0 && item.entry_reference.length <= 512 && !/[\p{Cc}\p{Cf}]/u.test(item.entry_reference) ? item.entry_reference : null;
                const fingerprint = hash([amount, code, direction, date, description, name, counterpartyIban]);
                if (reference && references.has(reference)) {
                    if (references.get(reference) !== fingerprint) fail('INCONSISTENT_TRANSACTIONS', 'Банк вернул противоречивые версии одной операции. Повторите синхронизацию позже.');
                    warn('duplicate_reference'); continue;
                }
                if (reference) references.set(reference, fingerprint);
                const reviewReasons = [];
                if (!reference) { reviewReasons.push('missing_reference'); warn('missing_reference'); }
                if (code !== 'EUR') { reviewReasons.push('non_eur'); warn('non_eur'); }
                rows.push({ reference, amount, currency: code, direction, date, description, counterpartyName: name,
                    ...(counterpartyIban ? { counterpartyIban } : {}), fingerprint, otherCurrency: code !== 'EUR', reviewReasons });
            }
            cursor = data.continuation_key;
            if (cursor === undefined || cursor === null || cursor === '') return { rows, warnings: [...warningCounts].map(([code, count]) => ({ code, count })), complete: true };
            if (typeof cursor !== 'string' || cursor.length > 8192 || cursors.has(cursor)) fail('INCOMPLETE_TRANSACTIONS', 'Не удалось прочитать все страницы банковских операций.');
            cursors.add(cursor);
        }
        fail('INCOMPLETE_TRANSACTIONS', 'Превышен предел страниц операций. Сократите период синхронизации.');
    }

    async function getBalances(uid) {
        checkUid(uid);
        const data = await api(`/accounts/${uid}/balances`);
        if (!Array.isArray(data.balances) || data.balances.length > 100) invalid();
        return data.balances.map(balance => {
            const amount = decimal(balance?.balance_amount?.amount, true), code = currency(balance?.balance_amount?.currency);
            if (amount === null || !code || typeof balance?.balance_type !== 'string' || !/^[A-Z]{4}$/.test(balance.balance_type)) invalid();
            const suppliedDate = balance.last_change_date_time ?? balance.reference_date;
            let asOf = null;
            if (suppliedDate !== undefined && suppliedDate !== null) {
                if (validInstant(suppliedDate)) asOf = new Date(suppliedDate).toISOString();
                else if (validDate(suppliedDate)) asOf = `${suppliedDate}T00:00:00.000Z`;
                else invalid();
            }
            return { amount, currency: code, type: balance.balance_type, asOf };
        });
    }

    return { createAuthorization, exchangeCode, getTransactions, getBalances, closeSession };
}

module.exports = { ProviderError, getConfig, encrypt, decrypt, createProvider };
