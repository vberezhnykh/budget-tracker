const { parseTransactionQuery } = require('./transactionQuery');
const { transformTransactions } = require('./transform');
const { computePeriodData, periodPrefixOf } = require('./periodStats');
const { computeSearchResults } = require('./analytics');

function parseHistoryQuery(query) {
    const str = key => typeof query[key] === 'string' ? query[key] : '';
    const month = str('month') || new Date().toISOString().slice(0, 7);
    const timeRange = str('timeRange') || 'month';
    const q = str('q').trim();
    const continuous = str('continuous') === '1';
    // all=1: вся лента под фильтр одним ответом, без месяца, лимита и курсоров.
    const all = continuous && str('all') === '1';
    const direction = str('direction') || 'older';
    if (!['older', 'newer'].includes(direction)) return { error: 'Некорректное направление истории' };
    // В режиме all месяц, лимит и курсор принимаются и игнорируются: список
    // целиком не привязан ни к якорю, ни к странице.
    if (!all && (!['month', 'year', 'lifetime'].includes(timeRange) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month))) {
        return { error: 'Некорректный период' };
    }
    const limit = all ? 40 : query.limit === undefined ? 40 : Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) return { error: 'limit должен быть от 1 до 100' };
    let cursor = null;
    if (!all && query.cursor !== undefined) {
        try {
            cursor = JSON.parse(str('cursor'));
            if (!cursor || !/^\d{4}-\d{2}-\d{2}$/.test(cursor.date) || typeof cursor.id !== 'string' || cursor.id.length > 200) throw new Error();
        } catch { return { error: 'Некорректный курсор истории' }; }
    }
    const dates = continuous || q || timeRange === 'lifetime' ? {} : timeRange === 'year'
        ? { from: `${month.slice(0, 4)}-01`, to: `${month.slice(0, 4)}-12` }
        : { from: month, to: month };
    return { month, timeRange, q, limit, cursor, continuous, all, direction, account: str('account'), category: str('category'), type: str('type'), filter: parseTransactionQuery(dates).filter };
}

// transactions - уже приведённые операции (из производных снимка, см.
// ledgerDerived.js) в порядке docs; без них приводятся здесь.
function buildHistoryPage(docs, accounts, options, transformed = null) {
    const { month, timeRange, q, account, category, type, limit = 40, cursor, continuous, all, direction = 'older' } = options;
    const transactions = transformed || transformTransactions(docs, accounts);
    const result = q
        ? computeSearchResults(transactions, q, account, category, type)
        : computePeriodData(transactions, continuous ? '' : periodPrefixOf(timeRange, month), { account, category, type });
    const rows = Object.entries(result.transactions)
        .sort(([a], [b]) => b.localeCompare(a))
        .flatMap(([date, group]) => group.items
            .slice().sort((a, b) => String(b.id).localeCompare(String(a.id)))
            .map(item => ({ date, item })));
    if (continuous && all) {
        // Вся лента одним ответом: те же группы по дням, те же dailySum и
        // склейки покупок, только без среза и курсоров.
        const groups = {};
        for (const { date, item } of rows) {
            if (!groups[date]) groups[date] = { items: [], dailySum: result.transactions[date].dailySum };
            groups[date].items.push(item);
        }
        return { transactions: groups, count: q ? result.count : rows.length, nextCursor: null, previousCursor: null, complete: true };
    }
    // A stable date/id cursor avoids duplicates when a new row is inserted
    // ahead of the current page. Groups have their own stable split ID.
    const compare = ({ date, item }, boundary) => date.localeCompare(boundary.date)
        || String(item.id).localeCompare(boundary.id);
    const remaining = cursor ? rows.filter(row => direction === 'newer'
        ? compare(row, cursor) > 0 : compare(row, cursor) < 0)
        : continuous && !q ? rows.filter(row => row.date.slice(0, 7) <= month) : rows;
    // Newer pages must be adjacent to the cursor, not jump to the newest row.
    const page = direction === 'newer' && cursor ? remaining.slice(-limit) : remaining.slice(0, limit);
    const groups = {};
    for (const { date, item } of page) {
        if (!groups[date]) groups[date] = { items: [], dailySum: result.transactions[date].dailySum };
        groups[date].items.push(item);
    }
    const last = page.at(-1);
    const first = page[0];
    const toCursor = row => ({ date: row.date, id: String(row.item.id) });
    // An empty anchor month can still have newer history to scroll back to.
    const boundary = first ? toCursor(first) : { date: `${month}-01`, id: '' };
    return {
        transactions: groups,
        count: q ? result.count : rows.length,
        nextCursor: last && rows.some(row => compare(row, toCursor(last)) < 0) ? JSON.stringify(toCursor(last)) : null,
        ...(continuous ? {
            previousCursor: rows.some(row => compare(row, boundary) > 0) ? JSON.stringify(boundary) : null,
        } : {}),
    };
}

module.exports = { parseHistoryQuery, buildHistoryPage };
