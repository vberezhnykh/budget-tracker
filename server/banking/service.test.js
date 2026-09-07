// @vitest-environment node
import { beforeAll, afterAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import mongoose from 'mongoose';
import { createRequire } from 'node:module';
import { connectTestDb, disconnectTestDb, clearCollections, loginAgent, DB_HOOK_TIMEOUT } from '../test/harness.js';

const require = createRequire(import.meta.url);
const { createBankingService } = require('./service');
const { encrypt } = require('./provider');
const { saveManualTransactions, candidateToken } = require('./reconciliation');
const { BankConnection, BankAccount, BankEntry, BankLink } = require('./models');
const config = { applicationId: 'test-banking', encryptionKey: Buffer.alloc(32, 7), redirectUrl: 'https://budget.example/banking/callback.html' };
let app, agent, Account, Transaction, Category, clock, service, provider, connection, bankAccount, budgetAccount;
const bankRow = (overrides = {}) => ({ reference: 'stable-entry-1', fingerprint: 'fingerprint-1', amount: '12.34', currency: 'EUR',
    direction: 'expense', date: '2026-09-07T00:00:00.000Z', description: 'Supermarket', reviewReasons: [], ...overrides });
const manual = (overrides = {}) => ({ title: 'Моя покупка', category: 'Продукты', description: 'Мой комментарий', amount: 12.34,
    type: 'expense', account: String(budgetAccount._id), date: new Date('2026-09-07T00:00:00.000Z'), ...overrides });

beforeAll(async () => {
    app = await connectTestDb('banking-service');
    agent = await loginAgent(app);
    Account = mongoose.model('Account');
    Transaction = mongoose.model('Transaction');
    Category = mongoose.model('Category');
}, DB_HOOK_TIMEOUT);
afterAll(disconnectTestDb, DB_HOOK_TIMEOUT);
afterEach(() => vi.unstubAllEnvs());
beforeEach(async () => {
    vi.stubEnv('BANKING_ENABLED', 'true');
    await clearCollections();
    clock = new Date('2026-09-07T05:00:00.000Z'); // 08:00 local
    provider = {
        getTransactions: vi.fn(async () => ({ complete: true, rows: [bankRow()], warnings: [] })),
        getBalances: vi.fn(async () => [{ amount: '123.45', currency: 'EUR', type: 'CLBD', asOf: null }]),
        createAuthorization: vi.fn(async ({ state }) => ({ url: `https://auth.enablebanking.com/?state=${state}` })),
        exchangeCode: vi.fn(async () => ({ sessionId: 'new-session', validUntil: '2027-03-01T00:00:00.000Z', accounts: [{
            uid: 'new-uid', identificationHash: 'stable-account', name: 'EUR', maskedNumber: '•••• 1234', currency: 'EUR'
        }] })), closeSession: vi.fn(async () => {})
    };
    service = createBankingService({ configFactory: () => config, providerFactory: () => provider, now: () => clock });
    budgetAccount = await Account.create({ name: 'BoC', type: 'card' });
    await Category.create({ name: 'Продукты', type: 'expense' });
    connection = await BankConnection.create({ bank: 'boc', status: 'connected', sessionCiphertext: encrypt('session', config),
        consentExpiresAt: new Date('2027-03-01T00:00:00.000Z'), importFrom: new Date('2026-09-01T00:00:00.000Z'), nextSyncAt: clock });
    bankAccount = await BankAccount.create({ connectionId: connection._id, identificationHash: 'boc:stable-account',
        uidCiphertext: encrypt('uid', config), name: 'EUR', currency: 'EUR', accountId: String(budgetAccount._id) });
});

async function download() {
    await service.syncConnection(String(connection._id));
    return (await service.listReview()).items;
}
async function approve(item, extra = {}) {
    return service.resolveReview(item.id, { version: item.version, action: 'import', candidateToken: item.candidateToken, ...extra });
}

describe('Bank downloads only create durable proposals', () => {
    it('never modifies the ledger, even with no possible manual match; balances remain separate', async () => {
        const items = await download();
        expect(items).toHaveLength(1);
        expect(items[0].candidates).toEqual([]);
        expect(await Transaction.countDocuments()).toBe(0);
        const status = await service.status();
        expect(status.pendingReviewCount).toBe(1);
        expect(status.connections[0].accounts[0].balances[0].amount).toBe('123.45');
        expect(JSON.stringify(status)).not.toMatch(/Ciphertext|identificationHash|session|uid/);
    });

    it('does not repeat provider calls before six hours, including simultaneous triggers', async () => {
        await Promise.all([download(), service.syncConnection(String(connection._id)), service.runDueSyncs()]);
        expect(provider.getTransactions).toHaveBeenCalledTimes(1);
        clock = new Date('2026-09-07T10:59:59.000Z');
        await service.syncConnection(String(connection._id));
        expect(provider.getTransactions).toHaveBeenCalledTimes(1);
        clock = new Date('2026-09-07T11:00:00.000Z');
        await service.syncConnection(String(connection._id));
        expect(provider.getTransactions).toHaveBeenCalledTimes(2);
        expect(await BankEntry.countDocuments()).toBe(1);
        expect(await Transaction.countDocuments()).toBe(0);
    });

    it('does not fetch in the night even if a connection is overdue', async () => {
        clock = new Date('2026-09-07T23:00:00.000Z');
        await service.runDueSyncs();
        expect(provider.getTransactions).not.toHaveBeenCalled();
    });

    it('persists ignored decisions across repeats and reconnection identifiers', async () => {
        const [item] = await download();
        await service.resolveReview(item.id, { version: item.version, action: 'ignore' });
        await BankAccount.updateOne({ _id: bankAccount._id }, { $set: { uidCiphertext: encrypt('different-uid', config) } });
        clock = new Date('2026-09-07T11:00:00.000Z');
        await service.syncConnection(String(connection._id));
        expect((await service.listReview()).total).toBe(0);
        expect(await BankEntry.countDocuments()).toBe(1);
        expect(await Transaction.countDocuments()).toBe(0);
    });

    it('does not collapse two identical unidentified purchases or change their keys when reference rows move', async () => {
        let rows = [bankRow(), bankRow({ reference: null }), bankRow({ reference: null })];
        provider.getTransactions.mockImplementation(async () => ({ complete: true, rows, warnings: [] }));
        await download();
        expect(await BankEntry.countDocuments()).toBe(3);
        rows = [rows[1], rows[2], rows[0]];
        clock = new Date('2026-09-07T11:00:00.000Z');
        await service.syncConnection(String(connection._id));
        expect(await BankEntry.countDocuments()).toBe(3);
    });

    it('preserves previous balances and exposes a warning when only the balance endpoint fails', async () => {
        provider.getBalances.mockRejectedValue(Object.assign(new Error('unavailable'), { code: 'API_ERROR' }));
        await download();
        expect((await service.status()).connections[0].warningsCount).toBe(1);
        expect(await BankEntry.countDocuments()).toBe(1);
    });

    it('paces failed fetches as well and never marks them successful', async () => {
        provider.getTransactions.mockRejectedValue(Object.assign(new Error('limit'), { code: 'RATE_LIMITED' }));
        await expect(download()).rejects.toMatchObject({ code: 'RATE_LIMITED' });
        await service.syncConnection(String(connection._id));
        expect(provider.getTransactions).toHaveBeenCalledTimes(1);
        expect((await BankConnection.findById(connection._id)).lastSuccessfulSyncAt).toBeUndefined();
        expect(await BankEntry.countDocuments()).toBe(0);
    });

    it('fences an old balance response after the connection has been replaced', async () => {
        provider.getBalances.mockImplementation(async () => {
            await BankConnection.updateOne({ _id: connection._id }, { $set: { leaseToken: 'replacement', status: 'connected', sessionCiphertext: 'new-session-cipher' } });
            return [{ amount: '999.00', currency: 'EUR', type: 'CLBD', asOf: null }];
        });
        await expect(download()).rejects.toMatchObject({ code: 'LEASE_LOST' });
        expect((await BankAccount.findById(bankAccount._id)).balances).toHaveLength(0);
        const saved = await BankConnection.findById(connection._id);
        expect(saved.sessionCiphertext).toBe('new-session-cipher');
        expect(saved.lastSuccessfulSyncAt).toBeUndefined();
    });
});

describe('User decisions and manual duplicate matching', () => {
    it('allows edited category and description only on explicit approval, idempotently', async () => {
        const [item] = await download();
        await approve(item, { category: 'Продукты', description: 'Еда на неделю\nи кофе' });
        await approve(item, { category: 'Продукты', description: 'Еда на неделю\nи кофе' });
        const rows = await Transaction.find().lean();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ category: 'Продукты', description: 'Еда на неделю\nи кофе', amount: 12.34 });
        expect((await service.listReview()).total).toBe(0);
    });

    it('offers same sum/date manual purchases without silently merging either', async () => {
        const first = await Transaction.create(manual());
        await Transaction.create(manual({ title: 'Другая покупка' }));
        const [item] = await download();
        expect(item.candidates).toHaveLength(2);
        expect(await Transaction.countDocuments()).toBe(2);
        const candidate = item.candidates.find(value => value.transactionId === String(first._id));
        await service.resolveReview(item.id, { version: item.version, action: 'match', transactionId: candidate.transactionId, transactionVersion: candidate.version });
        expect(await Transaction.countDocuments()).toBe(2);
        expect((await Transaction.findById(first._id)).description).toBe('Мой комментарий');
        expect((await Transaction.findById(first._id)).category).toBe('Продукты');
    });

    it('detects a manual row added after the proposal was displayed', async () => {
        const [stale] = await download();
        await saveManualTransactions([manual()]);
        await expect(approve(stale)).rejects.toMatchObject({ code: 'CANDIDATES_CHANGED', status: 409 });
        expect(await Transaction.countDocuments()).toBe(1);
        const [fresh] = (await service.listReview()).items;
        expect(fresh.candidates).toHaveLength(1);
        await approve(fresh); // An explicit separate purchase after seeing the match.
        expect(await Transaction.countDocuments()).toBe(2);
    });

    it('checks the entire split amount and links every member without rewriting categories', async () => {
        await Transaction.create([manual({ amount: 10, splitId: 'split-1' }), manual({ amount: 2.34, splitId: 'split-1', category: 'Кофе' })]);
        const [item] = await download();
        expect(item.candidates).toHaveLength(1);
        expect(item.candidates[0].groupCount).toBe(2);
        await service.resolveReview(item.id, { version: item.version, action: 'match',
            transactionId: item.candidates[0].transactionId, transactionVersion: item.candidates[0].version });
        expect(await BankLink.countDocuments()).toBe(2);
        expect(await Transaction.countDocuments()).toBe(2);
    });

    it('retains a matched bank tombstone after permanent deletion of the manual row', async () => {
        const manualTx = await Transaction.create(manual({ deletedAt: new Date() }));
        const [item] = await download();
        expect(item.candidates[0].deleted).toBe(true);
        await service.resolveReview(item.id, { version: item.version, action: 'match', transactionId: String(manualTx._id), transactionVersion: 0 });
        await Transaction.deleteOne({ _id: manualTx._id });
        clock = new Date('2026-09-07T11:00:00.000Z');
        await service.syncConnection(String(connection._id));
        expect(await Transaction.countDocuments()).toBe(0);
        expect((await service.listReview()).total).toBe(0);
        expect(await BankLink.countDocuments()).toBe(1);
    });

    it('refuses EUR conversion or subcent rounding', async () => {
        provider.getTransactions.mockResolvedValue({ complete: true, warnings: [], rows: [bankRow({ currency: 'USD' }), bankRow({ reference: 'other', amount: '0.001' }), bankRow({ reference: 'huge', amount: '90071992547409.91' })] });
        const items = await download();
        for (const item of items) await expect(approve(item)).rejects.toMatchObject({ code: 'UNSUPPORTED_AMOUNT' });
        expect(await Transaction.countDocuments()).toBe(0);
    });

    it('represents an explicitly approved own-account transfer once, and can match the incoming bank leg', async () => {
        const otherAccount = await Account.create({ name: 'Revolut', type: 'card' });
        const otherBank = await BankAccount.create({ connectionId: connection._id, identificationHash: 'revolut:stable', uidCiphertext: encrypt('other', config), accountId: String(otherAccount._id) });
        const items = await download();
        const item = items.find(row => row.bankAccountId === String(bankAccount._id));
        await service.resolveReview(item.id, { version: item.version, action: 'transfer', candidateToken: item.candidateToken, toAccountId: String(otherAccount._id) });
        const transfer = await Transaction.findOne().lean();
        expect(transfer).toMatchObject({ type: 'transfer', account: String(budgetAccount._id), toAccount: String(otherAccount._id) });
        await BankEntry.create({ bankAccountId: otherBank._id, key: 'incoming', ...bankRow({ direction: 'income' }), status: 'pending' });
        const incoming = (await service.listReview()).items.find(row => row.direction === 'income');
        expect(incoming.candidates[0].transactionId).toBe(String(transfer._id));
        await service.resolveReview(incoming.id, { version: incoming.version, action: 'match', transactionId: String(transfer._id), transactionVersion: 0 });
        expect(await Transaction.countDocuments()).toBe(1);
    });

    it('protects a bank-approved purchase if the user later creates the same manual expense', async () => {
        const [item] = await download();
        await approve(item);
        const conflict = await agent.post('/api/transactions').send(manual());
        expect(conflict.status).toBe(409);
        expect(conflict.body.code).toBe('BANK_DUPLICATE');
        const candidate = conflict.body.candidates[0];
        const response = await agent.post('/api/transactions').send({ ...manual(), bankMatchEntryId: candidate.entryId, bankTransactionVersion: candidate.version });
        expect(response.status).toBe(200);
        expect(await Transaction.countDocuments()).toBe(1);
        expect((await Transaction.findOne()).description).toBe('Мой комментарий');
    });

    it('rejects deletion of a mapped ledger account even before any transaction is approved', async () => {
        const response = await agent.delete(`/api/accounts/${budgetAccount._id}`);
        expect(response.status).toBe(400);
        expect(await Account.exists({ _id: budgetAccount._id })).toBeTruthy();
    });
});

describe('Persisted authorization and session replacement', () => {
    it('binds state to the initiating browser and allows it only once', async () => {
        const nonce = 'a'.repeat(43);
        const { authorizationUrl } = await service.connect('boc', '2026-08-01', nonce);
        const state = new URL(authorizationUrl).searchParams.get('state');
        await expect(service.completeAuthorization({ code: 'code', state, browserNonce: 'b'.repeat(43) })).rejects.toMatchObject({ code: 'INVALID_STATE' });
        // Keep the initial fetch deferred by an already consumed quota.
        await BankConnection.updateOne({ _id: connection._id }, { $set: { lastAttemptAt: clock } });
        await service.completeAuthorization({ code: 'code', state, browserNonce: nonce });
        await expect(service.completeAuthorization({ code: 'code', state, browserNonce: nonce })).rejects.toMatchObject({ code: 'INVALID_STATE' });
        expect(provider.exchangeCode).toHaveBeenCalledTimes(1);
        expect(await BankAccount.countDocuments()).toBe(1);
        expect((await BankAccount.findById(bankAccount._id)).accountId).toBe(String(budgetAccount._id));
        expect(provider.closeSession).toHaveBeenCalledWith('session');
    });

    it('reads the explicitly selected history again after reconnect while retaining the quota', async () => {
        await BankConnection.updateOne({ _id: connection._id }, { $set: { lastAttemptAt: clock, lastSuccessfulSyncAt: clock } });
        const nonce = 'a'.repeat(43);
        const { authorizationUrl } = await service.connect('boc', '2026-08-01', nonce);
        await service.completeAuthorization({ code: 'code', state: new URL(authorizationUrl).searchParams.get('state'), browserNonce: nonce });
        expect(provider.getTransactions).not.toHaveBeenCalled();
        clock = new Date('2026-09-07T11:00:00.000Z');
        await service.syncConnection(String(connection._id));
        expect(provider.getTransactions).toHaveBeenCalledWith('new-uid', { dateFrom: '2026-08-01', dateTo: '2026-09-07' });
    });

    it('locks a disconnect before its network request, so a simultaneous sync cannot start', async () => {
        let finish;
        const network = new Promise(resolve => { finish = resolve; });
        provider.closeSession.mockReturnValue(network);
        const disconnecting = service.disconnect(String(connection._id));
        await vi.waitFor(() => expect(provider.closeSession).toHaveBeenCalled());
        await service.syncConnection(String(connection._id));
        expect(provider.getTransactions).not.toHaveBeenCalled();
        finish();
        await disconnecting;
        const saved = await BankConnection.findById(connection._id);
        expect(saved.status).toBe('disconnected');
        expect(saved.sessionCiphertext).toBeUndefined();
    });

    it('requires a new consent when the saved session has expired', async () => {
        provider.getTransactions.mockRejectedValue(Object.assign(new Error('expired'), { code: 'SESSION_EXPIRED' }));
        await expect(download()).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
        expect((await BankConnection.findById(connection._id)).status).toBe('expired');
    });

    it('uses a deterministic empty candidate snapshot', () => {
        expect(candidateToken([])).toMatch(/^[a-f0-9]{64}$/);
    });
});
