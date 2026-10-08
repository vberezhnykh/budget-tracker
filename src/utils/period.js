// Everything that decides *which* months and years the period picker may
// offer, kept free of React so it can be unit-tested directly.
//
// The lower bound is the app's own start of history: the initial balances
// are dated 2025-11-09 (see getLifetimeStats' default startDate), so there
// is nothing meaningful to show before that month. The upper bound is the
// current month - the app never shows a future period.

export const MIN_DATE = '2025-11-09';
export const MIN_MONTH = MIN_DATE.slice(0, 7);

// Локальная дата 'YYYY-MM-DD', а не UTC: toISOString сдвигает день ночью.
export function toLocalDateInput(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export const getCurrentMonth = () => toLocalDateInput().slice(0, 7);

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

// Dative case of a Russian month name, for labels reading "к декабрю".
// Intl only ever gives the nominative ("декабрь"), and "к декабрь" is
// simply wrong, so the ending is adjusted here: -ь/-й become -ю (декабрь →
// декабрю, май → маю), everything else takes -у (август → августу).
export const toDativeMonth = (monthName) => /[ьй]$/.test(monthName)
  ? `${monthName.slice(0, -1)}ю`
  : `${monthName}у`;

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

// Период как часть фразы - «Расход за сентябрь», «Сводка за 2026»: месяц в
// именительном падеже строчными, год - только если он не текущий (иначе
// «за сентябрь 2026» читается как лишнее уточнение очевидного), год и всё
// время - без слова «год». now параметром, а не new Date() внутри - чтобы
// «текущий год» не зависел от часов на машине в тестах.
export const formatPeriodPhrase = (timeRange, selectedMonth, now = new Date()) => {
  if (timeRange === 'lifetime') return 'всё время';
  const [year] = selectedMonth.split('-');
  if (timeRange === 'year') return year;
  const name = formatMonthName(selectedMonth).toLowerCase();
  return Number(year) === now.getFullYear() ? name : `${name} ${year}`;
};

// Заголовок выбора периода на Обзоре: «Октябрь», «Октябрь 2025», «2026»,
// «Всё время». От formatPeriodLabel отличается тем, что год у месяца
// добавляется только когда он не текущий (в заголовке экрана «Октябрь 2026»
// в октябре 2026 - лишнее), и тем, что у года нет слова «год».
export const formatPeriodTitle = (timeRange, selectedMonth, now = new Date()) => {
  if (timeRange === 'lifetime') return 'Всё время';
  const [year] = selectedMonth.split('-');
  if (timeRange === 'year') return year;
  const name = formatMonthName(selectedMonth);
  return Number(year) === now.getFullYear() ? name : `${name} ${year}`;
};

// Статус синхронизации в шапке Обзора: «Обновлено 14:05» для сегодняшней
// синхронизации и «Обновлено 7 окт., 14:05» для более старой (label - уже
// готовая короткая дата со временем, которую App показывает и в других
// местах). Дату сравниваем по локальному календарю, а не по UTC.
export const formatSyncStatus = (syncedAt, label, now = new Date()) => {
  if (!syncedAt || !label) return null;
  if (toLocalDateInput(syncedAt) !== toLocalDateInput(now)) return `Обновлено ${label}`;
  const time = syncedAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return `Обновлено ${time}`;
};

// «8 октября» - число и месяц в родительном падеже: подпись даты в тексте
// («Обычно к 8 октября»). Intl со стилем day+month сам склоняет месяц.
export const formatDayMonth = (selectedMonth, day) =>
  new Date(`${selectedMonth}-${String(day).padStart(2, '0')}T12:00:00`)
    .toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });

// «1 окт» - короткая подпись дня на оси графика, без точки на конце.
export const formatDayMonthShort = (selectedMonth, day) =>
  new Date(`${selectedMonth}-${String(day).padStart(2, '0')}T12:00:00`)
    .toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
    .replace(/\.$/, '');
