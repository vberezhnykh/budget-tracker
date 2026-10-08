import Card from './ui/Card';
import PaceChart from './PaceChart';
import { formatMoney } from '../utils/money';
import { formatDayMonth, formatMonthName } from '../utils/period';
import { formatRemainingSpan, getForecastVerdict } from '../utils/latePlaque';

// Карточка «Темп трат»: график, две плитки «обычно» против «сейчас» и, для
// идущего месяца, прогноз на конец месяца с пояснением. Все цифры берутся из
// typicalMonth (server/typicalMonth.js) - своих расчётов здесь нет, кроме
// разности двух готовых чисел.

const SECTION_TITLE_STYLE = {
  margin: 0,
  fontSize: 'var(--text-xl)',
  fontWeight: 'var(--weight-strong)',
};

// Разница меньше евро - «как обычно»: «на €0,40 меньше» читается как
// отклонение, которого нет.
const SAME_THRESHOLD = 1;

// «из 31 дня» / «из 30 дней»: после «из» родительный падеж, и у 31 он
// единственного числа.
const daysWord = (count) => (count % 10 === 1 && count % 100 !== 11 ? 'дня' : 'дней');

function Tile({ label, value, note }) {
  return (
    <div style={{ minWidth: 0, padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface-muted)' }}>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>{label}</div>
      <div data-account-value style={{ marginTop: 'var(--space-1)', fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-strong)', fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
      {note && (
        <div data-account-value style={{ marginTop: 'var(--space-0-5)', fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-label)', color: note.color }}>
          {note.text}
        </div>
      )}
    </div>
  );
}

// Третья строка плитки «Сейчас»: тратите меньше обычного - хорошо.
function compareNote(actual, typical) {
  const diff = actual - typical;
  if (Math.abs(diff) < SAME_THRESHOLD) return { text: 'как обычно', color: 'var(--color-text-muted)' };
  return diff < 0
    ? { text: `на ${formatMoney(-diff)} меньше`, color: 'var(--color-positive)' }
    : { text: `на ${formatMoney(diff)} больше`, color: 'var(--color-negative)' };
}

// «апрель — сентябрь 2026» или «ноябрь 2025 — апрель 2026», если годы разные.
function formatReferenceRange(months) {
  const oldest = months[months.length - 1];
  const newest = months[0];
  const name = (month) => formatMonthName(month).toLowerCase();
  const [oldYear] = oldest.split('-');
  const [newYear] = newest.split('-');
  if (oldYear === newYear) return months.length === 1 ? `${name(newest)} ${newYear}` : `${name(oldest)} — ${name(newest)} ${newYear}`;
  return `${name(oldest)} ${oldYear} — ${name(newest)} ${newYear}`;
}

export default function PaceCard({ typicalMonth, selectedMonth, monthlyLimit }) {
  const { byDay, months, monthTotal, actualByDay = [], today } = typicalMonth;
  const lastDay = byDay.length;

  const actualNow = today ? today.spent : (actualByDay[actualByDay.length - 1] ?? 0);
  const typicalNow = today ? today.typicalToDate : monthTotal;

  const forecastVerdict = today
    ? getForecastVerdict({
        forecast: today.forecast,
        limit: monthlyLimit,
        spent: today.spent,
        // В последний день пояснения про остаток нет - связывать «Если так и
        // будет» не с чем.
        conditional: today.day < lastDay,
      })
    : null;

  // Пояснение к прогнозу: сколько обычно уходит до конца месяца и что это
  // значит для лимита. Пустое, если нечего сказать (последний день, лимита нет).
  const explanation = today
    ? [
        today.day < lastDay
          ? formatRemainingSpan({ day: today.day, lastDay, typicalRemaining: today.typicalRemaining, verb: 'вы обычно тратите' })
          : null,
        forecastVerdict?.text,
      ].filter(Boolean).join(' ')
    : '';

  return (
    <Card as="section" padding="lg">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
        <h2 style={SECTION_TITLE_STYLE}>Темп трат</h2>
        {today && (
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
            {today.day} из {lastDay} {daysWord(lastDay)}
          </span>
        )}
      </div>

      <PaceChart typicalMonth={typicalMonth} selectedMonth={selectedMonth} limit={monthlyLimit} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
        <Tile
          label={today ? `Обычно к ${formatDayMonth(selectedMonth, today.day)}` : 'Обычно за месяц'}
          value={formatMoney(typicalNow)}
        />
        <Tile
          label={today ? 'Сейчас' : 'Факт'}
          value={formatMoney(actualNow)}
          note={compareNote(actualNow, typicalNow)}
        />
      </div>

      {today && (
        <div style={{ marginTop: 'var(--space-4)', paddingTop: 'var(--space-4)', borderTop: '1px solid var(--color-border-subtle)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
            <span style={{ fontSize: 'var(--text-base)', color: 'var(--color-text-muted)' }}>
              Прогноз на {formatDayMonth(selectedMonth, lastDay)}
            </span>
            <strong data-account-value style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-strong)', whiteSpace: 'nowrap' }}>
              ≈ {formatMoney(today.forecast, { whole: true })}
            </strong>
          </div>
          {explanation && (
            <p data-account-value style={{ margin: 'var(--space-2) 0 0', fontSize: 'var(--text-sm)', lineHeight: 1.5, color: 'var(--color-text-muted)' }}>
              {explanation}
            </p>
          )}
        </div>
      )}

      <p style={{ margin: 'var(--space-3) 0 0', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
        «Обычно» — медиана по {months.length} прошлым месяцам, {formatReferenceRange(months)}
      </p>
    </Card>
  );
}
