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
    // 02.12.2025 Депозит Перевод -€500,00 €500,00 (Cash -> Card)
    { date: '2025-12-02', title: 'Депозит (взнос)', type: 'transfer', amount: 500.00, category: 'Обмен', account: 'cash', toAccount: 'card' },

    // 03.12.2025 Депозит Перевод -€100,00 €100,00 (Cash -> Card)
    { date: '2025-12-03', title: 'Депозит (взнос)', type: 'transfer', amount: 100.00, category: 'Обмен', account: 'cash', toAccount: 'card' },

    // 03.12.2025 Зарплата Доход €0,00 €2 656,50 (Card)
    { date: '2025-12-03', title: 'Зарплата', type: 'income', amount: 2656.50, category: 'Зарплата', account: 'card' },

    // 03.12.2025 Комиссии, обед Расход -€11,85 -€14,00 (Split)
    { date: '2025-12-03', title: 'Обед', type: 'expense', amount: 11.85, category: 'Еда вне дома', account: 'cash' },
    { date: '2025-12-03', title: 'Комиссия', type: 'expense', amount: 14.00, category: 'Услуги', account: 'card' },

    // 04.12.2025 Педикюр, кофе Расход -€105,00 €0,00 (Cash)
    { date: '2025-12-04', title: 'Педикюр, кофе', type: 'expense', amount: 105.00, category: 'Красота', account: 'cash' },

    // 05.12.2025 Комиссии Расход €0,00 -€7,50 (Card)
    { date: '2025-12-05', title: 'Комиссия', type: 'expense', amount: 7.50, category: 'Услуги', account: 'card' },

    // 06.12.2025 Обед, одежда, подарок Веронике Расход -€150,00 €0,00 (Cash)
    { date: '2025-12-06', title: 'Обед, одежда, подарок', type: 'expense', amount: 150.00, category: 'Шопинг', account: 'cash' },

    // 07.12.2025 Кальян Расход -€35,00 €0,00 (Cash)
    { date: '2025-12-07', title: 'Кальян', type: 'expense', amount: 35.00, category: 'Развлечения', account: 'cash' },

    // 07.12.2025 Неопознанные траты Расход -€1 444,84 €0,00 (Cash)
    { date: '2025-12-07', title: 'Неопознанные траты', type: 'expense', amount: 1444.84, category: 'Другое', account: 'cash' },

    // 08.12.2025 Гарантия Расход €0,00 -€670,00 (Card)
    { date: '2025-12-08', title: 'Гарантия (депозит)', type: 'expense', amount: 670.00, category: 'Услуги', account: 'card' },

    // 09.12.2025 Косметика, ужин, фото Расход -€45,00 -€196,10 (Split)
    { date: '2025-12-09', title: 'Ужин, фото', type: 'expense', amount: 45.00, category: 'Еда вне дома', account: 'cash' },
    { date: '2025-12-09', title: 'Косметика', type: 'expense', amount: 196.10, category: 'Шопинг', account: 'card' },

    // 10.12.2025 Обувница Расход €0,00 -€54,09 (Card)
    { date: '2025-12-10', title: 'Обувница', type: 'expense', amount: 54.09, category: 'Шопинг', account: 'card' },
];

async function importDecember() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');

        for (const item of data) {
            const tx = new Transaction(item);
            await tx.save();
            console.log(`Saved Dec: ${item.date} - ${item.title} [${item.account}]`);
        }

        console.log('Successfully imported December transactions!');
        process.exit(0);
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

importDecember();
