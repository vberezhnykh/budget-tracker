import { describe, it, expect } from 'vitest';
import { transformTransactions, calculateBalances, getMonthlyData, getYearlyData, getSearchResults } from './finance';

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
