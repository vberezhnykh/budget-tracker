// @vitest-environment node

import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { serverTiming, timed, timedSync, formatServerTiming } from './serverTiming.js';

describe('formatServerTiming', () => {
    it('пишет длительности с одним знаком и ставит total последним', () => {
        const entries = new Map([['db', 12.34], ['calc', 0.05]]);
        expect(formatServerTiming(entries, 20.06)).toBe('db;dur=12.3, calc;dur=0.1, total;dur=20.1');
    });

    it('без этапов отдаёт один total', () => {
        expect(formatServerTiming(new Map(), 3)).toBe('total;dur=3.0');
    });
});

describe('timed и timedSync', () => {
    it('возвращают результат и складывают повторные замеры одного этапа', async () => {
        const res = { locals: { serverTiming: new Map() } };
        vi.useFakeTimers();
        try {
            const pending = timed(res, 'db', new Promise((resolve) => setTimeout(() => resolve('a'), 50)));
            vi.advanceTimersByTime(50);
            expect(await pending).toBe('a');
        } finally {
            vi.useRealTimers();
        }
        expect(timedSync(res, 'db', () => 'b')).toBe('b');
        expect([...res.locals.serverTiming.keys()]).toEqual(['db']);
    });

    it('записывают этап и когда промис отклонён, и пробрасывают ошибку', async () => {
        const res = { locals: { serverTiming: new Map() } };
        await expect(timed(res, 'db', Promise.reject(new Error('boom')))).rejects.toThrow('boom');
        expect(() => timedSync(res, 'calc', () => { throw new Error('bad'); })).toThrow('bad');
        expect([...res.locals.serverTiming.keys()]).toEqual(['db', 'calc']);
    });

    it('не ломают обработчик, если middleware не подключён', async () => {
        const res = { locals: {} };
        expect(await timed(res, 'db', Promise.resolve(1))).toBe(1);
        expect(timedSync(res, 'calc', () => 2)).toBe(2);
    });
});

describe('serverTiming middleware', () => {
    const makeApp = () => {
        const app = express();
        app.use(serverTiming());
        app.get('/ok', async (req, res) => {
            await timed(res, 'db', Promise.resolve());
            const body = timedSync(res, 'calc', () => ({ ok: true }));
            res.json(body);
        });
        app.get('/plain', (req, res) => { res.send('x'); });
        app.get('/fail', (req, res) => { res.status(500).json({ message: 'no' }); });
        return app;
    };

    it('добавляет заголовок с этапами и total, в том числе на ошибочных ответах', async () => {
        const ok = await request(makeApp()).get('/ok');
        expect(ok.headers['server-timing']).toMatch(/^db;dur=\d+\.\d, calc;dur=\d+\.\d, total;dur=\d+\.\d$/);

        const fail = await request(makeApp()).get('/fail');
        expect(fail.status).toBe(500);
        expect(fail.headers['server-timing']).toMatch(/^total;dur=\d+\.\d$/);
    });

    it('добавляется к уже выставленному Server-Timing, а не затирает его', async () => {
        const app = express();
        app.use(serverTiming());
        app.get('/x', (req, res) => { res.set('Server-Timing', 'cdn;dur=1.0'); res.send('x'); });
        const res = await request(app).get('/x');
        expect(res.headers['server-timing']).toMatch(/^cdn;dur=1\.0, total;dur=\d+\.\d$/);
    });

    it('total считается от начала запроса', async () => {
        const app = express();
        app.use(serverTiming());
        app.get('/slow', async (req, res) => {
            await new Promise((resolve) => setTimeout(resolve, 40));
            res.send('x');
        });
        const res = await request(app).get('/slow');
        const total = Number(/total;dur=([\d.]+)/.exec(res.headers['server-timing'])[1]);
        expect(total).toBeGreaterThanOrEqual(35);
    });
});
