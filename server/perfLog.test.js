// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
    createPerfLog,
    createServerSampleRecorder,
    isPerfLogEnabled,
    isSkippedPath,
    normalizePath
} from './perfLog.js';
import { serverTiming, timed, timedSync } from './serverTiming.js';
import { BACKUP_COLLECTIONS } from './backup-core.js';

describe('normalizePath', () => {
    it('отбрасывает query и fragment, приводит к нижнему регистру', () => {
        expect(normalizePath('/api/History?q=секретный+текст&month=2026-08')).toBe('/api/history');
        expect(normalizePath('/api/stats/dashboard#x')).toBe('/api/stats/dashboard');
    });

    it('заменяет ObjectId, UUID, числа и длинные токены на :id', () => {
        expect(normalizePath('/api/transactions/65f0c0ffee0123456789ABCD')).toBe('/api/transactions/:id');
        expect(normalizePath('/api/trash/65f0c0ffee0123456789abcd/restore')).toBe('/api/trash/:id/restore');
        expect(normalizePath('/api/companies/123')).toBe('/api/companies/:id');
        expect(normalizePath('/api/x/3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e')).toBe('/api/x/:id');
        expect(normalizePath('/api/x/deadbeefdeadbeef')).toBe('/api/x/:id');
        expect(normalizePath('/api/x/Abcdefghij0123456789xyz')).toBe('/api/x/:id');
    });

    it('оставляет названия маршрутов, в том числе с дефисом', () => {
        expect(normalizePath('/api/planned-payments')).toBe('/api/planned-payments');
        expect(normalizePath('/api/suggestions/descriptions')).toBe('/api/suggestions/descriptions');
        expect(normalizePath('/api/month-review')).toBe('/api/month-review');
    });

    it('сегменты не из латиницы (введённый текст, проценты) тоже становятся :id', () => {
        expect(normalizePath('/api/suggestions/Лидл')).toBe('/api/suggestions/:id');
        expect(normalizePath('/api/suggestions/%D0%9B%D0%B8%D0%B4%D0%BB')).toBe('/api/suggestions/:id');
    });

    it('схлопывает слеши, ограничивает число сегментов и длину, не строку отвергает', () => {
        expect(normalizePath('//api///accounts/')).toBe('/api/accounts');
        expect(normalizePath('/a/b/c/d/e/f/g/h/i/j')).toBe('/a/b/c/d/e/f/g/h');
        expect(normalizePath(`/api/${'a'.repeat(500)}`).length).toBeLessThanOrEqual(200);
        expect(normalizePath('')).toBe('/');
        expect(normalizePath(undefined)).toBeNull();
    });
});

describe('isSkippedPath', () => {
    it('пропускает health, ready, version, login и перф-роуты', () => {
        for (const path of ['/api/health', '/api/ready', '/api/version', '/api/login', '/api/perf/client', '/api/perf/report', '/api/perf']) {
            expect(isSkippedPath(path), path).toBe(true);
        }
        for (const path of ['/api/accounts', '/api/performance', '/api/transactions']) {
            expect(isSkippedPath(path), path).toBe(false);
        }
    });
});

describe('бэкап', () => {
    it('не включает коллекцию замеров: это диагностика, а не данные пользователя', () => {
        expect(BACKUP_COLLECTIONS).not.toContain('perfsamples');
    });
});

describe('isPerfLogEnabled', () => {
    it('выключает только PERF_LOG=off, в любом регистре', () => {
        expect(isPerfLogEnabled({})).toBe(true);
        expect(isPerfLogEnabled({ PERF_LOG: '' })).toBe(true);
        expect(isPerfLogEnabled({ PERF_LOG: 'on' })).toBe(true);
        expect(isPerfLogEnabled({ PERF_LOG: 'off' })).toBe(false);
        expect(isPerfLogEnabled({ PERF_LOG: ' OFF ' })).toBe(false);
    });
});

describe('createPerfLog', () => {
    let model;
    let connected;
    let enabled;
    let clock;
    let logger;
    const sample = (n = 0) => ({ kind: 'server', at: new Date(0), path: `/api/x${n}` });
    const make = (options = {}) => createPerfLog({
        getModel: () => model,
        isConnected: () => connected,
        isEnabled: () => enabled,
        now: () => clock,
        logger,
        ...options
    });

    beforeEach(() => {
        vi.useFakeTimers();
        model = { insertMany: vi.fn(() => Promise.resolve()) };
        connected = true;
        enabled = true;
        clock = 1_000_000;
        logger = { warn: vi.fn() };
    });
    afterEach(() => vi.useRealTimers());

    it('копит замеры и пишет их одной пачкой через 10 секунд с ordered: false', async () => {
        const log = make();
        log.add(sample(1));
        log.add(sample(2));
        expect(model.insertMany).not.toHaveBeenCalled();
        expect(log.size()).toBe(2);

        await vi.advanceTimersByTimeAsync(10_000);
        expect(model.insertMany).toHaveBeenCalledTimes(1);
        expect(model.insertMany).toHaveBeenCalledWith([sample(1), sample(2)], { ordered: false });
        expect(log.size()).toBe(0);
    });

    it('пишет сразу, когда набралось 50 замеров', async () => {
        const log = make();
        for (let index = 0; index < 49; index += 1) log.add(sample(index));
        expect(model.insertMany).not.toHaveBeenCalled();
        log.add(sample(49));
        await vi.advanceTimersByTimeAsync(0);
        expect(model.insertMany).toHaveBeenCalledTimes(1);
        expect(model.insertMany.mock.calls[0][0]).toHaveLength(50);
    });

    it('таймер не держит процесс (unref) и не взводится без замеров', () => {
        const unref = vi.fn();
        const realSetTimeout = globalThis.setTimeout;
        const spy = vi.spyOn(globalThis, 'setTimeout').mockImplementation((...args) => {
            const timer = realSetTimeout(...args);
            timer.unref = unref;
            return timer;
        });
        const log = make();
        expect(spy).not.toHaveBeenCalled();
        log.add(sample());
        expect(unref).toHaveBeenCalledTimes(1);
        spy.mockRestore();
    });

    it('при недоступной базе держит не больше потолка и выбрасывает самые давние', async () => {
        connected = false;
        const log = make({ maxBuffered: 500 });
        for (let index = 0; index < 700; index += 1) log.add(sample(index));
        expect(log.size()).toBe(500);
        expect(log.droppedCount()).toBe(200);
        await vi.advanceTimersByTimeAsync(30_000);
        expect(model.insertMany).not.toHaveBeenCalled();

        connected = true;
        await vi.advanceTimersByTimeAsync(10_000);
        const written = model.insertMany.mock.calls[0][0];
        expect(written).toHaveLength(500);
        expect(written[0].path).toBe('/api/x200');
    });

    it('при ошибке записи возвращает пачку в буфер, потолок держит, лог пишет не чаще раза в 5 минут', async () => {
        model.insertMany.mockRejectedValue(new Error('network down'));
        const log = make({ maxBuffered: 5 });
        for (let index = 0; index < 4; index += 1) log.add(sample(index));

        await vi.advanceTimersByTimeAsync(10_000);
        expect(log.size()).toBe(4);
        log.add(sample(4));
        log.add(sample(5));
        log.add(sample(6));
        expect(log.size()).toBe(5);

        await vi.advanceTimersByTimeAsync(10_000);
        expect(model.insertMany).toHaveBeenCalledTimes(2);
        expect(logger.warn).toHaveBeenCalledTimes(1);

        // Третья неудача подряд: пачка выбрасывается, а не копится вечно.
        await vi.advanceTimersByTimeAsync(10_000);
        expect(log.size()).toBe(0);
        expect(logger.warn).toHaveBeenCalledTimes(1);

        clock += 5 * 60 * 1000;
        log.add(sample(7));
        await vi.advanceTimersByTimeAsync(10_000);
        expect(logger.warn).toHaveBeenCalledTimes(2);
        expect(logger.warn.mock.calls[0].join(' ')).toContain('network down');
    });

    it('ошибка записи и ошибка лога не бросают исключение наружу', async () => {
        model.insertMany.mockRejectedValue(new Error('boom'));
        logger.warn.mockImplementation(() => { throw new Error('log broken'); });
        const log = make();
        expect(() => log.add(sample())).not.toThrow();
        await expect(log.flush()).resolves.toBeUndefined();
    });

    it('при PERF_LOG=off ничего не копит и не пишет, а накопленное выбрасывает', async () => {
        const log = make();
        log.add(sample(1));
        enabled = false;
        log.add(sample(2));
        expect(log.isEnabled()).toBe(false);
        await vi.advanceTimersByTimeAsync(10_000);
        expect(model.insertMany).not.toHaveBeenCalled();
        expect(log.size()).toBe(0);
        expect(await log.writeNow(sample(3))).toBe(false);
        expect(model.insertMany).not.toHaveBeenCalled();
    });

    it('stop() сбрасывает остаток в базу и снимает таймер', async () => {
        const log = make();
        log.add(sample(1));
        await log.stop();
        expect(model.insertMany).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(model.insertMany).toHaveBeenCalledTimes(1);
    });

    it('stop() не виснет и ничего не пишет, пока базы нет', async () => {
        connected = false;
        const log = make();
        log.add(sample(1));
        await log.stop();
        expect(model.insertMany).not.toHaveBeenCalled();
    });

    it('writeNow пишет один замер сразу и возвращает false при отказе', async () => {
        const log = make();
        expect(await log.writeNow(sample(1))).toBe(true);
        expect(model.insertMany).toHaveBeenCalledWith([sample(1)], { ordered: false });

        model.insertMany.mockRejectedValue(new Error('x'));
        expect(await log.writeNow(sample(2))).toBe(false);
        connected = false;
        expect(await log.writeNow(sample(3))).toBe(false);
    });
});

describe('createServerSampleRecorder', () => {
    const info = (overrides = {}) => ({
        method: 'get',
        url: '/api/stats/dashboard?today=2026-08-15&q=секрет',
        status: 200,
        startedAt: 1_700_000_000_000,
        uptime: 12.345,
        totalMs: 45.67,
        entries: new Map([['db', 30.04], ['calc', 4.96]]),
        contentLength: '1234',
        ...overrides
    });
    const makeRecorder = () => {
        const perfLog = { isEnabled: vi.fn(() => true), add: vi.fn() };
        return { perfLog, record: createServerSampleRecorder({ perfLog }) };
    };

    it('собирает замер: нормализованный путь, этапы, размер и uptime, без query', () => {
        const { perfLog, record } = makeRecorder();
        record(info());
        expect(perfLog.add).toHaveBeenCalledWith({
            kind: 'server',
            at: new Date(1_700_000_000_000),
            method: 'GET',
            path: '/api/stats/dashboard',
            status: 200,
            totalMs: 45.7,
            dbMs: 30,
            calcMs: 5,
            bytes: 1234,
            uptime: 12.3
        });
        expect(JSON.stringify(perfLog.add.mock.calls[0][0])).not.toContain('секрет');
    });

    it('сохраняет состояние кэша, только если оно известно', () => {
        const { perfLog, record } = makeRecorder();
        record(info({ cache: 'hit' }));
        record(info({ cache: 'miss' }));
        record(info({ cache: 'stale' }));
        record(info({ cache: 'off' }));
        record(info({ cache: undefined }));
        expect(perfLog.add.mock.calls.map(([sample]) => sample.cache)).toEqual(['hit', 'miss', 'stale', undefined, undefined]);
        expect(perfLog.add.mock.calls[3][0]).not.toHaveProperty('cache');
    });

    it('сохраняет признак готового ответа (memo), только если он известен', () => {
        const { perfLog, record } = makeRecorder();
        record(info({ memo: 'hit' }));
        record(info({ memo: 'miss' }));
        record(info({ memo: 'stale' }));
        record(info({ memo: undefined }));
        expect(perfLog.add.mock.calls.map(([sample]) => sample.memo)).toEqual(['hit', 'miss', undefined, undefined]);
        expect(perfLog.add.mock.calls[2][0]).not.toHaveProperty('memo');
    });

    it('без этапов и Content-Length этих полей нет', () => {
        const { perfLog, record } = makeRecorder();
        record(info({ entries: new Map(), contentLength: undefined }));
        const sample = perfLog.add.mock.calls[0][0];
        expect(sample).not.toHaveProperty('dbMs');
        expect(sample).not.toHaveProperty('calcMs');
        expect(sample).not.toHaveProperty('bytes');
    });

    it('не пишет health, ready, perf-роуты и ответы гейта на запросы без входа', () => {
        const { perfLog, record } = makeRecorder();
        record(info({ url: '/api/health' }));
        record(info({ url: '/api/ready' }));
        record(info({ url: '/api/perf/client', method: 'POST' }));
        record(info({ url: '/api/perf/report' }));
        record(info({ url: '/api/transactions', status: 401 }));
        record(info({ url: '/api/transactions', status: 429 }));
        expect(perfLog.add).not.toHaveBeenCalled();
    });

    it('при выключенной записи ничего не собирает', () => {
        const { perfLog, record } = makeRecorder();
        perfLog.isEnabled.mockReturnValue(false);
        record(info());
        expect(perfLog.add).not.toHaveBeenCalled();
    });
});

describe('serverTiming с onFinish', () => {
    it('сообщает итог запроса после ответа: тот же total, что в заголовке, этапы, статус, размер', async () => {
        const onFinish = vi.fn();
        const app = express();
        app.use('/api', serverTiming({ onFinish }));
        app.get('/api/ok', async (req, res) => {
            await timed(res, 'db', Promise.resolve());
            res.json(timedSync(res, 'calc', () => ({ ok: true })));
        });
        const res = await request(app).get('/api/ok?x=1');
        await vi.waitFor(() => expect(onFinish).toHaveBeenCalledTimes(1));

        const info = onFinish.mock.calls[0][0];
        expect(info.method).toBe('GET');
        expect(info.url).toBe('/api/ok?x=1');
        expect(info.status).toBe(200);
        expect([...info.entries.keys()]).toEqual(['db', 'calc']);
        expect(info.contentLength).toBeDefined();
        expect(info.uptime).toBeGreaterThan(0);
        const headerTotal = Number(/total;dur=([\d.]+)/.exec(res.headers['server-timing'])[1]);
        expect(Math.round(info.totalMs * 10) / 10).toBe(headerTotal);
    });

    it('ошибка в onFinish не ломает ответ', async () => {
        const app = express();
        app.use(serverTiming({ onFinish: () => { throw new Error('boom'); } }));
        app.get('/x', (req, res) => { res.send('x'); });
        const res = await request(app).get('/x');
        expect(res.status).toBe(200);
    });

    it('без onFinish ничего не подписывает', async () => {
        const app = express();
        app.use(serverTiming());
        app.get('/x', (req, res) => { res.send('x'); });
        expect((await request(app).get('/x')).headers['server-timing']).toMatch(/total/);
    });
});
