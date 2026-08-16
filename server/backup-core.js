// The logic behind the backup/restore scripts. Nothing here opens a
// connection or touches the filesystem: the database is always passed in as
// an argument, so every branch - including the destructive ones in
// restoreCollections - is unit testable against a fake `db`, and the
// scripts themselves stay thin wrappers around these.

// Every collection the app owns. A backup that silently skipped one would
// look successful and restore an incomplete database, so this list is the
// single source of truth for both directions and both scripts iterate it
// rather than naming collections inline.
const BACKUP_COLLECTIONS = ['transactions', 'accounts', 'categories', 'settings'];

// Bumped only when the shape of the backup document itself changes (not
// when the app's schemas do). restore refuses a document whose version it
// doesn't recognise rather than guessing at an older layout.
const BACKUP_FORMAT_VERSION = 1;

// Filesystem-safe, sorts chronologically as plain text, and keeps the UTC
// instant readable: budget-backup-2026-08-16T05-30-00Z.json
function formatBackupFilename(date = new Date()) {
    const stamp = date.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-');
    return `budget-backup-${stamp}.json`;
}

// Matches exactly what formatBackupFilename produces, and nothing else.
// Rotation deletes files, and the output directory is a path the user chose
// - quite possibly one holding other things (a synced cloud folder, say) -
// so "is this one of ours" has to be decided by the full filename, never by
// a loose extension or prefix check.
const BACKUP_FILENAME_PATTERN = /^budget-backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.json$/;

// Given the filenames currently in the output directory, returns the ones
// rotation should delete: everything past the newest `keep`.
//
// Anything not matching our own naming pattern is ignored outright - it was
// not written by this script, so it is not this script's to delete.
//
// keep < 1 disables rotation (returns nothing) rather than being read as
// "keep none and delete everything", which is the one interpretation that
// could destroy every backup at once through a typo'd argument.
function selectBackupsToDelete(filenames, keep) {
    if (!Number.isInteger(keep) || keep < 1) return [];
    // The timestamp is fixed-width and zero-padded, so lexicographic order
    // is chronological order - no date parsing needed to sort these.
    const ours = filenames.filter(name => BACKUP_FILENAME_PATTERN.test(name)).sort();
    return ours.slice(0, Math.max(0, ours.length - keep));
}

// Assembles the backup document. `collections` maps a collection name to
// its array of documents.
//
// The per-collection counts are stored alongside the data deliberately: they
// let a restore (or a human) detect a dump that was truncated after the fact
// without re-reading every document, and they make "did last night's backup
// actually contain anything" answerable from the header alone.
function buildBackupDocument(collections, exportedAt = new Date()) {
    const missing = BACKUP_COLLECTIONS.filter(name => !Array.isArray(collections[name]));
    if (missing.length > 0) {
        throw new Error(`Backup is missing collections: ${missing.join(', ')}`);
    }

    const counts = {};
    const data = {};
    for (const name of BACKUP_COLLECTIONS) {
        data[name] = collections[name];
        counts[name] = collections[name].length;
    }

    return {
        formatVersion: BACKUP_FORMAT_VERSION,
        exportedAt: exportedAt.toISOString(),
        counts,
        data
    };
}

// Checks a parsed backup document before anything touches the database.
// Returns every problem found rather than the first, so a bad dump is
// diagnosed in one run instead of one error at a time.
//
// The counts are re-derived from the data and compared against the stored
// header: a mismatch means the file was truncated or edited after export,
// which is exactly the case where restoring anyway would quietly lose rows.
function validateBackupDocument(doc) {
    const errors = [];

    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
        return { ok: false, errors: ['Файл не является объектом бэкапа'] };
    }

    if (doc.formatVersion !== BACKUP_FORMAT_VERSION) {
        errors.push(`Неизвестная версия формата: ${doc.formatVersion} (ожидается ${BACKUP_FORMAT_VERSION})`);
    }

    if (typeof doc.exportedAt !== 'string' || Number.isNaN(Date.parse(doc.exportedAt))) {
        errors.push('Отсутствует или некорректна дата выгрузки (exportedAt)');
    }

    const data = doc.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        errors.push('Отсутствует блок data');
        return { ok: false, errors };
    }

    for (const name of BACKUP_COLLECTIONS) {
        if (!Array.isArray(data[name])) {
            errors.push(`Коллекция "${name}" отсутствует или не является массивом`);
            continue;
        }
        const declared = doc.counts ? doc.counts[name] : undefined;
        if (typeof declared !== 'number') {
            errors.push(`Не указано число записей для "${name}"`);
        } else if (declared !== data[name].length) {
            errors.push(`Файл повреждён: в "${name}" заявлено ${declared} записей, фактически ${data[name].length}`);
        }
    }

    return { ok: errors.length === 0, errors };
}

// One-line human summary used by both scripts' output, e.g.
// "transactions: 1240, accounts: 4, categories: 17, settings: 1"
function summarizeCounts(counts) {
    return BACKUP_COLLECTIONS.map(name => `${name}: ${counts[name] ?? 0}`).join(', ');
}

// A backup whose every collection is empty is almost always a failure that
// "succeeded" - wrong database name in the URI, or a read-only user without
// rights to this database. Callers treat it as an error rather than
// overwriting yesterday's good backup with an empty file.
function isEmptyBackup(counts) {
    return BACKUP_COLLECTIONS.every(name => (counts[name] ?? 0) === 0);
}

// Reads every backed-up collection. The only database calls the backup path
// ever makes, and all of them are reads - which is what lets the whole
// script run under a MongoDB user holding just the `read` role.
async function readAllCollections(db) {
    const collections = {};
    for (const name of BACKUP_COLLECTIONS) {
        collections[name] = await db.collection(name).find({}).toArray();
    }
    return collections;
}

// Writes a validated backup back into the database.
//
// `replace` clears each collection first. Without it this only inserts,
// which is why restore.js refuses a non-empty target unless the caller
// asked for --replace: inserting a stale dump on top of live data would
// merge two histories rather than restore one.
//
// insertMany is skipped for an empty array because the driver rejects an
// empty batch - a collection that was legitimately empty at backup time
// would otherwise fail the whole restore.
async function restoreCollections(db, data, { replace = false } = {}) {
    const restored = {};
    for (const name of BACKUP_COLLECTIONS) {
        const documents = data[name];
        if (replace) await db.collection(name).deleteMany({});
        if (documents.length > 0) await db.collection(name).insertMany(documents);
        restored[name] = documents.length;
    }
    return restored;
}

// Current per-collection document counts, used to decide whether the target
// is safe to restore onto.
async function countAllCollections(db) {
    const counts = {};
    for (const name of BACKUP_COLLECTIONS) {
        counts[name] = await db.collection(name).countDocuments();
    }
    return counts;
}

module.exports = {
    BACKUP_COLLECTIONS,
    BACKUP_FILENAME_PATTERN,
    selectBackupsToDelete,
    countAllCollections,
    readAllCollections,
    restoreCollections,
    BACKUP_FORMAT_VERSION,
    formatBackupFilename,
    buildBackupDocument,
    validateBackupDocument,
    summarizeCounts,
    isEmptyBackup
};
