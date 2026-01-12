const mongoose = require('mongoose');
const Transaction = require('./models/Transaction');
require('dotenv').config();

const seedData = [
    { title: 'Продукты в Пятерочке', amount: 1500, type: 'expense', category: 'Еда', date: '2026-01-10', account: 'cash' },
    { title: 'Зарплата', amount: 120000, type: 'income', category: 'Зарплата', date: '2026-01-05', account: 'card' },
    { title: 'Кино и попкорн', amount: 800, type: 'expense', category: 'Развлечения', date: '2026-01-11', account: 'card' },
    { title: 'Такси в аэропорт', amount: 2200, type: 'expense', category: 'Транспорт', date: '2026-01-08', account: 'card' },
    { title: 'Кофе с собой', amount: 350, type: 'expense', category: 'Еда', date: '2026-01-12', account: 'cash' },
    { title: 'Подписка Netflix', amount: 900, type: 'expense', category: 'Развлечения', date: '2026-01-01', account: 'card' },
    { title: 'Кешбэк', amount: 450, type: 'income', category: 'Другое', date: '2026-01-12', account: 'card' },
    { title: 'Оплата интернета', amount: 600, type: 'expense', category: 'Счета', date: '2026-01-02', account: 'card' },
    { title: 'Новые кроссовки', amount: 8500, type: 'expense', category: 'Шоппинг', date: '2026-01-07', account: 'card' },
    { title: 'Ужин в ресторане', amount: 4200, type: 'expense', category: 'Еда', date: '2026-01-09', account: 'card' }
];

async function seed() {
    try {
        const isProduction = process.env.NODE_ENV === 'production';
        const dbOptions = !isProduction ? { dbName: 'budget-tracker-dev' } : {};

        await mongoose.connect(process.env.MONGODB_URI, dbOptions);
        console.log('Connected to DB for seeding...');

        await Transaction.insertMany(seedData);
        console.log('Successfully added 10 random transactions!');

        await mongoose.disconnect();
        console.log('Disconnected.');
    } catch (err) {
        console.error('Error seeding data:', err);
        process.exit(1);
    }
}

seed();
