import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import { extendNewer, extendOlder, listDays, sliceWindow, windowFor } from '../utils/historyWindow';

// Вкладка «История»: обычный экран со списком операций и его механикой
// прокрутки.
//
// Раскладка: колонка высотой в экран над нижней панелью. Шапка (заголовок,
// поиск, фильтры) стоит сверху и не прокручивается, а список едет внутри
// собственного контейнера (history-scroll). Страница под ним не листается:
// из высоты экрана вычтены нижняя панель и боковой отступ layout-container,
// сверху и снизу.
//
// Экран монтируется, только пока вкладка открыта, поэтому флага «открыт ли
// он» нет - открыт всегда.
//
// Данные: history.transactions - ВЕСЬ список под фильтр (один запрос, кэш в
// useHistoryList). В DOM рисуется только окно из ~60 строк (utils/historyWindow):
// нижний сторож дорисовывает более старые дни, прокрутка вверх у начала - более
// новые с сохранением места на экране. Прыжок к месяцу и смена месяца из App
// (initialMonth) переставляют окно на этот месяц; запросов во всех этих случаях
// нет. Окно хранится датами границ, поэтому фоновое обновление списка его не
// сбрасывает и прокрутку не трогает.

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

  const { loading: historyLoading, error: historyError, dataKey, retry } = history;
  // Обновление после записи: прежний список остается, пока идет повторный запрос.
  const historyRefreshing = Boolean(history.refreshing);
  const groups = history.transactions;
  const searching = Boolean(searchQuery.trim());
  const scrollKey = `${dataKey}:${initialMonth}:${positionKey}`;

  // Окно по дням. Хранится датами границ вместе с ключом прокрутки: смена
  // списка, месяца или поиска строит окно заново, а обновление данных - нет.
  // Положение окна живёт и в positionRef, чтобы пережить уход с вкладки.
  const days = useMemo(() => listDays(groups), [groups]);
  const [windowState, setWindowState] = useState(() => ({
    key: scrollKey,
    win: positionRef.current.key === scrollKey ? positionRef.current.win ?? null : null,
  }));
  let win = windowState.key === scrollKey ? windowState.win : null;
  if (!win && days.length) {
    // Данные пришли (или якорь сменился): окно строится один раз от месяца.
    win = windowFor(days, searching ? '' : initialMonth);
    setWindowState({ key: scrollKey, win });
  }
  const shown = useMemo(() => (win ? sliceWindow(win, days) : { days: [], hasNewer: false, hasOlder: false, start: 0 }), [win, days]);
  const hasNewer = shown.hasNewer;
  const hasOlder = shown.hasOlder;
  const windowGroups = useMemo(() => Object.fromEntries(shown.days.map(day => [day.date, groups[day.date]])), [shown, groups]);
  const changeWindow = useCallback(change => setWindowState(previous => (
    previous.key === scrollKey && previous.win ? { key: scrollKey, win: change(previous.win) } : previous
  )), [scrollKey]);
  const showOlder = useCallback(() => changeWindow(current => extendOlder(current, days)), [changeWindow, days]);

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
    // Самый верхний месяц окна может быть показан не с начала: выше есть более
    // новые дни того же месяца. Такой месяц надо собрать заново.
    const firstMonth = shown.days[0]?.date.slice(0, 7);
    const topCut = hasNewer && firstMonth === month && days[shown.start - 1]?.date.slice(0, 7) === month;
    if (!topCut && scrollToMonth(month)) return;
    if (month === initialMonth) {
      // Якорь тот же, App ничего не изменит: переставляем окно здесь.
      positionRef.current.pending = true;
      setWindowState({ key: scrollKey, win: windowFor(days, month) });
    } else {
      onSelectMonth?.(month);
    }
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
  const showNewer = () => {
    if (!hasNewer) return;
    prependRef.current = captureAnchor();
    changeWindow(current => extendNewer(current, days));
  };
  const handleScroll = () => {
    const scroll = scrollRef.current;
    const previousTop = positionRef.current.top;
    positionRef.current.top = scroll.scrollTop;
    if (prependRef.current) prependRef.current = captureAnchor();
    const firstSection = scroll.querySelector('[data-history-month]');
    if (scroll.scrollTop < previousTop && firstSection
      && firstSection.getBoundingClientRect().top >= scroll.getBoundingClientRect().top - 100) showNewer();
  };
  const rowsLoaded = days.length > 0;
  useLayoutEffect(() => {
    const saved = positionRef.current;
    const scroll = scrollRef.current;
    if (saved.key !== scrollKey) {
      saved.key = scrollKey;
      saved.top = 0;
      saved.pending = true;
      prependRef.current = null;
    }
    saved.win = win;
    if (scroll) {
      if (saved.pending && !historyLoading && (!historyError || rowsLoaded)) {
        scroll.scrollTop = 0;
        if (!searching) scrollToMonth(initialMonth);
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
    // Данные (groups) в зависимостях нет намеренно: фоновое обновление списка
    // не должно трогать прокрутку, только смена окна, ключа или якоря.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollKey, win, historyLoading, historyError, initialMonth, searching]);
  useEffect(() => {
    if (!hasOlder || !moreRef.current || typeof IntersectionObserver === 'undefined') return;
    // Пересоздаётся при каждом сдвиге окна: если сторож после дорисовки всё ещё
    // в зоне видимости (короткие дни), наблюдатель сообщит об этом сразу.
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) showOlder();
    }, { root: scrollRef.current, rootMargin: '200px' });
    observer.observe(moreRef.current);
    return () => observer.disconnect();
  }, [hasOlder, win, showOlder]);

  const toggleCategory = name => setHistoryCategory(historyCategory === name ? null : name);
  const isIncome = historyType === 'income';

  const filtersActive = hasActiveFilters({ account: historyAccount, category: historyCategory, type: historyType });
  const resetFilters = () => {
    setHistoryAccount(null);
    setHistoryCategory(null);
    setHistoryType(null);
  };
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
          {/* Окно начинается с выбранного месяца, и прокручивать вверх некуда
              (scrollTop уже 0), поэтому более новые дни открываются кнопкой;
              прокрутка вверх у начала списка делает то же самое сама. */}
          {hasNewer && <div style={{ padding: 'var(--space-2) 0', textAlign: 'center' }}>
            <Button tone="text" size="sm" onClick={showNewer}>Показать более новые</Button>
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
            groups={windowGroups}
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
            {historyRefreshing && <div role="status" style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>Обновление…</div>}
            {historyLoading && <ListSkeleton label="Загрузка операций…" rows={5} />}
            {historyError && (
              <div>
                <div role="alert">{historyError}</div>
                <Button onClick={retry}>Повторить загрузку</Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
