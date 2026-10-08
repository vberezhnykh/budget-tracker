import { MIN_MONTH, formatMonthName } from './period';

// Склонение названий месяцев для фраз интерфейса. Intl отдаёт только
// именительный падеж, а «в ноябрь» или «Месяц закрыт» с неверным окончанием
// читаются как ошибка, поэтому предложный падеж собирается здесь.

// Строчное название в именительном падеже: «октябрь». Оно же винительное
// для месяцев («Посмотреть октябрь»).
export const monthNominative = (month) => formatMonthName(month).toLowerCase();

// Предложный падеж с предлогом: «в ноябре», «в мае», «в марте». Окончание:
// -ь/-й заменяются на -е (ноябрь → ноябре, май → мае), остальные берут -е
// (март → марте, август → августе).
export const monthLocative = (month) => {
  const name = monthNominative(month);
  return `в ${/[ьй]$/.test(name) ? name.slice(0, -1) : name}е`;
};

// Предыдущий календарный месяц как 'YYYY-MM': '2026-01' → '2025-12'.
export const getPreviousMonth = (month) => {
  const [year, m] = month.split('-').map(Number);
  const prevYear = m === 1 ? year - 1 : year;
  const prevMonth = m === 1 ? 12 : m - 1;
  return `${prevYear}-${String(prevMonth).padStart(2, '0')}`;
};

// Есть ли у приложения вообще данные за этот месяц (раньше начала истории
// смотреть нечего).
export const isMonthInHistory = (month) => month >= MIN_MONTH;
