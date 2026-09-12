import { describe, expect, it } from 'vitest';
import { getTransactionLogoUrl } from './logoDev';

const key = 'pk_test_public_key';
const expense = (description, category = 'Продукты') => ({ type: 'expense', description, category });

describe('Logo.dev transaction lookup', () => {
  it('looks up new brands beyond the retained local catalogue', () => {
    const url = new URL(getTransactionLogoUrl(expense('Nomad Bread & Coffee'), key));
    expect(url.origin).toBe('https://img.logo.dev');
    expect(decodeURIComponent(url.pathname)).toBe('/name/nomad bread coffee');
    expect(url.searchParams.get('fallback')).toBe('404');
    expect(url.searchParams.get('size')).toBe('80');
    expect(url.searchParams.get('format')).toBe('webp');
  });

  it('reuses the same URL across casing, spacing, amounts, dates and accounts', () => {
    const first = getTransactionLogoUrl({ ...expense(' WOLT '), amount: 10, account: 'private-1', date: '2026-01-01' }, key);
    const second = getTransactionLogoUrl({ ...expense('wolt'), amount: 25, account: 'private-2', date: '2026-09-12' }, key);
    expect(first).toBe(second);
    expect(first).not.toMatch(/private|2026|amount/);
    expect(new URL(first).pathname).toBe('/wolt.com');
    expect(new URL(getTransactionLogoUrl(expense('McDonald’s'), key)).pathname).toBe('/mcdonalds.com');
  });

  it('does not search category labels, empty names or non-expense operations', () => {
    for (const item of [expense('Такси', 'Такси'), expense('Продукты'), expense(''), expense('12345'),
      { ...expense('Wolt'), type: 'income' }, { ...expense('Zara'), type: 'transfer' }]) {
      expect(getTransactionLogoUrl(item, key)).toBeNull();
    }
    expect(getTransactionLogoUrl(expense('Wolt'), '')).toBeNull();
    expect(getTransactionLogoUrl(expense('Wolt'), 'sk_private_key')).toBeNull();
  });
});
