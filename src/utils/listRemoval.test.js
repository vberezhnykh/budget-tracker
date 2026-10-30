import { describe, it, expect } from 'vitest';
import { applyListRemovals } from './listRemoval';

// Элемент списка, как его отдаёт /api/history.
const row = (id, overrides = {}) => ({ id, type: 'expense', visualAmount: -10, account: 'card', date: '2026-09-24', ...overrides });
const split = (id, parts) => ({
  id, type: 'split_group', date: '2026-09-24', account: 'card',
  visualAmount: parts.reduce((sum, part) => sum + part.visualAmount, 0), items: parts,
});

describe('applyListRemovals', () => {
  const groups = {
    '2026-09-24': { items: [row('c'), row('b', { visualAmount: -4 }), row('a')], dailySum: -24 },
    '2026-09-23': { items: [row('z', { date: '2026-09-23' })], dailySum: -10 },
  };

  it('keeps the removed row in its day, marks it leaving and takes it out of the day sum', () => {
    const { groups: next, leavingIds } = applyListRemovals(groups, [{ id: 'b' }]);

    expect([...leavingIds]).toEqual(['b']);
    expect(next['2026-09-24'].items.map(item => item.id)).toEqual(['c', 'b', 'a']);
    expect(next['2026-09-24'].dailySum).toBe(-20);
    // Нетронутый день - тот же объект; входные группы не меняются.
    expect(next['2026-09-23']).toBe(groups['2026-09-23']);
    expect(groups['2026-09-24'].dailySum).toBe(-24);
  });

  it('returns the very same groups and no leaving ids when there is nothing to remove', () => {
    for (const removals of [[], undefined, [{ id: 'unknown' }]]) {
      const result = applyListRemovals(groups, removals);
      expect(result.groups).toBe(groups);
      expect(result.leavingIds.size).toBe(0);
    }
  });

  it('subtracts an income as a negative contribution to the day sum', () => {
    const income = { '2026-09-24': { items: [row('i', { type: 'income', visualAmount: 100 }), row('e')], dailySum: 90 } };

    expect(applyListRemovals(income, [{ id: 'i' }]).groups['2026-09-24'].dailySum).toBe(-10);
  });

  it('leaves the day sum alone for transfers, opening balances and rows excluded from statistics', () => {
    const odd = {
      '2026-09-24': {
        items: [
          row('t', { type: 'transfer', visualAmount: -50, toAccount: 'cash' }),
          row('o', { type: 'initial', visualAmount: 500 }),
          row('x', { excludeFromStats: true, visualAmount: -7 }),
          row('n'),
        ],
        dailySum: -10,
      },
    };

    const { groups: next, leavingIds } = applyListRemovals(odd, [{ id: 't' }, { id: 'o' }, { id: 'x' }]);

    expect([...leavingIds].sort()).toEqual(['o', 't', 'x']);
    expect(next['2026-09-24'].dailySum).toBe(-10);
  });

  describe('split purchases', () => {
    const parts = [row('p1', { splitId: 's1', visualAmount: -30 }), row('p2', { splitId: 's1', visualAmount: -70 })];
    const withSplit = {
      '2026-09-24': { items: [split('s1', parts), row('a')], dailySum: -110 },
    };

    it('removes the whole group by its splitId and subtracts the sum of the parts', () => {
      const { groups: next, leavingIds } = applyListRemovals(withSplit, [{ id: 'p1', splitId: 's1' }]);

      expect([...leavingIds]).toEqual(['s1']);
      expect(next['2026-09-24'].dailySum).toBe(-10);
      expect(next['2026-09-24'].items.map(item => item.id)).toEqual(['s1', 'a']);
    });

    it('counts only the parts that contribute to the statistics', () => {
      const mixed = { '2026-09-24': { items: [split('s1', [
        row('p1', { splitId: 's1', visualAmount: -30 }),
        row('p2', { splitId: 's1', visualAmount: -70, excludeFromStats: true }),
      ])], dailySum: -30 } };

      expect(applyListRemovals(mixed, [{ id: 'p2', splitId: 's1' }]).groups['2026-09-24'].dailySum).toBe(0);
    });

    it('matches the group by the part id when the list holds it under another split id', () => {
      const { leavingIds } = applyListRemovals(withSplit, [{ id: 'p2', splitId: 'other' }]);

      expect([...leavingIds]).toEqual(['s1']);
    });

    it('does not touch the group when a single part was deleted without a splitId', () => {
      const result = applyListRemovals(withSplit, [{ id: 'p1', splitId: null }]);

      expect(result.groups).toBe(withSplit);
      expect(result.leavingIds.size).toBe(0);
    });

    it('matches the group by splitId and a plain row by its id independently', () => {
      const { leavingIds } = applyListRemovals(withSplit, [{ id: 'a', splitId: 's1' }]);

      expect([...leavingIds].sort()).toEqual(['a', 's1']);
    });
  });

  it('takes every row of a day out and leaves the day with an empty sum', () => {
    const { groups: next, leavingIds } = applyListRemovals(groups, [{ id: 'z' }]);

    expect([...leavingIds]).toEqual(['z']);
    expect(next['2026-09-23'].items).toHaveLength(1);
    expect(next['2026-09-23'].dailySum).toBe(0);
  });

  it('applies several removals at once and compares ids as strings', () => {
    const { groups: next, leavingIds } = applyListRemovals(groups, [{ id: 'c' }, { id: 'a' }, { id: 'z' }]);

    expect([...leavingIds].sort()).toEqual(['a', 'c', 'z']);
    expect(next['2026-09-24'].dailySum).toBe(-4);
    expect(next['2026-09-23'].dailySum).toBe(0);

    const numeric = { '2026-09-24': { items: [row(7)], dailySum: -10 } };
    expect([...applyListRemovals(numeric, [{ id: '7' }]).leavingIds]).toEqual(['7']);
  });
});
