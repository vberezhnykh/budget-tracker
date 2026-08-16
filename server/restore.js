// Restores a backup produced by server/backup.js.
//
//   node server/restore.js <файл> --yes [--replace]
//
// Deliberately a CLI script and not an HTTP endpoint: there is no route
// anywhere in this app that can write a whole database, so no token, bug or
// injected instruction reaching the assistant can trigger a restore. It
// takes a shell and the write credentials.
//
// Two guards, because this is the one operation here that can destroy data:
//   - --yes is required; without it the script only reports what it would do.
//   - a non-empty target collection is refused unless --replace is passed,
//     so an accidental restore onto a live database stops instead of
//     merging a stale dump into current data.
//
// Uses MONGODB_URI (the read-write credential) and never MONGODB_BACKUP_URI,
// which is expected to be a read-only user.

const fs = require('fs');
const { MongoClient } = require('mongodb');
const { EJSON } = require('bson');
const {
    BACKUP_COLLECTIONS,
    countAllCollections,
    restoreCollections,
    summarizeCounts,
    validateBackupDocument
} = require('./backup-core');

require('dotenv').config();

function parseArgs(argv) {
    const args = { file: null, confirmed: false, replace: false };
    for (const arg of argv) {
        if (arg === '--yes') args.confirmed = true;
        else if (arg === '--replace') args.replace = true;
        else if (!arg.startsWith('--') && args.file === null) args.file = arg;
    }
    return args;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (!args.file) {
        console.error('Использование: node server/restore.js <файл> --yes [--replace]');
        process.exitCode = 1;
        return;
    }

    const doc = EJSON.parse(fs.readFileSync(args.file, 'utf8'));
    const { ok, errors } = validateBackupDocument(doc);
    if (!ok) {
        console.error('Файл бэкапа не прошёл проверку:');
        for (const error of errors) console.error(`  - ${error}`);
        process.exitCode = 1;
        return;
    }

    const uri = process.env.MONGODB_URI;
    if (!uri) {
        console.error('Не задан MONGODB_URI.');
        process.exitCode = 1;
        return;
    }

    const client = new MongoClient(uri);
    try {
        await client.connect();
        const db = client.db();

        console.log(`Бэкап от ${doc.exportedAt}`);
        console.log(`Содержимое: ${summarizeCounts(doc.counts)}`);
        console.log(`Целевая база: ${db.databaseName}`);

        const existing = await countAllCollections(db);
        console.log(`Сейчас в базе: ${summarizeCounts(existing)}`);

        const nonEmpty = BACKUP_COLLECTIONS.filter(name => existing[name] > 0);
        if (nonEmpty.length > 0 && !args.replace) {
            console.error(`\nБаза не пуста (${nonEmpty.join(', ')}). Восстановление отменено.`);
            console.error('Добавьте --replace, чтобы удалить текущее содержимое этих коллекций и заменить его бэкапом.');
            process.exitCode = 1;
            return;
        }

        if (!args.confirmed) {
            console.log('\nЭто пробный запуск - ничего не изменено. Добавьте --yes, чтобы применить.');
            return;
        }

        const restored = await restoreCollections(db, doc.data, { replace: args.replace });
        console.log(`Восстановлено: ${summarizeCounts(restored)}`);
    } finally {
        await client.close();
    }
}

if (require.main === module) {
    main().catch(err => {
        console.error('Восстановление не выполнено:', err.message);
        process.exitCode = 1;
    });
}

module.exports = { parseArgs };
