const mongoose = require('mongoose');
const Account = require('./models/Account');

const LEGACY_ACCOUNT_IDS = new Set(['card', 'cash']);

async function validateAccountReferences(values, { session } = {}) {
    const ids = [...new Set((values || []).filter(Boolean).map(String))];
    const objectIds = [];

    for (const id of ids) {
        if (LEGACY_ACCOUNT_IDS.has(id)) continue;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return { error: `Счёт ${id} не существует` };
        }
        objectIds.push(id);
    }

    if (objectIds.length === 0) return { ok: true };
    let query = Account.find({ _id: { $in: objectIds } }).select({ _id: 1 });
    if (session) query = query.session(session);
    const found = await query.lean();
    if (found.length !== objectIds.length) {
        return { error: 'Один из указанных счетов не существует' };
    }
    return { ok: true };
}

// A validating write is used inside transactions that create references.
// It conflicts with concurrent account deletion; whichever transaction
// retries then observes the other's committed state instead of orphaning a
// newly created plan or expense.
async function lockAccountReferences(values, { session } = {}) {
    const ids = [...new Set((values || []).filter(Boolean).map(String))]
        .filter(id => !LEGACY_ACCOUNT_IDS.has(id));
    if (ids.some(id => !mongoose.Types.ObjectId.isValid(id))) {
        return { error: 'Один из указанных счетов не существует' };
    }
    if (ids.length === 0) return { ok: true };

    const result = await Account.updateMany(
        { _id: { $in: ids } },
        { $inc: { __v: 1 } },
        session ? { session } : undefined
    );
    if (result.matchedCount !== ids.length) {
        return { error: 'Один из указанных счетов не существует' };
    }
    return { ok: true };
}

module.exports = { LEGACY_ACCOUNT_IDS, validateAccountReferences, lockAccountReferences };
