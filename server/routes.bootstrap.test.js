// @vitest-environment node
//
// GET /api/bootstrap на настоящей базе: стартовый снимок приложения одним
// ответом. Главное свойство - каждое поле побайтно равно ответу «своего»
// роута, иначе клиент, разбирающий их прежним кодом, получил бы другие данные,
// чем при запуске по частям.

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { connectTestDb, disconnectTestDb, clearCollections, loginAgent, tx, DB_HOOK_TIMEOUT } from './test/harness.js';

let app;
let agent;
let Account;
let Category;
let Settings;
let Transaction;
let responseMemo;

beforeAll(async () => {
    app = await connectTestDb('routes-bootstrap');
    agent = await loginAgent(app);
    Account = mongoose.model('Account');
    Category = mongoose.model('Category');
    Settings = mongoose.model('Settings');
    Transaction = mongoose.model('Transaction');
    responseMemo = app.locals.responseMemo;
}, DB_HOOK_TIMEOUT);

afterAll(disconnectTestDb, DB_HOOK_TIMEOUT);
afterEach(() => vi.unstubAllEnvs());

let card;
let cash;

beforeEach(async () => {
    await clearCollections();
    // Порядок вставки нарочно не совпадает с order: роут обязан отсортировать.
    cash = await Account.create({ name: 'Наличные', type: 'cash', order: 2 });
    card = await Account.create({ name: 'Мой Revolut', type: 'card', order: 1, excludeFromTotal: false });
    await Category.create([
        { name: 'Продукты', type: 'expense', order: 2 },
        { name: 'Зарплата', type: 'income', order: 1 },
        { name: 'Транспорт', type: 'expense', order: 1 }
    ]);
    await Settings.create({ monthlyLimit: 5432, singletonKey: 'global' });
    await Transaction.create([
        tx({ type: 'income', amount: 1000, category: 'Зарплата', account: String(card._id), date: '2026-08-01T00:00:00.000Z' }),
        tx({ type: 'expense', amount: 300, category: 'Продукты', account: String(card._id), date: '2026-08-03T00:00:00.000Z' }),
        tx({ type: 'expense', amount: 50, category: 'Транспорт', account: String(cash._id), date: '2026-08-12T00:00:00.000Z' })
    ]);
});

const QUERY = 'month=2026-08&timeRange=month&today=2026-08-15&analytics=0';
const bootstrap = (query = QUERY) => agent.get(`/api/bootstrap?${query}`);

describe('GET /api/bootstrap', () => {
    it('отдает четыре поля, равные ответам отдельных роутов', async () => {
        const res = await bootstrap();
        const [accounts, categories, settings, dashboard] = await Promise.all([
            agent.get('/api/accounts'),
            agent.get('/api/categories'),
            agent.get('/api/settings'),
            agent.get(`/api/stats/dashboard?${QUERY}`)
        ]);

        expect(res.status).toBe(200);
        expect(Object.keys(res.body)).toEqual(['accounts', 'categories', 'settings', 'dashboard']);
        expect(res.body.accounts).toEqual(accounts.body);
        expect(res.body.categories).toEqual(categories.body);
        expect(res.body.settings).toEqual(settings.body);
        expect(res.body.dashboard).toEqual(dashboard.body);
        // Не только «равны по значению»: порядок и состав те же.
        expect(res.body.accounts.map(account => account.name)).toEqual(['Мой Revolut', 'Наличные']);
        expect(res.body.categories.map(category => category.name)).toEqual(['Транспорт', 'Продукты', 'Зарплата']);
        expect(res.body.settings.monthlyLimit).toBe(5432);
        expect(res.body.settings.features).toBeDefined();
        expect(res.body.dashboard.balances.total).toBe(650);
    });

    it('поля побайтно совпадают с ответами роутов (строка JSON, а не только значения)', async () => {
        const res = await bootstrap();
        const accounts = await agent.get('/api/accounts');
        const categories = await agent.get('/api/categories');
        const settings = await agent.get('/api/settings');
        const dashboard = await agent.get(`/api/stats/dashboard?${QUERY}`);

        expect(res.text).toBe(`{"accounts":${accounts.text},"categories":${categories.text},`
            + `"settings":${settings.text},"dashboard":${dashboard.text}}`);
    });

    it('учитывает параметры сводки так же, как /api/stats/dashboard', async () => {
        const query = `month=2026-08&timeRange=year&today=2026-08-15&analytics=1&account=${cash._id}`;

        const res = await bootstrap(query);
        const dashboard = await agent.get(`/api/stats/dashboard?${query}`);

        expect(res.status).toBe(200);
        expect(res.body.dashboard).toEqual(dashboard.body);
        expect(res.body.dashboard.comparison).toBeDefined();
        expect(res.body.dashboard.period.expense).toBe(-50);
    });

    it('без параметров работает с теми же значениями по умолчанию, что и сводка', async () => {
        const res = await bootstrap('');

        expect(res.status).toBe(200);
        expect(res.body.dashboard.month).toBeDefined();
    });

    it('отвечает 400 на некорректные month и today, как сводка', async () => {
        for (const query of ['month=2026-8', 'today=15.08.2026']) {
            const res = await bootstrap(query);
            const dashboard = await agent.get(`/api/stats/dashboard?${query}`);
            expect(res.status, query).toBe(400);
            expect(res.body, query).toEqual(dashboard.body);
        }
    });

    it('не кэшируется (no-store) и отдает Server-Timing с db, calc, cache и total', async () => {
        const res = await bootstrap();

        expect(res.headers['cache-control']).toBe('no-store');
        expect(res.headers['content-type']).toMatch(/^application\/json; charset=utf-8$/);
        expect(res.headers['server-timing']).toMatch(
            /^db;dur=\d+\.\d, calc;dur=\d+\.\d, cache;desc=(hit|miss|stale), total;dur=\d+\.\d$/
        );
    });

    it('сводка берется из той же памяти ответов, что и /api/stats/dashboard', async () => {
        await bootstrap();
        const computes = responseMemo.stats().computes;

        const dashboard = await agent.get(`/api/stats/dashboard?${QUERY}`);
        const again = await bootstrap();

        expect(dashboard.status).toBe(200);
        expect(again.status).toBe(200);
        expect(responseMemo.stats().computes).toBe(computes);
        expect(again.headers['server-timing']).toMatch(/cache;desc=hit/);
    });

    it('после записи видит новые данные сразу', async () => {
        const before = await bootstrap();
        expect(before.body.dashboard.balances.total).toBe(650);

        await agent.post('/api/transactions').send(tx({
            type: 'expense', amount: 100, category: 'Продукты', account: String(card._id), date: '2026-08-05T00:00:00.000Z'
        }));

        const after = await bootstrap();
        expect(after.body.dashboard.balances.total).toBe(550);
    });

    it('без настроек в базе отдает лимит по умолчанию, как /api/settings', async () => {
        await Settings.deleteMany({});

        const res = await bootstrap();
        const settings = await agent.get('/api/settings');

        expect(res.status).toBe(200);
        expect(res.body.settings).toEqual(settings.body);
        expect(res.body.settings.monthlyLimit).toBe(7000);
    });

    it('флаги функций берутся из окружения, как в /api/settings', async () => {
        vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
        const settings = await agent.get('/api/settings');

        const res = await bootstrap();

        expect(settings.body.features.ask).toBe(true);
        expect(res.body.settings).toEqual(settings.body);
    });

    it('несколько наборов настроек - 409 с тем же сообщением, что у /api/settings', async () => {
        await Settings.deleteMany({});
        await Settings.create([{ monthlyLimit: 4000 }, { monthlyLimit: 8000 }]);

        const res = await bootstrap();
        const settings = await agent.get('/api/settings');

        expect(res.status).toBe(409);
        expect(res.body).toEqual(settings.body);
        expect(res.body.message).toMatch(/несколько наборов настроек/i);
    });

    it('с LEDGER_CACHE=off отвечает так же', async () => {
        const withCache = await bootstrap();
        vi.stubEnv('LEDGER_CACHE', 'off');

        const off = await bootstrap();

        expect(off.status).toBe(200);
        expect(off.body).toEqual(withCache.body);
    });

    it('без входа - 401', async () => {
        const res = await request(app).get(`/api/bootstrap?${QUERY}`);

        expect(res.status).toBe(401);
    });
});
