// Mongo's equality-to-null matches both null and a missing field. Restores
// unset deletedAt, so this one predicate covers new and legacy active rows.
const ACTIVE_TRANSACTION_FILTER = Object.freeze({ deletedAt: null });

function activeTransactionFilter(filter = {}) {
    if (!filter || Object.keys(filter).length === 0) {
        return { ...ACTIVE_TRANSACTION_FILTER };
    }
    return { $and: [filter, { ...ACTIVE_TRANSACTION_FILTER }] };
}

module.exports = { ACTIVE_TRANSACTION_FILTER, activeTransactionFilter };
