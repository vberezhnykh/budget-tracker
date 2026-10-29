// @vitest-environment node
//
// Прогрев готовых ответов сводки на настоящей базе: после смены суток в зоне
// клиента и после фонового обновления с другими данными первый же запрос
// приложения находит ответ готовым (memo hit, расчёта нет). Логика наборов и
// таймера проверена на подставных часах в dashboardWarmer.test.js; здесь -
// что прогретый ключ совпадает с тем, который ищет настоящий роут.

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import mongoose from 'mongoose';
import { connectTestDb, disconnectTestDb, clearCollections, loginAgent, tx, DB_HOOK_TIMEOUT } from './test/harness.js';
import { createDashboardWarmer } from './dashboardWarmer.js';
import { computeDashboardJson, parseDashboardQuery } from './dashboardRequest.js';

let app;
let agent;
let Account;
let Transaction;
let ledgerCache;
let responseMemo;
let appWarmer;

beforeAll(async () => {
    app = await connectTestDb('routes-warmer');
    agent = await loginAgent(app);
    Account = mongoose.model('Account');
    Transaction = mongoose.model('Transaction');
    ledgerCache = app.locals.ledgerCache;
    responseMemo = app.locals.responseMemo;
    appWarmer = app.locals.dashboardWarmer;
}, DB_HOOK_TIMEOUT);

afterAll(disconnectTestDb, DB_HOOK_TIMEOUT);

let cardId;

beforeEach(async () => {
    await clearCollections();
    appWarmer.clear();
    const card = await Account.create({ name: 'Карта', type: 'card', order: 1 });
    cardId = String(card._id);
    await Transaction.create([
        tx({ type: 'income', amount: 1000, category: 'Зарплата', account: cardId, date: '2026-10-01T00:00:00.000Z' }),
        tx({ type: 'expense', amount: 100, category: 'Продукты', account: cardId, date: '2026-10-20T00:00:00.000Z' })
    ]);
});

afterEach(() => {
    appWarmer.stop();
    appWarmer.clear();
});

const TZ = 'Asia/Dubai';
const query = (extra = {}) => new URLSearchParams({ timeRange: 'month', analytics: '1', tz: TZ, ...extra }).toString();
const bootstrap = (extra) => agent.get(`/api/bootstrap?${query(extra)}`);
const timing = (res, name) => Number(new RegExp(`${name};dur=([\\d.]+)`).exec(res.headers['server-timing'])?.[1]);
const memoState = (res) => /memo;desc=(\w+)/.exec(res.headers['server-timing'] || '')?.[1];
const cacheState = (res) => /cache;desc=(\w+)/.exec(res.headers['server-timing'] || '')?.[1];
const idle = () => new Promise(resolve => setImmediate(resolve));
async function untilIdle(warmer) {
    for (let i = 0; i < 200 && warmer.isBusy(); i += 1) await idle();
    expect(warmer.isBusy()).toBe(false);
}

describe('запросы запоминают набор параметров и часовой пояс', () => {
    it('bootstrap и сводка запоминают набор без «сегодня» и без analytics', async () => {
        await bootstrap({ month: '2026-10', today: '2026-10-29' });
        await agent.get(`/api/stats/dashboard?${query({ month: '2026-10', today: '2026-10-29', account: cardId, analytics: '0' })}`);

        const sets = appWarmer.trackedSets();

        expect(sets.map(set => set.params.account)).toEqual([null, cardId]);
        expect(sets.every(set => set.tz === TZ && set.today === '2026-10-29')).toBe(true);
    });

    it('неизвестная зона игнорируется, запрос обслуживается как без неё', async () => {
        const res = await bootstrap({ month: '2026-10', today: '2026-10-29', tz: 'Mars/Olympus' });

        expect(res.status).toBe(200);
        expect(appWarmer.trackedSets().map(set => set.tz)).toEqual([null]);
    });

    it('tz не входит в ключ ответа: тот же запрос с другой зоной и без неё - готовый ответ', async () => {
        const first = await bootstrap({ month: '2026-10', today: '2026-10-29' });
        const other = await bootstrap({ month: '2026-10', today: '2026-10-29', tz: 'Europe/Nicosia' });
        const none = await agent.get(`/api/bootstrap?${new URLSearchParams({ month: '2026-10', today: '2026-10-29', timeRange: 'month', analytics: '1' })}`);

        expect(memoState(first)).toBe('miss');
        expect(memoState(other)).toBe('hit');
        expect(memoState(none)).toBe('hit');
        expect(other.text).toBe(first.text);
    });

    it('запрос с ошибкой в параметрах ничего не запоминает', async () => {
        const res = await bootstrap({ month: '2026-9', today: '2026-10-29' });

        expect(res.status).toBe(400);
        expect(appWarmer.trackedSets()).toEqual([]);
    });
});

describe('смена суток: ответ на новый день готов до первого запроса', () => {
    it('первый запуск нового дня - memo hit, расчёта нет', async () => {
        // Вчерашний запуск: набор запомнен вместе с зоной.
        await bootstrap({ month: '2026-10', today: '2026-10-31' });
        const clock = { time: Date.parse('2026-10-31T19:00:00Z') };
        const warmer = createDashboardWarmer({
            ledgerCache, responseMemo, computeJson: computeDashboardJson, now: () => clock.time, setTimer: () => null
        });
        for (const set of appWarmer.trackedSets()) {
            warmer.track({ ...set.params, today: set.today }, set.tz);
        }
        expect(warmer.trackedSets()).toHaveLength(1);

        // Наступили новые сутки в Дубае (и новый месяц).
        clock.time = Date.parse('2026-10-31T20:10:00Z');
        warmer.checkDayRollover();
        await untilIdle(warmer);

        const computes = responseMemo.stats().computes;
        const morning = await bootstrap({ month: '2026-11', today: '2026-11-01' });

        expect(morning.status).toBe(200);
        expect(cacheState(morning)).toBe('hit');
        expect(memoState(morning)).toBe('hit');
        expect(responseMemo.stats().computes).toBe(computes);
        expect(timing(morning, 'calc')).toBeLessThan(2);
        expect(timing(morning, 'db')).toBeLessThan(5);
        // И это настоящий ответ, а не заглушка: он равен посчитанному заново.
        responseMemo.clear();
        const recomputed = await bootstrap({ month: '2026-11', today: '2026-11-01' });
        expect(memoState(recomputed)).toBe('miss');
        expect(recomputed.text).toBe(morning.text);
    });

    it('без прогрева тот же запрос считает ответ (контроль, что тест различает)', async () => {
        await bootstrap({ month: '2026-10', today: '2026-10-31' });

        const morning = await bootstrap({ month: '2026-11', today: '2026-11-01' });

        expect(memoState(morning)).toBe('miss');
    });

    it('набор с фильтром по счёту и год греются теми же ключами', async () => {
        await bootstrap({ month: '2026-10', today: '2026-10-31', account: cardId });
        await bootstrap({ month: '2026-10', today: '2026-10-31', timeRange: 'year' });
        const clock = { time: Date.parse('2026-10-31T19:00:00Z') };
        const warmer = createDashboardWarmer({
            ledgerCache, responseMemo, computeJson: computeDashboardJson, now: () => clock.time, setTimer: () => null
        });
        for (const set of appWarmer.trackedSets()) warmer.track({ ...set.params, today: set.today }, set.tz);

        clock.time = Date.parse('2026-10-31T21:00:00Z');
        warmer.checkDayRollover();
        await untilIdle(warmer);

        const byAccount = await bootstrap({ month: '2026-11', today: '2026-11-01', account: cardId });
        const year = await bootstrap({ month: '2026-11', today: '2026-11-01', timeRange: 'year' });
        expect(memoState(byAccount)).toBe('hit');
        expect(memoState(year)).toBe('hit');
    });

    it('разобранные параметры прогрева равны разобранным параметрам запроса', () => {
        const fromRequest = parseDashboardQuery({ month: '2026-11', timeRange: 'month', today: '2026-11-01', analytics: '1', tz: TZ }).params;
        const warmed = [];
        const warmer = createDashboardWarmer({
            ledgerCache: { isEnabled: () => true, peek: () => ({ version: 1 }), onRefreshChanged: () => () => {} },
            responseMemo: { getEntry: (group, params) => warmed.push(JSON.stringify(params)) },
            computeJson: () => '{}',
            now: () => Date.parse('2026-10-31T21:00:00Z'),
            schedule: fn => fn(),
            setTimer: () => null
        });
        warmer.track({ month: '2026-10', timeRange: 'month', today: '2026-10-31' }, TZ);

        warmer.checkDayRollover();

        expect(warmed).toEqual([JSON.stringify(fromRequest)]);
    });
});

describe('фоновое обновление с изменившимися данными', () => {
    const age = (ms) => { ledgerCache.peek().loadedAt -= ms; };
    const settle = () => new Promise(resolve => setTimeout(resolve, 400));

    it('после правки вне сервера ответ под новой версией готов к следующему запросу', async () => {
        appWarmer.start();
        await bootstrap({ month: '2026-10', today: '2026-10-29' });
        // Как скрипт из server/*.js: драйвером напрямую, кэш об этом не знает.
        await Transaction.collection.insertOne({
            title: 'скрипт', amount: 50, type: 'expense', category: 'Продукты', account: cardId, date: new Date('2026-10-21T00:00:00.000Z')
        });
        age(24 * 60 * 60 * 1000);

        const stale = await bootstrap({ month: '2026-10', today: '2026-10-29' });
        expect(cacheState(stale)).toBe('stale');
        expect(stale.body.dashboard.balances.total).toBe(900);
        await settle();

        const computes = responseMemo.stats().computes;
        const fresh = await bootstrap({ month: '2026-10', today: '2026-10-29' });
        expect(cacheState(fresh)).toBe('hit');
        expect(memoState(fresh)).toBe('hit');
        expect(fresh.body.dashboard.balances.total).toBe(850);
        expect(responseMemo.stats().computes).toBe(computes);
    });

    it('обычная запись через сервер ничего не греет: ответ считает следующий запрос', async () => {
        appWarmer.start();
        await bootstrap({ month: '2026-10', today: '2026-10-29' });
        const computes = responseMemo.stats().computes;

        const created = await agent.post('/api/transactions').send(tx({
            type: 'expense', amount: 10, category: 'Продукты', account: cardId, date: '2026-10-22T00:00:00.000Z'
        }));
        expect(created.status).toBe(200);
        await settle();

        expect(responseMemo.stats().computes).toBe(computes);
        const next = await bootstrap({ month: '2026-10', today: '2026-10-29' });
        expect(memoState(next)).toBe('miss');
        expect(next.body.dashboard.balances.total).toBe(890);
    });

    it('при LEDGER_CACHE=off прогрева нет', async () => {
        process.env.LEDGER_CACHE = 'off';
        try {
            appWarmer.start();
            await bootstrap({ month: '2026-10', today: '2026-10-29' });

            expect(appWarmer.trackedSets()).toEqual([]);
            appWarmer.warmAll();
            expect(appWarmer.isBusy()).toBe(false);
        } finally {
            delete process.env.LEDGER_CACHE;
        }
    });
});
