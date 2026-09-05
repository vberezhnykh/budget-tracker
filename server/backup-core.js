// The logic behind the backup/restore scripts. Nothing here opens a
// connection or touches the filesystem: the database is always passed in as
// an argument, so every branch - including the destructive ones in
// restoreCollections - is unit testable against a fake `db`, and the
// scripts themselves stay thin wrappers around these.

// Every collection the app owns. A backup that silently skipped one would
// look successful and restore an incomplete database, so this list is the
// single source of truth for both directions and both scripts iterate it
// rather than naming collections inline.
const LEGACY_BACKUP_COLLECTIONS = ['transactions', 'accounts', 'categories', 'settings'];
const BACKUP_COLLECTIONS = [...LEGACY_BACKUP_COLLECTIONS, 'plannedpayments'];

// Bumped only when the shape of the backup document itself changes (not
// when the app's schemas do). restore refuses a document whose version it
// doesn't recognise rather than guessing at an older layout.
const BACKUP_FORMAT_VERSION = 2;
const LEGACY_BACKUP_FORMAT_VERSION = 1;

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

    const isLegacy = doc.formatVersion === LEGACY_BACKUP_FORMAT_VERSION;
    if (doc.formatVersion !== BACKUP_FORMAT_VERSION && !isLegacy) {
        errors.push(`Неизвестная версия формата: ${doc.formatVersion} (ожидается ${LEGACY_BACKUP_FORMAT_VERSION} или ${BACKUP_FORMAT_VERSION})`);
    }

    if (typeof doc.exportedAt !== 'string' || Number.isNaN(Date.parse(doc.exportedAt))) {
        errors.push('Отсутствует или некорректна дата выгрузки (exportedAt)');
    }

    const data = doc.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        errors.push('Отсутствует блок data');
        return { ok: false, errors };
    }

    // v1 did not have plannedpayments; all five collections are mandatory in
    // v2, including their declared counts.
    const requiredCollections = isLegacy ? LEGACY_BACKUP_COLLECTIONS : BACKUP_COLLECTIONS;
    for (const name of requiredCollections) {
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

    if (isLegacy && Object.prototype.hasOwnProperty.call(data, 'plannedpayments')
        && !Array.isArray(data.plannedpayments)) {
        errors.push('Коллекция "plannedpayments" отсутствует или не является массивом');
    } else if (isLegacy && Array.isArray(data.plannedpayments)) {
        const declared = doc.counts ? doc.counts.plannedpayments : undefined;
        if (typeof declared !== 'number') {
            errors.push('Не указано число записей для "plannedpayments"');
        } else if (declared !== data.plannedpayments.length) {
            errors.push(`Файл повреждён: в "plannedpayments" заявлено ${declared} записей, фактически ${data.plannedpayments.length}`);
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

// Name of the database MongoDB falls back to when the connection string
// carries no database in its path. Reaching it is always a mistake here: it
// means the URI was pasted from Atlas without the database name added, and
// the backup would silently dump an empty stranger of a database.
const DEFAULT_MONGO_DATABASE = 'test';

// Turns the raw observations of check-backup-access.js into a verdict.
// Pure, so every combination is testable without a cluster.
//
// `writeRejected` is the important one: the whole design rests on the
// database refusing writes, so a credential that *can* write is reported as
// a failure even though every read worked perfectly.
function interpretAccessCheck({ databaseName, counts, writeRejected }) {
    const problems = [];
    const notes = [];

    if (databaseName === DEFAULT_MONGO_DATABASE) {
        problems.push(`Подключение ушло в базу "${DEFAULT_MONGO_DATABASE}" - в строке подключения не указано имя базы (должно быть .../ИМЯ_БАЗЫ?...).`);
    }

    if (isEmptyBackup(counts)) {
        problems.push(`Во всех коллекциях пусто (${summarizeCounts(counts)}) - похоже на неверное имя базы или отсутствие прав на неё.`);
    } else {
        notes.push(`Данные читаются: ${summarizeCounts(counts)}`);
    }

    if (writeRejected) {
        notes.push('Запись отклонена базой - учётка действительно только для чтения.');
    } else {
        problems.push('Запись ПРОШЛА. Эта учётка умеет менять данные - это не read-only пользователь. Проверьте роль в Database Access.');
    }

    return { ok: problems.length === 0, problems, notes };
}

// Looks inside a parsed backup and reports both what it contains (so a
// human can recognise their own data) and anything that looks wrong.
//
// This is the offline half of "is my backup good": it needs no database, so
// it can be run on any file at any time. It cannot prove that a restore
// into Mongo succeeds - only an actual restore does that - but it does
// catch the failure this format is most exposed to, which is EJSON that
// parsed but lost its types (dates arriving as plain strings, documents
// with no _id), leaving a file that looks fine until the day it is needed.
function inspectBackupContents(data) {
    const summary = [];
    const problems = [];

    const transactions = data.transactions || [];
    const withoutId = transactions.filter(t => t._id === undefined).length;
    if (withoutId > 0) problems.push(`${withoutId} транзакций без _id`);

    const badDates = transactions.filter(t => !(t.date instanceof Date)).length;
    if (badDates > 0) {
        // A Date that came back as a string means the file was written or
        // re-saved as plain JSON somewhere along the way, and restoring it
        // would put strings into a Date field.
        problems.push(`${badDates} транзакций, где дата не осталась датой (файл пересохраняли обычным JSON?)`);
    }

    const badAmounts = transactions.filter(t => typeof t.amount !== 'number' || !Number.isFinite(t.amount)).length;
    if (badAmounts > 0) problems.push(`${badAmounts} транзакций с некорректной суммой`);

    if (transactions.length > 0) {
        const dates = transactions.map(t => t.date).filter(d => d instanceof Date).sort((a, b) => a - b);
        if (dates.length > 0) {
            summary.push(`Транзакции: ${transactions.length}, с ${dates[0].toISOString().slice(0, 10)} по ${dates[dates.length - 1].toISOString().slice(0, 10)}`);
        }
        // Only finite numbers are summed. A corrupted amount is already
        // reported above as its own problem, and letting a string into this
        // reduce would turn the total into a string and throw on toFixed -
        // crashing the very check that exists to diagnose such a file.
        const total = (type) => transactions
            .filter(t => t.type === type)
            .reduce((sum, t) => (typeof t.amount === 'number' && Number.isFinite(t.amount) ? sum + t.amount : sum), 0);
        summary.push(`Доходов на ${total('income').toFixed(2)}, расходов на ${total('expense').toFixed(2)}`);
    }

    const accounts = data.accounts || [];
    if (accounts.length > 0) {
        summary.push(`Счета (${accounts.length}): ${accounts.map(a => a.name || '<без имени>').join(', ')}`);
    }

    summary.push(`Категории: ${(data.categories || []).length}`);

    // An account id referenced by a transaction but absent from the
    // accounts collection would restore into a database where that
    // transaction can never be attributed to anything.
    const accountIds = new Set(accounts.map(a => String(a._id)));
    const accountIdsWithLegacy = new Set([...accountIds, 'card', 'cash']);
    const orphaned = new Set(
        transactions
            .flatMap(t => [t.account, t.toAccount])
            .filter(id => id !== undefined && id !== null && !accountIdsWithLegacy.has(String(id)))
    );
    if (orphaned.size > 0) {
        problems.push(`Транзакции ссылаются на ${orphaned.size} счёт(ов), которых нет в бэкапе: ${[...orphaned].join(', ')}`);
    }

    const plannedpayments = Array.isArray(data.plannedpayments) ? data.plannedpayments : [];
    const transactionsById = new Map(transactions.map(t => [String(t._id), t]));
    const linkedPlanTransactions = new Set();
    const validDate = value => value instanceof Date && !Number.isNaN(value.getTime());
    plannedpayments.forEach((plan, index) => {
        const label = `План ${index + 1}`;
        if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
            problems.push(`${label}: документ имеет некорректный тип`);
            return;
        }
        if (plan._id === undefined) problems.push(`${label}: отсутствует _id`);
        if (typeof plan.title !== 'string' || plan.title.trim() === '') problems.push(`${label}: некорректный title`);
        if (typeof plan.amount !== 'number' || !Number.isFinite(plan.amount) || plan.amount <= 0) problems.push(`${label}: некорректная положительная сумма`);
        if (!validDate(plan.dueDate)) problems.push(`${label}: некорректная dueDate`);
        if (!['pending', 'paid', 'skipped'].includes(plan.status)) problems.push(`${label}: некорректный status`);
        if (typeof plan.account !== 'string' || !accountIdsWithLegacy.has(String(plan.account))) {
            problems.push(`${label}: отсутствует счёт ${plan.account ?? '<не указан>'}`);
        }
        const hasTransaction = plan.transactionId !== undefined && plan.transactionId !== null;
        const hasPaidAt = plan.paidAt !== undefined && plan.paidAt !== null;
        if (hasTransaction && !transactionsById.has(String(plan.transactionId))) {
            problems.push(`${label}: отсутствует связанная транзакция ${plan.transactionId}`);
        } else if (hasTransaction) {
            if (linkedPlanTransactions.has(String(plan.transactionId))) problems.push(`${label}: транзакция уже связана с другим планом`);
            linkedPlanTransactions.add(String(plan.transactionId));
            const linked = transactionsById.get(String(plan.transactionId));
            if (plan.status === 'paid' && linked?.type !== 'expense') problems.push(`${label}: связанная транзакция должна быть расходом`);
        }
        if (typeof plan.category !== 'string' || plan.category.trim() === '') problems.push(`${label}: некорректная category`);
        if (typeof plan.description !== 'undefined' && typeof plan.description !== 'string') problems.push(`${label}: некорректное description`);
        if (hasPaidAt && !validDate(plan.paidAt)) problems.push(`${label}: некорректная paidAt`);
        if (plan.status === 'paid' && (!hasTransaction || !hasPaidAt)) problems.push(`${label}: paid требует transactionId и paidAt`);
        if (plan.status !== 'paid' && (hasTransaction || hasPaidAt)) problems.push(`${label}: pending/skipped не должны иметь paid-ссылки`);
    });
    if (plannedpayments.length > 0) summary.push(`Разовые платежи: ${plannedpayments.length}`);

    return { ok: problems.length === 0, summary, problems };
}

// Reads every backed-up collection through one snapshot session. The caller
// owns the session (and starts it with { snapshot: true }); all calls remain
// reads, so the backup path still works with a MongoDB user holding only the
// `read` role. Sequential reads are intentional: one session is shared.
async function readAllCollections(db, { session } = {}) {
    if (!session) throw new Error('Для согласованного бэкапа нужна MongoDB snapshot session');
    const collections = {};
    for (const name of BACKUP_COLLECTIONS) {
        collections[name] = await db.collection(name).find({}, { session }).toArray();
    }
    return collections;
}

// Version 1 predates planned payments. Keep its version for reporting while
// supplying the new collection to restore and inspection as an empty array.
function normalizeBackupDocument(doc) {
    if (!doc || typeof doc !== 'object' || doc.formatVersion !== LEGACY_BACKUP_FORMAT_VERSION) return doc;
    const hasPlannedpayments = Array.isArray(doc.data?.plannedpayments);
    const plannedpayments = hasPlannedpayments ? doc.data.plannedpayments : [];
    const counts = { ...(doc.counts || {}) };
    if (!hasPlannedpayments) counts.plannedpayments = 0;
    return {
        ...doc,
        data: { ...doc.data, plannedpayments },
        counts
    };
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
async function restoreCollections(db, data, { replace = false, session } = {}) {
    if (!session) throw new Error('Восстановление требует MongoDB transaction session');
    if (typeof session.withTransaction !== 'function') {
        throw new Error('Восстановление требует MongoDB session.withTransaction');
    }

    const missing = BACKUP_COLLECTIONS.filter(name => !Array.isArray(data?.[name]));
    if (missing.length > 0) throw new Error(`Восстановление требует коллекции: ${missing.join(', ')}`);
    const normalizedData = data;
    const restored = {};
    await session.withTransaction(async () => {
        // Repeat the non-empty guard inside the transaction. The CLI preflight
        // is useful UX, but checking only there leaves a race before deleteMany.
        if (!replace) {
            const existing = await countAllCollections(db, { session });
            const nonEmpty = BACKUP_COLLECTIONS.filter(name => existing[name] > 0);
            if (nonEmpty.length > 0) {
                throw new Error(`Целевая база не пуста: ${nonEmpty.join(', ')}`);
            }
        }

        for (const name of BACKUP_COLLECTIONS) {
            const documents = normalizedData[name];
            if (replace) await db.collection(name).deleteMany({}, { session });
            if (documents.length > 0) await db.collection(name).insertMany(documents, { session });
            restored[name] = documents.length;
        }
    }, {
        readConcern: { level: 'snapshot' },
        writeConcern: { w: 'majority' },
        readPreference: 'primary'
    });
    return restored;
}

// Current per-collection document counts, used to decide whether the target
// is safe to restore onto.
async function countAllCollections(db, { session } = {}) {
    const counts = {};
    for (const name of BACKUP_COLLECTIONS) {
        counts[name] = await db.collection(name).countDocuments({}, session ? { session } : undefined);
    }
    return counts;
}

module.exports = {
    BACKUP_COLLECTIONS,
    LEGACY_BACKUP_COLLECTIONS,
    LEGACY_BACKUP_FORMAT_VERSION,
    BACKUP_FILENAME_PATTERN,
    DEFAULT_MONGO_DATABASE,
    inspectBackupContents,
    interpretAccessCheck,
    selectBackupsToDelete,
    countAllCollections,
    readAllCollections,
    restoreCollections,
    BACKUP_FORMAT_VERSION,
    formatBackupFilename,
    buildBackupDocument,
    validateBackupDocument,
    summarizeCounts,
    isEmptyBackup,
    normalizeBackupDocument
};
