const { createDerived } = require('./ledgerDerived');
const { computePeriodData, periodPrefixOf } = require('./periodStats');
const {
    computeYearlyData, computeLifetimeStats, computeComparison,
    computeCategoryComparison, computeMonthlySeries, computeCategoryCounts
} = require('./analytics');
const { computeTypicalMonth } = require('./typicalMonth');

// derived - производные снимка, не зависящие от параметров сводки (см.
// ledgerDerived.js): роут передаёт запомненные на снимок, вызов без них
// (тест, кэш выключен) считает всё сам.
function buildDashboard(docs, accounts, { month, timeRange = 'month', account, category, type, today, analytics = true },
    derived = createDerived({ docs, accounts })) {
    const transactions = derived.transactions();
    const filters = { account, category, type, includeTransactions: false };
    const monthlyTotalsByAccount = derived.monthlyTotalsByAccount(category);
    return {
        balances: derived.balances(),
        monthlyTotals: monthlyTotalsByAccount[account || ''] || {},
        monthlyTotalsByAccount,
        // Остатки на конец каждого месяца для графика «Деньги в наличии» -
        // по всем счетам сразу, как monthlyTotalsByAccount: смена счёта на
        // Обзоре не требует нового запроса.
        monthEndBalances: derived.monthEndBalances(),
        period: computePeriodData(transactions, periodPrefixOf(timeRange, month), filters),
        month: computePeriodData(transactions, month, filters),
        yearly: computeYearlyData(transactions, month, account, category),
        lifetime: computeLifetimeStats(transactions, '2025-11-09', account, category),
        ...(analytics ? {
            comparison: computeComparison(transactions, month, today),
            categoryComparison: computeCategoryComparison(transactions, month, today, account),
            monthlySeries: computeMonthlySeries(transactions, month, timeRange === 'month' ? 6 : 12, account, category),
        } : {}),
        // «Обычный месяц» нужен Обзору и Аналитике независимо от флага
        // analytics (его гасит лёгкий повторный запрос итогов), поэтому он вне
        // блока выше. Для года и «всё время» понятия нет - там полос лимита нет.
        typicalMonth: timeRange === 'month'
            ? computeTypicalMonth(transactions, { month, today, account, category })
            : null,
        categoryUsage: derived.categoryUsage(),
        categoryCounts: {
            expense: computeCategoryCounts(transactions, 'expense', today),
            income: computeCategoryCounts(transactions, 'income', today)
        }
    };
}

module.exports = { buildDashboard };
