import { describe, it, expect } from 'vitest';
import { applyListEdits } from './listEdit';

// Сырой документ - то, что отдаёт PUT /api/transactions/:id (JSON mongoose-документа).
const doc = (id, overrides = {}) => ({
  _id: id, title: 'Кофе', amount: 4.5, type: 'expense', category: 'Еда', description: 'Латте',
  account: 'card', date: '2026-09-24T00:00:00.000Z', __v: 1, ...overrides,
});

// Элемент списка, как его отдаёт /api/history.
const row = (id, overrides = {}) => ({ id, type: 'expense', visualAmount: -10, account: 'card', category: 'Еда', date: '2026-09-24', ...overrides });

const query = { month: '2026-09', account: null, limit: 5 };
const edit = (saved, seq = 1) => ({ id: String(saved?._id), saved, seq });
const flags = day => day.items.map(item => [item.id, Boolean(item.movedAway)]);

describe('applyListEdits', () => {
  const groups = {
    '2026-09-24': { items: [row('64a'), row('639')], dailySum: -20 },
    '2026-09-23': { items: [row('638', { date: '2026-09-23' })], dailySum: -10 },
  };

  it('returns the same groups and the empty constants when there is nothing to apply', () => {
    const result = applyListEdits(groups, [], query);
    const again = applyListEdits(groups, [], query);

    expect(result.groups).toBe(groups);
    expect(result.editedIds.size).toBe(0);
    expect(result.freshIds.size).toBe(0);
    expect(result.leavingIds.size).toBe(0);
    expect(again.editedIds).toBe(result.editedIds);
    expect(again.freshIds).toBe(result.freshIds);
  });

  it('replaces the row in place, fixes the day sum and keeps the untouched days as they were', () => {
    const result = applyListEdits(groups, [edit(doc('64a', { amount: 25, description: 'Капучино' }), 7)], query);

    expect(result.groups['2026-09-24'].items.map(item => item.id)).toEqual(['64a', '639']);
    expect(result.groups['2026-09-24'].items[0]).toMatchObject({ visualAmount: -25, description: 'Капучино', date: '2026-09-24' });
    expect(result.groups['2026-09-24'].items[1]).toBe(groups['2026-09-24'].items[1]);
    expect(result.groups['2026-09-24'].dailySum).toBeCloseTo(-35);
    expect(result.groups['2026-09-23']).toBe(groups['2026-09-23']);
    expect([...result.editedIds]).toEqual([['64a', 7]]);
    expect(result.freshIds.size).toBe(0);
    expect(result.leavingIds.size).toBe(0);
    // Входные группы не меняются.
    expect(groups['2026-09-24'].items[0]).toEqual(row('64a'));
    expect(groups['2026-09-24'].dailySum).toBe(-20);
  });

  it('turns an expense into income in place', () => {
    const result = applyListEdits(groups, [edit(doc('64a', { type: 'income', amount: 100 }))], query);

    expect(result.groups['2026-09-24'].items[0]).toMatchObject({ type: 'income', visualAmount: 100 });
    expect(result.groups['2026-09-24'].dailySum).toBe(90);
  });

  it('moves a row to another visible day: a ghost on the old place, a fresh row on the new one, both sums fixed', () => {
    const result = applyListEdits(groups, [edit(doc('639', { date: '2026-09-23T00:00:00.000Z', amount: 30 }), 3)], query);

    const oldDay = result.groups['2026-09-24'];
    expect(oldDay.items.map(item => item.id)).toEqual(['64a', '639']);
    expect(oldDay.items[1]).toMatchObject({ id: '639', movedAway: true, visualAmount: -10 });
    expect(oldDay.dailySum).toBe(-10);
    const newDay = result.groups['2026-09-23'];
    // Выше '638' по серверному порядку (id по убыванию).
    expect(newDay.items.map(item => item.id)).toEqual(['639', '638']);
    expect(newDay.items[0]).toMatchObject({ visualAmount: -30, date: '2026-09-23' });
    expect(newDay.items[0].movedAway).toBeUndefined();
    expect(newDay.dailySum).toBe(-40);
    expect([...result.freshIds]).toEqual(['639']);
    expect(result.editedIds.size).toBe(0);
    expect(result.leavingIds.size).toBe(0);
    expect(oldDay.items[0]).toBe(groups['2026-09-24'].items[0]);
    // Входные группы не меняются.
    expect(groups['2026-09-24'].items[1].movedAway).toBeUndefined();
  });

  it('moves a row to a day that is not in the list yet', () => {
    const result = applyListEdits(groups, [edit(doc('639', { date: '2026-09-25T00:00:00.000Z' }))], query);

    expect(Object.keys(result.groups).sort()).toEqual(['2026-09-23', '2026-09-24', '2026-09-25']);
    expect(result.groups['2026-09-25'].dailySum).toBe(-4.5);
    expect(result.groups['2026-09-25'].items.map(item => item.id)).toEqual(['639']);
    expect(result.groups['2026-09-24'].items[1].movedAway).toBe(true);
  });

  it('leaves only a ghost when the new date is past the month cap', () => {
    const result = applyListEdits(groups, [edit(doc('639', { date: '2026-10-02T00:00:00.000Z' }))], query);

    expect(Object.keys(result.groups).sort()).toEqual(['2026-09-23', '2026-09-24']);
    expect(result.groups['2026-09-24'].items[1]).toMatchObject({ id: '639', movedAway: true });
    expect(result.groups['2026-09-24'].dailySum).toBe(-10);
    expect(result.freshIds.size).toBe(0);
  });

  it('leaves only a ghost when the new place is past the limit', () => {
    const full = { '2026-09-24': { items: [row('64a'), row('639'), row('638')], dailySum: -30 } };

    const result = applyListEdits(full, [edit(doc('64a', { date: '2026-09-10T00:00:00.000Z' }))], { ...query, limit: 2 });

    // Без призрака в странице из двух строк уже стоят две настоящие: новому месту
    // в ней не нашлось.
    expect(Object.keys(result.groups)).toEqual(['2026-09-24']);
    expect(flags(result.groups['2026-09-24'])).toEqual([['64a', true], ['639', false], ['638', false]]);
    expect(result.groups['2026-09-24'].dailySum).toBe(-20);
    expect(result.freshIds.size).toBe(0);
  });

  it('trims the real rows beyond the limit after an insert, keeping ghosts and their days', () => {
    const full = {
      '2026-09-24': { items: [row('64a'), row('639')], dailySum: -20 },
      '2026-09-22': { items: [row('630', { date: '2026-09-22' })], dailySum: -10 },
    };

    const result = applyListEdits(full, [edit(doc('64a', { date: '2026-09-22T00:00:00.000Z' }))], { ...query, limit: 2 });

    // '64a' уходит призраком и встает в 22-е выше '630'; '630' оказывается за страницей.
    expect(flags(result.groups['2026-09-24'])).toEqual([['64a', true], ['639', false]]);
    expect(result.groups['2026-09-22'].items.map(item => item.id)).toEqual(['64a']);
    expect(result.groups['2026-09-22'].dailySum).toBeCloseTo(-14.5);
  });

  it('keeps a day that is left with ghosts only', () => {
    const lone = { '2026-09-24': { items: [row('64a')], dailySum: -10 } };

    const result = applyListEdits(lone, [edit(doc('64a', { date: '2026-09-20T00:00:00.000Z' }))], query);

    expect(flags(result.groups['2026-09-24'])).toEqual([['64a', true]]);
    expect(result.groups['2026-09-24'].dailySum).toBe(0);
    expect(result.groups['2026-09-20'].items.map(item => item.id)).toEqual(['64a']);
  });

  it('drops a row that no longer fits the category filter and shows nothing in its place', () => {
    const result = applyListEdits(groups, [edit(doc('64a', { category: 'Дом' }))], { ...query, category: 'Еда' });

    expect(result.groups['2026-09-24'].items[0]).toMatchObject({ id: '64a', movedAway: true });
    expect(result.groups['2026-09-24'].dailySum).toBe(-10);
    expect(result.freshIds.size).toBe(0);
    expect(result.editedIds.size).toBe(0);
  });

  it('drops a row that no longer fits the type filter', () => {
    const result = applyListEdits(groups, [edit(doc('64a', { type: 'income', amount: 5 }))], { ...query, type: 'expense' });

    expect(result.groups['2026-09-24'].items[0].movedAway).toBe(true);
    expect(result.groups['2026-09-24'].dailySum).toBe(-10);
  });

  it('drops a row moved to another account out of an account list', () => {
    const result = applyListEdits(groups, [edit(doc('64a', { account: 'cash' }))], { ...query, account: 'card' });

    expect(result.groups['2026-09-24'].items[0].movedAway).toBe(true);
    expect(result.groups['2026-09-24'].dailySum).toBe(-10);
  });

  it('edits in place when the row still fits every filter', () => {
    const result = applyListEdits(groups, [edit(doc('64a', { amount: 12 }))], { ...query, account: 'card', category: 'Еда', type: 'expense' });

    expect(result.groups['2026-09-24'].items[0]).toMatchObject({ visualAmount: -12 });
    expect(result.groups['2026-09-24'].items[0].movedAway).toBeUndefined();
    expect(result.editedIds.has('64a')).toBe(true);
  });

  it('inserts a row that was not in the list when the edit brings it in', () => {
    const result = applyListEdits(groups, [edit(doc('65f', { amount: 8 }), 4)], query);

    expect(result.groups['2026-09-24'].items.map(item => item.id)).toEqual(['65f', '64a', '639']);
    expect(result.groups['2026-09-24'].dailySum).toBe(-28);
    expect([...result.freshIds]).toEqual(['65f']);
    expect(result.editedIds.size).toBe(0);
  });

  it('does not insert a row that was not in the list when it still does not belong', () => {
    const past = applyListEdits(groups, [edit(doc('65f', { date: '2026-10-02T00:00:00.000Z' }))], query);
    const other = applyListEdits(groups, [edit(doc('65f', { category: 'Дом' }))], { ...query, category: 'Еда' });

    expect(past.groups).toBe(groups);
    expect(other.groups).toBe(groups);
  });

  describe('split purchases', () => {
    const part = (id, overrides = {}) => row(id, { splitId: 'split_1', description: 'Магазин (Еда)', ...overrides });
    const split = {
      '2026-09-24': {
        items: [
          {
            id: 'split_1', type: 'split_group', date: '2026-09-24', description: 'Магазин', account: 'card', visualAmount: -15,
            items: [part('65a', { visualAmount: -10 }), part('65b', { visualAmount: -5, category: 'Дом' })],
          },
          row('64a'),
        ],
        dailySum: -25,
      },
    };

    it('replaces a part in place, rebuilds the group and fixes the day sum', () => {
      const saved = doc('65b', { splitId: 'split_1', amount: 20, category: 'Дом', description: 'Магазин (Дом)' });

      const result = applyListEdits(split, [edit(saved, 9)], query);

      const group = result.groups['2026-09-24'].items[0];
      expect(group).toMatchObject({ id: 'split_1', type: 'split_group', visualAmount: -30 });
      expect(group.items.map(item => item.id)).toEqual(['65a', '65b']);
      expect(group.items[1]).toMatchObject({ visualAmount: -20, category: 'Дом' });
      expect(group.items[0]).toBe(split['2026-09-24'].items[0].items[0]);
      expect(result.groups['2026-09-24'].dailySum).toBe(-40);
      expect(result.groups['2026-09-24'].items[1]).toBe(split['2026-09-24'].items[1]);
      expect([...result.editedIds]).toEqual([['65b', 9]]);
      expect(result.freshIds.size).toBe(0);
      // Исходная группа не меняется.
      expect(split['2026-09-24'].items[0].visualAmount).toBe(-15);
    });

    it('does nothing optimistic when the part changes its date', () => {
      const saved = doc('65b', { splitId: 'split_1', date: '2026-09-20T00:00:00.000Z' });

      const result = applyListEdits(split, [edit(saved)], query);

      expect(result.groups).toBe(split);
      expect(result.editedIds.size).toBe(0);
    });

    it('does nothing optimistic when the part changes its splitId or stops fitting a filter', () => {
      const otherSplit = applyListEdits(split, [edit(doc('65b', { splitId: 'split_2' }))], query);
      const filtered = applyListEdits(split, [edit(doc('65b', { splitId: 'split_1', category: 'Дом' }))], { ...query, category: 'Еда' });

      expect(otherSplit.groups).toBe(split);
      expect(filtered.groups).toBe(split);
    });
  });

  it('skips a bad document and an account-type filter', () => {
    const empty = applyListEdits(groups, [edit({ _id: '64a' }), edit(null), edit([doc('64a')])], query);
    const byType = applyListEdits(groups, [edit(doc('64a', { amount: 99 }))], { ...query, account: 'type:card' });

    expect(empty.groups).toBe(groups);
    expect(byType.groups).toBe(groups);
    expect(byType.editedIds.size).toBe(0);
  });

  it('applies two edits of one row in order: the last one wins and carries its seq', () => {
    const result = applyListEdits(groups, [
      edit(doc('64a', { amount: 12 }), 1),
      edit(doc('64a', { amount: 30 }), 2),
    ], query);

    expect(result.groups['2026-09-24'].items[0]).toMatchObject({ visualAmount: -30 });
    expect(result.groups['2026-09-24'].dailySum).toBe(-40);
    expect([...result.editedIds]).toEqual([['64a', 2]]);
  });

  it('moves the fresh copy again on a second date change, leaving a ghost behind each time', () => {
    const result = applyListEdits(groups, [
      edit(doc('639', { date: '2026-09-23T00:00:00.000Z' }), 1),
      edit(doc('639', { date: '2026-09-25T00:00:00.000Z' }), 2),
    ], query);

    expect(result.groups['2026-09-24'].items[1]).toMatchObject({ id: '639', movedAway: true });
    expect(flags(result.groups['2026-09-23'])).toEqual([['639', true], ['638', false]]);
    expect(result.groups['2026-09-23'].dailySum).toBe(-10);
    expect(result.groups['2026-09-25'].items.map(item => item.id)).toEqual(['639']);
    expect([...result.freshIds]).toEqual(['639']);
  });

  it('brings a row back to the day it left: the ghost there comes back to life', () => {
    const result = applyListEdits(groups, [
      edit(doc('639', { date: '2026-09-23T00:00:00.000Z' }), 1),
      edit(doc('639', { date: '2026-09-24T00:00:00.000Z', amount: 6 }), 2),
    ], query);

    const day = result.groups['2026-09-24'];
    expect(flags(day)).toEqual([['64a', false], ['639', false]]);
    expect(day.items[1]).toMatchObject({ visualAmount: -6 });
    expect(day.dailySum).toBeCloseTo(-16);
    expect(flags(result.groups['2026-09-23'])).toEqual([['639', true], ['638', false]]);
    expect(result.groups['2026-09-23'].dailySum).toBe(-10);
  });
});
