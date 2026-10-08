import AnalyticsView from '../components/AnalyticsView';
import PeriodPicker from '../components/PeriodPicker';
import ScreenHeader from '../components/ui/ScreenHeader';
import SummaryFrame from './SummaryFrame';

// Вкладка «Аналитика»: тот же период, что и на Обзоре (periodStats), поэтому
// переключение вкладок никогда не меняет диапазон молча. Заголовок с выбором
// периода стоит вне SummaryFrame: пока цифры грузятся, обёртка недоступна для
// нажатий, а период менять нужно и тогда - и в пустом месяце тоже.
//
// Счёт для расчёта берётся тот, что выбран на Обзоре: переключателя счетов
// здесь нет, он остаётся в шапке Обзора.
export default function AnalyticsScreen({ summaryFrame, ...analyticsProps }) {
  const { timeRange, selectedMonth, onChangePeriod } = analyticsProps;
  return (
    <>
      <div style={{ marginBottom: 'var(--space-3)' }}>
        <ScreenHeader
          title="Аналитика"
          actions={<PeriodPicker tone="dark" timeRange={timeRange} selectedMonth={selectedMonth} onChange={onChangePeriod} />}
        />
      </div>
      <SummaryFrame {...summaryFrame} skeleton={{ monthly: timeRange === 'month', analytics: true }}>
        <AnalyticsView {...analyticsProps} />
      </SummaryFrame>
    </>
  );
}
