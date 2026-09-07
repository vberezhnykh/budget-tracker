const mongoose = require('mongoose');

const { Schema } = mongoose;
const connectionSchema = new Schema({
    bank: { type: String, enum: ['boc', 'revolut'], required: true, unique: true },
    status: { type: String, default: 'disconnected' },
    sessionCiphertext: String,
    consentExpiresAt: Date,
    importFrom: Date,
    historyReset: { type: Boolean, default: false },
    lastSuccessfulSyncAt: Date,
    lastAttemptAt: Date,
    nextSyncAt: Date,
    lastErrorCode: String,
    warningsCount: { type: Number, default: 0 },
    leaseToken: String,
    leaseUntil: Date
}, { timestamps: true });

const accountSchema = new Schema({
    connectionId: { type: Schema.Types.ObjectId, required: true, index: true },
    identificationHash: { type: String, required: true, unique: true },
    uidCiphertext: { type: String, required: true },
    ibanHash: String,
    name: String,
    maskedNumber: String,
    currency: String,
    accountId: String,
    active: { type: Boolean, default: true },
    balances: [{ _id: false, amount: String, currency: String, type: { type: String }, asOf: Date }],
    balancesUpdatedAt: Date
}, { timestamps: true });
accountSchema.index({ accountId: 1 }, { unique: true, partialFilterExpression: { accountId: { $type: 'string' } } });

const entrySchema = new Schema({
    bankAccountId: { type: Schema.Types.ObjectId, required: true },
    key: { type: String, required: true },
    amount: { type: String, required: true },
    currency: { type: String, required: true },
    direction: { type: String, enum: ['income', 'expense'], required: true },
    date: { type: Date, required: true },
    description: String,
    counterpartyHash: String,
    reviewReasons: [String],
    status: { type: String, enum: ['new', 'pending', 'imported', 'matched', 'ignored'], default: 'new' },
    reason: String,
    transactionIds: [{ type: Schema.Types.ObjectId }],
    version: { type: Number, default: 0 }
}, { timestamps: true });
entrySchema.index({ bankAccountId: 1, key: 1 }, { unique: true });
entrySchema.index({ status: 1, date: -1 });

// A durable link also survives the ledger's trash being emptied. A bank
// statement cannot resurrect an expense the user deliberately removed.
const linkSchema = new Schema({
    _id: String,
    entryId: { type: Schema.Types.ObjectId, required: true, index: true },
    transactionId: { type: Schema.Types.ObjectId, required: true, index: true }
});

const authorizationSchema = new Schema({
    _id: String,
    bank: String,
    nonceHash: String,
    importFrom: Date,
    expiresAt: Date
});
authorizationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const controlSchema = new Schema({ _id: String, revision: { type: Number, default: 0 } });

module.exports = {
    BankConnection: mongoose.model('BankConnection', connectionSchema),
    BankAccount: mongoose.model('BankAccount', accountSchema),
    BankEntry: mongoose.model('BankEntry', entrySchema),
    BankLink: mongoose.model('BankLink', linkSchema),
    BankAuthorization: mongoose.model('BankAuthorization', authorizationSchema),
    BankControl: mongoose.model('BankControl', controlSchema)
};
