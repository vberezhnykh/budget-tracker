// @vitest-environment node

import { describe, it, expect } from 'vitest';
import { buildPerfReport, quantile, median, p90 } from './perfReport.js';

// Нормализуем неразрывные пробелы ru-RU, чтобы сравнивать текст глазами.
const text = report => report.replace(/\u00a0/g, ' ');

const NOW = new Date('2026-10-19T12:00:00.000Z'); // 15:00 в Бухаресте (EEST, UTC+3)
const at = iso => new Date(iso);

describe('quantile, median, p90', () => {
    it('считает медиану для нечётного и чётного числа значений', () => {
        expect(median([5, 1, 3])).toBe(3);
        expect(median([4, 1, 3, 2])).toBe(2.5);
        expect(median([7])).toBe(7);
    });

    it('считает p90 с линейной интерполяцией', () => {
        expect(p90([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBeCloseTo(9.1, 10);
        expect(p90([100])).toBe(100);
        expect(quantile([10, 20], 0)).toBe(10);
        expect(quantile([10, 20], 1)).toBe(20);
    });

    it('на пустом наборе и нечисловых значениях даёт null, а не 0', () => {
        expect(median([])).toBeNull();
        expect(p90([undefined, null, Number.NaN])).toBeNull();
        expect(median([undefined, 4, null])).toBe(4);
    });

    it('не меняет исходный массив', () => {
        const values = [3, 1, 2];
        median(values);
        expect(values).toEqual([3, 1, 2]);
    });
});

describe('buildPerfReport', () => {
    const boot = (iso, extra = {}) => ({
        kind: 'boot', at: at(iso), connectMs: 850.4, seedMs: 120.2, sinceProcessStartMs: 2340, ...extra
    });
    const startup = (iso, { fromCache, responseStart, dataReadyAt, requests = [], sentAt = 2000 } = {}) => ({
        kind: 'client', event: 'startup', at: at(iso), pageId: 'p', sentAt, dataReadyAt, standalone: true,
        page: fromCache === undefined ? undefined : { responseStart, fromCache, viaWorker: false },
        requests
    });
    const serverSample = (extra = {}) => ({
        kind: 'server', at: at('2026-10-19T08:00:00.000Z'), method: 'GET', path: '/api/stats/dashboard',
        status: 200, totalMs: 100, dbMs: 60, calcMs: 20, uptime: 500, ...extra
    });

    const samples = [
        boot('2026-10-19T07:00:00.000Z'),
        // Через 1 минуту после запуска сервера: «после пробуждения».
        startup('2026-10-19T07:01:00.000Z', { fromCache: false, responseStart: 2000, dataReadyAt: 4000 }),
        // Через 2 минуты после запуска: тоже после пробуждения, из кеша.
        startup('2026-10-19T07:02:00.000Z', { fromCache: true, responseStart: 100, dataReadyAt: 1800 }),
        // Спустя полчаса: сервер уже работал.
        startup('2026-10-19T07:30:00.000Z', { fromCache: true, responseStart: 200, dataReadyAt: 1000 }),
        // До запуска сервера: после пробуждения не считается.
        startup('2026-10-19T06:59:00.000Z', { fromCache: false, responseStart: 300, dataReadyAt: 1200 }),
        // Без данных страницы: только в общей группе.
        startup('2026-10-19T09:00:00.000Z', { dataReadyAt: 1400 }),
        {
            kind: 'client', event: 'requests', at: at('2026-10-19T10:00:00.000Z'), pageId: 'p', sentAt: 5000,
            requests: [
                { path: '/api/stats/dashboard', startTime: 4000, duration: 900, serverTotal: 400, serverDb: 300, serverCalc: 50 },
                { path: '/api/stats/dashboard', startTime: 4500, duration: 700, serverTotal: 500, serverDb: 350, serverCalc: 60 },
                { path: '/api/stats/dashboard', startTime: 4800, duration: 2500 },
                { path: '/api/accounts', startTime: 4900, duration: 60, serverTotal: 20, serverDb: 10 }
            ]
        },
        serverSample({ totalMs: 100, dbMs: 60, calcMs: 20, uptime: 500 }),
        serverSample({ totalMs: 300, dbMs: 200, calcMs: 40, uptime: 600 }),
        serverSample({ totalMs: 2000, dbMs: 1500, calcMs: 100, uptime: 30 }),
        serverSample({ path: '/api/transactions/:id', method: 'PUT', status: 500, totalMs: 50, uptime: 700 })
    ];

    const report = text(buildPerfReport(samples, { now: NOW, hours: 24 }));

    it('содержит заголовки всех шести разделов и период в местном времени', () => {
        for (const header of [
            '1. Записи за период',
            '2. Запуски сервера',
            '3. Запуски приложения',
            '4. Запросы с телефона по путям',
            '5. Запросы на сервере по путям',
            '6. 10 самых медленных запросов с телефона'
        ]) {
            expect(report).toContain(header);
        }
        expect(report).toContain('Период: 18.10.2026 15:00 — 19.10.2026 15:00 (последние 24 ч, Europe/Bucharest)');
    });

    it('показывает долю обращений из кэша в памяти только там, где состояние известно', () => {
        const cached = text(buildPerfReport([
            serverSample({ cache: 'miss', totalMs: 900 }),
            serverSample({ cache: 'hit', totalMs: 5 }),
            serverSample({ cache: 'hit', totalMs: 6 }),
            serverSample({ cache: 'stale', totalMs: 7 }),
            serverSample({ path: '/api/accounts', totalMs: 8 })
        ], { now: NOW, hours: 24 }));

        expect(cached).toContain('кэш: из памяти 2 из 4 (50%), устаревший 1, из базы 1');
        const start = cached.indexOf('GET /api/accounts');
        const accounts = cached.slice(start, cached.indexOf('GET /api/stats/dashboard'));
        expect(accounts).toContain('запросов 1');
        expect(accounts).not.toContain('кэш:');
        // В основном отчёте записей без состояния кэша строки нет.
        expect(report).not.toContain('кэш:');
    });

    it('считает записи по видам', () => {
        expect(report).toContain('Всего: 11');
        expect(report).toContain('запросы на сервере: 4');
        expect(report).toContain('запуски сервера: 1');
        expect(report).toContain('отчеты с телефона: 6 (запусков приложения 5, запросов 4)');
    });

    it('показывает запуск сервера в местном времени с округлёнными миллисекундами', () => {
        expect(report).toContain('19.10 10:00:00 — подключение к базе 850 мс, засев 120 мс, от старта процесса до готовности 2 340 мс');
    });

    it('считает медиану и p90 запусков приложения и делит их по кешу', () => {
        const startupSection = report.slice(report.indexOf('3. Запуски'), report.indexOf('4. Запросы'));
        // dataReadyAt: 4000, 1800, 1000, 1200, 1400 -> медиана 1 400, p90 3 120.
        expect(startupSection).toContain('Всего запусков: 5');
        expect(startupSection).toContain('данные на экране: медиана 1 400 мс, p90 3 120 мс');
        // responseStart: 2000, 100, 200, 300 -> медиана 250.
        expect(startupSection).toContain('ответ сервера на страницу: медиана 250 мс');
        expect(startupSection).toMatch(/Страница из кеша: 2\n.*\n {2}данные на экране: медиана 1 400 мс/);
        expect(startupSection).toMatch(/Страница по сети: 2\n {2}ответ сервера на страницу: медиана 1 150 мс/);
    });

    it('делит запуски по «сервер только что проснулся» по записи boot за 3 минуты до запуска', () => {
        const startupSection = report.slice(report.indexOf('3. Запуски'), report.indexOf('4. Запросы'));
        // 07:01 и 07:02 - после запуска сервера, остальные три - нет.
        expect(startupSection).toMatch(/Сразу после пробуждения сервера: 2\n.*\n {2}данные на экране: медиана 2 900 мс/);
        expect(startupSection).toMatch(/Сервер уже работал: 3\n/);
    });

    it('не считает запуск «после пробуждения», если boot был больше 3 минут назад', () => {
        const only = [
            boot('2026-10-19T07:00:00.000Z'),
            startup('2026-10-19T07:03:01.000Z', { fromCache: false, responseStart: 100, dataReadyAt: 1000 })
        ];
        const result = text(buildPerfReport(only, { now: NOW }));
        expect(result).toContain('Сразу после пробуждения сервера: 0');
        expect(result).toContain('Сервер уже работал: 1');
    });

    it('собирает запросы с телефона по путям: медианы, p90, сервер, сеть и ожидание', () => {
        const section = report.slice(report.indexOf('4. Запросы'), report.indexOf('5. Запросы'));
        const dashboard = section.slice(section.indexOf('/api/stats/dashboard'), section.indexOf('/api/accounts'));
        expect(dashboard).toContain('запросов 3; на телефоне: медиана 900 мс, p90 2 180 мс');
        expect(dashboard).toContain('сервер: всего 450 мс, база 325 мс, расчет 55 мс');
        // Сеть и ожидание только по запросам с серверным временем: 500 и 200 -> 350.
        expect(dashboard).toContain('сеть и ожидание: 350 мс (по 2 запросам)');
        expect(section).toContain('/api/accounts\n  запросов 1; на телефоне: медиана 60 мс, p90 60 мс');
        expect(section).toContain('сеть и ожидание: 40 мс (по 1 запросам)');
        // Медленные пути выше.
        expect(section.indexOf('/api/stats/dashboard')).toBeLessThan(section.indexOf('/api/accounts'));
    });

    it('собирает запросы на сервере по путям и отдельно холодный старт', () => {
        const section = report.slice(report.indexOf('5. Запросы'), report.indexOf('6. 10'));
        expect(section).toContain('GET /api/stats/dashboard\n  запросов 3; всего: медиана 300 мс, p90 1 660 мс\n  база 200 мс, расчет 40 мс');
        expect(section).toContain('PUT /api/transactions/:id\n  запросов 1 (ошибок 5xx: 1); всего: медиана 50 мс');
        expect(section).toContain('Первые 120 с после старта процесса: запросов 1, медиана всего 2 000 мс');
        expect(section).toContain('Позже: запросов 3, медиана всего 100 мс');
    });

    it('показывает самые медленные запросы с телефона с местным временем и временем сервера', () => {
        const section = report.slice(report.indexOf('6. 10'));
        const lines = section.split('\n').filter(line => /^\d+\. \d{2}\.\d{2} /.test(line));
        // Приём 10:00 UTC = 13:00 местного; запрос начался за sentAt - startTime = 0,2 с до отправки, то есть в 12:59:59.
        expect(lines[0]).toBe('1. 19.10 12:59:59 — /api/stats/dashboard — 2 500 мс (сервер без замера)');
        expect(lines[1]).toContain('/api/stats/dashboard — 900 мс (сервер 400 мс)');
        expect(lines).toHaveLength(4);
    });

    it('в списке медленных не больше десяти', () => {
        const many = [{
            kind: 'client', event: 'requests', at: NOW, pageId: 'p', sentAt: 100000,
            requests: Array.from({ length: 25 }, (_, index) => ({ path: '/api/history', startTime: index * 10, duration: 100 + index }))
        }];
        const result = text(buildPerfReport(many, { now: NOW }));
        const lines = result.slice(result.indexOf('6. 10')).split('\n').filter(line => /^\d+\. \d{2}\.\d{2} /.test(line));
        expect(lines).toHaveLength(10);
        expect(lines[0]).toContain('124 мс');
    });

    it('без данных говорит об этом прямо', () => {
        const empty = buildPerfReport([], { now: NOW, hours: 6 });
        expect(empty).toContain('Отчет о скорости приложения');
        expect(empty).toContain('(последние 6 ч, Europe/Bucharest)');
        expect(empty).toContain('За этот период замеров нет.');
        expect(empty).not.toContain('1. Записи за период');
    });

    it('разделы без записей своего вида говорят «нет» и не падают', () => {
        const onlyServer = text(buildPerfReport([serverSample()], { now: NOW }));
        expect(onlyServer).toContain('Запусков сервера за период не было.');
        expect(onlyServer).toContain('Запусков приложения за период нет.');
        expect(onlyServer).toContain('Запросов с телефона за период нет.');
        expect(onlyServer).toContain('GET /api/stats/dashboard');
    });

    it('запрос без серверного времени и без Server-Timing не ломает строки', () => {
        const result = text(buildPerfReport([{
            kind: 'client', event: 'requests', at: NOW, pageId: 'p', sentAt: 10,
            requests: [{ path: '/api/history', startTime: 1, duration: 80 }]
        }], { now: NOW }));
        expect(result).toContain('сервер не сообщил времени');
        expect(result).not.toContain('NaN');
        expect(result).not.toContain('undefined');
    });

    it('использует переданный часовой пояс', () => {
        const result = text(buildPerfReport([boot('2026-10-19T07:00:00.000Z')], { now: NOW, timeZone: 'UTC' }));
        expect(result).toContain('19.10 07:00:00 — подключение');
        expect(result).toContain(', UTC)');
    });
});
