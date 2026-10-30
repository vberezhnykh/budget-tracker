// @vitest-environment node
//
// Кэш операций в памяти на настоящей базе: главное свойство - после любой
// записи следующее чтение видит её сразу, как будто кэша нет.
//
// Схема каждого теста одна: прогреть кэш (убедиться по Server-Timing, что
// следующее чтение идёт из памяти), записать, прочитать и увидеть изменение.
// Тест, который не прогрел кэш, ничего не доказывает: без кэша
// «чтение после записи» верно само собой.

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { connectTestDb, disconnectTestDb, clearCollections, loginAgent, tx, DB_HOOK_TIMEOUT } from './test/harness.js';
import { buildHistoryPage, parseHistoryQuery } from './history.js';
import { activeTransactionFilter } from './ledgerState.js';
import { computeBalances } from './stats.js';
import * as ledgerCacheModule from './ledgerCache.js';

let app;
let agent;
let Account;
let Transaction;
let Category;
let Settings;
let ledgerCache;
let responseMemo;

let card;
let cash;
let cardId;
let cashId;

beforeAll(async () => {
    app = await connectTestDb('routes-ledger-cache');
    agent = await loginAgent(app);
    Account = mongoose.model('Account');
    Transaction = mongoose.model('Transaction');
    Category = mongoose.model('Category');
    Settings = mongoose.model('Settings');
    ledgerCache = app.locals.ledgerCache;
    responseMemo = app.locals.responseMemo;
}, DB_HOOK_TIMEOUT);

afterAll(disconnectTestDb, DB_HOOK_TIMEOUT);

beforeEach(async () => {
    await clearCollections();
    card = await Account.create({ name: 'Карта', type: 'card', order: 1 });
    cash = await Account.create({ name: 'Наличные', type: 'cash', order: 2 });
    cardId = String(card._id);
    cashId = String(cash._id);
    await Transaction.create(tx({
        type: 'income', amount: 1000, category: 'Зарплата', account: cardId, date: '2026-08-01T00:00:00.000Z'
    }));
});

afterEach(() => {
    delete process.env.LEDGER_CACHE;
});

const DASHBOARD = '/api/stats/dashboard?today=2026-08-15&month=2026-08';
const dashboard = (extra = '') => agent.get(`${DASHBOARD}${extra}`);
const cacheState = (res) => /cache;desc=(\w+)/.exec(res.headers['server-timing'] || '')?.[1];

// Первое чтение заполняет кэш, второе обязано прийти уже из памяти.
async function warm() {
    const first = await dashboard();
    expect(first.status).toBe(200);
    const second = await dashboard();
    expect(cacheState(second)).toBe('hit');
    return second.body;
}

const expense = (overrides = {}) => tx({
    type: 'expense', amount: 100, category: 'Продукты', account: cardId, date: '2026-08-05T00:00:00.000Z', ...overrides
});

describe('чтение после записи через HTTP API', () => {
    it('POST /api/transactions', async () => {
        const before = await warm();
        expect(before.balances.total).toBe(1000);

        const created = await agent.post('/api/transactions').send(expense());
        expect(created.status).toBe(200);

        const after = await dashboard();
        expect(after.body.balances.total).toBe(900);
        expect(after.body.month.expense).toBe(-100);
    });

    it('PUT /api/transactions/:id', async () => {
        const saved = await Transaction.create(expense());
        const before = await warm();
        expect(before.balances.total).toBe(900);

        const updated = await agent.put(`/api/transactions/${saved._id}`).send({ amount: 400, __v: 0 });
        expect(updated.status).toBe(200);

        expect((await dashboard()).body.balances.total).toBe(600);
    });

    it('DELETE /api/transactions/:id', async () => {
        const saved = await Transaction.create(expense());
        await warm();

        const removed = await agent.delete(`/api/transactions/${saved._id}`);
        expect(removed.status).toBe(200);

        const after = await dashboard();
        expect(after.body.balances.total).toBe(1000);
        expect(after.body.categoryUsage['expense::Продукты']).toBeUndefined();
    });

    it('POST массивом (разделённая покупка)', async () => {
        await warm();
        const history = await agent.get('/api/history?continuous=1&all=1');
        expect(history.body.count).toBe(1);

        const created = await agent.post('/api/transactions').send([
            expense({ amount: 30, splitId: 'split-1', description: 'чек (молоко)' }),
            expense({ amount: 70, splitId: 'split-1', description: 'чек (хлеб)' })
        ]);
        expect(created.status).toBe(200);

        const after = await dashboard();
        expect(after.body.balances.total).toBe(900);
        const historyAfter = await agent.get('/api/history?continuous=1&all=1');
        // Строк две: доход и одна склеенная покупка из двух частей.
        expect(historyAfter.body.count).toBe(2);
        expect(historyAfter.body.transactions['2026-08-05'].items[0].type).toBe('split_group');
    });

    it('корзина: удаление и восстановление', async () => {
        const saved = await Transaction.create(expense());
        await warm();

        await agent.delete(`/api/transactions/${saved._id}`);
        expect((await dashboard()).body.balances.total).toBe(1000);
        const hidden = await agent.get('/api/history?continuous=1&all=1');
        expect(hidden.body.count).toBe(1);
        // Прогреваем снова, чтобы восстановление менялось именно кэш.
        await warm();

        const restored = await agent.post(`/api/trash/${saved._id}/restore`);
        expect(restored.body.count).toBe(1);
        expect(restored.body.transactions.map(row => row._id)).toEqual([String(saved._id)]);

        expect((await dashboard()).body.balances.total).toBe(900);
        expect((await agent.get('/api/history?continuous=1&all=1')).body.count).toBe(2);
    });

    it('корзина: окончательное удаление не возвращает операцию', async () => {
        const saved = await Transaction.create(expense());
        await agent.delete(`/api/transactions/${saved._id}`);
        await warm();

        const removed = await agent.delete(`/api/trash/${saved._id}`);
        expect(removed.status).toBe(200);

        expect((await dashboard()).body.balances.total).toBe(1000);
    });

    it('счета: создание', async () => {
        const before = await warm();
        expect(Object.keys(before.monthlyTotalsByAccount)).not.toContain('новый');

        const created = await agent.post('/api/accounts').send({ name: 'Копилка', type: 'card' });
        expect(created.status).toBe(200);

        const after = await dashboard();
        expect(Object.keys(after.body.monthlyTotalsByAccount)).toContain(created.body._id);
    });

    it('счета: изменение excludeFromTotal меняет капитал', async () => {
        await Transaction.create(expense({ account: cashId, type: 'income', amount: 200, category: 'Зарплата' }));
        const before = await warm();
        expect(before.balances.total).toBe(1200);

        const updated = await agent.put(`/api/accounts/${cashId}`).send({ excludeFromTotal: true });
        expect(updated.status).toBe(200);

        const after = await dashboard();
        expect(after.body.balances.total).toBe(1000);
        expect(after.body.balances.held).toBe(200);
    });

    it('счета: смена порядка видна в снимке', async () => {
        await warm();

        const updated = await agent.put(`/api/accounts/${cashId}`).send({ order: 10 });
        expect(updated.status).toBe(200);

        const { snapshot } = await ledgerCache.get();
        expect(snapshot.accounts.find(a => String(a._id) === cashId).order).toBe(10);
    });

    it('счета: удаление в транзакции', async () => {
        const spare = await Account.create({ name: 'Лишний', type: 'card', order: 3 });
        const before = await warm();
        expect(Object.keys(before.monthlyTotalsByAccount)).toContain(String(spare._id));

        const removed = await agent.delete(`/api/accounts/${spare._id}`);
        expect(removed.status).toBe(200);

        const after = await dashboard();
        expect(Object.keys(after.body.monthlyTotalsByAccount)).not.toContain(String(spare._id));
    });

    it('переименование категории переписывает операции', async () => {
        const category = await Category.create({ name: 'Продукты', type: 'expense', order: 1 });
        await Transaction.create(expense());
        const before = await warm();
        expect(before.categoryUsage['expense::Продукты']).toBe(1);

        const renamed = await agent.put(`/api/categories/${category._id}`).send({ name: 'Еда' });
        expect(renamed.status).toBe(200);
        expect(renamed.body.updatedTransactions).toBe(1);

        const after = await dashboard();
        expect(after.body.categoryUsage['expense::Еда']).toBe(1);
        expect(after.body.categoryUsage['expense::Продукты']).toBeUndefined();
        const search = await agent.get('/api/search?q=Еда');
        expect(search.body.count).toBe(1);
    });

    it('баланс, месячные итоги, поиск и подсказки тоже видят запись сразу', async () => {
        const read = async () => ({
            balances: (await agent.get('/api/stats/balances')).body.total,
            monthly: (await agent.get('/api/stats/monthly')).body['2026-08']?.expense ?? 0,
            search: (await agent.get('/api/search?q=Лидл')).body.count,
            suggestions: (await agent.get('/api/suggestions/descriptions?category=Продукты&type=expense')).body
        });
        expect(await read()).toEqual({ balances: 1000, monthly: 0, search: 0, suggestions: [] });
        expect(cacheState(await agent.get('/api/stats/balances'))).toBe('hit');

        await agent.post('/api/transactions').send(expense({ description: 'Лидл' }));

        expect(await read()).toEqual({ balances: 900, monthly: -100, search: 1, suggestions: ['Лидл'] });
    });
});

describe('запись напрямую через модель (как из любого другого модуля)', () => {
    // Каждая запись - своим способом Mongoose. Ожидание считается из базы, а не
    // зашито: важно, что ответ совпал с базой и при этом изменился.
    let existing;

    beforeEach(async () => {
        existing = await Transaction.create(expense());
    });

    const totalInDatabase = async () => computeBalances(
        await Transaction.find(activeTransactionFilter()).lean(), await Account.find().lean()
    ).total;

    const writes = {
        'Model.create': () => Transaction.create(expense({ amount: 7 })),
        'doc.save() нового': () => new Transaction(expense({ amount: 7 })).save(),
        'doc.save() существующего': async () => { const doc = await Transaction.findById(existing._id); doc.amount = 7; await doc.save(); },
        'insertMany': () => Transaction.insertMany([expense({ amount: 7 }), expense({ amount: 8 })]),
        'updateOne': () => Transaction.updateOne({ _id: existing._id }, { $set: { amount: 7 } }),
        'updateMany': () => Transaction.updateMany({ category: 'Продукты' }, { $set: { amount: 7 } }),
        'doc.updateOne': async () => { const doc = await Transaction.findById(existing._id); await doc.updateOne({ $set: { amount: 7 } }); },
        'findOneAndUpdate': () => Transaction.findOneAndUpdate({ _id: existing._id }, { $set: { amount: 7 } }),
        'findByIdAndUpdate': () => Transaction.findByIdAndUpdate(existing._id, { $set: { amount: 7 } }),
        'replaceOne': () => Transaction.replaceOne({ _id: existing._id }, { ...expense({ amount: 7 }) }),
        'findOneAndReplace': () => Transaction.findOneAndReplace({ _id: existing._id }, { ...expense({ amount: 7 }) }),
        'deleteOne': () => Transaction.deleteOne({ _id: existing._id }),
        'doc.deleteOne': async () => { const doc = await Transaction.findById(existing._id); await doc.deleteOne(); },
        'deleteMany': () => Transaction.deleteMany({ category: 'Продукты' }),
        'findOneAndDelete': () => Transaction.findOneAndDelete({ _id: existing._id }),
        'findByIdAndDelete': () => Transaction.findByIdAndDelete(existing._id),
        'bulkWrite': () => Transaction.bulkWrite([
            { updateOne: { filter: { _id: existing._id }, update: { $set: { amount: 7 } } } },
            { insertOne: { document: expense({ amount: 9 }) } }
        ]),
        'счёт: updateOne (excludeFromTotal)': () => Account.updateOne({ _id: card._id }, { $set: { excludeFromTotal: true } }),
        'счёт: save': async () => { const doc = await Account.findById(card._id); doc.excludeFromTotal = true; await doc.save(); },
        'счёт: deleteOne': () => Account.deleteOne({ _id: cash._id }),
        'счёт: insertMany': () => Account.insertMany([{ name: 'Новый', type: 'cash', order: 5 }])
    };

    for (const [name, write] of Object.entries(writes)) {
        it(name, async () => {
            const before = await warm();
            const accountsBefore = Object.keys(before.monthlyTotalsByAccount).join();
            const totalBefore = before.balances.total;

            await write();

            const after = await dashboard();
            expect(after.body.balances.total).toBe(await totalInDatabase());
            expect(after.body.balances.total !== totalBefore
                || Object.keys(after.body.monthlyTotalsByAccount).join() !== accountsBefore).toBe(true);
        });
    }

    it('неудачная запись (нарушение схемы) кэш не ломает', async () => {
        await warm();

        await expect(Transaction.create(expense({ amount: -5 }))).rejects.toThrow();

        const after = await dashboard();
        expect(after.body.balances.total).toBe(900);
    });
});

describe('запись внутри транзакции MongoDB', () => {
    it('снимок, прочитанный до коммита, не переживает коммит', async () => {
        await warm();
        const session = await mongoose.startSession();
        let duringTransaction;
        try {
            await session.withTransaction(async () => {
                await Transaction.create([expense({ amount: 250 })], { session });
                // Хук записи уже отработал, а коммита ещё нет: это чтение
                // заново заполняет кэш данными до коммита.
                duringTransaction = await dashboard();
                expect(cacheState(await dashboard())).toBe('hit');
            });
        } finally {
            await session.endSession();
        }

        expect(duringTransaction.body.balances.total).toBe(1000);
        const after = await dashboard();
        expect(after.body.balances.total).toBe(750);
    });

    it('откат транзакции тоже сбрасывает кэш', async () => {
        await warm();
        const session = await mongoose.startSession();
        try {
            session.startTransaction();
            await Transaction.create([expense({ amount: 250 })], { session });
            await dashboard();
            expect(ledgerCache.peek()).not.toBeNull();

            await session.abortTransaction();
        } finally {
            await session.endSession();
        }

        expect(ledgerCache.peek()).toBeNull();
        expect((await dashboard()).body.balances.total).toBe(1000);
    });

    it('updateMany с сессией, как в переименовании категории', async () => {
        await Transaction.create(expense());
        await warm();
        const session = await mongoose.startSession();
        let duringTransaction;
        try {
            await session.withTransaction(async () => {
                await Transaction.updateMany({ category: 'Продукты' }, { $set: { amount: 5 } }, { session });
                duringTransaction = await dashboard();
            });
        } finally {
            await session.endSession();
        }

        expect(duringTransaction.body.balances.total).toBe(900);
        expect((await dashboard()).body.balances.total).toBe(995);
    });

    it('фоновая перезагрузка не идёт, пока транзакция открыта', async () => {
        await warm();
        const session = await mongoose.startSession();
        try {
            await session.withTransaction(async () => {
                await Transaction.create([expense()], { session });
                await new Promise(resolve => setTimeout(resolve, 400));
                // Пауза дольше RELOAD_DEBOUNCE_MS: без блокировки перезагрузка
                // уже положила бы в кэш данные до коммита.
                expect(ledgerCache.peek()).toBeNull();
            });
        } finally {
            await session.endSession();
        }
        // После коммита перезагрузка идёт сама, и читатель находит тёплый снимок.
        await new Promise(resolve => setTimeout(resolve, 500));
        expect(ledgerCache.peek()).not.toBeNull();
        expect(ledgerCache.peek().docs).toHaveLength(2);
    });
});

describe('Server-Timing и тёплый кэш после записи', () => {
    it('после записи кэш прогревается в фоне, и чтение попадает в память', async () => {
        await warm();

        await agent.post('/api/transactions').send(expense());
        await new Promise(resolve => setTimeout(resolve, 600));

        const res = await dashboard();
        expect(cacheState(res)).toBe('hit');
        expect(res.body.balances.total).toBe(900);
    });

    it('первое чтение - miss, повторное - hit с db около нуля', async () => {
        const first = await dashboard();
        const second = await dashboard();

        expect(cacheState(first)).toBe('miss');
        expect(cacheState(second)).toBe('hit');
        const dbMs = Number(/db;dur=([\d.]+)/.exec(second.headers['server-timing'])[1]);
        expect(dbMs).toBeLessThan(5);
    });
});

describe('запись не через сервер и возраст снимка', () => {
    const { SOFT_TTL_MS } = ledgerCacheModule;

    // Состарить снимок можно только его собственной отметкой: ждать десять минут
    // в тесте нельзя, а фальшивые часы кэша отсюда недоступны.
    const age = (ms) => { ledgerCache.peek().loadedAt -= ms; };
    const settle = () => new Promise(resolve => setTimeout(resolve, 300));

    it('правка в обход Mongoose видна после фонового обновления, а читатель не ждет базу', async () => {
        await warm();
        // Как скрипт из server/*.js: драйвером напрямую, кэш об этом не знает.
        await Transaction.collection.insertOne({
            title: 'скрипт', amount: 100, type: 'expense', category: 'Продукты', account: cardId, date: new Date('2026-08-06T00:00:00.000Z')
        });
        age(24 * 60 * 60 * 1000);

        // Сутки простоя: ответ все равно из памяти, со старыми цифрами.
        const stale = await dashboard();
        expect(cacheState(stale)).toBe('stale');
        expect(stale.body.balances.total).toBe(1000);
        await settle();

        const fresh = await dashboard();
        expect(cacheState(fresh)).toBe('hit');
        expect(fresh.body.balances.total).toBe(900);
    });

    it('правка суммы того же документа (счетчик и _id те же) тоже подхватывается', async () => {
        await warm();
        await Transaction.collection.updateOne({}, { $set: { amount: 400 } });
        age(SOFT_TTL_MS + 1);

        await dashboard();
        await settle();

        expect((await dashboard()).body.balances.total).toBe(400);
    });

    it('обновление без изменений данных не сбрасывает готовые ответы', async () => {
        await warm();
        const version = ledgerCache.getVersion();
        const computes = responseMemo.stats().computes;
        age(SOFT_TTL_MS + 1);

        expect(cacheState(await dashboard())).toBe('stale');
        await settle();

        const again = await dashboard();
        expect(cacheState(again)).toBe('hit');
        expect(ledgerCache.getVersion()).toBe(version);
        expect(responseMemo.stats().computes).toBe(computes);
    });
});

describe('ответы из памяти', () => {
    it('повторная сводка совпадает с первой и отдаётся с теми же заголовками', async () => {
        const first = await dashboard();
        const second = await dashboard();

        expect(second.body).toEqual(first.body);
        expect(second.headers['content-type']).toBe(first.headers['content-type']);
        expect(second.headers['content-type']).toMatch(/^application\/json; charset=utf-8$/);
        expect(second.headers.etag).toBe(first.headers.etag);
        expect(responseMemo.stats().hits).toBeGreaterThanOrEqual(1);
    });

    it('If-None-Match даёт 304, а после записи ETag меняется', async () => {
        const first = await dashboard();

        const notModified = await agent.get(`${DASHBOARD}`).set('If-None-Match', first.headers.etag);
        expect(notModified.status).toBe(304);

        await agent.post('/api/transactions').send(expense());
        const changed = await agent.get(`${DASHBOARD}`).set('If-None-Match', first.headers.etag);
        expect(changed.status).toBe(200);
        expect(changed.headers.etag).not.toBe(first.headers.etag);
    });

    it('параметры, влияющие на ответ, не смешиваются', async () => {
        await Transaction.create([
            expense({ account: cashId, amount: 50 }),
            expense({ amount: 70, date: '2026-03-05T00:00:00.000Z' })
        ]);
        const all = await dashboard();
        const onlyCash = await dashboard(`&account=${cashId}`);
        const year = await dashboard('&timeRange=year');
        const lean = await dashboard('&analytics=0');
        const computesBeforeToday = responseMemo.stats().computes;
        await agent.get('/api/stats/dashboard?today=2026-08-20&month=2026-08');
        // Другое «сегодня» - другой ключ: окна сравнения зависят от него.
        expect(responseMemo.stats().computes).toBe(computesBeforeToday + 1);

        expect(onlyCash.body.period.expense).toBe(-50);
        expect(all.body.period.expense).toBe(-50);
        expect(year.body.period.expense).toBe(-120);
        expect(onlyCash.body.yearly.expense).toBe(-50);
        expect(lean.body.comparison).toBeUndefined();
        expect(all.body.comparison).toBeDefined();
        // Каждый вариант посчитан отдельно, и повтор берётся из памяти.
        const computesBefore = responseMemo.stats().computes;
        await dashboard(`&account=${cashId}`);
        await dashboard('&analytics=0');
        expect(responseMemo.stats().computes).toBe(computesBefore);
    });

    it('одинаковые одновременные запросы считаются один раз', async () => {
        await dashboard();
        await agent.post('/api/transactions').send(expense());
        // Сразу после записи снимка нет; запросы приходят все вместе.
        responseMemo.clear();

        const responses = await Promise.all(Array.from({ length: 6 }, () => dashboard()));

        expect(responses.every(res => res.body.balances.total === 900)).toBe(true);
        expect(responseMemo.stats().computes).toBe(1);
    });

    it('поиск по истории (q) не запоминается и не вытесняет список', async () => {
        await agent.get('/api/history?continuous=1&all=1');
        const sizeBefore = responseMemo.sizeOf('history');

        for (const q of ['а', 'б', 'в', 'г', 'д', 'е', 'ж', 'з', 'и', 'к']) {
            await agent.get(`/api/history?continuous=1&all=1&q=${encodeURIComponent(q)}`);
        }

        expect(responseMemo.sizeOf('history')).toBe(sizeBefore);
    });

    it('снимок не меняется ни одним из маршрутов', async () => {
        await Transaction.create([
            expense({ splitId: 's', description: 'чек (а)' }), expense({ splitId: 's', description: 'чек (б)' }),
            expense({ type: 'transfer', category: undefined, toAccount: cashId })
        ]);
        await warm();
        const serialize = () => JSON.stringify(ledgerCache.peek());
        const before = serialize();

        for (const url of [
            DASHBOARD, `${DASHBOARD}&timeRange=year&account=type:card`,
            '/api/stats/balances', '/api/stats/monthly?account=type:cash', '/api/search?q=чек',
            '/api/suggestions/descriptions?category=Продукты&type=expense',
            '/api/history?continuous=1&all=1', '/api/history?month=2026-08', '/api/history?continuous=1&all=1&q=чек',
            '/api/accounts', '/api/categories', '/api/settings', `/api/bootstrap?${DASHBOARD.split('?')[1]}&analytics=1`
        ]) {
            expect((await agent.get(url)).status, url).toBe(200);
        }

        expect(serialize()).toBe(before);
    });
});

describe('история из снимка совпадает с чтением из базы', () => {
    // Эталон - прежний путь роута: запрос к базе с фильтром и сортировкой.
    async function fromDatabase(query) {
        const options = parseHistoryQuery(query);
        const [docs, accounts] = await Promise.all([
            Transaction.find(activeTransactionFilter(options.filter)).sort({ date: -1, _id: -1 }).lean(),
            Account.find().lean()
        ]);
        return JSON.parse(JSON.stringify(buildHistoryPage(docs, accounts, options)));
    }

    const queries = [
        { continuous: '1', all: '1' },
        { continuous: '1', all: '1', month: '2026-01' },
        { continuous: '1', all: '1', account: 'type:card' },
        { continuous: '1', all: '1', category: 'Продукты', type: 'expense' },
        { continuous: '1', all: '1', q: 'чек' },
        { continuous: '1', month: '2026-08' },
        { continuous: '1', month: '2026-08', limit: '3' },
        { month: '2026-08' },
        { month: '2026-07', account: 'type:card' },
        { month: '2026-08', timeRange: 'year' },
        { month: '2026-08', timeRange: 'lifetime', limit: '4' },
        { month: '2026-09' },
        { month: '2026-08', q: 'Лидл' }
    ];

    beforeEach(async () => {
        await Transaction.create([
            expense({ date: '2026-07-31T00:00:00.000Z', amount: 11 }),
            expense({ date: '2026-08-01T00:00:00.000Z', amount: 12 }),
            // Не полночь: граница месяца считается по полуинтервалу, а не по дню.
            expense({ date: '2026-08-31T23:30:00.000Z', amount: 13 }),
            expense({ date: '2026-09-01T00:00:00.000Z', amount: 14 }),
            expense({ date: '2025-12-31T00:00:00.000Z', amount: 15, category: 'Транспорт' }),
            // Одна дата, много операций: порядок внутри дня решает _id.
            ...Array.from({ length: 5 }, (_, i) => expense({ date: '2026-08-10T00:00:00.000Z', amount: 20 + i, description: 'Лидл' })),
            expense({ date: '2026-08-12T00:00:00.000Z', amount: 30, splitId: 'sp', description: 'чек (а)', companyName: 'Лидл' }),
            expense({ date: '2026-08-12T00:00:00.000Z', amount: 31, splitId: 'sp', description: 'чек (б)', companyName: 'Лидл' }),
            expense({ date: '2026-08-12T00:00:00.000Z', amount: 32, splitId: 'sp', description: 'чек (в)', companyName: 'Лидл' }),
            expense({ date: '2026-08-13T00:00:00.000Z', type: 'transfer', category: undefined, toAccount: cashId, amount: 40 }),
            expense({ date: '2026-08-14T00:00:00.000Z', type: 'income', category: 'Фриланс', amount: 300, account: cashId }),
            expense({ date: '2026-08-14T00:00:00.000Z', excludeFromStats: true, amount: 5 })
        ]);
        // Удалённые в корзину в историю не попадают, ни в базе, ни в снимке.
        const trashed = await Transaction.create(expense({ date: '2026-08-15T00:00:00.000Z', amount: 999 }));
        await agent.delete(`/api/transactions/${trashed._id}`);
        // Документ без даты: в обход Mongoose, поэтому кэш сбрасывается явно.
        await Transaction.collection.insertOne({ title: 'без даты', amount: 1, type: 'expense', category: 'Продукты', account: cardId });
        ledgerCache.reset();
    });

    for (const query of queries) {
        const name = new URLSearchParams(query).toString();

        it(`GET /api/history?${name}`, async () => {
            const expected = await fromDatabase(query);
            const url = `/api/history?${name}`;

            const cold = await agent.get(url);
            const warmed = await agent.get(url);

            expect(cold.status).toBe(200);
            expect(cold.body).toEqual(expected);
            expect(warmed.body).toEqual(expected);
            expect(cacheState(warmed)).toBe('hit');
            expect(cold.headers['cache-control']).toBe('no-store');
        });
    }

    it('пагинация курсорами идёт тем же путём, что и по базе', async () => {
        let cursor = null;
        const seen = [];
        for (let page = 0; page < 20; page += 1) {
            const query = { continuous: '1', month: '2026-09', limit: '4', ...(cursor ? { cursor } : {}) };
            const expected = await fromDatabase(query);
            const res = await agent.get(`/api/history?${new URLSearchParams(query)}`);
            expect(res.body).toEqual(expected);
            seen.push(...Object.values(res.body.transactions).flatMap(group => group.items.map(item => item.id)));
            cursor = res.body.nextCursor;
            if (!cursor) break;
        }
        expect(cursor).toBeNull();
        expect(new Set(seen).size).toBe(seen.length);
    });

    it('с LEDGER_CACHE=off отвечает так же, как и с кэшем', async () => {
        const query = { continuous: '1', all: '1' };
        const withCache = (await agent.get(`/api/history?${new URLSearchParams(query)}`)).body;

        process.env.LEDGER_CACHE = 'off';
        const off = await agent.get(`/api/history?${new URLSearchParams(query)}`);

        expect(off.body).toEqual(withCache);
        expect(off.body).toEqual(await fromDatabase(query));
        expect(cacheState(off)).toBeUndefined();
    });
});

describe('аварийный выключатель LEDGER_CACHE=off', () => {
    it('каждое чтение идёт в базу и видит даже запись в обход Mongoose', async () => {
        process.env.LEDGER_CACHE = 'off';
        const first = await dashboard();
        expect(first.body.balances.total).toBe(1000);
        expect(cacheState(first)).toBeUndefined();

        // Драйвером напрямую, без хуков: с кэшем это осталось бы незамеченным.
        await Transaction.collection.insertOne({
            title: 'Тихая запись', amount: 100, type: 'expense', category: 'Продукты', account: cardId, date: new Date('2026-08-05T00:00:00.000Z'), logoMode: 'auto'
        });

        const second = await dashboard();
        expect(second.body.balances.total).toBe(900);
        expect(ledgerCache.peek()).toBeNull();
        expect(responseMemo.size()).toBe(0);
    });

    it('после выключения возвращается к кэшу без перезапуска', async () => {
        process.env.LEDGER_CACHE = 'off';
        await dashboard();
        delete process.env.LEDGER_CACHE;

        await dashboard();
        expect(cacheState(await dashboard())).toBe('hit');
    });
});

// Счета, категории и настройки лежат в том же снимке, что и операции: запуск
// приложения (GET /api/bootstrap) и три справочных роута не ходят в Atlas,
// пока снимок есть, а любая запись, откуда бы она ни пришла, сбрасывает его.
describe('справочники и настройки в снимке', () => {
    const BOOTSTRAP = `/api/bootstrap?${DASHBOARD.split('?')[1]}&analytics=1`;
    const bootstrap = () => agent.get(BOOTSTRAP);
    const names = (res) => res.body.map(item => item.name);

    beforeEach(async () => {
        await Category.create([
            { name: 'Продукты', type: 'expense', order: 1 },
            { name: 'Транспорт', type: 'expense', order: 2 },
            { name: 'Зарплата', type: 'income', order: 1 }
        ]);
        await Settings.create({ singletonKey: 'global', monthlyLimit: 5000 });
    });

    afterEach(() => vi.restoreAllMocks());

    // Первое чтение заполняет снимок, второе обязано прийти уже из памяти.
    async function warmCatalog() {
        expect((await bootstrap()).status).toBe(200);
        expect(cacheState(await bootstrap())).toBe('hit');
        expect((await agent.get('/api/categories')).status).toBe(200);
    }

    const readsOfDatabase = () => [Account, Category, Settings, Transaction]
        .flatMap(model => ['find', 'findOne', 'countDocuments'].map(name => vi.spyOn(model, name)));

    it('со снимком в памяти bootstrap и три справочных роута не обращаются к базе', async () => {
        await warmCatalog();
        const spies = readsOfDatabase();

        const results = await Promise.all([
            bootstrap(), agent.get('/api/accounts'), agent.get('/api/categories'), agent.get('/api/settings')
        ]);

        results.forEach(res => expect(res.status).toBe(200));
        results.forEach(res => expect(cacheState(res)).toBe('hit'));
        expect(spies.flatMap(spy => spy.mock.calls)).toEqual([]);
        // Время чтения - около нуля, а не 5 мс и тем более не полсекунды Atlas.
        results.forEach(res => expect(Number(/db;dur=([\d.]+)/.exec(res.headers['server-timing'])[1])).toBeLessThan(5));
    });

    it('bootstrap побайтно равен склейке справочных роутов и при тёплом снимке', async () => {
        await warmCatalog();

        const res = await bootstrap();
        const [accounts, categories, settings, dash] = await Promise.all([
            agent.get('/api/accounts'), agent.get('/api/categories'), agent.get('/api/settings'),
            agent.get(`${DASHBOARD}&analytics=1`)
        ]);

        expect(res.text).toBe(`{"accounts":${accounts.text},"categories":${categories.text},`
            + `"settings":${settings.text},"dashboard":${dash.text}}`);
    });

    describe('JSON справочников побайтно равен прежнему ответу документов Mongoose', () => {
        it('счета: порядок, значения по умолчанию, __v', async () => {
            // Старый документ: только обязательные поля, без __v, icon, order и флагов.
            await Account.collection.insertOne({ name: 'Старый', type: 'card' });
            await Account.create({ name: 'Вклад', type: 'card', order: 0, icon: '🏦', excludeFromTotal: true, isDefault: true });
            ledgerCache.reset();

            const res = await agent.get('/api/accounts');
            const fromDocuments = JSON.stringify(await Account.find().sort({ order: 1 }));

            expect(res.status).toBe(200);
            expect(res.text).toBe(fromDocuments);
            expect(res.headers['content-type']).toMatch(/^application\/json; charset=utf-8$/);
            expect(JSON.parse(res.text).find(account => account.name === 'Старый')).toMatchObject({ icon: '💳', order: 0, excludeFromTotal: false });
        });

        it('категории: порядок по типу и order, значения по умолчанию', async () => {
            await Category.collection.insertOne({ name: 'Без порядка', type: 'income' });
            ledgerCache.reset();

            const res = await agent.get('/api/categories');
            const fromDocuments = JSON.stringify(await Category.find().sort({ type: 1, order: 1 }));

            expect(res.status).toBe(200);
            expect(res.text).toBe(fromDocuments);
        });

        it('настройки: тело то же, что давала прежняя сборка', async () => {
            const res = await agent.get('/api/settings');

            expect(res.body.monthlyLimit).toBe(5000);
            expect(Object.keys(res.body)).toEqual(['monthlyLimit', 'features']);
            expect(res.headers['cache-control']).toBe('no-store');
        });
    });

    describe('чтение после записи через HTTP', () => {
        it('категории: создание, переименование, удаление', async () => {
            await warmCatalog();
            expect(names(await agent.get('/api/categories'))).toEqual(['Продукты', 'Транспорт', 'Зарплата']);

            const created = await agent.post('/api/categories').send({ name: 'Кафе', type: 'expense' });
            expect(created.status).toBe(200);
            expect(names(await agent.get('/api/categories'))).toEqual(['Продукты', 'Транспорт', 'Кафе', 'Зарплата']);
            expect((await bootstrap()).body.categories.map(item => item.name)).toContain('Кафе');

            await warmCatalog();
            const renamed = await agent.put(`/api/categories/${created.body._id}`).send({ name: 'Рестораны' });
            expect(renamed.status).toBe(200);
            expect(names(await agent.get('/api/categories'))).toContain('Рестораны');
            expect(names(await agent.get('/api/categories'))).not.toContain('Кафе');
            expect((await bootstrap()).body.categories.map(item => item.name)).toContain('Рестораны');

            await warmCatalog();
            const removed = await agent.delete(`/api/categories/${created.body._id}`);
            expect(removed.status).toBe(200);
            expect(names(await agent.get('/api/categories'))).toEqual(['Продукты', 'Транспорт', 'Зарплата']);
            expect((await bootstrap()).body.categories).toHaveLength(3);
        });

        it('категории: смена порядка записью через модель', async () => {
            await warmCatalog();
            const transport = await Category.findOne({ name: 'Транспорт' });

            await Category.updateOne({ _id: transport._id }, { $set: { order: 0 } });

            expect(names(await agent.get('/api/categories'))).toEqual(['Транспорт', 'Продукты', 'Зарплата']);
            expect((await bootstrap()).body.categories.map(item => item.name)).toEqual(['Транспорт', 'Продукты', 'Зарплата']);
        });

        it('категории: переименование в транзакции видно сразу, и в категориях, и в сводке', async () => {
            await Transaction.create(expense({ category: 'Продукты' }));
            await warmCatalog();
            const food = await Category.findOne({ name: 'Продукты' });

            const renamed = await agent.put(`/api/categories/${food._id}`).send({ name: 'Еда' });
            expect(renamed.status).toBe(200);

            const res = await bootstrap();
            expect(res.body.categories.map(item => item.name)).toContain('Еда');
            expect(res.body.dashboard.categoryUsage['expense::Еда']).toBe(1);
        });

        it('лимит: PUT /api/settings виден в settings и bootstrap', async () => {
            await warmCatalog();
            expect((await agent.get('/api/settings')).body.monthlyLimit).toBe(5000);

            const saved = await agent.put('/api/settings').send({ monthlyLimit: 9100 });
            expect(saved.status).toBe(200);

            expect((await agent.get('/api/settings')).body.monthlyLimit).toBe(9100);
            expect((await bootstrap()).body.settings.monthlyLimit).toBe(9100);
        });

        it('лимит: первая запись создаёт документ, пока в снимке были настройки по умолчанию', async () => {
            await Settings.deleteMany({});
            ledgerCache.reset();
            await warmCatalog();
            expect((await agent.get('/api/settings')).body.monthlyLimit).toBe(7000);

            await agent.put('/api/settings').send({ monthlyLimit: 4200 });

            expect((await agent.get('/api/settings')).body.monthlyLimit).toBe(4200);
            expect((await bootstrap()).body.settings.monthlyLimit).toBe(4200);
        });

        it('счета: создание, правка, удаление', async () => {
            await warmCatalog();
            expect(names(await agent.get('/api/accounts'))).toEqual(['Карта', 'Наличные']);

            const created = await agent.post('/api/accounts').send({ name: 'Копилка', type: 'card' });
            expect(created.status).toBe(200);
            expect(names(await agent.get('/api/accounts'))).toEqual(['Карта', 'Наличные', 'Копилка']);
            expect((await bootstrap()).body.accounts.map(item => item.name)).toContain('Копилка');

            await warmCatalog();
            const updated = await agent.put(`/api/accounts/${created.body._id}`).send({ name: 'Накопления', order: 0, excludeFromTotal: true });
            expect(updated.status).toBe(200);
            const afterUpdate = await agent.get('/api/accounts');
            expect(names(afterUpdate)).toEqual(['Накопления', 'Карта', 'Наличные']);
            expect(afterUpdate.body[0].excludeFromTotal).toBe(true);
            expect((await bootstrap()).body.accounts[0].name).toBe('Накопления');

            await warmCatalog();
            const removed = await agent.delete(`/api/accounts/${created.body._id}`);
            expect(removed.status).toBe(200);
            expect(names(await agent.get('/api/accounts'))).toEqual(['Карта', 'Наличные']);
            expect((await bootstrap()).body.accounts).toHaveLength(2);
        });

        it('запись через модель в обход роутов (как скрипты и засев) тоже сбрасывает', async () => {
            await warmCatalog();

            await Category.create({ name: 'Подарки', type: 'expense', order: 3 });
            await Account.create({ name: 'Копилка', type: 'card', order: 3 });
            await Settings.updateOne({ singletonKey: 'global' }, { $set: { monthlyLimit: 1234 } });

            const res = await bootstrap();
            expect(res.body.categories.map(item => item.name)).toContain('Подарки');
            expect(res.body.accounts.map(item => item.name)).toContain('Копилка');
            expect(res.body.settings.monthlyLimit).toBe(1234);
        });
    });

    describe('целостность настроек', () => {
        const twoSettings = async () => {
            await Settings.deleteMany({});
            await Settings.collection.insertMany([{ monthlyLimit: 4000 }, { monthlyLimit: 8000 }]);
            ledgerCache.reset();
        };

        it('несколько наборов настроек: 409 у /api/settings и /api/bootstrap, остальное работает', async () => {
            await twoSettings();

            const settings = await agent.get('/api/settings');
            const boot = await bootstrap();
            // Повторно уже из снимка: ошибка в нём хранится, а не читается заново.
            const again = await agent.get('/api/settings');

            expect(settings.status).toBe(409);
            expect(settings.body.message).toMatch(/несколько наборов настроек/i);
            expect(boot.status).toBe(409);
            expect(boot.body).toEqual(settings.body);
            expect(again.status).toBe(409);
            expect(cacheState(again)).toBe('hit');
            // Операции, счета и категории от этого не страдают.
            expect((await agent.get('/api/accounts')).status).toBe(200);
            expect((await agent.get('/api/categories')).status).toBe(200);
            expect((await dashboard()).status).toBe(200);
        });

        it('после исправления (удалили лишний набор) ответ снова 200', async () => {
            await twoSettings();
            expect((await agent.get('/api/settings')).status).toBe(409);

            const [extra] = await Settings.find({ monthlyLimit: 8000 });
            await Settings.deleteOne({ _id: extra._id });

            const fixed = await agent.get('/api/settings');
            expect(fixed.status).toBe(200);
            expect(fixed.body.monthlyLimit).toBe(4000);
            expect((await bootstrap()).status).toBe(200);
        });

        it('PUT при нарушенной целостности отвечает 409, как и раньше', async () => {
            await twoSettings();

            const res = await agent.put('/api/settings').send({ monthlyLimit: 100 });

            expect(res.status).toBe(409);
        });

        it('единственный старый документ без ключа принимается, и лимит сохраняется', async () => {
            await Settings.deleteMany({});
            await Settings.collection.insertOne({ monthlyLimit: 3333 });
            ledgerCache.reset();

            const res = await agent.get('/api/settings');

            expect(res.status).toBe(200);
            expect(res.body.monthlyLimit).toBe(3333);
            expect((await Settings.collection.findOne({})).singletonKey).toBe('global');
            // Принятие было записью, и снимок после него снова собирается и отдаёт то же.
            expect((await bootstrap()).body.settings.monthlyLimit).toBe(3333);
            expect(cacheState(await bootstrap())).toBe('hit');
        });
    });

    it('флаги функций берутся из окружения при каждом запросе, а не из снимка', async () => {
        await warmCatalog();
        expect((await agent.get('/api/settings')).body.features.ask).toBe(false);

        vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
        try {
            const settings = await agent.get('/api/settings');
            const boot = await bootstrap();

            expect(cacheState(settings)).toBe('hit');
            expect(settings.body.features.ask).toBe(true);
            expect(boot.body.settings.features.ask).toBe(true);
        } finally {
            vi.unstubAllEnvs();
        }
        expect((await agent.get('/api/settings')).body.features.ask).toBe(false);
    });

    it('с LEDGER_CACHE=off справочники читаются из базы, как до снимка, и совпадают с ответами кэша', async () => {
        const accountsCached = (await agent.get('/api/accounts')).text;
        const categoriesCached = (await agent.get('/api/categories')).text;
        const settingsCached = (await agent.get('/api/settings')).body;
        ledgerCache.reset();
        process.env.LEDGER_CACHE = 'off';
        const find = vi.spyOn(Account, 'find');

        const accounts = await agent.get('/api/accounts');
        const categories = await agent.get('/api/categories');
        const settings = await agent.get('/api/settings');

        expect(accounts.text).toBe(accountsCached);
        expect(categories.text).toBe(categoriesCached);
        expect(settings.body).toEqual(settingsCached);
        expect(find).toHaveBeenCalled();
        expect(cacheState(accounts)).toBeUndefined();
        // Ничего не запомнено: аварийный выключатель остаётся выключателем.
        expect(ledgerCache.peek()).toBeNull();
    });
});

// Готовые ответы и их признак в Server-Timing.
describe('memo в Server-Timing', () => {
    const memoState = (res) => /memo;desc=(\w+)/.exec(res.headers['server-timing'] || '')?.[1];

    it('первый запрос сводки - miss, повторный - hit с calc около нуля', async () => {
        const first = await dashboard();
        const second = await dashboard();

        expect(memoState(first)).toBe('miss');
        expect(memoState(second)).toBe('hit');
        expect(Number(/calc;dur=([\d.]+)/.exec(second.headers['server-timing'])[1])).toBeLessThan(2);
    });

    it('bootstrap и сводка делят готовый ответ: bootstrap после сводки - hit', async () => {
        await dashboard('&analytics=1');

        const boot = await agent.get('/api/bootstrap?today=2026-08-15&month=2026-08&analytics=1');

        expect(memoState(boot)).toBe('hit');
    });

    it('маршруты без готовых ответов записи memo не несут', async () => {
        const res = await agent.get('/api/stats/balances');

        expect(memoState(res)).toBeUndefined();
    });
});
