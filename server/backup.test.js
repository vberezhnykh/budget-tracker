import { describe, it, expect, vi } from 'vitest';
import {
    BACKUP_COLLECTIONS,
    BACKUP_FORMAT_VERSION,
    buildBackupDocument,
    countAllCollections,
    formatBackupFilename,
    isEmptyBackup,
    readAllCollections,
    restoreCollections,
    selectBackupsToDelete,
    summarizeCounts,
    validateBackupDocument
} from './backup-core';
import { parseArgs as parseBackupArgs } from './backup';
import { parseArgs as parseRestoreArgs } from './restore';

const fullCollections = (overrides = {}) => ({
    transactions: [{ _id: 't1' }, { _id: 't2' }],
    accounts: [{ _id: 'a1' }],
    categories: [{ _id: 'c1' }],
    settings: [{ _id: 's1' }],
    ...overrides
});

describe('buildBackupDocument', () => {
    it('stores every collection with its own count', () => {
        const doc = buildBackupDocument(fullCollections(), new Date('2026-08-16T05:30:00.000Z'));

        expect(doc.formatVersion).toBe(BACKUP_FORMAT_VERSION);
        expect(doc.exportedAt).toBe('2026-08-16T05:30:00.000Z');
        expect(doc.counts).toEqual({ transactions: 2, accounts: 1, categories: 1, settings: 1 });
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

describe('summarizeCounts', () => {
    it('lists every collection, including ones missing from the input', () => {
        expect(summarizeCounts({ transactions: 3 })).toBe('transactions: 3, accounts: 0, categories: 0, settings: 0');
    });
});

// Minimal stand-in for a Mongo `db`. A real mongod can't run here, so the
// database-facing branches are exercised against this instead of going
// untested: it records every call, which is what lets the tests below
// assert that the backup path never writes.
function fakeDb(contents = {}) {
    const calls = [];
    const collections = {};
    for (const name of BACKUP_COLLECTIONS) {
        const docs = contents[name] ?? [];
        collections[name] = {
            find: vi.fn(() => {
                calls.push(`${name}.find`);
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
    return { calls, collections, collection: (name) => collections[name] };
}

describe('readAllCollections', () => {
    it('reads every collection and nothing else', async () => {
        const db = fakeDb({ transactions: [{ _id: 't1' }], accounts: [{ _id: 'a1' }] });

        const result = await readAllCollections(db);

        expect(result.transactions).toEqual([{ _id: 't1' }]);
        expect(result.accounts).toEqual([{ _id: 'a1' }]);
        expect(result.categories).toEqual([]);
        expect(result.settings).toEqual([]);
        expect(db.calls).toEqual(BACKUP_COLLECTIONS.map(name => `${name}.find`));
    });

    it('makes no write call at all - the backup must run under a read-only user', async () => {
        const db = fakeDb({ transactions: [{ _id: 't1' }] });

        await readAllCollections(db);

        for (const name of BACKUP_COLLECTIONS) {
            expect(db.collections[name].deleteMany).not.toHaveBeenCalled();
            expect(db.collections[name].insertMany).not.toHaveBeenCalled();
        }
    });
});

describe('restoreCollections', () => {
    const data = () => ({ transactions: [{ _id: 't1' }, { _id: 't2' }], accounts: [{ _id: 'a1' }], categories: [], settings: [{ _id: 's1' }] });

    it('inserts without clearing when replace is off', async () => {
        const db = fakeDb();

        const restored = await restoreCollections(db, data());

        expect(restored).toEqual({ transactions: 2, accounts: 1, categories: 0, settings: 1 });
        for (const name of BACKUP_COLLECTIONS) {
            expect(db.collections[name].deleteMany).not.toHaveBeenCalled();
        }
    });

    it('clears each collection before inserting when replace is on', async () => {
        const db = fakeDb();

        await restoreCollections(db, data(), { replace: true });

        // deleteMany must land before insertMany for the same collection,
        // or the restore would append to the data it meant to replace.
        expect(db.calls.indexOf('transactions.deleteMany')).toBeLessThan(db.calls.indexOf('transactions.insertMany'));
        expect(db.collections.accounts.deleteMany).toHaveBeenCalledTimes(1);
    });

    it('skips insertMany for a collection that was empty at backup time', async () => {
        // The driver rejects an empty batch, which would fail the whole
        // restore over a legitimately empty collection.
        const db = fakeDb();

        await restoreCollections(db, data(), { replace: true });

        expect(db.collections.categories.insertMany).not.toHaveBeenCalled();
        expect(db.collections.categories.deleteMany).toHaveBeenCalledTimes(1);
    });
});

describe('countAllCollections', () => {
    it('reports the current size of every collection', async () => {
        const db = fakeDb({ transactions: [{}, {}, {}], settings: [{}] });

        expect(await countAllCollections(db)).toEqual({ transactions: 3, accounts: 0, categories: 0, settings: 1 });
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
