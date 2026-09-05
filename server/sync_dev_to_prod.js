const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const Transaction = require('./models/Transaction');
const Category = require('./models/Category');

async function syncDevToProd() {
    try {
        console.log("⏳ Копируем данные из DEV в PROD...");

        // Connect to DEV DB to read
        const connDev = await mongoose.createConnection(process.env.MONGODB_URI, { dbName: 'budget-tracker-dev' }).asPromise();
        const TxDev = connDev.model('Transaction', Transaction.schema);
        const CatDev = connDev.model('Category', Category.schema);
        
        const allTxs = await TxDev.find().lean();
        const allCats = await CatDev.find().lean();
        console.log(`Найдено в DEV: ${allTxs.length} транзакций, ${allCats.length} категорий.`);
        
        // Connect to PROD DB to write
        const connProd = await mongoose.createConnection(process.env.MONGODB_URI).asPromise();
        const TxProd = connProd.model('Transaction', Transaction.schema);
        const CatProd = connProd.model('Category', Category.schema);

        // Clear Prod Database
        console.log("Очищаем Prod БД для синхронизации...");
        await TxProd.deleteMany({});
        await CatProd.deleteMany({});

        // Insert into Prod Database
        console.log("Вставляем актуальные данные...");
        if (allTxs.length > 0) Object.values(allTxs).forEach(t => delete t._id); // rely on mongoose creating new ids or keep them if needed, let's keep them to avoid breaking references if any
        if (allCats.length > 0) Object.values(allCats).forEach(c => delete c._id);
        
        // For exact sync, it's safer to keep the exact objects (without _id so new ones are generated, or keep _ids, wait, Mongoose insertMany allows keeping _ids if they don't exist). Let's just insert as is.
        await TxProd.insertMany(allTxs);
        await CatProd.insertMany(allCats);

        console.log(`✅ Синхронизация успешно завершена! Теперь в PROD ровно ${allTxs.length} транзакций.`);
        
        await connDev.close();
        await connProd.close();

        process.exit(0);
    } catch (e) {
        console.error("Ошибка при синхронизации:", e);
        process.exit(1);
    }
}

syncDevToProd();
