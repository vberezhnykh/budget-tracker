// Checks a backup file without touching any database.
//
//   node server/verify-backup.js <файл>
//
// Answers "is this file a complete, intact backup of my data" - structure,
// declared counts, preserved types, internal consistency - and prints what
// it contains so a human can recognise it as their own.
//
// What it deliberately does NOT prove: that restoring the file into MongoDB
// succeeds. Only an actual restore into a scratch database proves that.
// This is the cheap check that can be run on every file, not a replacement
// for rehearsing the restore once.

const fs = require('fs');
const { EJSON } = require('bson');
const {
    inspectBackupContents,
    summarizeCounts,
    validateBackupDocument,
    normalizeBackupDocument
} = require('./backup-core');

function main() {
    const file = process.argv[2];
    if (!file) {
        console.error('Использование: node server/verify-backup.js <файл>');
        process.exitCode = 1;
        return;
    }

    let doc;
    try {
        doc = EJSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
        console.error(`Файл не читается или не разбирается: ${err.message}`);
        process.exitCode = 1;
        return;
    }

    const structure = validateBackupDocument(doc);
    if (!structure.ok) {
        console.error('Структура файла повреждена:');
        for (const error of structure.errors) console.error(`  ✗ ${error}`);
        process.exitCode = 1;
        return;
    }
    const normalizedDoc = normalizeBackupDocument(doc);

    console.log(`Бэкап от ${normalizedDoc.exportedAt}`);
    console.log(`Заявлено: ${summarizeCounts(normalizedDoc.counts)}`);
    console.log('');

    const { ok, summary, problems } = inspectBackupContents(normalizedDoc.data);
    for (const line of summary) console.log(`  ${line}`);

    if (ok) {
        console.log('\nФайл целый и внутренне непротиворечивый.');
        console.log('Сверьте числа выше со своими данными - узнать их может только человек.');
    } else {
        console.error('');
        for (const problem of problems) console.error(`  ✗ ${problem}`);
        process.exitCode = 1;
    }
}

if (require.main === module) {
    main();
}

module.exports = { main };
