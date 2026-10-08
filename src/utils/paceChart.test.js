import { describe, it, expect } from 'vitest';
import {
  PACE_CHART_SIZE, buildPaceChart, getForecastCurve, getTickDays, getDayAtX, getValuesAtDay, isLimitUsable,
} from './paceChart';

// Короткий месяц из 10 дней, чтобы числа считались в уме.
// Обычно: 100 в 1-й день (аренда), дальше по 10 в день.
const byDay = [100, 110, 120, 130, 140, 150, 160, 170, 180, 190];
const typical = (overrides = {}) => ({
  months: ['2026-02', '2026-01', '2025-12'],
  byDay,
  monthTotal: 190,
  actualByDay: [100, 100, 130, 130],
  today: { day: 4, typicalToDate: 130, typicalRemaining: 60, spent: 130, forecast: 190 },
  ...overrides,
});

describe('getForecastCurve', () => {
  it('идёт по форме «обычной» кривой от сегодняшнего дня до прогноза', () => {
    const curve = getForecastCurve({ byDay, today: typical().today });

    expect(curve).toHaveLength(7);
    expect(curve[0]).toBe(130);
    // k = 60 / (190 - 130) = 1: прогноз повторяет обычную кривую со сдвигом.
    expect(curve[3]).toBe(130 + (160 - 130));
    expect(curve[6]).toBe(190);
  });

  it('масштабирует форму, если остаток отличается от обычного', () => {
    const today = { day: 4, spent: 200, typicalRemaining: 30, forecast: 230, typicalToDate: 130 };

    const curve = getForecastCurve({ byDay, today });

    // k = 30 / 60 = 0.5
    expect(curve[0]).toBe(200);
    expect(curve[2]).toBe(200 + (150 - 130) * 0.5);
    expect(curve[6]).toBe(230);
  });

  it('нулевой знаменатель: прямая линия до прогноза', () => {
    const flat = [100, 100, 100, 100, 100];
    const today = { day: 2, spent: 100, typicalRemaining: 40, forecast: 140, typicalToDate: 100 };

    const curve = getForecastCurve({ byDay: flat, today });

    expect(curve).toHaveLength(4);
    expect(curve[0]).toBe(100);
    expect(curve[curve.length - 1]).toBe(140);
    // Монотонно растёт и без изломов: шаг одинаковый.
    const steps = curve.slice(1).map((v, i) => v - curve[i]);
    expect(Math.max(...steps) - Math.min(...steps)).toBeLessThan(1e-9);
  });

  it('последний день и прошедший месяц - прогнозировать нечего', () => {
    expect(getForecastCurve({ byDay, today: { ...typical().today, day: 10 } })).toEqual([]);
    expect(getForecastCurve({ byDay, today: null })).toEqual([]);
  });

  it('неполные числа в блоке today не дают NaN', () => {
    expect(getForecastCurve({ byDay, today: { ...typical().today, forecast: null } })).toEqual([]);
  });
});

describe('getTickDays', () => {
  it('1, 8, 15, 22 и последний день месяца', () => {
    expect(getTickDays(31)).toEqual([1, 8, 15, 22, 31]);
    expect(getTickDays(28)).toEqual([1, 8, 15, 22, 28]);
    expect(getTickDays(30)).toEqual([1, 8, 15, 22, 30]);
  });

  it('подпись, которая оказалась бы вплотную к последнему дню, уступает ему место', () => {
    // 8 и 10 - два дня разницы: подписи слиплись бы.
    expect(getTickDays(10)).toEqual([1, 10]);
  });
});

describe('buildPaceChart: шкалы', () => {
  it('ось X: первый день у левого края поля, последний - у правого', () => {
    const chart = buildPaceChart({ typicalMonth: typical(), limit: null });
    const { size } = chart;

    expect(chart.x(1)).toBe(size.left);
    expect(chart.x(10)).toBe(size.width - size.right);
    expect(chart.x(5)).toBeGreaterThan(chart.x(4));
  });

  it('ось Y: ноль на нижней границе поля, максимум ниже верхней с запасом 5%', () => {
    const chart = buildPaceChart({ typicalMonth: typical(), limit: 150 });
    const { size } = chart;

    expect(chart.baseline).toBe(size.height - size.bottom);
    // Самое большое из лимита, итога, прогноза и факта - 190.
    expect(chart.yMax).toBeCloseTo(190 * 1.05, 6);
    expect(chart.y(chart.yMax)).toBe(size.top);
    expect(chart.y(0)).toBe(chart.baseline);
  });

  it('лимит выше всех данных тянет шкалу вверх', () => {
    const chart = buildPaceChart({ typicalMonth: typical(), limit: 1000 });

    expect(chart.yMax).toBeCloseTo(1050, 6);
    expect(chart.limit.value).toBe(1000);
    expect(chart.limit.y).toBeCloseTo(chart.y(1000), 6);
    expect(chart.limit.y).toBeGreaterThanOrEqual(chart.size.top);
  });

  it('лимит ниже данных рисуется внутри поля', () => {
    const chart = buildPaceChart({ typicalMonth: typical(), limit: 50 });

    expect(chart.limit.y).toBeLessThan(chart.baseline);
    expect(chart.limit.y).toBeGreaterThan(chart.size.top);
  });

  it('непригодный лимит не рисуется и шкалу не трогает', () => {
    [null, undefined, 0, -5, NaN].forEach((limit) => {
      const chart = buildPaceChart({ typicalMonth: typical(), limit });
      expect(chart.limit).toBeNull();
      expect(chart.yMax).toBeCloseTo(190 * 1.05, 6);
    });
    expect(isLimitUsable(7000)).toBe(true);
    expect(isLimitUsable(0)).toBe(false);
  });

  it('все нули не дают деления на ноль', () => {
    const chart = buildPaceChart({
      typicalMonth: typical({ byDay: [0, 0, 0], monthTotal: 0, actualByDay: [0], today: null }),
      limit: null,
    });

    expect(chart.yMax).toBe(1);
    expect(Number.isFinite(chart.y(0))).toBe(true);
  });

  it('значение выше шкалы не вылезает за верхнюю границу', () => {
    const chart = buildPaceChart({ typicalMonth: typical(), limit: null });

    expect(chart.y(chart.yMax * 10)).toBe(chart.size.top);
    expect(chart.y(-5)).toBe(chart.baseline);
  });
});

describe('buildPaceChart: линии', () => {
  it('«обычно» - по точке на каждый день месяца', () => {
    const chart = buildPaceChart({ typicalMonth: typical(), limit: null });

    expect(chart.typicalPoints.split(' ')).toHaveLength(10);
  });

  it('«факт» - только прошедшие дни, точка на последнем из них', () => {
    const chart = buildPaceChart({ typicalMonth: typical(), limit: null });

    expect(chart.actualPoints.split(' ')).toHaveLength(4);
    expect(chart.lastActual).toMatchObject({ day: 4, value: 130 });
    expect(chart.lastActual.x).toBe(chart.x(4));
    expect(chart.lastActual.y).toBe(chart.y(130));
  });

  it('«прогноз» начинается в точке «факта» и заканчивается на последнем дне', () => {
    const chart = buildPaceChart({ typicalMonth: typical(), limit: null });
    const points = chart.forecastPoints.split(' ');

    expect(points).toHaveLength(7);
    const parse = (text) => text.split(',').map(Number);
    expect(parse(points[0])[0]).toBeCloseTo(chart.x(4), 1);
    expect(parse(points[0])[1]).toBeCloseTo(chart.y(130), 1);
    expect(parse(points[6])[0]).toBeCloseTo(chart.x(10), 1);
    expect(parse(points[6])[1]).toBeCloseTo(chart.y(190), 1);
  });

  it('прошедший месяц: факт за весь месяц и нет прогноза', () => {
    const chart = buildPaceChart({
      typicalMonth: typical({ today: null, actualByDay: [100, 100, 130, 130, 140, 150, 150, 160, 170, 200] }),
      limit: null,
    });

    expect(chart.actualPoints.split(' ')).toHaveLength(10);
    expect(chart.forecastPoints).toBe('');
    expect(chart.forecastCurve).toEqual([]);
    expect(chart.lastActual).toMatchObject({ day: 10, value: 200 });
    // Факт выше обычного итога - шкала растёт под него.
    expect(chart.yMax).toBeCloseTo(200 * 1.05, 6);
  });

  it('последний день идущего месяца: прогноза нет, точка на конце', () => {
    const chart = buildPaceChart({
      typicalMonth: typical({
        actualByDay: [100, 100, 130, 130, 140, 150, 150, 160, 170, 180],
        today: { day: 10, typicalToDate: 190, typicalRemaining: 0, spent: 180, forecast: 180 },
      }),
      limit: null,
    });

    expect(chart.forecastPoints).toBe('');
    expect(chart.lastActual.day).toBe(10);
  });

  it('нет факта (будущий месяц): линии факта и точки нет', () => {
    const chart = buildPaceChart({ typicalMonth: typical({ actualByDay: [], today: null }), limit: null });

    expect(chart.actualPoints).toBe('');
    expect(chart.lastActual).toBeNull();
  });

  it('ось X подписывает 1, 8, 15, 22 и последний день', () => {
    const chart = buildPaceChart({ typicalMonth: typical({ byDay: Array.from({ length: 31 }, (_, i) => i * 10), actualByDay: [], today: null }), limit: null });

    expect(chart.ticks.map((t) => t.day)).toEqual([1, 8, 15, 22, 31]);
    expect(chart.ticks[0].x).toBe(PACE_CHART_SIZE.left);
  });
});

describe('getDayAtX и getValuesAtDay', () => {
  const chart = buildPaceChart({ typicalMonth: typical(), limit: null });

  it('координата переводится в ближайший день и не выходит за месяц', () => {
    expect(getDayAtX(chart, chart.x(1))).toBe(1);
    expect(getDayAtX(chart, chart.x(6))).toBe(6);
    expect(getDayAtX(chart, chart.x(6) + 1)).toBe(6);
    expect(getDayAtX(chart, -50)).toBe(1);
    expect(getDayAtX(chart, 9999)).toBe(10);
  });

  it('значения линий в день: факт до сегодня, прогноз после, обычно всегда', () => {
    const month = typical();

    expect(getValuesAtDay({ typicalMonth: month }, 2)).toEqual({ actual: 100, forecast: null, typical: 110 });
    expect(getValuesAtDay({ typicalMonth: month }, 4)).toEqual({ actual: 130, forecast: null, typical: 130 });
    expect(getValuesAtDay({ typicalMonth: month }, 7)).toEqual({ actual: null, forecast: 160, typical: 160 });
    expect(getValuesAtDay({ typicalMonth: month }, 10)).toEqual({ actual: null, forecast: 190, typical: 190 });
  });
});
