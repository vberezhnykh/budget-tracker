import { describe, expect, it } from 'vitest';
import { historyTotal } from './historySummary';

describe('historyTotal', () => {
  it('adds the day sums: incomes plus, expenses minus', () => {
    expect(historyTotal({
      '2026-01-05': { dailySum: -612.4, items: [] },
      '2026-01-01': { dailySum: 5000, items: [] },
    })).toBeCloseTo(4387.6, 2);
  });

  it('is zero for an empty or missing list and ignores a day without a sum', () => {
    expect(historyTotal({})).toBe(0);
    expect(historyTotal(null)).toBe(0);
    expect(historyTotal({ '2026-01-05': { items: [] } })).toBe(0);
  });
});
