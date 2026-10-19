import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    describeRequest,
    describeServerTiming,
    formatMs,
    initLoadTiming,
    markDataReady,
    readLoadTiming,
    resetLoadTimingForTests,
} from './loadTiming';

const origin = window.location.origin;
const resource = (path, extra = {}) => ({
    name: `${origin}${path}`,
    startTime: 100,
    duration: 50,
    transferSize: 300,
    serverTiming: [],
    ...extra,
});

// Подмена performance целиком: jsdom не ведёт Resource Timing сам.
const stubPerformance = ({ navigation = [], resources = [], now = 1000, ...rest } = {}) => {
    vi.stubGlobal('performance', {
        now: () => now,
        getEntriesByType: type => (type === 'navigation' ? navigation : resources),
        ...rest,
    });
};

beforeEach(() => resetLoadTimingForTests());
afterEach(() => vi.unstubAllGlobals());

describe('formatMs', () => {
    it('округляет до целых миллисекунд и группирует тысячи по-русски', () => {
        expect(formatMs(839.6)).toBe('840 мс');
        expect(formatMs(1234.4).replace(/\s/g, ' ')).toBe('1 234 мс');
    });
});

describe('describeServerTiming и describeRequest', () => {
    it('показывает базу, расчет и общее время в фиксированном порядке, чужое пропускает', () => {
        const serverTiming = [
            { name: 'total', duration: 450.4 },
            { name: 'cdn', duration: 9 },
            { name: 'calc', duration: 120.2 },
            { name: 'db', duration: 310.1 },
        ];
        expect(describeServerTiming(serverTiming)).toBe('база 310, расчет 120, всего 450');
    });

    it('строка запроса без серверных времен не содержит скобок', () => {
        expect(describeRequest({ path: '/api/accounts', duration: 12, serverTiming: [] })).toBe('/api/accounts — 12 мс');
        expect(describeRequest({
            path: '/api/stats/dashboard',
            duration: 840,
            serverTiming: [{ name: 'db', duration: 310 }, { name: 'calc', duration: 120 }],
        })).toBe('/api/stats/dashboard — 840 мс (сервер: база 310, расчет 120)');
    });
});

describe('markDataReady', () => {
    it('запоминает только первую отметку', () => {
        stubPerformance({ now: 700 });
        markDataReady();
        stubPerformance({ now: 5000 });
        markDataReady();
        expect(readLoadTiming().dataReadyAt).toBe(700);
    });
});

describe('readLoadTiming', () => {
    it('читает ожидание страницы и признак кеша', () => {
        stubPerformance({ navigation: [{ responseStart: 180.5, transferSize: 0, workerStart: 12 }] });
        expect(readLoadTiming().page).toEqual({ responseStart: 180.5, fromCache: true, viaWorker: true });

        stubPerformance({ navigation: [{ responseStart: 90, transferSize: 4000, workerStart: 0 }] });
        expect(readLoadTiming().page).toEqual({ responseStart: 90, fromCache: false, viaWorker: false });
    });

    it('оставляет только /api/ того же origin и обрезает строку запроса', () => {
        stubPerformance({
            resources: [
                resource('/api/history?search=секретный+текст&month=2026-08'),
                resource('/assets/index-abc.js'),
                { ...resource('/api/accounts'), name: 'https://example.com/api/accounts' },
            ],
        });
        const { recentRequests } = readLoadTiming();
        expect(recentRequests.map(item => item.path)).toEqual(['/api/history']);
        expect(JSON.stringify(recentRequests)).not.toContain('секретный');
    });

    it('делит запросы на стартовые (до готовности данных с небольшим запасом) и последние', () => {
        stubPerformance({
            now: 1000,
            resources: [
                resource('/api/accounts', { startTime: 100 }),
                resource('/api/stats/dashboard', { startTime: 1400, serverTiming: [{ name: 'db', duration: 5, description: '' }] }),
                resource('/api/history', { startTime: 1800 }),
                resource('/api/accounts', { startTime: 9000 }),
            ],
        });
        markDataReady();
        const timing = readLoadTiming();
        expect(timing.startupRequests.map(item => item.path)).toEqual(['/api/accounts', '/api/stats/dashboard']);
        expect(timing.startupRequests[1].serverTiming).toEqual([{ name: 'db', duration: 5 }]);
        // Свежие сверху.
        expect(timing.recentRequests.map(item => item.startTime)).toEqual([9000, 1800, 1400, 100]);
    });

    it('ограничивает последние запросы десятью', () => {
        stubPerformance({ resources: Array.from({ length: 15 }, (_, index) => resource('/api/accounts', { startTime: index })) });
        const { recentRequests } = readLoadTiming();
        expect(recentRequests).toHaveLength(10);
        expect(recentRequests[0].startTime).toBe(14);
    });

    it('без данных до готовности стартовый список пуст', () => {
        stubPerformance({ resources: [resource('/api/accounts')] });
        const timing = readLoadTiming();
        expect(timing.dataReadyAt).toBeNull();
        expect(timing.startupRequests).toEqual([]);
    });

    it('не падает, если браузер не умеет Performance API или serverTiming', () => {
        vi.stubGlobal('performance', {});
        expect(readLoadTiming()).toEqual({ page: null, dataReadyAt: null, startupRequests: [], recentRequests: [] });

        vi.stubGlobal('performance', {
            getEntriesByType: () => { throw new Error('unsupported'); },
        });
        expect(readLoadTiming().recentRequests).toEqual([]);

        stubPerformance({ resources: [resource('/api/accounts', { serverTiming: undefined })] });
        expect(readLoadTiming().recentRequests[0].serverTiming).toEqual([]);
    });
});

describe('initLoadTiming', () => {
    it('расширяет буфер записей, если браузер это умеет, и не падает, если нет', () => {
        const setResourceTimingBufferSize = vi.fn();
        stubPerformance({ setResourceTimingBufferSize });
        initLoadTiming();
        expect(setResourceTimingBufferSize).toHaveBeenCalledWith(1000);

        vi.stubGlobal('performance', {});
        expect(() => initLoadTiming()).not.toThrow();
    });
});
