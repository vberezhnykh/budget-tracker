import './Skeleton.css';
import Card from './Card';
import { NAV_OFFSET } from '../BottomNav';

function Skeleton({ width = '100%', height = 16, className = '' }) {
  return <div aria-hidden="true" className={`skeleton ${className}`} style={{ width, height }} />;
}

function LoadingSkeleton({ label, className = '', children }) {
  return <div role="status" aria-label={label} className={`loading-skeleton ${className}`}>
    <span className="skeleton-label">{label}</span>
    <div aria-hidden="true">{children}</div>
  </div>;
}

// Строки списка: плитка 40px, две строки текста и сумма. Общие для
// ListSkeleton и для скелета запуска.
function SkeletonRows({ rows, amounts }) {
  return Array.from({ length: rows }, (_, index) => <div className="skeleton-row" key={index}>
    <Skeleton width={40} height={40} className="skeleton-avatar" />
    <div className="skeleton-row-copy"><Skeleton width={`${72 - index % 3 * 12}%`} /><Skeleton width="42%" height={11} /></div>
    {amounts && <Skeleton width={66} height={18} />}
  </div>);
}

export function ListSkeleton({ label, rows = 3, amounts = true }) {
  return <LoadingSkeleton label={label}>
    <SkeletonRows rows={rows} amounts={amounts} />
  </LoadingSkeleton>;
}

export function SummarySkeleton({ monthly = true, limitBar = true, analytics = false }) {
  const withLimitBar = monthly && limitBar && !analytics;
  return <LoadingSkeleton label="Загрузка итогов…" className={monthly && !analytics ? 'skeleton-month' : ''}>
    <Card padding="lg" className="skeleton-summary">
      {!withLimitBar && <Skeleton width={112} height={12} />}
      {analytics ? <div className="skeleton-rows">{[0, 1, 2].map(key => <div key={key} className="skeleton-limit-row"><Skeleton width={70} height={14} /><Skeleton width={110} height={22} /></div>)}</div>
        : withLimitBar ? <div className="skeleton-limit">
          <Skeleton width={56} height={12} />
          <Skeleton width={150} height={40} />
          <Skeleton width="100%" height={8} />
          <div className="skeleton-limit-row"><Skeleton width={120} height={12} /><Skeleton width={90} height={12} /></div>
        </div>
          : <Skeleton width={150} height={48} />}
      {!analytics && <div className="skeleton-columns"><Skeleton height={64} /><Skeleton height={64} /></div>}
    </Card>
    {analytics && <Card padding="lg" className="skeleton-summary skeleton-chart">
      <Skeleton width={140} height={16} />
      <div className="skeleton-bars">{[45, 72, 58, 86, 62, 100].map((height, index) => <Skeleton key={index} height={`${height}%`} />)}</div>
      <Skeleton width="70%" height={12} />
    </Card>}
  </LoadingSkeleton>;
}

// Скелет запуска повторяет вкладку «Обзор» (OverviewScreen): шапка с периодом,
// главная карточка, лента счетов и последние операции - в тех же размерах и с
// теми же отступами, чтобы при появлении данных ничего не прыгало.
// Нижней панели во время загрузки нет (App отдаёт AppSkeleton вместо всего
// экрана), поэтому на её месте стоит статичная полоса той же высоты.
export function AppSkeleton() {
  return <div className="layout-container skeleton-app" aria-busy="true" style={{ paddingBottom: `calc(${NAV_OFFSET} + var(--space-4))` }}>
    <LoadingSkeleton label="Загрузка приложения…">
      <div className="skeleton-app-header"><Skeleton width={140} height={28} /><Skeleton width={110} height={14} /></div>

      <Card padding="none" className="skeleton-hero" style={{ padding: 'var(--space-5)' }}>
        <div className="skeleton-hero-main">
          <Skeleton width={150} height={17} />
          <Skeleton width={180} height={40} />
        </div>
        <div>
          <Skeleton width="100%" height={10} className="skeleton-pill" />
          <div className="skeleton-limit-row skeleton-hero-bar-line"><Skeleton width={120} height={17} /><Skeleton width={36} height={17} /></div>
        </div>
        <div className="skeleton-hero-columns">
          {[0, 1].map(key => <div key={key} className="skeleton-hero-column"><Skeleton width={44} height={14} /><Skeleton width={96} height={23} /></div>)}
        </div>
      </Card>

      <section className="skeleton-section skeleton-section-accounts">
        <div className="skeleton-section-header"><Skeleton width={72} height={18} /><Skeleton width={76} height={14} /></div>
        <div className="skeleton-strip">
          {[0, 1, 2].map(key => <div key={key} className="skeleton-chip">
            <Skeleton width={32} height={32} />
            <Skeleton width={64} height={16} />
            <Skeleton width={92} height={21} />
          </div>)}
        </div>
      </section>

      <section className="skeleton-section">
        <div className="skeleton-section-header"><Skeleton width={152} height={18} /><Skeleton width={82} height={14} /></div>
        <Card padding="none" className="skeleton-recent" style={{ padding: 'var(--space-3) var(--space-4)', overflow: 'hidden' }}><SkeletonRows rows={3} amounts /></Card>
      </section>
    </LoadingSkeleton>
    {/* Заглушка нижней панели: статичная, без пульсации, и скрыта от чтения. */}
    <div aria-hidden="true" className="skeleton-nav" style={{ height: NAV_OFFSET }} />
  </div>;
}
