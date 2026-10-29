// @vitest-environment node

import { describe, it, expect, vi } from 'vitest';
import { createDashboardWarmer, localDateIn, MAX_TRACKED, DAY_CHECK_INTERVAL_MS } from './dashboardWarmer.js';
import { parseDashboardQuery } from './dashboardRequest.js';
import { createResponseMemo } from './responseMemo.js';
import { createLedgerCache } from './ledgerCache.js';

const UTC = (iso) => Date.parse(iso);
// Дубай: UTC+4 круглый год, без перехода на летнее время.
const DUBAI = 'Asia/Dubai';

// Кэш операций, которым управляет тест: снимок, версия и подписчики.
function fakeLedger({ enabled = true } = {}) {
    const state = { enabled, snapshot: { version: 1, docs: [], accounts: [] }, listeners: new Set() };
    return {
        state,
        isEnabled: () => state.enabled,
        peek: () => state.snapshot,
        onRefreshChanged(listener) {
            state.listeners.add(listener);
            return () => state.listeners.delete(listener);
        },
        // Фоновое обновление нашло другие данные: версия выросла.
        refreshChanged() {
            state.snapshot = { ...state.snapshot, version: state.snapshot.version + 1 };
            state.listeners.forEach(listener => listener(state.snapshot));
        }
    };
}

function make({ now = UTC('2026-10-31T12:00:00Z'), enabled = true, computeJson, ...options } = {}) {
    const clock = { time: now };
    const ledgerCache = fakeLedger({ enabled });
    const responseMemo = createResponseMemo();
    const computed = [];
    const scheduled = [];
    const compute = computeJson || vi.fn((snapshot, params) => {
        computed.push({ version: snapshot.version, params });
        return JSON.stringify({ today: params.today, month: params.month });
    });
    const warmer = createDashboardWarmer({
        ledgerCache,
        responseMemo,
        computeJson: compute,
        now: () => clock.time,
        schedule: fn => scheduled.push(fn),
        setTimer: vi.fn(() => ({ unref: vi.fn() })),
        clearTimer: vi.fn(),
        logger: { warn: vi.fn() },
        ...options
    });
    // Выполняет отложенные такты по одному, пока очередь не опустеет.
    const drain = () => {
        let guard = 100;
        while (scheduled.length > 0 && guard-- > 0) scheduled.shift()();
    };
    return { warmer, ledgerCache, responseMemo, clock, computed, scheduled, drain, compute };
}

// Параметры, как их строит роут из строки запроса клиента.
const requestParams = (query) => parseDashboardQuery({ analytics: '1', ...query });
const track = (warmer, query, tz = DUBAI) => {
    const { params } = requestParams(query);
    warmer.track(params, tz);
};
// Ответ под этими параметрами уже лежит в памяти (без расчета).
const isReady = (responseMemo, version, query) => {
    const compute = vi.fn(() => 'расчет');
    const { hit } = responseMemo.getEntry('dashboard', requestParams(query).params, version, compute);
    return hit;
};

describe('localDateIn', () => {
    it('даёт локальную дату в зоне, а не UTC', () => {
        expect(localDateIn(DUBAI, UTC('2026-10-31T19:59:00Z'))).toBe('2026-10-31');
        expect(localDateIn(DUBAI, UTC('2026-10-31T20:01:00Z'))).toBe('2026-11-01');
        expect(localDateIn('America/Los_Angeles', UTC('2026-11-01T05:00:00Z'))).toBe('2026-10-31');
        expect(localDateIn('UTC', UTC('2026-12-31T23:59:59Z'))).toBe('2026-12-31');
    });
});

describe('запоминание наборов параметров', () => {
    it('«сегодня» в набор не входит: тот же набор в другой день - одна запись', () => {
        const { warmer } = make();

        track(warmer, { month: '2026-10', today: '2026-10-30' });
        track(warmer, { month: '2026-10', today: '2026-10-31' });

        const sets = warmer.trackedSets();
        expect(sets).toHaveLength(1);
        expect(sets[0].today).toBe('2026-10-31');
        expect(sets[0].params).toEqual({ month: '2026-10', timeRange: 'month', account: null, category: null, type: null });
    });

    it('analytics в набор не входит: запросы с 0 и с 1 - одна запись', () => {
        const { warmer } = make();

        track(warmer, { month: '2026-10', today: '2026-10-31' });
        warmer.track(parseDashboardQuery({ month: '2026-10', today: '2026-10-31', analytics: '0' }).params, DUBAI);

        expect(warmer.trackedSets()).toHaveLength(1);
    });

    it(`помнит не больше ${MAX_TRACKED} последних наборов, самый давний вытесняется`, () => {
        const { warmer } = make();
        const accounts = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];

        accounts.forEach(account => track(warmer, { month: '2026-10', today: '2026-10-31', account }));

        const kept = warmer.trackedSets().map(set => set.params.account);
        expect(kept).toEqual(['b', 'c', 'd', 'e', 'f', 'g']);
        // Повторный запрос переставляет набор в конец.
        track(warmer, { month: '2026-10', today: '2026-10-31', account: 'b' });
        expect(warmer.trackedSets().map(set => set.params.account).at(-1)).toBe('b');
    });

    it('неизвестный часовой пояс отбрасывается, набор остаётся без зоны', () => {
        const { warmer } = make();

        track(warmer, { month: '2026-10', today: '2026-10-31' }, 'Mars/Olympus');
        track(warmer, { month: '2026-09', today: '2026-10-31' }, 'x'.repeat(200));
        track(warmer, { month: '2026-08', today: '2026-10-31' }, null);

        expect(warmer.trackedSets().map(set => set.tz)).toEqual([null, null, null]);
    });

    it('при LEDGER_CACHE=off ничего не запоминает', () => {
        const { warmer } = make({ enabled: false });

        track(warmer, { month: '2026-10', today: '2026-10-31' });

        expect(warmer.trackedSets()).toEqual([]);
    });
});

describe('parseDashboardQuery: tz', () => {
    it('проверяет зону, не включает её в параметры сводки и не влияет на ключ ответа', () => {
        const base = { month: '2026-10', today: '2026-10-31' };

        const withZone = parseDashboardQuery({ ...base, tz: 'Europe/Nicosia' });
        const withoutZone = parseDashboardQuery(base);

        expect(withZone.tz).toBe('Europe/Nicosia');
        expect(withZone.params).toEqual(withoutZone.params);
        expect(JSON.stringify(withZone.params)).toBe(JSON.stringify(withoutZone.params));
        expect(Object.keys(withZone.params)).not.toContain('tz');
        expect(parseDashboardQuery({ ...base, tz: 'Not/AZone' })).toMatchObject({ tz: null, params: withoutZone.params });
        expect(parseDashboardQuery({ ...base, tz: '' }).tz).toBeNull();
        expect(parseDashboardQuery({ ...base, tz: ['UTC'] }).tz).toBeNull();
        expect(parseDashboardQuery({ ...base, tz: 'x'.repeat(100) }).tz).toBeNull();
    });
});

describe('смена суток', () => {
    it('до полуночи в зоне клиента ничего не греет', () => {
        const { warmer, scheduled } = make({ now: UTC('2026-10-31T19:00:00Z') });
        track(warmer, { month: '2026-10', today: '2026-10-31' });

        warmer.checkDayRollover();

        expect(scheduled).toHaveLength(0);
    });

    it('после полуночи в зоне греет набор на новые сутки и переводит текущий месяц на новый', () => {
        const { warmer, responseMemo, clock, drain, computed } = make({ now: UTC('2026-10-31T19:00:00Z') });
        track(warmer, { month: '2026-10', today: '2026-10-31' });
        track(warmer, { month: '2026-10', today: '2026-10-31', account: 'acc-1' });
        clock.time = UTC('2026-10-31T20:05:00Z');

        warmer.checkDayRollover();
        drain();

        expect(computed.map(item => [item.params.month, item.params.today, item.params.account])).toEqual([
            ['2026-11', '2026-11-01', null],
            ['2026-11', '2026-11-01', 'acc-1']
        ]);
        // Ровно то, что завтра утром спросит клиент: ответ уже в памяти.
        expect(isReady(responseMemo, 1, { month: '2026-11', today: '2026-11-01' })).toBe(true);
        expect(isReady(responseMemo, 1, { month: '2026-11', today: '2026-11-01', account: 'acc-1' })).toBe(true);
    });

    it('в пределах месяца месяц остаётся прежним, меняется только «сегодня»', () => {
        const { warmer, responseMemo, clock, drain, computed } = make({ now: UTC('2026-10-14T19:00:00Z') });
        track(warmer, { month: '2026-10', today: '2026-10-14' });
        clock.time = UTC('2026-10-14T21:00:00Z');

        warmer.checkDayRollover();
        drain();

        expect(computed.map(item => [item.params.month, item.params.today])).toEqual([['2026-10', '2026-10-15']]);
        expect(isReady(responseMemo, 1, { month: '2026-10', today: '2026-10-15' })).toBe(true);
    });

    it('выбранный вручную прошлый месяц не переводится на новый', () => {
        const { warmer, clock, drain, computed } = make({ now: UTC('2026-10-31T19:00:00Z') });
        track(warmer, { month: '2026-08', today: '2026-10-31' });
        clock.time = UTC('2026-10-31T21:00:00Z');

        warmer.checkDayRollover();
        drain();

        expect(computed.map(item => [item.params.month, item.params.today])).toEqual([['2026-08', '2026-11-01']]);
    });

    it('переход через год', () => {
        const { warmer, clock, drain, computed } = make({ now: UTC('2026-12-31T19:00:00Z') });
        track(warmer, { month: '2026-12', today: '2026-12-31' });
        clock.time = UTC('2026-12-31T20:30:00Z');

        warmer.checkDayRollover();
        drain();

        expect(computed.map(item => [item.params.month, item.params.today])).toEqual([['2027-01', '2027-01-01']]);
    });

    it('набор греется один раз за сутки: повторная проверка ничего не делает', () => {
        const { warmer, clock, drain, scheduled, compute } = make({ now: UTC('2026-10-31T19:00:00Z') });
        track(warmer, { month: '2026-10', today: '2026-10-31' });
        clock.time = UTC('2026-10-31T21:00:00Z');

        warmer.checkDayRollover();
        drain();
        warmer.checkDayRollover();

        expect(scheduled).toHaveLength(0);
        expect(compute).toHaveBeenCalledTimes(1);
        // И следующие сутки он снова находит сам: набор помнит новые сутки и месяц.
        clock.time = UTC('2026-11-01T21:00:00Z');
        warmer.checkDayRollover();
        drain();
        expect(compute).toHaveBeenCalledTimes(2);
        expect(warmer.trackedSets()[0]).toMatchObject({ today: '2026-11-02', params: { month: '2026-11' } });
    });

    it('набор без зоны сутки не отслеживает', () => {
        const { warmer, clock, scheduled } = make({ now: UTC('2026-10-31T19:00:00Z') });
        track(warmer, { month: '2026-10', today: '2026-10-31' }, null);
        clock.time = UTC('2026-11-02T00:00:00Z');

        warmer.checkDayRollover();

        expect(scheduled).toHaveLength(0);
    });

    it('клиент уже запросил новые сутки сам: ответ готов, пересчитывать нечего, а старый набор схлопывается в новый', () => {
        const { warmer, responseMemo, clock, drain, compute } = make({ now: UTC('2026-10-31T19:00:00Z') });
        track(warmer, { month: '2026-10', today: '2026-10-31' });
        clock.time = UTC('2026-10-31T21:00:00Z');
        // Запрос клиента на новые сутки: роут посчитал ответ и запомнил набор.
        responseMemo.getEntry('dashboard', requestParams({ month: '2026-11', today: '2026-11-01' }).params, 1, () => 'посчитан запросом');
        track(warmer, { month: '2026-11', today: '2026-11-01' });

        warmer.checkDayRollover();
        drain();

        expect(compute).not.toHaveBeenCalled();
        expect(warmer.trackedSets().map(set => [set.params.month, set.today])).toEqual([['2026-11', '2026-11-01']]);
    });
});

describe('фоновое обновление с изменившимися данными', () => {
    it('греет все запомненные наборы под новой версией', () => {
        const { warmer, ledgerCache, responseMemo, drain, computed } = make();
        track(warmer, { month: '2026-10', today: '2026-10-31' });
        track(warmer, { month: '2026-09', today: '2026-10-31', account: 'acc-1' });
        warmer.start();

        ledgerCache.refreshChanged();
        drain();

        expect(computed.map(item => item.version)).toEqual([2, 2]);
        expect(isReady(responseMemo, 2, { month: '2026-10', today: '2026-10-31' })).toBe(true);
        expect(isReady(responseMemo, 2, { month: '2026-09', today: '2026-10-31', account: 'acc-1' })).toBe(true);
    });

    it('набор с зоной греется на текущие сутки в этой зоне', () => {
        const { warmer, ledgerCache, clock, drain, computed } = make({ now: UTC('2026-10-31T19:00:00Z') });
        track(warmer, { month: '2026-10', today: '2026-10-31' });
        warmer.start();
        clock.time = UTC('2026-10-31T21:00:00Z');

        ledgerCache.refreshChanged();
        drain();

        expect(computed.map(item => [item.params.month, item.params.today])).toEqual([['2026-11', '2026-11-01']]);
    });

    it('набор без зоны греется как просил клиент в последний раз', () => {
        const { warmer, ledgerCache, drain, computed } = make();
        track(warmer, { month: '2026-10', today: '2026-10-30' }, null);
        warmer.start();

        ledgerCache.refreshChanged();
        drain();

        expect(computed.map(item => [item.params.month, item.params.today])).toEqual([['2026-10', '2026-10-30']]);
    });

    it('после остановки на обновления не реагирует', () => {
        const { warmer, ledgerCache, scheduled } = make();
        track(warmer, { month: '2026-10', today: '2026-10-31' });
        warmer.start();
        warmer.stop();

        ledgerCache.refreshChanged();

        expect(scheduled).toHaveLength(0);
    });

    it('обычная запись прогрева не вызывает: кэш будит подписчиков только при изменившемся обновлении', async () => {
        const flush = () => new Promise(resolve => setImmediate(resolve));
        const load = vi.fn(async () => ({ docs: [], accounts: [], categories: [], settings: null }));
        const cache = createLedgerCache({ load, reloadDebounceMs: 0, logger: { warn() {} } });
        const responseMemo = createResponseMemo();
        const computeJson = vi.fn(() => '{}');
        const scheduled = [];
        const warmer = createDashboardWarmer({
            ledgerCache: cache, responseMemo, computeJson, schedule: fn => scheduled.push(fn), setTimer: () => null, logger: { warn() {} }
        });
        warmer.start();
        await cache.get();
        track(warmer, { month: '2026-10', today: '2026-10-31' });

        cache.invalidate();
        await flush();
        await cache.get();
        await flush();

        expect(scheduled).toHaveLength(0);
        expect(computeJson).not.toHaveBeenCalled();
    });
});

describe('как греется', () => {
    it('вне запроса и по одному набору за такт', () => {
        const { warmer, ledgerCache, scheduled, compute } = make();
        track(warmer, { month: '2026-10', today: '2026-10-31' });
        track(warmer, { month: '2026-09', today: '2026-10-31' });
        track(warmer, { month: '2026-08', today: '2026-10-31' });
        warmer.start();

        ledgerCache.refreshChanged();

        // Синхронно ничего не посчитано, в очереди один такт.
        expect(compute).not.toHaveBeenCalled();
        expect(scheduled).toHaveLength(1);
        scheduled.shift()();
        expect(compute).toHaveBeenCalledTimes(1);
        expect(scheduled).toHaveLength(1);
        scheduled.shift()();
        expect(compute).toHaveBeenCalledTimes(2);
        scheduled.shift()();
        expect(compute).toHaveBeenCalledTimes(3);
        expect(scheduled).toHaveLength(0);
        expect(warmer.isBusy()).toBe(false);
    });

    it('новый запрос на прогрев не ставит набор в очередь второй раз', () => {
        const { warmer, ledgerCache, scheduled, drain, compute } = make();
        track(warmer, { month: '2026-10', today: '2026-10-31' });
        warmer.start();

        ledgerCache.refreshChanged();
        ledgerCache.refreshChanged();
        drain();

        // Набор в очереди один; считается он по самому свежему снимку.
        expect(compute).toHaveBeenCalledTimes(1);
        expect(compute.mock.calls[0][0].version).toBe(3);
        expect(scheduled).toHaveLength(0);
    });

    it('уже готовый ответ не пересчитывает', () => {
        const { warmer, ledgerCache, responseMemo, drain, compute } = make();
        track(warmer, { month: '2026-10', today: '2026-10-31' });
        warmer.start();
        responseMemo.getEntry('dashboard', requestParams({ month: '2026-10', today: '2026-10-31' }).params, 1, () => 'готово');

        warmer.warmAll();
        drain();

        expect(compute).not.toHaveBeenCalled();
        expect(ledgerCache.state.snapshot.version).toBe(1);
    });

    it('без снимка в памяти ничего не греет и базу не читает', () => {
        const { warmer, ledgerCache, drain, compute } = make();
        track(warmer, { month: '2026-10', today: '2026-10-31' });
        ledgerCache.state.snapshot = null;

        warmer.warmAll();
        drain();

        expect(compute).not.toHaveBeenCalled();
    });

    it('с выключенным кэшем (LEDGER_CACHE=off) ничего не делает ни на обновление, ни на смену суток', () => {
        const { warmer, ledgerCache, clock, scheduled, compute } = make({ now: UTC('2026-10-31T19:00:00Z') });
        track(warmer, { month: '2026-10', today: '2026-10-31' });
        warmer.start();
        ledgerCache.state.enabled = false;
        clock.time = UTC('2026-11-02T00:00:00Z');

        ledgerCache.refreshChanged();
        warmer.checkDayRollover();
        warmer.warmAll();

        expect(scheduled).toHaveLength(0);
        expect(compute).not.toHaveBeenCalled();
    });

    it('выключили кэш, пока набор стоял в очереди, - такт ничего не считает', () => {
        const { warmer, ledgerCache, scheduled, compute } = make();
        track(warmer, { month: '2026-10', today: '2026-10-31' });
        warmer.warmAll();
        ledgerCache.state.enabled = false;

        scheduled.shift()();

        expect(compute).not.toHaveBeenCalled();
    });

    it('ошибка расчёта не бросается наружу, пишется в лог один раз и не останавливает очередь', () => {
        const computeJson = vi.fn(() => { throw new Error('boom'); });
        const logger = { warn: vi.fn() };
        const { warmer, scheduled } = make({ computeJson, logger });
        track(warmer, { month: '2026-10', today: '2026-10-31' });
        track(warmer, { month: '2026-09', today: '2026-10-31' });

        expect(() => {
            warmer.warmAll();
            while (scheduled.length > 0) scheduled.shift()();
        }).not.toThrow();

        expect(computeJson).toHaveBeenCalledTimes(2);
        expect(logger.warn).toHaveBeenCalledTimes(1);
        expect(warmer.isBusy()).toBe(false);
    });

    it('не бросает и на мусорных входах', () => {
        const { warmer } = make();

        expect(() => {
            warmer.track(undefined, 'UTC');
            warmer.track(null);
            warmer.track({}, 5);
        }).not.toThrow();
    });
});

describe('таймер', () => {
    it('проверка суток раз в несколько минут, не держит процесс (unref), останавливается', () => {
        const timer = { unref: vi.fn() };
        const setTimer = vi.fn(() => timer);
        const clearTimer = vi.fn();
        const { warmer } = make({ setTimer, clearTimer });

        warmer.start();
        warmer.start();

        expect(setTimer).toHaveBeenCalledTimes(1);
        expect(setTimer.mock.calls[0][1]).toBe(DAY_CHECK_INTERVAL_MS);
        expect(DAY_CHECK_INTERVAL_MS).toBeGreaterThanOrEqual(5 * 60 * 1000);
        expect(DAY_CHECK_INTERVAL_MS).toBeLessThanOrEqual(10 * 60 * 1000);
        expect(timer.unref).toHaveBeenCalled();
        warmer.stop();
        expect(clearTimer).toHaveBeenCalledWith(timer);
    });

    it('срабатывание таймера проверяет смену суток', () => {
        const setTimer = vi.fn();
        const { warmer, clock, scheduled } = make({ now: UTC('2026-10-31T19:00:00Z'), setTimer });
        track(warmer, { month: '2026-10', today: '2026-10-31' });
        warmer.start();
        clock.time = UTC('2026-10-31T21:00:00Z');

        setTimer.mock.calls[0][0]();

        expect(scheduled).toHaveLength(1);
    });
});
