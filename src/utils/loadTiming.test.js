import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    buildRequestsPayload,
    buildStartupPayload,
    createLoadReporter,
    initLoadTiming,
    markDataReady,
    resetLoadTimingForTests,
} from './loadTiming';

const origin = 'https://budget.example';
const resource = (path, extra = {}) => ({
    name: `${origin}${path}`,
    startTime: 100,
    duration: 50,
    transferSize: 300,
    serverTiming: [],
    ...extra,
});

// Подмена performance: jsdom не ведёт Resource Timing сам.
const fakePerf = ({ navigation = [], resources = [], now = 1000, ...rest } = {}) => ({
    now: () => now,
    getEntriesByType: type => (type === 'navigation' ? navigation : resources),
    ...rest,
});

// У Blob в jsdom нет text(): читаем через FileReader.
const readBlob = blob => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
});

beforeEach(() => resetLoadTimingForTests());
afterEach(() => vi.unstubAllGlobals());

describe('buildStartupPayload', () => {
    const base = { origin, pageId: 'page-12345678', standalone: true };

    it('собирает страницу, готовность данных и запросы запуска без строки запроса', () => {
        const perf = fakePerf({
            now: 2500,
            navigation: [{ responseStart: 180.55, transferSize: 0, workerStart: 12 }],
            resources: [
                resource('/api/history?search=секретный+текст&month=2026-08', { startTime: 120.04, duration: 80.26 }),
                resource('/assets/index-abc.js'),
                { ...resource('/api/accounts'), name: 'https://example.com/api/accounts' },
                resource('/api/stats/dashboard', {
                    startTime: 200,
                    duration: 840,
                    serverTiming: [
                        { name: 'db', duration: 310.12 },
                        { name: 'cdn', duration: 9 },
                        { name: 'calc', duration: 120 },
                        { name: 'total', duration: 450.44 },
                    ],
                }),
            ],
        });
        const payload = buildStartupPayload({ ...base, perf, dataReadyAt: 1234.56, reported: new Set() });

        expect(payload).toEqual({
            event: 'startup',
            pageId: 'page-12345678',
            sentAt: 2500,
            dataReadyAt: 1234.6,
            standalone: true,
            page: { responseStart: 180.6, fromCache: true, viaWorker: true },
            requests: [
                { path: '/api/history', startTime: 120, duration: 80.3, transferSize: 300 },
                {
                    path: '/api/stats/dashboard',
                    startTime: 200,
                    duration: 840,
                    transferSize: 300,
                    serverTotal: 450.4,
                    serverDb: 310.1,
                    serverCalc: 120,
                },
            ],
        });
        expect(JSON.stringify(payload)).not.toContain('секретный');
    });

    it('берёт запросы, начавшиеся до готовности данных с запасом 500 мс', () => {
        const perf = fakePerf({
            resources: [
                resource('/api/accounts', { startTime: 100 }),
                resource('/api/stats/dashboard', { startTime: 1400 }),
                resource('/api/history', { startTime: 1800 }),
            ],
        });
        const payload = buildStartupPayload({ ...base, perf, dataReadyAt: 1000, reported: new Set() });
        expect(payload.requests.map(item => item.path)).toEqual(['/api/accounts', '/api/stats/dashboard']);
    });

    it('исключает запросы к самим замерам и помечает отправленное', () => {
        const reported = new Set();
        const perf = fakePerf({
            resources: [resource('/api/accounts'), resource('/api/perf/client', { startTime: 150 })],
        });
        const payload = buildStartupPayload({ ...base, perf, dataReadyAt: 1000, reported });
        expect(payload.requests.map(item => item.path)).toEqual(['/api/accounts']);
        expect([...reported]).toEqual([0]);
    });

    it('без готовности данных пакета нет', () => {
        expect(buildStartupPayload({ ...base, perf: fakePerf(), dataReadyAt: null, reported: new Set() })).toBeNull();
    });

    it('не падает без Performance API, serverTiming и навигации', () => {
        const payload = buildStartupPayload({ ...base, perf: {}, dataReadyAt: 700, reported: new Set() });
        expect(payload).toEqual({
            event: 'startup', pageId: 'page-12345678', sentAt: 0, dataReadyAt: 700, standalone: true, requests: [],
        });

        const throwing = { now: () => 5, getEntriesByType: () => { throw new Error('unsupported'); } };
        expect(buildStartupPayload({ ...base, perf: throwing, dataReadyAt: 700, reported: new Set() }).requests).toEqual([]);

        const noServerTiming = fakePerf({ resources: [resource('/api/accounts', { serverTiming: undefined })] });
        expect(buildStartupPayload({ ...base, perf: noServerTiming, dataReadyAt: 700, reported: new Set() }).requests[0])
            .toEqual({ path: '/api/accounts', startTime: 100, duration: 50, transferSize: 300 });
    });

    it('пропускает запись с мусорными числами, чтобы сервер не отверг весь пакет', () => {
        const perf = fakePerf({
            resources: [
                resource('/api/accounts', { duration: Number.NaN }),
                resource('/api/categories', { startTime: -5 }),
                resource('/api/settings', { transferSize: Infinity }),
            ],
        });
        const payload = buildStartupPayload({ ...base, perf, dataReadyAt: 1000, reported: new Set() });
        expect(payload.requests).toEqual([{ path: '/api/settings', startTime: 100, duration: 50 }]);
    });
});

describe('buildRequestsPayload', () => {
    it('отдаёт только ещё не отправленные записи и не повторяет их', () => {
        const reported = new Set();
        const resources = [resource('/api/accounts'), resource('/api/categories')];
        const perf = fakePerf({ resources });
        const args = { perf, origin, pageId: 'page-12345678', reported };

        expect(buildRequestsPayload(args).requests.map(item => item.path)).toEqual(['/api/accounts', '/api/categories']);
        expect(buildRequestsPayload(args)).toBeNull();

        resources.push(resource('/api/history?q=кофе', { startTime: 900 }), resource('/api/perf/client'));
        const next = buildRequestsPayload(args);
        expect(next.event).toBe('requests');
        expect(next.requests.map(item => item.path)).toEqual(['/api/history']);
        expect(buildRequestsPayload(args)).toBeNull();
    });

    it('не берёт больше 100 записей за раз, остаток уходит следующим пакетом', () => {
        const resources = Array.from({ length: 130 }, (_, index) => resource('/api/accounts', { startTime: index }));
        const args = { perf: fakePerf({ resources }), origin, pageId: 'page-12345678', reported: new Set() };
        expect(buildRequestsPayload(args).requests).toHaveLength(100);
        expect(buildRequestsPayload(args).requests).toHaveLength(30);
        expect(buildRequestsPayload(args)).toBeNull();
    });
});

describe('createLoadReporter', () => {
    const makeReporter = (overrides = {}) => {
        const resources = overrides.resources ?? [resource('/api/accounts', { startTime: 100 })];
        const sendBeacon = vi.fn(() => true);
        const fetchImpl = vi.fn(() => Promise.resolve({ ok: true }));
        const doc = new EventTarget();
        doc.visibilityState = 'visible';
        const schedule = vi.fn(fn => { schedule.last = fn; return () => {}; });
        const perf = fakePerf({ resources, now: 3000, setResourceTimingBufferSize: vi.fn() });
        const reporter = createLoadReporter({
            perf, fetchImpl, sendBeacon, origin, doc, schedule,
            standalone: false, pageId: 'page-12345678', enabled: true,
            ObserverClass: undefined,
            ...overrides.deps,
        });
        return { reporter, resources, sendBeacon, fetchImpl, doc, schedule, perf };
    };

    it('откладывает отправку запуска на простой и шлёт её один раз', () => {
        const { reporter, fetchImpl, schedule } = makeReporter();
        reporter.markDataReady();
        reporter.markDataReady();
        expect(schedule).toHaveBeenCalledTimes(1);
        expect(fetchImpl).not.toHaveBeenCalled();

        schedule.last();
        schedule.last();
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        const [url, options] = fetchImpl.mock.calls[0];
        expect(url).toBe('/api/perf/client');
        expect(options).toMatchObject({ method: 'POST', keepalive: true });
        expect(JSON.parse(options.body)).toMatchObject({ event: 'startup', dataReadyAt: 3000, standalone: false });
    });

    it('без готовности данных запуск не уходит', () => {
        const { reporter, fetchImpl } = makeReporter();
        reporter.reportStartup();
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('при выключенной отправке ничего не планирует и не шлёт', () => {
        const { reporter, fetchImpl, sendBeacon, schedule } = makeReporter({ deps: { enabled: false } });
        reporter.install();
        reporter.markDataReady();
        reporter.flushRequests({ beacon: true });
        expect(schedule).not.toHaveBeenCalled();
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(sendBeacon).not.toHaveBeenCalled();
    });

    it('при сворачивании страницы отправляет остаток через sendBeacon с типом application/json', async () => {
        const { reporter, resources, sendBeacon, fetchImpl, doc, schedule } = makeReporter();
        reporter.install();
        reporter.markDataReady();
        schedule.last();
        fetchImpl.mockClear();

        resources.push(resource('/api/history?q=кофе', { startTime: 2000 }));
        doc.visibilityState = 'hidden';
        doc.dispatchEvent(new Event('visibilitychange'));

        expect(sendBeacon).toHaveBeenCalledTimes(1);
        const [url, blob] = sendBeacon.mock.calls[0];
        expect(url).toBe('/api/perf/client');
        expect(blob.type).toBe('application/json');
        const body = JSON.parse(await readBlob(blob));
        expect(body.event).toBe('requests');
        expect(body.requests.map(item => item.path)).toEqual(['/api/history']);
        expect(JSON.stringify(body)).not.toContain('кофе');
        expect(fetchImpl).not.toHaveBeenCalled();

        // Повторное сворачивание без новых запросов ничего не шлёт.
        doc.dispatchEvent(new Event('visibilitychange'));
        expect(sendBeacon).toHaveBeenCalledTimes(1);
    });

    it('на видимой странице visibilitychange ничего не отправляет', () => {
        const { reporter, sendBeacon, doc } = makeReporter();
        reporter.install();
        doc.dispatchEvent(new Event('visibilitychange'));
        expect(sendBeacon).not.toHaveBeenCalled();
    });

    it('если запуск не успел уйти, при сворачивании он идёт первым и забирает стартовые запросы', async () => {
        const { reporter, sendBeacon, doc } = makeReporter();
        reporter.install();
        reporter.markDataReady();
        doc.visibilityState = 'hidden';
        doc.dispatchEvent(new Event('visibilitychange'));

        expect(sendBeacon).toHaveBeenCalledTimes(1);
        const body = JSON.parse(await readBlob(sendBeacon.mock.calls[0][1]));
        expect(body.event).toBe('startup');
        expect(body.requests).toHaveLength(1);
    });

    it('без sendBeacon или если он отказал, уходит через fetch keepalive', () => {
        const { reporter, resources, fetchImpl, doc } = makeReporter({
            deps: { sendBeacon: vi.fn(() => false) },
        });
        reporter.install();
        resources.push(resource('/api/history', { startTime: 2000 }));
        doc.visibilityState = 'hidden';
        doc.dispatchEvent(new Event('visibilitychange'));
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(fetchImpl.mock.calls[0][1]).toMatchObject({ keepalive: true });
    });

    it('шлёт пакет, когда накопилось 30 запросов, и только после запуска', () => {
        let notify;
        class FakeObserver {
            constructor(callback) { notify = callback; }
            observe() {}
            disconnect() {}
        }
        const { reporter, resources, fetchImpl, schedule } = makeReporter({ deps: { ObserverClass: FakeObserver }, resources: [] });
        reporter.install();
        reporter.markDataReady();

        for (let index = 0; index < 30; index += 1) resources.push(resource('/api/accounts', { startTime: index }));
        notify();
        // Запуск ещё не ушёл: пакет запросов ждёт, чтобы стартовые записи попали в запуск.
        expect(fetchImpl).not.toHaveBeenCalled();

        schedule.last();
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(JSON.parse(fetchImpl.mock.calls[0][1].body).event).toBe('startup');

        for (let index = 0; index < 29; index += 1) resources.push(resource('/api/categories', { startTime: 5000 + index }));
        notify();
        expect(fetchImpl).toHaveBeenCalledTimes(1);

        resources.push(resource('/api/categories', { startTime: 6000 }));
        notify();
        expect(fetchImpl).toHaveBeenCalledTimes(2);
        expect(JSON.parse(fetchImpl.mock.calls[1][1].body).requests).toHaveLength(30);
    });

    it('сбой fetch и sendBeacon не бросает исключение и не оставляет необработанный отказ', async () => {
        const unhandled = vi.fn();
        globalThis.process.on('unhandledRejection', unhandled);
        try {
            const { reporter, resources, doc } = makeReporter({
                deps: {
                    fetchImpl: vi.fn(() => Promise.reject(new Error('offline'))),
                    sendBeacon: vi.fn(() => { throw new Error('blocked'); }),
                },
            });
            reporter.install();
            resources.push(resource('/api/history', { startTime: 2000 }));
            doc.visibilityState = 'hidden';
            expect(() => doc.dispatchEvent(new Event('visibilitychange'))).not.toThrow();

            const throwingFetch = makeReporter({ deps: { fetchImpl: vi.fn(() => { throw new Error('sync'); }), sendBeacon: undefined } });
            throwingFetch.reporter.install();
            expect(() => throwingFetch.reporter.flushRequests()).not.toThrow();

            await new Promise(resolve => setTimeout(resolve, 10));
            expect(unhandled).not.toHaveBeenCalled();
        } finally {
            globalThis.process.off('unhandledRejection', unhandled);
        }
    });

    it('install расширяет буфер записей, если браузер это умеет, и снимает слушатели', () => {
        const { reporter, perf, sendBeacon, resources, doc } = makeReporter();
        const uninstall = reporter.install();
        expect(perf.setResourceTimingBufferSize).toHaveBeenCalledWith(1000);

        uninstall();
        resources.push(resource('/api/history', { startTime: 2000 }));
        doc.visibilityState = 'hidden';
        doc.dispatchEvent(new Event('visibilitychange'));
        expect(sendBeacon).not.toHaveBeenCalled();
    });

    it('не падает, если браузер не умеет Performance API, документ и PerformanceObserver', () => {
        const reporter = createLoadReporter({ perf: {}, origin, doc: {}, enabled: true, schedule: fn => fn() });
        expect(() => reporter.install()).not.toThrow();
        expect(() => reporter.markDataReady()).not.toThrow();
        expect(() => reporter.flushRequests({ beacon: true })).not.toThrow();
    });
});

describe('глобальные функции', () => {
    it('в тестах отправка выключена: markDataReady и initLoadTiming ничего не делают с сетью', () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        vi.stubGlobal('performance', fakePerf());
        initLoadTiming();
        markDataReady();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('initLoadTiming не падает без Performance API', () => {
        vi.stubGlobal('performance', {});
        expect(() => initLoadTiming()).not.toThrow();
    });
});
