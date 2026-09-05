const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const Transaction = require('./models/Transaction');

async function checkDatabases() {
    try {
        console.log("URI from .env:", process.env.MONGODB_URI);
        
        // 1. Check Prod Database (budget-tracker)
        const connProd = await mongoose.createConnection(process.env.MONGODB_URI).asPromise();
        const TxProd = connProd.model('Transaction', Transaction.schema);
        const countProd = await TxProd.countDocuments();
        console.log(`\n=== PROD DB (budget-tracker) ===`);
        console.log(`Transactions: ${countProd}`);
        
        const latestProd = await TxProd.find().sort({date: -1}).limit(2);
        console.log(`Latest 2 transactions in Prod:`, latestProd.map(t => `${t.date.toISOString().split('T')[0]} | ${t.title} | ${t.amount}`));
        await connProd.close();

        // 2. Check Dev Database (budget-tracker-dev)
        const connDev = await mongoose.createConnection(process.env.MONGODB_URI, { dbName: 'budget-tracker-dev' }).asPromise();
        const TxDev = connDev.model('Transaction', Transaction.schema);
        const countDev = await TxDev.countDocuments();
        console.log(`\n=== DEV DB (budget-tracker-dev) ===`);
        console.log(`Transactions: ${countDev}`);
        
        const latestDev = await TxDev.find().sort({date: -1}).limit(2);
        console.log(`Latest 2 transactions in Dev:`, latestDev.map(t => `${t.date.toISOString().split('T')[0]} | ${t.title} | ${t.amount}`));
        await connDev.close();

        // 3. Check 'test' database (default if omitted from URI)
        const connTest = await mongoose.createConnection(process.env.MONGODB_URI, { dbName: 'test' }).asPromise();
        const TxTest = connTest.model('Transaction', Transaction.schema);
        const countTest = await TxTest.countDocuments();
        console.log(`\n=== TEST DB (default if db omitted) ===`);
        console.log(`Transactions: ${countTest}`);
        if(countTest > 0) {
           const latestTest = await TxTest.find().sort({date: -1}).limit(2);
           console.log(`Latest 2 transactions in Test:`, latestTest.map(t => `${t.date.toISOString().split('T')[0]} | ${t.title} | ${t.amount}`));
        }
        await connTest.close();

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

checkDatabases();
