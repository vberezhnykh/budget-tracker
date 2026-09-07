// @vitest-environment node
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const express = require('express');
const cookieParser = require('cookie-parser');
const request = require('supertest');
const { createBankingRouter } = require('./router');
const ORIGIN = 'https://budget.example';
const ID = '507f1f77bcf86cd799439011';
const ACCOUNT_ID = '507f1f77bcf86cd799439012';
const NONCE = 'n'.repeat(43);
const SECRET = 's'.repeat(48);

let app;
let service;
let callbackWarning;

beforeEach(() => {
    vi.stubEnv('BANKING_ENABLED', 'true');
    callbackWarning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ENABLE_BANKING_REDIRECT_URL', `${ORIGIN}/banking/callback.html`);
    vi.stubEnv('BANK_SYNC_CRON_SECRET', SECRET);
    service = {
        status: vi.fn().mockResolvedValue({ connected: false }),
        connect: vi.fn().mockResolvedValue({ authorizationUrl: 'https://auth.enablebanking.com/start' }),
        completeAuthorization: vi.fn().mockResolvedValue(undefined),
        mapAccount: vi.fn().mockResolvedValue(undefined),
        syncConnection: vi.fn().mockResolvedValue({ status: 'synced', nextSyncAt: '2026-09-07T12:00:00.000Z' }),
        kickDueSyncs: vi.fn().mockReturnValue({ status: 'scheduled' }),
        disconnect: vi.fn().mockResolvedValue(undefined),
        listReview: vi.fn().mockResolvedValue([]),
        resolveReview: vi.fn().mockResolvedValue(undefined),
    };
    app = express();
    app.set('trust proxy', 1);
    app.use(express.json());
    app.use(cookieParser());
    const { apiRouter, publicRouter } = createBankingRouter({ service });
    app.use('/banking', publicRouter);
    app.use('/api/banking', apiRouter);
    app.get('/banking/callback.html', (req, res) => res.send('legacy trial callback'));
});

afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); vi.restoreAllMocks(); });

function api(method, path) {
    return request(app)[method](`/api/banking${path}`).set('Origin', ORIGIN);
}

describe('disabled banking routes', () => {
    it.each([undefined, 'false'])('blocks every entry point without touching the service: %s', async enabled => {
        vi.stubEnv('BANKING_ENABLED', enabled);
        const paths = [
            ['get', '/api/banking'], ['get', '/api/banking/review'], ['post', '/api/banking/connect'],
            ['put', `/api/banking/accounts/${ACCOUNT_ID}/mapping`], ['post', `/api/banking/connections/${ID}/sync`],
            ['delete', `/api/banking/connections/${ID}`], ['post', `/api/banking/review/${ID}/resolve`],
            ['get', '/banking/callback.html'], ['get', '/banking/callback.html?code=private-code&state=private-state'],
            ['post', '/banking/jobs/sync']
        ];
        for (const [method, path] of paths) {
            const result = await request(app)[method](path).set('Origin', ORIGIN).set('Authorization', `Bearer ${SECRET}`)
                .set('Cookie', `banking_auth_nonce=${NONCE}`);
            expect(result.status).toBe(404);
            expect(result.body.code).toBe('BANKING_DISABLED');
            expect(result.headers['cache-control']).toBe('no-store');
            expect(result.headers['referrer-policy']).toBe('no-referrer');
            expect(result.headers.location).toBeUndefined();
            expect(result.headers['set-cookie']).toBeUndefined();
            expect(result.text).not.toMatch(/private-code|private-state|legacy trial callback/);
        }
        for (const method of Object.values(service)) expect(method).not.toHaveBeenCalled();
        expect(callbackWarning).not.toHaveBeenCalled();
    });
});

describe('banking browser API', () => {
    it('serves status and review with no-store', async () => {
        const status = await request(app).get('/api/banking');
        expect(status.status).toBe(200);
        expect(status.body).toEqual({ connected: false });
        expect(status.headers['cache-control']).toBe('no-store');
        const review = await request(app).get('/api/banking/review');
        expect(review.body).toEqual([]);
        expect(review.headers['cache-control']).toBe('no-store');
    });

    it('binds connect to a new secure, HTTP-only browser nonce', async () => {
        service.connect.mockImplementation(async (bank, importFrom, browserNonce) => {
            expect(bank).toBe('boc');
            expect(importFrom).toBe('2026-09-01');
            expect(browserNonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
            return { authorizationUrl: 'https://auth.enablebanking.com/start', sessionId: 'must-not-leak' };
        });
        const res = await api('post', '/connect').send({ bank: 'boc', importFrom: '2026-09-01' });
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ authorizationUrl: 'https://auth.enablebanking.com/start' });
        const cookie = res.headers['set-cookie'][0];
        expect(cookie).toContain('banking_auth_nonce=');
        expect(cookie).toContain('Path=/banking');
        expect(cookie).toContain('Max-Age=600');
        expect(cookie).toContain('HttpOnly');
        expect(cookie).toContain('Secure');
        expect(cookie).toContain('SameSite=Lax');
        expect(res.text).not.toContain(service.connect.mock.calls[0][2]);
    });

    it.each([undefined, 'null', 'https://evil.example', `${ORIGIN}/extra`, `${ORIGIN}, https://evil.example`])('rejects unsafe Origin %s', async origin => {
        let req = request(app).post('/api/banking/connect');
        if (origin !== undefined) req = req.set('Origin', origin);
        const res = await req.send({ bank: 'boc', importFrom: '2026-09-01' });
        expect(res.status).toBe(403);
        expect(service.connect).not.toHaveBeenCalled();
        expect(res.headers['cache-control']).toBe('no-store');
    });

    it('does not trust a forged forwarded host as a production origin', async () => {
        const res = await request(app).post('/api/banking/connect')
            .set('Origin', 'https://evil.example').set('X-Forwarded-Host', 'evil.example')
            .set('X-Forwarded-Proto', 'https').send({ bank: 'boc', importFrom: '2026-09-01' });
        expect(res.status).toBe(403);
    });

    it('allows matching loopback origin only in development', async () => {
        const makeRequest = () => request(app).post('/api/banking/connect').set('Host', 'localhost:5173')
            .set('Origin', 'http://localhost:5173').send({ bank: 'revolut', importFrom: '2026-09-01' });
        expect((await makeRequest()).status).toBe(403);
        vi.stubEnv('NODE_ENV', 'development');
        const res = await makeRequest();
        expect(res.status).toBe(200);
        expect(res.headers['set-cookie'][0]).not.toContain('Secure');
    });

    it.each([
        { bank: 'other', importFrom: '2026-09-01' },
        { bank: 'boc', importFrom: '2026-02-30' },
        { bank: 'boc', importFrom: '2026-09-01', privateKey: 'secret' },
        { bank: 'boc', importFrom: '2026-9-1' },
        { bank: 'boc', importFrom: ['2026-09-01'] },
    ])('rejects invalid connect input', async body => {
        expect((await api('post', '/connect').send(body)).status).toBe(400);
        expect(service.connect).not.toHaveBeenCalled();
    });

    it('clears nonce and hides unexpected provider errors on connection failure', async () => {
        service.connect.mockRejectedValue(new Error('private PEM / session-secret'));
        const res = await api('post', '/connect').send({ bank: 'boc', importFrom: '2026-09-01' });
        expect(res.status).toBe(500);
        expect(res.text).not.toMatch(/PEM|session-secret/);
        expect(res.headers['set-cookie'].some(cookie => cookie.includes('Expires=Thu, 01 Jan 1970'))).toBe(true);
    });

    it('returns explicit safe service errors without additional fields', async () => {
        service.syncConnection.mockRejectedValue({ status: 409, code: 'BANKING_BUSY', message: 'Импорт уже выполняется.', session: 'secret' });
        const res = await api('post', `/connections/${ID}/sync`).send({});
        expect(res.status).toBe(409);
        expect(res.body).toEqual({ code: 'BANKING_BUSY', message: 'Импорт уже выполняется.' });
    });

    it('maps, syncs and disconnects only validated IDs', async () => {
        expect((await api('put', `/accounts/${ID}/mapping`).send({ accountId: ACCOUNT_ID })).status).toBe(200);
        expect(service.mapAccount).toHaveBeenCalledWith(ID, ACCOUNT_ID);
        const sync = await api('post', `/connections/${ID}/sync`).send({});
        expect(sync.body).toEqual({ status: 'synced', nextSyncAt: '2026-09-07T12:00:00.000Z' });
        expect((await api('delete', `/connections/${ID}`)).status).toBe(200);
        expect(service.disconnect).toHaveBeenCalledWith(ID);
        expect((await api('put', `/accounts/${ID}/mapping`).send({ accountId: { $ne: null } })).status).toBe(400);
        expect((await api('post', '/connections/invalid/sync').send({})).status).toBe(400);
        expect((await api('delete', '/connections/invalid')).status).toBe(400);
    });

    it('bounds review input before forwarding to service validation', async () => {
        const body = { action: 'ignore', version: 0 };
        expect((await api('post', `/review/${ID}/resolve`).send(body)).status).toBe(200);
        expect(service.resolveReview).toHaveBeenCalledWith(ID, body);
        service.resolveReview.mockClear();
        for (const bad of [{ ...body, description: 'x'.repeat(1001) }, { ...body, $where: 'code' }, { ...body, version: -1 }, { ...body, transactionId: { $ne: null } }, { ...body, category: 'x'.repeat(121) }, { action: 'ignore' }, ['ignore']]) {
            expect((await api('post', `/review/${ID}/resolve`).send(bad)).status).toBe(400);
        }
        expect(service.resolveReview).not.toHaveBeenCalled();
    });

    it.each(['import', 'transfer'])('requires a current candidate token for %s', async action => {
        for (const candidateToken of [undefined, 'a'.repeat(63), 'z'.repeat(64), { hash: 'a'.repeat(64) }]) {
            const res = await api('post', `/review/${ID}/resolve`).send({ action, version: 0, candidateToken });
            expect(res.status).toBe(400);
        }
        expect(service.resolveReview).not.toHaveBeenCalled();
        const body = { action, version: 0, candidateToken: 'a'.repeat(64) };
        expect((await api('post', `/review/${ID}/resolve`).send(body)).status).toBe(200);
        expect(service.resolveReview).toHaveBeenCalledWith(ID, body);
    });

    it('does not require a candidate token to match or ignore', async () => {
        for (const action of ['match', 'ignore']) {
            expect((await api('post', `/review/${ID}/resolve`).send({ action, version: 0 })).status).toBe(200);
        }
    });

    it('preserves multiline descriptions but rejects other control characters', async () => {
        const body = { action: 'import', version: 0, candidateToken: 'b'.repeat(64), description: 'Продукты\nДом\r\n\tКомментарий' };
        expect((await api('post', `/review/${ID}/resolve`).send(body)).status).toBe(200);
        expect(service.resolveReview).toHaveBeenCalledWith(ID, body);
        service.resolveReview.mockClear();
        for (const bad of [{ ...body, description: 'Нельзя\u0000' }, { ...body, category: 'Продукты\nДом' }]) {
            expect((await api('post', `/review/${ID}/resolve`).send(bad)).status).toBe(400);
        }
        expect(service.resolveReview).not.toHaveBeenCalled();
    });
});

describe('public banking callback', () => {
    it('passes through a callback without query for the legacy trial page', async () => {
        const res = await request(app).get('/banking/callback.html');
        expect(res.text).toBe('legacy trial callback');
        expect(res.headers['cache-control']).toBe('no-store');
        expect(service.completeAuthorization).not.toHaveBeenCalled();
    });

    it('accepts logged-out browser callback only with nonce and clears it', async () => {
        const res = await request(app).get('/banking/callback.html?code=one-time-code&state=random-state')
            .set('Cookie', `banking_auth_nonce=${NONCE}`);
        expect(res.status).toBe(303);
        expect(res.headers.location).toBe('/?banking=connected');
        expect(service.completeAuthorization).toHaveBeenCalledWith({ code: 'one-time-code', state: 'random-state', browserNonce: NONCE });
        expect(res.headers['set-cookie'][0]).toContain('Expires=Thu, 01 Jan 1970');
        expect(res.headers['referrer-policy']).toBe('no-referrer');
        expect(res.text).not.toContain('one-time-code');
    });

    it.each([
        ['?code=secret&state=state', ''],
        ['?code=secret', `banking_auth_nonce=${NONCE}`],
        ['?code=a&code=b&state=state', `banking_auth_nonce=${NONCE}`],
        ['?error=access_denied&error_description=private-information&state=state', `banking_auth_nonce=${NONCE}`],
        ['?state=state', `banking_auth_nonce=${NONCE}`],
    ])('rejects incomplete or failed callbacks without leaking details', async (query, cookie) => {
        const res = await request(app).get(`/banking/callback.html${query}`).set('Cookie', cookie);
        expect(res.status).toBe(303);
        expect(res.headers.location).toBe('/?banking=error');
        expect(res.text).not.toMatch(/secret|private-information/);
        expect(service.completeAuthorization).not.toHaveBeenCalled();
    });

    it('maps expired/state-mismatched service errors to a generic redirect', async () => {
        service.completeAuthorization.mockRejectedValue({ status: 400, code: 'STATE_MISMATCH', message: 'internal-state-value' });
        const res = await request(app).get('/banking/callback.html?code=secret&state=wrong')
            .set('Cookie', `banking_auth_nonce=${NONCE}`);
        expect(res.headers.location).toBe('/?banking=error');
        expect(res.text).not.toMatch(/wrong|secret|internal-state/);
        expect(callbackWarning).toHaveBeenCalledWith('Banking authorization failed:', 'BANKING_ERROR');
    });

    it('logs only an allowlisted callback failure code for diagnosis', async () => {
        service.completeAuthorization.mockRejectedValue({ code: 'INVALID_RESPONSE', message: 'private-account-details', session_id: 'private-session' });
        const res = await request(app).get('/banking/callback.html?code=private-code&state=private-state')
            .set('Cookie', `banking_auth_nonce=${NONCE}`);
        expect(res.headers.location).toBe('/?banking=error');
        expect(callbackWarning.mock.calls).toEqual([['Banking authorization failed:', 'INVALID_RESPONSE']]);
    });
});

describe('scheduled sync authentication', () => {
    it('acknowledges background execution without exposing service data', async () => {
        service.kickDueSyncs.mockReturnValue({ status: 'scheduled', sessionId: 'private', transactions: [{ iban: 'private' }] });
        const res = await request(app).post('/banking/jobs/sync').set('Authorization', `Bearer ${SECRET}`).send({});
        expect(service.kickDueSyncs).toHaveBeenCalledOnce();
        expect(res.status).toBe(202);
        expect(res.body).toEqual({ status: 'scheduled' });
        expect(res.headers['cache-control']).toBe('no-store');
    });

    it.each(['', 'Bearer wrong', `Basic ${SECRET}`, `Bearer ${SECRET} extra`])('rejects invalid authorization %s', async authorization => {
        const res = await request(app).post('/banking/jobs/sync').set('Authorization', authorization);
        expect(res.status).toBe(401);
        expect(service.kickDueSyncs).not.toHaveBeenCalled();
    });

    it.each(['', 'short'])('fails closed when job secret is unconfigured', async secret => {
        vi.stubEnv('BANK_SYNC_CRON_SECRET', secret);
        expect((await request(app).post('/banking/jobs/sync').set('Authorization', `Bearer ${SECRET}`)).status).toBe(503);
        expect(service.kickDueSyncs).not.toHaveBeenCalled();
    });

    it('rejects query credentials, cross-origin jobs and bodies', async () => {
        expect((await request(app).post(`/banking/jobs/sync?token=${SECRET}`).set('Authorization', `Bearer ${SECRET}`)).status).toBe(400);
        expect((await request(app).post('/banking/jobs/sync').set('Authorization', `Bearer ${SECRET}`).set('Origin', 'https://evil.example')).status).toBe(403);
        expect((await request(app).post('/banking/jobs/sync').set('Authorization', `Bearer ${SECRET}`).send({ force: true })).status).toBe(400);
        expect(service.kickDueSyncs).not.toHaveBeenCalled();
    });
});
