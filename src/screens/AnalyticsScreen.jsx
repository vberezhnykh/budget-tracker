import AnalyticsView from '../components/AnalyticsView';
import SummaryFrame from './SummaryFrame';

// Вкладка «Аналитика»: тот же период, что и на Обзоре (periodStats), поэтому
// переключение вкладок никогда не меняет диапазон молча. AnalyticsView сам
// рисует пустое состояние для периода без трат - вкладка, которая может
// стать пустой, выглядела бы сломанной.
//
// Счёт для расчёта берётся тот, что выбран на Обзоре: переключателя счетов
// здесь нет, он остаётся в шапке Обзора.
export default function AnalyticsScreen({ summaryFrame, ...analyticsProps }) {
  return (
    <SummaryFrame {...summaryFrame} skeleton={{ monthly: analyticsProps.timeRange === 'month', analytics: true }}>
      <AnalyticsView {...analyticsProps} />
    </SummaryFrame>
  );
}
