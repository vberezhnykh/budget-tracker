const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const Transaction = require('./models/Transaction');
require('dotenv').config();
const { startBackupService } = require('./services/backupService');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Database Connection
const isProduction = process.env.NODE_ENV === 'production';
const dbOptions = !isProduction ? { dbName: 'budget-tracker-dev' } : {};

mongoose.connect(process.env.MONGODB_URI, dbOptions)
    .then(async () => {
        console.log(`MongoDB Connected (${isProduction ? 'Production' : 'Development: budget-tracker-dev'})`);
        // Seed initial balance if not exists
        const initialExists = await Transaction.findOne({ type: 'initial' });
        if (!initialExists) {
            const initialBalance = new Transaction({
                title: "Стартовый баланс",
                amount: 5650,
                type: "initial",
                category: "Другое",
                description: "Стартовый баланс",
                account: "cash",
                date: "2025-11-09"
            });
            await initialBalance.save();
            console.log('Initial balance seeded');
        }
    })
    .catch(err => console.log(err));

// Routes

// Get all transactions
app.get('/api/transactions', async (req, res) => {
    try {
        const transactions = await Transaction.find().sort({ date: -1 });
        res.json(transactions);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Add transaction
app.post('/api/transactions', async (req, res) => {
    try {
        // Handle batch insert for split transactions
        if (Array.isArray(req.body)) {
            const transactions = req.body;
            if (transactions.length === 0) {
                return res.status(400).json({ message: 'Batch must contain at least one transaction' });
            }

            // Basic validation for each item
            for (const tx of transactions) {
                if (!tx.amount || (!tx.category && tx.type !== 'transfer')) {
                    return res.status(400).json({ message: 'Amount and category are required for all items' });
                }
            }

            const savedTransactions = await Transaction.insertMany(transactions);
            return res.json(savedTransactions);
        }

        const { title, amount, type, category, description, account, toAccount, date } = req.body;

        // Validate required fields
        if (!amount || (!category && type !== 'transfer')) {
            return res.status(400).json({ message: 'Amount and category are required' });
        }

        const newTransaction = new Transaction({
            title: title || category,
            amount,
            type,
            category,
            description,
            account,
            toAccount,
            date
        });

        const savedTransaction = await newTransaction.save();
        res.json(savedTransaction);
    } catch (err) {
        console.error('POST Error:', err.message);
        res.status(400).json({ message: err.message });
    }
});

// Update transaction
app.put('/api/transactions/:id', async (req, res) => {
    try {
        const { title, amount, type, category, description, account, toAccount, date } = req.body;
        const updatedTransaction = await Transaction.findByIdAndUpdate(
            req.params.id,
            { title, amount, type, category, description, account, toAccount, date },
            { new: true }
        );
        res.json(updatedTransaction);
    } catch (err) {
        console.error('PUT Error:', err.message);
        res.status(400).json({ message: err.message });
    }
});

// Delete transaction
app.delete('/api/transactions/:id', async (req, res) => {
    try {
        const { splitId } = req.query;
        if (splitId) {
            await Transaction.deleteMany({ splitId });
        } else {
            await Transaction.findByIdAndDelete(req.params.id);
        }
        res.json({ message: 'Transaction deleted' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});



// Serve static assets in production
if (process.env.NODE_ENV === 'production') {
    // Set static folder
    app.use(express.static(path.join(__dirname, '../dist')));

    app.get('*', (req, res) => {
        res.sendFile(path.join(__dirname, '../dist/index.html'));
    });
}

// Gemini Analytics Route
const { GoogleGenerativeAI } = require("@google/generative-ai");

app.post('/api/analyze', async (req, res) => {
    try {
        if (!process.env.GEMINI_API_KEY) {
            return res.status(500).json({ message: 'GEMINI_API_KEY is not set in environment variables' });
        }

        const { month } = req.body; // Expect format YYYY-MM

        // Find transactions for the month
        const startOfMonth = new Date(`${month}-01`);
        const endOfMonth = new Date(new Date(startOfMonth).setMonth(startOfMonth.getMonth() + 1));

        const transactions = await Transaction.find({
            date: {
                $gte: startOfMonth.toISOString().slice(0, 10),
                $lt: endOfMonth.toISOString().slice(0, 10)
            }
        });

        // Prepare data for Gemini
        const income = transactions.filter(t => t.type === 'income').reduce((acc, t) => acc + t.amount, 0);
        const expense = transactions.filter(t => t.type === 'expense').reduce((acc, t) => acc + t.amount, 0);

        const categories = {};
        transactions.filter(t => t.type === 'expense').forEach(t => {
            categories[t.category] = (categories[t.category] || 0) + t.amount;
        });

        const topCategories = Object.entries(categories)
            .sort(([, a], [, b]) => b - a)
            .map(([cat, amount]) => `- ${cat}: €${amount.toFixed(2)}`)
            .join('\n');

        const prompt = `
        Проанализируй финансовые данные за ${month}.
        Доходы: €${income.toFixed(2)}
        Расходы: €${expense.toFixed(2)}
        Баланс: €${(income - expense).toFixed(2)}
        
        Траты по категориям:
        ${topCategories}

        Дай краткую аналитику (3-4 предложения), оцени финансовое здоровье и дай 1 конкретный совет по экономии. Отвечай на русском языке. Используй эмодзи.
        `;

        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

        let text;
        const modelsToTry = ["gemini-3-flash", "gemini-3-flash-preview", "gemini-2.0-flash", "gemini-1.5-flash"];
        let lastError;

        for (const modelName of modelsToTry) {
            try {
                console.log(`Generating analysis for ${month} using ${modelName}...`);
                const model = genAI.getGenerativeModel({ model: modelName });
                const result = await model.generateContent(prompt);
                const response = await result.response;
                text = response.text();
                if (text) {
                    console.log(`Successfully generated using ${modelName}`);
                    break;
                }
            } catch (err) {
                console.error(`Failed with ${modelName}:`, err.message);
                lastError = err;
            }
        }

        if (!text) {
            throw new Error(lastError ? lastError.message : 'Failed to generate analysis with available models');
        }

        res.json({ analysis: text });

    } catch (err) {
        console.error('Gemini Error:', err);
        res.status(500).json({ message: 'Error generating analysis: ' + err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);

    // Start backup service
    startBackupService();

    // Prevention of Render's "Sleep" mode
    const url = process.env.RENDER_EXTERNAL_URL;
    if (url) {
        console.log(`Setting up self-ping for ${url}`);
        setInterval(() => {
            fetch(`${url}/api/transactions`)
                .then(() => console.log('Self-ping successful'))
                .catch(err => console.error('Self-ping failed:', err.message));
        }, 14 * 60 * 1000); // Every 14 minutes
    }
});
