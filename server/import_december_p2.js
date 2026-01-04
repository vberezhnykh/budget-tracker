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
    // 11.12.2025 Оплата счетов Расход €0,00 -€65,48 (Card)
    { date: '2025-12-11', title: 'Оплата счетов', type: 'expense', amount: 65.48, category: 'Жилье', account: 'card' },

    // 12.12.2025 Ужин Расход -€40,00 €0,00 (Cash)
    { date: '2025-12-12', title: 'Ужин', type: 'expense', amount: 40.00, category: 'Еда вне дома', account: 'cash' },

    // 13.12.2025 Вода, мороженое, обед, кальян, продукты Расход -€206,00 €0,00 (Cash)
    { date: '2025-12-13', title: 'Вода, продукты, кальян', type: 'expense', amount: 206.00, category: 'Продукты', account: 'cash' },

    // 14.12.2025 Курсы английского Расход €0,00 -€17,58 (Card)
    { date: '2025-12-14', title: 'Курсы английского', type: 'expense', amount: 17.58, category: 'Услуги', account: 'card' },

    // 15.12.2025 Компенсация квартиры Доход €1 895,00 €0,00 (Cash)
    { date: '2025-12-15', title: 'Компенсация квартиры', type: 'income', amount: 1895.00, category: 'Жилье', account: 'cash' },

    // 18.12.2025 Кальянная, товары для дома Расход -€90,00 €0,00 (Cash)
    { date: '2025-12-18', title: 'Кальянная, товары для дома', type: 'expense', amount: 90.00, category: 'Развлечения', account: 'cash' },

    // 19.12.2025 Аренда квартиры, обед, продукты, ужин Расход -€175,00 -€1 890.00 (Split)
    { date: '2025-12-19', title: 'Аренда квартиры', type: 'expense', amount: 1890.00, category: 'Жилье', account: 'card' },
    { date: '2025-12-19', title: 'Обед, продукты, ужин', type: 'expense', amount: 175.00, category: 'Еда вне дома', account: 'cash' },

    // 20.12.2025 Аренда машины, бензин, обед Расход -€1 566,00 €0,00 (Cash)
    { date: '2025-12-20', title: 'Аренда машины, бензин, обед', type: 'expense', amount: 1566.00, category: 'Транспорт', account: 'cash' },
];

async function importPart2() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');

        for (const item of data) {
            const tx = new Transaction(item);
            await tx.save();
            console.log(`Saved: ${item.date} - ${item.title}`);
        }

        console.log('Successfully imported Part 2 of December!');
        process.exit(0);
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

importPart2();
