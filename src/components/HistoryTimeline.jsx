import { Calendar } from 'lucide-react';
import Button from './ui/Button';
import TransactionList from './TransactionList';
import PeriodPicker from './PeriodPicker';
import { formatPeriodLabel } from '../utils/period';

export default function HistoryTimeline({ groups, initialMonth, onSelectMonth, searching, onResetFilters, ...listProps }) {
  // Пустой месяц: тихая строка с календарём; если включены фильтры, под ней
  // кнопка, которая их снимает (onResetFilters передаётся только тогда).
  const emptyProps = {
    emptyIcon: <Calendar size={20} strokeWidth={1.8} aria-hidden="true" />,
    emptyAction: onResetFilters && <Button tone="text" size="sm" onClick={onResetFilters}>Сбросить фильтры</Button>,
  };
  const months = {};
  for (const [date, group] of Object.entries(groups || {})) {
    const month = date.slice(0, 7);
    months[month] ||= {};
    months[month][date] = group;
  }
  // Keep an empty destination visible instead of silently landing in another month.
  if (!searching && initialMonth) months[initialMonth] ||= {};
  if (!Object.keys(months).length) return <TransactionList groups={{}} {...emptyProps} {...listProps} />;

  return Object.keys(months).sort().reverse().map(month => (
    <section key={month} data-history-month={month} aria-label={formatPeriodLabel('month', month)} style={{ marginBottom: 'var(--space-4)' }}>
      {/* Заголовок месяца - просто полоса цвета страницы: белых карточек
          дней под ним достаточно, чтобы месяц читался отдельной группой.
          Фон нужен, чтобы дни, уезжающие под липкий заголовок, не просвечивали. */}
      <div data-testid="history-month-heading" style={{ position: 'sticky', top: 0, zIndex: 2,
        padding: 'var(--space-2) 0', marginBottom: 'var(--space-2)', background: 'var(--color-bg)' }}>
        {searching || !onSelectMonth
          ? <h4 style={{ margin: 0, padding: 'var(--space-3) 0' }}>{formatPeriodLabel('month', month)}</h4>
          : <PeriodPicker monthsOnly timeRange="month" selectedMonth={month}
            onChange={({ selectedMonth }) => onSelectMonth(selectedMonth)} />}
      </div>
      <TransactionList {...listProps} {...emptyProps} groups={months[month]}
        emptyText={searching ? 'Ничего не найдено' : 'В этом месяце нет операций'} />
    </section>
  ));
}
