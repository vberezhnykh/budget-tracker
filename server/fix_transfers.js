const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const Transaction = require('./models/Transaction');

async function fixTransfersInDB(dbName) {
    let options = {};
    if (dbName) {
        options.dbName = dbName;
        console.log(`\n⏳ Подключение к базе: ${dbName}...`);
    } else {
        console.log(`\n⏳ Подключение к основной (prod) базе...`);
    }

    const conn = await mongoose.createConnection(process.env.MONGODB_URI, options).asPromise();
    // Register the schema manually on this connection since we used createConnection
    const TxModel = conn.model('Transaction', Transaction.schema);

    const transfers = await TxModel.find({ type: 'transfer' });
    let fixedCount = 0;
    
    for (const t of transfers) {
        if (!t.toAccount) {
            // Если переводили с cash, значит получатель card. И наоборот.
            const destination = (t.account === 'cash') ? 'card' : 'cash';
            
            t.toAccount = destination;
            await t.save();
            fixedCount++;
            console.log(`✅ [${dbName || 'prod'}] Восстановлен перевод: -> ${destination} (${t.amount}€)`);
        }
    }
    
    console.log(`🎉 Исправлено ${fixedCount} переводов в ${dbName || 'prod'}.`);
    await conn.close();
}

async function run() {
    try {
        await fixTransfersInDB(null); // Prod DB
        await fixTransfersInDB('budget-tracker-dev'); // Dev DB
        console.log('\n✅ Все переводы успешно восстановлены!');
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

run();
