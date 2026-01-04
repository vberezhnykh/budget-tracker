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
    { date: '2025-11-16', title: 'Такси, продукты', type: 'expense', amount: 175.00, category: 'Транспорт' },
    { date: '2025-11-17', title: 'Продукты', type: 'expense', amount: 49.81, category: 'Продукты' },
    { date: '2025-11-18', title: 'Продукты', type: 'expense', amount: 19.79, category: 'Продукты' },
    { date: '2025-11-20', title: 'Продукты', type: 'expense', amount: 18.90, category: 'Продукты' },
    { date: '2025-11-21', title: 'Ужин, машина', type: 'expense', amount: 850.00, category: 'Транспорт' },
    { date: '2025-11-22', title: 'Продукты, ИКЕА, кофе', type: 'expense', amount: 247.58, category: 'Шопинг' },
    { date: '2025-11-23', title: 'Кальянная', type: 'expense', amount: 70.00, category: 'Развлечения' },
    { date: '2025-11-25', title: 'Бензин', type: 'expense', amount: 20.00, category: 'Транспорт' },
    { date: '2025-11-26', title: 'Обед', type: 'expense', amount: 9.88, category: 'Еда вне дома' },
    { date: '2025-11-27', title: 'Маникюр, продукты', type: 'expense', amount: 60.00, category: 'Красота' },
    { date: '2025-11-27', title: 'Зарплата', type: 'income', amount: 2600.00, category: 'Зарплата' },
    { date: '2025-11-28', title: 'Обмен валюты', type: 'income', amount: 500.00, category: 'Другое' },
    { date: '2025-11-29', title: 'Ужин, продукты', type: 'expense', amount: 60.00, category: 'Еда вне дома' },
    { date: '2025-11-29', title: 'Обед, бензин', type: 'expense', amount: 90.00, category: 'Транспорт' },
    { date: '2025-11-30', title: 'Депозит на электричество', type: 'expense', amount: 350.00, category: 'Жилье' },
];

async function importData() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');

        for (const item of data) {
            const tx = new Transaction({
                ...item,
                account: 'cash'
            });
            await tx.save();
            console.log(`Saved: ${item.date} - ${item.title} [${item.category}]`);
        }

        console.log('Successfully imported all transactions!');
        process.exit(0);
    } catch (err) {
        console.error('Error importing data:', err);
        process.exit(1);
    }
}

importData();
