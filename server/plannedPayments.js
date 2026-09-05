const express = require('express');
const mongoose = require('mongoose');
const PlannedPayment = require('./models/PlannedPayment');
const Transaction = require('./models/Transaction');
const { activeTransactionFilter } = require('./ledgerState');
const { lockAccountReferences, validateAccountReferences } = require('./accountRefs');
const { normalizeCreate, normalizePatch, normalizePayBody, versionOf } = require('./plannedPaymentInput');

const CONFLICT_MESSAGE = 'Платёж уже был изменён. Обновите данные и повторите попытку.';

class PlannedPaymentError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

function versionFilter(id, version) {
    return version === 0
        ? { _id: id, $or: [{ __v: 0 }, { __v: { $exists: false } }] }
        : { _id: id, __v: version };
}

function documentVersion(document) {
    return Number.isInteger(document.__v) ? document.__v : 0;
}

async function enrichedPayments() {
    const payments = await PlannedPayment.find().sort({ dueDate: 1, createdAt: 1 }).lean();
    const ids = payments.filter(payment => payment.transactionId).map(payment => payment.transactionId);
    const transactions = ids.length > 0
        ? await Transaction.find({ _id: { $in: ids } }).lean()
        : [];
    const byId = new Map(transactions.map(transaction => [String(transaction._id), transaction]));

    return payments.map(payment => {
        const transaction = payment.transactionId ? byId.get(String(payment.transactionId)) : null;
        return {
            ...payment,
            transactionDeleted: Boolean(transaction?.deletedAt),
            transactionSummary: transaction ? {
                amount: transaction.amount,
                date: transaction.date,
                account: transaction.account,
                category: transaction.category
            } : null
        };
    });
}

function createPlannedPaymentsRouter() {
    const router = express.Router();

    router.get('/', async (req, res) => {
        try {
            res.json(await enrichedPayments());
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    });

    router.post('/', async (req, res) => {
        const normalized = normalizeCreate(req.body);
        if (normalized.error) return res.status(400).json({ message: normalized.error });
        let session;
        let saved;
        try {
            await PlannedPayment.init();
            session = await mongoose.startSession();
            await session.withTransaction(async () => {
                const accountCheck = await lockAccountReferences([normalized.payment.account], { session });
                if (accountCheck.error) throw new PlannedPaymentError(400, accountCheck.error);
                [saved] = await PlannedPayment.create([normalized.payment], { session });
            });
            return res.status(201).json(saved);
        } catch (error) {
            return res.status(error.status || 500).json({ message: error.message });
        } finally {
            if (session) await session.endSession();
        }
    });

    router.put('/:id', async (req, res) => {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ message: 'Invalid planned payment ID' });
        }
        let session;
        let saved;
        try {
            session = await mongoose.startSession();
            await session.withTransaction(async () => {
                const current = await PlannedPayment.findById(req.params.id).session(session);
                if (!current) throw new PlannedPaymentError(404, 'Planned payment not found');
                if (current.status === 'paid') throw new PlannedPaymentError(409, 'Оплаченный платёж нельзя редактировать');

                const normalized = normalizePatch(req.body, current.toObject());
                if (normalized.error) throw new PlannedPaymentError(400, normalized.error);
                if (normalized.version !== documentVersion(current)) {
                    throw new PlannedPaymentError(409, CONFLICT_MESSAGE);
                }

                const accountCheck = await lockAccountReferences([normalized.final.account], { session });
                if (accountCheck.error) throw new PlannedPaymentError(400, accountCheck.error);
                saved = await PlannedPayment.findOneAndUpdate(
                    versionFilter(current._id, normalized.version),
                    { $set: normalized.update, $inc: { __v: 1 } },
                    { new: true, runValidators: true, session }
                );
                if (!saved) throw new PlannedPaymentError(409, CONFLICT_MESSAGE);
            });
            return res.json(saved);
        } catch (error) {
            return res.status(error.status || 500).json({ message: error.message });
        } finally {
            if (session) await session.endSession();
        }
    });

    router.post('/:id/pay', async (req, res) => {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ message: 'Invalid planned payment ID' });
        }
        const parsedVersion = versionOf(req.body);
        if (parsedVersion.error) return res.status(400).json({ message: parsedVersion.error });
        let session;
        let outcome;
        try {
            await PlannedPayment.init();
            session = await mongoose.startSession();
            await session.withTransaction(async () => {
                outcome = undefined;
                const payment = await PlannedPayment.findById(req.params.id).session(session);
                if (!payment) throw new PlannedPaymentError(404, 'Planned payment not found');

                if (payment.status === 'paid') {
                    const transaction = await Transaction.findById(payment.transactionId).session(session);
                    if (!transaction) throw new PlannedPaymentError(409, 'Связанная операция не найдена');
                    outcome = { payment, transaction, replayed: true };
                    return;
                }
                if (payment.status === 'skipped') {
                    throw new PlannedPaymentError(409, 'Сначала верните платёж в статус pending');
                }
                if (parsedVersion.version !== documentVersion(payment)) {
                    throw new PlannedPaymentError(409, CONFLICT_MESSAGE);
                }

                const normalized = normalizePayBody(req.body);
                if (normalized.error) throw new PlannedPaymentError(400, normalized.error);
                let transaction;

                if (normalized.mode === 'link') {
                    if (!mongoose.Types.ObjectId.isValid(normalized.transactionId)) {
                        throw new PlannedPaymentError(400, 'Некорректный transactionId');
                    }
                    const candidate = await Transaction.findOne(
                        activeTransactionFilter({ _id: normalized.transactionId, type: 'expense' })
                    ).session(session);
                    if (!candidate) throw new PlannedPaymentError(409, 'Можно связать только активный расход');

                    const accountCheck = await validateAccountReferences([candidate.account], { session });
                    if (accountCheck.error) throw new PlannedPaymentError(409, accountCheck.error);
                    const lockedAccount = await lockAccountReferences([candidate.account], { session });
                    if (lockedAccount.error) throw new PlannedPaymentError(409, lockedAccount.error);

                    const used = await PlannedPayment.exists({
                        _id: { $ne: payment._id },
                        transactionId: candidate._id
                    }).session(session);
                    if (used) throw new PlannedPaymentError(409, 'Операция уже связана с другим платежом');

                    const candidateVersion = documentVersion(candidate);
                    transaction = await Transaction.findOneAndUpdate(
                        { ...versionFilter(candidate._id, candidateVersion), type: 'expense', deletedAt: null },
                        { $inc: { __v: 1 } },
                        { new: true, session }
                    );
                    if (!transaction) throw new PlannedPaymentError(409, 'Операция изменилась во время связывания');
                } else {
                    const accountCheck = await lockAccountReferences([normalized.account], { session });
                    if (accountCheck.error) throw new PlannedPaymentError(400, accountCheck.error);
                    [transaction] = await Transaction.create([{
                        title: payment.title,
                        description: payment.description,
                        amount: normalized.amount,
                        date: normalized.date,
                        account: normalized.account,
                        category: normalized.category,
                        type: 'expense'
                    }], { session });
                }

                const paid = await PlannedPayment.findOneAndUpdate(
                    versionFilter(payment._id, normalized.version),
                    {
                        $set: { status: 'paid', transactionId: transaction._id, paidAt: new Date() },
                        $inc: { __v: 1 }
                    },
                    { new: true, runValidators: true, session }
                );
                if (!paid) throw new PlannedPaymentError(409, CONFLICT_MESSAGE);
                outcome = { payment: paid, transaction, replayed: false };
            });
            return res.json(outcome);
        } catch (error) {
            if (error?.code === 11000) {
                return res.status(409).json({ message: 'Операция уже связана с другим платежом' });
            }
            return res.status(error.status || 500).json({ message: error.message });
        } finally {
            if (session) await session.endSession();
        }
    });

    return router;
}

module.exports = {
    CONFLICT_MESSAGE,
    PlannedPaymentError,
    createPlannedPaymentsRouter,
    documentVersion,
    enrichedPayments,
    versionFilter
};
