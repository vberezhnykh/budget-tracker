import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { EJSON } from 'bson';
import { describe, it, expect, vi, inject } from 'vitest';
import {
    BACKUP_COLLECTIONS,
    BACKUP_FORMAT_VERSION,
    buildBackupDocument,
    countAllCollections,
    formatBackupFilename,
    inspectBackupContents,
    interpretAccessCheck,
    isEmptyBackup,
    readAllCollections,
    restoreCollections,
    selectBackupsToDelete,
    summarizeCounts,
    validateBackupDocument,
    normalizeBackupDocument
} from './backup-core';
import { parseArgs as parseBackupArgs, writeAtomic } from './backup';
import { parseArgs as parseRestoreArgs } from './restore';
import { probeWriteAccess } from './check-backup-access';

const fullCollections = (overrides = {}) => ({
    transactions: [{ _id: 't1' }, { _id: 't2' }],
    accounts: [{ _id: 'a1' }],
    categories: [{ _id: 'c1' }],
    settings: [{ _id: 's1' }],
    plannedpayments: [],
    ...overrides
});

describe('buildBackupDocument', () => {
    it('stores every collection with its own count', () => {
        const doc = buildBackupDocument(fullCollections(), new Date('2026-08-16T05:30:00.000Z'));

        expect(doc.formatVersion).toBe(BACKUP_FORMAT_VERSION);
        expect(doc.exportedAt).toBe('2026-08-16T05:30:00.000Z');
        expect(doc.counts).toEqual({ transactions: 2, accounts: 1, categories: 1, settings: 1, plannedpayments: 0 });
        expect(Object.keys(doc.data).sort()).toEqual([...BACKUP_COLLECTIONS].sort());
    });

    it('keeps empty collections rather than dropping them', () => {
        const doc = buildBackupDocument(fullCollections({ categories: [] }));
        expect(doc.data.categories).toEqual([]);
        expect(doc.counts.categories).toBe(0);
    });

    it('refuses to build a document that is missing a collection', () => {
        const partial = fullCollections();
        delete partial.settings;
        // A dump that silently skipped a collection would look successful
        // and restore an incomplete database.
        expect(() => buildBackupDocument(partial)).toThrow(/settings/);
    });
});

describe('validateBackupDocument', () => {
    it('accepts a document straight out of buildBackupDocument', () => {
        expect(validateBackupDocument(buildBackupDocument(fullCollections()))).toEqual({ ok: true, errors: [] });
    });

    it('rejects a file that is not an object at all', () => {
        expect(validateBackupDocument(null).ok).toBe(false);
        expect(validateBackupDocument([]).ok).toBe(false);
        expect(validateBackupDocument('нет').ok).toBe(false);
    });

    it('rejects an unknown format version instead of guessing the layout', () => {
        const doc = { ...buildBackupDocument(fullCollections()), formatVersion: 99 };
        const { ok, errors } = validateBackupDocument(doc);
        expect(ok).toBe(false);
        expect(errors.join(' ')).toMatch(/версия формата/i);
    });

    it('catches a truncated file by comparing the declared count with the data', () => {
        const doc = buildBackupDocument(fullCollections());
        doc.data.transactions.pop();

        const { ok, errors } = validateBackupDocument(doc);
        expect(ok).toBe(false);
        expect(errors.join(' ')).toMatch(/заявлено 2 записей, фактически 1/);
    });

    it('reports every problem at once rather than only the first', () => {
        const doc = buildBackupDocument(fullCollections());
        delete doc.data.accounts;
        delete doc.data.categories;

        const { errors } = validateBackupDocument(doc);
        expect(errors.join(' ')).toMatch(/accounts/);
        expect(errors.join(' ')).toMatch(/categories/);
    });

    it('rejects a missing data block', () => {
        const { ok, errors } = validateBackupDocument({ formatVersion: BACKUP_FORMAT_VERSION, exportedAt: new Date().toISOString() });
        expect(ok).toBe(false);
        expect(errors.join(' ')).toMatch(/data/);
    });

    it('rejects an unparseable export date', () => {
        const doc = { ...buildBackupDocument(fullCollections()), exportedAt: 'позавчера' };
        expect(validateBackupDocument(doc).ok).toBe(false);
    });

    it('accepts a v1 document and normalizes its missing planned payments', () => {
        const legacy = {
            formatVersion: 1,
            exportedAt: '2026-08-16T05:30:00.000Z',
            counts: { transactions: 0, accounts: 0, categories: 0, settings: 0 },
            data: { transactions: [], accounts: [], categories: [], settings: [] }
        };

        expect(validateBackupDocument(legacy)).toEqual({ ok: true, errors: [] });
        const normalized = normalizeBackupDocument(legacy);
        expect(normalized.formatVersion).toBe(1);
        expect(normalized.data.plannedpayments).toEqual([]);
        expect(normalized.counts.plannedpayments).toBe(0);
    });

    it('checks the count when a v1 document already contains planned payments', () => {
        const legacy = {
            formatVersion: 1, exportedAt: '2026-08-16T05:30:00.000Z',
            counts: { transactions: 0, accounts: 0, categories: 0, settings: 0, plannedpayments: 2 },
            data: { transactions: [], accounts: [], categories: [], settings: [], plannedpayments: [] }
        };
        expect(validateBackupDocument(legacy).ok).toBe(false);
        expect(validateBackupDocument(legacy).errors.join(' ')).toMatch(/plannedpayments.*заявлено 2/);
    });

    it('requires plannedpayments and its count in v2', () => {
        const doc = buildBackupDocument(fullCollections());
        delete doc.data.plannedpayments;
        delete doc.counts.plannedpayments;
        const { ok, errors } = validateBackupDocument(doc);
        expect(ok).toBe(false);
        expect(errors.join(' ')).toMatch(/plannedpayments/);
    });

    it('round-trips a v2 planned payment through EJSON', () => {
        const plan = {
            _id: 'p1', title: 'Аренда', amount: 1000, dueDate: new Date('2026-04-01'),
            account: 'a1', category: 'Жильё', status: 'pending', paidAt: null
        };
        const doc = buildBackupDocument(fullCollections({ plannedpayments: [plan] }));
        const parsed = EJSON.parse(EJSON.stringify(doc));
        expect(validateBackupDocument(parsed)).toEqual({ ok: true, errors: [] });
        expect(parsed.data.plannedpayments[0].dueDate).toBeInstanceOf(Date);
    });
});

describe('isEmptyBackup', () => {
    it('flags a dump where every collection came back empty', () => {
        // The usual cause is the wrong database name in the URI, or a
        // read-only user with no rights to it - a "successful" run that
        // would otherwise rotate out a good backup.
        expect(isEmptyBackup({ transactions: 0, accounts: 0, categories: 0, settings: 0 })).toBe(true);
    });

    it('does not flag a dump that has anything at all', () => {
        expect(isEmptyBackup({ transactions: 0, accounts: 1, categories: 0, settings: 0 })).toBe(false);
    });

    it('treats an absent count as zero', () => {
        expect(isEmptyBackup({})).toBe(true);
    });
});

describe('formatBackupFilename', () => {
    it('is filesystem-safe and sorts chronologically as text', () => {
        const earlier = formatBackupFilename(new Date('2026-08-16T05:30:00.000Z'));
        const later = formatBackupFilename(new Date('2026-08-16T06:00:00.000Z'));

        expect(earlier).toBe('budget-backup-2026-08-16T05-30-00Z.json');
        expect(earlier.includes(':')).toBe(false);
        expect(earlier < later).toBe(true);
    });
});

describe('selectBackupsToDelete', () => {
    const name = (stamp) => `budget-backup-${stamp}.json`;
    const day = (n) => name(`2026-08-${String(n).padStart(2, '0')}T03-00-00Z`);

    it('keeps the newest N and returns the rest', () => {
        const files = [day(1), day(2), day(3), day(4), day(5)];
        expect(selectBackupsToDelete(files, 2)).toEqual([day(1), day(2), day(3)]);
    });

    it('sorts by the timestamp in the name, not by the order the directory listed', () => {
        // readdir order is not guaranteed, so a rotation that trusted it
        // would delete arbitrary backups rather than the oldest.
        const files = [day(4), day(1), day(5), day(3), day(2)];
        expect(selectBackupsToDelete(files, 2)).toEqual([day(1), day(2), day(3)]);
    });

    it('deletes nothing when there are fewer backups than the limit', () => {
        expect(selectBackupsToDelete([day(1), day(2)], 5)).toEqual([]);
    });

    it('never touches files it did not write', () => {
        // The output directory is a path the user chose - very possibly a
        // synced cloud folder holding other things.
        const files = [
            day(1), day(2), day(3),
            'документы.json',
            'budget-backup.json',
            'budget-backup-2026-08-01.json',
            'budget-backup-2026-08-01T03-00-00Z.json.bak',
            'photo.jpg'
        ];
        expect(selectBackupsToDelete(files, 1)).toEqual([day(1), day(2)]);
    });

    it('disables rotation for a non-positive or non-integer limit instead of deleting everything', () => {
        const files = [day(1), day(2), day(3)];
        for (const bad of [0, -1, 1.5, NaN, null, undefined, '2']) {
            expect(selectBackupsToDelete(files, bad)).toEqual([]);
        }
    });

    it('handles an empty directory', () => {
        expect(selectBackupsToDelete([], 3)).toEqual([]);
    });
});

describe('inspectBackupContents', () => {
    const tx = (over = {}) => ({ _id: 't1', title: 'Кофе', amount: 5, type: 'expense', account: 'acc-1', date: new Date('2026-03-05'), ...over });
    const healthy = () => ({
        transactions: [tx(), tx({ _id: 't2', type: 'income', amount: 3000, date: new Date('2026-01-10') })],
        accounts: [{ _id: 'acc-1', name: 'Тинькофф' }],
        categories: [{ _id: 'c1' }],
        settings: [],
        plannedpayments: [{
            _id: 'p1', title: 'Аренда', amount: 1000, dueDate: new Date('2026-04-01'),
            account: 'acc-1', category: 'Жильё', status: 'paid', transactionId: 't1', paidAt: new Date('2026-04-02')
        }]
    });

    it('accepts an intact backup and describes what is in it', () => {
        const { ok, summary } = inspectBackupContents(healthy());

        expect(ok).toBe(true);
        expect(summary.join('\n')).toMatch(/Транзакции: 2, с 2026-01-10 по 2026-03-05/);
        expect(summary.join('\n')).toMatch(/Доходов на 3000\.00, расходов на 5\.00/);
        expect(summary.join('\n')).toMatch(/Счета \(1\): Тинькофф/);
        expect(summary.join('\n')).toMatch(/Разовые платежи: 1/);
    });

    it('catches dates that stopped being dates', () => {
        // The file having been re-saved as plain JSON somewhere along the
        // way is exactly the failure that stays invisible until a restore.
        const data = healthy();
        data.transactions[0].date = '2026-03-05T00:00:00.000Z';

        const { ok, problems } = inspectBackupContents(data);
        expect(ok).toBe(false);
        expect(problems.join(' ')).toMatch(/дата не осталась датой/);
    });

    it('catches documents with no _id', () => {
        const data = healthy();
        delete data.transactions[1]._id;

        expect(inspectBackupContents(data).problems.join(' ')).toMatch(/1 транзакций без _id/);
    });

    it('catches a non-numeric or infinite amount', () => {
        const data = healthy();
        data.transactions[0].amount = 'много';
        data.transactions[1].amount = Infinity;

        expect(inspectBackupContents(data).problems.join(' ')).toMatch(/2 транзакций с некорректной суммой/);
    });

    it('catches transactions pointing at an account the backup does not contain', () => {
        const data = healthy();
        data.transactions[1].account = 'acc-удалённый';

        const { ok, problems } = inspectBackupContents(data);
        expect(ok).toBe(false);
        expect(problems.join(' ')).toMatch(/acc-удалённый/);
    });

    it('does not treat a transaction with no account at all as an orphan', () => {
        const data = healthy();
        delete data.transactions[1].account;

        expect(inspectBackupContents(data).ok).toBe(true);
    });

    it('survives an entirely empty backup without throwing', () => {
        const { summary } = inspectBackupContents({ transactions: [], accounts: [], categories: [], settings: [], plannedpayments: [] });
        expect(summary.join(' ')).toMatch(/Категории: 0/);
    });

    it('checks planned payment type, date and references', () => {
        const data = healthy();
        data.plannedpayments.push({
            _id: 'p2', title: 'Bad', amount: 0, dueDate: '2026-02-31', account: 'missing',
            status: 'later', transactionId: 'missing', paidAt: 'yesterday'
        });
        const { ok, problems } = inspectBackupContents(data);
        expect(ok).toBe(false);
        expect(problems.join(' ')).toMatch(/положительная сумма/);
        expect(problems.join(' ')).toMatch(/dueDate/);
        expect(problems.join(' ')).toMatch(/status/);
        expect(problems.join(' ')).toMatch(/отсутствует счёт/);
        expect(problems.join(' ')).toMatch(/связанная транзакция/);
        expect(problems.join(' ')).toMatch(/paidAt/);
    });

    it('allows legacy card and cash plan accounts', () => {
        const data = healthy();
        data.plannedpayments[0].account = 'card';
        expect(inspectBackupContents(data).ok).toBe(true);
    });

    it('rejects duplicate paid links and unpaid plans carrying paid references', () => {
        const data = healthy();
        data.plannedpayments.push({
            _id: 'p2', title: 'Другая запись', amount: 50, dueDate: new Date('2026-04-02'),
            account: 'acc-1', category: 'Жильё', status: 'paid', transactionId: 't1', paidAt: new Date('2026-04-02')
        });
        data.plannedpayments[0].status = 'pending';
        data.plannedpayments[0].paidAt = null;
        const { problems } = inspectBackupContents(data);
        expect(problems.join(' ')).toMatch(/pending\/skipped/);
        expect(problems.join(' ')).toMatch(/уже связана/);
    });
});

describe('interpretAccessCheck', () => {
    const healthy = { databaseName: 'budgettracker', counts: { transactions: 12, accounts: 2, categories: 5, settings: 1 }, writeRejected: true };

    it('passes a correctly configured read-only credential', () => {
        const { ok, problems } = interpretAccessCheck(healthy);
        expect(ok).toBe(true);
        expect(problems).toEqual([]);
    });

    it('fails a credential that can write, however well it reads', () => {
        // This is the whole point of the arrangement: reads working is not
        // evidence of anything if writes also work.
        const { ok, problems } = interpretAccessCheck({ ...healthy, writeRejected: false });
        expect(ok).toBe(false);
        expect(problems.join(' ')).toMatch(/Запись ПРОШЛА/);
    });

    it('catches a connection string with no database name in it', () => {
        const { ok, problems } = interpretAccessCheck({ ...healthy, databaseName: 'test' });
        expect(ok).toBe(false);
        expect(problems.join(' ')).toMatch(/не указано имя базы/);
    });

    it('catches an empty database, which usually means the wrong name or no rights', () => {
        const { ok, problems } = interpretAccessCheck({ ...healthy, counts: { transactions: 0, accounts: 0, categories: 0, settings: 0 } });
        expect(ok).toBe(false);
        expect(problems.join(' ')).toMatch(/Во всех коллекциях пусто/);
    });

    it('reports every problem at once, so one run diagnoses the whole setup', () => {
        const { problems } = interpretAccessCheck({ databaseName: 'test', counts: {}, writeRejected: false });
        expect(problems).toHaveLength(3);
    });
});

describe('probeWriteAccess', () => {
    it('reports a refusal when the database rejects the insert', async () => {
        const db = { collection: () => ({ insertOne: async () => { throw new Error('not authorized on budgettracker to execute command insert'); } }) };

        const { writeRejected, reason } = await probeWriteAccess(db);

        expect(writeRejected).toBe(true);
        expect(reason).toMatch(/not authorized/);
    });

    it('cleans up after itself when the write unexpectedly succeeds', async () => {
        // Leaving a probe document behind in a database we were only meant
        // to be reading would be its own small bug.
        const deleteOne = vi.fn(async () => {});
        const drop = vi.fn(async () => {});
        const db = {
            collection: () => ({
                insertOne: async () => ({ insertedId: 'probe-1' }),
                deleteOne,
                drop
            })
        };

        const { writeRejected } = await probeWriteAccess(db);

        expect(writeRejected).toBe(false);
        expect(deleteOne).toHaveBeenCalledWith({ _id: 'probe-1' });
        expect(drop).toHaveBeenCalled();
    });

    it('still reports the write as successful even if cleanup fails', async () => {
        const db = {
            collection: () => ({
                insertOne: async () => ({ insertedId: 'probe-1' }),
                deleteOne: async () => { throw new Error('нет прав на удаление'); },
                drop: async () => {}
            })
        };

        expect((await probeWriteAccess(db)).writeRejected).toBe(false);
    });
});

describe('summarizeCounts', () => {
    it('lists every collection, including ones missing from the input', () => {
        expect(summarizeCounts({ transactions: 3 })).toBe('transactions: 3, accounts: 0, categories: 0, settings: 0, plannedpayments: 0');
    });
});

// Minimal stand-in for a Mongo `db`. A real mongod can't run here, so the
// database-facing branches are exercised against this instead of going
// untested: it records every call, which is what lets the tests below
// assert that the backup path never writes.
function fakeDb(contents = {}) {
    const calls = [];
    const findCalls = [];
    const collections = {};
    for (const name of BACKUP_COLLECTIONS) {
        const docs = contents[name] ?? [];
        collections[name] = {
            find: vi.fn((filter, options) => {
                calls.push(`${name}.find`);
                findCalls.push({ name, filter, options });
                return { toArray: async () => docs };
            }),
            countDocuments: vi.fn(async () => {
                calls.push(`${name}.countDocuments`);
                return docs.length;
            }),
            deleteMany: vi.fn(async () => { calls.push(`${name}.deleteMany`); }),
            insertMany: vi.fn(async () => { calls.push(`${name}.insertMany`); })
        };
    }
    return { calls, findCalls, collections, collection: (name) => collections[name] };
}

function fakeSession() {
    return {
        withTransaction: vi.fn(async callback => callback()),
        endSession: vi.fn(async () => {})
    };
}

describe('readAllCollections', () => {
    it('reads every collection and nothing else', async () => {
        const db = fakeDb({ transactions: [{ _id: 't1' }], accounts: [{ _id: 'a1' }] });
        const session = fakeSession();

        const result = await readAllCollections(db, { session });

        expect(result.transactions).toEqual([{ _id: 't1' }]);
        expect(result.accounts).toEqual([{ _id: 'a1' }]);
        expect(result.categories).toEqual([]);
        expect(result.settings).toEqual([]);
        expect(db.calls).toEqual(BACKUP_COLLECTIONS.map(name => `${name}.find`));
        expect(db.findCalls.every(call => call.options.session === session)).toBe(true);
    });

    it('makes no write call at all - the backup must run under a read-only user', async () => {
        const db = fakeDb({ transactions: [{ _id: 't1' }] });
        const session = fakeSession();

        await readAllCollections(db, { session });

        for (const name of BACKUP_COLLECTIONS) {
            expect(db.collections[name].deleteMany).not.toHaveBeenCalled();
            expect(db.collections[name].insertMany).not.toHaveBeenCalled();
        }
    });
});

describe('restoreCollections', () => {
    const data = () => ({ transactions: [{ _id: 't1' }, { _id: 't2' }], accounts: [{ _id: 'a1' }], categories: [], settings: [{ _id: 's1' }], plannedpayments: [] });

    it('inserts without clearing when replace is off', async () => {
        const db = fakeDb();
        const session = fakeSession();

        const restored = await restoreCollections(db, data(), { session });

        expect(restored).toEqual({ transactions: 2, accounts: 1, categories: 0, settings: 1, plannedpayments: 0 });
        for (const name of BACKUP_COLLECTIONS) {
            expect(db.collections[name].deleteMany).not.toHaveBeenCalled();
        }
    });

    it('clears each collection before inserting when replace is on', async () => {
        const db = fakeDb();
        const session = fakeSession();

        await restoreCollections(db, data(), { replace: true, session });

        // deleteMany must land before insertMany for the same collection,
        // or the restore would append to the data it meant to replace.
        expect(db.calls.indexOf('transactions.deleteMany')).toBeLessThan(db.calls.indexOf('transactions.insertMany'));
        expect(db.collections.accounts.deleteMany).toHaveBeenCalledTimes(1);
    });

    it('skips insertMany for a collection that was empty at backup time', async () => {
        // The driver rejects an empty batch, which would fail the whole
        // restore over a legitimately empty collection.
        const db = fakeDb();
        const session = fakeSession();

        await restoreCollections(db, data(), { replace: true, session });

        expect(db.collections.categories.insertMany).not.toHaveBeenCalled();
        expect(db.collections.categories.deleteMany).toHaveBeenCalledTimes(1);
    });

    it('restores a v1-shaped data block with an empty plannedpayments collection', async () => {
        const db = fakeDb();
        const session = fakeSession();
        const legacyDoc = {
            formatVersion: 1,
            data: { transactions: [{ _id: 't1' }], accounts: [], categories: [], settings: [] },
            counts: { transactions: 1, accounts: 0, categories: 0, settings: 0 }
        };
        const legacyData = normalizeBackupDocument(legacyDoc).data;

        const restored = await restoreCollections(db, legacyData, { session });

        expect(restored).toEqual({ transactions: 1, accounts: 0, categories: 0, settings: 0, plannedpayments: 0 });
        expect(db.collections.plannedpayments.insertMany).not.toHaveBeenCalled();
    });

    it('aborts the transaction when a later collection fails', async () => {
        const db = fakeDb();
        db.collections.categories.insertMany = vi.fn(async () => { throw new Error('duplicate key'); });
        const abortTransaction = vi.fn(async () => {});
        const session = {
            withTransaction: vi.fn(async callback => {
                try { await callback(); } catch (error) { await abortTransaction(); throw error; }
            })
        };

        await expect(restoreCollections(db, { ...data(), categories: [{ _id: 'c1' }] }, { replace: true, session })).rejects.toThrow('duplicate key');
        expect(abortTransaction).toHaveBeenCalledTimes(1);
        expect(db.collections.transactions.insertMany).toHaveBeenCalledTimes(1);
        expect(db.collections.settings.insertMany).not.toHaveBeenCalled();
    });

    it('rechecks the non-empty guard inside the transaction', async () => {
        const db = fakeDb({ accounts: [{ _id: 'existing' }] });
        const abortTransaction = vi.fn(async () => {});
        const session = {
            withTransaction: vi.fn(async callback => {
                try { await callback(); } catch (error) { await abortTransaction(); throw error; }
            })
        };

        await expect(restoreCollections(db, data(), { session })).rejects.toThrow(/accounts/);
        expect(abortTransaction).toHaveBeenCalledTimes(1);
        expect(db.collections.transactions.insertMany).not.toHaveBeenCalled();
    });
});

describe('atomic backup files', () => {
    it('replaces the destination only after the complete temp write', () => {
        const directory = fs.mkdtempSync(path.join(process.cwd(), '.tmp-backup-test-'));
        const destination = path.join(directory, 'backup.json');
        try {
            writeAtomic(destination, 'new complete backup');
            expect(fs.readFileSync(destination, 'utf8')).toBe('new complete backup');
            writeAtomic(destination, 'second complete backup');
            expect(fs.readFileSync(destination, 'utf8')).toBe('second complete backup');
        } finally {
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });

    it('cleans its temp file when the final rename fails', () => {
        const directory = fs.mkdtempSync(path.join(process.cwd(), '.tmp-backup-test-'));
        const destination = path.join(directory, 'existing-directory');
        fs.mkdirSync(destination);
        try {
            expect(() => writeAtomic(destination, 'cannot replace a directory')).toThrow();
            expect(fs.readdirSync(directory)).toEqual(['existing-directory']);
        } finally {
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });
});

describe('replica-set backup integrity', () => {
    it('keeps one snapshot and rolls back a failed restore', async () => {
        const client = new MongoClient(inject('mongoUri'));
        const dbName = `backup-integrity-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        await client.connect();
        const db = client.db(dbName);
        let snapshotSession;
        try {
            for (const name of BACKUP_COLLECTIONS) await db.createCollection(name);
            await db.collection('transactions').insertOne({ _id: 'before' });

            snapshotSession = client.startSession({ snapshot: true });
            await db.collection('transactions').find({}, { session: snapshotSession }).toArray();
            await db.collection('accounts').insertOne({ _id: 'after-snapshot' });
            const snapshot = await readAllCollections(db, { session: snapshotSession });
            expect(snapshot.accounts).toEqual([]);
            await snapshotSession.endSession();
            snapshotSession = null;

            const failedRestore = {
                transactions: [{ _id: 'replacement' }],
                accounts: [{ _id: 'replacement-account' }],
                categories: [{ _id: 'same' }, { _id: 'same' }],
                settings: [],
                plannedpayments: []
            };
            const restoreSession = client.startSession();
            try {
                await expect(restoreCollections(db, failedRestore, { replace: true, session: restoreSession })).rejects.toThrow();
            } finally {
                await restoreSession.endSession();
            }

            expect(await countAllCollections(db)).toEqual({ transactions: 1, accounts: 1, categories: 0, settings: 0, plannedpayments: 0 });
            expect(await db.collection('transactions').findOne({ _id: 'before' })).not.toBeNull();
            expect(await db.collection('transactions').findOne({ _id: 'replacement' })).toBeNull();
        } finally {
            if (snapshotSession) await snapshotSession.endSession();
            await db.dropDatabase();
            await client.close();
        }
    });
});

describe('countAllCollections', () => {
    it('reports the current size of every collection', async () => {
        const db = fakeDb({ transactions: [{}, {}, {}], settings: [{}] });

        expect(await countAllCollections(db)).toEqual({ transactions: 3, accounts: 0, categories: 0, settings: 1, plannedpayments: 0 });
    });
});

describe('backup CLI arguments', () => {
    it('defaults to the repo-level backups directory', () => {
        expect(parseBackupArgs([]).out).toMatch(/backups$/);
    });

    it('honours an explicit --out', () => {
        expect(parseBackupArgs(['--out', '/tmp/dumps']).out).toBe('/tmp/dumps');
    });

    it('rejects --out with no value instead of silently ignoring it', () => {
        expect(() => parseBackupArgs(['--out'])).toThrow();
    });

    it('leaves rotation off unless --keep is given', () => {
        expect(parseBackupArgs([]).keep).toBeNull();
        expect(parseBackupArgs(['--keep', '14']).keep).toBe(14);
    });

    it('rejects a --keep that would delete backups by accident', () => {
        // A mistyped limit must fail loudly, not fall back to some default.
        for (const bad of [[], ['--keep'], ['--keep', '0'], ['--keep', '-3'], ['--keep', 'семь'], ['--keep', '2.5']]) {
            if (bad.length < 2) continue;
            expect(() => parseBackupArgs(bad)).toThrow(/--keep/);
        }
    });
});

describe('restore CLI arguments', () => {
    it('requires both the file and an explicit confirmation', () => {
        const args = parseRestoreArgs(['dump.json']);
        expect(args.file).toBe('dump.json');
        // Not confirmed: the script reports what it would do and stops.
        expect(args.confirmed).toBe(false);
        expect(args.replace).toBe(false);
    });

    it('reads the flags in any order', () => {
        const args = parseRestoreArgs(['--yes', 'dump.json', '--replace']);
        expect(args).toEqual({ file: 'dump.json', confirmed: true, replace: true });
    });

    it('does not mistake a flag for the filename', () => {
        expect(parseRestoreArgs(['--yes']).file).toBeNull();
    });
});
