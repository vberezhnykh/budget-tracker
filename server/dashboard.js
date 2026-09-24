const { computeBalances, computeMonthlyTotals } = require('./stats');
const { transformTransactions } = require('./transform');
const { computePeriodData, periodPrefixOf } = require('./periodStats');
const {
    computeYearlyData, computeLifetimeStats, computeComparison,
    computeCategoryComparison, computeMonthlySeries, computeCategoryUsage, computeCategoryCounts
} = require('./analytics');

function buildDashboard(docs, accounts, { month, timeRange = 'month', account, category, type, today, analytics = true }) {
    const transactions = transformTransactions(docs, accounts);
    const filters = { account, category, type, includeTransactions: false };
    return {
        balances: computeBalances(docs, accounts),
        monthlyTotals: computeMonthlyTotals(docs, accounts, { account, category }),
        period: computePeriodData(transactions, periodPrefixOf(timeRange, month), filters),
        month: computePeriodData(transactions, month, filters),
        yearly: computeYearlyData(transactions, month, account, category),
        lifetime: computeLifetimeStats(transactions, '2025-11-09', account, category),
        ...(analytics ? {
            comparison: computeComparison(transactions, month, today),
            categoryComparison: computeCategoryComparison(transactions, month, today, account),
            monthlySeries: computeMonthlySeries(transactions, month, timeRange === 'month' ? 6 : 12, account, category),
        } : {}),
        categoryUsage: computeCategoryUsage(transactions),
        categoryCounts: {
            expense: computeCategoryCounts(transactions, 'expense', today),
            income: computeCategoryCounts(transactions, 'income', today)
        }
    };
}

module.exports = { buildDashboard };
