import { describe, expect, it } from 'vitest';
import { getHistoricalLogoChoice } from './transactionLogoHistory';

const transaction = (overrides = {}) => ({
  id: '000000000000000000000001',
  type: 'expense',
  description: 'Mr & Mrs Pet',
  date: '2026-09-10',
  logoMode: 'domain',
  merchantDomain: 'mrpet.com',
  category: 'Питомцы',
  account: 'card',
  ...overrides,
});
const chosenDomain = { logoMode: 'domain', merchantDomain: 'mrpet.com' };

describe('historical transaction logo choice', () => {
  it.each(['mr& mrs pet', ' MR &MRS PET ', 'Mr&Mrs   Pet', 'mr\u00a0&\u00a0mrs pet', 'Ｍｒ ＆ Ｍｒｓ Ｐｅｔ'])('matches case and normalized spacing in %s', description => {
    expect(getHistoricalLogoChoice([transaction()], description)).toEqual(chosenDomain);
  });

  it('uses a prior choice across categories and accounts', () => {
    expect(getHistoricalLogoChoice([
      transaction({ category: 'Другое', account: 'cash' }),
    ], 'Mr & Mrs Pet')).toEqual(chosenDomain);
  });

  it('ignores newer automatic and legacy entries instead of losing an explicit choice', () => {
    const rows = [
      transaction(),
      transaction({ id: 'new-auto', date: '2026-09-11', logoMode: 'auto', merchantDomain: 'wrong.com' }),
      transaction({ id: 'new-legacy', date: '2026-09-12', logoMode: undefined, merchantDomain: undefined }),
    ];
    expect(getHistoricalLogoChoice(rows, 'mr&mrs pet')).toEqual(chosenDomain);
    expect(getHistoricalLogoChoice([...rows].reverse(), 'mr&mrs pet')).toEqual(chosenDomain);
  });

  it('selects the latest explicit transaction date independently of array order', () => {
    const rows = [
      transaction({ id: 'z', date: '2026-09-09', merchantDomain: 'oldpet.com' }),
      transaction({ id: 'a', date: '2026-09-12', merchantDomain: 'newpet.com' }),
      transaction({ id: 'm', date: '2026-09-10' }),
    ];
    const expected = { logoMode: 'domain', merchantDomain: 'newpet.com' };
    expect(getHistoricalLogoChoice(rows, 'Mr & Mrs Pet')).toEqual(expected);
    expect(getHistoricalLogoChoice([...rows].reverse(), 'Mr & Mrs Pet')).toEqual(expected);
  });

  it('inherits an explicit category choice and clears any unrelated domain', () => {
    const rows = [transaction(), transaction({ date: '2026-09-11', logoMode: 'category', merchantDomain: 'old.com' })];
    expect(getHistoricalLogoChoice(rows, 'Mr & Mrs Pet')).toEqual({ logoMode: 'category', merchantDomain: '' });
  });

  it('allows a later chosen company to replace a category choice', () => {
    const rows = [transaction({ date: '2026-09-09', logoMode: 'category' }), transaction()];
    expect(getHistoricalLogoChoice(rows, 'Mr & Mrs Pet')).toEqual(chosenDomain);
  });

  it('uses id or raw Mongo _id as a deterministic same-date tie-breaker', () => {
    const rows = [
      transaction({ id: undefined, _id: '000000000000000000000009', merchantDomain: 'latestpet.com' }),
      transaction({ id: '000000000000000000000002' }),
    ];
    const expected = { logoMode: 'domain', merchantDomain: 'latestpet.com' };
    expect(getHistoricalLogoChoice(rows, 'Mr & Mrs Pet')).toEqual(expected);
    expect(getHistoricalLogoChoice([...rows].reverse(), 'Mr & Mrs Pet')).toEqual(expected);
  });

  it('still resolves identical dates without IDs independently of input order', () => {
    const rows = [transaction({ id: undefined, merchantDomain: 'apet.com' }), transaction({ id: undefined, merchantDomain: 'zpet.com' })];
    expect(getHistoricalLogoChoice(rows, 'Mr & Mrs Pet')).toEqual(getHistoricalLogoChoice([...rows].reverse(), 'Mr & Mrs Pet'));
  });

  it.each(['Mr and Mrs Pet', 'Mr & Mrs Pet Shop', 'Mr & Mrs Pets', 'Mr. & Mrs. Pet', 'Mr-Mrs Pet', 'Mrs Pet'])('does not fuzzy-match a distinct shop description %s', description => {
    expect(getHistoricalLogoChoice([transaction()], description)).toBeNull();
  });

  it('ignores non-expenses, deleted rows, invalid domains, invalid dates and empty descriptions', () => {
    const rows = [
      transaction(),
      ...['income', 'transfer', 'initial', 'split_group'].map(type => transaction({ type, date: '2026-09-12' })),
      transaction({ deletedAt: '2026-09-11T12:00:00Z', date: '2026-09-12', merchantDomain: 'deleted.com' }),
      transaction({ merchantDomain: '127.0.0.1', date: '2026-09-12' }),
      transaction({ merchantDomain: 'javascript:alert(1)', date: '2026-09-12' }),
      transaction({ merchantDomain: '', date: '2026-09-12' }),
      transaction({ date: 'invalid date', merchantDomain: 'invalid.com' }),
      transaction({ date: null, merchantDomain: 'invalid.com' }),
      transaction({ description: '', date: '2026-09-12', merchantDomain: 'blank.com' }),
      transaction({ description: 'Mr & Mrs Pet Shop', date: '2026-09-12', merchantDomain: 'different.com' }),
      null,
    ];
    expect(getHistoricalLogoChoice(rows, 'Mr & Mrs Pet')).toEqual(chosenDomain);
  });

  it('normalizes a valid inherited domain and accepts an active restored transaction', () => {
    expect(getHistoricalLogoChoice([transaction({ merchantDomain: ' MRPET.COM ', deletedAt: null })], 'Mr & Mrs Pet')).toEqual(chosenDomain);
  });

  it('returns null for an empty description or absent history', () => {
    for (const description of ['', '   ', null, undefined]) {
      expect(getHistoricalLogoChoice([transaction()], description)).toBeNull();
    }
    expect(getHistoricalLogoChoice([], 'Mr & Mrs Pet')).toBeNull();
    expect(getHistoricalLogoChoice(null, 'Mr & Mrs Pet')).toBeNull();
    expect(getHistoricalLogoChoice(undefined, 'Mr & Mrs Pet')).toBeNull();
  });

  it('does not mutate transaction objects or sort the input array', () => {
    const first = Object.freeze(transaction({ merchantDomain: ' MRPET.COM ' }));
    const second = Object.freeze(transaction({ id: '000000000000000000000000', merchantDomain: 'older.com' }));
    const rows = Object.freeze([first, second]);
    expect(getHistoricalLogoChoice(rows, 'Mr & Mrs Pet')).toEqual(chosenDomain);
    expect(rows[0]).toBe(first);
    expect(first.merchantDomain).toBe(' MRPET.COM ');
  });
});
