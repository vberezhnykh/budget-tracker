import Card from '../components/ui/Card';
import { SummarySkeleton } from '../components/ui/Skeleton';

// Общая обёртка сводки Обзора и Аналитики. Состояние ожидания (размытие,
// inert, aria-busy), скелетон до первых данных и сообщение «Итоги
// недоступны» одинаковы на обоих экранах, поэтому живут в одном месте, а не
// копируются.
//
// frameRef нужен App: через него карусель счетов выставляет --swipe-blur во
// время свайпа. pending/ready считает App - от них зависят и другие части
// экрана, а не только эта обёртка.
export default function SummaryFrame({ frameRef, pending, ready, syncWarning, isRefreshing, skeleton, children }) {
  return (
    <div
      ref={frameRef}
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
      {/* Keep the carousel mounted so loading never resets its scroll position. */}
      <div aria-hidden={!ready || undefined} style={{ gridArea: '1 / 1', minWidth: 0, visibility: ready ? 'visible' : 'hidden' }}>
        {children}
      </div>
    </div>
  );
}
