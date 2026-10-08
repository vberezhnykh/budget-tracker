import { getCurrentMonth } from './period';

// Плашка «До конца месяца N дней» на Обзоре: чистая логика видимости и текста,
// без React, чтобы границы условий проверялись юнит-тестами, а не кликами.
//
// Правила (решение из docs/REDESIGN-PLAN.md): плашка нужна только в
// последние 10 дней идущего месяца, пока лимит ещё не превышен - после
// превышения «успеете ли уложиться» уже не вопрос, это видно по полосе.

export const PLAQUE_MAX_DAYS = 10;

// день / дня / дней по последним цифрам числа; 11-14 - исключение, у них
// всегда «дней».
export const pluralDays = (count) => {
  const lastTwo = count % 100;
  const last = count % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return 'дней';
  if (last === 1) return 'день';
  if (last >= 2 && last <= 4) return 'дня';
  return 'дней';
};

const daysInMonth = (month) => {
  const [year, m] = month.split('-').map(Number);
  // День 0 следующего месяца - последний день этого.
  return new Date(year, m, 0).getDate();
};

// Оценки округляются до целых евро: «≈ €1.120» честно говорит, что это
// прикидка, а центы создавали бы ложное ощущение точности.
const formatWholeEuro = (value) => `€${Math.round(value).toLocaleString('de-DE')}`;

// null - плашку не показывать; иначе { daysLeft, title, text, tone }.
// currentMonth параметром, а не getCurrentMonth() внутри - чтобы тесты не
// зависели от часов машины.
export function getLatePlaque({
  timeRange,
  selectedMonth,
  currentMonth = getCurrentMonth(),
  spent,
  limit,
  typicalMonth,
}) {
  if (timeRange !== 'month' || selectedMonth !== currentMonth) return null;
  const today = typicalMonth?.today;
  if (!today) return null;
  if (!Number.isFinite(limit) || limit <= 0) return null;
  if (!Number.isFinite(spent) || spent > limit) return null;
  if (!Number.isInteger(today.day)
    || !Number.isFinite(today.typicalRemaining) || !Number.isFinite(today.forecast)) return null;

  const lastDay = daysInMonth(selectedMonth);
  const daysLeft = lastDay - today.day;
  if (daysLeft < 1 || daysLeft > PLAQUE_MAX_DAYS) return null;

  // Сравнение после округления до евро: суммы в тексте целые, и без этого
  // прогноз на несколько центов выше лимита давал «превышен примерно на €0».
  const overBy = Math.round(today.forecast - limit);
  const overLimit = overBy >= 1;
  const verdict = overLimit
    ? `Если так и будет, лимит будет превышен примерно на ${formatWholeEuro(overBy)}.`
    : `Если так и будет, запас до лимита ≈ ${formatWholeEuro(Math.max(0, limit - today.forecast))}.`;

  return {
    daysLeft,
    title: `До конца месяца ${daysLeft} ${pluralDays(daysLeft)}`,
    text: `С ${today.day + 1} по ${lastDay} число у вас обычно уходит около ${formatWholeEuro(today.typicalRemaining)}. ${verdict}`,
    tone: overLimit ? 'warning' : 'neutral',
  };
}
