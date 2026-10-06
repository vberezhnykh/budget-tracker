import TransactionList from './TransactionList';
import PeriodPicker from './PeriodPicker';
import { formatPeriodLabel } from '../utils/period';

export default function HistoryTimeline({ groups, initialMonth, onSelectMonth, searching, ...listProps }) {
  const months = {};
  for (const [date, group] of Object.entries(groups || {})) {
    const month = date.slice(0, 7);
    months[month] ||= {};
    months[month][date] = group;
  }
  // Keep an empty destination visible instead of silently landing in another month.
  if (!searching && initialMonth) months[initialMonth] ||= {};
  if (!Object.keys(months).length) return <TransactionList groups={{}} {...listProps} />;

  return Object.keys(months).sort().reverse().map(month => (
    <section key={month} data-history-month={month} aria-label={formatPeriodLabel('month', month)}>
      <div data-testid="history-month-heading" style={{ position: 'sticky', top: 0, zIndex: 2,
        padding: 'var(--space-2) var(--space-6)', background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
        {searching || !onSelectMonth
          ? <h4 style={{ margin: 0, padding: 'var(--space-3) 0' }}>{formatPeriodLabel('month', month)}</h4>
          : <PeriodPicker monthsOnly timeRange="month" selectedMonth={month}
            onChange={({ selectedMonth }) => onSelectMonth(selectedMonth)} />}
      </div>
      <TransactionList {...listProps} groups={months[month]}
        emptyText={searching ? 'Ничего не найдено' : 'В этом месяце нет операций'} />
    </section>
  ));
}
