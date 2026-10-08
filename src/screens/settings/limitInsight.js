// Расчёты для графика в листе лимита: что было за последние полные месяцы и в
// скольких из них расход превысил бы выбранный лимит.

// Сколько последних закрытых месяцев показываем и учитываем.
const LIMIT_HISTORY_MONTHS = 6;

// Последние закрытые месяцы из ряда «от старого к новому». Текущий (и любой
// более поздний) месяц отбрасывается: он ещё не закончился, и его расход
// занижает «обычный» месяц. Месяцы 'YYYY-MM' сравниваются как строки.
export function closedMonths(series, currentMonth, count = LIMIT_HISTORY_MONTHS) {
  if (!Array.isArray(series)) return [];
  return series.filter((item) => item.month < currentMonth).slice(-count);
}

// Медиана расхода по месяцам. У чётного числа месяцев - среднее двух
// серединных. Пустой ряд даёт null: «обычного» месяца нет.
export function medianExpense(months) {
  if (!months.length) return null;
  const sorted = months.map((item) => Number(item.expense) || 0).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Сколько месяцев расход строго больше лимита. Лимит должен быть конечным
// положительным числом, иначе считать превышения не с чем (null).
export function exceededCount(months, limit) {
  if (!Number.isFinite(limit) || limit <= 0) return null;
  return months.filter((item) => (Number(item.expense) || 0) > limit).length;
}

// Всё вместе для карточки: месяцы, медиана и число превышений.
export function limitInsight(series, currentMonth, limit) {
  const months = closedMonths(series, currentMonth);
  return {
    months,
    median: medianExpense(months),
    exceeded: exceededCount(months, limit),
    total: months.length,
  };
}
