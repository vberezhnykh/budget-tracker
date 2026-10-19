// @vitest-environment node
//
// Замеры скорости на живом приложении: приём пакетов с телефона и отчёт.
//
// Чистые куски (нормализация пути, буфер, отчёт) проверены в perfLog.test.js
// и perfReport.test.js. Здесь проверяется то, что из них собрано: что роуты
// стоят за входом, что контракт тела строгий и что записанное читается отчётом.

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { connectTestDb, disconnectTestDb, clearCollections, loginAgent, DB_HOOK_TIMEOUT } from './test/harness.js';

let app;
let agent;
let PerfSample;
let savedPerfLog;

beforeAll(async () => {
    app = await connectTestDb('routes-perf');
    agent = await loginAgent(app);
    PerfSample = mongoose.model('PerfSample');
    await PerfSample.init();
}, DB_HOOK_TIMEOUT);

afterAll(disconnectTestDb, DB_HOOK_TIMEOUT);

beforeEach(async () => {
    await clearCollections();
    // vitest.config.js выключает запись замеров для всех тестов; здесь она нужна.
    savedPerfLog = process.env.PERF_LOG;
    delete process.env.PERF_LOG;
});

afterEach(() => {
    if (savedPerfLog === undefined) delete process.env.PERF_LOG;
    else process.env.PERF_LOG = savedPerfLog;
});

const entry = (overrides = {}) => ({
    path: '/api/stats/dashboard',
    startTime: 120.5,
    duration: 840,
    transferSize: 5000,
    serverTotal: 450.4,
    serverDb: 310.1,
    serverCalc: 120,
    ...overrides
});

const startup = (overrides = {}) => ({
    event: 'startup',
    pageId: 'page-12345678',
    sentAt: 2500,
    dataReadyAt: 1234.5,
    standalone: true,
    page: { responseStart: 180.5, fromCache: false, viaWorker: true },
    requests: [entry()],
    ...overrides
});

const requestsBatch = (overrides = {}) => ({
    event: 'requests',
    pageId: 'page-12345678',
    sentAt: 9000,
    requests: [entry({ path: '/api/history' })],
    ...overrides
});

const post = body => agent.post('/api/perf/client').send(body);

describe('доступ', () => {
    it('без входа оба роута отвечают 401', async () => {
        expect((await request(app).post('/api/perf/client').send(startup())).status).toBe(401);
        expect((await request(app).get('/api/perf/report')).status).toBe(401);
    });
});

describe('POST /api/perf/client', () => {
    it('принимает запуск приложения и пишет один документ client с пересобранным путём', async () => {
        const res = await post(startup({
            requests: [entry({ path: '/api/transactions/65f0c0ffee0123456789abcd?search=секретный+текст' })]
        }));

        expect(res.status).toBe(202);
        expect(res.body).toEqual({ ok: true });
        const docs = await PerfSample.find().lean();
        expect(docs).toHaveLength(1);
        expect(docs[0]).toMatchObject({
            kind: 'client',
            event: 'startup',
            pageId: 'page-12345678',
            sentAt: 2500,
            dataReadyAt: 1234.5,
            standalone: true,
            page: { responseStart: 180.5, fromCache: false, viaWorker: true }
        });
        expect(docs[0].at).toBeInstanceOf(Date);
        expect(docs[0].requests).toEqual([{
            path: '/api/transactions/:id',
            startTime: 120.5,
            duration: 840,
            transferSize: 5000,
            serverTotal: 450.4,
            serverDb: 310.1,
            serverCalc: 120
        }]);
        expect(JSON.stringify(docs)).not.toContain('секретный');
    });

    it('принимает пакет запросов и записи без серверного времени', async () => {
        const res = await post(requestsBatch({
            requests: [{ path: '/api/history', startTime: 1, duration: 2, serverTotal: null, transferSize: null }]
        }));

        expect(res.status).toBe(202);
        const [doc] = await PerfSample.find().lean();
        expect(doc).toMatchObject({ kind: 'client', event: 'requests' });
        expect(doc.requests).toEqual([{ path: '/api/history', startTime: 1, duration: 2 }]);
        expect(doc).not.toHaveProperty('page');
    });

    it('запуск без данных страницы (page: null) принимается', async () => {
        expect((await post(startup({ page: null }))).status).toBe(202);
        const [doc] = await PerfSample.find().lean();
        expect(doc).not.toHaveProperty('page');
    });

    it('отвечает 202, но ничего не пишет при PERF_LOG=off', async () => {
        process.env.PERF_LOG = 'off';
        expect((await post(startup())).status).toBe(202);
        expect(await PerfSample.countDocuments()).toBe(0);
    });

    describe('отклоняет с 400', () => {
        const rejected = {
            'неизвестное поле верхнего уровня': startup({ note: 'x' }),
            'неизвестное поле записи': startup({ requests: [entry({ query: '?q=1' })] }),
            'неизвестное поле страницы': startup({ page: { fromCache: true, viaWorker: false, url: '/' } }),
            'поля запуска в пакете запросов': requestsBatch({ standalone: true }),
            'неизвестный вид': startup({ event: 'other' }),
            'без вида': { pageId: 'page-12345678', sentAt: 1, requests: [] },
            'плохой pageId': startup({ pageId: 'a b' }),
            'короткий pageId': startup({ pageId: 'abc' }),
            'путь не из /api/': startup({ requests: [entry({ path: '/assets/index.js' })] }),
            'путь без /api/ в начале': startup({ requests: [entry({ path: 'api/accounts' })] }),
            'слишком длинный путь': startup({ requests: [entry({ path: `/api/${'a'.repeat(300)}` })] }),
            'путь не строка': startup({ requests: [entry({ path: 5 })] }),
            'отрицательное время': startup({ requests: [entry({ duration: -1 })] }),
            'время вне предела': startup({ requests: [entry({ startTime: 1e12 })] }),
            'размер вне предела': startup({ requests: [entry({ transferSize: 1e12 })] }),
            'число строкой': startup({ requests: [entry({ duration: '840' })] }),
            'dataReadyAt не число': startup({ dataReadyAt: 'скоро' }),
            'dataReadyAt нет': { ...startup(), dataReadyAt: undefined },
            'standalone не булево': startup({ standalone: 1 }),
            'fromCache не булево': startup({ page: { fromCache: 'yes', viaWorker: false } }),
            'requests не массив': startup({ requests: {} }),
            'пустой пакет запросов': requestsBatch({ requests: [] }),
            'запись не объект': startup({ requests: ['/api/accounts'] }),
            'тело массив': [startup()]
        };

        for (const [name, body] of Object.entries(rejected)) {
            it(name, async () => {
                const res = await post(body);
                expect(res.status).toBe(400);
                expect(res.body.ok).toBe(false);
                expect(await PerfSample.countDocuments()).toBe(0);
            });
        }

        it('больше 100 записей', async () => {
            const requests = Array.from({ length: 101 }, () => entry());
            expect((await post(startup({ requests }))).status).toBe(400);
            expect((await post(startup({ requests: requests.slice(1) }))).status).toBe(202);
        });
    });

    it('отвечает 413 на тело больше 32 КБ, хотя общий лимит JSON 1 МБ', async () => {
        const requests = Array.from({ length: 100 }, () => entry({ path: `/api/${'a'.repeat(280)}` }));
        const body = startup({ requests });
        expect(Buffer.byteLength(JSON.stringify(body))).toBeGreaterThan(32 * 1024);

        const res = await post(body);

        expect(res.status).toBe(413);
        expect(await PerfSample.countDocuments()).toBe(0);
    });
});

describe('замер запросов сервера', () => {
    it('пишет API-запросы в базу пачкой по 50, а health, ready и perf-роуты не пишет', async () => {
        await agent.get('/api/health');
        await agent.get('/api/ready');
        await agent.get('/api/perf/report');
        await post(startup());
        for (let index = 0; index < 50; index += 1) {
            await agent.get('/api/accounts?search=секретный+текст');
        }

        // Запись идёт в фоне, после ответа: ждём пачку, а не сам запрос.
        await vi.waitFor(async () => {
            expect(await PerfSample.countDocuments({ kind: 'server' })).toBe(50);
        });
        const docs = await PerfSample.find({ kind: 'server' }).lean();
        expect(new Set(docs.map(doc => doc.path))).toEqual(new Set(['/api/accounts']));
        expect(docs[0]).toMatchObject({ method: 'GET', status: 200 });
        expect(docs[0].totalMs).toBeGreaterThanOrEqual(0);
        expect(docs[0].dbMs).toBeGreaterThanOrEqual(0);
        expect(docs[0].uptime).toBeGreaterThan(0);
        expect(JSON.stringify(docs)).not.toContain('секретный');
    });
});

describe('индексы', () => {
    it('коллекция удаляет записи сама через 14 дней по полю at', async () => {
        const indexes = await mongoose.connection.collection('perfsamples').indexes();
        const ttl = indexes.find(index => index.key?.at === 1);
        expect(ttl?.expireAfterSeconds).toBe(14 * 24 * 60 * 60);
    });
});

describe('GET /api/perf/report', () => {
    const hoursAgo = hours => new Date(Date.now() - hours * 3600 * 1000);

    const seed = () => PerfSample.create([
        { kind: 'boot', at: hoursAgo(3), connectMs: 800, seedMs: 100, sinceProcessStartMs: 2000 },
        { kind: 'server', at: hoursAgo(2), method: 'GET', path: '/api/accounts', status: 200, totalMs: 40, dbMs: 30, uptime: 900 },
        {
            kind: 'client', at: hoursAgo(2), event: 'startup', pageId: 'page-12345678', sentAt: 1000, dataReadyAt: 900,
            standalone: true, page: { responseStart: 120, fromCache: true, viaWorker: true },
            requests: [{ path: '/api/accounts', startTime: 100, duration: 70, serverTotal: 40 }]
        },
        { kind: 'server', at: hoursAgo(30), method: 'GET', path: '/api/old', status: 200, totalMs: 1, uptime: 900 }
    ]);

    it('отдаёт текст с заголовками разделов, без кеша', async () => {
        await seed();

        const res = await agent.get('/api/perf/report');

        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toBe('text/plain; charset=utf-8');
        expect(res.headers['cache-control']).toBe('no-store');
        for (const header of [
            '1. Записи за период', '2. Запуски сервера', '3. Запуски приложения',
            '4. Запросы с телефона по путям', '5. Запросы на сервере по путям', '6. 10 самых медленных'
        ]) {
            expect(res.text).toContain(header);
        }
        expect(res.text).toContain('/api/accounts');
        expect(res.text).toContain('(последние 24 ч, Europe/Bucharest)');
        // За пределами суток запись не попадает.
        expect(res.text).not.toContain('/api/old');
    });

    it('параметр hours расширяет период, но не дальше 336 часов', async () => {
        await seed();

        expect((await agent.get('/api/perf/report?hours=48')).text).toContain('/api/old');
        const clamped = await agent.get('/api/perf/report?hours=100000');
        expect(clamped.status).toBe(200);
        expect(clamped.text).toContain('(последние 336 ч,');
    });

    it('плохой hours - 400', async () => {
        for (const hours of ['0', '-5', 'abc', '', 'Infinity', 'NaN']) {
            const res = await agent.get(`/api/perf/report?hours=${hours}`);
            expect(res.status, `hours=${hours}`).toBe(400);
        }
        expect((await agent.get('/api/perf/report?hours=1&hours=2')).status).toBe(400);
    });

    it('без записей говорит об этом прямо', async () => {
        const res = await agent.get('/api/perf/report');
        expect(res.status).toBe(200);
        expect(res.text).toContain('За этот период замеров нет.');
    });
});
