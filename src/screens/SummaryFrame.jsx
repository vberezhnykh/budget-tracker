import Card from '../components/ui/Card';
import { SummarySkeleton } from '../components/ui/Skeleton';

// Общая обёртка сводки Обзора и Аналитики. Состояние ожидания (размытие,
// inert, aria-busy), скелетон до первых данных и сообщение «Итоги
// недоступны» одинаковы на обоих экранах, поэтому живут в одном месте, а не
// копируются.
//
// pending/ready считает App - от них зависят и другие части экрана, а не
// только эта обёртка. Пока pending, цифры внутри (data-account-value) размыты
// фиксированно.
export default function SummaryFrame({ pending, ready, syncWarning, isRefreshing, skeleton, children }) {
  return (
    <div
      data-testid="account-summary"
      className={pending ? 'account-summary account-summary--pending' : 'account-summary'}
      aria-busy={pending}
      inert={pending}
      style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', marginBottom: 'var(--space-6)' }}
    >
      {!ready && <div style={{ gridArea: '1 / 1', minWidth: 0 }}>
        {syncWarning && !isRefreshing
          ? <Card padding="lg" style={{ color: 'var(--color-text-muted)' }}>Итоги недоступны. Повторите загрузку кнопкой выше.</Card>
          : <SummarySkeleton {...skeleton} />}
      </div>}
      {/* Содержимое остаётся в дереве и пока данных нет: загрузка не должна
          сбрасывать состояние внутри (прокрутку, открытый лист периода). */}
      <div aria-hidden={!ready || undefined} style={{ gridArea: '1 / 1', minWidth: 0, visibility: ready ? 'visible' : 'hidden' }}>
        {children}
      </div>
    </div>
  );
}
