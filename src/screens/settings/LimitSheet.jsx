import { useState } from 'react'
import { X } from 'lucide-react'
import Sheet from '../../components/ui/Sheet'
import IconButton from '../../components/ui/IconButton'
import Button from '../../components/ui/Button'
import Field, { FormLabel } from '../../components/ui/Field'
import { formatMoney } from '../../utils/money'
import { pluralForm } from '../../utils/plural'
import { limitInsight } from './limitInsight'

// Шаг быстрых сумм под полем: лимиты обычно круглые.
const PRESET_STEP = 500;
// Высота области столбиков графика.
const CHART_HEIGHT = 96;

// Лист «Лимит трат в месяц». Разбор значения повторяет проверку сервера
// (PUT /api/settings в server/app.js): лимит - конечное строго положительное
// число. Иначе в полосе лимита на Обзоре появились бы NaN%/Infinity%.
const parseLimit = (text) => {
  if (String(text).trim() === '') return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

function LimitHistory({ insight, limit }) {
  const { months, median, exceeded, total } = insight;
  const maxExpense = Math.max(...months.map((m) => Number(m.expense) || 0));
  // Высоты считаются от большего из расходов и набранного лимита, чтобы
  // пунктир лимита всегда помещался в график.
  const scale = Math.max(maxExpense, limit ?? 0);
  const percent = (value) => (scale > 0 ? Math.min(100, Math.max(0, (value / scale) * 100)) : 0);

  return (
    <section
      aria-label="За последние 6 месяцев"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3)',
        padding: 'var(--space-4)',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--color-surface-muted)',
      }}
    >
      <h3 style={{ margin: 0, fontSize: 'var(--text-base)', fontWeight: 'var(--weight-strong)', color: 'var(--color-text-muted)' }}>
        За последние 6 месяцев
      </h3>

      <div
        role="img"
        aria-label="Расход по месяцам относительно лимита"
        data-testid="limit-chart"
        style={{ position: 'relative', display: 'flex', gap: 'var(--space-2)' }}
      >
        {months.map((item) => {
          const expense = Number(item.expense) || 0;
          const over = limit != null && expense > limit;
          return (
            <div key={item.month} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
              <div style={{ height: `${CHART_HEIGHT}px`, display: 'flex', alignItems: 'flex-end' }}>
                <div
                  data-over={over ? 'true' : 'false'}
                  title={`${item.label}: ${formatMoney(expense, { whole: true })}`}
                  style={{
                    width: '100%',
                    height: `${percent(expense)}%`,
                    minHeight: expense > 0 ? '2px' : 0,
                    borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0',
                    background: over ? 'var(--color-negative)' : 'var(--color-control-off)',
                  }}
                />
              </div>
              <div style={{ textAlign: 'center', fontSize: 'var(--text-2xs)', color: 'var(--color-text-muted)' }}>
                {item.label}
              </div>
            </div>
          );
        })}
        {limit != null && (
          // Пунктир лимита поверх столбиков; низ области - нулевая отметка.
          <div
            data-testid="limit-line"
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: `${CHART_HEIGHT * (1 - percent(limit) / 100)}px`,
              borderTop: '2px dashed var(--color-negative)',
              pointerEvents: 'none',
            }}
          />
        )}
      </div>

      <p style={{ margin: 0, fontSize: 'var(--text-base)', color: 'var(--color-text-main)' }}>
        Обычно уходит {formatMoney(median, { whole: true })} в месяц.
        {limit != null && exceeded != null && (
          <> С лимитом {formatMoney(limit, { whole: true })} превышение было бы в {exceeded} {pluralForm(exceeded, ['месяце', 'месяцах', 'месяцах'])} из {total}.</>
        )}
      </p>
    </section>
  );
}

// Лист лимита: крупная сумма, быстрые значения, график за полгода и
// сохранение. Закрывается сам только когда onSave вернул true; при отказе
// сервера остаётся открытым с введённым числом.
export default function LimitSheet({ monthlyLimit, series = [], currentMonth, onClose, onSave }) {
  const [input, setInput] = useState(String(monthlyLimit ?? ''));
  const [saving, setSaving] = useState(false);

  const limit = parseLimit(input);
  const invalid = limit == null;
  const unchanged = limit === Number(monthlyLimit);

  // Быстрые значения вокруг текущего лимита, округлённого до 500.
  const base = Math.round((Number(monthlyLimit) || 0) / PRESET_STEP) * PRESET_STEP;
  const presets = [base - PRESET_STEP, base, base + PRESET_STEP].filter((value) => value > 0);

  const insight = limitInsight(series, currentMonth, limit);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (invalid || unchanged || saving) return;
    setSaving(true);
    try {
      const ok = await onSave(limit);
      if (ok) onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet ariaLabel="Лимит трат в месяц" onClose={onClose}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)' }}>
        <h2 style={{ fontSize: 'var(--text-3xl)', fontWeight: 'var(--weight-strong)', color: 'var(--color-text-main)', margin: 0 }}>
          Лимит трат в месяц
        </h2>
        <IconButton tone="neutral" round size={44} onClick={onClose} aria-label="Закрыть">
          <X size={18} strokeWidth={1.8} aria-hidden="true" />
        </IconButton>
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <div style={{ textAlign: 'center' }}>
          <FormLabel htmlFor="limit-amount" style={{ textAlign: 'center' }}>Сумма лимита в евро</FormLabel>
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'baseline', gap: 'var(--space-1)' }}>
            <span
              aria-hidden="true"
              style={{ color: 'var(--color-text-muted)', fontSize: '2rem', fontWeight: 'var(--weight-strong)', lineHeight: 1.2 }}
            >€</span>
            <Field
              id="limit-amount"
              type="number"
              inputMode="decimal"
              step="0.01"
              placeholder="0"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              aria-invalid={invalid}
              style={{
                width: `${Math.max(input.length, 1) + 1}ch`,
                minWidth: '3ch',
                maxWidth: 'calc(100% - 3rem)',
                padding: 0,
                border: 'none',
                background: 'transparent',
                textAlign: 'center',
                fontSize: '3rem',
                fontWeight: 'var(--weight-strong)',
                letterSpacing: '-1.5px',
                lineHeight: 1.2,
              }}
            />
          </div>
          {invalid && (
            <div role="alert" style={{ marginTop: 'var(--space-1)', fontSize: 'var(--text-sm)', color: 'var(--color-danger)' }}>
              Введите положительное число
            </div>
          )}
        </div>

        {presets.length > 0 && (
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            {presets.map((value) => {
              const active = limit === value;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setInput(String(value))}
                  style={{
                    flex: 1,
                    minHeight: '44px',
                    border: 'none',
                    borderRadius: 'var(--radius-md)',
                    background: active ? 'var(--color-primary-tint)' : 'var(--color-surface-inset)',
                    color: active ? 'var(--color-primary)' : 'var(--color-text-main)',
                    fontFamily: 'inherit',
                    fontSize: 'var(--text-md)',
                    fontWeight: 'var(--weight-label)',
                    cursor: 'pointer',
                  }}
                >
                  {formatMoney(value, { whole: true })}
                </button>
              );
            })}
          </div>
        )}

        {insight.total > 0 && <LimitHistory insight={insight} limit={limit} />}

        <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
          Лимит один на все месяцы и общий для всех устройств.
        </p>

        <Button type="submit" block disabled={invalid || unchanged || saving}>
          {saving ? 'Сохранение...' : 'Сохранить'}
        </Button>
      </form>
    </Sheet>
  );
}
