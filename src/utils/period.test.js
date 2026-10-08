import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  MIN_MONTH,
  formatDayMonth,
  formatDayMonthShort,
  formatMonthName,
  formatPeriodLabel,
  formatPeriodPhrase,
  formatPeriodTitle,
  formatSyncStatus,
  getCurrentMonth,
  getLastMonthOfYear,
  listPeriodMonths,
  listPeriodYears,
  toDativeMonth,
} from './period';

describe('period helpers', () => {
  describe('listPeriodMonths', () => {
    it('lists every month from the start of history up to the given month', () => {
      expect(listPeriodMonths('2026-01')).toEqual(['2025-11', '2025-12', '2026-01']);
    });

    it('rolls the year over correctly across December', () => {
      const months = listPeriodMonths('2026-03');
      expect(months).toEqual(['2025-11', '2025-12', '2026-01', '2026-02', '2026-03']);
    });

    it('includes the boundary month itself', () => {
      expect(listPeriodMonths(MIN_MONTH)).toEqual([MIN_MONTH]);
    });

    it('returns nothing for a month before the start of history, rather than looping', () => {
      expect(listPeriodMonths('2025-10')).toEqual([]);
    });
  });

  describe('listPeriodYears', () => {
    it('lists the years those months span, without duplicates', () => {
      expect(listPeriodYears('2026-03')).toEqual(['2025', '2026']);
    });

    it('drops a year entirely once no month of it is selectable', () => {
      expect(listPeriodYears('2025-12')).toEqual(['2025']);
    });
  });

  describe('getLastMonthOfYear', () => {
    it('returns the latest selectable month of the year, not December', () => {
      // 2026 is capped by the current month, so "the year 2026" lands on
      // March rather than an unreachable December.
      expect(getLastMonthOfYear('2026', '2026-03')).toBe('2026-03');
    });

    it('returns the real December for a year that has fully passed', () => {
      expect(getLastMonthOfYear('2025', '2026-03')).toBe('2025-12');
    });

    it('returns null for a year with no selectable months', () => {
      expect(getLastMonthOfYear('2024', '2026-03')).toBeNull();
    });
  });

  describe('formatMonthName', () => {
    it('capitalises the Russian month name', () => {
      expect(formatMonthName('2026-08')).toBe('Август');
    });
  });

  describe('toDativeMonth', () => {
    it('declines every month name for a "к <месяцу>" label', () => {
      const nominative = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
        'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
      const dative = ['январю', 'февралю', 'марту', 'апрелю', 'маю', 'июню',
        'июлю', 'августу', 'сентябрю', 'октябрю', 'ноябрю', 'декабрю'];

      expect(nominative.map(toDativeMonth)).toEqual(dative);
    });

    it('declines what Intl actually produces, not just the lowercase forms', () => {
      // The label is built from getComparisonData's prevMonthName, which is
      // whatever toLocaleDateString('ru-RU', { month: 'long' }) returns.
      const fromIntl = new Date(2025, 11, 1).toLocaleDateString('ru-RU', { month: 'long' });
      expect(toDativeMonth(fromIntl)).toBe('декабрю');
    });
  });

  describe('formatPeriodLabel', () => {
    it('spells out the month and year for a monthly period', () => {
      expect(formatPeriodLabel('month', '2026-08')).toBe('Август 2026');
    });

    it('names the year for a yearly period', () => {
      expect(formatPeriodLabel('year', '2026-08')).toBe('2026 год');
    });

    it('ignores the selected month for the lifetime period', () => {
      expect(formatPeriodLabel('lifetime', '2026-08')).toBe('Всё время');
    });
  });

  describe('formatPeriodPhrase', () => {
    const now = new Date(2026, 8, 5, 12);

    it('names a month of the current year in lowercase nominative, without the year', () => {
      expect(formatPeriodPhrase('month', '2026-09', now)).toBe('сентябрь');
      expect(formatPeriodPhrase('month', '2026-05', now)).toBe('май');
    });

    it('adds the year for a month of another year', () => {
      expect(formatPeriodPhrase('month', '2025-12', now)).toBe('декабрь 2025');
    });

    it('is just the year for a yearly period, whatever the current year is', () => {
      expect(formatPeriodPhrase('year', '2026-09', now)).toBe('2026');
      expect(formatPeriodPhrase('year', '2025-12', now)).toBe('2025');
    });

    it('reads "всё время" for the lifetime period', () => {
      expect(formatPeriodPhrase('lifetime', '2026-09', now)).toBe('всё время');
    });
  });

  describe('default bound', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-02-10'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('caps the list at the current month when no maximum is given', () => {
      expect(listPeriodMonths()).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    });
  });
});

describe('getCurrentMonth', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses the local month, not UTC, right after local midnight', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 1, 1, 30));
    expect(getCurrentMonth()).toBe('2026-10');
  });

  it('stays in the same month late in the evening on its last day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 30, 23, 30));
    expect(getCurrentMonth()).toBe('2026-09');
  });

  describe('formatPeriodTitle', () => {
    const now = new Date(2026, 9, 8, 12);

    it('names a month of the current year by its capitalized name alone', () => {
      expect(formatPeriodTitle('month', '2026-10', now)).toBe('Октябрь');
      expect(formatPeriodTitle('month', '2026-01', now)).toBe('Январь');
    });

    it('adds the year for a month of another year', () => {
      expect(formatPeriodTitle('month', '2025-12', now)).toBe('Декабрь 2025');
    });

    it('gives a bare year for «год» and «Всё время» for lifetime', () => {
      expect(formatPeriodTitle('year', '2026-10', now)).toBe('2026');
      expect(formatPeriodTitle('year', '2025-12', now)).toBe('2025');
      expect(formatPeriodTitle('lifetime', '2026-10', now)).toBe('Всё время');
    });
  });

  describe('formatSyncStatus', () => {
    const now = new Date(2026, 9, 8, 18, 0);

    it('shows only the time for a synchronization from today', () => {
      expect(formatSyncStatus(new Date(2026, 9, 8, 14, 5), '8 окт., 14:05', now)).toBe('Обновлено 14:05');
    });

    it('falls back to the short date label for an earlier day, comparing local calendar days', () => {
      expect(formatSyncStatus(new Date(2026, 9, 7, 23, 59), '7 окт., 23:59', now)).toBe('Обновлено 7 окт., 23:59');
    });

    it('gives nothing before the first synchronization', () => {
      expect(formatSyncStatus(null, null, now)).toBeNull();
    });
  });

  describe('formatDayMonth / formatDayMonthShort', () => {
    it('число и месяц в родительном падеже', () => {
      expect(formatDayMonth('2026-10', 8)).toBe('8 октября');
      expect(formatDayMonth('2026-03', 31)).toBe('31 марта');
      expect(formatDayMonth('2026-05', 1)).toBe('1 мая');
    });

    it('короткая подпись без точки', () => {
      expect(formatDayMonthShort('2026-10', 1)).toBe('1 окт');
      expect(formatDayMonthShort('2026-01', 22)).toBe('22 янв');
      expect(formatDayMonthShort('2026-05', 8)).toBe('8 мая');
    });
  });
});
