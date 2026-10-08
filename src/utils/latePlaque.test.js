import { describe, it, expect } from 'vitest';
import { getLatePlaque, getForecastVerdict, formatRemainingSpan, pluralDays } from './latePlaque';

// Январь 2026: 31 день. N = 31 - day.
const typical = (day, overrides = {}) => ({
  months: ['2025-12', '2025-11', '2025-10'],
  byDay: [],
  monthTotal: 3000,
  today: { day, typicalToDate: 2000, typicalRemaining: 1119.6, spent: 2100, forecast: 3219.6, ...overrides },
});

const base = {
  timeRange: 'month',
  selectedMonth: '2026-01',
  currentMonth: '2026-01',
  spent: 2100,
  limit: 7000,
};

describe('pluralDays', () => {
  it.each([
    [1, 'день'], [2, 'дня'], [4, 'дня'], [5, 'дней'], [10, 'дней'],
    [11, 'дней'], [12, 'дней'], [14, 'дней'], [21, 'день'], [22, 'дня'], [25, 'дней'],
  ])('%i -> %s', (count, word) => {
    expect(pluralDays(count)).toBe(word);
  });
});

describe('getLatePlaque visibility', () => {
  it('is hidden on the last day (N=0) and shown from N=1', () => {
    expect(getLatePlaque({ ...base, typicalMonth: typical(31) })).toBeNull();
    expect(getLatePlaque({ ...base, typicalMonth: typical(30) })).toMatchObject({ daysLeft: 1, title: 'До конца месяца 1 день' });
  });

  it('is shown at N=10 and hidden at N=11', () => {
    expect(getLatePlaque({ ...base, typicalMonth: typical(21) })).toMatchObject({ daysLeft: 10, title: 'До конца месяца 10 дней' });
    expect(getLatePlaque({ ...base, typicalMonth: typical(20) })).toBeNull();
  });

  it('is hidden once the limit is exceeded, but shown when spent equals the limit', () => {
    expect(getLatePlaque({ ...base, spent: 7000.01, typicalMonth: typical(25) })).toBeNull();
    expect(getLatePlaque({ ...base, spent: 7000, typicalMonth: typical(25) })).not.toBeNull();
  });

  it('is hidden without typicalMonth, without its "today" block, or with incomplete numbers', () => {
    expect(getLatePlaque({ ...base, typicalMonth: null })).toBeNull();
    expect(getLatePlaque({ ...base, typicalMonth: undefined })).toBeNull();
    expect(getLatePlaque({ ...base, typicalMonth: { months: [], byDay: [], monthTotal: 0, today: null } })).toBeNull();
    expect(getLatePlaque({ ...base, typicalMonth: typical(25, { forecast: null }) })).toBeNull();
  });

  it('is hidden for year / lifetime, for a past month and for an unusable limit', () => {
    const typicalMonth = typical(25);
    expect(getLatePlaque({ ...base, timeRange: 'year', typicalMonth })).toBeNull();
    expect(getLatePlaque({ ...base, timeRange: 'lifetime', typicalMonth })).toBeNull();
    expect(getLatePlaque({ ...base, selectedMonth: '2025-12', typicalMonth })).toBeNull();
    expect(getLatePlaque({ ...base, limit: 0, typicalMonth })).toBeNull();
    expect(getLatePlaque({ ...base, limit: NaN, typicalMonth })).toBeNull();
    expect(getLatePlaque({ ...base, limit: null, typicalMonth })).toBeNull();
  });
});

describe('getLatePlaque text', () => {
  it('names the remaining stretch and the headroom when the forecast fits the limit', () => {
    // 7000 - 3219.6 = 3780.4 -> 3.780
    const plaque = getLatePlaque({ ...base, typicalMonth: typical(25) });
    expect(plaque.tone).toBe('neutral');
    expect(plaque.title).toBe('До конца месяца 6 дней');
    expect(plaque.text).toBe('С 26 по 31 число у вас обычно уходит около €1.120. Если так и будет, запас до лимита ≈ €3.780.');
  });

  it('warns about the overshoot when the forecast is above the limit', () => {
    // 7600 - 7000 = 600
    const plaque = getLatePlaque({ ...base, spent: 6000, typicalMonth: typical(27, { forecast: 7600, typicalRemaining: 1600 }) });
    expect(plaque.tone).toBe('warning');
    expect(plaque.title).toBe('До конца месяца 4 дня');
    expect(plaque.text).toBe('С 28 по 31 число у вас обычно уходит около €1.600. Если так и будет, лимит будет превышен примерно на €600.');
  });

  it('treats a forecast exactly at the limit as headroom, not overshoot', () => {
    const plaque = getLatePlaque({ ...base, typicalMonth: typical(25, { forecast: 7000 }) });
    expect(plaque.tone).toBe('neutral');
    expect(plaque.text).toMatch(/запас до лимита ≈ €0\.$/);
  });

  it('uses the real length of the month for the last day', () => {
    // Февраль 2026 - 28 дней; 20-е -> 8 дней.
    const plaque = getLatePlaque({
      ...base, selectedMonth: '2026-02', currentMonth: '2026-02', typicalMonth: typical(20),
    });
    expect(plaque.daysLeft).toBe(8);
    expect(plaque.text).toMatch(/^С 21 по 28 число/);
  });
});

describe('getLatePlaque: прогноз на центы выше лимита', () => {
  it('не пишет «превышен примерно на €0», а говорит о нулевом запасе', () => {
    const plaque = getLatePlaque({
      timeRange: 'month',
      selectedMonth: '2026-10',
      currentMonth: '2026-10',
      spent: 6160,
      limit: 7000,
      typicalMonth: { today: { day: 24, typicalRemaining: 840.3, forecast: 7000.3 } },
    });
    expect(plaque.tone).toBe('neutral');
    expect(plaque.text).toContain('запас до лимита ≈ €0.');
  });
});

describe('getForecastVerdict', () => {
  it('запас до лимита, когда прогноз ниже', () => {
    expect(getForecastVerdict({ forecast: 6000, limit: 7000 })).toEqual({
      overLimit: false, text: 'Если так и будет, запас до лимита ≈ €1.000.',
    });
  });

  it('превышение считается после округления до евро: ниже €1 - это ещё запас', () => {
    expect(getForecastVerdict({ forecast: 7000.4, limit: 7000 }).overLimit).toBe(false);
    expect(getForecastVerdict({ forecast: 7000.4, limit: 7000 }).text).toContain('запас до лимита ≈ €0');
    expect(getForecastVerdict({ forecast: 7000.6, limit: 7000 })).toEqual({
      overLimit: true, text: 'Если так и будет, лимит будет превышен примерно на €1.',
    });
  });

  it('без «Если так и будет» предложение начинается с заглавной', () => {
    expect(getForecastVerdict({ forecast: 6000, limit: 7000, conditional: false }).text)
      .toBe('Запас до лимита ≈ €1.000.');
  });

  it('уже превышенный лимит не называется будущим', () => {
    const verdict = getForecastVerdict({ forecast: 7500, limit: 7000, spent: 7200 });
    expect(verdict.overLimit).toBe(true);
    expect(verdict.text).toBe('Если так и будет, лимит уже превышен, к концу месяца перерасход составит около €500.');
  });

  it('null, когда лимит не годится или прогноза нет', () => {
    expect(getForecastVerdict({ forecast: 100, limit: 0 })).toBeNull();
    expect(getForecastVerdict({ forecast: 100, limit: NaN })).toBeNull();
    expect(getForecastVerdict({ forecast: 100, limit: null })).toBeNull();
    expect(getForecastVerdict({ forecast: null, limit: 7000 })).toBeNull();
  });
});

describe('formatRemainingSpan', () => {
  it('подставляет оборот и округляет до евро', () => {
    expect(formatRemainingSpan({ day: 25, lastDay: 31, typicalRemaining: 1119.6 }))
      .toBe('С 26 по 31 число у вас обычно уходит около €1.120.');
    expect(formatRemainingSpan({ day: 25, lastDay: 31, typicalRemaining: 300, verb: 'вы обычно тратите' }))
      .toBe('С 26 по 31 число вы обычно тратите около €300.');
  });
});
