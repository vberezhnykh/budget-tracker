const mongoose = require('mongoose');

const TransactionSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
        trim: true
    },
    amount: {
        type: Number,
        required: true
    },
    type: {
        type: String,
        enum: ['income', 'expense', 'initial', 'transfer'],
        required: true
    },
    category: {
        type: String,
        required: true
    },
    description: {
        type: String,
        trim: true
    },
    account: {
        type: String,
        enum: ['card', 'cash'],
        default: 'card'
    },
    toAccount: {
        type: String,
        enum: ['card', 'cash']
    },
    date: {
        type: Date,
        default: Date.now
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Transaction', TransactionSchema);
