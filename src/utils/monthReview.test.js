import { afterEach, describe, expect, it, vi } from 'vitest';
import { dismissedKey, monthGenitive, readDismissed, reviewMonthFor, shouldShowMonthReview, writeDismissed } from './monthReview';

const base = {
  enabled: true,
  today: '2026-10-05',
  timeRange: 'month',
  selectedMonth: '2026-10',
  selectedAccount: null,
  dismissed: false,
};

describe('reviewMonthFor', () => {
  it('is the previous month', () => {
    expect(reviewMonthFor('2026-10-05')).toBe('2026-09');
    expect(reviewMonthFor('2026-03-31')).toBe('2026-02');
  });

  it('turns January into December of the previous year', () => {
    expect(reviewMonthFor('2026-01-03')).toBe('2025-12');
  });
});

describe('monthGenitive', () => {
  it.each([
    ['2026-09', 'сентября'],
    ['2026-12', 'декабря'],
    ['2026-05', 'мая'],
    ['2026-03', 'марта'],
  ])('%s -> %s', (month, word) => {
    expect(monthGenitive(month)).toBe(word);
  });
});

describe('shouldShowMonthReview', () => {
  it('is shown for the current month, whole household, early in the month', () => {
    expect(shouldShowMonthReview(base)).toBe(true);
  });

  it('is shown on day 1 and day 10, hidden from day 11', () => {
    expect(shouldShowMonthReview({ ...base, today: '2026-10-01' })).toBe(true);
    expect(shouldShowMonthReview({ ...base, today: '2026-10-10' })).toBe(true);
    expect(shouldShowMonthReview({ ...base, today: '2026-10-11' })).toBe(false);
    expect(shouldShowMonthReview({ ...base, today: '2026-10-31' })).toBe(false);
  });

  it('works in January (the review is about December)', () => {
    expect(shouldShowMonthReview({ ...base, today: '2026-01-04', selectedMonth: '2026-01' })).toBe(true);
    expect(reviewMonthFor('2026-01-04')).toBe('2025-12');
  });

  it('is hidden when a different month is selected', () => {
    expect(shouldShowMonthReview({ ...base, selectedMonth: '2026-09' })).toBe(false);
    expect(shouldShowMonthReview({ ...base, selectedMonth: '2025-10' })).toBe(false);
  });

  it('is hidden for year and all-time ranges even when the month matches', () => {
    expect(shouldShowMonthReview({ ...base, timeRange: 'year' })).toBe(false);
    expect(shouldShowMonthReview({ ...base, timeRange: 'lifetime' })).toBe(false);
  });

  it('is hidden when an account is selected', () => {
    expect(shouldShowMonthReview({ ...base, selectedAccount: 'acc-card-1' })).toBe(false);
  });

  it('is hidden unless the feature is exactly enabled', () => {
    expect(shouldShowMonthReview({ ...base, enabled: false })).toBe(false);
    expect(shouldShowMonthReview({ ...base, enabled: undefined })).toBe(false);
    expect(shouldShowMonthReview({ ...base, enabled: 'true' })).toBe(false);
  });

  it('is hidden once dismissed', () => {
    expect(shouldShowMonthReview({ ...base, dismissed: true })).toBe(false);
  });

  it('is hidden for a malformed date', () => {
    expect(shouldShowMonthReview({ ...base, today: '' })).toBe(false);
    expect(shouldShowMonthReview({ ...base, today: undefined })).toBe(false);
  });
});

describe('dismissed storage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('remembers per reviewed month under monthReview:dismissed:<month>', () => {
    expect(readDismissed('2026-09')).toBe(false);
    writeDismissed('2026-09');
    expect(window.localStorage.getItem('monthReview:dismissed:2026-09')).toBe('1');
    expect(dismissedKey('2026-09')).toBe('monthReview:dismissed:2026-09');
    expect(readDismissed('2026-09')).toBe(true);
    expect(readDismissed('2026-08')).toBe(false);
  });

  it('treats unavailable storage as not dismissed and does not throw on write', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    expect(readDismissed('2026-09')).toBe(false);
    expect(() => writeDismissed('2026-09')).not.toThrow();
  });
});
