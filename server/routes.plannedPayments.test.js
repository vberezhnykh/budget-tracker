// @vitest-environment node

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { connectTestDb, disconnectTestDb, clearCollections, loginAgent, tx, DB_HOOK_TIMEOUT } from './test/harness.js';

let agent;
let Transaction;
let PlannedPayment;
let Account;

beforeAll(async () => {
    const app = await connectTestDb('routes-planned-payments');
    agent = await loginAgent(app);
    Transaction = mongoose.model('Transaction');
    PlannedPayment = mongoose.model('PlannedPayment');
    Account = mongoose.model('Account');
}, DB_HOOK_TIMEOUT);

afterAll(disconnectTestDb, DB_HOOK_TIMEOUT);
beforeEach(clearCollections);

async function account(name = 'Основной') {
    return Account.create({ name, type: 'card' });
}

function planBody(accountId, overrides = {}) {
    return {
        title: 'Интернет',
        amount: 50,
        dueDate: '2026-04-10',
        account: String(accountId),
        category: 'Жилье',
        description: 'ежемесячный счёт без автоповтора',
        ...overrides
    };
}

async function createPlan(accountId, overrides = {}) {
    return agent.post('/api/planned-payments').send(planBody(accountId, overrides));
}

function payBody(accountId, overrides = {}) {
    return {
        __v: 0,
        date: '2026-04-09',
        amount: 52,
        account: String(accountId),
        category: 'Жилье',
        ...overrides
    };
}

describe('разовые предстоящие платежи', () => {
    it('создание плана не меняет ledger и баланс', async () => {
        const acc = await account();

        const created = await createPlan(acc._id);

        expect(created.status).toBe(201);
        expect(created.body).toMatchObject({ status: 'pending', amount: 50, __v: 0 });
        expect(await Transaction.countDocuments()).toBe(0);
        expect((await agent.get('/api/stats/balances')).body.total).toBe(0);
    });

    it('строго проверяет календарную дату, сумму и ссылку на счёт', async () => {
        const acc = await account();
        expect((await createPlan(acc._id, { dueDate: '2026-02-31' })).status).toBe(400);
        expect((await createPlan(acc._id, { amount: 0 })).status).toBe(400);
        expect((await createPlan('not-an-account')).status).toBe(400);
        await expect(PlannedPayment.create({
            ...planBody(acc._id),
            dueDate: new Date('2026-04-10T12:00:00.000Z')
        })).rejects.toThrow('dueDate must be a UTC calendar day');
        expect(await PlannedPayment.countDocuments()).toBe(0);
    });

    it('поддерживает OCC и переходы pending/skipped, но не оплату skipped', async () => {
        const acc = await account();
        const created = await createPlan(acc._id);

        const changed = await agent.put(`/api/planned-payments/${created.body._id}`)
            .send({ amount: 60, __v: 0 });
        const stale = await agent.put(`/api/planned-payments/${created.body._id}`)
            .send({ amount: 70, __v: 0 });
        const skipped = await agent.put(`/api/planned-payments/${created.body._id}`)
            .send({ status: 'skipped', __v: 1 });
        const paySkipped = await agent.post(`/api/planned-payments/${created.body._id}/pay`)
            .send(payBody(acc._id, { __v: 2 }));
        const reopened = await agent.put(`/api/planned-payments/${created.body._id}`)
            .send({ status: 'pending', __v: 2 });

        expect(changed.status).toBe(200);
        expect(stale.status).toBe(409);
        expect(skipped.status).toBe(200);
        expect(paySkipped.status).toBe(409);
        expect(reopened.status).toBe(200);
        expect(reopened.body).toMatchObject({ status: 'pending', amount: 60, __v: 3 });
    });

    it('одновременная оплата и повтор запроса создают ровно один расход', async () => {
        const acc = await account();
        const created = await createPlan(acc._id);
        const url = `/api/planned-payments/${created.body._id}/pay`;
        const body = payBody(acc._id);

        const responses = await Promise.all([
            agent.post(url).send(body),
            agent.post(url).send(body)
        ]);

        expect(responses.every(response => response.status === 200)).toBe(true);
        expect(responses.map(response => response.body.replayed).sort()).toEqual([false, true]);
        expect(new Set(responses.map(response => response.body.transaction._id)).size).toBe(1);
        expect(await Transaction.countDocuments({ type: 'expense' })).toBe(1);

        const repeated = await agent.post(url).send(body);
        expect(repeated.status).toBe(200);
        expect(repeated.body.replayed).toBe(true);
        expect(await Transaction.countDocuments()).toBe(1);
    });

    it('явно связывает активный расход без дубликата и не отдаёт его второму плану', async () => {
        const acc = await account();
        const expense = await Transaction.create(tx({
            title: 'Фактический платёж', amount: 49, account: String(acc._id)
        }));
        const first = await createPlan(acc._id);
        const second = await createPlan(acc._id, { title: 'Другой план' });

        const linked = await agent.post(`/api/planned-payments/${first.body._id}/pay`)
            .send({ __v: 0, transactionId: String(expense._id) });
        const duplicate = await agent.post(`/api/planned-payments/${second.body._id}/pay`)
            .send({ __v: 0, transactionId: String(expense._id) });

        expect(linked.status).toBe(200);
        expect(linked.body.replayed).toBe(false);
        expect(duplicate.status).toBe(409);
        expect(await Transaction.countDocuments()).toBe(1);
        const unchanged = await Transaction.findById(expense._id);
        expect(unchanged.title).toBe('Фактический платёж');
        expect(unchanged.amount).toBe(49);
    });

    it('не связывает расход из конкурентного удаления и не создаёт замену', async () => {
        const acc = await account();
        const expense = await Transaction.create(tx({ account: String(acc._id) }));
        const created = await createPlan(acc._id);

        const [linked, removed] = await Promise.all([
            agent.post(`/api/planned-payments/${created.body._id}/pay`)
                .send({ __v: 0, transactionId: String(expense._id) }),
            agent.delete(`/api/transactions/${expense._id}`)
        ]);

        expect(removed.status).toBe(200);
        expect([200, 409]).toContain(linked.status);
        expect(await Transaction.countDocuments()).toBe(1);
        const payment = await PlannedPayment.findById(created.body._id);
        const savedExpense = await Transaction.findById(expense._id);
        expect(savedExpense.deletedAt).toBeInstanceOf(Date);
        if (linked.status === 200) {
            expect(payment.status).toBe('paid');
            expect(String(payment.transactionId)).toBe(String(expense._id));
        } else {
            expect(payment.status).toBe('pending');
            expect(payment.transactionId).toBeUndefined();
        }
    });

    it('paid-план неизменяем, linked expense остаётся расходом, но его сумма отражается в summary', async () => {
        const acc = await account();
        const created = await createPlan(acc._id);
        const paid = await agent.post(`/api/planned-payments/${created.body._id}/pay`).send(payBody(acc._id));
        const transaction = paid.body.transaction;

        expect((await agent.put(`/api/planned-payments/${created.body._id}`).send({ amount: 99, __v: 1 })).status).toBe(409);
        expect((await agent.put(`/api/transactions/${transaction._id}`).send({ type: 'income', category: 'Другое', __v: transaction.__v })).status).toBe(409);

        const amountUpdate = await agent.put(`/api/transactions/${transaction._id}`)
            .send({ amount: 77, __v: transaction.__v });
        expect(amountUpdate.status).toBe(200);
        const plans = await agent.get('/api/planned-payments');
        expect(plans.body[0].transactionSummary.amount).toBe(77);
    });

    it('trash помечается в плане, replay не создаёт замену, restore возвращает связь', async () => {
        const acc = await account();
        const created = await createPlan(acc._id);
        const payRequest = payBody(acc._id);
        const paid = await agent.post(`/api/planned-payments/${created.body._id}/pay`).send(payRequest);
        const transactionId = paid.body.transaction._id;
        await agent.delete(`/api/transactions/${transactionId}`);

        let plans = await agent.get('/api/planned-payments');
        expect(plans.body[0].transactionDeleted).toBe(true);
        expect(plans.body[0].transactionSummary.amount).toBe(52);
        const replay = await agent.post(`/api/planned-payments/${created.body._id}/pay`).send(payRequest);
        expect(replay.body.replayed).toBe(true);
        expect(await Transaction.countDocuments()).toBe(1);

        await agent.post(`/api/trash/${transactionId}/restore`);
        plans = await agent.get('/api/planned-payments');
        expect(plans.body[0].transactionDeleted).toBe(false);
    });

    it('ошибка связывания откатывает созданный расход', async () => {
        const acc = await account();
        const created = await createPlan(acc._id);
        const failure = vi.spyOn(PlannedPayment, 'findOneAndUpdate')
            .mockRejectedValueOnce(new Error('forced plan link failure'));

        let response;
        try {
            response = await agent.post(`/api/planned-payments/${created.body._id}/pay`).send(payBody(acc._id));
        } finally {
            failure.mockRestore();
        }

        expect(response.status).toBe(500);
        expect(await Transaction.countDocuments()).toBe(0);
        expect((await PlannedPayment.findById(created.body._id)).status).toBe('pending');
    });

    it('ошибка инициализации индекса возвращает 500 без зависшего запроса', async () => {
        const acc = await account();
        const failure = vi.spyOn(PlannedPayment, 'init').mockRejectedValueOnce(new Error('forced init failure'));
        let response;
        try {
            response = await createPlan(acc._id);
        } finally {
            failure.mockRestore();
        }
        expect(response.status).toBe(500);
        expect(await PlannedPayment.countDocuments()).toBe(0);
    });

    it('ошибка открытия session возвращает 500 без зависшего запроса', async () => {
        const acc = await account();
        const failure = vi.spyOn(mongoose, 'startSession')
            .mockRejectedValueOnce(new Error('forced session failure'));
        let response;
        try {
            response = await createPlan(acc._id);
        } finally {
            failure.mockRestore();
        }
        expect(response.status).toBe(500);
        expect(await PlannedPayment.countDocuments()).toBe(0);
    });

    it('счёт нельзя удалить, пока на него ссылается план', async () => {
        const acc = await account();
        await createPlan(acc._id);

        expect((await agent.delete(`/api/accounts/${acc._id}`)).status).toBe(400);
        expect(await Account.countDocuments()).toBe(1);
    });

    it('конкурентные создание плана и удаление счёта не оставляют сиротскую ссылку', async () => {
        const acc = await account();

        const [created, removed] = await Promise.all([
            createPlan(acc._id),
            agent.delete(`/api/accounts/${acc._id}`)
        ]);

        const outcome = `${created.status}:${removed.status}`;
        expect(['201:400', '400:200']).toContain(outcome);
        const accountExists = await Account.exists({ _id: acc._id });
        const planExists = await PlannedPayment.exists({ account: String(acc._id) });
        if (outcome === '201:400') {
            expect(Boolean(accountExists)).toBe(true);
            expect(Boolean(planExists)).toBe(true);
        } else {
            expect(Boolean(accountExists)).toBe(false);
            expect(Boolean(planExists)).toBe(false);
        }
    });
});
