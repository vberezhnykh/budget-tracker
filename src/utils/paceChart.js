// Геометрия графика «Темп трат» без React: шкалы, линии «обычно», «факт» и
// «прогноз», положение лимита. Вынесена, чтобы границы (первый и последний
// день месяца, нулевой знаменатель, месяц без прогноза) проверялись
// юнит-тестами, а не глазами на экране.
//
// Вход - блок typicalMonth из /api/stats/dashboard (см. server/typicalMonth.js):
// byDay - «обычное» накопленное по дням, actualByDay - факт выбранного месяца
// (для идущего месяца до сегодняшнего числа), today - сегодняшний блок или
// null у прошедшего месяца.

// Размеры в единицах viewBox. Ширина близка к ширине карточки на телефоне,
// поэтому SVG почти не масштабируется и подписи остаются читаемыми.
export const PACE_CHART_SIZE = {
  width: 320,
  height: 150,
  left: 8,
  // Справа запас под точку «факта» на последнем дне и подпись последнего дня.
  right: 14,
  // Сверху - место под подпись лимита, снизу - под подписи дней.
  top: 18,
  bottom: 24,
};

// Запас сверху, чтобы линия на максимуме не прилипала к краю.
const HEADROOM = 1.05;

// Дни, подписанные под осью. Последний день месяца добавляется отдельно.
const TICK_DAYS = [1, 8, 15, 22];

export const isLimitUsable = (limit) => Number.isFinite(limit) && limit > 0;

// Кривая прогноза от сегодняшнего дня до конца месяца: values[i] - значение в
// день day + i. Повторяет форму «обычной» кривой, а не прямую: аренда первого
// числа и зарплатные покупки неравномерны, и прямая от «сейчас» до итога
// лгала бы о том, когда уйдут деньги.
//
//   forecast(d) = spent + (byDay[d-1] - byDay[D-1]) * k,
//   k = typicalRemaining / (byDay[S-1] - byDay[D-1]).
//
// Когда знаменатель нулевой («обычно» после этого дня ничего не тратят, а
// остаток при этом не нулевой - бывает при разных числах дней в месяцах),
// кривой для масштабирования нет, и берётся прямая до прогноза. Пустой массив
// - прогнозировать нечего (последний день или нет сегодняшнего блока).
export function getForecastCurve({ byDay, today }) {
  if (!today || !Array.isArray(byDay)) return [];
  const { day, spent, forecast, typicalRemaining } = today;
  const last = byDay.length;
  if (!Number.isInteger(day) || day < 1 || day >= last) return [];
  if (![spent, forecast, typicalRemaining].every(Number.isFinite)) return [];

  const base = byDay[day - 1];
  const denominator = byDay[last - 1] - base;
  const curve = [];
  for (let d = day; d <= last; d += 1) {
    if (denominator > 0) {
      curve.push(spent + (byDay[d - 1] - base) * (typicalRemaining / denominator));
    } else {
      curve.push(spent + (forecast - spent) * ((d - day) / (last - day)));
    }
  }
  return curve;
}

// Подпись дня на оси: «1 окт» для крайних, просто число для середины.
// Месяц передаётся уже готовой короткой подписью - склонение и локаль не
// дело геометрии.
export function getTickDays(days) {
  const ticks = TICK_DAYS.filter((day) => day < days);
  // Последний день не должен налезать на предыдущую подпись: если до неё
  // меньше недели, она уступает место.
  while (ticks.length > 1 && days - ticks[ticks.length - 1] < 5) ticks.pop();
  ticks.push(days);
  return ticks;
}

export function buildPaceChart({ typicalMonth, limit = null, size = PACE_CHART_SIZE }) {
  const { byDay, actualByDay = [], monthTotal = 0, today = null } = typicalMonth;
  const days = byDay.length;
  const plotWidth = size.width - size.left - size.right;
  const plotHeight = size.height - size.top - size.bottom;

  const forecastCurve = getForecastCurve({ byDay, today });
  const lastActualValue = actualByDay.length ? actualByDay[actualByDay.length - 1] : null;
  const limitUsable = isLimitUsable(limit);

  const top = Math.max(
    limitUsable ? limit : 0,
    monthTotal,
    today && Number.isFinite(today.forecast) ? today.forecast : 0,
    ...byDay,
    ...actualByDay,
  ) * HEADROOM;
  const yMax = top > 0 ? top : 1;

  const x = (day) => size.left + (days > 1 ? ((day - 1) / (days - 1)) * plotWidth : 0);
  const y = (value) => size.top + plotHeight - (Math.min(Math.max(value, 0), yMax) / yMax) * plotHeight;
  const point = (day, value) => ({ day, value, x: x(day), y: y(value) });
  const toPoints = (values, firstDay = 1) => values
    .map((value, index) => `${round(x(firstDay + index))},${round(y(value))}`)
    .join(' ');

  return {
    size,
    days,
    yMax,
    x,
    y,
    baseline: y(0),
    typicalPoints: toPoints(byDay),
    actualPoints: actualByDay.length ? toPoints(actualByDay) : '',
    lastActual: lastActualValue === null ? null : point(actualByDay.length, lastActualValue),
    forecastPoints: forecastCurve.length ? toPoints(forecastCurve, today.day) : '',
    forecastCurve,
    limit: limitUsable ? { value: limit, y: y(limit) } : null,
    ticks: getTickDays(days).map((day) => ({ day, x: x(day) })),
  };
}

// День, ближайший к горизонтальной координате (в единицах viewBox): для
// подсказки под пальцем или курсором. Всегда в пределах 1..days.
export function getDayAtX(chart, viewX) {
  const { size, days } = chart;
  if (days <= 1) return 1;
  const plotWidth = size.width - size.left - size.right;
  const day = Math.round(((viewX - size.left) / plotWidth) * (days - 1)) + 1;
  return Math.min(days, Math.max(1, day));
}

// Значения всех линий в выбранный день для подсказки; отсутствующая линия -
// null (факт ещё не наступил, прогноз только после сегодняшнего дня).
export function getValuesAtDay({ typicalMonth }, day) {
  const { byDay, actualByDay = [], today = null } = typicalMonth;
  const curve = getForecastCurve({ byDay, today });
  const forecastIndex = today ? day - today.day : -1;
  return {
    actual: day <= actualByDay.length ? actualByDay[day - 1] : null,
    // На сегодняшнем дне прогноз совпадает с фактом - второй строкой он не нужен.
    forecast: forecastIndex > 0 && forecastIndex < curve.length ? curve[forecastIndex] : null,
    typical: byDay[day - 1] ?? null,
  };
}

function round(value) {
  return Math.round(value * 100) / 100;
}
