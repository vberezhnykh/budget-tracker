import { describe, it, expect } from 'vitest';
import { closedMonths, medianExpense, exceededCount, limitInsight } from './limitInsight';

const month = (m, expense) => ({ month: m, label: m, expense });

describe('closedMonths', () => {
  it('отбрасывает текущий месяц и берёт шесть последних закрытых', () => {
    const series = [
      month('2026-02', 1), month('2026-03', 2), month('2026-04', 3), month('2026-05', 4),
      month('2026-06', 5), month('2026-07', 6), month('2026-08', 7), month('2026-09', 8),
      month('2026-10', 9),
    ];
    expect(closedMonths(series, '2026-10').map((m) => m.month)).toEqual([
      '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09',
    ]);
  });

  it('работает и без текущего месяца, и с пустым рядом', () => {
    expect(closedMonths([month('2026-09', 1)], '2026-10')).toHaveLength(1);
    expect(closedMonths([], '2026-10')).toEqual([]);
    expect(closedMonths(undefined, '2026-10')).toEqual([]);
  });
});

describe('medianExpense', () => {
  it('нечётное число месяцев - серединное', () => {
    expect(medianExpense([month('a', 30), month('b', 10), month('c', 20)])).toBe(20);
  });

  it('чётное число месяцев - среднее двух серединных', () => {
    expect(medianExpense([month('a', 10), month('b', 40), month('c', 20), month('d', 30)])).toBe(25);
  });

  it('пустой ряд - null', () => {
    expect(medianExpense([])).toBeNull();
  });
});

describe('exceededCount', () => {
  const months = [month('a', 100), month('b', 200), month('c', 300)];

  it('считает месяцы строго выше лимита', () => {
    expect(exceededCount(months, 200)).toBe(1);
    expect(exceededCount(months, 50)).toBe(3);
    expect(exceededCount(months, 1000)).toBe(0);
  });

  it('без корректного лимита - null', () => {
    expect(exceededCount(months, NaN)).toBeNull();
    expect(exceededCount(months, 0)).toBeNull();
    expect(exceededCount(months, -5)).toBeNull();
    expect(exceededCount(months, Infinity)).toBeNull();
  });
});

describe('limitInsight', () => {
  it('собирает месяцы, медиану, превышения и число месяцев', () => {
    const series = [month('2026-08', 100), month('2026-09', 300), month('2026-10', 999)];
    const result = limitInsight(series, '2026-10', 150);
    expect(result.months).toHaveLength(2);
    expect(result.median).toBe(200);
    expect(result.exceeded).toBe(1);
    expect(result.total).toBe(2);
  });
});
