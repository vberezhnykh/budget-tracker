import { useRef } from 'react';

// Bottom-sheet chrome (CoinKeeper-style) wrapping the transaction history.
// Geometry:
// - Root sheet is 88vh tall, fixed to the bottom edge.
// - Collapsed state leaves a 72px "peek" strip visible (the handle) by
//   translating the sheet down by (88vh - 72px).
// - Expanded state is translateY(0).
const PEEK_HEIGHT = 72;
const SHEET_HEIGHT_VH = 0.88;
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
  monthlyData,
  categories,
  selectedCategory,
  selectedType,
  selectedAccount,
  // Accepted per the component's documented prop contract, but no longer
  // read directly here - the account/label mapping now lives solely in
  // getAccountFilterLabel (shared with App.jsx's drawer title) so the two
  // can never disagree.
  // eslint-disable-next-line no-unused-vars
  accounts,
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
  // Mirrors the CSS calc(88vh - 72px) offset used for the non-dragging case.
  const getTravel = () => {
    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 0;
    return Math.max(0, viewportHeight * SHEET_HEIGHT_VH - PEEK_HEIGHT);
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
          background: '#fff',
          borderTopLeftRadius: '16px',
          borderTopRightRadius: '16px',
          boxShadow: '0 -10px 15px -3px rgba(0, 0, 0, 0.1), 0 -4px 6px -4px rgba(0, 0, 0, 0.1)',
          display: 'flex',
          flexDirection: 'column',
          transform: expanded ? 'translateY(0)' : 'translateY(calc(88vh - 72px))',
          transition: SNAP_TRANSITION,
        }}
      >
        {/* Drag handle / peek strip - the ONLY element that receives the
            pointer gesture, so the list below remains scrollable. */}
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
            height: `${PEEK_HEIGHT}px`,
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
              background: 'rgba(0,0,0,0.15)',
            }}
          />
          <span style={{ fontSize: '0.85rem', fontWeight: '600', color: 'var(--color-text-muted)' }}>
            {title}
          </span>
        </div>

        {/* Scrollable region - everything below the handle. */}
        <div style={{ flex: 1, overflowY: 'auto', overscrollBehavior: 'contain' }}>
          {/* Transaction History (moved verbatim from App.jsx) */}
          <div className="glass-panel" style={{ padding: '0', overflow: 'hidden' }}>
            <div style={{ padding: '24px', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0 }}>{searchQuery ? `Результаты поиска (${searchResults.count})` : 'История'}</h3>
                <button onClick={exportToCSV} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', padding: '6px 12px', borderRadius: '8px', color: 'var(--color-text-muted)', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <span>💾</span> Экспорт
                </button>
              </div>

              {/* Search Bar */}
              <div style={{ position: 'relative' }}>
                <input
                  type="text"
                  placeholder="Поиск по названию или сумме..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '12px 16px 12px 40px',
                    background: '#fff',
                    border: '1px solid rgba(0,0,0,0.08)',
                    borderRadius: '12px',
                    color: 'var(--color-text-main)',
                    fontSize: '0.9rem',
                    boxSizing: 'border-box'
                  }}
                />
                <span style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', opacity: 0.5 }}>🔍</span>
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--color-text-muted)', fontSize: '1.2rem', cursor: 'pointer' }}
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
                  <button
                    key={cat._id}
                    onClick={() => toggleCategoryFilter(cat.name)}
                    style={{
                      flexShrink: 0,
                      padding: '6px 12px',
                      borderRadius: '20px',
                      background: selectedCategory === cat.name ? 'var(--color-primary)' : '#fff',
                      border: '1px solid ' + (selectedCategory === cat.name ? 'var(--color-primary)' : 'rgba(0,0,0,0.1)'),
                      color: selectedCategory === cat.name ? '#fff' : 'var(--color-text-muted)',
                      fontSize: '0.75rem',
                      fontWeight: '600',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      boxShadow: selectedCategory === cat.name ? '0 2px 6px rgba(37, 99, 235, 0.2)' : 'none'
                    }}
                  >
                    {cat.name}
                  </button>
                ))}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {selectedAccount && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(37, 99, 235, 0.05)', padding: '8px 12px', borderRadius: '8px', border: '1px solid rgba(37, 99, 235, 0.1)' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--color-primary)' }}>
                      Счет: <strong>{getAccountFilterLabel(selectedAccount)}</strong>
                    </span>
                    <button onClick={() => setSelectedAccount(null)} style={{ background: 'none', border: 'none', color: 'var(--color-primary)', fontSize: '0.8rem', cursor: 'pointer', fontWeight: 'bold' }}>
                      Сбросить ×
                    </button>
                  </div>
                )}

                {selectedType && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: selectedType === 'income' ? 'rgba(34, 197, 94, 0.05)' : 'rgba(239, 68, 68, 0.05)', padding: '8px 12px', borderRadius: '8px', border: '1px solid', borderColor: selectedType === 'income' ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)' }}>
                    <span style={{ fontSize: '0.8rem', color: selectedType === 'income' ? '#10b981' : '#ef4444' }}>
                      Тип: <strong>{selectedType === 'income' ? 'Доходы' : 'Расходы'}</strong>
                    </span>
                    <button onClick={() => setSelectedType(null)} style={{ background: 'none', border: 'none', color: selectedType === 'income' ? '#10b981' : '#ef4444', fontSize: '0.8rem', cursor: 'pointer', fontWeight: 'bold' }}>
                      Сбросить ×
                    </button>
                  </div>
                )}

                {selectedCategory && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(37, 99, 235, 0.05)', padding: '8px 12px', borderRadius: '8px', border: '1px solid rgba(37, 99, 235, 0.1)' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--color-primary)' }}>
                      Категория: <strong>{selectedCategory}</strong>
                    </span>
                    <button onClick={() => setSelectedCategory(null)} style={{ background: 'none', border: 'none', color: 'var(--color-primary)', fontSize: '0.8rem', cursor: 'pointer', fontWeight: 'bold' }}>
                      Сбросить ×
                    </button>
                  </div>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {searchQuery ? (
                // Search Results View
                searchResults.count === 0 ? (
                  <div style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-muted)' }}>Ничего не найдено</div>
                ) : (
                  Object.keys(searchResults.transactions).sort((a, b) => new Date(b) - new Date(a)).map(date => (
                    <div key={date}>
                      <div style={{ padding: '10px 24px', background: 'rgba(0,0,0,0.02)', fontSize: '0.8rem', color: 'var(--color-text-muted)', borderBottom: '1px solid rgba(0,0,0,0.03)', display: 'flex', justifyContent: 'space-between' }}>
                        <span>{formatDate(date)}</span>
                        {searchResults.transactions[date].dailySum !== 0 && (
                          <span style={{ fontWeight: '600', color: searchResults.transactions[date].dailySum > 0 ? '#10b981' : 'var(--color-text-muted)' }}>
                            {searchResults.transactions[date].dailySum > 0 ? '+' : ''}{searchResults.transactions[date].dailySum.toFixed(2)}€
                          </span>
                        )}
                      </div>
                      {searchResults.transactions[date].items.map(item => (
                        <div key={item.id} onClick={() => openEditModal(item)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', borderBottom: '1px solid rgba(0,0,0,0.05)', cursor: 'pointer', background: item.excludeFromStats ? 'rgba(0,0,0,0.02)' : '#fff', opacity: item.excludeFromStats ? 0.5 : 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                            <div style={{ width: '38px', height: '38px', borderRadius: '12px', background: item.type === 'initial' ? 'rgba(37, 99, 235, 0.1)' : (item.visualAmount > 0 ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.05)'), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem' }}>
                              {item.type === 'initial' ? '🚀' : (item.visualAmount > 0 ? '↓' : '↑')}
                            </div>
                            <div>
                              <div style={{ fontWeight: '600', fontSize: '0.95rem', color: 'var(--color-text-main)' }}>
                                {item.description || item.title}{item.excludeFromStats && <span style={{ marginLeft: '6px', fontSize: '0.7rem', color: '#94a3b8', fontWeight: '500' }}>🚫</span>}
                              </div>
                              <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                                {getAccountDisplay(item.account)}
                                {item.category && (
                                  <>
                                    {' • '}
                                    <span
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        toggleCategoryFilter(item.category);
                                      }}
                                      style={{ color: selectedCategory === item.category ? 'var(--color-primary)' : 'inherit', fontWeight: selectedCategory === item.category ? '700' : 'normal', textDecoration: 'underline', textUnderlineOffset: '2px' }}
                                    >
                                      {item.category}
                                    </span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                          <div style={{ fontWeight: '700', color: (item.type === 'initial' || item.type === 'transfer') ? 'var(--color-primary)' : (item.visualAmount > 0 ? '#059669' : 'var(--color-text-main)') }}>
                            {item.type !== 'initial' && item.type !== 'transfer' && item.visualAmount > 0 ? '+' : ''}€{Math.abs(item.visualAmount).toFixed(2)}
                          </div>
                        </div>
                      ))}
                    </div>
                  ))
                )
              ) : (
                // Monthly Data View
                Object.keys(monthlyData.transactions).length === 0 ? (
                  <div style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-muted)' }}>Нет операций</div>
                ) : (
                  Object.keys(monthlyData.transactions).sort((a, b) => new Date(b) - new Date(a)).map(date => (
                    <div key={date}>
                      <div style={{ padding: '10px 24px', background: 'rgba(0,0,0,0.02)', fontSize: '0.8rem', color: 'var(--color-text-muted)', borderBottom: '1px solid rgba(0,0,0,0.03)', display: 'flex', justifyContent: 'space-between' }}>
                        <span>{formatDate(date)}</span>
                        {monthlyData.transactions[date].dailySum !== 0 && (
                          <span style={{ fontWeight: '600', color: monthlyData.transactions[date].dailySum > 0 ? '#10b981' : 'var(--color-text-muted)' }}>
                            {monthlyData.transactions[date].dailySum > 0 ? '+' : ''}{monthlyData.transactions[date].dailySum.toFixed(2)}€
                          </span>
                        )}
                      </div>
                      {monthlyData.transactions[date].items.map(item => {
                        if (item.type === 'split_group') {
                          return (
                            <div key={item.id} style={{ borderBottom: '1px solid rgba(0,0,0,0.05)', background: '#fff' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', background: 'rgba(0,0,0,0.01)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                  <div style={{ width: '38px', height: '38px', borderRadius: '12px', background: 'rgba(37, 99, 235, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem' }}>
                                    🗂️
                                  </div>
                                  <div>
                                    <div style={{ fontWeight: '600', fontSize: '0.95rem', color: 'var(--color-text-main)' }}>{item.description} (Разделено)</div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                                      {getAccountDisplay(item.account)} • {item.items.length} катег.
                                    </div>
                                  </div>
                                </div>
                                <div style={{ fontWeight: '700', color: 'var(--color-text-main)' }}>
                                  €{Math.abs(item.visualAmount).toFixed(2)}
                                </div>
                              </div>
                              {/* Sub-items */}
                              <div style={{ paddingLeft: '54px', paddingBottom: '8px' }}>
                                {item.items.map(subItem => (
                                  <div key={subItem.id} onClick={() => openEditModal(subItem)} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 24px 8px 16px', fontSize: '0.85rem', cursor: 'pointer', borderLeft: '2px solid rgba(37, 99, 235, 0.2)', marginBottom: '4px' }}>
                                    <div
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        toggleCategoryFilter(subItem.category);
                                      }}
                                      style={{ color: selectedCategory === subItem.category ? 'var(--color-primary)' : 'var(--color-text-muted)', fontWeight: selectedCategory === subItem.category ? '700' : 'normal', textDecoration: 'underline', textUnderlineOffset: '2px' }}
                                    >
                                      {subItem.category}
                                    </div>
                                    <div style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-main)' }}>
                                      €{Math.abs(subItem.visualAmount).toFixed(2)}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        }

                        return (
                          <div key={item.id} onClick={() => openEditModal(item)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', borderBottom: '1px solid rgba(0,0,0,0.05)', cursor: 'pointer', background: item.excludeFromStats ? 'rgba(0,0,0,0.02)' : '#fff', opacity: item.excludeFromStats ? 0.5 : 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                              <div style={{ width: '38px', height: '38px', borderRadius: '12px', background: item.type === 'initial' ? 'rgba(37, 99, 235, 0.1)' : (item.visualAmount > 0 ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.05)'), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem' }}>
                                {item.type === 'initial' ? '🚀' : (item.visualAmount > 0 ? '↓' : '↑')}
                              </div>
                              <div>
                                <div style={{ fontWeight: '600', fontSize: '0.95rem', color: 'var(--color-text-main)' }}>
                                  {item.description || item.title}{item.excludeFromStats && <span style={{ marginLeft: '6px', fontSize: '0.7rem', color: '#94a3b8', fontWeight: '500' }}>🚫</span>}
                                </div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                                  {getAccountDisplay(item.account)}
                                  {item.category && (
                                    <>
                                      {' • '}
                                      <span
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          toggleCategoryFilter(item.category);
                                        }}
                                        style={{ color: selectedCategory === item.category ? 'var(--color-primary)' : 'inherit', fontWeight: selectedCategory === item.category ? '700' : 'normal', textDecoration: 'underline', textUnderlineOffset: '2px' }}
                                      >
                                        {item.category}
                                      </span>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>
                            <div style={{ fontWeight: '700', color: (item.type === 'initial' || item.type === 'transfer') ? 'var(--color-primary)' : (item.visualAmount > 0 ? '#059669' : 'var(--color-text-main)') }}>
                              {item.type !== 'initial' && item.type !== 'transfer' && item.visualAmount > 0 ? '+' : ''}€{Math.abs(item.visualAmount).toFixed(2)}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))
                )
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
