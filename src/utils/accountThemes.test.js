import { describe, expect, it } from 'vitest';
import { getAccountThemes } from './accountThemes';

describe('getAccountThemes', () => {
  const accounts = Array.from({ length: 10 }, (_, index) => ({
    _id: `account-${index}`,
    name: `Счёт ${index}`,
    balance: index * 100,
  }));

  it('gives the first ten accounts distinct colors even when ID hashes collide', () => {
    const themes = getAccountThemes(accounts);
    expect(themes.size).toBe(accounts.length);
    expect(new Set(themes.values()).size).toBe(accounts.length);
    expect([...themes.values()]).not.toContain('total');
  });

  it('preserves identity colors after reordering, renaming, balance and freeze changes', () => {
    const updated = [...accounts].reverse().map(account => ({
      ...account,
      name: 'Переименован',
      balance: account.balance + 750,
      excludeFromTotal: true,
    }));
    expect(getAccountThemes(updated)).toEqual(getAccountThemes(accounts));
  });

  it('assigns colors to larger lists and accepts an empty list', () => {
    expect(getAccountThemes([]).size).toBe(0);
    const many = Array.from({ length: 25 }, (_, index) => ({ _id: String(index) }));
    const themes = getAccountThemes(many);
    expect(themes.size).toBe(25);
    expect([...themes.values()].every(Boolean)).toBe(true);
    const counts = [...themes.values()].reduce((result, theme) => {
      result[theme] = (result[theme] || 0) + 1;
      return result;
    }, {});
    expect(Math.max(...Object.values(counts)) - Math.min(...Object.values(counts))).toBeLessThanOrEqual(1);
  });
});
