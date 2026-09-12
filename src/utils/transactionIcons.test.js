import { describe, expect, it } from 'vitest';
import { resolveTransactionIcon } from './transactionIcons';

const expenseIcon = (description, category = 'Продукты') =>
  resolveTransactionIcon({ type: 'expense', description, category });

describe('transaction icon resolution', () => {
  it('recognizes merchant words after case, width and punctuation normalization', () => {
    expect(expenseIcon('  ＷＯＬＴ*123  ')).toEqual({ kind: 'merchant', id: 'wolt' });
    expect(expenseIcon('McDonald’s — Limassol')).toEqual({ kind: 'merchant', id: 'mcdonalds' });
    expect(expenseIcon('MC DONALD\'S')).toEqual({ kind: 'merchant', id: 'mcdonalds' });
  });

  it('does not confuse a merchant substring with a complete merchant word', () => {
    for (const name of ['Zaragoza', 'Bolton', 'WoltMarket', 'OpenAir cinema']) {
      expect(expenseIcon(name)).toEqual({ kind: 'category', id: 'groceries' });
    }
    expect(expenseIcon('Wolt — доставка')).toEqual({ kind: 'merchant', id: 'wolt' });
  });

  it('prefers the named Google service over its parent brand', () => {
    expect(expenseIcon('GOOGLE*Google One')).toEqual({ kind: 'merchant', id: 'googleone' });
    expect(expenseIcon('Google Store')).toEqual({ kind: 'merchant', id: 'google' });
  });

  it('uses the visible description and falls back to the title only when it is absent', () => {
    expect(resolveTransactionIcon({
      type: 'expense', description: 'Местный магазин', title: 'Wolt', category: 'Продукты',
    })).toEqual({ kind: 'category', id: 'groceries' });
    expect(resolveTransactionIcon({
      type: 'expense', description: 'Zara', title: 'Wolt', category: 'Продукты',
    })).toEqual({ kind: 'merchant', id: 'zara' });
    expect(resolveTransactionIcon({ type: 'expense', description: '', title: 'Wolt' }))
      .toEqual({ kind: 'merchant', id: 'wolt' });
  });

  it('keeps non-expense transaction semantics even when their name is a merchant', () => {
    for (const type of ['initial', 'transfer', 'income', 'split_group']) {
      expect(resolveTransactionIcon({ type, description: 'Wolt', category: 'Продукты' }))
        .toEqual({ kind: 'type', id: type });
    }
    expect(resolveTransactionIcon({ description: 'Wolt' }))
      .toEqual({ kind: 'category', id: 'other' });
  });

  it('normalizes category spelling and safely handles custom or missing categories', () => {
    expect(expenseIcon('Аренда квартиры', '  ЖИЛЬЁ  ')).toEqual({ kind: 'category', id: 'home' });
    expect(expenseIcon('Личная покупка', 'Моя категория')).toEqual({ kind: 'category', id: 'other' });
    expect(resolveTransactionIcon({ type: 'expense' })).toEqual({ kind: 'category', id: 'other' });
    expect(resolveTransactionIcon()).toEqual({ kind: 'category', id: 'other' });
  });
});
