// Read-only backup of the whole database to a single EJSON file.
//
//   node server/backup.js [--out <dir>] [--keep <n>]
//
// Connects with MONGODB_BACKUP_URI when set, falling back to MONGODB_URI.
// The separate variable is the point of this script: give the assistant (or
// a cron job) a MongoDB user with only the `read` role and point
// MONGODB_BACKUP_URI at it, so write access is refused by the database
// itself rather than by our own code. See server/.env.example.
//
// EJSON rather than plain JSON.stringify: it round-trips ObjectId, Date and
// the numeric types instead of flattening them to strings, so a restore
// reproduces the documents rather than a lossy approximation of them.
//
// Nothing here writes to Mongo. The only calls made are .find() reads.

const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const { EJSON } = require('bson');
const {
    buildBackupDocument,
    formatBackupFilename,
    isEmptyBackup,
    readAllCollections,
    selectBackupsToDelete,
    summarizeCounts
} = require('./backup-core');

require('dotenv').config();

function parseArgs(argv) {
    const args = { out: path.join(__dirname, '..', 'backups'), keep: null };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--out') {
            const value = argv[i + 1];
            if (!value) throw new Error('--out требует путь к каталогу');
            args.out = value;
            i++;
        } else if (argv[i] === '--keep') {
            const value = argv[i + 1];
            const parsed = Number(value);
            // Rejected rather than defaulted: a mistyped --keep silently
            // falling back to some number would either delete backups the
            // user meant to keep, or quietly keep growing the directory.
            if (!Number.isInteger(parsed) || parsed < 1) {
                throw new Error('--keep требует целое число не меньше 1');
            }
            args.keep = parsed;
            i++;
        }
    }
    return args;
}

// Rotation runs only after the new backup has been written successfully, so
// a failed run can never delete an older backup on its way out.
function rotateBackups(directory, keep) {
    const stale = selectBackupsToDelete(fs.readdirSync(directory), keep);
    for (const name of stale) {
        fs.unlinkSync(path.join(directory, name));
    }
    return stale;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const uri = process.env.MONGODB_BACKUP_URI || process.env.MONGODB_URI;
    if (!uri) {
        console.error('Не задан MONGODB_BACKUP_URI (или MONGODB_URI). См. server/.env.example.');
        process.exitCode = 1;
        return;
    }
    if (!process.env.MONGODB_BACKUP_URI) {
        console.warn('MONGODB_BACKUP_URI не задан - используется MONGODB_URI, то есть учётка с правом записи. Для регулярных бэкапов заведите отдельного пользователя с ролью read.');
    }

    const client = new MongoClient(uri);
    try {
        await client.connect();
        const db = client.db();

        const doc = buildBackupDocument(await readAllCollections(db));

        if (isEmptyBackup(doc.counts)) {
            // Failing here rather than writing the file keeps a
            // misconfigured run (wrong database in the URI, or a user
            // without rights to it) from rotating a good backup out.
            console.error(`Все коллекции пусты - похоже на неверную базу в строке подключения или недостаточные права. Файл не записан. (${summarizeCounts(doc.counts)})`);
            process.exitCode = 1;
            return;
        }

        fs.mkdirSync(args.out, { recursive: true });
        const filePath = path.join(args.out, formatBackupFilename(new Date(doc.exportedAt)));
        // Written with mode 0600: this file is the entire family's financial
        // history in plain text.
        fs.writeFileSync(filePath, EJSON.stringify(doc, null, 2), { mode: 0o600 });

        console.log(`Бэкап записан: ${filePath}`);
        console.log(summarizeCounts(doc.counts));

        if (args.keep !== null) {
            const removed = rotateBackups(args.out, args.keep);
            if (removed.length > 0) {
                console.log(`Удалено старых бэкапов: ${removed.length} (оставлено последних ${args.keep})`);
            }
        }
    } finally {
        await client.close();
    }
}

if (require.main === module) {
    main().catch(err => {
        console.error('Бэкап не выполнен:', err.message);
        process.exitCode = 1;
    });
}

module.exports = { parseArgs };
