const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const Transaction = require('./models/Transaction');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Database Connection
mongoose.connect(process.env.MONGODB_URI)
    .then(async () => {
        console.log('MongoDB Connected');
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
        const { title, amount, type, category, description, account, date } = req.body;

        // Validate required fields
        if (!amount || !category) {
            return res.status(400).json({ message: 'Amount and category are required' });
        }

        const newTransaction = new Transaction({
            title: title || category,
            amount,
            type,
            category,
            description,
            account,
            date
        });

        const savedTransaction = await newTransaction.save();
        res.json(savedTransaction);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

// Update transaction
app.put('/api/transactions/:id', async (req, res) => {
    try {
        const updatedTransaction = await Transaction.findByIdAndUpdate(
            req.params.id,
            req.body,
            { new: true }
        );
        res.json(updatedTransaction);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

// Delete transaction
app.delete('/api/transactions/:id', async (req, res) => {
    try {
        await Transaction.findByIdAndDelete(req.params.id);
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

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);

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
