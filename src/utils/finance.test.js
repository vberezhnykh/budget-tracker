import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    transformTransactions,
    calculateBalances,
    getMonthlyData,
    getYearlyData,
    getSearchResults,
    getDescriptionSuggestions,
    getMonthlySeries,
    getCategoryComparison,
    getPaceForecast
} from './finance';

describe('Finance Utilities', () => {
    const mockData = [
        { _id: '1', amount: '1000', type: 'initial', account: 'card', date: '2026-01-01T00:00:00Z' },
        { _id: '2', amount: '500', type: 'income', account: 'cash', category: 'Salary', date: '2026-01-05T00:00:00Z' },
        { _id: '3', amount: '200', type: 'expense', account: 'card', category: 'Food', date: '2026-01-10T00:00:00Z' },
        { _id: '4', amount: '100', type: 'transfer', account: 'card', toAccount: 'cash', date: '2026-01-15T00:00:00Z' }
    ];

    it('transforms transactions correctly', () => {
        const transformed = transformTransactions(mockData);

        // Initial balance (Card: +1000)
        expect(transformed[0].accountFlows['card']).toBe(1000);

        // Income (Cash: +500)
        expect(transformed[1].accountFlows['cash']).toBe(500);

        // Expense (Card: -200)
        expect(transformed[2].accountFlows['card']).toBe(-200);

        // Transfer (Card: -100, Cash: +100)
        expect(transformed[3].accountFlows['card']).toBe(-100);
        expect(transformed[3].accountFlows['cash']).toBe(100);
        expect(transformed[3].visualAmount).toBe(100); // Visual should stay positive for transfers
    });

    it('renames the legacy "Обмен" transfer category to "Перевод"', () => {
        const transformed = transformTransactions([
            { _id: 't1', amount: '100', type: 'transfer', account: 'card', toAccount: 'cash', category: 'Обмен', date: '2026-01-15T00:00:00Z' },
            { _id: 't2', amount: '100', type: 'transfer', account: 'card', toAccount: 'cash', category: 'Депозит', date: '2026-01-16T00:00:00Z' },
            { _id: 't3', amount: '50', type: 'expense', account: 'card', category: 'Обмен', date: '2026-01-17T00:00:00Z' }
        ]);

        expect(transformed[0].category).toBe('Перевод');
        // A transfer saved under some other category keeps it, and a
        // non-transfer named "Обмен" is left alone - only the legacy
        // transfer default is renamed.
        expect(transformed[1].category).toBe('Депозит');
        expect(transformed[2].category).toBe('Обмен');
    });

    it('calculates total balance correctly', () => {
        const transformed = transformTransactions(mockData);
        const balances = calculateBalances(transformed);

        // Final state: 
        // Card: 1000 - 200 - 100 = 700
        // Cash: 500 + 100 = 600
        // Total: 1300
        expect(balances.byAccount['card']).toBe(700);
        expect(balances.byAccount['cash']).toBe(600);
        expect(balances.total).toBe(1300);
    });

    it('filters monthly data correctly', () => {
        const transformed = transformTransactions(mockData);
        const result = getMonthlyData(transformed, '2026-01');

        // Income (Salary: 500)
        // Expense (Food: 200)
        expect(result.income).toBe(500);
        expect(result.expense).toBe(-200);
        expect(result.categoryTotals['Food']).toBe(200);
    });

    it('filters monthly data by account correctly', () => {
        const transformed = transformTransactions(mockData);

        // Card account: initial 1000, expense 200, transfer 100
        const cardResult = getMonthlyData(transformed, '2026-01', 'card');
        expect(cardResult.expense).toBe(-200);
        expect(cardResult.income).toBe(0); // Salary is cash
        expect(Object.keys(cardResult.transactions)).toHaveLength(3); // initial (Jan 1), expense (Jan 10), transfer (Jan 15)

        // Cash account: income 500, transfer 100
        const cashResult = getMonthlyData(transformed, '2026-01', 'cash');
        expect(cashResult.income).toBe(500);
        expect(cashResult.expense).toBe(0);
        expect(Object.keys(cashResult.transactions)).toHaveLength(2); // income (Jan 5), transfer (Jan 15)
    });

    it('filters monthly data by category correctly', () => {
        const transformed = transformTransactions(mockData);
        const result = getMonthlyData(transformed, '2026-01', null, 'Salary');
        expect(result.income).toBe(500);
        expect(Object.keys(result.transactions)).toHaveLength(1);
        expect(result.transactions['2026-01-05'].items[0].category).toBe('Salary');
    });

    it('calculates yearly data correctly', () => {
        const transformed = transformTransactions(mockData);
        const result = getYearlyData(transformed, '2026-01');
        // Total from mockData in 2026:
        // Income: 500 (Salary)
        // Expense: 200 (Food)
        expect(result.income).toBe(500);
        expect(result.expense).toBe(-200);
        expect(result.categoryTotals['Food']).toBe(200);
    });

    describe('Edge Cases', () => {
        it('handles empty transaction list', () => {
            const transformed = transformTransactions([]);
            const balances = calculateBalances(transformed);
            const monthly = getMonthlyData(transformed, '2026-01');

            expect(balances.total).toBe(0);
            expect(monthly.income).toBe(0);
            expect(monthly.expense).toBe(0);
            expect(Object.keys(monthly.transactions)).toHaveLength(0);
        });

        it('handles transactions with missing categories', () => {
            const dirtyData = [{ _id: '1', amount: '100', type: 'expense', account: 'card', date: '2026-01-01' }];
            const transformed = transformTransactions(dirtyData);
            const result = getMonthlyData(transformed, '2026-01');

            expect(result.categoryTotals['Другое']).toBe(100);
        });

        it('correctly separates years in monthly filter', () => {
            const multiYearData = [
                { _id: '1', amount: '100', type: 'income', date: '2025-01-01' },
                { _id: '2', amount: '200', type: 'income', date: '2026-01-01' }
            ];
            const transformed = transformTransactions(multiYearData);

            const res2025 = getMonthlyData(transformed, '2025-01');
            const res2026 = getMonthlyData(transformed, '2026-01');

            expect(res2025.income).toBe(100);
            expect(res2026.income).toBe(200);
        });

        it('handles zero amount transactions', () => {
            const zeroData = [{ _id: '1', amount: '0', type: 'expense', account: 'card', date: '2026-01-01' }];
            const transformed = transformTransactions(zeroData);
            const balances = calculateBalances(transformed);

            expect(balances.total).toBe(0);
        });
        describe('Search', () => {
            it('returns empty results for empty query', () => {
                const transformed = transformTransactions(mockData);
                const result = getSearchResults(transformed, '');
                expect(result.count).toBe(0);
                expect(Object.keys(result.transactions)).toHaveLength(0);
            });

            it('finds transactions by title', () => {
                const transformed = transformTransactions(mockData);
                const result = getSearchResults(transformed, 'Salary');
                expect(result.count).toBe(1);
                expect(result.transactions['2026-01-05'].items[0].title).toBe('Salary');
            });

            it('finds transactions by category', () => {
                const transformed = transformTransactions(mockData);
                const result = getSearchResults(transformed, 'Food');
                expect(result.count).toBe(1);
                expect(result.transactions['2026-01-10'].items[0].category).toBe('Food');
            });

            it('finds transactions by amount', () => {
                const transformed = transformTransactions(mockData);
                const result = getSearchResults(transformed, '200');
                expect(result.count).toBe(1);
                expect(result.transactions['2026-01-10'].items[0].amount).toBe(200);
            });

            it('is case insensitive', () => {
                const transformed = transformTransactions(mockData);
                const result = getSearchResults(transformed, 'salary');
                expect(result.count).toBe(1);
            });

            it('finds multiple matches across different days', () => {
                const multiData = [
                    { _id: '1', amount: '100', title: 'Food', date: '2026-01-01' },
                    { _id: '2', amount: '200', title: 'Food', date: '2026-01-02' }
                ];
                const transformed = transformTransactions(multiData);
                const result = getSearchResults(transformed, 'Food');
                expect(result.count).toBe(2);
                expect(Object.keys(result.transactions)).toHaveLength(2);
            });
        });
    });
});

describe('getDescriptionSuggestions', () => {
    const history = [
        { category: 'Продукты', type: 'expense', description: 'Wolt', date: '2026-01-01' },
        { category: 'Продукты', type: 'expense', description: 'wolt ', date: '2026-01-20' },
        { category: 'Продукты', type: 'expense', description: 'Lidl', date: '2026-01-05' },
        { category: 'Продукты', type: 'expense', description: '', date: '2026-01-06' },
        { category: 'Развлечения', type: 'expense', description: 'Кино', date: '2026-01-07' },
        { category: 'Другое', type: 'income', description: 'Возврат', date: '2026-01-08' },
        { category: 'Другое', type: 'expense', description: 'Штраф', date: '2026-01-09' }
    ];

    it('returns the comments used for that category, most frequent first', () => {
        expect(getDescriptionSuggestions(history, 'Продукты', 'expense')).toEqual(['wolt', 'Lidl']);
    });

    it('does not leak comments across categories', () => {
        expect(getDescriptionSuggestions(history, 'Развлечения', 'expense')).toEqual(['Кино']);
    });

    it('separates same-named categories of different types', () => {
        expect(getDescriptionSuggestions(history, 'Другое', 'income')).toEqual(['Возврат']);
        expect(getDescriptionSuggestions(history, 'Другое', 'expense')).toEqual(['Штраф']);
    });

    it('breaks frequency ties by most recent use', () => {
        const ties = [
            { category: 'Транспорт', type: 'expense', description: 'Такси', date: '2026-01-01' },
            { category: 'Транспорт', type: 'expense', description: 'Бензин', date: '2026-01-10' }
        ];
        expect(getDescriptionSuggestions(ties, 'Транспорт', 'expense')).toEqual(['Бензин', 'Такси']);
    });

    it('respects the limit and handles empty input', () => {
        expect(getDescriptionSuggestions(history, 'Продукты', 'expense', 1)).toEqual(['wolt']);
        expect(getDescriptionSuggestions(history, '', 'expense')).toEqual([]);
        expect(getDescriptionSuggestions([], 'Продукты', 'expense')).toEqual([]);
    });
});

describe('getMonthlySeries', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    const seriesData = [
        { _id: '1', amount: '100', type: 'expense', account: 'card', category: 'Food', date: '2025-11-10' },
        { _id: '2', amount: '200', type: 'income', account: 'card', category: 'Salary', date: '2025-12-01' },
        { _id: '3', amount: '50', type: 'expense', account: 'card', category: 'Food', date: '2026-01-05' },
        { _id: '4', amount: '999', type: 'transfer', account: 'card', toAccount: 'cash', date: '2026-01-06' }
    ];

    it('returns months oldest to newest, ending at endMonth', () => {
        const transformed = transformTransactions(seriesData);
        const series = getMonthlySeries(transformed, '2026-01', 3);

        expect(series.map(s => s.month)).toEqual(['2025-11', '2025-12', '2026-01']);
        expect(series[series.length - 1].month).toBe('2026-01');
    });

    it('trims leading months older than the earliest transaction, but keeps internal empty months', () => {
        const transformed = transformTransactions(seriesData);
        // Requesting 6 months back from 2026-01 would start at 2025-08, well
        // before the earliest transaction (2025-11) - those should be cut.
        const series = getMonthlySeries(transformed, '2026-01', 6);

        expect(series.map(s => s.month)).toEqual(['2025-11', '2025-12', '2026-01']);

        // A month with no matching transactions in the middle of the range
        // (2025-12 has an income, but no expense) still gets a zero entry
        // rather than being dropped.
        const decNov = series.find(s => s.month === '2025-12');
        expect(decNov.expense).toBe(0);
        expect(decNov.income).toBe(200);
    });

    it('computes income/expense per month, excluding transfers', () => {
        const transformed = transformTransactions(seriesData);
        const series = getMonthlySeries(transformed, '2026-01', 3);

        const jan = series.find(s => s.month === '2026-01');
        expect(jan.expense).toBe(50); // positive/absolute
        expect(jan.income).toBe(0); // the transfer must not count as income
    });

    it('produces short Russian month labels without a trailing dot', () => {
        const transformed = transformTransactions(seriesData);
        const series = getMonthlySeries(transformed, '2026-01', 3);
        series.forEach(s => {
            expect(s.label.endsWith('.')).toBe(false);
        });
    });

    it('filters by account and category', () => {
        const withAccounts = [
            { _id: '1', amount: '100', type: 'expense', account: 'card', category: 'Food', date: '2026-01-05' },
            { _id: '2', amount: '40', type: 'expense', account: 'cash', category: 'Food', date: '2026-01-06' },
            { _id: '3', amount: '30', type: 'expense', account: 'card', category: 'Fun', date: '2026-01-07' }
        ];
        const transformed = transformTransactions(withAccounts);

        const cardOnly = getMonthlySeries(transformed, '2026-01', 1, 'card');
        expect(cardOnly[0].expense).toBe(130);

        const foodOnly = getMonthlySeries(transformed, '2026-01', 1, null, 'Food');
        expect(foodOnly[0].expense).toBe(140);
    });
});

describe('getCategoryComparison', () => {
    const compData = [
        // January (current month, "today" is mocked to the 15th)
        { _id: '1', amount: '100', type: 'expense', account: 'card', category: 'Food', date: '2026-01-10' },
        { _id: '2', amount: '50', type: 'expense', account: 'card', category: 'Fun', date: '2026-01-20' }, // after comparisonDay-equivalent, still counts for current month
        // December (previous month)
        { _id: '3', amount: '80', type: 'expense', account: 'card', category: 'Food', date: '2025-12-10' }, // day 10 <= comparisonDay(15): counted
        { _id: '4', amount: '999', type: 'expense', account: 'card', category: 'Food', date: '2025-12-20' }, // day 20 > comparisonDay(15): excluded
        { _id: '5', amount: '30', type: 'expense', account: 'card', category: 'Books', date: '2025-12-05' } // category absent this month
    ];

    afterEach(() => {
        vi.useRealTimers();
    });

    it('cuts the previous month at today\'s day-of-month for the current month', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-15'));

        const transformed = transformTransactions(compData);
        const result = getCategoryComparison(transformed, '2026-01');

        expect(result['Food'].value).toBe(100);
        expect(result['Food'].previous).toBe(80); // the Dec 20 entry (day 20 > 15) must be excluded
        expect(result['Food'].diff).toBe(20);
    });

    it('includes a category that only existed last month, at value 0', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-15'));

        const transformed = transformTransactions(compData);
        const result = getCategoryComparison(transformed, '2026-01');

        expect(result['Books']).toEqual({ value: 0, previous: 30, diff: -30, percent: -100 });
    });

    it('returns percent: null when there was no spending in that category last month', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-15'));

        const transformed = transformTransactions(compData);
        const result = getCategoryComparison(transformed, '2026-01');

        expect(result['Fun'].previous).toBe(0);
        expect(result['Fun'].percent).toBeNull();
    });
});

describe('getPaceForecast', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns null when selectedMonth is not the current calendar month', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-15'));

        expect(getPaceForecast(300, '2025-12')).toBeNull();
    });

    it('computes perDay/forecast arithmetic for the month in progress', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-15')); // day 15 of a 31-day month

        const pace = getPaceForecast(300, '2026-01');

        expect(pace.daysInMonth).toBe(31);
        expect(pace.daysElapsed).toBe(15);
        expect(pace.daysLeft).toBe(16);
        expect(pace.perDay).toBe(20); // 300 / 15
        expect(pace.forecast).toBe(620); // 20 * 31
    });

    it('fills in the limit fields when a usable monthlyLimit is given', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-15'));

        const pace = getPaceForecast(300, '2026-01', 500);

        expect(pace.remaining).toBe(200); // 500 - 300
        expect(pace.perDayLeft).toBe(12.5); // 200 / 16
        expect(pace.willExceedLimit).toBe(true); // forecast 620 > 500
    });

    it('leaves the limit fields null for an unusable monthlyLimit', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-15'));

        const zeroLimit = getPaceForecast(300, '2026-01', 0);
        expect(zeroLimit.remaining).toBeNull();
        expect(zeroLimit.perDayLeft).toBeNull();
        expect(zeroLimit.willExceedLimit).toBeNull();

        const noLimit = getPaceForecast(300, '2026-01');
        expect(noLimit.remaining).toBeNull();

        const nanLimit = getPaceForecast(300, '2026-01', NaN);
        expect(nanLimit.remaining).toBeNull();
    });
});
