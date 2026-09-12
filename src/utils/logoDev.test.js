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

  it('keeps a chosen company even when its name is ambiguous or changes', () => {
    const selected = { ...expense('Chop Chop', 'Красота'), logoMode: 'domain', merchantDomain: 'chophairdressing.com' };
    const url = getTransactionLogoUrl(selected, key);
    expect(new URL(url).pathname).toBe('/chophairdressing.com');
    expect(getTransactionLogoUrl({ ...selected, description: 'Стрижка' }, key)).toBe(url);
    expect(getTransactionLogoUrl({ ...selected, description: '' }, key)).toBe(url);
  });

  it('respects category-only mode and does not silently guess after an invalid selection', () => {
    expect(getTransactionLogoUrl({ ...expense('Wolt'), logoMode: 'category' }, key)).toBeNull();
    expect(getTransactionLogoUrl({ ...expense('Wolt'), logoMode: 'domain', merchantDomain: 'localhost' }, key)).toBeNull();
    expect(new URL(getTransactionLogoUrl({ ...expense('Wolt'), logoMode: 'auto', merchantDomain: 'zara.com' }, key)).pathname).toBe('/wolt.com');
  });

  it('only sends the company snapshot to name lookup, never its separate comment or registry id', () => {
    const item = { ...expense('Секретный подарок из Zara'), companyId: 'private-company-id', companyName: 'Nomad Bread & Coffee' };
    const url = getTransactionLogoUrl(item, key);
    expect(decodeURIComponent(new URL(url).pathname)).toBe('/name/nomad bread coffee');
    expect(decodeURIComponent(url)).not.toMatch(/Секретный|Zara|private-company-id/);
    expect(getTransactionLogoUrl({ ...item, description: 'Другой комментарий' }, key)).toBe(url);
    expect(getTransactionLogoUrl({ ...item, companyName: '' }, key)).toBeNull();
    expect(getTransactionLogoUrl({ ...item, companyName: '', logoMode: 'domain', merchantDomain: 'zara.com' }, key)).toBeNull();
  });

  it('looks up a common split company without guessing from legacy or mixed group comments', () => {
    const group = { type: 'split_group', companyName: 'Wolt', logoMode: 'domain', merchantDomain: 'wolt.com', description: 'Покупки на выходные' };
    expect(new URL(getTransactionLogoUrl(group, key)).pathname).toBe('/wolt.com');
    expect(new URL(getTransactionLogoUrl({ ...group, logoMode: 'auto' }, key)).pathname).toBe('/wolt.com');
    expect(getTransactionLogoUrl({ ...group, companyName: '' }, key)).toBeNull();
    expect(getTransactionLogoUrl({ ...group, logoMode: 'category' }, key)).toBeNull();
    expect(getTransactionLogoUrl({ type: 'split_group', description: 'Wolt' }, key)).toBeNull();
  });
});
