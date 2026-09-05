const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const Transaction = require('./models/Transaction');

async function checkTransfers() {
    try {
        await mongoose.connect(process.env.MONGODB_URI, { dbName: 'budget-tracker-dev' });
        const transfers = await Transaction.find({ type: 'transfer' });
        
        let missingToAccount = 0;
        let sumMissing = 0;
        
        transfers.forEach(t => {
            if (!t.toAccount) {
                missingToAccount++;
                sumMissing += t.amount;
                console.log(`Transfer missing toAccount: ${t.date.toISOString().split('T')[0]} | ${t.amount} | From: ${t.account}`);
            }
        });
        
        console.log(`\nTotal transfers missing toAccount: ${missingToAccount}`);
        console.log(`Sum of missing destinations: ${sumMissing}`);
        
        await mongoose.disconnect();
    } catch (e) {
        console.error(e);
    }
}

checkTransfers();
