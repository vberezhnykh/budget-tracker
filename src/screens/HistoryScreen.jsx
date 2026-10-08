import { useEffect, useLayoutEffect, useRef } from 'react';
import { Download, Search, X } from 'lucide-react';
import HistoryTimeline from '../components/HistoryTimeline';
import { NAV_OFFSET } from '../components/BottomNav';
import Field from '../components/ui/Field';
import Button from '../components/ui/Button';
import EmptyState from '../components/ui/EmptyState';
import Chip from '../components/ui/Chip';
import ScreenHeader from '../components/ui/ScreenHeader';
import { ListSkeleton } from '../components/ui/Skeleton';
import { describeEmptySearch, hasActiveFilters } from '../utils/historyEmpty';

// Вкладка «История». Раньше это была шторка, выезжавшая снизу; теперь обычный
// экран, и от шторки остался только её список со всей механикой прокрутки.
//
// Раскладка: колонка высотой в экран над нижней панелью. Шапка (заголовок,
// поиск, фильтры) стоит сверху и не прокручивается, а список едет внутри
// собственного контейнера (history-scroll). Страница под ним не листается:
// из высоты экрана вычтены нижняя панель и боковой отступ layout-container,
// сверху и снизу.
//
// Экран монтируется, только пока вкладка открыта, поэтому прежнего флага
// «раскрыта ли шторка» нет - раскрыт всегда.

const FILTER_CHIP_STYLE = {
  flexShrink: 0,
  padding: 'var(--space-1-5) var(--space-3)',
  fontSize: 'var(--text-xs)',
  transition: 'all 0.2s ease',
};

// Включённый фильтр приподнят над лентой - её можно листать, и он должен
// быть виден боковым зрением.
const chipStyle = selected => ({
  ...FILTER_CHIP_STYLE,
  boxShadow: selected ? '0 2px 6px var(--color-primary-glow)' : 'none',
});

const CHIP_ROW_STYLE = { display: 'flex', gap: 'var(--space-2)', overflowX: 'auto', paddingBottom: 'var(--space-1)' };

export default function HistoryScreen({
  history,
  searchQuery,
  setSearchQuery,
  initialMonth,
  positionKey,
  onSelectMonth,
  accounts,
  categories,
  historyAccount,
  setHistoryAccount,
  historyCategory,
  setHistoryCategory,
  historyType,
  setHistoryType,
  exportToCSV,
  isExporting = false,
  openEditModal,
  getAccountDisplay,
  formatDate,
  // Положение прокрутки живёт в App, а не здесь: экран размонтируется при
  // уходе на другую вкладку, и без внешнего хранилища список каждый раз
  // возвращался бы к началу. Без пропса (тесты экрана) хранилище своё.
  positionRef: externalPositionRef,
}) {
  const scrollRef = useRef(null);
  const moreRef = useRef(null);
  const ownPositionRef = useRef({ key: null, top: 0, pending: true });
  const positionRef = externalPositionRef || ownPositionRef;
  // Первый прогон layout-эффекта после монтирования: сохранённую позицию
  // надо вернуть, даже если ключ тот же.
  const mountedRef = useRef(false);
  const prependRef = useRef(null);

  const { loading: historyLoading, error: historyError, direction: historyDirection, key: historyKey } = history;
  const hasMore = history.nextCursor !== null;
  const hasNewer = history.previousCursor !== null;
  const { loadMore, loadNewer } = history;
  const groups = history.transactions;
  const scrollKey = `${historyKey}:${positionKey}`;

  const monthElement = month => scrollRef.current?.querySelector(`[data-history-month="${month}"]`);
  const scrollToMonth = month => {
    const element = monthElement(month);
    const scroll = scrollRef.current;
    if (!element || !scroll) return false;
    scroll.scrollTop += element.getBoundingClientRect().top - scroll.getBoundingClientRect().top;
    positionRef.current.top = scroll.scrollTop;
    return true;
  };
  const selectMonth = month => {
    // A loaded destination is a scroll, not a new query: all adjacent rows stay.
    const firstMonth = Object.keys(groups || {}).sort().reverse()[0]?.slice(0, 7);
    if ((month !== firstMonth || !hasNewer) && scrollToMonth(month)) return;
    onSelectMonth?.(month);
    // The URL may already point here after scrolling into newer months.
    if (month === initialMonth) scrollToMonth(month);
  };
  const captureAnchor = () => {
    const scroll = scrollRef.current;
    const top = scroll.getBoundingClientRect().top;
    const items = [...scroll.querySelectorAll('[data-history-item]')];
    const item = items.find(row => row.getBoundingClientRect().bottom > top) || items[0];
    const anchor = item || monthElement(initialMonth);
    const attribute = item ? 'data-history-item' : 'data-history-month';
    return anchor ? { attribute, value: anchor.getAttribute(attribute), offset: anchor.getBoundingClientRect().top - top } : null;
  };
  const requestNewer = () => {
    if (!hasNewer || historyLoading) return;
    prependRef.current = captureAnchor();
    loadNewer?.();
  };
  const handleScroll = () => {
    const scroll = scrollRef.current;
    const previousTop = positionRef.current.top;
    positionRef.current.top = scroll.scrollTop;
    if (prependRef.current) prependRef.current = captureAnchor();
    const firstSection = scroll.querySelector('[data-history-month]');
    if (!historyError && scroll.scrollTop < previousTop && firstSection
      && firstSection.getBoundingClientRect().top >= scroll.getBoundingClientRect().top - 100) requestNewer();
  };
  useLayoutEffect(() => {
    const saved = positionRef.current;
    const scroll = scrollRef.current;
    if (saved.key !== scrollKey) {
      saved.key = scrollKey;
      saved.top = 0;
      saved.pending = true;
      prependRef.current = null;
    }
    if (scroll) {
      if (saved.pending && !historyLoading && !historyError) {
        scroll.scrollTop = 0;
        if (!searchQuery.trim()) scrollToMonth(initialMonth);
        saved.top = scroll.scrollTop;
        saved.pending = false;
      } else if (!mountedRef.current) {
        scroll.scrollTop = saved.top;
      }
      if (prependRef.current && !historyLoading) {
        const { attribute, value, offset } = prependRef.current;
        const anchor = [...scroll.querySelectorAll(`[${attribute}]`)].find(element => element.getAttribute(attribute) === value);
        if (anchor) scroll.scrollTop += anchor.getBoundingClientRect().top - scroll.getBoundingClientRect().top - offset;
        saved.top = scroll.scrollTop;
        prependRef.current = null;
      }
    }
    mountedRef.current = true;
    // Geometry is restored after DOM updates, before the browser paints.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollKey, groups, historyLoading, historyError, initialMonth, searchQuery]);
  useEffect(() => {
    if (!hasMore || historyLoading || historyError || !moreRef.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) loadMore?.();
    }, { root: scrollRef.current, rootMargin: '200px' });
    observer.observe(moreRef.current);
    return () => observer.disconnect();
  }, [hasMore, historyLoading, historyError, loadMore]);

  const toggleCategory = name => setHistoryCategory(historyCategory === name ? null : name);
  const isIncome = historyType === 'income';

  const searching = Boolean(searchQuery.trim());
  const filtersActive = hasActiveFilters({ account: historyAccount, category: historyCategory, type: historyType });
  const resetFilters = () => {
    setHistoryAccount(null);
    setHistoryCategory(null);
    setHistoryType(null);
  };
  const rowsLoaded = Object.keys(groups || {}).length > 0;
  // Список пуст целиком: ничего не загружено и ничего не грузится. Тогда
  // выгружать нечего, а поиск без результатов показывает своё пустое состояние.
  const listEmpty = !rowsLoaded && !historyLoading;
  const searchEmpty = searching && listEmpty && !historyError;
  const accountName = accounts.find(account => account._id === historyAccount)?.name;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        // Экран минус нижняя панель минус отступы layout-container сверху и
        // снизу. dvh, а не vh: в мобильном Safari vh считается по большому
        // окну (адресная строка убрана) и список уехал бы под панель.
        // Полоса состояния синхронизации (если App её показывает) занимает
        // --status-strip-height над экранами; без неё переменная равна 0.
        height: `calc(100dvh - ${NAV_OFFSET} - 2 * var(--space-5) - var(--status-strip-height, 0px))`,
        minHeight: 0,
      }}
    >
      <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', paddingBottom: 'var(--space-4)' }}>
        <ScreenHeader
          title={searchQuery ? `Результаты поиска (${history.count})` : 'История'}
          actions={(
            <Button tone="secondary" size="sm" onClick={exportToCSV} disabled={isExporting || listEmpty}>
              <Download size={16} strokeWidth={1.8} aria-hidden="true" /> {isExporting ? 'Экспорт…' : 'Экспорт'}
            </Button>
          )}
        />

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
              padding: 'var(--space-3) var(--space-4) var(--space-3) 40px',
              fontSize: 'var(--text-md)',
            }}
          />
          <Search size={18} strokeWidth={1.8} aria-hidden="true" style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)', pointerEvents: 'none' }} />
          {searchQuery && (
            <button
              type="button"
              aria-label="Очистить поиск"
              onClick={() => setSearchQuery('')}
              style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--color-text-muted)', fontSize: 'var(--text-3xl)', cursor: 'pointer' }}
            >
              <X size={18} strokeWidth={1.8} aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Счёт: один из списка или «Все счета». Выбор свой у Истории и с
            выбранным на Обзоре счётом не связан. Отдельной плашки «Счет: …»
            нет - выбранный чип в ряду и есть индикатор. */}
        <div className="no-scrollbar" role="group" aria-label="Фильтр по счёту" style={CHIP_ROW_STYLE}>
          <Chip tone="solid" selected={!historyAccount} onClick={() => setHistoryAccount(null)} style={chipStyle(!historyAccount)}>
            Все счета
          </Chip>
          {accounts.map(account => (
            <Chip
              key={account._id}
              tone="solid"
              selected={historyAccount === account._id}
              onClick={() => setHistoryAccount(account._id)}
              style={chipStyle(historyAccount === account._id)}
            >
              {account.name}
            </Chip>
          ))}
        </div>

        {/* Category Filter Chips */}
        <div className="no-scrollbar" role="group" aria-label="Фильтр по категории" style={CHIP_ROW_STYLE}>
          {categories.filter(c => !historyType || c.type === historyType).map(cat => (
            <Chip
              key={cat._id}
              tone="solid"
              selected={historyCategory === cat.name}
              onClick={() => toggleCategory(cat.name)}
              style={chipStyle(historyCategory === cat.name)}
            >
              {cat.name}
            </Chip>
          ))}
        </div>

        {(historyType || historyCategory) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {historyType && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: isIncome ? 'var(--color-positive-soft)' : 'var(--color-danger-soft)', padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-sm)', border: '1px solid', borderColor: isIncome ? 'var(--color-positive-border-soft)' : 'var(--color-danger-border-faint)' }}>
                <span style={{ fontSize: 'var(--text-sm)', color: isIncome ? 'var(--color-positive)' : 'var(--color-negative)' }}>
                  Тип: <strong>{isIncome ? 'Доходы' : 'Расходы'}</strong>
                </span>
                <Button tone="text" size="sm" onClick={() => setHistoryType(null)} style={{ color: isIncome ? 'var(--color-positive)' : 'var(--color-negative)' }}>
                  Сбросить <X size={14} strokeWidth={1.8} aria-hidden="true" />
                </Button>
              </div>
            )}

            {historyCategory && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--color-primary-soft)', padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-primary-border-soft)' }}>
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-primary)' }}>
                  Категория: <strong>{historyCategory}</strong>
                </span>
                <Button tone="text" size="sm" onClick={() => setHistoryCategory(null)}>
                  Сбросить <X size={14} strokeWidth={1.8} aria-hidden="true" />
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        data-testid="history-scroll"
        className="no-scrollbar"
        style={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', overflowAnchor: 'none', background: 'var(--color-bg)' }}
      >
        {/* Своей белой карточки у списка нет: карточки - это дни внутри него,
           а серый фон под ними даёт сам контейнер. */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {hasNewer && <div style={{ padding: 'var(--space-4) 0', textAlign: 'center' }}>
            <Button disabled={historyLoading} onClick={requestNewer}>
              {historyLoading && historyDirection === 'newer' ? 'Загрузка…' : 'Загрузить более новые'}
            </Button>
            {historyError && historyDirection === 'newer' && <div role="alert">{historyError}</div>}
          </div>}
          {searchEmpty && (
            <EmptyState
              icon={<Search size={24} strokeWidth={1.8} aria-hidden="true" />}
              title="Ничего не нашлось"
              description={describeEmptySearch({ query: searchQuery, accountName, category: historyCategory, type: historyType })}
              actions={filtersActive ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', width: '100%', minWidth: '240px' }}>
                  {[
                    historyAccount && ['Искать по всем счетам', () => setHistoryAccount(null)],
                    historyCategory && ['Искать во всех категориях', () => setHistoryCategory(null)],
                    historyType && ['Искать среди всех операций', () => setHistoryType(null)],
                  ].filter(Boolean).map(([label, onClick], index) => (
                    <Button key={label} block tone={index === 0 ? 'primary' : 'secondary'} onClick={onClick}>{label}</Button>
                  ))}
                </div>
              ) : null}
            />
          )}
          {!searchEmpty && ((!historyLoading && !historyError) || rowsLoaded) && <HistoryTimeline
            groups={groups}
            initialMonth={initialMonth}
            onSelectMonth={selectMonth}
            searching={searching}
            onResetFilters={filtersActive ? resetFilters : undefined}
            emptyText={searchQuery ? 'Ничего не найдено' : 'Нет операций'}
            selectedCategory={historyCategory}
            toggleCategoryFilter={toggleCategory}
            openEditModal={openEditModal}
            getAccountDisplay={getAccountDisplay}
            formatDate={formatDate}
          />}
          <div ref={moreRef} style={{ padding: 'var(--space-4) 0', textAlign: 'center' }}>
            {historyLoading && historyDirection !== 'newer' && <ListSkeleton label="Загрузка операций…" rows={Object.keys(groups || {}).length > 0 ? 2 : 5} />}
            {historyError && historyDirection !== 'newer' && <div role="alert">{historyError}</div>}
            {!historyLoading && (hasMore || (historyError && historyDirection !== 'newer')) && (
              <Button onClick={loadMore}>
                {historyError ? 'Повторить загрузку' : 'Загрузить еще'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
