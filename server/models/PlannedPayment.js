const mongoose = require('mongoose');

const PlannedPaymentSchema = new mongoose.Schema({
    title: { type: String, required: true, trim: true },
    amount: {
        type: Number,
        required: true,
        validate: {
            validator: value => Number.isFinite(value) && value > 0,
            message: 'amount must be a finite number greater than 0'
        }
    },
    dueDate: {
        type: Date,
        required: true,
        validate: {
            validator: value => value instanceof Date
                && !Number.isNaN(value.getTime())
                && value.getUTCHours() === 0
                && value.getUTCMinutes() === 0
                && value.getUTCSeconds() === 0
                && value.getUTCMilliseconds() === 0,
            message: 'dueDate must be a UTC calendar day'
        }
    },
    account: { type: String, required: true, trim: true },
    category: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: '' },
    status: {
        type: String,
        enum: ['pending', 'paid', 'skipped'],
        default: 'pending'
    },
    transactionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction' },
    paidAt: { type: Date },
    createdAt: { type: Date, default: Date.now }
});

PlannedPaymentSchema.index({ dueDate: 1, createdAt: 1 });
PlannedPaymentSchema.index(
    { transactionId: 1 },
    {
        unique: true,
        name: 'planned_payment_transaction_unique',
        partialFilterExpression: { transactionId: { $type: 'objectId' } }
    }
);

module.exports = mongoose.model('PlannedPayment', PlannedPaymentSchema);
