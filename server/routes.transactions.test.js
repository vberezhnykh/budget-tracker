// @vitest-environment node
//
// Роуты операций на настоящей базе. Разбор тела и параметров уже покрыт
// юнит-тестами (transactionInput.test.js, transactionQuery.test.js) - здесь
// проверяется то, чего они не видят: что именно легло в документ, что из
// него исчезло и что вернула выборка.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { connectTestDb, disconnectTestDb, clearCollections, loginAgent, tx, DB_HOOK_TIMEOUT } from './test/harness.js';

let app;
let agent;
let Transaction;
let Account;

beforeAll(async () => {
    app = await connectTestDb('routes-transactions');
    agent = await loginAgent(app);
    Transaction = mongoose.model('Transaction');
    Account = mongoose.model('Account');
}, DB_HOOK_TIMEOUT);

afterAll(disconnectTestDb, DB_HOOK_TIMEOUT);
beforeEach(clearCollections);

describe('Transaction schema: базовые инварианты', () => {
    it('дублирует критичные проверки для записей вне HTTP route', async () => {
        await expect(Transaction.create(tx({ type: 'expense', amount: -1 }))).rejects.toThrow();
        await expect(Transaction.create(tx({
            type: 'transfer', category: undefined, account: 'acc-1', toAccount: 'acc-1'
        }))).rejects.toThrow();

        const initial = await Transaction.create(tx({ type: 'initial', amount: -100 }));
        expect(initial.amount).toBe(-100);
    });
});

describe('PUT /api/transactions/:id: что доезжает до документа', () => {
    it('не записывает тип вне перечисления и оставляет документ прежним', async () => {
        // findByIdAndUpdate схему по умолчанию не применяет, поэтому раньше
        // сюда проходил любой тип. Тип вне enum на фронте молча попадает в
        // «минус»: знак суммы выводится из типа (см. transformTransactions).
        const created = await Transaction.create(tx({ type: 'expense', amount: 100 }));

        const res = await agent.put(`/api/transactions/${created._id}`).send({ type: 'магия', __v: 0 });

        expect(res.status).toBe(400);
        const saved = await Transaction.findById(created._id);
        expect(saved.type).toBe('expense');
        expect(saved.amount).toBe(100);
    });

    it('не записывает нулевую, отрицательную или составную сумму', async () => {
        const created = await Transaction.create(tx({ amount: 100 }));

        for (const amount of [0, -50, [1]]) {
            const res = await agent.put(`/api/transactions/${created._id}`).send({ amount, __v: 0 });
            expect(res.status).toBe(400);
        }

        expect((await Transaction.findById(created._id)).amount).toBe(100);
    });

    it('частичное обновление не затирает непереданные поля', async () => {
        const created = await Transaction.create(tx({
            title: 'Лидл',
            amount: 100,
            category: 'Продукты',
            description: 'по акции',
            account: 'acc-1'
        }));

        const res = await agent.put(`/api/transactions/${created._id}`).send({ amount: 250, __v: 0 });

        expect(res.status).toBe(200);
        const saved = await Transaction.findById(created._id);
        expect(saved.amount).toBe(250);
        expect(saved.title).toBe('Лидл');
        expect(saved.category).toBe('Продукты');
        expect(saved.description).toBe('по акции');
        expect(saved.account).toBe('acc-1');
    });

    it('снимает toAccount с операции, переставшей быть переводом', async () => {
        // Ради этого $set и $unset собираются явно: у перевода, переделанного
        // в расход, «куда» осталось бы от прежней жизни, а частичное
        // обновление отсутствующие в теле поля не трогает. Проверяем не
        // значение, а отсутствие ключа в документе - null или пустая строка
        // тут были бы такими же ложными данными.
        const created = await Transaction.create(tx({
            type: 'transfer',
            category: undefined,
            account: 'card',
            toAccount: 'acc-2'
        }));

        const res = await agent.put(`/api/transactions/${created._id}`)
            .send({ type: 'expense', category: 'Продукты', __v: 0 });

        expect(res.status).toBe(200);
        const raw = await Transaction.collection.findOne({ _id: created._id });
        expect(raw).not.toHaveProperty('toAccount');
        expect(raw.type).toBe('expense');
    });

    it('игнорирует toAccount, присланный вместе с не-переводом', async () => {
        const created = await Transaction.create(tx({
            type: 'transfer',
            category: undefined,
            toAccount: 'acc-2'
        }));

        await agent.put(`/api/transactions/${created._id}`)
            .send({ type: 'expense', category: 'Продукты', toAccount: 'acc-3', __v: 0 });

        const raw = await Transaction.collection.findOne({ _id: created._id });
        expect(raw).not.toHaveProperty('toAccount');
    });

    it('оставляет toAccount на месте, когда у перевода меняют только сумму', async () => {
        const created = await Transaction.create(tx({
            type: 'transfer',
            category: undefined,
            toAccount: 'acc-2'
        }));

        const res = await agent.put(`/api/transactions/${created._id}`).send({ amount: 999, __v: 0 });

        expect(res.status).toBe(200);
        const saved = await Transaction.findById(created._id);
        expect(saved.toAccount).toBe('acc-2');
        expect(saved.amount).toBe(999);
    });

    it('проверяет итоговое состояние при смене типа', async () => {
        const expense = await Transaction.create(tx({ type: 'expense' }));
        const toTransfer = await agent.put(`/api/transactions/${expense._id}`)
            .send({ type: 'transfer', __v: 0 });
        expect(toTransfer.status).toBe(400);

        const transfer = await Transaction.create(tx({
            type: 'transfer', category: undefined, toAccount: 'acc-2'
        }));
        const toExpense = await agent.put(`/api/transactions/${transfer._id}`)
            .send({ type: 'expense', __v: 0 });
        expect(toExpense.status).toBe(400);

        expect((await Transaction.findById(expense._id)).type).toBe('expense');
        expect((await Transaction.findById(transfer._id)).type).toBe('transfer');
    });

    it('не разрешает сделать перевод самому себе частичным обновлением', async () => {
        const transfer = await Transaction.create(tx({
            type: 'transfer', category: undefined, account: 'acc-1', toAccount: 'acc-2'
        }));

        const res = await agent.put(`/api/transactions/${transfer._id}`).send({ toAccount: 'acc-1', __v: 0 });

        expect(res.status).toBe(400);
        expect((await Transaction.findById(transfer._id)).toAccount).toBe('acc-2');
    });

    it('сохраняет дату как UTC-полночь присланного дня', async () => {
        const created = await Transaction.create(tx());

        await agent.put(`/api/transactions/${created._id}`).send({ date: '2026-07-04', __v: 0 });

        const saved = await Transaction.findById(created._id);
        expect(saved.date.toISOString()).toBe('2026-07-04T00:00:00.000Z');
    });

    it('отвечает 400 на нечитаемый идентификатор и 404 на несуществующий', async () => {
        expect((await agent.put('/api/transactions/не-objectid').send({ amount: 5 })).status).toBe(400);

        const missing = new mongoose.Types.ObjectId();
        expect((await agent.put(`/api/transactions/${missing}`).send({ amount: 5 })).status).toBe(404);
    });

    it('пустое тело не ломает запрос: обновлять нечего, документ остаётся прежним', async () => {
        // Пустой $set MongoDB отвергает, поэтому он не должен отправляться
        // вовсе - это отдельный путь в коде, а не теоретический случай.
        const created = await Transaction.create(tx({ amount: 100 }));

        const res = await agent.put(`/api/transactions/${created._id}`).send({ __v: 0 });

        expect(res.status).toBe(200);
        expect((await Transaction.findById(created._id)).amount).toBe(100);
    });

    it('требует версию снимка и отвергает устаревшее обновление', async () => {
        const created = await Transaction.create(tx({ amount: 100 }));

        expect((await agent.put(`/api/transactions/${created._id}`).send({ amount: 150 })).status).toBe(400);
        const fresh = await agent.put(`/api/transactions/${created._id}`).send({ amount: 150, __v: 0 });
        const stale = await agent.put(`/api/transactions/${created._id}`).send({ amount: 200, __v: 0 });

        expect(fresh.status).toBe(200);
        expect(fresh.body.__v).toBe(1);
        expect(stale.status).toBe(409);
        expect((await Transaction.findById(created._id)).amount).toBe(150);
    });

    it('не теряет независимые поля при последовательных свежих обновлениях', async () => {
        const created = await Transaction.create(tx({ amount: 100, description: 'старое' }));

        const first = await agent.put(`/api/transactions/${created._id}`)
            .send({ amount: 150, __v: 0 });
        const second = await agent.put(`/api/transactions/${created._id}`)
            .send({ description: 'новое', __v: first.body.__v });

        expect(first.status).toBe(200);
        expect(second.status).toBe(200);
        expect(second.body.__v).toBe(2);
        const saved = await Transaction.findById(created._id);
        expect(saved.amount).toBe(150);
        expect(saved.description).toBe('новое');
    });

    it('из двух совместно противоречивых патчей применяет только один', async () => {
        const thirdAccount = await Account.create({ name: 'Третий счёт', type: 'card' });
        const thirdAccountId = String(thirdAccount._id);
        const transfer = await Transaction.create(tx({
            type: 'transfer', category: undefined, account: 'card', toAccount: 'cash'
        }));

        const [sourcePatch, destinationPatch] = await Promise.all([
            agent.put(`/api/transactions/${transfer._id}`).send({ account: thirdAccountId, __v: 0 }),
            agent.put(`/api/transactions/${transfer._id}`).send({ toAccount: thirdAccountId, __v: 0 })
        ]);

        expect([sourcePatch.status, destinationPatch.status].sort()).toEqual([200, 409]);
        const saved = await Transaction.findById(transfer._id);
        expect(saved.account).not.toBe(saved.toAccount);
        expect(saved.__v).toBe(1);
    });

    it('считает legacy-документ без __v версией 0 и атомарно добавляет версию', async () => {
        const { insertedId } = await Transaction.collection.insertOne({
            ...tx({ amount: 100 }),
            date: new Date('2026-03-15T00:00:00.000Z')
        });

        const res = await agent.put(`/api/transactions/${insertedId}`).send({ amount: 125, __v: 0 });

        expect(res.status).toBe(200);
        expect(res.body.__v).toBe(1);
        expect((await Transaction.findById(insertedId)).amount).toBe(125);
    });
});

describe('GET /api/transactions: выборка по периоду', () => {
    // Даты с явным Z: границы периода считаются в UTC, и фикстура без зоны
    // уехала бы на день в зависимости от того, где запущен прогон.
    const fixtures = [
        tx({ title: 'февраль', date: '2026-02-28T00:00:00.000Z' }),
        tx({ title: 'первое марта', date: '2026-03-01T00:00:00.000Z' }),
        tx({ title: 'середина марта', date: '2026-03-15T00:00:00.000Z' }),
        tx({ title: 'последнее марта', date: '2026-03-31T00:00:00.000Z' }),
        tx({ title: 'апрель', date: '2026-04-01T00:00:00.000Z' })
    ];

    beforeEach(async () => {
        await Transaction.create(fixtures);
    });

    it('без параметров отдаёт всю историю по убыванию даты', async () => {
        const res = await agent.get('/api/transactions');

        expect(res.status).toBe(200);
        expect(res.body.map(t => t.title)).toEqual([
            'апрель', 'последнее марта', 'середина марта', 'первое марта', 'февраль'
        ]);
        expect(res.headers['x-total-count']).toBe('5');
    });

    it('границы месяца включающие с обеих сторон', async () => {
        const res = await agent.get('/api/transactions?from=2026-03&to=2026-03');

        expect(res.status).toBe(200);
        expect(res.body.map(t => t.title).sort()).toEqual(
            ['первое марта', 'последнее марта', 'середина марта'].sort()
        );
    });

    it('границы дня тоже включающие: to=день отдаёт операции этого дня', async () => {
        const res = await agent.get('/api/transactions?from=2026-03-01&to=2026-03-01');

        expect(res.body.map(t => t.title)).toEqual(['первое марта']);
    });

    it('X-Total-Count показывает общее число подходящих, а не размер страницы', async () => {
        const res = await agent.get('/api/transactions?limit=2');

        expect(res.body).toHaveLength(2);
        expect(res.headers['x-total-count']).toBe('5');
    });

    it('skip листает ту же сортировку без пропусков и повторов', async () => {
        const first = await agent.get('/api/transactions?limit=2&skip=0');
        const second = await agent.get('/api/transactions?limit=2&skip=2');

        expect(first.body.map(t => t.title)).toEqual(['апрель', 'последнее марта']);
        expect(second.body.map(t => t.title)).toEqual(['середина марта', 'первое марта']);
        expect(second.headers['x-total-count']).toBe('5');
    });

    it('считает общее число внутри периода, а не по всей истории', async () => {
        const res = await agent.get('/api/transactions?from=2026-03&to=2026-03&limit=1');

        expect(res.body).toHaveLength(1);
        expect(res.headers['x-total-count']).toBe('3');
    });

    it('отвечает 400 на некорректные параметры, не отдавая частичную выборку', async () => {
        for (const query of ['from=март', 'to=2026-13', 'limit=0', 'limit=1.5', 'skip=-1', 'from=2026-05&to=2026-03']) {
            const res = await agent.get(`/api/transactions?${query}`);
            expect(res.status, query).toBe(400);
        }
    });
});

describe('POST /api/transactions', () => {
    it('создаёт операцию и подставляет категорию в название, если его не прислали', async () => {
        const res = await agent.post('/api/transactions').send({
            amount: 42,
            type: 'expense',
            category: 'Продукты',
            account: 'card',
            date: '2026-03-15'
        });

        expect(res.status).toBe(200);
        expect(res.body.title).toBe('Продукты');
        expect(await Transaction.countDocuments()).toBe(1);
    });

    it('вставляет всю группу разделённой операции одним запросом', async () => {
        const res = await agent.post('/api/transactions').send([
            { amount: 30, type: 'expense', category: 'Продукты', account: 'card', date: '2026-03-15', splitId: 'split-1' },
            { amount: 70, type: 'expense', category: 'Красота', account: 'card', date: '2026-03-15', splitId: 'split-1' }
        ]);

        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(2);
        expect(await Transaction.countDocuments({ splitId: 'split-1' })).toBe(2);
    });

    it('отказывает без суммы или без категории и ничего не пишет', async () => {
        const withoutAmount = await agent.post('/api/transactions')
            .send({ type: 'expense', category: 'Продукты', account: 'acc-1', date: '2026-03-15' });
        const withoutCategory = await agent.post('/api/transactions')
            .send({ amount: 42, type: 'expense', account: 'acc-1', date: '2026-03-15' });

        expect(withoutAmount.status).toBe(400);
        expect(withoutCategory.status).toBe(400);
        expect(await Transaction.countDocuments()).toBe(0);
    });

    it('переводу категория не нужна', async () => {
        const res = await agent.post('/api/transactions').send({
            amount: 42,
            type: 'transfer',
            account: 'card',
            toAccount: 'cash',
            date: '2026-03-15',
            title: 'Перевод'
        });

        expect(res.status).toBe(200);
        expect(res.body.toAccount).toBe('cash');
    });

    it('принимает отрицательный начальный остаток', async () => {
        const res = await agent.post('/api/transactions').send({
            amount: -250,
            type: 'initial',
            category: 'Начальный баланс',
            account: 'cash',
            date: '2026-03-15'
        });

        expect(res.status).toBe(200);
        expect(res.body.amount).toBe(-250);
    });

    it('отклоняет отрицательные движения, пустой счёт и некорректный перевод', async () => {
        const bodies = [
            { amount: -1, type: 'expense', category: 'Продукты', account: 'acc-1', date: '2026-03-15' },
            { amount: [1], type: 'expense', category: 'Продукты', account: 'acc-1', date: '2026-03-15' },
            { amount: 1, type: 'expense', category: 'Продукты', date: '2026-03-15' },
            { amount: 1, type: 'transfer', title: 'Перевод', account: 'acc-1', date: '2026-03-15' },
            { amount: 1, type: 'transfer', title: 'Перевод', account: 'acc-1', toAccount: 'acc-1', date: '2026-03-15' }
        ];

        for (const body of bodies) {
            expect((await agent.post('/api/transactions').send(body)).status).toBe(400);
        }
        expect(await Transaction.countDocuments()).toBe(0);
    });

    it('применяет те же проверки к каждому элементу пакета', async () => {
        const res = await agent.post('/api/transactions').send([
            { amount: 30, type: 'expense', category: 'Продукты', account: 'acc-1', date: '2026-03-15', splitId: 'split-1' },
            { amount: -70, type: 'expense', category: 'Красота', account: 'acc-1', date: '2026-03-15', splitId: 'split-1' }
        ]);

        expect(res.status).toBe(400);
        expect(await Transaction.countDocuments()).toBe(0);
    });

    it('отказывает на пустом пакете', async () => {
        const res = await agent.post('/api/transactions').send([]);

        expect(res.status).toBe(400);
    });

    it('отклоняет пакет целиком, если хоть один элемент неполон', async () => {
        // Половина разделённой операции в базе хуже, чем её отсутствие:
        // сумма группы перестанет сходиться с чеком.
        const res = await agent.post('/api/transactions').send([
            { amount: 30, type: 'expense', category: 'Продукты', account: 'acc-1', date: '2026-03-15', splitId: 'split-1' },
            { type: 'expense', category: 'Красота', account: 'acc-1', date: '2026-03-15', splitId: 'split-1' }
        ]);

        expect(res.status).toBe(400);
        expect(await Transaction.countDocuments()).toBe(0);
    });
});

describe('DELETE /api/transactions/:id', () => {
    it('по splitId удаляет всю группу, а не одну запись', async () => {
        const [first] = await Transaction.create([
            tx({ title: 'часть 1', splitId: 'split-1' }),
            tx({ title: 'часть 2', splitId: 'split-1' }),
            tx({ title: 'чужая', splitId: 'split-2' }),
            tx({ title: 'одиночная' })
        ]);

        const res = await agent.delete(`/api/transactions/${first._id}?splitId=split-1`);

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ trashId: String(first._id), count: 2 });
        expect(await Transaction.countDocuments({ splitId: 'split-1', deletedAt: { $ne: null } })).toBe(2);
        expect(await Transaction.countDocuments({ deletedAt: null })).toBe(2);
        expect(await Transaction.distinct('deletionBatchId', { splitId: 'split-1' })).toHaveLength(1);
    });

    it('без splitId удаляет ровно одну операцию', async () => {
        const [first] = await Transaction.create([tx({ title: 'первая' }), tx({ title: 'вторая' })]);

        const res = await agent.delete(`/api/transactions/${first._id}`);

        expect(res.status).toBe(200);
        expect(res.body.count).toBe(1);
        expect(await Transaction.countDocuments()).toBe(2);
        expect(await Transaction.countDocuments({ deletedAt: null })).toBe(1);
    });

    it('не удаляет группу, если splitId не принадлежит операции из path', async () => {
        const [first] = await Transaction.create([
            tx({ title: 'группа 1', splitId: 'split-1' }),
            tx({ title: 'группа 2', splitId: 'split-2' })
        ]);

        const res = await agent.delete(`/api/transactions/${first._id}?splitId=split-2`);

        expect(res.status).toBe(400);
        expect(await Transaction.countDocuments()).toBe(2);
    });

    it('не удаляет группу по splitId при несуществующем id', async () => {
        await Transaction.create(tx({ splitId: 'split-1' }));
        const missing = new mongoose.Types.ObjectId();

        const res = await agent.delete(`/api/transactions/${missing}?splitId=split-1`);

        expect(res.status).toBe(404);
        expect(await Transaction.countDocuments()).toBe(1);
    });

    it('отвечает 400 на нечитаемый идентификатор и 404 на несуществующий', async () => {
        expect((await agent.delete('/api/transactions/не-objectid')).status).toBe(400);

        const missing = new mongoose.Types.ObjectId();
        expect((await agent.delete(`/api/transactions/${missing}`)).status).toBe(404);
    });
});
