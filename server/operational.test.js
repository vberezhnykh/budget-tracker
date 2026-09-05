import express from 'express';
import request from 'supertest';
import { describe, it, expect, vi } from 'vitest';
import {
    createClientErrorRateLimiter,
    createOperationalRouter,
    isMongoReady
} from './operational.js';

function makeApp(options = {}) {
    const app = express();
    app.use(express.json({ limit: '1mb' }));
    app.use('/api', createOperationalRouter(options));
    return app;
}

describe('operational router', () => {
    it('returns only a boolean readiness payload and 503 while Mongo is disconnected', async () => {
        const app = makeApp({ isReady: () => false });
        const response = await request(app).get('/api/ready');

        expect(response.status).toBe(503);
        expect(response.body).toEqual({ ok: false });
        expect(Object.keys(response.body)).toEqual(['ok']);
    });

    it('maps mongoose connection state 1 to ready', () => {
        expect(isMongoReady({ connection: { readyState: 1 } })).toBe(true);
        expect(isMongoReady({ connection: { readyState: 0 } })).toBe(false);
    });

    it('accepts the frontend contract and logs only whitelisted fields', async () => {
        const info = vi.fn();
        const app = makeApp({
            isReady: () => true,
            logger: { info },
            now: () => new Date('2026-09-05T12:00:00.000Z')
        });
        const response = await request(app)
            .post('/api/client-errors')
            .set('X-Request-Id', 'frontend-7')
            .send({ code: 'react_render', area: 'app' });

        expect(response.status).toBe(202);
        expect(response.body).toEqual({ ok: true });
        expect(response.headers['x-request-id']).toBe('frontend-7');
        expect(info).toHaveBeenCalledTimes(1);
        expect(JSON.parse(info.mock.calls[0][0])).toEqual({
            event: 'client_error',
            timestamp: '2026-09-05T12:00:00.000Z',
            requestId: 'frontend-7',
            code: 'react_render',
            area: 'app'
        });
    });

    it('rejects raw details, unknown codes and oversized payloads without logging', async () => {
        const info = vi.fn();
        const app = makeApp({ logger: { info } });
        const extra = await request(app).post('/api/client-errors').send({
            code: 'react_render', area: 'app', stack: 'secret', url: '/api/transactions'
        });
        const unknown = await request(app).post('/api/client-errors').send({ code: 'database_dump', area: 'app' });
        const oversized = await request(app).post('/api/client-errors').send({
            code: 'react_render', area: 'app', padding: 'x'.repeat(3000)
        });

        expect(extra.status).toBe(400);
        expect(unknown.status).toBe(400);
        expect(oversized.status).toBe(413);
        expect(info).not.toHaveBeenCalled();
    });

    it('rate limits client error reports per source without affecting readiness', async () => {
        const app = makeApp({
            rateLimiter: createClientErrorRateLimiter({ maxRequests: 1, now: () => 1000 })
        });
        const body = { code: 'unhandled_rejection', area: 'app' };
        const first = await request(app).post('/api/client-errors').send(body);
        const second = await request(app).post('/api/client-errors').send(body);
        const ready = await request(app).get('/api/ready');

        expect(first.status).toBe(202);
        expect(second.status).toBe(429);
        expect(ready.status).toBe(503);
    });
});
