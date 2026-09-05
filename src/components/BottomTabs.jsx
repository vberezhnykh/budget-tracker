import { PEEK_HEIGHT } from './TransactionsDrawer';

// Height of the bar itself, exported so App can reserve the matching amount
// of bottom padding on <main> - the bar is fixed, so it doesn't take part in
// normal flow and would otherwise cover the end of the page.
export const TAB_BAR_HEIGHT = 56;
const GAP_ABOVE_DRAWER = 10;

// Vertical space the bar occupies above the drawer's peek strip, i.e. how
// much room the scrolling content has to leave free below itself.
export const TAB_BAR_RESERVED_HEIGHT = TAB_BAR_HEIGHT + GAP_ABOVE_DRAWER;

const TABS = [
  { id: 'stats', icon: '🏠', label: 'Главная' },
  { id: 'analytics', icon: '📊', label: 'Аналитика' },
  { id: 'payments', icon: '🗓️', label: 'Платежи' },
];

// Main-screen navigation, sitting directly above the transactions drawer's
// peek strip. Deliberately below the drawer's own z-index (900) so an
// expanded drawer covers it rather than leaving a floating bar on top of
// the sheet.
export default function BottomTabs({ active, onChange }) {
  return (
    <nav
      aria-label="Основная навигация"
      style={{
        // Opaque rather than the translucent .glass-panel used elsewhere:
        // the bar floats over the scrolling page, and page text showing
        // through it made both unreadable.
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border-subtle)',
        boxShadow: '0 6px 20px -6px rgba(0, 0, 0, 0.18)',
        position: 'fixed',
        bottom: `${PEEK_HEIGHT + GAP_ABOVE_DRAWER}px`,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 800,
        width: 'calc(100% - 40px)',
        maxWidth: '420px',
        boxSizing: 'border-box',
        height: `${TAB_BAR_HEIGHT}px`,
        display: 'flex',
        alignItems: 'stretch',
        gap: '4px',
        padding: '5px',
        borderRadius: 'var(--radius-lg)',
      }}
    >
      {TABS.map(tab => {
        const isActive = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            aria-current={isActive ? 'page' : undefined}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '3px',
              border: 'none',
              // На ступень меньше внешнего --radius-lg: кнопка лежит внутри
              // контейнера с отступом 5px, и вложенный угол должен быть
              // меньше внешнего примерно на этот отступ - иначе выглядит
              // толще родителя.
              borderRadius: 'var(--radius-md)',
              background: isActive ? 'rgba(37, 99, 235, 0.1)' : 'transparent',
              color: isActive ? 'var(--color-primary)' : 'var(--color-text-muted)',
              fontSize: 'var(--text-xs)',
              fontWeight: isActive ? '700' : '600',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
          >
            <span aria-hidden="true" style={{ fontSize: 'var(--text-2xl)', lineHeight: 1 }}>{tab.icon}</span>
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
