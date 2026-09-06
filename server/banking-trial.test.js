// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs, loadConfig, createJwt, createApi, createCallbackValidator, readTransactions, runTrial, MAX_PAGES } from './banking-trial.js';

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const NOW = Date.parse('2026-09-06T12:00:00Z');
const config = {
    applicationId: '11111111-1111-4111-8111-111111111111', privateKey,
    redirectUrl: 'https://localhost:8765/callback', country: 'CY', bank: 'Example Bank'
};
const sessionId = '22222222-2222-4222-8222-222222222222';
const uid = '33333333-3333-4333-8333-333333333333';
const bank = { name: config.bank, country: config.country, psu_types: ['personal'], maximum_consent_validity: 1800 };
const row = overrides => ({ status: 'BOOK', booking_date: '2026-09-06', transaction_amount: { amount: '12.34', currency: 'EUR' }, credit_debit_indicator: 'DBIT', entry_reference: 'ref-1', creditor: { name: 'Example Shop' }, ...overrides });
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, text: vi.fn(async () => JSON.stringify(body)) });

function scenario({ active = true, banks = [bank], pages = [{ transactions: [row()] }], failure = null, cleanupFailure = false, authUrl = 'https://auth.enablebanking.com/ais/start?sessionid=auth-reference', accounts = [{ uid, currency: 'EUR', name: 'Private holder', account_id: { iban: 'PRIVATE-IBAN' } }], details = { currency: 'EUR' }, detailsFailure = false } = {}) {
    let authBody;
    let page = 0;
    const output = vi.fn();
    const fetchImpl = vi.fn(async (url, options) => {
        const pathname = new URL(url).pathname;
        if (pathname === '/application') return response({ active, redirect_urls: [config.redirectUrl] });
        if (pathname === '/aspsps') return response({ aspsps: banks });
        if (pathname === '/auth') {
            authBody = JSON.parse(options.body);
            return response({ url: authUrl });
        }
        if (pathname === '/sessions') return response({ session_id: sessionId, accounts });
        if (pathname.endsWith('/details')) return response(details, detailsFailure ? 403 : 200);
        if (pathname.endsWith('/transactions')) {
            if (failure) return response({ error: failure }, 403);
            return response(pages[page++]);
        }
        if (pathname === `/sessions/${sessionId}` && options.method === 'DELETE') return response({}, cleanupFailure ? 500 : 200);
        throw new Error('Unexpected mock request (network is never used).');
    });
    const readCallback = vi.fn(async () => `${config.redirectUrl}?code=secret-code&state=${authBody.state}`);
    return { fetchImpl, output, readCallback, now: () => NOW, getAuth: () => authBody };
}

describe('banking trial CLI and JWT', () => {
    it('reads only the explicit config and relative key path, including Windows UTF-8 BOM', () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'banking-trial-test-'));
        const configPath = path.join(directory, 'config.json');
        const keyPath = path.join(directory, 'key.pem');
        try {
            const publicConfig = { ...config, privateKey: undefined, privateKeyPath: 'key.pem' };
            fs.writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }));
            fs.writeFileSync(configPath, '\uFEFF' + JSON.stringify(publicConfig));
            expect(loadConfig(configPath).privateKey.asymmetricKeyType).toBe('rsa');
            fs.writeFileSync(configPath, JSON.stringify({ ...publicConfig, redirectUrl: 'https://localhost:8765/callback?state=preset' }));
            expect(() => loadConfig(configPath)).toThrow('без credentials, query');
            fs.writeFileSync(configPath, JSON.stringify(publicConfig));
            fs.writeFileSync(keyPath, 'private-invalid-contents');
            let error;
            try { loadConfig(configPath); } catch (caught) { error = caught; }
            expect(error.message).toBe('Не удалось прочитать приватный RSA-ключ.');
        } finally {
            fs.unlinkSync(configPath);
            fs.unlinkSync(keyPath);
            fs.rmdirSync(directory);
        }
    });

    it('defaults to help and requires an explicit, unambiguous mode', () => {
        expect(parseArgs([])).toEqual({ help: true });
        expect(parseArgs(['--config', 'local.json', '--check'])).toEqual({ config: 'local.json', mode: 'check' });
        for (const args of [['--connect'], ['--config', 'x'], ['--config', 'x', '--check', '--connect'], ['--config', 'x', '--check', '--callback-file', 'x'], ['--token', 'secret']]) {
            expect(() => parseArgs(args)).toThrow();
        }
        expect(() => parseArgs(['--token', 'secret'])).not.toThrow(/secret/);
    });

    it('signs RS256 with the application id and a five-minute lifetime', () => {
        const jwt = createJwt(config, NOW);
        const [header, payload, signature] = jwt.split('.');
        expect(JSON.parse(Buffer.from(header, 'base64url'))).toEqual({ typ: 'JWT', alg: 'RS256', kid: config.applicationId });
        expect(JSON.parse(Buffer.from(payload, 'base64url'))).toEqual({ iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat: NOW / 1000, exp: NOW / 1000 + 300 });
        expect(crypto.verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, 'base64url'))).toBe(true);
    });

    it('keeps requests on the fixed API origin, disables redirects and suppresses error bodies', async () => {
        const upstream = response({ details: 'secret-code PRIVATE-IBAN' }, 401);
        const fetchImpl = vi.fn(async () => upstream);
        const api = createApi(config, fetchImpl, () => NOW);
        await expect(api('/application')).rejects.toThrow('HTTP 401');
        expect(upstream.text).not.toHaveBeenCalled();
        expect(fetchImpl.mock.calls[0][0]).toBe('https://api.enablebanking.com/application');
        expect(fetchImpl.mock.calls[0][1]).toMatchObject({ redirect: 'error', method: 'GET' });
        await expect(api('https://other.example/')).rejects.toThrow();
        await expect(api('//other.example/')).rejects.toThrow();
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('does not expose transport or JSON parse exceptions', async () => {
        await expect(createApi(config, async () => { throw new Error('secret-header'); })('/application')).rejects.toThrow('Запрос Enable Banking не завершён');
        await expect(createApi(config, async () => ({ ok: true, text: async () => 'private invalid body' }))('/application')).rejects.toThrow('некорректный ответ');
    });
});

describe('one-time callback validation', () => {
    const validate = () => createCallbackValidator(config.redirectUrl, 'expected-state', NOW + 60_000, () => NOW);
    it('accepts only the matching redirect and consumes the state once', () => {
        const once = validate();
        expect(once(`${config.redirectUrl}?state=expected-state&code=encoded%2Bcode`)).toBe('encoded+code');
        expect(() => once(`${config.redirectUrl}?state=expected-state&code=second`)).toThrow('уже использован');
    });
    it.each([
        'https://other.example/callback?state=expected-state&code=secret',
        'https://localhost:8765/other?state=expected-state&code=secret',
        'http://localhost:8765/callback?state=expected-state&code=secret',
        `${config.redirectUrl}?state=wrong&code=secret`,
        `${config.redirectUrl}?state=expected-state&state=expected-state&code=secret`,
        `${config.redirectUrl}?state=expected-state&code=secret&code=second`,
        `${config.redirectUrl}?state=expected-state&code=secret&extra=value`,
        `${config.redirectUrl}?state=expected-state&code=secret#fragment`,
        `${config.redirectUrl}?state=expected-state`,
        `${config.redirectUrl}?state=expected-state&error=denied&error_description=secret`
    ])('rejects invalid callback without exposing it: case %#', callback => {
        let message;
        try { validate()(callback); } catch (error) { message = error.message; }
        expect(message).toBeTruthy();
        expect(message).not.toContain('secret');
        expect(message).not.toContain('https:');
    });
    it('rejects an expired response before exchanging the code', () => {
        expect(() => createCallbackValidator(config.redirectUrl, 'expected-state', NOW, () => NOW)(`${config.redirectUrl}?state=expected-state&code=secret`)).toThrow('истекло');
    });
});

describe('standalone read-only flow', () => {
    it.each([uid, { uid }])('resolves currency through details for a UUID string or an account without metadata: case %#', async account => {
        const deps = scenario({ accounts: [account] });
        await runTrial(config, { ...deps, mode: 'connect' });
        expect(deps.fetchImpl.mock.calls.filter(([url]) => new URL(url).pathname.endsWith('/details'))).toHaveLength(1);
        expect(deps.fetchImpl.mock.calls.some(([url]) => url === `https://api.enablebanking.com/accounts/${uid}/details`)).toBe(true);
        expect(deps.output.mock.calls.flat().join()).toContain('BOOK/EUR 1');
        expect(deps.fetchImpl.mock.calls.at(-1)[1].method).toBe('DELETE');
    });
    it('keeps an unknown account currency explicit and counts only strict BOOK/EUR transactions', async () => {
        const deps = scenario({ accounts: [{ uid }], details: { name: 'Private holder', account_id: { iban: 'PRIVATE-IBAN' } }, pages: [{ transactions: [row(), row({ entry_reference: 'usd', transaction_amount: { currency: 'USD', amount: '8' } }), row({ entry_reference: 'pending', status: 'PDNG' })] }] });
        await runTrial(config, { ...deps, mode: 'connect' });
        const printed = deps.output.mock.calls.flat().join();
        expect(printed).toContain('валюта не указана; учитываем только операции BOOK/EUR');
        expect(printed).toContain('BOOK/EUR 1');
        expect(printed).toContain('пропущено 2');
        for (const secret of [uid, 'Private holder', 'PRIVATE-IBAN']) expect(printed).not.toContain(secret);
    });
    it('separately reports unavailable IDs without requesting details or printing identifiers', async () => {
        const deps = scenario({ accounts: [null, { currency: 'EUR' }, { uid: 'PRIVATE-INVALID-ID', currency: 'EUR' }] });
        await expect(runTrial(config, { ...deps, mode: 'connect' })).rejects.toThrow('Проверка чтения не выполнена');
        const printed = deps.output.mock.calls.flat().join();
        expect(printed).toContain('без доступного ID: 3');
        expect(printed).toContain('ID отсутствует: 2, неверный формат ID: 1');
        expect(printed).not.toContain('PRIVATE-INVALID-ID');
        expect(deps.fetchImpl.mock.calls.some(([url]) => new URL(url).pathname.startsWith('/accounts/'))).toBe(false);
        expect(deps.fetchImpl.mock.calls.at(-1)[1].method).toBe('DELETE');
    });
    it('skips known non-EUR accounts before details and non-EUR accounts discovered by details', async () => {
        const deps = scenario({ accounts: [{ uid, currency: 'USD' }, { uid }], details: { currency: 'GBP' } });
        await expect(runTrial(config, { ...deps, mode: 'connect' })).rejects.toThrow('Проверка чтения не выполнена');
        expect(deps.output.mock.calls.flat().join()).toContain('другая валюта: 1');
        expect(deps.output.mock.calls.flat().join()).toContain('другая валюта, чтение операций пропущено');
        expect(deps.fetchImpl.mock.calls.filter(([url]) => new URL(url).pathname.endsWith('/details'))).toHaveLength(1);
        expect(deps.fetchImpl.mock.calls.some(([url]) => new URL(url).pathname.endsWith('/transactions'))).toBe(false);
    });
    it('fails an empty account list but accepts a readable account with no recent transactions', async () => {
        const emptyAccounts = scenario({ accounts: [] });
        await expect(runTrial(config, { ...emptyAccounts, mode: 'connect' })).rejects.toThrow('Проверка чтения не выполнена');
        expect(emptyAccounts.fetchImpl.mock.calls.at(-1)[1].method).toBe('DELETE');
        const noTransactions = scenario({ pages: [{ transactions: [] }] });
        await expect(runTrial(config, { ...noTransactions, mode: 'connect' })).resolves.toBeUndefined();
        expect(noTransactions.output.mock.calls.flat().join()).toContain('BOOK/EUR 0');
    });
    it('limits both details and transaction retrieval to five account candidates', async () => {
        const accounts = Array.from({ length: 6 }, (_, index) => ({ uid: `33333333-3333-4333-8333-33333333333${index}` }));
        const deps = scenario({ accounts, details: {}, pages: accounts.map(() => ({ transactions: [] })) });
        await runTrial(config, { ...deps, mode: 'connect' });
        expect(deps.fetchImpl.mock.calls.filter(([url]) => new URL(url).pathname.endsWith('/details'))).toHaveLength(5);
        expect(deps.fetchImpl.mock.calls.filter(([url]) => new URL(url).pathname.endsWith('/transactions'))).toHaveLength(5);
        expect(deps.fetchImpl.mock.calls.some(([url]) => url.includes(accounts[5].uid))).toBe(false);
        expect(deps.output.mock.calls.flat().join()).toContain('первыми 5 счетами, включая запросы реквизитов');
    });
    it('closes the session and fails explicitly if fetching missing account metadata fails', async () => {
        const deps = scenario({ accounts: [uid], details: { error: 'PRIVATE-UPSTREAM-ERROR' }, detailsFailure: true });
        await expect(runTrial(config, { ...deps, mode: 'connect' })).rejects.toThrow('HTTP 403');
        expect(deps.fetchImpl.mock.calls.some(([url]) => new URL(url).pathname.endsWith('/transactions'))).toBe(false);
        expect(deps.fetchImpl.mock.calls.at(-1)[1].method).toBe('DELETE');
        expect(deps.output.mock.calls.flat().join()).not.toContain('PRIVATE-UPSTREAM-ERROR');
    });
    it('accepts the exact legacy tilisy HTTPS authorization origin', async () => {
        const deps = scenario({ authUrl: 'https://tilisy.enablebanking.com/ais/start?sessionid=auth-reference' });
        await runTrial(config, { ...deps, mode: 'connect' });
        expect(deps.readCallback).toHaveBeenCalledOnce();
        expect(deps.fetchImpl.mock.calls.at(-1)[1].method).toBe('DELETE');
    });
    it.each([
        'https://auth.enablebanking.com.evil.example/ais/?code=secret',
        'https://tilisy.enablebanking.com.evil.example/ais/?code=secret',
        'https://user:secret@tilisy.enablebanking.com/ais/',
        'http://tilisy.enablebanking.com/ais/?code=secret'
    ])('rejects lookalike, credential-bearing and non-HTTPS authorization URLs: case %#', async authUrl => {
        const deps = scenario({ authUrl });
        await expect(runTrial(config, { ...deps, mode: 'connect' })).rejects.toThrow('Неожиданный адрес авторизации.');
        expect(deps.readCallback).not.toHaveBeenCalled();
        expect(deps.fetchImpl).toHaveBeenCalledTimes(3);
        expect(deps.output.mock.calls.flat().join()).not.toContain('secret');
    });
    it('--check only reads application and exact personal/AIS bank availability', async () => {
        const deps = scenario({ active: false });
        await expect(runTrial(config, { ...deps, mode: 'check' })).resolves.toEqual({ active: false });
        expect(deps.fetchImpl).toHaveBeenCalledTimes(2);
        expect(deps.fetchImpl.mock.calls.every(([, options]) => options.method === 'GET')).toBe(true);
        expect(deps.fetchImpl.mock.calls[1][0]).toContain('country=CY&psu_type=personal&service=AIS');
        expect(deps.readCallback).not.toHaveBeenCalled();
    });
    it.each([[{ ...bank, psu_types: ['business'] }], [{ ...bank, name: 'example bank' }], [{ ...bank, country: 'LT' }], [bank, bank]])('rejects a missing or ambiguous exact bank entry', async (...banks) => {
        const deps = scenario({ banks });
        await expect(runTrial(config, { ...deps, mode: 'connect' })).rejects.toThrow('не найдено однозначно');
        expect(deps.fetchImpl).toHaveBeenCalledTimes(2);
    });
    it('limits consent to the bank maximum, reads a bounded date window and deletes the session', async () => {
        const deps = scenario({ pages: [
            { transactions: [row(), row({ status: 'PDNG', entry_reference: 'pending' })], continuation_key: 'opaque+cursor' },
            { transactions: [row({ transaction_id: 'changed-details-id' }), row({ entry_reference: 'ref-2', credit_debit_indicator: 'CRDT', debtor: { name: 'Employer\x1b[31m' } }), row({ entry_reference: 'usd', transaction_amount: { amount: '9', currency: 'USD' } })] }
        ] });
        await runTrial(config, { ...deps, mode: 'connect' });
        expect(deps.getAuth()).toMatchObject({ access: { valid_until: '2026-09-06T12:30:00.000Z', balances: false, transactions: true }, psu_type: 'personal' });
        expect(deps.getAuth().state.length).toBeGreaterThan(32);
        const reads = deps.fetchImpl.mock.calls.filter(([url]) => new URL(url).pathname.endsWith('/transactions'));
        expect(new URL(reads[0][0]).searchParams.get('date_from')).toBe('2026-08-31');
        expect(new URL(reads[0][0]).searchParams.get('date_to')).toBe('2026-09-06');
        expect(new URL(reads[1][0]).searchParams.get('continuation_key')).toBe('opaque+cursor');
        expect(deps.fetchImpl.mock.calls.at(-1)).toMatchObject([`https://api.enablebanking.com/sessions/${sessionId}`, { method: 'DELETE' }]);
        const printed = deps.output.mock.calls.flat().join('\n');
        expect(printed).toContain('BOOK/EUR 2');
        expect(printed).toContain('исходящие 12.34 EUR, входящие 12.34 EUR');
        expect(printed).toContain('дубли 1');
        for (const secret of ['PRIVATE-IBAN', 'Private holder', 'secret-code', '\x1b']) expect(printed).not.toContain(secret);
        expect(deps.fetchImpl.mock.calls.some(([, options]) => Object.keys(options.headers).some(key => key.toLowerCase().startsWith('psu-')))).toBe(false);
    });
    it('never exceeds one hour even for a bank allowing months', async () => {
        const deps = scenario({ banks: [{ ...bank, maximum_consent_validity: 15552000 }] });
        await runTrial(config, { ...deps, mode: 'connect' });
        expect(deps.getAuth().access.valid_until).toBe('2026-09-06T13:00:00.000Z');
    });
    it('closes the remote session after a failed transaction request', async () => {
        const deps = scenario({ failure: 'secret bank response' });
        await expect(runTrial(config, { ...deps, mode: 'connect' })).rejects.toThrow('HTTP 403');
        expect(deps.fetchImpl.mock.calls.at(-1)[1].method).toBe('DELETE');
        expect(deps.output.mock.calls.flat().join()).not.toContain('secret bank response');
    });
    it('reports inability to close a session instead of claiming cleanup succeeded', async () => {
        const deps = scenario({ cleanupFailure: true });
        await expect(runTrial(config, { ...deps, mode: 'connect' })).rejects.toThrow('Не удалось подтвердить закрытие');
        expect(deps.output.mock.calls.flat().join()).not.toContain('сессия API закрыта');
    });
    it('rejects callback cancellation before creating a session', async () => {
        const deps = scenario();
        await expect(runTrial(config, { ...deps, mode: 'connect', readCallback: async () => `${config.redirectUrl}?state=${deps.getAuth().state}&error=cancelled&error_description=secret` })).rejects.toThrow('авторизация отменена');
        expect(deps.fetchImpl).toHaveBeenCalledTimes(3);
    });
});

describe('bounded pagination and summaries', () => {
    it.each([
        [{ booking_date: undefined, transaction_date: '2026-09-05', value_date: '2026-09-04' }, '2026-09-05 (дата операции)'],
        [{ booking_date: null, value_date: '2026-09-04' }, '2026-09-04 (дата валютирования)']
    ])('uses the available fallback date and labels its meaning: case %#', async (dates, expected) => {
        const result = await readTransactions(async () => ({ transactions: [row(dates)] }), uid, NOW);
        expect(result.count).toBe(1);
        expect(result.samples[0]).toContain(expected);
        expect(result.debitCents).toBe(1234);
    });
    it('always prioritizes a supplied booking date, even when another date would pass filtering', async () => {
        const result = await readTransactions(async () => ({ transactions: [
            row({ booking_date: '2026-09-06', transaction_date: '2026-08-30' }),
            row({ booking_date: '2026-08-30', transaction_date: '2026-09-06' }),
            row({ booking_date: '2026-08-32', transaction_date: '2026-09-06' }),
            row({ booking_date: '', transaction_date: '2026-09-06' })
        ] }), uid, NOW);
        expect(result).toMatchObject({ count: 1, skipped: 3, debitCents: 1234 });
        expect(result.samples[0]).toMatch(/^2026-09-06 −12\.34 EUR/);
    });
    it('skips absent dates and fallback dates outside the seven-day window', async () => {
        const result = await readTransactions(async () => ({ transactions: [
            row({ booking_date: undefined }),
            row({ booking_date: undefined, transaction_date: '2026-08-30', value_date: '2026-09-06' }),
            row({ booking_date: undefined, value_date: '2026-09-07' })
        ] }), uid, NOW);
        expect(result).toMatchObject({ count: 0, skipped: 3, debitCents: 0 });
        expect(result.samples).toEqual([]);
    });
    it('stops at its page cap and explicitly marks the result incomplete', async () => {
        const api = vi.fn(async () => ({ transactions: [row({ entry_reference: `ref-${api.mock.calls.length}` })], continuation_key: `cursor-${api.mock.calls.length}` }));
        const result = await readTransactions(api, uid, NOW);
        expect(api).toHaveBeenCalledTimes(MAX_PAGES);
        expect(result).toMatchObject({ count: MAX_PAGES, truncated: true });
    });
    it('detects repeated continuation tokens rather than looping', async () => {
        const api = vi.fn(async () => ({ transactions: [], continuation_key: 'same' }));
        await expect(readTransactions(api, uid, NOW)).rejects.toThrow('повторяющаяся страница');
        expect(api).toHaveBeenCalledTimes(2);
    });
    it('filters non-booked, non-EUR, dates outside the trial and invalid amounts; limits samples', async () => {
        const valid = Array.from({ length: 8 }, (_, i) => row({ entry_reference: `ref-${i}` }));
        const invalid = [row({ status: 'PDNG' }), row({ booking_date: '2026-08-30' }), row({ booking_date: '2026-08-32' }), row({ transaction_amount: { amount: '-4', currency: 'EUR' } }), row({ transaction_amount: { amount: '1e999', currency: 'EUR' } }), row({ credit_debit_indicator: 'UNKNOWN' })];
        const result = await readTransactions(async () => ({ transactions: [...valid, ...invalid] }), uid, NOW);
        expect(result).toMatchObject({ count: 8, skipped: 6, debitCents: 9872 });
        expect(result.samples).toHaveLength(5);
    });
});
