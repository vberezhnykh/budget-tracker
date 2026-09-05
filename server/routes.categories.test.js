// @vitest-environment node
//
// Роуты категорий на настоящей базе. Корневой vitest.config.js даёт всему
// проекту jsdom - роутам он не нужен и только мешает, отсюда докблок выше.
//
// Главное здесь - переименование: категория хранится в операции строкой, а
// не ссылкой, поэтому PUT /api/categories/:id переписывает историю. Ошибка в
// нём не падает и ничего не сообщает - она просто оставляет часть операций
// с прежним названием, и разбивка по категориям тихо разъезжается на две.

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { connectTestDb, disconnectTestDb, clearCollections, loginAgent, tx, DB_HOOK_TIMEOUT } from './test/harness.js';

let app;
let agent;
let Category;
let Transaction;
let PlannedPayment;

beforeAll(async () => {
    app = await connectTestDb('routes-categories');
    agent = await loginAgent(app);
    Category = mongoose.model('Category');
    Transaction = mongoose.model('Transaction');
    PlannedPayment = mongoose.model('PlannedPayment');
}, DB_HOOK_TIMEOUT);

afterAll(disconnectTestDb, DB_HOOK_TIMEOUT);
beforeEach(clearCollections);

describe('PUT /api/categories/:id: переименование каскадом', () => {
    it('переписывает категорию только у операций своего типа', async () => {
        // Одноимённые категории расхода и дохода - законная пара: имя
        // уникально только вместе с типом. Расход «Другое» и доход «Другое»
        // есть в наборе по умолчанию, так что случай не выдуманный.
        const expense = await Category.create({ name: 'Продукты', type: 'expense', order: 1 });
        await Category.create({ name: 'Продукты', type: 'income', order: 1 });

        await Transaction.create([
            tx({ type: 'expense', category: 'Продукты', title: 'Лидл' }),
            tx({ type: 'expense', category: 'Продукты', title: 'Рынок' }),
            tx({ type: 'expense', category: 'Транспорт' }),
            tx({ type: 'income', category: 'Продукты' })
        ]);

        const res = await agent.put(`/api/categories/${expense._id}`).send({ name: 'Еда' });

        expect(res.status).toBe(200);
        expect(res.body.category.name).toBe('Еда');
        expect(res.body.updatedTransactions).toBe(2);

        expect(await Transaction.countDocuments({ type: 'expense', category: 'Еда' })).toBe(2);
        expect(await Transaction.countDocuments({ type: 'expense', category: 'Продукты' })).toBe(0);
        // Доход с тем же названием - чужая категория, его трогать нельзя.
        expect(await Transaction.countDocuments({ type: 'income', category: 'Продукты' })).toBe(1);
        expect(await Transaction.countDocuments({ type: 'expense', category: 'Транспорт' })).toBe(1);
        expect(await Transaction.countDocuments({ type: 'expense', category: 'Еда', __v: 1 })).toBe(2);
    });

    it('не трогает название операции, даже если оно совпадало со старым именем категории', async () => {
        // Заголовок операции подставляется из категории при создании, но
        // дальше это текст пользователя: он мог его отредактировать, и
        // переименование категории не даёт права переписывать его записи.
        const cat = await Category.create({ name: 'Продукты', type: 'expense', order: 1 });
        await Transaction.create(tx({ category: 'Продукты', title: 'Продукты' }));

        await agent.put(`/api/categories/${cat._id}`).send({ name: 'Еда' });

        const saved = await Transaction.findOne();
        expect(saved.category).toBe('Еда');
        expect(saved.title).toBe('Продукты');
    });

    it('на том же имени выходит рано и не трогает историю', async () => {
        const cat = await Category.create({ name: 'Продукты', type: 'expense', order: 1 });
        await Transaction.create(tx({ category: 'Продукты' }));

        const res = await agent.put(`/api/categories/${cat._id}`).send({ name: 'Продукты' });

        expect(res.status).toBe(200);
        expect(res.body.updatedTransactions).toBe(0);
        expect(await Transaction.countDocuments({ category: 'Продукты' })).toBe(1);
    });

    it('обрезает пробелы по краям нового имени', async () => {
        const cat = await Category.create({ name: 'Продукты', type: 'expense', order: 1 });
        await Transaction.create(tx({ category: 'Продукты' }));

        const res = await agent.put(`/api/categories/${cat._id}`).send({ name: '  Еда  ' });

        expect(res.status).toBe(200);
        expect(res.body.category.name).toBe('Еда');
        expect(await Transaction.countDocuments({ category: 'Еда' })).toBe(1);
    });

    it('отвергает переименование в уже занятое имя и оставляет историю нетронутой', async () => {
        // Уникальный индекс { name, type } строится асинхронно; harness.js
        // дожидается его через Model.init(), иначе дубликат просто
        // записался бы и тест был бы зелёным впустую.
        const cat = await Category.create({ name: 'Продукты', type: 'expense', order: 1 });
        await Category.create({ name: 'Транспорт', type: 'expense', order: 2 });
        await Transaction.create(tx({ category: 'Продукты' }));

        const res = await agent.put(`/api/categories/${cat._id}`).send({ name: 'Транспорт' });

        expect(res.status).toBe(400);
        expect(res.body.message).toBe('Такая категория уже существует');
        // Самое важное: раз имя не сменилось, история должна остаться со
        // старым названием - иначе операции указывали бы в пустоту.
        expect(await Transaction.countDocuments({ category: 'Продукты' })).toBe(1);
        expect(await Transaction.countDocuments({ category: 'Транспорт' })).toBe(0);
    });

    it('откатывает имя категории, если второй шаг каскада завершился ошибкой', async () => {
        const cat = await Category.create({ name: 'Продукты', type: 'expense', order: 1 });
        await Transaction.create(tx({ category: 'Продукты' }));
        const failure = vi.spyOn(Transaction, 'updateMany')
            .mockRejectedValueOnce(new Error('forced transaction update failure'));

        let res;
        try {
            res = await agent.put(`/api/categories/${cat._id}`).send({ name: 'Еда' });
        } finally {
            failure.mockRestore();
        }

        expect(res.status).toBe(500);
        expect((await Category.findById(cat._id)).name).toBe('Продукты');
        expect(await Transaction.countDocuments({ category: 'Продукты' })).toBe(1);
        expect(await Transaction.countDocuments({ category: 'Еда' })).toBe(0);
    });

    it('делает открытый снимок операции устаревшим после каскадного переименования', async () => {
        const cat = await Category.create({ name: 'Продукты', type: 'expense', order: 1 });
        const transaction = await Transaction.create(tx({ category: 'Продукты', amount: 100 }));

        expect((await agent.put(`/api/categories/${cat._id}`).send({ name: 'Еда' })).status).toBe(200);
        const stale = await agent.put(`/api/transactions/${transaction._id}`)
            .send({ amount: 200, __v: 0 });

        expect(stale.status).toBe(409);
        const saved = await Transaction.findById(transaction._id);
        expect(saved.category).toBe('Еда');
        expect(saved.amount).toBe(100);
        expect(saved.__v).toBe(1);
    });

    it('меняет планы только вместе с одноимённой expense-категорией', async () => {
        const [incomeCategory, expenseCategory] = await Category.create([
            { name: 'Общее', type: 'income', order: 1 },
            { name: 'Общее', type: 'expense', order: 1 }
        ]);
        const income = await Transaction.create(tx({ type: 'income', category: 'Общее' }));
        const deleted = await Transaction.create(tx({
            category: 'Общее', deletedAt: new Date(), deletionBatchId: 'batch-1'
        }));
        const plan = await PlannedPayment.create({
            title: 'Интернет', amount: 50, dueDate: new Date('2026-04-10T00:00:00.000Z'),
            account: 'card', category: 'Общее'
        });

        const incomeRename = await agent.put(`/api/categories/${incomeCategory._id}`).send({ name: 'Доход' });

        expect(incomeRename.status).toBe(200);
        expect((await Transaction.findById(income._id)).category).toBe('Доход');
        expect((await Transaction.findById(deleted._id)).category).toBe('Общее');
        expect((await PlannedPayment.findById(plan._id)).category).toBe('Общее');
        expect((await PlannedPayment.findById(plan._id)).__v).toBe(0);

        const expenseRename = await agent.put(`/api/categories/${expenseCategory._id}`).send({ name: 'Расход' });

        expect(expenseRename.status).toBe(200);
        expect((await Transaction.findById(deleted._id)).category).toBe('Расход');
        expect((await PlannedPayment.findById(plan._id)).category).toBe('Расход');
        expect((await PlannedPayment.findById(plan._id)).__v).toBe(1);
    });

    it('позволяет занять имя, свободное в своём типе, но занятое в чужом', async () => {
        const expense = await Category.create({ name: 'Продукты', type: 'expense', order: 1 });
        await Category.create({ name: 'Зарплата', type: 'income', order: 1 });

        const res = await agent.put(`/api/categories/${expense._id}`).send({ name: 'Зарплата' });

        expect(res.status).toBe(200);
        expect(res.body.category.name).toBe('Зарплата');
    });

    it('отвечает 400 на нечитаемый идентификатор и 404 на несуществующий', async () => {
        expect((await agent.put('/api/categories/не-objectid').send({ name: 'Еда' })).status).toBe(400);

        const missing = new mongoose.Types.ObjectId();
        expect((await agent.put(`/api/categories/${missing}`).send({ name: 'Еда' })).status).toBe(404);
    });

    it('отвечает 400 на пустое имя и не трогает категорию', async () => {
        const cat = await Category.create({ name: 'Продукты', type: 'expense', order: 1 });

        for (const name of [undefined, '', '   ']) {
            const res = await agent.put(`/api/categories/${cat._id}`).send({ name });
            expect(res.status).toBe(400);
        }

        expect((await Category.findById(cat._id)).name).toBe('Продукты');
    });
});

describe('POST /api/categories', () => {
    it('создаёт категорию и ставит её в конец своего типа', async () => {
        await Category.create({ name: 'Продукты', type: 'expense', order: 7 });

        const res = await agent.post('/api/categories').send({ name: 'Подписки', type: 'expense' });

        expect(res.status).toBe(200);
        expect(res.body.name).toBe('Подписки');
        // order считается по максимуму внутри типа, а не по всей коллекции.
        expect(res.body.order).toBe(8);
    });

    it('нумерует типы независимо друг от друга', async () => {
        await Category.create({ name: 'Продукты', type: 'expense', order: 11 });

        const res = await agent.post('/api/categories').send({ name: 'Дивиденды', type: 'income' });

        expect(res.status).toBe(200);
        expect(res.body.order).toBe(1);
    });

    it('отвергает дубликат внутри типа', async () => {
        await Category.create({ name: 'Продукты', type: 'expense', order: 1 });

        const res = await agent.post('/api/categories').send({ name: 'Продукты', type: 'expense' });

        expect(res.status).toBe(400);
        expect(res.body.message).toBe('Такая категория уже существует');
        expect(await Category.countDocuments()).toBe(1);
    });

    it('требует имя и тип', async () => {
        expect((await agent.post('/api/categories').send({ name: 'Подписки' })).status).toBe(400);
        expect((await agent.post('/api/categories').send({ type: 'expense' })).status).toBe(400);
    });
});

describe('DELETE /api/categories/:id', () => {
    it('удаляет категорию, но не операции с ней', async () => {
        // История - это факты о потраченных деньгах; удаление категории из
        // списка не должно стирать записи о тратах.
        const cat = await Category.create({ name: 'Продукты', type: 'expense', order: 1 });
        await Transaction.create(tx({ category: 'Продукты' }));

        const res = await agent.delete(`/api/categories/${cat._id}`);

        expect(res.status).toBe(200);
        expect(await Category.countDocuments()).toBe(0);
        expect(await Transaction.countDocuments({ category: 'Продукты' })).toBe(1);
    });

    it('отвечает 404 на несуществующую и 400 на нечитаемый идентификатор', async () => {
        const missing = new mongoose.Types.ObjectId();
        expect((await agent.delete(`/api/categories/${missing}`)).status).toBe(404);
        expect((await agent.delete('/api/categories/не-objectid')).status).toBe(400);
    });
});

describe('GET /api/categories', () => {
    it('отдаёт список, сгруппированный по типу и упорядоченный внутри типа', async () => {
        await Category.create([
            { name: 'Транспорт', type: 'expense', order: 2 },
            { name: 'Зарплата', type: 'income', order: 1 },
            { name: 'Продукты', type: 'expense', order: 1 }
        ]);

        const res = await agent.get('/api/categories');

        expect(res.status).toBe(200);
        expect(res.body.map(c => `${c.type}/${c.name}`)).toEqual([
            'expense/Продукты',
            'expense/Транспорт',
            'income/Зарплата'
        ]);
    });
});
