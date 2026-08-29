// @vitest-environment node
//
// Роуты статистики на настоящей базе.
//
// Сама арифметика уже сверена с клиентской в stats.test.js на общих данных -
// повторять её здесь незачем. Проверяется то, чего тот тест не видит: что
// роут действительно читает счета из базы (а не считает по одним операциям),
// что excludeFromTotal доезжает до подсчёта капитала и что фильтры из строки
// запроса добираются до функции в том виде, в каком их шлёт интерфейс.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { connectTestDb, disconnectTestDb, clearCollections, loginAgent, tx, DB_HOOK_TIMEOUT } from './test/harness.js';

let app;
let agent;
let Account;
let Transaction;

beforeAll(async () => {
    app = await connectTestDb('routes-stats');
    agent = await loginAgent(app);
    Account = mongoose.model('Account');
    Transaction = mongoose.model('Transaction');
}, DB_HOOK_TIMEOUT);

afterAll(disconnectTestDb, DB_HOOK_TIMEOUT);
beforeEach(clearCollections);

describe('GET /api/stats/balances', () => {
    it('раскладывает остатки по типам счетов, взяв типы из базы', async () => {
        // Тип счёта нигде в операции не хранится - он есть только в
        // коллекции счетов. Если бы роут её не читал, всё уехало бы в card
        // по умолчанию, и наличные пропали бы из карусели.
        const card = await Account.create({ name: 'Мой Revolut', type: 'card', order: 1 });
        const cash = await Account.create({ name: 'Наличные', type: 'cash', order: 2 });

        await Transaction.create([
            tx({ type: 'income', amount: 1000, account: card._id.toString(), category: 'Зарплата' }),
            tx({ type: 'expense', amount: 300, account: card._id.toString() }),
            tx({ type: 'income', amount: 500, account: cash._id.toString(), category: 'Подарок' })
        ]);

        const res = await agent.get('/api/stats/balances');

        expect(res.status).toBe(200);
        expect(res.body.byType).toEqual({ card: 700, cash: 500 });
        expect(res.body.byAccount[card._id.toString()]).toBe(700);
        expect(res.body.total).toBe(1200);
    });

    it('выводит замороженный счёт из капитала и показывает его отдельной суммой', async () => {
        const card = await Account.create({ name: 'Мой Revolut', type: 'card', order: 1 });
        const deposit = await Account.create({
            name: 'Залог за квартиру', type: 'card', order: 2, excludeFromTotal: true
        });

        await Transaction.create([
            tx({ type: 'income', amount: 1000, account: card._id.toString(), category: 'Зарплата' }),
            tx({ type: 'income', amount: 2400, account: deposit._id.toString(), category: 'Другое' })
        ]);

        const res = await agent.get('/api/stats/balances');

        expect(res.body.total).toBe(1000);
        expect(res.body.held).toBe(2400);
        expect(res.body.grandTotal).toBe(3400);
        expect(res.body.byType.card).toBe(1000);
    });

    it('учитывает перевод как движение по двум счетам сразу', async () => {
        const from = await Account.create({ name: 'Мой Revolut', type: 'card', order: 1 });
        const to = await Account.create({ name: 'Наличные', type: 'cash', order: 2 });

        await Transaction.create([
            tx({ type: 'income', amount: 1000, account: from._id.toString(), category: 'Зарплата' }),
            tx({
                type: 'transfer',
                amount: 400,
                category: undefined,
                account: from._id.toString(),
                toAccount: to._id.toString()
            })
        ]);

        const res = await agent.get('/api/stats/balances');

        expect(res.body.byType).toEqual({ card: 600, cash: 400 });
        // Перевод не создаёт и не уничтожает денег.
        expect(res.body.total).toBe(1000);
    });

    it('на пустой базе отдаёт нули, а не ошибку', async () => {
        const res = await agent.get('/api/stats/balances');

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ byAccount: {}, byType: { card: 0, cash: 0 }, total: 0, held: 0, grandTotal: 0 });
    });
});

describe('GET /api/stats/monthly', () => {
    let card;
    let cash;

    beforeEach(async () => {
        card = await Account.create({ name: 'Мой Revolut', type: 'card', order: 1 });
        cash = await Account.create({ name: 'Наличные', type: 'cash', order: 2 });

        await Transaction.create([
            tx({ type: 'income', amount: 1000, category: 'Зарплата', account: card._id.toString(), date: '2026-03-05T00:00:00.000Z' }),
            tx({ type: 'expense', amount: 200, category: 'Продукты', account: card._id.toString(), date: '2026-03-10T00:00:00.000Z' }),
            tx({ type: 'expense', amount: 50, category: 'Транспорт', account: cash._id.toString(), date: '2026-03-12T00:00:00.000Z' }),
            tx({ type: 'expense', amount: 300, category: 'Продукты', account: card._id.toString(), date: '2026-04-02T00:00:00.000Z' })
        ]);
    });

    it('разносит доход и расход по месяцам, расход - отрицательным', async () => {
        const res = await agent.get('/api/stats/monthly');

        expect(res.status).toBe(200);
        expect(res.body).toEqual({
            '2026-03': { income: 1000, expense: -250 },
            '2026-04': { income: 0, expense: -300 }
        });
    });

    it('фильтр по конкретному счёту доезжает до подсчёта', async () => {
        const res = await agent.get(`/api/stats/monthly?account=${cash._id}`);

        expect(res.body).toEqual({ '2026-03': { income: 0, expense: -50 } });
    });

    it('фильтр по типу счёта (type:card) разбирается, а не считается идентификатором', async () => {
        // Интерфейс шлёт группу счетов именно так - строкой 'type:cash'.
        // Если бы роут передавал её как есть в сравнение с account, ни одна
        // операция не совпала бы и карточки месяцев опустели бы.
        const res = await agent.get('/api/stats/monthly?account=type:cash');

        expect(res.body).toEqual({ '2026-03': { income: 0, expense: -50 } });
    });

    it('фильтр по категории доезжает до подсчёта', async () => {
        const res = await agent.get('/api/stats/monthly?category=Продукты');

        expect(res.body).toEqual({
            '2026-03': { income: 0, expense: -200 },
            '2026-04': { income: 0, expense: -300 }
        });
    });

    it('пустой параметр фильтра означает «без фильтра», а не «пустой счёт»', async () => {
        const res = await agent.get('/api/stats/monthly?account=&category=');

        expect(Object.keys(res.body).sort()).toEqual(['2026-03', '2026-04']);
    });

    it('не считает переводы и операции, помеченные excludeFromStats', async () => {
        await Transaction.create([
            tx({
                type: 'transfer', amount: 500, category: undefined,
                account: card._id.toString(), toAccount: cash._id.toString(),
                date: '2026-03-20T00:00:00.000Z'
            }),
            tx({
                type: 'expense', amount: 900, category: 'Другое',
                account: card._id.toString(), date: '2026-03-21T00:00:00.000Z',
                excludeFromStats: true
            })
        ]);

        const res = await agent.get('/api/stats/monthly');

        expect(res.body['2026-03']).toEqual({ income: 1000, expense: -250 });
    });
});
