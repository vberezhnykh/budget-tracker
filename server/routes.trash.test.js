// @vitest-environment node

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { connectTestDb, disconnectTestDb, clearCollections, loginAgent, tx, DB_HOOK_TIMEOUT } from './test/harness.js';

let agent;
let Transaction;
let PlannedPayment;
let Account;

beforeAll(async () => {
    const app = await connectTestDb('routes-trash');
    agent = await loginAgent(app);
    Transaction = mongoose.model('Transaction');
    PlannedPayment = mongoose.model('PlannedPayment');
    Account = mongoose.model('Account');
}, DB_HOOK_TIMEOUT);

afterAll(disconnectTestDb, DB_HOOK_TIMEOUT);
beforeEach(clearCollections);

describe('корзина операций', () => {
    it('скрывает удалённую split-группу из ledger, балансов и поиска', async () => {
        const [first] = await Transaction.create([
            tx({ title: 'Скрытый чек', description: 'скрытая подсказка', amount: 30, account: 'card', splitId: 'split-a' }),
            tx({ title: 'Скрытый чек', description: 'скрытая подсказка', amount: 70, account: 'card', splitId: 'split-a' }),
            tx({ title: 'Видимая операция', description: 'видимая подсказка', amount: 20, account: 'card' })
        ]);

        const removed = await agent.delete(`/api/transactions/${first._id}?splitId=split-a`);

        expect(removed.status).toBe(200);
        expect(removed.body).toEqual({ trashId: String(first._id), count: 2 });
        expect((await agent.get('/api/transactions')).body.map(row => row.title)).toEqual(['Видимая операция']);
        expect((await agent.get('/api/stats/balances')).body.total).toBe(-20);
        expect((await agent.get('/api/search?q=Скрытый')).body.count).toBe(0);
        const dashboard = await agent.get('/api/stats/dashboard?month=2026-03&today=2026-03-20');
        expect(dashboard.body.categoryUsage['expense::Продукты']).toBe(1);
        expect((await agent.get('/api/suggestions/descriptions?category=Продукты&type=expense')).body)
            .toEqual(['видимая подсказка']);

        const trash = await agent.get('/api/trash');
        expect(trash.body).toHaveLength(1);
        expect(trash.body[0]).toMatchObject({ id: String(first._id), count: 2 });
        expect(trash.body[0].transactions).toHaveLength(2);
        expect(trash.body[0].transactions.every(row => row.__v === 1)).toBe(true);
    });

    it('восстанавливает всю группу и повторный restore ничего не дублирует', async () => {
        const [first] = await Transaction.create([
            tx({ account: 'card', splitId: 'split-a' }),
            tx({ account: 'card', splitId: 'split-a' })
        ]);
        await agent.delete(`/api/transactions/${first._id}?splitId=split-a`);

        const restored = await agent.post(`/api/trash/${first._id}/restore`);
        const repeated = await agent.post(`/api/trash/${first._id}/restore`);

        expect(restored.body).toEqual({ count: 2 });
        expect(repeated.body).toEqual({ count: 0 });
        expect(await Transaction.countDocuments()).toBe(2);
        expect(await Transaction.countDocuments({ deletedAt: null, __v: 2 })).toBe(2);
        expect((await agent.get('/api/trash')).body).toEqual([]);
    });

    it('два одновременных удаления создают одну batch и дают стабильный результат', async () => {
        const transaction = await Transaction.create(tx({ account: 'card' }));

        const responses = await Promise.all([
            agent.delete(`/api/transactions/${transaction._id}`),
            agent.delete(`/api/transactions/${transaction._id}`)
        ]);

        expect(responses.every(response => response.status === 200)).toBe(true);
        expect(responses.every(response => response.body.count === 1)).toBe(true);
        const saved = await Transaction.findById(transaction._id);
        expect(saved.deletedAt).toBeInstanceOf(Date);
        expect(saved.__v).toBe(1);
        expect(await Transaction.distinct('deletionBatchId')).toHaveLength(1);
    });

    it('запрещает stale PUT после удаления', async () => {
        const transaction = await Transaction.create(tx({ account: 'card', amount: 100 }));
        await agent.delete(`/api/transactions/${transaction._id}`);

        const update = await agent.put(`/api/transactions/${transaction._id}`).send({ amount: 200, __v: 0 });

        expect(update.status).toBe(409);
        expect((await Transaction.findById(transaction._id)).amount).toBe(100);
    });

    it('перманентно удаляет batch и возвращает связанный план в pending', async () => {
        const transaction = await Transaction.create(tx({ account: 'card' }));
        const payment = await PlannedPayment.create({
            title: 'Счёт', amount: 100, dueDate: new Date('2026-04-01T00:00:00.000Z'),
            account: 'card', category: 'Жилье', status: 'paid',
            transactionId: transaction._id, paidAt: new Date()
        });
        await agent.delete(`/api/transactions/${transaction._id}`);

        const purged = await agent.delete(`/api/trash/${transaction._id}`);

        expect(purged.body).toEqual({ count: 1 });
        expect(await Transaction.countDocuments()).toBe(0);
        const reset = await PlannedPayment.findById(payment._id);
        expect(reset.status).toBe('pending');
        expect(reset.transactionId).toBeUndefined();
        expect(reset.paidAt).toBeUndefined();
        expect(reset.__v).toBe(1);
    });

    it('откатывает reset плана, если физическое удаление batch завершилось ошибкой', async () => {
        const transaction = await Transaction.create(tx({ account: 'card' }));
        const payment = await PlannedPayment.create({
            title: 'Счёт', amount: 100, dueDate: new Date('2026-04-01T00:00:00.000Z'),
            account: 'card', category: 'Жилье', status: 'paid',
            transactionId: transaction._id, paidAt: new Date()
        });
        await agent.delete(`/api/transactions/${transaction._id}`);
        const failure = vi.spyOn(Transaction, 'deleteMany')
            .mockRejectedValueOnce(new Error('forced purge failure'));

        let purged;
        try {
            purged = await agent.delete(`/api/trash/${transaction._id}`);
        } finally {
            failure.mockRestore();
        }

        expect(purged.status).toBe(500);
        const retained = await Transaction.findById(transaction._id);
        const retainedPayment = await PlannedPayment.findById(payment._id);
        expect(retained.deletedAt).toBeInstanceOf(Date);
        expect(retainedPayment.status).toBe('paid');
        expect(String(retainedPayment.transactionId)).toBe(String(transaction._id));
        expect(retainedPayment.paidAt).toBeInstanceOf(Date);
    });

    it('счёт нельзя удалить, пока на него ссылается операция в корзине', async () => {
        const account = await Account.create({ name: 'Основной', type: 'card' });
        const transaction = await Transaction.create(tx({ account: String(account._id) }));
        await agent.delete(`/api/transactions/${transaction._id}`);

        expect((await agent.delete(`/api/accounts/${account._id}`)).status).toBe(400);
        expect(await Account.countDocuments()).toBe(1);
    });

    it('ошибка открытия session возвращает 500 без зависшего запроса', async () => {
        const transaction = await Transaction.create(tx({ account: 'card' }));
        await agent.delete(`/api/transactions/${transaction._id}`);
        const failure = vi.spyOn(mongoose, 'startSession')
            .mockRejectedValueOnce(new Error('forced session failure'));

        let response;
        try {
            response = await agent.post(`/api/trash/${transaction._id}/restore`);
        } finally {
            failure.mockRestore();
        }

        expect(response.status).toBe(500);
        expect((await Transaction.findById(transaction._id)).deletedAt).toBeInstanceOf(Date);
    });
});
