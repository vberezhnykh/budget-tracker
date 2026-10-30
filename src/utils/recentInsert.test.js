import { describe, it, expect } from 'vitest';
import { insertRecentTransaction } from './recentInsert';

// Сырой документ - то, что отдаёт POST /api/transactions (JSON mongoose-документа).
const doc = (id, overrides = {}) => ({
  _id: id, title: 'Кофе', amount: 4.5, type: 'expense', category: 'Еда', description: 'Латте',
  account: 'card', date: '2026-09-24T00:00:00.000Z', __v: 0, ...overrides,
});

// Элемент списка, как его отдаёт /api/history.
const row = (id, overrides = {}) => ({ id, type: 'expense', visualAmount: -10, account: 'card', date: '2026-09-24', ...overrides });

const query = { month: '2026-09', account: null, limit: 5 };
const idsOf = groups => Object.keys(groups).sort().reverse()
  .flatMap(date => groups[date].items.map(item => item.id));

describe('insertRecentTransaction', () => {
  const groups = {
    '2026-09-24': { items: [row('64a'), row('639')], dailySum: -20 },
    '2026-09-23': { items: [row('638', { date: '2026-09-23' })], dailySum: -10 },
  };

  it('puts a new expense on top of its day and updates the day sum', () => {
    const result = insertRecentTransaction(groups, doc('65f'), query);

    expect(result.id).toBe('65f');
    expect(result.groups['2026-09-24'].items.map(item => item.id)).toEqual(['65f', '64a', '639']);
    expect(result.groups['2026-09-24'].dailySum).toBeCloseTo(-24.5);
    expect(result.groups['2026-09-23']).toEqual(groups['2026-09-23']);
    // Входные группы не меняются.
    expect(groups['2026-09-24'].items).toHaveLength(2);
  });

  it('builds the row the way the server transform does', () => {
    const { groups: next } = insertRecentTransaction({}, doc('65f', { companyName: 'Cafe', companyId: 7, logoMode: undefined }), query);

    expect(next['2026-09-24'].items[0]).toMatchObject({
      id: '65f', __v: 0, title: 'Кофе', amount: 4.5, visualAmount: -4.5, type: 'expense', category: 'Еда',
      description: 'Латте', companyName: 'Cafe', companyId: '7', logoMode: 'auto', account: 'card', toAccount: null,
      date: '2026-09-24', excludeFromStats: false,
    });
  });

  it('counts income as a positive amount and adds it to the day sum', () => {
    const { groups: next } = insertRecentTransaction(groups, doc('65f', { type: 'income', amount: 100, category: 'Зарплата' }), query);

    expect(next['2026-09-24'].items[0].visualAmount).toBe(100);
    expect(next['2026-09-24'].dailySum).toBe(80);
  });

  it('shows a transfer with an absolute amount and leaves the day sum alone', () => {
    const { groups: next, id } = insertRecentTransaction(groups, doc('65f', { type: 'transfer', amount: 50, category: 'Обмен', toAccount: 'cash' }), query);

    expect(id).toBe('65f');
    expect(next['2026-09-24'].items[0]).toMatchObject({ visualAmount: 50, category: 'Перевод', toAccount: 'cash' });
    expect(next['2026-09-24'].dailySum).toBe(-20);
  });

  it('shows an excluded operation without counting it in the day sum', () => {
    const { groups: next } = insertRecentTransaction(groups, doc('65f', { excludeFromStats: true }), query);

    expect(next['2026-09-24'].items[0]).toMatchObject({ id: '65f', excludeFromStats: true });
    expect(next['2026-09-24'].dailySum).toBe(-20);
  });

  it('turns an array of parts into one split_group on top of the day', () => {
    const saved = [
      doc('65a', { splitId: 'split_1', amount: 10, category: 'Еда', description: 'Магазин (Еда)' }),
      doc('65b', { splitId: 'split_1', amount: 5, category: 'Дом', description: 'Магазин (Дом)' }),
    ];

    const { groups: next, id } = insertRecentTransaction(groups, saved, query);

    expect(id).toBe('split_1');
    const [group, ...rest] = next['2026-09-24'].items;
    expect(group).toMatchObject({ id: 'split_1', type: 'split_group', date: '2026-09-24', description: 'Магазин', account: 'card', visualAmount: -15 });
    expect(group.items.map(item => item.id)).toEqual(['65a', '65b']);
    expect(rest.map(item => item.id)).toEqual(['64a', '639']);
    expect(next['2026-09-24'].dailySum).toBe(-35);
  });

  it('unifies company, comment and logo of split parts like the server does', () => {
    const saved = [
      doc('65a', { splitId: 'split_1', companyName: 'Lidl', description: 'Чек', logoMode: 'domain', merchantDomain: 'lidl.de' }),
      doc('65b', { splitId: 'split_1', companyName: 'Lidl', description: 'Чек', logoMode: 'domain', merchantDomain: 'lidl.de' }),
    ];
    const [group] = insertRecentTransaction({}, saved, query).groups['2026-09-24'].items;
    expect(group).toMatchObject({ companyName: 'Lidl', description: 'Чек', logoMode: 'domain', merchantDomain: 'lidl.de' });

    const mixed = [
      doc('65a', { splitId: 'split_2', companyName: 'Lidl', description: 'Чек' }),
      doc('65b', { splitId: 'split_2', companyName: 'Aldi', description: 'Чек 2' }),
    ];
    const [other] = insertRecentTransaction({}, mixed, query).groups['2026-09-24'].items;
    expect(other).toMatchObject({ companyName: '', description: '' });
  });

  it('keeps a split group above plain rows of the day, as the server sorts them', () => {
    const withSplit = { '2026-09-24': { items: [{ id: 'split_5', type: 'split_group', visualAmount: -9, items: [row('x1')] }, row('64a')], dailySum: -19 } };

    const { groups: next } = insertRecentTransaction(withSplit, doc('65f'), query);

    expect(next['2026-09-24'].items.map(item => item.id)).toEqual(['split_5', '65f', '64a']);
  });

  it('drops the oldest row when the list is over the limit', () => {
    const full = {
      '2026-09-24': { items: [row('64a'), row('649'), row('648')], dailySum: -30 },
      '2026-09-23': { items: [row('638', { date: '2026-09-23' }), row('637', { date: '2026-09-23' })], dailySum: -20 },
    };

    const { groups: next } = insertRecentTransaction(full, doc('65f'), query);

    expect(idsOf(next)).toEqual(['65f', '64a', '649', '648', '638']);
    expect(next['2026-09-23'].items.map(item => item.id)).toEqual(['638']);
    // Сумма вчерашнего дня остаётся серверной: она считается по всему дню.
    expect(next['2026-09-23'].dailySum).toBe(-20);
  });

  it('removes a day whose rows were all trimmed away', () => {
    const full = {
      '2026-09-24': { items: [row('64a'), row('649'), row('648'), row('647')], dailySum: -40 },
      '2026-09-23': { items: [row('638', { date: '2026-09-23' })], dailySum: -10 },
    };

    const { groups: next } = insertRecentTransaction(full, doc('65f'), query);

    expect(Object.keys(next)).toEqual(['2026-09-24']);
  });

  it('leaves groups untouched when the new row would fall outside the limit', () => {
    const full = { '2026-09-24': { items: [row('64a'), row('649'), row('648'), row('647'), row('646')], dailySum: -50 } };

    const result = insertRecentTransaction(full, doc('600', { date: '2026-09-20T00:00:00.000Z' }), query);

    expect(result).toEqual({ groups: full, id: null });
    expect(result.groups).toBe(full);
  });

  it('appends an older row while the list is shorter than the limit', () => {
    const result = insertRecentTransaction(groups, doc('600', { date: '2026-09-20T00:00:00.000Z' }), query);

    expect(idsOf(result.groups)).toEqual(['64a', '639', '638', '600']);
    expect(result.groups['2026-09-20'].dailySum).toBe(-4.5);
  });

  it('creates a new date group, ordering it among the existing ones', () => {
    const result = insertRecentTransaction(groups, doc('65f', { date: '2026-09-25T00:00:00.000Z' }), query);

    expect(Object.keys(result.groups).sort()).toEqual(['2026-09-23', '2026-09-24', '2026-09-25']);
    expect(result.groups['2026-09-25']).toEqual({ items: [expect.objectContaining({ id: '65f' })], dailySum: -4.5 });
    expect(result.groups['2026-09-24']).toEqual(groups['2026-09-24']);
  });

  it('inserts into an empty list', () => {
    const { groups: next } = insertRecentTransaction({}, doc('65f'), query);

    expect(idsOf(next)).toEqual(['65f']);
    expect(next['2026-09-24'].dailySum).toBe(-4.5);
  });

  describe('account filter', () => {
    it('skips an operation of another account', () => {
      const result = insertRecentTransaction(groups, doc('65f', { account: 'cash' }), { ...query, account: 'card' });

      expect(result).toEqual({ groups, id: null });
    });

    it('inserts an operation of the selected account', () => {
      const result = insertRecentTransaction(groups, doc('65f', { account: 'cash' }), { ...query, account: 'cash' });

      expect(result.id).toBe('65f');
    });

    it('matches a transfer by its destination account', () => {
      const transfer = doc('65f', { type: 'transfer', account: 'card', toAccount: 'cash' });

      expect(insertRecentTransaction(groups, transfer, { ...query, account: 'cash' }).id).toBe('65f');
      expect(insertRecentTransaction(groups, transfer, { ...query, account: 'savings' }).id).toBeNull();
    });

    it('keeps only the matching parts of a split purchase and skips it when none match', () => {
      const saved = [
        doc('65a', { splitId: 'split_1', account: 'card', amount: 10 }),
        doc('65b', { splitId: 'split_1', account: 'cash', amount: 5 }),
      ];

      const cash = insertRecentTransaction({}, saved, { ...query, account: 'cash' });
      expect(cash.groups['2026-09-24'].items[0]).toMatchObject({ id: 'split_1', visualAmount: -5 });
      expect(cash.groups['2026-09-24'].items[0].items.map(item => item.id)).toEqual(['65b']);
      expect(cash.groups['2026-09-24'].dailySum).toBe(-5);

      expect(insertRecentTransaction({}, saved, { ...query, account: 'savings' }).id).toBeNull();
    });

    it('relies on the refresh for a filter by account type', () => {
      const result = insertRecentTransaction(groups, doc('65f'), { ...query, account: 'type:card' });

      expect(result).toEqual({ groups, id: null });
    });
  });

  it('skips an operation dated after the requested month', () => {
    const result = insertRecentTransaction(groups, doc('65f', { date: '2026-10-02T00:00:00.000Z' }), query);

    expect(result).toEqual({ groups, id: null });
  });

  it('takes the day from the UTC part of the date, like the server', () => {
    const { groups: next } = insertRecentTransaction({}, doc('65f', { date: '2026-09-30T00:00:00.000Z' }), query);

    expect(Object.keys(next)).toEqual(['2026-09-30']);
  });

  it('skips an id that the server list already has, plain or as a split part', () => {
    expect(insertRecentTransaction(groups, doc('64a'), query)).toEqual({ groups, id: null });

    const withSplit = { '2026-09-24': { items: [{ id: 'split_1', type: 'split_group', items: [row('65a'), row('65b')] }], dailySum: -15 } };
    const saved = [doc('65a', { splitId: 'split_1' }), doc('65b', { splitId: 'split_1' })];
    expect(insertRecentTransaction(withSplit, saved, query)).toEqual({ groups: withSplit, id: null });
  });

  it('ignores answers that are not documents', () => {
    for (const saved of [null, undefined, [], {}, { message: 'ok' }, [null], { _id: 'tx-new' }, doc('65f', { amount: 'abc' }), [doc('65a'), { _id: 'x' }]]) {
      expect(insertRecentTransaction(groups, saved, query).id).toBeNull();
    }
  });
});
