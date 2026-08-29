// @vitest-environment node
//
// Роуты сводки, поиска и подсказок на настоящей базе.
//
// Сама арифметика уже сверена с клиентской в analytics.test.js и
// periodStats.test.js - повторять её здесь незачем. Проверяется то, чего те
// тесты не видят: что роут действительно читает базу, что параметры из
// строки запроса доезжают до функций, что наружу не утекает список операций
// и что все цифры посчитаны по одному снимку истории.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { connectTestDb, disconnectTestDb, clearCollections, loginAgent, tx, DB_HOOK_TIMEOUT } from './test/harness.js';

let app;
let agent;
let Account;
let Transaction;

let card;
let cash;

beforeAll(async () => {
    app = await connectTestDb('routes-dashboard');
    agent = await loginAgent(app);
    Account = mongoose.model('Account');
    Transaction = mongoose.model('Transaction');
}, DB_HOOK_TIMEOUT);

afterAll(disconnectTestDb, DB_HOOK_TIMEOUT);

beforeEach(async () => {
    await clearCollections();
    card = await Account.create({ name: 'Мой Revolut', type: 'card', order: 1 });
    cash = await Account.create({ name: 'Наличные', type: 'cash', order: 2 });

    await Transaction.create([
        tx({ type: 'income', amount: 1000, category: 'Зарплата', account: card._id.toString(), date: '2026-07-05T00:00:00.000Z' }),
        tx({ type: 'expense', amount: 200, category: 'Продукты', description: 'Лидл', account: card._id.toString(), date: '2026-07-10T00:00:00.000Z' }),
        tx({ type: 'expense', amount: 300, category: 'Продукты', description: 'Лидл', account: card._id.toString(), date: '2026-08-03T00:00:00.000Z' }),
        tx({ type: 'expense', amount: 50, category: 'Транспорт', account: cash._id.toString(), date: '2026-08-12T00:00:00.000Z' }),
        tx({ type: 'income', amount: 400, category: 'Фриланс', account: card._id.toString(), date: '2026-08-14T00:00:00.000Z' })
    ]);
});

const dashboard = (query = '') => agent.get(`/api/stats/dashboard?today=2026-08-15&month=2026-08${query}`);

describe('GET /api/stats/dashboard', () => {
    it('отдаёт все блоки сводки одним ответом', async () => {
        const res = await dashboard();

        expect(res.status).toBe(200);
        expect(Object.keys(res.body).sort()).toEqual([
            'balances', 'categoryComparison', 'categoryCounts', 'categoryUsage',
            'comparison', 'lifetime', 'month', 'monthlySeries', 'monthlyTotals',
            'period', 'yearly'
        ]);
    });

    it('не отдаёт наружу сами операции - ответ не зависит от размера истории', async () => {
        // Ради этого всё и затевалось: телефон получает сводку, а не всю
        // историю. Список операций отдаётся отдельно и постранично.
        const res = await dashboard();

        const serialized = JSON.stringify(res.body);
        expect(serialized).not.toContain('Лидл');
        expect(res.body.period.transactions).toBeUndefined();
        expect(res.body.month.transactions).toBeUndefined();
    });

    it('читает счета из базы: остатки разложены по типам', async () => {
        // Тип счёта есть только в коллекции счетов - если бы роут её не
        // читал, наличные уехали бы в карты.
        const res = await dashboard();

        expect(res.body.balances.byType).toEqual({ card: 900, cash: -50 });
    });

    it('месяц и период считаются раздельно', async () => {
        // Лимит и прогноз темпа всегда месячные, какой бы период ни был на
        // экране, поэтому нужны оба набора цифр.
        const res = await dashboard('&timeRange=year');

        expect(res.body.month.expense).toBe(-350);
        expect(res.body.period.expense).toBe(-550);
        expect(res.body.month.income).toBe(400);
        expect(res.body.period.income).toBe(1400);
    });

    it('фильтр по счёту доезжает до всех блоков', async () => {
        const res = await dashboard(`&account=${cash._id}`);

        expect(res.body.period.expense).toBe(-50);
        expect(res.body.yearly.expense).toBe(-50);
        expect(res.body.monthlySeries.find(m => m.month === '2026-08').expense).toBe(50);
    });

    it('фильтр по типу счёта разбирается, а не считается идентификатором', async () => {
        const res = await dashboard('&account=type:cash');

        expect(res.body.period.expense).toBe(-50);
    });

    it('фильтр по категории доезжает', async () => {
        const res = await dashboard('&category=Продукты');

        expect(res.body.period.expense).toBe(-300);
        expect(res.body.yearly.expense).toBe(-500);
    });

    it('сравнение обрезает прошлый месяц по присланному «сегодня»', async () => {
        // 15 августа: июль берётся по 15-е, значит покупка 10 июля в счёт, а
        // при today=2026-08-05 - уже нет.
        const till15 = await dashboard();
        const till5 = await agent.get('/api/stats/dashboard?today=2026-08-05&month=2026-08');

        expect(till15.body.comparison.day).toBe(15);
        expect(till15.body.comparison.expense).toBe(200);
        expect(till5.body.comparison.day).toBe(5);
        expect(till5.body.comparison.expense).toBe(0);
    });

    it('ряд по месяцам длиннее на годовом периоде', async () => {
        const month = await dashboard();
        const year = await dashboard('&timeRange=year');

        // Обрезка по первой операции оставляет июль и август в обоих
        // случаях, но окно запрашивается разное.
        expect(month.body.monthlySeries.length).toBeLessThanOrEqual(6);
        expect(year.body.monthlySeries.length).toBeLessThanOrEqual(12);
        expect(month.body.monthlySeries.map(m => m.month)).toEqual(['2026-07', '2026-08']);
    });

    it('частота категорий приходит сразу по обоим типам', async () => {
        // Форма переключается между расходом и доходом без похода на сервер.
        const res = await dashboard();

        expect(res.body.categoryCounts.expense).toEqual({ 'Продукты': 2, 'Транспорт': 1 });
        expect(res.body.categoryCounts.income).toEqual({ 'Зарплата': 1, 'Фриланс': 1 });
    });

    it('счётчик категорий ключуется типом и именем', async () => {
        const res = await dashboard();

        expect(res.body.categoryUsage['expense::Продукты']).toBe(2);
        expect(res.body.categoryUsage['income::Зарплата']).toBe(1);
    });

    it('отвергает нечитаемые month и today', async () => {
        expect((await agent.get('/api/stats/dashboard?month=август')).status).toBe(400);
        expect((await agent.get('/api/stats/dashboard?month=2026-08&today=вчера')).status).toBe(400);
    });

    it('без параметров берёт текущий месяц и сегодняшний день', async () => {
        const res = await agent.get('/api/stats/dashboard');

        expect(res.status).toBe(200);
        expect(res.body.balances).toBeDefined();
    });

    it('на пустой базе отдаёт нули, а не ошибку', async () => {
        await clearCollections();

        const res = await dashboard();

        expect(res.status).toBe(200);
        expect(res.body.balances.total).toBe(0);
        expect(res.body.period).toEqual({ income: 0, expense: 0, categoryTotals: {} });
        // Ряд по месяцам при этом не пустой: обрезка старых месяцев идёт от
        // самой ранней операции, а когда операций нет вовсе, обрезать не по
        // чему - и запрошенное окно отдаётся нулями целиком. Так же ведёт
        // себя клиентская версия.
        expect(res.body.monthlySeries).toHaveLength(6);
        expect(res.body.monthlySeries.every(m => m.income === 0 && m.expense === 0)).toBe(true);
    });
});

describe('GET /api/search', () => {
    it('находит по описанию и отдаёт сгруппированным по дням', async () => {
        const res = await agent.get('/api/search?q=лидл');

        expect(res.status).toBe(200);
        expect(res.body.count).toBe(2);
        expect(Object.keys(res.body.transactions).sort()).toEqual(['2026-07-10', '2026-08-03']);
    });

    it('находит по сумме', async () => {
        const res = await agent.get('/api/search?q=300');

        expect(res.body.count).toBe(1);
    });

    it('фильтры доезжают', async () => {
        const res = await agent.get(`/api/search?q=Продукты&account=${cash._id}`);

        expect(res.body.count).toBe(0);
    });

    it('пустой запрос ничего не находит, а не отдаёт всю историю', async () => {
        // Иначе поиск стал бы ровно тем, от чего уходим, - выгрузкой всего.
        const res = await agent.get('/api/search?q=');

        expect(res.body).toEqual({ transactions: {}, count: 0 });
    });
});

describe('GET /api/suggestions/descriptions', () => {
    it('отдаёт частые комментарии категории', async () => {
        const res = await agent.get('/api/suggestions/descriptions?category=Продукты&type=expense');

        expect(res.status).toBe(200);
        expect(res.body).toEqual(['Лидл']);
    });

    it('без категории отдаёт пустой список', async () => {
        const res = await agent.get('/api/suggestions/descriptions');

        expect(res.body).toEqual([]);
    });

    it('не смешивает одноимённые категории разных типов', async () => {
        await Transaction.create([
            tx({ type: 'expense', amount: 10, category: 'Другое', description: 'аптека', account: card._id.toString() }),
            tx({ type: 'income', amount: 20, category: 'Другое', description: 'кэшбэк', account: card._id.toString() })
        ]);

        expect((await agent.get('/api/suggestions/descriptions?category=Другое&type=expense')).body).toEqual(['аптека']);
        expect((await agent.get('/api/suggestions/descriptions?category=Другое&type=income')).body).toEqual(['кэшбэк']);
    });
});

describe('Гейт', () => {
    it('новые роуты закрыты без куки', async () => {
        const { default: request } = await import('supertest');

        for (const path of ['/api/stats/dashboard', '/api/search?q=x', '/api/suggestions/descriptions?category=x']) {
            expect((await request(app).get(path)).status, path).toBe(401);
        }
    });
});
