// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import crypto from 'node:crypto';
import { ProviderError, getConfig, encrypt, decrypt, createProvider } from './provider.js';

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const config = { applicationId: '11111111-1111-4111-8111-111111111111', privateKey,
    redirectUrl: 'https://budget.example/banking/callback.html', encryptionKey: crypto.randomBytes(32) };
const uid = '22222222-2222-4222-8222-222222222222';
const sessionId = '33333333-3333-4333-8333-333333333333';
const validUntil = '2099-01-01T00:00:00Z';
const state = 'a'.repeat(43);
const period = { dateFrom: '2026-09-01', dateTo: '2026-09-07' };
const account = { uid, identification_hash: 'stable-account-hash', currency: 'EUR', details: 'Current account', name: 'Account owner', account_id: { iban: 'CY17002001280000001200527600' } };
const transaction = overrides => ({ status: 'BOOK', booking_date: '2026-09-06', transaction_amount: { amount: '12.34', currency: 'EUR' },
    credit_debit_indicator: 'DBIT', entry_reference: 'entry-1', creditor: { name: 'Shop' }, creditor_account: { iban: account.account_id.iban },
    remittance_information: ['Coffee purchase'], ...overrides });
const response = (body, status = 200, headers = {}) => ({ ok: status >= 200 && status < 300, status,
    headers: { get: name => headers[name] ?? null }, text: vi.fn(async () => JSON.stringify(body)) });
const setup = (...responses) => {
    const fetchImpl = vi.fn();
    for (const value of responses) fetchImpl.mockResolvedValueOnce(value?.text ? value : response(value));
    return { fetchImpl, provider: createProvider(config, { fetchImpl }) };
};
const env = overrides => ({ ENABLE_BANKING_APPLICATION_ID: config.applicationId,
    ENABLE_BANKING_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    ENABLE_BANKING_REDIRECT_URL: config.redirectUrl, BANKING_ENCRYPTION_KEY: config.encryptionKey.toString('base64'), ...overrides });

describe('banking provider configuration and encrypted sessions', () => {
    it('is disabled only when all provider settings are absent', () => {
        expect(getConfig({})).toBeNull();
        expect(() => getConfig({ ENABLE_BANKING_APPLICATION_ID: config.applicationId })).toThrow(ProviderError);
        const loaded = getConfig(env());
        expect(loaded).toMatchObject({ applicationId: config.applicationId, redirectUrl: config.redirectUrl, encryptionKey: config.encryptionKey });
        expect(loaded.privateKey.asymmetricKeyType).toBe('rsa');
        expect(getConfig(env({ ENABLE_BANKING_PRIVATE_KEY: env().ENABLE_BANKING_PRIVATE_KEY.replace(/\n/g, '\\n') })).privateKey.asymmetricKeyType).toBe('rsa');
    });

    it.each([
        'http://budget.example/banking/callback.html', 'https://budget.example/callback.html',
        'https://user:secret@budget.example/banking/callback.html', 'https://budget.example/banking/callback.html?token=private',
        'https://budget.example/banking/callback.html#private', 'https://budget.example/banking/../banking/callback.html',
        'https://budget.example/banking/%63allback.html'
    ])('rejects an unregistered callback shape: %s', redirect => {
        expect(() => getConfig(env({ ENABLE_BANKING_REDIRECT_URL: redirect }))).toThrow('Некорректная конфигурация');
    });

    it('rejects weak, non-RSA or malformed private keys and noncanonical encryption keys without leaking values', () => {
        const weak = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
        const ec = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'pkcs8', format: 'pem' });
        for (const key of [weak, ec, 'PRIVATE KEY SECRET']) expect(() => getConfig(env({ ENABLE_BANKING_PRIVATE_KEY: key }))).toThrow('Некорректная конфигурация');
        for (const key of [Buffer.alloc(31).toString('base64'), config.encryptionKey.toString('base64') + '\n', 'PRIVATE-SECRET']) {
            expect(() => getConfig(env({ BANKING_ENCRYPTION_KEY: key }))).toThrow('Некорректная конфигурация');
        }
    });

    it('encrypts JSON using random nonces and never stores plaintext in its envelope', () => {
        const value = { sessionId, accounts: [account], nested: [1, false, null] };
        const first = encrypt(value, config), second = encrypt(value, config);
        expect(first).not.toBe(second);
        expect(first).not.toContain(sessionId);
        expect(decrypt(first, config)).toEqual(value);
        expect(decrypt(second, config)).toEqual(value);
    });

    it('authenticates the ciphertext, key, nonce, tag, version and application identity', () => {
        const value = encrypt({ sessionId }, config), parts = value.split('.');
        for (const index of [1, 2, 3]) {
            const changed = [...parts], bytes = Buffer.from(changed[index], 'base64url');
            bytes[0] ^= 1; changed[index] = bytes.toString('base64url');
            expect(() => decrypt(changed.join('.'), config)).toThrow('Не удалось открыть');
        }
        for (const damaged of ['not-json SECRET', value.replace(/^v1/, 'v2'), value + '.extra']) expect(() => decrypt(damaged, config)).toThrow('Не удалось открыть');
        expect(() => decrypt(value, { ...config, encryptionKey: crypto.randomBytes(32) })).toThrow('Не удалось открыть');
        expect(() => decrypt(value, { ...config, applicationId: uid })).toThrow('Не удалось открыть');
        const circular = {}; circular.self = circular;
        expect(() => encrypt(circular, config)).toThrow('Не удалось защитить');
    });
});

describe('banking provider API boundary and consent', () => {
    const authorization = (bank = 'boc', maximum = 180 * 86400, url = 'https://tilisy.enablebanking.com/ais/?opaque=secret') => setup(
        { active: true, redirect_urls: [config.redirectUrl] },
        { aspsps: [{ name: bank === 'boc' ? 'Bank of Cyprus' : 'Revolut', country: bank === 'boc' ? 'CY' : 'LT', psu_types: ['personal'], maximum_consent_validity: maximum }] }, { url });

    it.each(['boc', 'revolut'])('requests personal balances and transactions with a verified bank: %s', async bank => {
        const { provider, fetchImpl } = authorization(bank);
        expect(await provider.createAuthorization({ bank, state, validUntil })).toEqual({ url: 'https://tilisy.enablebanking.com/ais/?opaque=secret' });
        const [url, options] = fetchImpl.mock.calls[2], body = JSON.parse(options.body);
        expect(url).toBe('https://api.enablebanking.com/auth');
        expect(options).toMatchObject({ method: 'POST', redirect: 'error' });
        expect(body).toMatchObject({ access: { transactions: true, balances: true }, psu_type: 'personal', state, redirect_url: config.redirectUrl,
            aspsp: { name: bank === 'boc' ? 'Bank of Cyprus' : 'Revolut', country: bank === 'boc' ? 'CY' : 'LT' } });
        expect(Date.parse(body.access.valid_until) - Date.now()).toBeLessThanOrEqual(180 * 86400_000);
        expect(Date.parse(body.access.valid_until) - Date.now()).toBeGreaterThan(179 * 86400_000);
        expect(new URL(fetchImpl.mock.calls[1][0]).searchParams.get('country')).toBe(bank === 'boc' ? 'CY' : 'LT');
        const [header, payload, signature] = options.headers.Authorization.slice(7).split('.');
        expect(JSON.parse(Buffer.from(header, 'base64url'))).toEqual({ typ: 'JWT', alg: 'RS256', kid: config.applicationId });
        expect(JSON.parse(Buffer.from(payload, 'base64url')).aud).toBe('api.enablebanking.com');
        expect(crypto.verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, 'base64url'))).toBe(true);
    });

    it('bounds consent by both the bank maximum and requested expiry', async () => {
        const { provider, fetchImpl } = authorization('boc', 3600);
        await provider.createAuthorization({ bank: 'boc', state, validUntil });
        expect(Date.parse(JSON.parse(fetchImpl.mock.calls[2][1].body).access.valid_until) - Date.now()).toBeLessThanOrEqual(3600_000);
        const short = authorization();
        const requested = new Date(Date.now() + 60_000).toISOString();
        await short.provider.createAuthorization({ bank: 'boc', state, validUntil: requested });
        expect(JSON.parse(short.fetchImpl.mock.calls[2][1].body).access.valid_until).toBe(requested);
    });

    it.each(['https://auth.enablebanking.com.evil.example/ais?code=SECRET', 'http://tilisy.enablebanking.com/ais/', 'https://user:SECRET@auth.enablebanking.com/ais/'])('blocks unexpected authorization URL without echoing secrets', async url => {
        const { provider } = authorization('boc', 3600, url);
        await expect(provider.createAuthorization({ bank: 'boc', state, validUntil })).rejects.toMatchObject({ code: 'INVALID_RESPONSE', message: 'Неожиданный адрес банковской авторизации.' });
    });

    it('does not request consent for invalid arguments, inactive apps or an absent bank', async () => {
        const { provider, fetchImpl } = authorization();
        for (const args of [{ bank: 'constructor', state, validUntil }, { bank: 'boc', state: 'short', validUntil }, { bank: 'boc', state, validUntil: '2000-01-01T00:00:00Z' }]) {
            await expect(provider.createAuthorization(args)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
        }
        expect(fetchImpl).not.toHaveBeenCalled();
        const inactive = setup({ active: false, redirect_urls: [config.redirectUrl] });
        await expect(inactive.provider.createAuthorization({ bank: 'boc', state, validUntil })).rejects.toMatchObject({ code: 'APPLICATION_INACTIVE' });
        expect(inactive.fetchImpl).toHaveBeenCalledTimes(1);
        const absent = setup({ active: true, redirect_urls: [config.redirectUrl] }, { aspsps: [] });
        await expect(absent.provider.createAuthorization({ bank: 'boc', state, validUntil })).rejects.toMatchObject({ code: 'BANK_UNAVAILABLE' });
    });

    it.each([503, 429])('does not automatically retry GET failures that could consume the bank quota: %i', async status => {
        const { provider, fetchImpl } = setup(response({ secret: 'PRIVATE' }, status, { 'retry-after': '0' }));
        await expect(provider.getTransactions(uid, period)).rejects.toMatchObject({ status });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('does not retry one-time code exchanges or expose upstream errors', async () => {
        const bad = response({ code: 'SECRET-CODE', iban: 'PRIVATE-IBAN' }, 503);
        const { provider, fetchImpl } = setup(bad);
        await expect(provider.exchangeCode('ONE-TIME-CODE')).rejects.toMatchObject({ code: 'API_ERROR', status: 503, message: 'Enable Banking: HTTP 503.' });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(bad.text).not.toHaveBeenCalled();
    });

    it.each([401, 403, 429])('exposes safe structured failure status %i', async status => {
        const { provider } = setup(response({ secret: 'PRIVATE' }, status, { 'retry-after': '3600' }));
        await expect(provider.getTransactions(uid, period)).rejects.toMatchObject({ code: status === 429 ? 'RATE_LIMITED' : 'AUTH_REQUIRED', status, message: `Enable Banking: HTTP ${status}.` });
    });

    it('does not retry uncertain transport failures and sanitizes errors and malformed JSON', async () => {
        const fetchImpl = vi.fn().mockRejectedValue(new Error('JWT=PRIVATE https://secret.example/code'));
        await expect(createProvider(config, { fetchImpl }).getTransactions(uid, period)).rejects.toMatchObject({ code: 'NETWORK', message: 'Не удалось связаться с Enable Banking.' });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        fetchImpl.mockClear();
        await expect(createProvider(config, { fetchImpl }).exchangeCode('PRIVATE')).rejects.toMatchObject({ code: 'NETWORK' });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        const malformed = { ok: true, status: 200, text: async () => '{PRIVATE-IBAN' };
        await expect(setup(malformed).provider.getTransactions(uid, period)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    });
});

describe('banking provider session and balance normalization', () => {
    it.each([
        ['2099-01-01T12:34:56.123456+00:00', '2099-01-01T12:34:56.123Z'],
        ['2099-01-01T12:34:56.123456+02:30', '2099-01-01T10:04:56.123Z'],
        ['2099-01-01T12:34:56.123456-03:45', '2099-01-01T16:19:56.123Z'],
        ['2099-01-01T12:34:56.123456789Z', '2099-01-01T12:34:56.123Z'],
        ['2099-01-01t12:34:56.123456z', '2099-01-01T12:34:56.123Z']
    ])('accepts RFC3339 session expiry precision and offsets: %s', async (source, expected) => {
        const { provider, fetchImpl } = setup({ session_id: sessionId, access: { valid_until: source }, accounts: [account] });
        expect((await provider.exchangeCode('PRIVATE')).validUntil).toBe(expected);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it.each([
        '2099-02-29T12:34:56.123456Z', '2099-02-30T12:34:56.123456+02:00',
        '2099-01-01T24:00:00.000000Z', '2099-01-01T23:60:00.123456Z', '2099-01-01T23:59:61.123456Z',
        '2099-01-01T12:34:56.123456+24:00', '2099-01-01T12:34:56.123456+02:60',
        '2099-01-01T12:34:56.Z', '2099-01-01T12:34:56.123456', '2099-01-01T12:34:56.123456+0200'
    ])('still rejects an impossible or malformed session expiry: %s', async source => {
        const { provider, fetchImpl } = setup({ session_id: sessionId, access: { valid_until: source }, accounts: [account] }, response({}, 204));
        await expect(provider.exchangeCode('PRIVATE')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
        expect(fetchImpl.mock.calls[1]).toEqual([`https://api.enablebanking.com/sessions/${sessionId}`, expect.objectContaining({ method: 'DELETE' })]);
    });

    it('accepts microsecond balance timestamps through the same validator', async () => {
        const { provider } = setup({ balances: [{ balance_amount: { amount: '12.34', currency: 'EUR' }, balance_type: 'CLBD',
            last_change_date_time: '2026-09-07T12:34:56.123456+03:00' }] });
        expect(await provider.getBalances(uid)).toEqual([{ amount: '12.34', currency: 'EUR', type: 'CLBD', asOf: '2026-09-07T09:34:56.123Z' }]);
    });

    it('normalizes the current session schema, masks account numbers and skips unavailable accounts', async () => {
        const { provider, fetchImpl } = setup({ session_id: sessionId, access: { valid_until: validUntil }, accounts: [account, { identification_hash: 'blocked' }] });
        expect(await provider.exchangeCode('PRIVATE-CODE')).toEqual({ sessionId, validUntil: '2099-01-01T00:00:00.000Z', accounts: [{ uid,
            identificationHash: account.identification_hash, currency: 'EUR', name: 'Current account', maskedNumber: '•••• 7600', iban: account.account_id.iban }] });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('keeps XXX account currency unknown without rejecting its EUR transactions', async () => {
        const { provider } = setup({ session_id: sessionId, access: { valid_until: validUntil }, accounts: [{ ...account, currency: 'XXX' }] }, { transactions: [transaction()] });
        expect((await provider.exchangeCode('PRIVATE')).accounts[0].currency).toBeNull();
        expect((await provider.getTransactions(uid, period)).rows[0]).toMatchObject({ currency: 'EUR', otherCurrency: false, reviewReasons: [] });
    });

    it.each([{ uid: 'PRIVATE-INVALID' }, { identification_hash: undefined }, { uid: '../secret' }])('closes newly created sessions when account normalization fails', async change => {
        const { provider, fetchImpl } = setup({ session_id: sessionId, access: { valid_until: validUntil }, accounts: [{ ...account, ...change }] }, response({}, 204));
        await expect(provider.exchangeCode('PRIVATE')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
        expect(fetchImpl.mock.calls[1]).toEqual([`https://api.enablebanking.com/sessions/${sessionId}`, expect.objectContaining({ method: 'DELETE' })]);
    });

    it('keeps the original safe normalization error if cleanup also fails', async () => {
        const { provider } = setup({ session_id: sessionId, access: { valid_until: 'yesterday' }, accounts: [] }, response({ secret: 'PRIVATE' }, 500));
        await expect(provider.exchangeCode('PRIVATE')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    });

    it('validates resource IDs locally and treats already-closed sessions as closed', async () => {
        const { provider, fetchImpl } = setup(response({}, 404));
        await expect(provider.closeSession('../PRIVATE')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
        expect(fetchImpl).not.toHaveBeenCalled();
        await expect(provider.closeSession(sessionId)).resolves.toBeUndefined();
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('preserves signed balances, precision, currencies and bank timestamps', async () => {
        const { provider } = setup({ balances: [
            { balance_amount: { amount: '-00012.3400', currency: 'EUR' }, balance_type: 'CLBD', reference_date: '2026-09-06' },
            { balance_amount: { amount: '0', currency: 'USD' }, balance_type: 'ITAV', last_change_date_time: '2026-09-06T14:15:00+02:00' },
            { balance_amount: { amount: '1.123456789012345678', currency: 'BHD' }, balance_type: 'CLAV' }
        ] });
        expect(await provider.getBalances(uid)).toEqual([
            { amount: '-12.34', currency: 'EUR', type: 'CLBD', asOf: '2026-09-06T00:00:00.000Z' },
            { amount: '0.00', currency: 'USD', type: 'ITAV', asOf: '2026-09-06T12:15:00.000Z' },
            { amount: '1.123456789012345678', currency: 'BHD', type: 'CLAV', asOf: null }
        ]);
    });

    it('rejects malformed balances instead of inventing an amount or currency', async () => {
        for (const value of [undefined, { amount: 10, currency: 'EUR' }, { amount: 'nan', currency: 'EUR' }, { amount: '1', currency: 'XXX' }]) {
            await expect(setup({ balances: [{ balance_amount: value, balance_type: 'CLBD' }] }).provider.getBalances(uid)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
        }
    });
});

describe('banking provider transactions and complete pagination', () => {
    it('normalizes booked EUR rows and stable references with exact decimal amounts', async () => {
        const { provider, fetchImpl } = setup({ transactions: [transaction({ transaction_amount: { amount: '00012.3400', currency: 'EUR' } })] });
        const result = await provider.getTransactions(uid, period);
        expect(result).toMatchObject({ complete: true, warnings: [], rows: [{ reference: 'entry-1', amount: '12.34', currency: 'EUR', direction: 'expense',
            date: '2026-09-06T00:00:00.000Z', description: 'Coffee purchase', counterpartyIban: account.account_id.iban, otherCurrency: false, reviewReasons: [] }] });
        expect(result.rows[0].fingerprint).toMatch(/^[a-f0-9]{64}$/);
        const url = new URL(fetchImpl.mock.calls[0][0]);
        expect(url.searchParams.get('date_from')).toBe(period.dateFrom);
        expect(url.searchParams.get('date_to')).toBe(period.dateTo);
        expect(url.searchParams.get('transaction_status')).toBe('BOOK');
    });

    it('flags other currencies separately without conversion or rounding', async () => {
        const { provider } = setup({ transactions: [transaction(), transaction({ entry_reference: 'entry-2', transaction_amount: { amount: '1.123456789012345678', currency: 'BHD' } })] });
        const { rows, warnings } = await provider.getTransactions(uid, period);
        expect(rows.map(row => [row.amount, row.currency, row.reviewReasons])).toEqual([['12.34', 'EUR', []], ['1.123456789012345678', 'BHD', ['non_eur']]]);
        expect(warnings).toEqual([{ code: 'non_eur', count: 1 }]);
    });

    it('retains both indistinguishable missing-reference purchases for manual review', async () => {
        const item = transaction({ entry_reference: undefined });
        const { provider } = setup({ transactions: [item, item] });
        const result = await provider.getTransactions(uid, period);
        expect(result.rows).toHaveLength(2);
        expect(result.rows[0].fingerprint).toBe(result.rows[1].fingerprint);
        expect(result.rows.every(row => row.reference === null && row.reviewReasons.includes('missing_reference'))).toBe(true);
        expect(result.warnings).toEqual([{ code: 'missing_reference', count: 2 }]);
    });

    it('uses the debtor for income and keeps invalid counterparty identifiers out', async () => {
        const { provider } = setup({ transactions: [transaction({ credit_debit_indicator: 'CRDT', debtor: { name: 'Salary\u0000 payer' },
            debtor_account: { iban: '../PRIVATE' }, remittance_information: undefined })] });
        expect((await provider.getTransactions(uid, period)).rows[0]).toMatchObject({ direction: 'income', description: 'Salary  payer' });
        expect((await setup({ transactions: [transaction({ credit_debit_indicator: 'CRDT', debtor_account: { iban: '../PRIVATE' } })] }).provider.getTransactions(uid, period)).rows[0]).not.toHaveProperty('counterpartyIban');
    });

    it('uses transaction then value date only when higher-priority dates are absent', async () => {
        const { provider } = setup({ transactions: [transaction({ entry_reference: 'a', booking_date: null, transaction_date: '2026-09-01', value_date: '2026-09-02' }),
            transaction({ entry_reference: 'b', booking_date: undefined, value_date: '2026-09-07' }),
            transaction({ entry_reference: 'c', booking_date: '2026-09-06', transaction_date: '2026-09-05' })] });
        expect((await provider.getTransactions(uid, period)).rows.map(row => row.date)).toEqual(['2026-09-01T00:00:00.000Z', '2026-09-07T00:00:00.000Z', '2026-09-06T00:00:00.000Z']);
    });

    it('summarizes invalid fields without raw values and preserves invalid booking-date priority', async () => {
        const { provider } = setup({ transactions: [
            transaction({ status: 'PDNG' }), transaction({ status: 'HOLD' }), transaction({ status: 'PRIVATE-STATUS' }),
            transaction({ booking_date: '2026-02-30', transaction_date: '2026-09-06' }),
            transaction({ booking_date: undefined }), transaction({ booking_date: '2026-08-31', value_date: '2026-09-06' }),
            transaction({ transaction_amount: { amount: '-12', currency: 'EUR' } }),
            transaction({ transaction_amount: { amount: '12', currency: 'XXX' } }), transaction({ credit_debit_indicator: 'PRIVATE-INDICATOR' })
        ] });
        const result = await provider.getTransactions(uid, period);
        expect(result.rows).toEqual([]);
        expect(result.warnings).toEqual([{ code: 'pending_ignored', count: 2 }, { code: 'invalid_status', count: 1 }, { code: 'invalid_date', count: 2 },
            { code: 'outside_period', count: 1 }, { code: 'invalid_amount', count: 1 }, { code: 'invalid_currency', count: 1 }, { code: 'invalid_direction', count: 1 }]);
        expect(JSON.stringify(result)).not.toContain('PRIVATE');
    });

    it('deduplicates stable entry references across pages in the same account', async () => {
        const item = transaction();
        const { provider, fetchImpl } = setup({ transactions: [item], continuation_key: 'opaque&cursor=private' }, { transactions: [item], continuation_key: null });
        const result = await provider.getTransactions(uid, period);
        expect(result.rows).toHaveLength(1);
        expect(result.warnings).toEqual([{ code: 'duplicate_reference', count: 1 }]);
        expect(new URL(fetchImpl.mock.calls[1][0]).searchParams.get('continuation_key')).toBe('opaque&cursor=private');
    });

    it('rejects contradictory financial data for the same reference regardless of currency', async () => {
        const { provider } = setup({ transactions: [transaction(), transaction({ transaction_amount: { amount: '12.34', currency: 'USD' } })] });
        await expect(provider.getTransactions(uid, period)).rejects.toMatchObject({ code: 'INCONSISTENT_TRANSACTIONS' });
    });

    it('does not return partial results after a page failure or repeated cursor', async () => {
        const failed = setup({ transactions: [transaction()], continuation_key: 'next' }, response({ secret: 'PRIVATE' }, 403));
        await expect(failed.provider.getTransactions(uid, period)).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
        const repeated = setup({ transactions: [transaction()], continuation_key: 'next' }, { transactions: [], continuation_key: 'next' });
        await expect(repeated.provider.getTransactions(uid, period)).rejects.toMatchObject({ code: 'INCOMPLETE_TRANSACTIONS' });
    });

    it('caps pagination at 20 pages and rejects continuation beyond the cap', async () => {
        const { provider, fetchImpl } = setup(...Array.from({ length: 20 }, (_, index) => ({ transactions: [], continuation_key: `page-${index}` })));
        await expect(provider.getTransactions(uid, period)).rejects.toMatchObject({ code: 'INCOMPLETE_TRANSACTIONS' });
        expect(fetchImpl).toHaveBeenCalledTimes(20);
    });

    it('accepts exactly 5000 raw rows and refuses larger responses including pending rows', async () => {
        const pending = transaction({ status: 'PDNG' });
        expect((await setup({ transactions: Array(5000).fill(pending) }).provider.getTransactions(uid, period)).warnings).toEqual([{ code: 'pending_ignored', count: 5000 }]);
        await expect(setup({ transactions: Array(5001).fill(pending) }).provider.getTransactions(uid, period)).rejects.toMatchObject({ code: 'INCOMPLETE_TRANSACTIONS' });
    });

    it('rejects invalid date windows and resource identifiers before a request', async () => {
        const { provider, fetchImpl } = setup();
        for (const range of [{ dateFrom: '2026-02-30', dateTo: '2026-09-07' }, { dateFrom: '2026-09-08', dateTo: '2026-09-07' }]) {
            await expect(provider.getTransactions(uid, range)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
        }
        await expect(provider.getTransactions(`${uid}/../secret`, period)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
        expect(fetchImpl).not.toHaveBeenCalled();
    });
});
