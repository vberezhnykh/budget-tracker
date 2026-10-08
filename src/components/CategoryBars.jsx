import { useState } from 'react';
import Card from './ui/Card';
import { formatMoney } from '../utils/money';
import { pluralForm } from '../utils/plural';

// Расходы по категориям горизонтальными полосами, от большей к меньшей.
// Ширина полосы - доля от самой крупной категории, а не от суммы: так
// различие между соседями видно, а у самой крупной полоса всегда во всю
// ширину.
//
// Строка - кнопка: нажатие открывает Историю по этой категории (что именно
// произойдёт, решает вызывающий). Справа от названия - изменение к той же дате
// прошлого месяца, если сравнение передано (только для месяца).

// Сколько категорий видно, пока список не раскрыт.
const VISIBLE_COUNT = 5;

// Изменение меньше процента - «без изменений»: «↑ 0%» читалось бы как рост.
const STEADY_PERCENT = 1;

const CATEGORY_FORMS = ['категория', 'категории', 'категорий'];

// Что показать справа от названия: { text, color, spoken } или null, если
// сравнения для этой категории нет.
function getChange(entry) {
  if (!entry) return null;
  if (!(entry.previous > 0)) {
    return { text: 'новая', color: 'var(--color-text-muted)', spoken: 'новая категория' };
  }
  const percent = (entry.diff / entry.previous) * 100;
  if (Math.abs(percent) < STEADY_PERCENT) {
    return { text: 'без изменений', color: 'var(--color-text-muted)', spoken: 'без изменений' };
  }
  const rounded = Math.round(Math.abs(percent));
  // Рост расхода - плохо, падение - хорошо.
  return percent > 0
    ? { text: `↑ ${rounded}%`, color: 'var(--color-negative)', spoken: `на ${rounded}% больше` }
    : { text: `↓ ${rounded}%`, color: 'var(--color-positive)', spoken: `на ${rounded}% меньше` };
}

function CategoryRow({ name, value, max, change, onSelect }) {
  const label = `${name}: ${formatMoney(value)}${change ? `, ${change.spoken}` : ''}`;
  return (
    <button
      type="button"
      onClick={() => onSelect?.(name)}
      // Без этого название и сумма читаются слитно («Housing€98,40»).
      aria-label={label}
      style={{
        display: 'block',
        width: '100%',
        padding: 'var(--space-2) 0',
        background: 'transparent',
        color: 'inherit',
        textAlign: 'left',
        cursor: 'pointer',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 'var(--text-md)', fontWeight: 'var(--weight-label)', color: 'var(--color-text-main)' }}>
          {name}
        </span>
        <span data-account-value style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)', flexShrink: 0 }}>
          {change && (
            <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-label)', color: change.color }}>
              {change.text}
            </span>
          )}
          <span style={{ fontSize: 'var(--text-md)', fontWeight: 'var(--weight-strong)', color: 'var(--color-text-main)', fontVariantNumeric: 'tabular-nums' }}>
            {formatMoney(value)}
          </span>
        </span>
      </span>
      <span
        aria-hidden="true"
        data-category-bar={name}
        style={{ display: 'block', height: 8, marginTop: 'var(--space-2)', borderRadius: 'var(--radius-pill)', background: 'var(--color-surface-sunken)', overflow: 'hidden' }}
      >
        <span
          data-account-value
          style={{
            display: 'block',
            width: `${max > 0 ? Math.max(0, Math.min((value / max) * 100, 100)) : 0}%`,
            minWidth: value > 0 ? 4 : 0,
            height: '100%',
            borderRadius: 'var(--radius-pill)',
            background: 'var(--color-primary)',
          }}
        />
      </span>
    </button>
  );
}

// data - { категория: сумма }; comparison - { категория: { previous, diff, … } }
// или undefined, когда сравнивать не с чем (год, всё время); comparisonLabel -
// «к 15 сентября» над столбцом изменений.
export default function CategoryBars({ data, comparison, comparisonLabel, onSelectCategory }) {
  const [expanded, setExpanded] = useState(false);

  const entries = Object.entries(data || {})
    .filter(([, value]) => value > 0)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
  if (entries.length === 0) return null;

  const max = entries[0].value;
  const visible = expanded ? entries : entries.slice(0, VISIBLE_COUNT);
  const hidden = entries.slice(VISIBLE_COUNT);
  const hiddenSum = hidden.reduce((sum, entry) => sum + entry.value, 0);

  return (
    <Card as="section" padding="lg">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
        <h2 style={{ margin: 0, fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-strong)' }}>Категории</h2>
        {comparison && comparisonLabel && (
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>{comparisonLabel}</span>
        )}
      </div>

      <div>
        {visible.map(({ name, value }) => (
          <CategoryRow
            key={name}
            name={name}
            value={value}
            max={max}
            change={comparison ? getChange(comparison[name]) : null}
            onSelect={onSelectCategory}
          />
        ))}
      </div>

      {hidden.length > 0 && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((prev) => !prev)}
          style={{ marginTop: 'var(--space-2)', padding: 'var(--space-2) 0', minHeight: 44, background: 'transparent', color: 'var(--color-primary)', fontSize: 'var(--text-base)', fontWeight: 'var(--weight-label)' }}
        >
          {expanded
            ? 'Свернуть'
            : `Ещё ${hidden.length} ${pluralForm(hidden.length, CATEGORY_FORMS)} · ${formatMoney(hiddenSum)}`}
        </button>
      )}
    </Card>
  );
}
