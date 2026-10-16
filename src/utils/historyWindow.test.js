import { describe, it, expect } from 'vitest';
import { listDays, windowFor, extendOlder, extendNewer, sliceWindow, resolveWindow } from './historyWindow';

// n дней подряд вниз от 2026-03-31, по count строк в каждом.
const makeDays = (n, count = 1, from = new Date(Date.UTC(2026, 2, 31))) => Array.from({ length: n }, (_, i) => {
  const d = new Date(from.getTime() - i * 86400000);
  return { date: d.toISOString().slice(0, 10), count };
});
const dates = (window, days) => sliceWindow(window, days).days.map(day => day.date);

describe('listDays', () => {
  it('orders days newest first and counts items', () => {
    expect(listDays({ '2026-01-01': { items: [1] }, '2026-02-01': { items: [1, 2] } }))
      .toEqual([{ date: '2026-02-01', count: 2 }, { date: '2026-01-01', count: 1 }]);
    expect(listDays(undefined)).toEqual([]);
  });
});

describe('windowFor', () => {
  it('is empty and open for an empty list', () => {
    const window = windowFor([], '2026-03');
    expect(sliceWindow(window, [])).toEqual({ days: [], start: 0, hasNewer: false, hasOlder: false });
    expect(extendOlder(window, [])).toEqual(window);
    expect(extendNewer(window, [])).toEqual(window);
  });

  it('starts at the newest day of the month and takes ~60 rows below, counting items', () => {
    const days = makeDays(120, 2); // 240 строк, март-ноябрь...
    const window = windowFor(days, '2026-02');
    const shown = sliceWindow(window, days);
    expect(shown.days[0].date).toBe('2026-02-28');
    expect(shown.days.reduce((sum, day) => sum + day.count, 0)).toBe(60);
    expect(shown.hasNewer).toBe(true);
    expect(shown.hasOlder).toBe(true);
  });

  it('counts rows rather than days: one busy day is enough', () => {
    const days = [{ date: '2026-03-02', count: 100 }, { date: '2026-03-01', count: 1 }];
    expect(dates(windowFor(days, '2026-03'), days)).toEqual(['2026-03-02']);
  });

  it('starts at the nearest older day when the month has no rows', () => {
    const days = [{ date: '2026-05-10', count: 1 }, { date: '2026-03-15', count: 1 }, { date: '2026-03-02', count: 1 }];
    const shown = sliceWindow(windowFor(days, '2026-04'), days);
    expect(shown.days.map(day => day.date)).toEqual(['2026-03-15', '2026-03-02']);
    expect(shown.hasNewer).toBe(true);
    expect(shown.hasOlder).toBe(false);
  });

  it('starts from the very top for a month newer than all data and for search', () => {
    const days = makeDays(5);
    expect(dates(windowFor(days, '2027-01'), days)).toHaveLength(5);
    expect(windowFor(days, '2027-01').newest).toBeNull();
    expect(windowFor(days, '').newest).toBeNull();
    expect(sliceWindow(windowFor(days, null), days).hasNewer).toBe(false);
  });

  it('is empty, with newer rows available, for a month older than all data', () => {
    const days = makeDays(3);
    const shown = sliceWindow(windowFor(days, '2020-01'), days);
    expect(shown).toEqual({ days: [], start: 3, hasNewer: true, hasOlder: false });
    // Отсюда можно вернуться к новым дням.
    const newer = extendNewer(windowFor(days, '2020-01'), days);
    expect(dates(newer, days)).toEqual(days.map(day => day.date));
  });

  it('shows the whole list when it is shorter than the window', () => {
    const days = makeDays(10);
    const shown = sliceWindow(windowFor(days, '2026-03'), days);
    expect(shown).toMatchObject({ hasNewer: false, hasOlder: false });
    expect(shown.days).toHaveLength(10);
  });
});

describe('extendOlder / extendNewer', () => {
  const days = makeDays(300);

  it('extends downwards by ~n rows and stops at the end', () => {
    let window = windowFor(days, '2026-03', 10);
    expect(dates(window, days)).toHaveLength(10);
    window = extendOlder(window, days, 25);
    expect(dates(window, days)).toHaveLength(35);
    expect(sliceWindow(window, days).hasNewer).toBe(false);
    for (let i = 0; i < 20; i += 1) window = extendOlder(window, days, 25);
    expect(sliceWindow(window, days)).toMatchObject({ hasOlder: false });
    expect(window.oldest).toBeNull();
    expect(dates(window, days)).toHaveLength(300);
    expect(extendOlder(window, days)).toEqual(window);
  });

  it('extends upwards by ~n rows and opens the top at the first day', () => {
    let window = windowFor(days, '2025-12', 10);
    const first = dates(window, days)[0];
    window = extendNewer(window, days, 30);
    expect(dates(window, days)).toHaveLength(40);
    expect(dates(window, days).at(-1)).toBe(dates(windowFor(days, '2025-12', 10), days).at(-1));
    expect(dates(window, days)).toContain(first);
    while (sliceWindow(window, days).hasNewer) window = extendNewer(window, days, 30);
    expect(window.newest).toBeNull();
    expect(dates(window, days)[0]).toBe(days[0].date);
    expect(extendNewer(window, days)).toEqual(window);
  });

  it('keeps the window by date boundaries when the list is replaced', () => {
    const window = windowFor(days, '2025-12', 10);
    const before = dates(window, days);
    // Новый день внутри окна появляется, новый день выше окна не двигает его.
    const refreshed = [{ date: '2026-04-01', count: 1 }, ...days, { date: '2025-12-15', count: 1 }].sort((a, b) => b.date.localeCompare(a.date));
    const after = dates(window, refreshed);
    expect(after[0]).toBe(before[0]);
    expect(after.at(-1)).toBe(before.at(-1));
    expect(after).not.toContain('2026-04-01');
    // Окно у самого верха остаётся открытым: новая запись видна.
    const top = windowFor(days, '2027-01', 10);
    expect(dates(top, refreshed)[0]).toBe('2026-04-01');
  });

  it('survives the boundary day being deleted', () => {
    const window = windowFor(days, '2025-12', 10);
    const { start } = resolveWindow(window, days);
    const without = days.filter((_, index) => index !== start);
    expect(sliceWindow(window, without).days[0].date).toBe(days[start + 1].date);
  });

  it('extends by whole days, so a busy day can overshoot', () => {
    const busy = [{ date: '2026-03-03', count: 1 }, { date: '2026-03-02', count: 50 }, { date: '2026-03-01', count: 1 }];
    const window = windowFor(busy, '2026-03', 1);
    expect(dates(extendOlder(window, busy, 1), busy)).toEqual(['2026-03-03', '2026-03-02']);
  });
});
