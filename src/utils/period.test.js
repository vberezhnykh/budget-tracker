import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  MIN_MONTH,
  formatMonthName,
  formatPeriodLabel,
  getLastMonthOfYear,
  listPeriodMonths,
  listPeriodYears,
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
