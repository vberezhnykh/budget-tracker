// @vitest-environment node
//
// Роуты счетов и настроек на настоящей базе.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { connectTestDb, disconnectTestDb, clearCollections, loginAgent, tx, DB_HOOK_TIMEOUT } from './test/harness.js';

let app;
let agent;
let Account;
let Transaction;
let Settings;

beforeAll(async () => {
    app = await connectTestDb('routes-accounts');
    agent = await loginAgent(app);
    Account = mongoose.model('Account');
    Transaction = mongoose.model('Transaction');
    Settings = mongoose.model('Settings');
}, DB_HOOK_TIMEOUT);

afterAll(disconnectTestDb, DB_HOOK_TIMEOUT);
beforeEach(clearCollections);

describe('DELETE /api/accounts/:id', () => {
    it('удаляет счёт, по которому не было операций', async () => {
        const account = await Account.create({ name: 'Старый вклад', type: 'card', order: 1 });

        const res = await agent.delete(`/api/accounts/${account._id}`);

        expect(res.status).toBe(200);
        expect(await Account.countDocuments()).toBe(0);
    });

    it('не даёт удалить счёт, по которому есть операции', async () => {
        // Иначе операции остались бы висеть на несуществующем счёте: остаток
        // по нему больше нигде не показывается, а из общего капитала деньги
        // при этом не исчезают.
        const account = await Account.create({ name: 'Мой Revolut', type: 'card', order: 1 });
        await Transaction.create(tx({ account: account._id.toString() }));

        const res = await agent.delete(`/api/accounts/${account._id}`);

        expect(res.status).toBe(400);
        expect(res.body.message).toBe('Нельзя удалить счёт, по которому есть транзакции');
        expect(await Account.countDocuments()).toBe(1);
    });

    it('считает и переводы, пришедшие на счёт: ссылка через toAccount тоже держит', async () => {
        // У перевода счёт-получатель лежит в toAccount, а не в account.
        // Проверка только по account пропустила бы такой счёт к удалению.
        const target = await Account.create({ name: 'Наличные', type: 'cash', order: 1 });
        await Transaction.create(tx({
            type: 'transfer',
            category: undefined,
            account: 'acc-другой',
            toAccount: target._id.toString()
        }));

        const res = await agent.delete(`/api/accounts/${target._id}`);

        expect(res.status).toBe(400);
        expect(await Account.countDocuments()).toBe(1);
    });

    it('отвечает 400 на нечитаемый идентификатор и 404 на несуществующий', async () => {
        expect((await agent.delete('/api/accounts/не-objectid')).status).toBe(400);

        const missing = new mongoose.Types.ObjectId();
        expect((await agent.delete(`/api/accounts/${missing}`)).status).toBe(404);
    });
});

describe('POST /api/accounts', () => {
    it('ставит новый счёт в конец и подбирает иконку по типу', async () => {
        await Account.create({ name: 'Мой Revolut', type: 'card', order: 3 });

        const res = await agent.post('/api/accounts').send({ name: 'Копилка', type: 'cash' });

        expect(res.status).toBe(200);
        expect(res.body.order).toBe(4);
        expect(res.body.icon).toBe('💵');
        expect(res.body.isDefault).toBe(false);
    });

    it('отвергает счёт с уже занятым именем', async () => {
        await Account.create({ name: 'Наличные', type: 'cash', order: 1 });

        const res = await agent.post('/api/accounts').send({ name: 'Наличные', type: 'cash' });

        expect(res.status).toBe(400);
        expect(res.body.message).toBe('Счёт с таким именем уже существует');
        expect(await Account.countDocuments()).toBe(1);
    });

    it('требует имя и тип', async () => {
        expect((await agent.post('/api/accounts').send({ name: 'Копилка' })).status).toBe(400);
        expect((await agent.post('/api/accounts').send({ type: 'cash' })).status).toBe(400);
    });

    it('заводит замороженный счёт, когда передан excludeFromTotal', async () => {
        const res = await agent.post('/api/accounts').send({
            name: 'Залог за квартиру',
            type: 'card',
            excludeFromTotal: true
        });

        expect(res.status).toBe(200);
        expect(res.body.excludeFromTotal).toBe(true);
    });
});

describe('PUT /api/accounts/:id', () => {
    it('переписывает только переданные поля', async () => {
        const account = await Account.create({
            name: 'Мой Revolut', type: 'card', icon: '💳', order: 2, excludeFromTotal: false
        });

        const res = await agent.put(`/api/accounts/${account._id}`).send({ name: 'Revolut' });

        expect(res.status).toBe(200);
        const saved = await Account.findById(account._id);
        expect(saved.name).toBe('Revolut');
        expect(saved.icon).toBe('💳');
        expect(saved.order).toBe(2);
    });

    it('умеет снимать заморозку: false доезжает до документа', async () => {
        // Отдельная проверка потому, что поле обновляется через
        // `!== undefined`, а не через истинность: на `if (excludeFromTotal)`
        // снять заморозку было бы невозможно.
        const account = await Account.create({
            name: 'Залог', type: 'card', order: 1, excludeFromTotal: true
        });

        await agent.put(`/api/accounts/${account._id}`).send({ excludeFromTotal: false });

        expect((await Account.findById(account._id)).excludeFromTotal).toBe(false);
    });

    it('умеет ставить нулевой порядок', async () => {
        // Та же ловушка, что и выше: order обновляется по `!== undefined`,
        // и ноль - законное значение, а не «не передали».
        const account = await Account.create({ name: 'Наличные', type: 'cash', order: 4 });

        await agent.put(`/api/accounts/${account._id}`).send({ order: 0 });

        expect((await Account.findById(account._id)).order).toBe(0);
    });

    it('отвергает переименование в занятое имя', async () => {
        await Account.create({ name: 'Наличные', type: 'cash', order: 1 });
        const account = await Account.create({ name: 'Мой Revolut', type: 'card', order: 2 });

        const res = await agent.put(`/api/accounts/${account._id}`).send({ name: 'Наличные' });

        expect(res.status).toBe(400);
        expect(res.body.message).toBe('Счёт с таким именем уже существует');
        expect((await Account.findById(account._id)).name).toBe('Мой Revolut');
    });
});

describe('GET /api/accounts', () => {
    it('отдаёт счета в заданном порядке', async () => {
        await Account.create([
            { name: 'Наличные', type: 'cash', order: 4 },
            { name: 'Мой Revolut', type: 'card', order: 1 }
        ]);

        const res = await agent.get('/api/accounts');

        expect(res.body.map(a => a.name)).toEqual(['Мой Revolut', 'Наличные']);
    });
});

describe('Настройки', () => {
    it('до первого сохранения отдаёт значение по умолчанию, не создавая документ', async () => {
        const res = await agent.get('/api/settings');

        expect(res.status).toBe(200);
        expect(res.body.monthlyLimit).toBe(7000);
        expect(await Settings.countDocuments()).toBe(0);
    });

    it('первое сохранение создаёт единственный документ, второе его обновляет', async () => {
        await agent.put('/api/settings').send({ monthlyLimit: 5000 });
        await agent.put('/api/settings').send({ monthlyLimit: 6500 });

        expect(await Settings.countDocuments()).toBe(1);
        expect((await agent.get('/api/settings')).body.monthlyLimit).toBe(6500);
    });

    it('повторные сохранения не плодят документов', async () => {
        for (const monthlyLimit of [5000, 6000, 7500]) {
            await agent.put('/api/settings').send({ monthlyLimit });
        }

        expect(await Settings.countDocuments()).toBe(1);
        expect((await agent.get('/api/settings')).body.monthlyLimit).toBe(7500);
    });

    it('одновременные первые сохранения создают один канонический документ', async () => {
        const limits = [4100, 4200, 4300, 4400, 4500, 4600];
        const responses = await Promise.all(
            limits.map(monthlyLimit => agent.put('/api/settings').send({ monthlyLimit }))
        );

        expect(responses.every(res => res.status === 200)).toBe(true);
        const documents = await Settings.find({});
        expect(documents).toHaveLength(1);
        expect(documents[0].singletonKey).toBe('global');
        expect(limits).toContain(documents[0].monthlyLimit);
    });

    it('принимает единственный legacy-документ без потери его значения', async () => {
        const legacy = await Settings.create({ monthlyLimit: 4321 });

        const res = await agent.get('/api/settings');

        expect(res.status).toBe(200);
        expect(res.body.monthlyLimit).toBe(4321);
        const adopted = await Settings.findOne({ singletonKey: 'global' });
        expect(adopted._id.toString()).toBe(legacy._id.toString());
        expect(await Settings.countDocuments()).toBe(1);
    });

    it('принимает legacy-документ с singletonKey: null', async () => {
        const legacy = await Settings.create({ monthlyLimit: 5432, singletonKey: null });

        const res = await agent.get('/api/settings');

        expect(res.status).toBe(200);
        expect(res.body.monthlyLimit).toBe(5432);
        const adopted = await Settings.findById(legacy._id);
        expect(adopted.singletonKey).toBe('global');
    });

    it('явно отказывается выбирать между несколькими legacy-документами', async () => {
        await Settings.create([
            { monthlyLimit: 4000 },
            { monthlyLimit: 8000 }
        ]);

        const read = await agent.get('/api/settings');
        const write = await agent.put('/api/settings').send({ monthlyLimit: 6000 });

        expect(read.status).toBe(409);
        expect(write.status).toBe(409);
        expect(read.body.message).toMatch(/несколько наборов настроек/i);
        const documents = await Settings.find({}).sort({ monthlyLimit: 1 }).lean();
        expect(documents.map(doc => doc.monthlyLimit)).toEqual([4000, 8000]);
        expect(documents.every(doc => doc.singletonKey === undefined)).toBe(true);
    });

    it('отвергает значения, на которых лимит на фронте превращается в NaN% или Infinity%', async () => {
        for (const monthlyLimit of [0, -100, 'много', '', null, undefined]) {
            const res = await agent.put('/api/settings').send({ monthlyLimit });
            expect(res.status, String(monthlyLimit)).toBe(400);
        }

        // JSON `1e999` разбирается в Infinity, а не в ошибку разбора -
        // поэтому отдельным сырым телом, минуя сериализацию.
        const infinite = await agent.put('/api/settings')
            .set('Content-Type', 'application/json')
            .send('{"monthlyLimit": 1e999}');
        expect(infinite.status).toBe(400);

        expect(await Settings.countDocuments()).toBe(0);
    });
});
