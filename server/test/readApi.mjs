import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildDashboard } = require('../dashboard');
const { buildHistoryPage, parseHistoryQuery } = require('../history');
const { transformTransactions } = require('../transform');
const { computeDescriptionSuggestions } = require('../analytics');
const { companyHistory } = require('../companyHistory');

// Stateful UI fixtures use the real read-model serializers. Assertions in
// route/finance tests independently verify their arithmetic and boundaries.
export function readApi(url, transactions = [], accounts = []) {
    const parsed = new URL(url, 'http://localhost');
    const query = Object.fromEntries(parsed.searchParams);
    if (parsed.pathname === '/api/stats/dashboard') {
        return buildDashboard(transactions, accounts, { ...query, analytics: query.analytics !== '0' });
    }
    if (parsed.pathname === '/api/history') return buildHistoryPage(transactions, accounts, parseHistoryQuery(query));
    if (parsed.pathname === '/api/suggestions/descriptions') {
        return computeDescriptionSuggestions(transformTransactions(transactions, accounts), query.category, query.type);
    }
    if (parsed.pathname === '/api/companies/history') return companyHistory(transactions, [], query.q);
    return undefined;
}
