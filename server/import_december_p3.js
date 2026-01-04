const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '.env') });

const TransactionSchema = new mongoose.Schema({
    title: String,
    amount: Number,
    type: { type: String, enum: ['income', 'expense', 'initial', 'transfer'] },
    category: String,
    description: String,
    account: { type: String, enum: ['card', 'cash'], default: 'cash' },
    toAccount: { type: String, enum: ['card', 'cash'] },
    date: { type: Date, default: Date.now }
});

const Transaction = mongoose.model('Transaction', TransactionSchema);

const data = [
    // 21.12.2025 Кофе, продукты, кальян Расход -€157,00 €0,00 (Cash)
    { date: '2025-12-21', title: 'Кофе, продукты, кальян', type: 'expense', amount: 157.00, category: 'Продукты', account: 'cash' },

    // 22.12.2025 Кроссовки, билеты на Анакондаз Расход €0,00 -€185,40 (Card)
    { date: '2025-12-22', title: 'Анакондаз, кроссовки', type: 'expense', amount: 185.40, category: 'Развлечения', account: 'card' },

    // 23.12.2025 Ветеринар, комиссия Расход -€50,00 -€4,00 (Split)
    { date: '2025-12-23', title: 'Ветеринар', type: 'expense', amount: 50.00, category: 'Питомцы', account: 'cash' },
    { date: '2025-12-23', title: 'Комиссия', type: 'expense', amount: 4.00, category: 'Услуги', account: 'card' },

    // 23.12.2025 Зарплата Доход €0,00 €3 542,00 (Card)
    { date: '2025-12-23', title: 'Зарплата', type: 'income', amount: 3542.00, category: 'Зарплата', account: 'card' },

    // 24.12.2025 Подарок начальнице Расход -€10,00 €0,00 (Cash)
    { date: '2025-12-24', title: 'Подарок начальнице', type: 'expense', amount: 10.00, category: 'Другое', account: 'cash' },

    // 25.12.2025 Обед, аэрогриль Расход -€65,00 €0,00 (Cash)
    { date: '2025-12-25', title: 'Обед, аэрогриль', type: 'expense', amount: 65.00, category: 'Шопинг', account: 'cash' },

    // 25.12.2025 Зарплата Доход €2 500,00 €0,00 (Cash)
    { date: '2025-12-25', title: 'Зарплата (бонус)', type: 'income', amount: 2500.00, category: 'Зарплата', account: 'cash' },

    // 26.12.2025 Продукты Расход -€45,00 €0,00 (Cash)
    { date: '2025-12-26', title: 'Продукты', type: 'expense', amount: 45.00, category: 'Продукты', account: 'cash' },

    // 27.12.2025 Кальян, книга, сладости Расход -€70,00 €0,00 (Cash)
    { date: '2025-12-27', title: 'Кальян, книга, сладости', type: 'expense', amount: 70.00, category: 'Развлечения', account: 'cash' },

    // 28.12.2025 Одежда, косметика, велосипед, комплектующие, бензин Расход -€765,00 €0,00 (Cash)
    { date: '2025-12-28', title: 'Велосипед, одежда, бензин', type: 'expense', amount: 765.00, category: 'Транспорт', account: 'cash' },

    // 29.12.2025 Зоомагазин, продукты Расход -€180,00 €0,00 (Cash)
    { date: '2025-12-29', title: 'Зоомагазин, продукты', type: 'expense', amount: 180.00, category: 'Питомцы', account: 'cash' },

    // 30.12.2025 Депозит водоканал, насос, обед Расход -€60,00 -€250,00 (Split)
    { date: '2025-12-30', title: 'Насос, обед', type: 'expense', amount: 60.00, category: 'Шопинг', account: 'cash' },
    { date: '2025-12-30', title: 'Депозит водоканал', type: 'expense', amount: 250.00, category: 'Жилье', account: 'card' },

    // 31.12.2025 Продукты, обслуживание карты Расход -€5,00 -€35,00 (Split)
    { date: '2025-12-31', title: 'Продукты', type: 'expense', amount: 5.00, category: 'Продукты', account: 'cash' },
    { date: '2025-12-31', title: 'Обслуживание карты', type: 'expense', amount: 35.00, category: 'Услуги', account: 'card' },
];

async function importPart3() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');

        for (const item of data) {
            const tx = new Transaction(item);
            await tx.save();
            console.log(`Saved: ${item.date} - ${item.title}`);
        }

        console.log('Successfully imported End of December!');
        process.exit(0);
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

importPart3();
