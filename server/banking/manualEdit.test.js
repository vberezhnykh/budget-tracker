// @vitest-environment node
import { beforeAll, afterAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import mongoose from 'mongoose';
import { createRequire } from 'node:module';
import { connectTestDb, disconnectTestDb, clearCollections, loginAgent, DB_HOOK_TIMEOUT } from '../test/harness.js';

const require = createRequire(import.meta.url);
const { saveManualTransactionUpdate } = require('./manualEdit');
const { candidatesFor, candidateToken, resolveEntry } = require('./reconciliation');
const { BankAccount, BankEntry, BankControl } = require('./models');
let agent, Account, Transaction, account, bankAccount, entry;
const DATE = '2026-09-07T00:00:00.000Z';
const manual = overrides => ({ title: 'Ручная покупка', type: 'expense', amount: 1, category: 'Продукты',
    account: String(account._id), date: new Date(DATE), ...overrides });

beforeAll(async () => {
    const app = await connectTestDb('banking-manual-edit');
    agent = await loginAgent(app);
    Account = mongoose.model('Account');
    Transaction = mongoose.model('Transaction');
}, DB_HOOK_TIMEOUT);
afterAll(disconnectTestDb, DB_HOOK_TIMEOUT);
afterEach(() => vi.unstubAllEnvs());
beforeEach(async () => {
    vi.stubEnv('BANKING_ENABLED', 'true');
    await clearCollections();
    account = await Account.create({ name: 'BoC', type: 'card' });
    bankAccount = await BankAccount.create({ connectionId: new mongoose.Types.ObjectId(), identificationHash: 'boc:stable',
        uidCiphertext: 'test-only-unused', accountId: String(account._id), currency: 'EUR' });
    entry = await BankEntry.create({ bankAccountId: bankAccount._id, key: 'ref:stable-entry', amount: '12.34', currency: 'EUR',
        direction: 'expense', date: new Date(DATE), status: 'pending', description: 'Bank purchase' });
    await BankControl.create({ _id: 'ledger' });
});

async function approval() {
    const candidates = await candidatesFor(entry.toObject(), bankAccount.toObject());
    return { version: 0, action: 'import', candidateToken: candidateToken(candidates) };
}

describe('Manual edits share the bank approval transaction lock', () => {
    it('invalidates a previously displayed proposal when a manual PUT creates a matching candidate', async () => {
        const tx = await Transaction.create(manual());
        const stale = await approval();
        const response = await agent.put(`/api/transactions/${tx._id}`).send({ amount: 12.34, __v: 0 });
        expect(response.status).toBe(200);
        await expect(resolveEntry(String(entry._id), stale)).rejects.toMatchObject({ status: 409, code: 'CANDIDATES_CHANGED' });
        expect(await Transaction.countDocuments({ amount: 12.34 })).toBe(1);
        expect((await BankEntry.findById(entry._id)).status).toBe('pending');
    });

    it('rejects a manual PUT that would duplicate an already approved bank purchase', async () => {
        const tx = await Transaction.create(manual());
        await resolveEntry(String(entry._id), await approval());
        const response = await agent.put(`/api/transactions/${tx._id}`).send({ amount: 12.34, __v: 0 });
        expect(response.status).toBe(409);
        expect(response.body.code).toBe('BANK_DUPLICATE');
        expect((await Transaction.findById(tx._id)).amount).toBe(1);
        expect(await Transaction.countDocuments({ amount: 12.34 })).toBe(1);
    });

    it.each(['edit-first', 'approval-first'])('serializes simultaneous edit and approval without a duplicate: %s', async order => {
        const tx = await Transaction.create(manual());
        const stale = await approval();
        const edit = () => saveManualTransactionUpdate(String(tx._id), { amount: 12.34, __v: 0 });
        const approve = () => resolveEntry(String(entry._id), stale);
        const operations = order === 'edit-first' ? [edit, approve] : [approve, edit];
        const results = await Promise.allSettled(operations.map(operation => operation()));
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        const failure = results.find(result => result.status === 'rejected').reason;
        expect(failure.status).toBe(409);
        expect(['BANK_DUPLICATE', 'CANDIDATES_CHANGED']).toContain(failure.code);
        expect(await Transaction.countDocuments({ amount: 12.34 })).toBe(1);
    });

    it.each(['account', 'date', 'type'])('checks a newly matching %s, not only an amount change', async field => {
        let initial, patch;
        if (field === 'account') {
            const other = await Account.create({ name: 'Other', type: 'card' });
            initial = { account: String(other._id) }; patch = { account: String(account._id) };
        } else if (field === 'date') {
            initial = { date: new Date('2026-08-01T00:00:00.000Z') }; patch = { date: DATE };
        } else {
            initial = { type: 'income' }; patch = { type: 'expense' };
        }
        const tx = await Transaction.create(manual({ amount: 12.34, ...initial }));
        await resolveEntry(String(entry._id), await approval());
        await expect(saveManualTransactionUpdate(String(tx._id), { ...patch, __v: 0 })).rejects.toMatchObject({ status: 409, code: 'BANK_DUPLICATE' });
    });

    it('checks the edited split total against the approved bank amount', async () => {
        const first = await Transaction.create(manual({ amount: 3, splitId: 'manual-split' }));
        await Transaction.create(manual({ amount: 4, splitId: 'manual-split' }));
        await resolveEntry(String(entry._id), await approval());
        await expect(saveManualTransactionUpdate(String(first._id), { amount: 8.34, __v: 0 })).rejects.toMatchObject({ status: 409, code: 'BANK_DUPLICATE' });
        expect((await Transaction.findById(first._id)).amount).toBe(3);
    });

    it('allows category and description edits, including a bank-approved row itself', async () => {
        await resolveEntry(String(entry._id), await approval());
        const bankTx = await Transaction.findOne();
        const response = await agent.put(`/api/transactions/${bankTx._id}`).send({ category: 'Продукты', description: 'Мой комментарий', __v: 0 });
        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({ category: 'Продукты', description: 'Мой комментарий', amount: 12.34, __v: 1 });
        await expect(saveManualTransactionUpdate(String(bankTx._id), { amount: 15, __v: 1 })).resolves.toMatchObject({ amount: 15, __v: 2 });
        const separate = await Transaction.create(manual({ amount: 15 }));
        await expect(saveManualTransactionUpdate(String(separate._id), { category: 'Продукты', description: 'Другая покупка', __v: 0 })).resolves.toMatchObject({ description: 'Другая покупка' });
    });

    it('compares the actual edited bank ledger amount and does not match a trashed bank row', async () => {
        await resolveEntry(String(entry._id), await approval());
        const bankTx = await Transaction.findOne();
        await saveManualTransactionUpdate(String(bankTx._id), { amount: 15, __v: 0 });
        const other = await Transaction.create(manual());
        await expect(saveManualTransactionUpdate(String(other._id), { amount: 15, __v: 0 })).rejects.toMatchObject({ code: 'BANK_DUPLICATE' });
        await Transaction.updateOne({ _id: bankTx._id }, { $set: { deletedAt: new Date() } });
        await expect(saveManualTransactionUpdate(String(other._id), { amount: 15, __v: 0 })).resolves.toMatchObject({ amount: 15 });
    });

    it('prevents turning a manual row into a duplicate of an approved own-account transfer', async () => {
        const destination = await Account.create({ name: 'Revolut', type: 'card' });
        const tx = await Transaction.create(manual());
        await resolveEntry(String(entry._id), { ...await approval(), action: 'transfer', toAccountId: String(destination._id) });
        await expect(saveManualTransactionUpdate(String(tx._id), { amount: 12.34, type: 'transfer', toAccount: String(destination._id), __v: 0 }))
            .rejects.toMatchObject({ status: 409, code: 'BANK_DUPLICATE' });
        expect(await Transaction.countDocuments({ type: 'transfer' })).toBe(1);
    });

    it('preserves existing version, tombstone and legacy-reference semantics', async () => {
        const tx = await Transaction.create(manual({ account: 'legacy-account' }));
        await expect(saveManualTransactionUpdate(String(tx._id), { amount: 2, __v: 0 })).resolves.toMatchObject({ amount: 2 });
        await expect(saveManualTransactionUpdate(String(tx._id), { amount: 3, __v: 0 })).rejects.toMatchObject({ status: 409, code: 'STALE_TRANSACTION' });
        await Transaction.updateOne({ _id: tx._id }, { $set: { deletedAt: new Date() } });
        await expect(saveManualTransactionUpdate(String(tx._id), { amount: 3, __v: 1 })).rejects.toMatchObject({ status: 409, code: 'DELETED_TRANSACTION' });
        await expect(saveManualTransactionUpdate(String(new mongoose.Types.ObjectId()), { amount: 3 })).rejects.toMatchObject({ status: 404 });
    });
});
