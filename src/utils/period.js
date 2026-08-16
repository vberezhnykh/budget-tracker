// Everything that decides *which* months and years the period picker may
// offer, kept free of React so it can be unit-tested directly.
//
// The lower bound is the app's own start of history: the initial balances
// are dated 2025-11-09 (see getLifetimeStats' default startDate), so there
// is nothing meaningful to show before that month. The upper bound is the
// current month - the app never shows a future period.

export const MIN_MONTH = '2025-11';

export const getCurrentMonth = () => new Date().toISOString().slice(0, 7);

const parseMonth = (month) => {
  const [year, m] = month.split('-').map(Number);
  return { year, month: m };
};

const formatMonth = (year, month) => `${year}-${String(month).padStart(2, '0')}`;

// Ascending list of every selectable 'YYYY-MM', from MIN_MONTH to maxMonth
// inclusive. Returns [] when maxMonth is before MIN_MONTH rather than
// looping forever.
export const listPeriodMonths = (maxMonth = getCurrentMonth()) => {
  if (maxMonth < MIN_MONTH) return [];
  const start = parseMonth(MIN_MONTH);
  const end = parseMonth(maxMonth);
  const months = [];
  let { year, month } = start;
  while (year < end.year || (year === end.year && month <= end.month)) {
    months.push(formatMonth(year, month));
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
};

// Ascending list of the years those months span, as strings.
export const listPeriodYears = (maxMonth = getCurrentMonth()) =>
  [...new Set(listPeriodMonths(maxMonth).map(m => m.split('-')[0]))];

// Picking a year has to land on a concrete month, because the yearly
// aggregation derives its year from selectedMonth (see getYearlyData). The
// latest selectable month of that year is the natural landing spot: it
// keeps "switch to Год, then back to Месяц" on the most recent data rather
// than throwing the user back to January.
export const getLastMonthOfYear = (year, maxMonth = getCurrentMonth()) => {
  const months = listPeriodMonths(maxMonth).filter(m => m.startsWith(`${year}-`));
  return months.length > 0 ? months[months.length - 1] : null;
};

const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

// Month name only, e.g. "Август" - used inside the picker's year sections,
// where the year is already the section heading.
export const formatMonthName = (month) =>
  capitalize(new Date(`${month}-01T12:00:00`).toLocaleDateString('ru-RU', { month: 'long' }));

// The label the "Период" chip shows, i.e. the currently selected period
// spelled out in full: "Август 2026" / "2026 год" / "Всё время".
export const formatPeriodLabel = (timeRange, selectedMonth) => {
  if (timeRange === 'lifetime') return 'Всё время';
  if (timeRange === 'year') return `${selectedMonth.split('-')[0]} год`;
  return capitalize(
    new Date(`${selectedMonth}-01T12:00:00`)
      .toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
      .replace(' г.', '')
  );
};
