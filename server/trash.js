const crypto = require('crypto');
const express = require('express');
const mongoose = require('mongoose');
const Transaction = require('./models/Transaction');
const PlannedPayment = require('./models/PlannedPayment');
const { activeTransactionFilter } = require('./ledgerState');
const { validateAccountReferences } = require('./accountRefs');

class TrashError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

function groupFilter(transaction) {
    return transaction.deletionBatchId
        ? { deletionBatchId: transaction.deletionBatchId, deletedAt: { $ne: null } }
        : { _id: transaction._id, deletedAt: { $ne: null } };
}

async function softDeleteTransaction(id, splitId) {
    const session = await mongoose.startSession();
    const deletionBatchId = crypto.randomUUID();
    let outcome;
    try {
        await session.withTransaction(async () => {
            const transaction = await Transaction.findById(id).session(session);
            if (!transaction) throw new TrashError(404, 'Transaction not found');
            if (splitId !== undefined && (!transaction.splitId || transaction.splitId !== splitId)) {
                throw new TrashError(400, 'splitId does not match transaction');
            }

            if (transaction.deletedAt) {
                const count = await Transaction.countDocuments(groupFilter(transaction)).session(session);
                outcome = { trashId: String(transaction._id), count };
                return;
            }

            const target = splitId
                ? activeTransactionFilter({ splitId })
                : activeTransactionFilter({ _id: transaction._id });
            const deletedAt = new Date();
            const result = await Transaction.updateMany(
                target,
                {
                    $set: { deletedAt, deletionBatchId },
                    $inc: { __v: 1 }
                },
                { session }
            );
            outcome = { trashId: String(transaction._id), count: result.modifiedCount };
        });
        return outcome;
    } finally {
        await session.endSession();
    }
}

function createTrashRouter() {
    const router = express.Router();

    router.get('/', async (req, res) => {
        try {
            const documents = await Transaction.find({ deletedAt: { $ne: null } })
                .sort({ deletedAt: -1, _id: 1 })
                .lean();
            const groups = new Map();
            for (const transaction of documents) {
                const key = transaction.deletionBatchId || `legacy:${transaction._id}`;
                if (!groups.has(key)) {
                    groups.set(key, {
                        id: String(transaction._id),
                        deletionBatchId: transaction.deletionBatchId || null,
                        deletedAt: transaction.deletedAt,
                        count: 0,
                        transactions: []
                    });
                }
                const group = groups.get(key);
                group.transactions.push(transaction);
                group.count += 1;
            }
            res.json([...groups.values()]);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    });

    router.post('/:id/restore', async (req, res) => {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ message: 'Invalid transaction ID' });
        }
        let session;
        let count = 0;
        try {
            session = await mongoose.startSession();
            await session.withTransaction(async () => {
                const representative = await Transaction.findById(req.params.id).session(session);
                if (!representative) throw new TrashError(404, 'Transaction not found');
                if (!representative.deletedAt) {
                    count = 0;
                    return;
                }

                const filter = groupFilter(representative);
                const documents = await Transaction.find(filter).session(session).lean();
                const refs = documents.flatMap(transaction => [transaction.account, transaction.toAccount]);
                const accountCheck = await validateAccountReferences(refs, { session });
                if (accountCheck.error) throw new TrashError(409, accountCheck.error);

                const result = await Transaction.updateMany(
                    filter,
                    {
                        $unset: { deletedAt: '', deletionBatchId: '' },
                        $inc: { __v: 1 }
                    },
                    { session }
                );
                count = result.modifiedCount;
            });
            return res.json({ count });
        } catch (error) {
            return res.status(error.status || 500).json({ message: error.message });
        } finally {
            if (session) await session.endSession();
        }
    });

    router.delete('/:id', async (req, res) => {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ message: 'Invalid transaction ID' });
        }
        let session;
        let count = 0;
        try {
            session = await mongoose.startSession();
            await session.withTransaction(async () => {
                const representative = await Transaction.findById(req.params.id).session(session);
                if (!representative) throw new TrashError(404, 'Transaction not found');
                if (!representative.deletedAt) throw new TrashError(409, 'Transaction is not in trash');

                const filter = groupFilter(representative);
                const documents = await Transaction.find(filter).select({ _id: 1 }).session(session).lean();
                const ids = documents.map(document => document._id);

                await PlannedPayment.updateMany(
                    { transactionId: { $in: ids }, status: 'paid' },
                    {
                        $set: { status: 'pending' },
                        $unset: { transactionId: '', paidAt: '' },
                        $inc: { __v: 1 }
                    },
                    { session }
                );
                const result = await Transaction.deleteMany(filter, { session });
                count = result.deletedCount;
            });
            return res.json({ count });
        } catch (error) {
            return res.status(error.status || 500).json({ message: error.message });
        } finally {
            if (session) await session.endSession();
        }
    });

    return router;
}

module.exports = { TrashError, createTrashRouter, softDeleteTransaction };
