// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { buildHistoryPage, parseHistoryQuery } = require('./history');
const { buildDashboard } = require('./dashboard');
const { companyHistory } = require('./companyHistory');

const accounts = [{ _id: 'card', type: 'card' }, { _id: 'cash', type: 'cash' }];
const tx = (id, changes = {}) => ({ _id: String(id).padStart(3, '0'), amount: 10, type: 'expense', category: 'Еда', account: 'card', date: '2026-09-20', ...changes });
const rows = page => Object.values(page.transactions).flatMap(day => day.items);

describe('paged history', () => {
    it('crosses month/year boundaries and pages back toward newer operations without gaps', () => {
        const docs = [tx(1, { date: '2025-12-31' }), tx(2, { date: '2026-01-01' }),
            tx(3, { date: '2026-09-30' }), tx(4, { date: '2026-10-01' }), tx(5, { date: '2026-10-02' })];
        const options = parseHistoryQuery({ month: '2026-09', continuous: '1', limit: '2' });
        expect(options.filter).toEqual({});
        const first = buildHistoryPage(docs, accounts, options);
        expect(rows(first).map(t => t.id)).toEqual(['003', '002']);
        expect(first.count).toBe(5);
        const older = buildHistoryPage(docs, accounts, { ...options, cursor: JSON.parse(first.nextCursor) });
        expect(rows(older).map(t => t.id)).toEqual(['001']);
        const newer = buildHistoryPage(docs, accounts, { ...options, cursor: JSON.parse(first.previousCursor), direction: 'newer' });
        expect(rows(newer).map(t => t.id)).toEqual(['005', '004']);
        expect(newer.previousCursor).toBeNull();
        const back = buildHistoryPage(docs, accounts, { ...options, cursor: JSON.parse(newer.nextCursor) });
        expect(rows(back).map(t => t.id)).toEqual(['003', '002']);
    });

    it('takes the nearest newer page and can leave an empty anchor month', () => {
        const docs = [tx(1, { date: '2026-09-01' }), tx(2, { date: '2026-10-01' }), tx(3, { date: '2026-10-02' })];
        const options = parseHistoryQuery({ month: '2026-08', continuous: '1', limit: '1' });
        const first = buildHistoryPage(docs, accounts, options);
        expect(rows(first)).toEqual([]);
        expect(first.nextCursor).toBeNull();
        const second = buildHistoryPage(docs, accounts, { ...options, cursor: JSON.parse(first.previousCursor), direction: 'newer' });
        expect(rows(second).map(t => t.id)).toEqual(['001']);
        expect(second.previousCursor).not.toBeNull();
    });

    it('applies every filter across months and searches newer than the anchor', () => {
        const docs = [tx(1, { date: '2026-09-30', description: 'Кофе' }),
            tx(2, { date: '2026-10-01', description: 'Кофе' }),
            tx(3, { account: 'cash' }), tx(4, { type: 'income' }), tx(5, { category: 'Дом' })];
        const options = parseHistoryQuery({ month: '2026-10', continuous: '1', account: 'card', category: 'Еда', type: 'expense' });
        expect(rows(buildHistoryPage(docs, accounts, options)).map(t => t.id)).toEqual(['002', '001']);
        const search = buildHistoryPage(docs, accounts, { ...options, month: '2026-08', q: 'Кофе' });
        expect(rows(search).map(t => t.id)).toEqual(['002', '001']);
    });

    it('returns 40 rows and full daily totals; later pages have no duplicates', () => {
        const docs = Array.from({ length: 91 }, (_, i) => tx(i));
        const options = parseHistoryQuery({ month: '2026-09' });
        const first = buildHistoryPage(docs, accounts, options);
        expect(rows(first)).toHaveLength(40);
        expect(first.transactions['2026-09-20'].dailySum).toBe(-910);
        const second = buildHistoryPage(docs, accounts, { ...options, cursor: JSON.parse(first.nextCursor) });
        const third = buildHistoryPage(docs, accounts, { ...options, cursor: JSON.parse(second.nextCursor) });
        expect(rows(second)).toHaveLength(40);
        expect(rows(third)).toHaveLength(11);
        expect(third.nextCursor).toBeNull();
        expect(new Set([...rows(first), ...rows(second), ...rows(third)].map(t => t.id)).size).toBe(91);
    });

    it('does not cut a split purchase at a page boundary', () => {
        const docs = [tx(1, { splitId: 'split_1' }), tx(2, { splitId: 'split_1', amount: 25 }), tx(3)];
        const first = buildHistoryPage(docs, accounts, parseHistoryQuery({ month: '2026-09', limit: '1' }));
        expect(rows(first)[0]).toMatchObject({ type: 'split_group', visualAmount: -35 });
        expect(rows(first)[0].items).toHaveLength(2);
        expect(first.transactions['2026-09-20'].dailySum).toBe(-45);
    });

    it('cursor is stable when a newer operation is inserted', () => {
        const docs = [tx(1), tx(2), tx(3)];
        const options = parseHistoryQuery({ month: '2026-09', limit: '2' });
        const first = buildHistoryPage(docs, accounts, options);
        const second = buildHistoryPage([...docs, tx(4)], accounts, { ...options, cursor: JSON.parse(first.nextCursor) });
        expect(rows(second).map(t => t.id)).toEqual(['001']);
    });

    it('filters before pagination, includes incoming transfers and searches all years', () => {
        const docs = [tx(1), tx(2, { date: '2025-12-01', description: 'Редкая покупка' }),
            tx(3, { type: 'transfer', toAccount: 'cash' }), tx(4, { account: 'cash' })];
        const cash = buildHistoryPage(docs, accounts, parseHistoryQuery({ month: '2026-09', account: 'cash', limit: '1' }));
        expect(cash.count).toBe(2);
        const search = buildHistoryPage(docs, accounts, parseHistoryQuery({ month: '2026-09', q: 'Редкая' }));
        expect(rows(search).map(t => t.id)).toEqual(['002']);
        expect(search.count).toBe(1);
        const filter = parseHistoryQuery({ month: '2026-09', timeRange: 'year' }).filter;
        expect(filter.date.$gte.toISOString()).toBe('2026-01-01T00:00:00.000Z');
        expect(filter.date.$lt.toISOString()).toBe('2027-01-01T00:00:00.000Z');
    });

    it.each([{ limit: '0' }, { limit: '101' }, { limit: 'a' }, { month: '2026-13' }, { timeRange: 'week' }, { cursor: 'bad' }, { cursor: '{}' }])('rejects malformed pagination: %j', query => {
        expect(parseHistoryQuery(query).error).toBeTruthy();
    });

    it('keeps lifetime balances independent of the first page and loads analytics explicitly', () => {
        const docs = [tx(0, { type: 'income', amount: 5000, date: '2025-12-01' }), ...Array.from({ length: 91 }, (_, i) => tx(i + 1))];
        const options = { month: '2026-09', today: '2026-09-24', analytics: false };
        const summary = buildDashboard(docs, accounts, options);
        expect(summary.balances.total).toBe(4090);
        expect(summary.month.expense).toBe(-910);
        expect(summary.month.transactions).toBeUndefined();
        expect(summary.comparison).toBeUndefined();
        expect(buildDashboard(docs, accounts, { ...options, analytics: true }).comparison).toBeDefined();
    });

    it('retains historical company choices without returning financial details', () => {
        const docs = [tx(1, { description: 'Old shop', logoMode: 'domain', merchantDomain: 'shop.com', date: '2025-12-01' }),
            tx(2, { description: 'Old shop', logoMode: 'category' }), tx(3, { description: 'Saved', logoMode: 'category' })];
        const choices = companyHistory(docs, [{ name: 'Saved' }], 'shop');
        expect(choices).toEqual([{ type: 'expense', companyName: 'Old shop', logoMode: 'category', merchantDomain: '' }]);
    });
});
