import { getCurrentMonth } from './period';
import { formatMoney } from './money';

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
const formatWholeEuro = (value) => formatMoney(value, { whole: true });

// Вывод про лимит под прогнозом: общий для плашки на Обзоре и карточки «Темп
// трат» на Аналитике, чтобы слова и правило округления не разъезжались.
// Сравнение после округления до евро: суммы в тексте целые, и без этого
// прогноз на несколько центов выше лимита давал «превышен примерно на €0».
//
// conditional - начинать ли с «Если так и будет, »: после фразы о том, сколько
// обычно уходит дальше, оно связывает предложения; в последний день месяца
// фразы про остаток нет, и связывать не с чем.
// spent - уже потрачено: если оно выше лимита, лимит не «будет», а уже
// превышен, и говорить надо о том, во сколько вырастет перерасход.
// null - лимит не задан, говорить не о чем.
export function getForecastVerdict({ forecast, limit, spent = null, conditional = true }) {
  if (!Number.isFinite(limit) || limit <= 0 || !Number.isFinite(forecast)) return null;
  const overBy = Math.round(forecast - limit);
  const overLimit = overBy >= 1;
  const alreadyOver = overLimit && Number.isFinite(spent) && Math.round(spent - limit) >= 1;
  const lead = conditional ? 'Если так и будет, ' : '';
  const sentence = (text) => `${lead}${text}`.replace(/^./, (c) => c.toUpperCase());
  let text;
  if (alreadyOver) text = sentence(`лимит уже превышен, к концу месяца перерасход составит около ${formatWholeEuro(overBy)}.`);
  else if (overLimit) text = sentence(`лимит будет превышен примерно на ${formatWholeEuro(overBy)}.`);
  else text = sentence(`запас до лимита ≈ ${formatWholeEuro(Math.max(0, limit - forecast))}.`);
  return { overLimit, text };
}

// «С 26 по 31 число ... около €R.» - пояснение к прогнозу, про остаток месяца.
// verb подставляет оборот: «у вас обычно уходит» (плашка) или «вы обычно
// тратите» (Аналитика).
export function formatRemainingSpan({ day, lastDay, typicalRemaining, verb = 'у вас обычно уходит' }) {
  return `С ${day + 1} по ${lastDay} число ${verb} около ${formatWholeEuro(typicalRemaining)}.`;
}

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

  const verdict = getForecastVerdict({ forecast: today.forecast, limit });
  const overLimit = verdict.overLimit;

  return {
    daysLeft,
    title: `До конца месяца ${daysLeft} ${pluralDays(daysLeft)}`,
    text: `${formatRemainingSpan({ day: today.day, lastDay, typicalRemaining: today.typicalRemaining })} ${verdict.text}`,
    tone: overLimit ? 'warning' : 'neutral',
  };
}
