import { describe, it, expect } from 'vitest';
import { describeEmptySearch, hasActiveFilters } from './historyEmpty';

describe('describeEmptySearch', () => {
  it('names only the query when no filter is active', () => {
    expect(describeEmptySearch({ query: ' кофе ' })).toBe('По запросу «кофе» операций нет.');
  });

  it.each([
    [{ accountName: 'Карта' }, 'По запросу «x» на счёте Карта операций нет. Возможно, мешает фильтр.'],
    [{ category: 'Еда' }, 'По запросу «x» в категории «Еда» операций нет. Возможно, мешает фильтр.'],
    [{ type: 'income' }, 'По запросу «x» среди доходов операций нет. Возможно, мешает фильтр.'],
    [{ type: 'expense' }, 'По запросу «x» среди расходов операций нет. Возможно, мешает фильтр.'],
    [
      { accountName: 'Карта', category: 'Еда', type: 'expense' },
      'По запросу «x» на счёте Карта в категории «Еда» среди расходов операций нет. Возможно, мешает фильтр.',
    ],
  ])('adds the active filters %j', (filters, text) => {
    expect(describeEmptySearch({ query: 'x', ...filters })).toBe(text);
  });
});

describe('hasActiveFilters', () => {
  it('is true when any of account, category or type is set', () => {
    expect(hasActiveFilters({ account: null, category: null, type: null })).toBe(false);
    expect(hasActiveFilters({ account: 'card' })).toBe(true);
    expect(hasActiveFilters({ category: 'Еда' })).toBe(true);
    expect(hasActiveFilters({ type: 'income' })).toBe(true);
  });
});
