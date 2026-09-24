import './Skeleton.css';

export function Skeleton({ width = '100%', height = 16, className = '' }) {
  return <div aria-hidden="true" className={`skeleton ${className}`} style={{ width, height }} />;
}

export function LoadingSkeleton({ label, className = '', children }) {
  return <div role="status" aria-label={label} className={`loading-skeleton ${className}`}>
    <span className="skeleton-label">{label}</span>
    <div aria-hidden="true">{children}</div>
  </div>;
}

export function ListSkeleton({ label, rows = 3, amounts = true }) {
  return <LoadingSkeleton label={label}>
    {Array.from({ length: rows }, (_, index) => <div className="skeleton-row" key={index}>
      <Skeleton width={40} height={40} className="skeleton-avatar" />
      <div className="skeleton-row-copy"><Skeleton width={`${72 - index % 3 * 12}%`} /><Skeleton width="42%" height={11} /></div>
      {amounts && <Skeleton width={66} height={18} />}
    </div>)}
  </LoadingSkeleton>;
}

export function SummarySkeleton({ monthly = true, ring = true, analytics = false }) {
  return <LoadingSkeleton label="Загрузка итогов…" className={monthly && !analytics ? 'skeleton-month' : ''}>
    <div className="glass-panel skeleton-summary">
      <Skeleton width={112} height={12} />
      {analytics ? <div className="skeleton-columns"><Skeleton height={64} /><Skeleton height={64} /><Skeleton height={64} /></div>
        : monthly && ring ? <div className="skeleton-ring"><Skeleton width={94} height={28} /><Skeleton width={62} height={12} /></div>
          : <Skeleton width={150} height={48} />}
      {!analytics && <div className="skeleton-columns"><Skeleton height={64} /><Skeleton height={64} /></div>}
    </div>
    {analytics && <div className="glass-panel skeleton-summary skeleton-chart">
      <Skeleton width={140} height={16} />
      <div className="skeleton-bars">{[45, 72, 58, 86, 62, 100].map((height, index) => <Skeleton key={index} height={`${height}%`} />)}</div>
      <Skeleton width="70%" height={12} />
    </div>}
  </LoadingSkeleton>;
}

export function AppSkeleton() {
  return <div className="layout-container" aria-busy="true">
    <LoadingSkeleton label="Загрузка приложения…">
      <div className="glass-panel skeleton-header">
        <div className="skeleton-brand"><Skeleton width={190} height={30} /><Skeleton width={150} height={10} /></div>
        <div className="skeleton-account"><Skeleton width={110} height={12} /><Skeleton width={180} height={36} /></div>
        <div className="skeleton-dots">{[0, 1, 2].map(key => <Skeleton key={key} width={8} height={8} />)}</div>
      </div>
      <div className="skeleton-columns skeleton-actions"><Skeleton height={44} /><Skeleton height={44} /><Skeleton height={44} /></div>
      <div className="skeleton-period"><Skeleton width={150} height={36} /></div>
    </LoadingSkeleton>
    <SummarySkeleton />
  </div>;
}
