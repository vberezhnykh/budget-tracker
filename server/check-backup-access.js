// Verifies that MONGODB_BACKUP_URI is set up the way the backup expects:
// it reaches the right database, it can read the data, and - the point of
// the whole arrangement - the database refuses to let it write.
//
//   node server/check-backup-access.js
//
// Run this once after creating the read-only MongoDB user, before trusting
// any scheduled backup. Every failure it reports is one that would otherwise
// show up either as a silently empty backup file, or as an assistant that
// turns out to have been able to delete data all along.

const { MongoClient } = require('mongodb');
const {
    countAllCollections,
    interpretAccessCheck
} = require('./backup-core');

require('dotenv').config();

// A collection of its own, so the write attempt can never land in real data
// even when it unexpectedly succeeds.
const PROBE_COLLECTION = '__backup_access_check';

// Tries a single insert and reports whether the database refused it.
//
// If the insert *does* go through, the document is removed again right away:
// this script must not leave anything behind in a database it was only
// supposed to be looking at.
async function probeWriteAccess(db) {
    try {
        const result = await db.collection(PROBE_COLLECTION).insertOne({ probedAt: new Date() });
        try {
            await db.collection(PROBE_COLLECTION).deleteOne({ _id: result.insertedId });
            await db.collection(PROBE_COLLECTION).drop().catch(() => {});
        } catch (cleanupError) {
            console.warn(`Не удалось убрать пробную запись из ${PROBE_COLLECTION}: ${cleanupError.message}`);
        }
        return { writeRejected: false };
    } catch (err) {
        return { writeRejected: true, reason: err.message };
    }
}

async function main() {
    const uri = process.env.MONGODB_BACKUP_URI;
    if (!uri) {
        console.error('MONGODB_BACKUP_URI не задан в server/.env. См. server/.env.example.');
        process.exitCode = 1;
        return;
    }

    const client = new MongoClient(uri);
    try {
        await client.connect();
        const db = client.db();

        console.log(`База: ${db.databaseName}`);

        const counts = await countAllCollections(db);
        const { writeRejected, reason } = await probeWriteAccess(db);

        const { ok, problems, notes } = interpretAccessCheck({
            databaseName: db.databaseName,
            counts,
            writeRejected
        });

        for (const note of notes) console.log(`  ✓ ${note}`);
        for (const problem of problems) console.error(`  ✗ ${problem}`);

        if (writeRejected && reason) {
            console.log(`\n  (отказ базы: ${reason})`);
        }

        if (ok) {
            console.log('\nВсё в порядке - можно ставить бэкап по расписанию.');
        } else {
            console.error('\nЕсть проблемы, перечисленные выше. Бэкап пока настраивать рано.');
            process.exitCode = 1;
        }
    } finally {
        await client.close();
    }
}

if (require.main === module) {
    main().catch(err => {
        // A bad password, an unreachable cluster and an IP that is not on
        // the access list all surface here, and the driver's own message is
        // more specific than anything this script could invent.
        console.error('Проверка не удалась:', err.message);
        process.exitCode = 1;
    });
}

module.exports = { PROBE_COLLECTION, probeWriteAccess };
