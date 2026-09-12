// @vitest-environment node
import express from 'express';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAuthMiddleware } from './auth.js';
import { createClientErrorRateLimiter } from './operational.js';
import { createMerchantSearchRouter } from './merchantSearch.js';

const SECRET = 'sk_test_secret_1234567890';
const response = (body, status = 200) => new Response(JSON.stringify(body), { status });

function makeApp(options = {}, authenticated = false) {
    const app = express();
    app.use(cookieParser());
    if (authenticated) app.use(createAuthMiddleware(false));
    app.use('/api/merchants', createMerchantSearchRouter({ getSecretKey: () => SECRET, ...options }));
    return app;
}

afterEach(() => vi.unstubAllEnvs());

describe('merchant search', () => {
    it('sends only a cleaned company query to the fixed endpoint and returns public metadata', async () => {
        const fetchImpl = vi.fn(async () => response([
            { name: '  Chop  Chop  ', domain: 'CHOPCHOP.ME', logo_url: `https://img.logo.dev/chopchop.me?token=${SECRET}`, country: 'Cyprus' },
            { name: 'Chop Chop Restaurant', domain: 'restaurant.com' }
        ]));
        const result = await request(makeApp({ fetchImpl })).get('/api/merchants/search')
            .query({ q: '  Chop \n Chop  ', amount: 25, history: 'private' });
        expect(result.status).toBe(200);
        expect(result.headers['cache-control']).toBe('no-store');
        expect(result.body).toEqual({ merchants: [
            { name: 'Chop Chop', domain: 'chopchop.me' },
            { name: 'Chop Chop Restaurant', domain: 'restaurant.com' }
        ] });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        const [url, options] = fetchImpl.mock.calls[0];
        expect(url).toBe('https://api.logo.dev/search?q=Chop+Chop&strategy=match');
        expect(options).toEqual({
            method: 'GET',
            headers: { Authorization: `Bearer ${SECRET}`, Accept: 'application/json' },
            redirect: 'error',
            signal: expect.any(AbortSignal)
        });
        expect(result.text).not.toContain(SECRET);
    });

    it('keeps search behind the same authentication middleware as transaction routes', async () => {
        vi.stubEnv('APP_PASSWORD', 'test-password');
        vi.stubEnv('SESSION_SECRET', 'x'.repeat(32));
        const fetchImpl = vi.fn();
        const result = await request(makeApp({ fetchImpl }, true)).get('/api/merchants/search?q=Chop');
        expect(result.status).toBe(401);
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it.each([undefined, '', '  ', 'x', 'x'.repeat(121), 'x'.repeat(501), 'Chop\u0000Chop'])('rejects an invalid query %j without calling the service', async q => {
        const fetchImpl = vi.fn();
        const result = await request(makeApp({ fetchImpl })).get('/api/merchants/search').query({ q });
        expect(result.status).toBe(400);
        expect(result.body.code).toBe('MERCHANT_SEARCH_QUERY_INVALID');
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it.each(['q=a&q=b', 'q[name]=Chop'])('rejects structured query parameters: %s', async query => {
        const fetchImpl = vi.fn();
        const result = await request(makeApp({ fetchImpl })).get(`/api/merchants/search?${query}`);
        expect(result.status).toBe(400);
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it.each([undefined, '', 'pk_public_key_123456', 'sk_invalid\nheader'])('returns a controlled unavailable state for an absent or invalid secret', async secret => {
        const fetchImpl = vi.fn();
        const result = await request(makeApp({ fetchImpl, getSecretKey: () => secret })).get('/api/merchants/search?q=Chop');
        expect(result.status).toBe(503);
        expect(result.body.code).toBe('MERCHANT_SEARCH_UNAVAILABLE');
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('returns an empty list when the service finds no company', async () => {
        const result = await request(makeApp({ fetchImpl: async () => response([]) })).get('/api/merchants/search?q=Unknown');
        expect(result.status).toBe(200);
        expect(result.body).toEqual({ merchants: [] });
    });

    it('drops malformed domains and metadata and caps unique results at ten', async () => {
        const invalid = [
            null, {}, { name: 'a', domain: 'https://example.com' },
            { name: 'a', domain: 'example.com/path' }, { name: 'a', domain: 'user@example.com' },
            { name: 'a', domain: '127.0.0.1' }, { name: 'a', domain: 'localhost' },
            { name: 'a', domain: '-bad.com' }, { name: 'a', domain: `${'a'.repeat(64)}.com` },
            { name: 'a', domain: 'example.com:5000' }, { name: '\u0000secret', domain: 'company.com' },
            { name: 'x'.repeat(121), domain: 'company.com' }
        ];
        const valid = Array.from({ length: 12 }, (_, index) => ({ name: `Company ${index}`, domain: `company${index}.com` }));
        const fetchImpl = async () => response([...invalid, valid[0], valid[0], ...valid]);
        const result = await request(makeApp({ fetchImpl })).get('/api/merchants/search?q=Company');
        expect(result.status).toBe(200);
        expect(result.body.merchants).toEqual(valid.slice(0, 10));
    });

    it('rate limits requests locally before spending another service request and resets after the window', async () => {
        let now = 1000;
        const fetchImpl = vi.fn(async () => response([]));
        const app = makeApp({ fetchImpl, rateLimiter: createClientErrorRateLimiter({ now: () => now, maxRequests: 1 }) });
        const first = await request(app).get('/api/merchants/search?q=Chop');
        const second = await request(app).get('/api/merchants/search?q=Chop');
        expect(first.status).toBe(200);
        expect(second.status).toBe(429);
        expect(second.body.code).toBe('MERCHANT_SEARCH_RATE_LIMITED');
        expect(second.headers['retry-after']).toBe('60');
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        now += 60_000;
        expect((await request(app).get('/api/merchants/search?q=Chop')).status).toBe(200);
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it.each([401, 403, 500, 429])('handles upstream HTTP %s without leaking its response or retrying', async status => {
        const fetchImpl = vi.fn(async () => response({ error: `secret ${SECRET}` }, status));
        const result = await request(makeApp({ fetchImpl })).get('/api/merchants/search?q=Chop');
        expect(result.status).toBe(status === 429 ? 429 : 502);
        expect(result.body.code).toBe(status === 429 ? 'MERCHANT_SEARCH_RATE_LIMITED' : 'MERCHANT_SEARCH_FAILED');
        expect(result.text).not.toContain(SECRET);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('bounds service response size', async () => {
        const fetchImpl = vi.fn(async () => response([{ name: 'x'.repeat(70_000), domain: 'company.com' }]));
        const result = await request(makeApp({ fetchImpl })).get('/api/merchants/search?q=Chop');
        expect(result.status).toBe(502);
        expect(result.body.code).toBe('MERCHANT_SEARCH_FAILED');
        expect(result.text.length).toBeLessThan(300);
    });

    it.each([() => response({ error: SECRET }), () => new Response(`invalid JSON ${SECRET}`)])('handles an unexpected success body', async fetchImpl => {
        const result = await request(makeApp({ fetchImpl })).get('/api/merchants/search?q=Chop');
        expect(result.status).toBe(502);
        expect(result.text).not.toContain(SECRET);
    });

    it('does not expose a fetch error or a secret-bearing URL', async () => {
        const fetchImpl = vi.fn(async () => { throw new Error(`https://api.logo.dev/search?key=${SECRET}`); });
        const result = await request(makeApp({ fetchImpl })).get('/api/merchants/search?q=Chop');
        expect(result.status).toBe(502);
        expect(result.text).not.toContain(SECRET);
        expect(result.text).not.toContain('https://');
    });

    it('aborts a stalled service request and returns a timeout state', async () => {
        const fetchImpl = vi.fn((url, { signal }) => new Promise((resolve, reject) => {
            signal.addEventListener('abort', () => reject(new Error(`timeout ${SECRET}`)), { once: true });
        }));
        const result = await request(makeApp({ fetchImpl, timeoutMs: 10 })).get('/api/merchants/search?q=Chop');
        expect(result.status).toBe(504);
        expect(result.body.code).toBe('MERCHANT_SEARCH_TIMEOUT');
        expect(fetchImpl.mock.calls[0][1].signal.aborted).toBe(true);
        expect(result.text).not.toContain(SECRET);
    });
});
