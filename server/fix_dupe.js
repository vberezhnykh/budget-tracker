const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const Transaction = require('./models/Transaction');

async function fix() {
    try {
        await mongoose.connect(process.env.MONGODB_URI, { dbName: 'budget-tracker-dev' });
        const txs = await Transaction.find({ title: 'Стартовый баланс' });
        console.log("DEV DB TXS:", txs);
        
        await mongoose.disconnect();
    } catch (e) {
        console.error(e);
    }
}

fix();
