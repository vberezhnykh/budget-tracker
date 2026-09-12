const mongoose = require('mongoose');
const Transaction = require('../models/Transaction');
const PlannedPayment = require('../models/PlannedPayment');
const { validateTransactionUpdate, validateTransactionVersion } = require('../transactionInput');
const { prepareTransactionCompany } = require('../transactionCompany');
const { lockAccountReferences } = require('../accountRefs');
const { BankLink } = require('./models');
const { cents, problem, withLedgerTransaction } = require('./reconciliation');

const MATCH_WINDOW = 7 * 86_400_000;
const financialKeys = ['amount', 'account', 'toAccount', 'type', 'date'];
const changedFinancialState = (before, after) => financialKeys.some(key => key === 'date'
    ? new Date(before.date).getTime() !== new Date(after.date).getTime() : before[key] !== after[key]);

// Inspect actual ledger values, not the original bank amount: the user may
// already have edited a linked purchase. Existing links remain authoritative.
async function wouldDuplicateBankRow(next, session) {
    if (!['income', 'expense', 'transfer'].includes(next.type) || cents(next.amount) === null) return false;
    let total = cents(next.amount);
    if (next.splitId && next.type !== 'transfer') {
        const siblings = await Transaction.find({ _id: { $ne: next._id }, splitId: next.splitId,
            type: next.type, account: next.account, deletedAt: null }).session(session).lean();
        const parts = siblings.map(tx => cents(tx.amount));
        if (parts.some(value => value === null)) return false;
        total += parts.reduce((sum, value) => sum + value, 0n);
    }
    const legs = next.type === 'transfer'
        ? [{ account: next.account, direction: 'expense' }, { account: next.toAccount, direction: 'income' }]
        : [{ account: next.account, direction: next.type }];
    const time = new Date(next.date).getTime();
    for (const leg of legs) {
        const rows = await Transaction.find({ deletedAt: null,
            date: { $gte: new Date(time - MATCH_WINDOW), $lte: new Date(time + MATCH_WINDOW) },
            $or: [{ account: leg.account, type: leg.direction }, leg.direction === 'expense'
                ? { account: leg.account, type: 'transfer' } : { toAccount: leg.account, type: 'transfer' }]
        }).session(session).lean();
        const groups = new Map();
        for (const tx of rows) {
            const key = tx.splitId ? `split:${tx.splitId}:${tx.type}:${tx.account}` : String(tx._id);
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(tx);
        }
        for (const group of groups.values()) {
            // Editing a bank-linked row or one of its split members is valid.
            if (group.some(tx => String(tx._id) === String(next._id))) continue;
            const amounts = group.map(tx => cents(tx.amount));
            if (amounts.some(value => value === null) || amounts.reduce((sum, value) => sum + value, 0n) !== total) continue;
            if (await BankLink.exists({ transactionId: { $in: group.map(tx => tx._id) } }).session(session)) return true;
        }
    }
    return false;
}

async function saveManualTransactionUpdate(id, body) {
    if (!mongoose.Types.ObjectId.isValid(id)) throw problem(400, 'INVALID_TRANSACTION', 'Invalid transaction ID');
    return withLedgerTransaction(async session => {
        const current = await Transaction.findById(id).session(session).lean();
        if (!current) throw problem(404, 'NOT_FOUND', 'Transaction not found');
        if (current.deletedAt) throw problem(409, 'DELETED_TRANSACTION', 'Операция находится в корзине и не может быть изменена');
        const { error: versionError, expectedVersion } = validateTransactionVersion(body);
        if (versionError) throw problem(400, 'INVALID_VERSION', versionError);
        if ((current.__v || 0) !== expectedVersion) throw problem(409, 'STALE_TRANSACTION', 'Операция уже была изменена. Обновите данные и повторите попытку.');
        const prepared = await prepareTransactionCompany(body, current, { session });
        const { error, update, unset } = validateTransactionUpdate(prepared, current);
        if (error) throw problem(400, 'INVALID_TRANSACTION', error);
        const next = { ...current, ...update };
        for (const key of unset) delete next[key];
        // Preserve legacy references on unrelated edits, as the existing PUT
        // route did. New references must serialize with account deletion.
        if (update.account !== undefined || update.toAccount !== undefined) {
            const references = await lockAccountReferences([next.account, next.toAccount], { session });
            if (references.error) throw problem(400, 'ACCOUNT_MISSING', references.error);
        }
        if (update.type !== undefined && update.type !== 'expense'
            && await PlannedPayment.exists({ transactionId: current._id, status: 'paid' }).session(session)) {
            throw problem(409, 'LINKED_PAYMENT', 'Связанный с платежом расход нельзя изменить на другой тип');
        }
        if (changedFinancialState(current, next) && await wouldDuplicateBankRow(next, session)) {
            throw problem(409, 'BANK_DUPLICATE', 'Похожая операция уже добавлена из банка. Измените существующую операцию, чтобы не создавать дубль.');
        }
        const mongoUpdate = { $inc: { __v: 1 },
            ...(Object.keys(update).length ? { $set: update } : {}),
            ...(unset.length ? { $unset: Object.fromEntries(unset.map(key => [key, ''])) } : {}) };
        const versionFilter = { _id: id, deletedAt: null, ...(expectedVersion === 0
            ? { $or: [{ __v: 0 }, { __v: { $exists: false } }] } : { __v: expectedVersion }) };
        const saved = await Transaction.findOneAndUpdate(versionFilter, mongoUpdate, { new: true, runValidators: true, session });
        if (!saved) throw problem(409, 'STALE_TRANSACTION', 'Операция уже была изменена. Обновите данные и повторите попытку.');
        return saved;
    });
}

module.exports = { saveManualTransactionUpdate };
