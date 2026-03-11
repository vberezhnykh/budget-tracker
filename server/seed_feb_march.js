const mongoose = require('mongoose');
const Transaction = require('./models/Transaction');
require('dotenv').config();

const seedData = [
    // February 2026 (Historical)
    { title: 'Зарплата Февраль', amount: 100000, type: 'income', category: 'Зарплата', date: '2026-02-01', account: 'card' },
    { title: 'Аренда Февраль', amount: 30000, type: 'expense', category: 'Жилье', date: '2026-02-02', account: 'card' },
    { title: 'Продукты Февраль 1', amount: 5000, type: 'expense', category: 'Еда', date: '2026-02-05', account: 'card' },
    { title: 'Продукты Февраль 2', amount: 4500, type: 'expense', category: 'Еда', date: '2026-02-10', account: 'cash' },
    { title: 'Ресторан Февраль', amount: 3000, type: 'expense', category: 'Еда', date: '2026-02-11', account: 'card' },
    
    // March 2026 (Current)
    { title: 'Зарплата Март', amount: 105000, type: 'income', category: 'Зарплата', date: '2026-03-01', account: 'card' },
    { title: 'Аренда Март', amount: 30000, type: 'expense', category: 'Жилье', date: '2026-03-02', account: 'card' },
    { title: 'Продукты Март 1', amount: 6000, type: 'expense', category: 'Еда', date: '2026-03-05', account: 'card' },
    { title: 'Продукты Март 2', amount: 5500, type: 'expense', category: 'Еда', date: '2026-03-10', account: 'cash' },
];

async function seed() {
    try {
        const isProduction = process.env.NODE_ENV === 'production';
        const dbOptions = !isProduction ? { dbName: 'budget-tracker-dev' } : {};

        await mongoose.connect(process.env.MONGODB_URI, dbOptions);
        console.log('Connected to DB for seeding Feb/March data...');

        await Transaction.insertMany(seedData);
        console.log('Successfully added test transactions for Feb and March!');

        await mongoose.disconnect();
        console.log('Disconnected.');
    } catch (err) {
        console.error('Error seeding data:', err);
        process.exit(1);
    }
}

seed();
