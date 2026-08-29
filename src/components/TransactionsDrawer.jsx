import { useRef } from 'react';
import TransactionList from './TransactionList'
import Field from './ui/Field'
import Chip from './ui/Chip'

// Bottom-sheet chrome (CoinKeeper-style) wrapping the transaction history.
// Geometry:
// - Root sheet is 88vh tall, fixed to the bottom edge.
// - Collapsed state leaves a PEEK_HEIGHT "peek" strip visible by
//   translating the sheet down by (88vh - PEEK_HEIGHT).
// - That peek strip is split into two parts, stacked vertically:
//   - HANDLE_HEIGHT: the interactive grabber strip (drag/tap to expand).
//   - EDGE_GUARD: a non-interactive strip below it, flush with the bottom
//     edge. On iOS, a swipe starting at the very bottom edge is the
//     system app-switcher gesture - if our draggable handle reached all
//     the way down, that system swipe would also land on it and open the
//     drawer unintentionally. The guard keeps the handle clear of that
//     zone without moving the sheet itself off the bottom edge.
// - Expanded state is translateY(0).
export const HANDLE_HEIGHT = 72;
export const EDGE_GUARD = 34;
export const PEEK_HEIGHT = HANDLE_HEIGHT + EDGE_GUARD;
const SNAP_TRANSITION = 'transform 0.28s ease';
const TAP_MAX_MOVEMENT = 8; // px
const TAP_MAX_DURATION = 250; // ms
const DRAG_COMMIT_RATIO = 0.25; // fraction of total travel
const DRAG_COMMIT_VELOCITY = 0.5; // px/ms

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export default function TransactionsDrawer({
  expanded,
  setExpanded,
  title,
  searchQuery,
  setSearchQuery,
  searchResults,
  periodData,
  categories,
  selectedCategory,
  selectedType,
  selectedAccount,
  toggleCategoryFilter,
  setSelectedAccount,
  setSelectedType,
  setSelectedCategory,
  exportToCSV,
  openEditModal,
  getAccountDisplay,
  formatDate,
  getAccountFilterLabel,
}) {
  const sheetRef = useRef(null);
  const dragRef = useRef(null);

  // Travel distance (px) between the collapsed and expanded positions.
  // Measured from the sheet's own rendered height rather than derived from
  // window.innerHeight, because on iOS Safari those two disagree: the CSS
  // `88vh` resolves against the large viewport (URL bar hidden), while
  // window.innerHeight reports the current, possibly-smaller visual
  // viewport (URL bar visible). Deriving travel from innerHeight would then
  // under-translate the sheet when collapsing, leaving the peek strip
  // taller than PEEK_HEIGHT. offsetHeight reflects however `88vh` actually
  // resolved in this browser at this moment, so it can never disagree with
  // the CSS transform used for the non-dragging case.
  const getTravel = () => {
    const sheetHeight = sheetRef.current?.offsetHeight ?? 0;
    return Math.max(0, sheetHeight - PEEK_HEIGHT);
  };

  const applyTransform = (translateY) => {
    if (sheetRef.current) sheetRef.current.style.transform = `translateY(${translateY}px)`;
  };

  const setTransition = (value) => {
    if (sheetRef.current) sheetRef.current.style.transition = value;
  };

  const commitExpanded = (nextExpanded, travel) => {
    applyTransform(nextExpanded ? 0 : travel);
    setExpanded(nextExpanded);
  };

  const handlePointerDown = (e) => {
    const target = e.currentTarget;
    if (typeof target.setPointerCapture === 'function') {
      try {
        target.setPointerCapture(e.pointerId);
      } catch {
        // jsdom / unsupported environments - ignore, drag still works via
        // direct listeners on this element.
      }
    }
    const travel = getTravel();
    dragRef.current = {
      pointerId: e.pointerId,
      startY: e.clientY,
      startTime: now(),
      baseline: expanded ? 0 : travel,
      travel,
      moved: false,
      lastTranslate: expanded ? 0 : travel,
    };
    setTransition('none');
  };

  const handlePointerMove = (e) => {
    const drag = dragRef.current;
    if (!drag) return;
    const delta = e.clientY - drag.startY;
    if (Math.abs(delta) > TAP_MAX_MOVEMENT) drag.moved = true;
    const next = Math.min(drag.travel, Math.max(0, drag.baseline + delta));
    drag.lastTranslate = next;
    applyTransform(next);
  };

  const finishDrag = () => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    setTransition(SNAP_TRANSITION);

    const elapsed = Math.max(1, now() - drag.startTime);
    const isTap = !drag.moved && elapsed < TAP_MAX_DURATION;

    if (isTap) {
      commitExpanded(!expanded, drag.travel);
      return;
    }

    const traveled = drag.lastTranslate - drag.baseline;
    const ratio = drag.travel > 0 ? Math.abs(traveled) / drag.travel : 0;
    const velocity = Math.abs(traveled) / elapsed;
    const shouldCommit = ratio > DRAG_COMMIT_RATIO || velocity > DRAG_COMMIT_VELOCITY;

    // Commit to the direction of travel (moved up -> expand, moved down ->
    // collapse); otherwise spring back to the state the drag started from.
    const nextExpanded = shouldCommit ? traveled < 0 : expanded;
    commitExpanded(nextExpanded, drag.travel);
  };

  const handlePointerUp = () => finishDrag();
  const handlePointerCancel = () => finishDrag();

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setExpanded(!expanded);
    }
  };

  const handleBackdropClick = () => {
    if (expanded) setExpanded(false);
  };

  return (
    <>
      {/* Backdrop: only interactive (and visible) while the sheet is expanded,
          so it never eats taps on the page while collapsed. */}
      <div
        aria-hidden="true"
        data-testid="drawer-backdrop"
        onClick={handleBackdropClick}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 899,
          background: 'rgba(15, 23, 42, 0.4)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          opacity: expanded ? 1 : 0,
          transition: 'opacity 0.28s ease',
          pointerEvents: expanded ? 'auto' : 'none',
        }}
      />

      <div
        ref={sheetRef}
        data-testid="transactions-drawer"
        style={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 0,
          height: '88vh',
          zIndex: 900,
          background: 'var(--color-surface)',
          borderTopLeftRadius: '16px',
          borderTopRightRadius: '16px',
          boxShadow: '0 -10px 15px -3px rgba(0, 0, 0, 0.1), 0 -4px 6px -4px rgba(0, 0, 0, 0.1)',
          display: 'flex',
          flexDirection: 'column',
          transform: expanded ? 'translateY(0)' : `translateY(calc(88vh - ${PEEK_HEIGHT}px))`,
          transition: SNAP_TRANSITION,
        }}
      >
        {/* Drag handle - the ONLY element that receives the pointer
            gesture, so the list below remains scrollable. Stops
            HANDLE_HEIGHT above the bottom edge; the EDGE_GUARD strip
            below it is non-interactive. */}
        <div
          role="button"
          tabIndex={0}
          aria-expanded={expanded}
          aria-label={expanded ? 'Закрыть список операций' : 'Открыть список операций'}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onKeyDown={handleKeyDown}
          style={{
            flexShrink: 0,
            height: `${HANDLE_HEIGHT}px`,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            cursor: 'pointer',
            touchAction: 'none',
            userSelect: 'none',
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: '40px',
              height: '4px',
              borderRadius: '2px',
              background: 'var(--color-control-off)',
            }}
          />
          <span style={{ fontSize: 'var(--text-base)', fontWeight: '600', color: 'var(--color-text-muted)' }}>
            {title}
          </span>
          {/* Purely visual close/open affordance - the handle's role="button",
              aria-expanded and aria-label already carry the accessible state,
              so this is hidden from the accessibility tree. A CSS triangle
              pointing down at rest (expanded) and rotated to point up when
              collapsed, matching the direction the sheet will travel. */}
          <span
            aria-hidden="true"
            style={{
              width: 0,
              height: 0,
              borderLeft: '5px solid transparent',
              borderRight: '5px solid transparent',
              borderTop: '5px solid var(--color-text-muted)',
              transform: expanded ? 'rotate(0deg)' : 'rotate(180deg)',
              transition: 'transform 0.2s ease',
            }}
          />
        </div>

        {/* Dead strip flush with the bottom edge - keeps the interactive
            handle above it, so a swipe starting at the very bottom edge
            (the iOS system gesture zone) never begins a drawer drag. */}
        <div
          aria-hidden="true"
          style={{
            flexShrink: 0,
            height: `${EDGE_GUARD}px`,
            pointerEvents: 'none',
          }}
        />

        {/* Scrollable region - everything below the handle. Содержимое
            существует только у раскрытой шторки: в свёрнутом виде оно и так
            уехало за нижний край экрана, а в дереве оставалось - и после
            того, как последние операции появились прямо на главной, каждая
            строка оказывалась в документе дважды. Глазами второй список не
            виден, а скринридер читал обе копии. */}
        <div style={{ flex: 1, overflowY: 'auto', overscrollBehavior: 'contain' }}>
          {/* Transaction History (moved verbatim from App.jsx) */}
          {expanded && (
          <div className="glass-panel" style={{ padding: '0', overflow: 'hidden' }}>
            <div style={{ padding: '24px', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0 }}>{searchQuery ? `Результаты поиска (${searchResults.count})` : 'История'}</h3>
                <button onClick={exportToCSV} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', padding: '6px 12px', borderRadius: 'var(--radius-sm)', color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <span>💾</span> Экспорт
                </button>
              </div>

              {/* Search Bar */}
              <div style={{ position: 'relative' }}>
                <Field
                  type="text"
                  tone="muted"
                  placeholder="Поиск по названию или сумме..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{
                    width: '100%',
                    // отступ слева - под иконку лупы, лежащую поверх поля
                    padding: '12px 16px 12px 40px',
                    fontSize: 'var(--text-md)',
                  }}
                />
                <span style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', opacity: 0.5 }}>🔍</span>
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--color-text-muted)', fontSize: 'var(--text-3xl)', cursor: 'pointer' }}
                  >
                    ×
                  </button>
                )}
              </div>

              {/* Category Filter Chips */}
              <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '4px', scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
                <style>{`
                  div::-webkit-scrollbar { display: none; }
                `}</style>
                {categories.filter(c => !selectedType || c.type === selectedType).map(cat => (
                  <Chip
                    key={cat._id}
                    tone="solid"
                    selected={selectedCategory === cat.name}
                    onClick={() => toggleCategoryFilter(cat.name)}
                    style={{
                      flexShrink: 0,
                      padding: '6px 12px',
                      fontSize: 'var(--text-xs)',
                      transition: 'all 0.2s ease',
                      // включённый фильтр приподнят над лентой - её можно
                      // листать, и он должен быть виден боковым зрением
                      boxShadow: selectedCategory === cat.name ? '0 2px 6px rgba(37, 99, 235, 0.2)' : 'none'
                    }}
                  >
                    {cat.name}
                  </Chip>
                ))}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {selectedAccount && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--color-primary-soft)', padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(37, 99, 235, 0.1)' }}>
                    <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-primary)' }}>
                      Счет: <strong>{getAccountFilterLabel(selectedAccount)}</strong>
                    </span>
                    <button onClick={() => setSelectedAccount(null)} style={{ background: 'none', border: 'none', color: 'var(--color-primary)', fontSize: 'var(--text-sm)', cursor: 'pointer', fontWeight: 'bold' }}>
                      Сбросить ×
                    </button>
                  </div>
                )}

                {selectedType && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: selectedType === 'income' ? 'rgba(34, 197, 94, 0.05)' : 'rgba(239, 68, 68, 0.05)', padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid', borderColor: selectedType === 'income' ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)' }}>
                    <span style={{ fontSize: 'var(--text-sm)', color: selectedType === 'income' ? 'var(--color-positive)' : 'var(--color-negative)' }}>
                      Тип: <strong>{selectedType === 'income' ? 'Доходы' : 'Расходы'}</strong>
                    </span>
                    <button onClick={() => setSelectedType(null)} style={{ background: 'none', border: 'none', color: selectedType === 'income' ? 'var(--color-positive)' : 'var(--color-negative)', fontSize: 'var(--text-sm)', cursor: 'pointer', fontWeight: 'bold' }}>
                      Сбросить ×
                    </button>
                  </div>
                )}

                {selectedCategory && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--color-primary-soft)', padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(37, 99, 235, 0.1)' }}>
                    <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-primary)' }}>
                      Категория: <strong>{selectedCategory}</strong>
                    </span>
                    <button onClick={() => setSelectedCategory(null)} style={{ background: 'none', border: 'none', color: 'var(--color-primary)', fontSize: 'var(--text-sm)', cursor: 'pointer', fontWeight: 'bold' }}>
                      Сбросить ×
                    </button>
                  </div>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {/* Один и тот же список в двух режимах - результаты поиска и
                  история за период; отличаются они только источником групп и
                  текстом пустого состояния (см. TransactionList). */}
              <TransactionList
                groups={searchQuery ? searchResults.transactions : periodData.transactions}
                emptyText={searchQuery ? 'Ничего не найдено' : 'Нет операций'}
                selectedCategory={selectedCategory}
                toggleCategoryFilter={toggleCategoryFilter}
                openEditModal={openEditModal}
                getAccountDisplay={getAccountDisplay}
                formatDate={formatDate}
              />
            </div>
          </div>
          )}
        </div>
      </div>
    </>
  );
}
