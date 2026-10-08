import { describe, it, expect } from 'vitest';
import { getTrendCaption } from './trendCaption';

const month = (key, expense) => ({ month: key, year: Number(key.slice(0, 4)), label: key.slice(5), income: 0, expense });

// Шесть месяцев, последний - идущий: закрытых пять.
const series = (expenses) => expenses.map((expense, i) => month(`2026-0${i + 1}`, expense));
const base = { currentMonth: '2026-06', visible: 6 };

describe('getTrendCaption', () => {
  it('counts the closed months over the limit and gives the whole-euro average', () => {
    const caption = getTrendCaption(series([100, 800, 200, 900, 300, 5000]), { ...base, limit: 500 });

    expect(caption).toBe('Лимит превышен в 2 месяцах из 5 закрытых. Средний расход €460.');
  });

  it('does not count the month in progress, even when it is over the limit', () => {
    const caption = getTrendCaption(series([100, 100, 100, 100, 100, 9999]), { ...base, limit: 500 });

    expect(caption).toContain('не превышался ни в одном из 5 закрытых');
    expect(caption).toContain('Средний расход €100.');
  });

  it.each([
    [1, 'в 1 месяце'], [2, 'в 2 месяцах'], [4, 'в 4 месяцах'], [5, 'в 5 месяцах']
  ])('agrees the word «месяц» with %i months over the limit', (over, phrase) => {
    const expenses = [...Array(5).keys()].map(i => (i < over ? 900 : 100));
    const caption = getTrendCaption(series([...expenses, 0]), { ...base, limit: 500 });

    expect(caption).toContain(`Лимит превышен ${phrase} из 5 закрытых.`);
  });

  it('does not count a month that exactly equals the limit', () => {
    const caption = getTrendCaption(series([500, 500, 500, 500, 500, 0]), { ...base, limit: 500 });

    expect(caption).toContain('не превышался ни в одном');
  });

  it.each([[null], [0], [undefined], [NaN]])('leaves the limit out when it is %s', (limit) => {
    const caption = getTrendCaption(series([100, 200, 300, 400, 500, 0]), { ...base, limit });

    expect(caption).toBe('Средний расход €300.');
  });

  it('is null when no month is closed yet', () => {
    expect(getTrendCaption([month('2026-06', 100)], { ...base, limit: 500 })).toBeNull();
    expect(getTrendCaption([], { ...base, limit: 500 })).toBeNull();
  });

  it('looks only at the months that fit on the screen', () => {
    const long = [900, 900, 900, 100, 100, 100, 100, 100, 0].map((expense, i) => month(`2025-${String(i + 4).padStart(2, '0')}`, expense));
    const caption = getTrendCaption(long, { limit: 500, currentMonth: '2025-12', visible: 6 });

    // Последние шесть: июль - декабрь, закрытых пять, все в пределах лимита.
    expect(caption).toBe('Лимит не превышался ни в одном из 5 закрытых. Средний расход €100.');
  });
});
