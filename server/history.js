const { parseTransactionQuery } = require('./transactionQuery');
const { transformTransactions } = require('./transform');
const { computePeriodData, periodPrefixOf } = require('./periodStats');
const { computeSearchResults } = require('./analytics');

function parseHistoryQuery(query) {
    const str = key => typeof query[key] === 'string' ? query[key] : '';
    const month = str('month') || new Date().toISOString().slice(0, 7);
    const timeRange = str('timeRange') || 'month';
    const q = str('q').trim();
    if (!['month', 'year', 'lifetime'].includes(timeRange) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
        return { error: 'Некорректный период' };
    }
    const limit = query.limit === undefined ? 40 : Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) return { error: 'limit должен быть от 1 до 100' };
    let cursor = null;
    if (query.cursor !== undefined) {
        try {
            cursor = JSON.parse(str('cursor'));
            if (!cursor || !/^\d{4}-\d{2}-\d{2}$/.test(cursor.date) || typeof cursor.id !== 'string' || cursor.id.length > 200) throw new Error();
        } catch { return { error: 'Некорректный курсор истории' }; }
    }
    const dates = q || timeRange === 'lifetime' ? {} : timeRange === 'year'
        ? { from: `${month.slice(0, 4)}-01`, to: `${month.slice(0, 4)}-12` }
        : { from: month, to: month };
    return { month, timeRange, q, limit, cursor, account: str('account'), category: str('category'), type: str('type'), filter: parseTransactionQuery(dates).filter };
}

function buildHistoryPage(docs, accounts, options) {
    const { month, timeRange, q, account, category, type, limit = 40, cursor } = options;
    const transactions = transformTransactions(docs, accounts);
    const result = q
        ? computeSearchResults(transactions, q, account, category, type)
        : computePeriodData(transactions, periodPrefixOf(timeRange, month), { account, category, type });
    const rows = Object.entries(result.transactions)
        .sort(([a], [b]) => b.localeCompare(a))
        .flatMap(([date, group]) => group.items
            .slice().sort((a, b) => String(b.id).localeCompare(String(a.id)))
            .map(item => ({ date, item })));
    // A stable date/id cursor avoids duplicates when a new row is inserted
    // ahead of the current page. Groups have their own stable split ID.
    const remaining = cursor ? rows.filter(({ date, item }) => date < cursor.date
        || (date === cursor.date && String(item.id).localeCompare(cursor.id) < 0)) : rows;
    const page = remaining.slice(0, limit);
    const groups = {};
    for (const { date, item } of page) {
        if (!groups[date]) groups[date] = { items: [], dailySum: result.transactions[date].dailySum };
        groups[date].items.push(item);
    }
    const last = page.at(-1);
    return {
        transactions: groups,
        count: q ? result.count : rows.length,
        nextCursor: remaining.length > limit && last ? JSON.stringify({ date: last.date, id: String(last.item.id) }) : null
    };
}

module.exports = { parseHistoryQuery, buildHistoryPage };
