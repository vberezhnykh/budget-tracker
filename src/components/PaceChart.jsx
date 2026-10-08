import { useState } from 'react';
import { buildPaceChart, getDayAtX, getValuesAtDay } from '../utils/paceChart';
import { formatMoney } from '../utils/money';
import { formatDayMonth, formatDayMonthShort } from '../utils/period';

// График темпа трат: накопленный расход месяца по дням. Три линии на одной
// оси - «факт» (толстая, цвет акцента), «прогноз» (пунктир от сегодняшнего
// дня до конца месяца) и «обычно» (широкая серая подложка, медиана прошлых
// месяцев) - и горизонтальный пунктир лимита. Геометрия считается в
// utils/paceChart, здесь только разметка и подсказка.
//
// Цвет несёт только акцент на факте, остальное серое: читателю нужно одно -
// выше или ниже подложки идёт линия. Различие линий не держится на цвете:
// «прогноз» пунктирный, «обычно» втрое шире, всё это есть в легенде.
//
// Подсказка по касанию или наведению показывает значения выбранного дня; все
// эти числа есть и в плитках карточки, поэтому она ничего не закрывает.

const TYPICAL_WIDTH = 6;
const ACTUAL_WIDTH = 3;

const textStyle = { fontSize: 10, fill: 'var(--color-text-muted)', fontFamily: 'inherit' };

// Описание графика для читалки: тот же вывод, что и глазами, без геометрии.
function describeChart({ typicalMonth, selectedMonth, limit, chart }) {
  const { today, actualByDay = [], monthTotal } = typicalMonth;
  const actual = chart.lastActual?.value ?? 0;
  const limitPart = chart.limit ? `; лимит ${formatMoney(limit, { whole: true })}` : '';
  if (today) {
    return `График темпа трат: на ${formatDayMonth(selectedMonth, today.day)} потрачено ${formatMoney(today.spent)}, `
      + `обычно к этому дню ${formatMoney(today.typicalToDate)}; прогноз на конец месяца около ${formatMoney(today.forecast, { whole: true })}${limitPart}.`;
  }
  const days = actualByDay.length;
  return `График трат по дням: за месяц потрачено ${formatMoney(actual)} (дней: ${days}), `
    + `обычно за месяц ${formatMoney(monthTotal)}${limitPart}.`;
}

function LegendItem({ label, keyStyle }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
      <i aria-hidden="true" style={{ display: 'inline-block', width: 18, height: 0, borderRadius: 'var(--radius-pill)', ...keyStyle }} />
      {label}
    </span>
  );
}

export default function PaceChart({ typicalMonth, selectedMonth, limit = null }) {
  const [hoverDay, setHoverDay] = useState(null);
  const chart = buildPaceChart({ typicalMonth, limit });
  const { size } = chart;
  const hasForecast = chart.forecastPoints !== '';
  const hasActual = chart.actualPoints !== '';

  const moveTo = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width) return;
    setHoverDay(getDayAtX(chart, ((event.clientX - rect.left) / rect.width) * size.width));
  };

  const values = hoverDay === null ? null : getValuesAtDay({ typicalMonth }, hoverDay);
  const hoverX = hoverDay === null ? 0 : chart.x(hoverDay);
  // Точка на подсвеченном дне: на факте, а если факт кончился - на прогнозе.
  const hoverDot = values && (values.actual ?? values.forecast);

  return (
    <div data-account-value style={{ position: 'relative' }}>
      <svg
        role="img"
        aria-label={describeChart({ typicalMonth, selectedMonth, limit, chart })}
        viewBox={`0 0 ${size.width} ${size.height}`}
        style={{ display: 'block', width: '100%', height: 'auto', touchAction: 'pan-y', overflow: 'visible' }}
        onPointerMove={moveTo}
        onPointerDown={moveTo}
        // Мышь уходит - подсказка убирается; палец поднят - значения остаются,
        // иначе их нельзя было бы прочитать, не закрывая график рукой.
        onPointerLeave={(event) => { if (event.pointerType === 'mouse') setHoverDay(null); }}
        onPointerCancel={() => setHoverDay(null)}
      >
        <line x1={size.left} x2={size.width - size.right} y1={chart.baseline} y2={chart.baseline}
          style={{ stroke: 'var(--color-border)', strokeWidth: 1 }} />

        {/* Подложка «обычно» - самая широкая и самая светлая, под всеми. */}
        <polyline data-testid="pace-typical" points={chart.typicalPoints} fill="none"
          style={{ stroke: 'var(--color-control-off)', strokeWidth: TYPICAL_WIDTH, strokeLinecap: 'round', strokeLinejoin: 'round' }} />

        {chart.limit && (
          <g data-testid="pace-limit">
            <line x1={size.left} x2={size.width - size.right} y1={chart.limit.y} y2={chart.limit.y}
              style={{ stroke: 'var(--color-negative)', strokeWidth: 1.5, strokeDasharray: '5 4' }} />
            <text x={size.left} y={chart.limit.y - 5} style={{ ...textStyle, fill: 'var(--color-negative)' }}>
              {`лимит ${formatMoney(chart.limit.value, { whole: true })}`}
            </text>
          </g>
        )}

        {hasForecast && (
          <polyline data-testid="pace-forecast" points={chart.forecastPoints} fill="none"
            style={{ stroke: 'var(--color-primary)', strokeOpacity: 0.55, strokeWidth: ACTUAL_WIDTH, strokeDasharray: '6 5', strokeLinejoin: 'round' }} />
        )}

        {hasActual && (
          <polyline data-testid="pace-actual" points={chart.actualPoints} fill="none"
            style={{ stroke: 'var(--color-primary)', strokeWidth: ACTUAL_WIDTH, strokeLinecap: 'round', strokeLinejoin: 'round' }} />
        )}

        {values && (
          <g aria-hidden="true">
            <line x1={hoverX} x2={hoverX} y1={size.top} y2={chart.baseline}
              style={{ stroke: 'var(--color-border-strong)', strokeWidth: 1 }} />
            {hoverDot !== null && hoverDot !== undefined && (
              <circle cx={hoverX} cy={chart.y(hoverDot)} r={4}
                style={{ fill: 'var(--color-primary)', stroke: 'var(--color-surface)', strokeWidth: 2 }} />
            )}
          </g>
        )}

        {chart.lastActual && (
          <circle data-testid="pace-dot" cx={chart.lastActual.x} cy={chart.lastActual.y} r={4}
            style={{ fill: 'var(--color-primary)', stroke: 'var(--color-surface)', strokeWidth: 2 }} />
        )}

        {chart.ticks.map((tick, index) => (
          <text key={tick.day} x={tick.x} y={size.height - 6}
            textAnchor={index === 0 ? 'start' : index === chart.ticks.length - 1 ? 'end' : 'middle'}
            style={textStyle}>
            {index === 0 || index === chart.ticks.length - 1
              ? formatDayMonthShort(selectedMonth, tick.day)
              : tick.day}
          </text>
        ))}
      </svg>

      {values && (
        <div
          data-testid="pace-tooltip"
          style={{
            position: 'absolute',
            top: 0,
            left: `clamp(56px, ${(hoverX / size.width) * 100}%, calc(100% - 56px))`,
            transform: 'translateX(-50%)',
            padding: 'var(--space-1-5) var(--space-2)',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--color-text-main)',
            color: 'var(--color-text-inverse)',
            fontSize: 'var(--text-2xs)',
            lineHeight: 1.4,
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
          }}
        >
          <div style={{ opacity: 0.8 }}>{formatDayMonthShort(selectedMonth, hoverDay)}</div>
          {values.actual !== null && <div><strong>{formatMoney(values.actual)}</strong> факт</div>}
          {values.forecast !== null && <div><strong>{formatMoney(values.forecast, { whole: true })}</strong> прогноз</div>}
          {values.typical !== null && <div><strong>{formatMoney(values.typical)}</strong> обычно</div>}
        </div>
      )}

      {/* Легенда нужна всегда: идентичность линий не должна держаться на
          одном цвете. Пунктира «прогноза» в легенде нет там, где его нет на
          графике. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1) var(--space-4)', marginTop: 'var(--space-2)', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
        {hasActual && <LegendItem label="факт" keyStyle={{ borderTop: `${ACTUAL_WIDTH}px solid var(--color-primary)` }} />}
        {hasForecast && <LegendItem label="прогноз" keyStyle={{ borderTop: `${ACTUAL_WIDTH}px dashed var(--color-primary)`, opacity: 0.55 }} />}
        <LegendItem label="обычно" keyStyle={{ borderTop: `${TYPICAL_WIDTH}px solid var(--color-control-off)` }} />
      </div>
    </div>
  );
}
