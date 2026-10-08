import Button from './ui/Button';
import Card from './ui/Card';
import { getPreviousMonth, isMonthInHistory, monthLocative, monthNominative } from '../utils/monthNames';

// Карточка «Категории» для месяца без расходов: тот же заголовок, что у
// CategoryBars, две пустые дорожки вместо полос, пояснение и ссылка на
// прошлый месяц. Дорожки - только намёк на вид будущего списка, поэтому для
// читалки скрыты.
//
// Ссылки нет без onSelectMonth и для первого месяца истории: раньше него
// смотреть нечего.

const PLACEHOLDER_WIDTHS = ['100%', '100%'];

export default function CategoryBarsEmpty({ selectedMonth, onSelectMonth }) {
  const prevMonth = getPreviousMonth(selectedMonth);
  const canOpenPrevious = Boolean(onSelectMonth) && isMonthInHistory(prevMonth);

  return (
    <Card as="section" padding="lg">
      <h2 style={{ margin: 0, marginBottom: 'var(--space-3)', fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-strong)' }}>Категории</h2>
      <div aria-hidden="true" data-testid="category-placeholder" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {PLACEHOLDER_WIDTHS.map((width, index) => (
          <div key={index} style={{ width, height: 8, borderRadius: 'var(--radius-pill)', background: 'var(--color-surface-sunken)' }} />
        ))}
      </div>
      <p style={{ margin: 'var(--space-4) 0 0', fontSize: 'var(--text-base)', lineHeight: 1.5, color: 'var(--color-text-muted)' }}>
        Распределение по категориям появится, когда {monthLocative(selectedMonth)} будут расходы.
      </p>
      {canOpenPrevious && (
        <Button
          tone="text"
          onClick={() => onSelectMonth(prevMonth)}
          style={{ marginTop: 'var(--space-2)', minHeight: '44px', fontSize: 'var(--text-base)', fontWeight: 'var(--weight-label)' }}
        >
          Посмотреть {monthNominative(prevMonth)}
        </Button>
      )}
    </Card>
  );
}
