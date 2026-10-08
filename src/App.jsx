import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { CloudOff } from 'lucide-react'
import AddTransactionForm from './components/AddTransactionForm'
import LoginScreen from './components/LoginScreen'
import BottomNav, { NAV_HEIGHT, NAV_OFFSET } from './components/BottomNav'
import CenteredCardScreen from './components/CenteredCardScreen'
import { AppSkeleton } from './components/ui/Skeleton'
import BankingSheet from './components/BankingSheet'
import Button from './components/ui/Button'
import InlineAlert from './components/ui/InlineAlert'
import Toast from './components/ui/Toast'
import OverviewScreen from './screens/OverviewScreen'
import HistoryScreen from './screens/HistoryScreen'
import AnalyticsScreen from './screens/AnalyticsScreen'
import MoreScreen from './screens/MoreScreen'
import AccountsScreen from './screens/settings/AccountsScreen'
import AccountEditSheet from './screens/settings/AccountEditSheet'
import CategoriesScreen from './screens/settings/CategoriesScreen'
import LimitSheet from './screens/settings/LimitSheet'
import TrashScreen from './screens/settings/TrashScreen'
import { toDativeMonth, listPeriodMonths, getCurrentMonth, toLocalDateInput, formatSyncStatus } from './utils/period'
import { transformTransactions } from './utils/finance'
import { formatMoney } from './utils/money'
import usePagedHistory from './utils/usePagedHistory'
import useHashScreen from './utils/useHashScreen'
import { createDashboardCache, DASHBOARD_FRESH_MS } from './utils/dashboardCache'
import { handleAccountDragEnd } from './utils/accountReorder'
import { getAccountThemes } from './utils/accountThemes'

// API URL - relative path for production data fetching
const API_URL = '/api/transactions';
const CATEGORIES_URL = '/api/categories';
const ACCOUNTS_URL = '/api/accounts';
const SETTINGS_URL = '/api/settings';
const TRASH_URL = '/api/trash';
const BANKING_URL = '/api/banking';
// Used until the server's settings document has loaded (or if it 404s on an
// older deployment) - mirrors the server's own default in server/app.js.
const DEFAULT_MONTHLY_LIMIT = 7000;
const EMPTY_TOTALS = { income: 0, expense: 0, categoryTotals: {} };
const EMPTY_BALANCES = { total: 0, held: 0, byAccount: {} };
const EMPTY_COMPARISON = { expense: 0, prevMonthName: '', prevMonthDayLabel: '' };
// Тост стоит над нижней панелью: её высота, минимальный зазор под ней (8px,
// см. NAV_BOTTOM_GAP в BottomNav) и ещё 16px воздуха. Безопасную зону iPhone
// не прибавляем: Toast принимает число, а env() в px заранее не посчитать.
const TOAST_BOTTOM = NAV_HEIGHT + 8 + 16;
// Второй тост (сообщение об ошибке над тостом «Операция в корзине») встаёт
// выше первого на его высоту (52px) и зазор.
const TOAST_STACK_STEP = 64;

class DataLoadError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DataLoadError';
  }
}

function App() {
  const [showAddTransaction, setShowAddTransaction] = useState(false);
  const [transactionType, setTransactionType] = useState('expense');
  const [editingTransaction, setEditingTransaction] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [initialLoadError, setInitialLoadError] = useState(null);
  // Время последней неудачной первой загрузки (подпись «Последняя попытка в…»)
  // и признак того, что «Повторить» сейчас в пути: экран ошибки при этом не
  // исчезает, кнопка меняется на «Повтор…».
  const [lastAttemptAt, setLastAttemptAt] = useState(null);
  const [isRetrying, setIsRetrying] = useState(false);
  // Экран входа показан потому, что сессия закончилась посреди работы (401
  // после того, как данные уже были), а не потому, что приложение только что
  // открыли. От этого зависит подзаголовок входа.
  const [sessionExpired, setSessionExpired] = useState(false);
  const [syncWarning, setSyncWarning] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastSuccessfulSync, setLastSuccessfulSync] = useState(null);
  const [trashGroups, setTrashGroups] = useState([]);
  const [trashLoading, setTrashLoading] = useState(false);
  const [trashError, setTrashError] = useState('');
  // Корзина читалась хотя бы раз: до этого счётчик на «Ещё» неизвестен (null),
  // а не «0», и экран корзины показывает загрузку, а не пустое состояние.
  const [trashLoaded, setTrashLoaded] = useState(false);
  const [showBanking, setShowBanking] = useState(false);
  const [bankingEnabled, setBankingEnabled] = useState(false);
  const [banking, setBanking] = useState(null);
  const [bankingReview, setBankingReview] = useState({ items: [], total: 0 });
  const [bankingLoading, setBankingLoading] = useState(false);
  const [bankingError, setBankingError] = useState('');
  const bankingGenerationRef = useRef(0);
  const bankingReadInFlightRef = useRef(null);
  const bankingCallbackRef = useRef(null);
  const [undoDeletion, setUndoDeletion] = useState(null);
  const sessionGenerationRef = useRef(0);
  const loadGenerationRef = useRef(0);
  const trashGenerationRef = useRef(0);
  const hasSnapshotRef = useRef(false);
  const historyRefreshNeededRef = useRef(false);
  const undoTimeoutRef = useRef(null);
  const undoDeletionIdRef = useRef(null);

  // Auth: null = "don't know yet" (still checking / never asked), true =
  // logged in, false = show the login screen. Deliberately not persisted to
  // localStorage - the httpOnly session cookie is the only source of truth,
  // and this state is just the UI's best current guess at what that cookie
  // says, driven entirely by 401 responses from the API (see apiFetch below).
  const [isAuthenticated, setIsAuthenticated] = useState(null);

  // State for selected. Defaults to current month YYYY-MM
  const [selectedMonth, setSelectedMonth] = useState(getCurrentMonth);
  const [historyMonth, setHistoryMonth] = useState(selectedMonth);
  // Какой экран открыт: 'overview' | 'history' | 'analytics' | 'more'. Живёт
  // в location.hash (см. utils/useHashScreen), поэтому обновление страницы
  // остаётся на той же вкладке. Внутренний экран ('accounts' | 'categories' |
  // 'trash' | null) лежит под «Ещё» и открывается записью в истории: системное
  // «назад» закрывает его.
  const { screen, inner, setScreen, openInner, closeInner } = useHashScreen();
  const [timeRange, setTimeRange] = useState('month'); // 'month' or 'lifetime'

  // Accounts state
  const [accounts, setAccounts] = useState([]);
  const accountsRef = useRef([]);
  useEffect(() => {
    accountsRef.current = accounts;
  }, [accounts]);
  // Лист счёта: null - закрыт, 'new' - новый счёт, объект - правка этого счёта.
  const [accountSheet, setAccountSheet] = useState(null);
  const [showLimit, setShowLimit] = useState(false);

  // Monthly spending limit, driving the limit progress bar in the stats
  // panel. Shared across devices via GET/PUT /api/settings rather than
  // per-browser, so it starts at the server's own default until that fetch
  // resolves (see loadData below).
  const [monthlyLimit, setMonthlyLimit] = useState(DEFAULT_MONTHLY_LIMIT);

  // In-app notice toast, replacing blocking alert()s for errors raised by
  // account save/delete/reorder. { type: 'error' | 'success', message } or
  // null when nothing is showing. noticeTimeoutRef holds the auto-dismiss
  // timer so a fresh notice (or unmount) can clear a still-pending one -
  // otherwise a leaked timer could fire setNotice(null) after unmount.
  const [notice, setNotice] = useState(null);
  const noticeTimeoutRef = useRef(null);

  const showNotice = (message, type = 'error') => {
    if (noticeTimeoutRef.current) clearTimeout(noticeTimeoutRef.current);
    setNotice({ type, message });
    noticeTimeoutRef.current = setTimeout(() => setNotice(null), 5000);
  };

  useEffect(() => {
    return () => {
      if (noticeTimeoutRef.current) clearTimeout(noticeTimeoutRef.current);
      if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
    };
  }, []);

  // Высота полосы «не удалось обновить» вместе с отступом под ней. Экраны
  // (История считает свою высоту от окна) вычитают её через переменную
  // --status-strip-height на <main>, поэтому полосу меряем сами: она
  // переносится на узком экране и меняет высоту. Полоса то появляется, то
  // исчезает, так что мерим через callback-ref, а не useLayoutEffect с
  // фиксированным узлом. ResizeObserver есть не везде (jsdom) - тогда мерим
  // один раз при появлении.
  const [statusStripHeight, setStatusStripHeight] = useState(0);
  const statusStripObserverRef = useRef(null);
  const statusStripRef = useCallback((node) => {
    if (statusStripObserverRef.current) {
      statusStripObserverRef.current.disconnect();
      statusStripObserverRef.current = null;
    }
    if (!node) {
      setStatusStripHeight(0);
      return;
    }
    const measure = () => setStatusStripHeight(Math.ceil(node.getBoundingClientRect().height));
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      statusStripObserverRef.current = new ResizeObserver(measure);
      statusStripObserverRef.current.observe(node);
    }
  }, []);

  const onAccountDragEnd = (event) => {
    const session = sessionGenerationRef.current;
    handleAccountDragEnd(event, {
      accounts: accountsRef.current,
      setAccounts,
      apiUrl: ACCOUNTS_URL,
      apiFetch,
      onError: showNotice,
      isCurrent: () => session === sessionGenerationRef.current,
      onPersisted: () => loadData({ initial: false }),
    });
  };


  // Transactions state
  const [dashboard, setDashboard] = useState(null);
  const [dashboardCache, setDashboardCache] = useState({});
  const [dashboardReads] = useState(() => createDashboardCache());
  const [historyRevision, setHistoryRevision] = useState(0);
  const [isExporting, setIsExporting] = useState(false);
  const [categories, setCategories] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAccount, setSelectedAccount] = useState(null);

  // Фильтры Истории отделены от выбора на Обзоре: счёт и категория, выбранные
  // там, влияет только на сводку (selectedAccount идёт в запрос итогов), а
  // список операций фильтруется своим состоянием. Категории в итогах не
  // фильтруются вовсе: нажатие на категорию в Аналитике открывает Историю
  // (openHistoryOfCategory). Поиск и
  // месяц (searchQuery / historyMonth) и так относились только к Истории.
  const [historyAccount, setHistoryAccount] = useState(null);
  const [historyCategory, setHistoryCategory] = useState(null);
  const [historyType, setHistoryType] = useState(null);
  // Положение прокрутки списка Истории. Экран размонтируется вместе с
  // вкладкой, а вернуться на неё должно туда же, где ушли.
  const historyPositionRef = useRef({ key: null, top: 0, pending: true });

  const clearPrivateData = () => {
    if (noticeTimeoutRef.current) clearTimeout(noticeTimeoutRef.current);
    setNotice(null);
    setAccounts([]);
    accountsRef.current = [];
    setDashboard(null);
    dashboardReads.clear();
    setDashboardCache({});
    setIsExporting(false);
    setHistoryRevision(value => value + 1);
    setCategories([]);
    setTrashGroups([]);
    setTrashError('');
    setTrashLoading(false);
    setTrashLoaded(false);
    setShowBanking(false);
    setBankingEnabled(false);
    setBanking(null);
    setBankingReview({ items: [], total: 0 });
    setBankingLoading(false);
    setBankingError('');
    bankingGenerationRef.current += 1;
    bankingReadInFlightRef.current = null;
    setUndoDeletion(null);
    undoDeletionIdRef.current = null;
    trashGenerationRef.current += 1;
    if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
    undoTimeoutRef.current = null;
    setMonthlyLimit(DEFAULT_MONTHLY_LIMIT);
    setSelectedAccount(null);
    setHistoryAccount(null);
    setHistoryCategory(null);
    setHistoryType(null);
    setSearchQuery('');
    setEditingTransaction(null);
    setShowAddTransaction(false);
    setAccountSheet(null);
    setShowLimit(false);
    setScreen('overview');
    setLastSuccessfulSync(null);
    setSyncWarning(null);
    setInitialLoadError(null);
    setLastAttemptAt(null);
    hasSnapshotRef.current = false;
    historyRefreshNeededRef.current = false;
  };

  // expired: сессия закончилась сама (401), а не пользователь вышел кнопкой.
  // «Закончилась» только если данные уже были загружены: 401 на самой первой
  // загрузке - это обычный первый вход, а не потеря сессии. hasSnapshotRef
  // читаем до clearPrivateData, который его сбрасывает.
  const markUnauthenticated = ({ expired = hasSnapshotRef.current } = {}) => {
    sessionGenerationRef.current += 1;
    loadGenerationRef.current += 1;
    clearPrivateData();
    setSessionExpired(expired);
    setIsRefreshing(false);
    setIsRetrying(false);
    setIsLoading(false);
    setIsAuthenticated(false);
  };

  // Thin fetch wrapper used for every /api/* call. A 401 means the session
  // cookie is missing/expired - flip to the login screen right away rather
  // than letting each call site duplicate that check. This is the single
  // place that drives isAuthenticated back to false mid-session.
  const apiFetch = useCallback(async (url, options) => {
    const requestSession = sessionGenerationRef.current;
    const res = await fetch(url, options);
    if (res.status === 401 && requestSession === sessionGenerationRef.current) {
      markUnauthenticated();
    }
    return res;
    // All mutable auth state is read through generation refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const readJson = async (url, fallbackMessage, { allowMissing = false } = {}) => {
    const res = await apiFetch(url);
    if (res.status === 401) throw new DataLoadError('Требуется повторный вход');
    if (allowMissing && res.status === 404) return null;
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new DataLoadError((data && data.message) || fallbackMessage);
    if (data === null) throw new DataLoadError(fallbackMessage);
    return data;
  };

  const today = new Date();
  const todayKey = toLocalDateInput(today);
  const statsParams = new URLSearchParams({
    month: selectedMonth, timeRange,
    today: todayKey,
    analytics: screen === 'analytics' ? '1' : '0',
  });
  if (selectedAccount) statsParams.set('account', selectedAccount);
  const statsKey = statsParams.toString();
  const summaryFilterKey = JSON.stringify([selectedAccount]);
  const historyParams = new URLSearchParams({ month: historyMonth, continuous: '1', limit: '40' });
  if (historyAccount) historyParams.set('account', historyAccount);
  if (historyCategory) historyParams.set('category', historyCategory);
  if (historyType) historyParams.set('type', historyType);
  if (searchQuery.trim()) historyParams.set('q', searchQuery.trim());
  const history = usePagedHistory({
    url: `/api/history?${historyParams}`, enabled: isAuthenticated === true,
    revision: historyRevision, request: apiFetch, searching: Boolean(searchQuery.trim()),
  });

  // Summaries contain complete totals, never calculated from a partial page.
  // Loading the first history page does not block the dashboard.
  const loadData = async ({ initial = !hasSnapshotRef.current, onlyStats = false, retry = false } = {}) => {
    // A filter change during a post-write refresh must still finish the full
    // snapshot, rather than cancel it with a stats-only read.
    onlyStats = onlyStats && !historyRefreshNeededRef.current;
    const session = sessionGenerationRef.current;
    const generation = ++loadGenerationRef.current;
    if (!onlyStats) {
      historyRefreshNeededRef.current = true;
      dashboardReads.clear();
      setDashboardCache({});
    }
    const cacheVersion = dashboardReads.version;
    const isCurrent = () => session === sessionGenerationRef.current
      && generation === loadGenerationRef.current;

    const cached = dashboardReads.get(statsKey);
    const fresh = timestamp => Date.now() - timestamp < DASHBOARD_FRESH_MS;
    const hasFastTotals = screen !== 'analytics' && timeRange === 'month'
      && dashboard?.data.monthlyTotalsByAccount?.[selectedAccount || '']
      && fresh(dashboard.updatedAt);
    if (onlyStats && ((cached && fresh(cached.updatedAt)) || hasFastTotals)) {
      setDashboardCache(dashboardReads.snapshot());
      setIsRefreshing(false);
      setSyncWarning(null);
      return true;
    }

    if (retry) {
      // Повтор с экрана ошибки: сам экран остаётся (кнопка «Повтор…»), а не
      // подменяется скелетоном и не мигает.
      setIsRetrying(true);
    } else if (initial) {
      setIsLoading(true);
      setInitialLoadError(null);
    } else {
      setIsRefreshing(true);
    }

    try {
      const loadedAccounts = onlyStats ? accountsRef.current : await readJson(ACCOUNTS_URL, 'Не удалось загрузить счета');
      if (!Array.isArray(loadedAccounts)) throw new DataLoadError('Сервер вернул некорректный список счетов');
      if (!isCurrent()) return false;

      const [loadedDashboard, loadedCategories, loadedSettings] = await Promise.all([
        dashboardReads.load(statsKey, async () => {
          const data = await readJson(`/api/stats/dashboard?${statsKey}`, 'Не удалось загрузить итоги');
          if (!data?.balances?.byAccount || !Number.isFinite(data.balances.total)
            || !data.monthlyTotals || !data.month || !data.yearly || !data.lifetime) {
            throw new DataLoadError('Сервер вернул некорректные итоги');
          }
          return data;
        }),
        onlyStats ? categories : readJson(CATEGORIES_URL, 'Не удалось загрузить категории'),
        // Compatibility with deployments from before shared settings: a 404
        // means the documented default, while network/5xx failures still make
        // the whole snapshot unsuccessful.
        onlyStats ? null : readJson(SETTINGS_URL, 'Не удалось загрузить настройки', { allowMissing: true }),
      ]);
      if (!Array.isArray(loadedCategories)) throw new DataLoadError('Сервер вернул некорректный список категорий');
      if (loadedSettings !== null && (
        typeof loadedSettings !== 'object'
        || typeof loadedSettings.monthlyLimit !== 'number'
        || !Number.isFinite(loadedSettings.monthlyLimit)
        || loadedSettings.monthlyLimit <= 0
      )) {
        throw new DataLoadError('Сервер вернул некорректные настройки');
      }
      if (!isCurrent()) return false;

      setDashboardCache(dashboardReads.snapshot());
      setDashboard({ key: statsKey, filterKey: summaryFilterKey, updatedAt: Date.now(), data: loadedDashboard });
      if (!onlyStats) {
        setAccounts(loadedAccounts);
        accountsRef.current = loadedAccounts;
        setCategories(loadedCategories);
        setMonthlyLimit(loadedSettings === null ? DEFAULT_MONTHLY_LIMIT : loadedSettings.monthlyLimit);
        setBankingEnabled(loadedSettings?.features?.banking === true);
      }
      if (historyRefreshNeededRef.current) {
        setHistoryRevision(value => value + 1);
        historyRefreshNeededRef.current = false;
      }
      setLastSuccessfulSync(new Date());
      setSyncWarning(null);
      setInitialLoadError(null);
      setIsAuthenticated(true);
      hasSnapshotRef.current = true;
      return true;
    } catch (err) {
      if (!isCurrent()) return false;
      console.error('Data sync error:', err);
      const message = err instanceof DataLoadError
        ? err.message
        : 'Не удалось подключиться к серверу';
      if (hasSnapshotRef.current) {
        setSyncWarning(message);
      } else {
        setInitialLoadError(message);
        setLastAttemptAt(new Date());
      }
      return false;
    } finally {
      if (onlyStats && session === sessionGenerationRef.current && cacheVersion === dashboardReads.version) {
        setDashboardCache(dashboardReads.snapshot());
      }
      if (isCurrent()) {
        setIsLoading(false);
        setIsRefreshing(false);
        setIsRetrying(false);
      }
    }
  };

  const beginAuthenticatedSession = () => {
    sessionGenerationRef.current += 1;
    loadGenerationRef.current += 1;
    clearPrivateData();
    setSessionExpired(false);
    setIsAuthenticated(null);
    loadData({ initial: true });
  };

  // Fetch data on mount.
  useEffect(() => {
    loadData({ initial: true });
    return () => { loadGenerationRef.current += 1; sessionGenerationRef.current += 1; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (hasSnapshotRef.current) loadData({ initial: false, onlyStats: true });
    // Auth changes are handled by beginAuthenticatedSession; this effect
    // only changes the selected summary, without reloading history pages.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statsKey]);

  useEffect(() => {
    const refreshOnReturn = () => {
      if (document.visibilityState !== 'hidden' && isAuthenticated === true
        && !historyRefreshNeededRef.current
        && Date.now() - (lastSuccessfulSync?.getTime() || 0) >= DASHBOARD_FRESH_MS) {
        loadData({ initial: false });
      }
    };
    window.addEventListener('focus', refreshOnReturn);
    document.addEventListener('visibilitychange', refreshOnReturn);
    return () => {
      window.removeEventListener('focus', refreshOnReturn);
      document.removeEventListener('visibilitychange', refreshOnReturn);
    };
    // Always refresh the currently selected view when returning to the app.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statsKey, isAuthenticated, lastSuccessfulSync]);

  // Bank snapshots are independent of the budget snapshot: a bank outage must
  // not prevent using manually entered expenses. Pending entries never enter
  // the transactions state or the statistics derived from it.
  const fetchBanking = async ({ includeReview = showBanking, background = false } = {}) => {
    if (!bankingEnabled) return false;
    if (background && bankingReadInFlightRef.current !== null) return false;
    const session = sessionGenerationRef.current;
    const generation = ++bankingGenerationRef.current;
    bankingReadInFlightRef.current = generation;
    const isCurrent = () => session === sessionGenerationRef.current && generation === bankingGenerationRef.current;
    setBankingLoading(true);
    setBankingError('');
    try {
      const data = await readJson(BANKING_URL, 'Не удалось загрузить подключения банков');
      if (!data || typeof data.configured !== 'boolean' || !Array.isArray(data.connections)) throw new DataLoadError('Не удалось прочитать подключения банков');
      if (!isCurrent()) return false;
      const review = includeReview && data.configured
        ? await readJson(`${BANKING_URL}/review`, 'Не удалось загрузить операции для проверки')
        : null;
      if (review && (!Array.isArray(review.items) || !Number.isInteger(review.total))) throw new DataLoadError('Не удалось прочитать операции для проверки');
      if (!isCurrent()) return false;
      setBanking(data);
      if (review) setBankingReview(review);
      if (!data.configured) setBankingReview({ items: [], total: 0 });
      return true;
    } catch (error) {
      if (isCurrent()) setBankingError(error instanceof DataLoadError ? error.message : 'Не удалось подключиться к серверу');
      return false;
    } finally {
      if (bankingReadInFlightRef.current === generation) bankingReadInFlightRef.current = null;
      if (isCurrent()) setBankingLoading(false);
    }
  };

  const openBanking = () => {
    if (!bankingEnabled) return;
    setShowBanking(true);
  };

  useEffect(() => {
    const url = new URL(window.location.href);
    const result = url.searchParams.get('banking');
    if (!['connected', 'error'].includes(result)) return;
    bankingCallbackRef.current = result;
    url.searchParams.delete('banking');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !bankingCallbackRef.current) return;
    const result = bankingCallbackRef.current;
    bankingCallbackRef.current = null;
    if (!bankingEnabled) return;
    setShowBanking(true);
    showNotice(result === 'connected' ? 'Банк подключён. Проверьте привязку счетов и новые операции.' : 'Подключение банка не завершено. Попробуйте ещё раз.', result === 'connected' ? 'success' : 'error');
    // The callback is consumed once, after the app session has been loaded.
  }, [isAuthenticated, bankingEnabled]);

  // Бейдж «Банки» живёт в меню «Ещё»: статус подключений читается, пока оно
  // на экране (отзыв операций - только при открытом листе).
  const onMoreMenu = screen === 'more' && !inner;
  useEffect(() => {
    if (!bankingEnabled || !isAuthenticated || (!showBanking && !onMoreMenu)) return;
    fetchBanking({ includeReview: showBanking });
    // Poll only our server's status while the bank sheet is visible. The
    // server, not a browser timer, owns the bank synchronization schedule.
    const timer = showBanking ? setInterval(() => fetchBanking({ includeReview: true, background: true }), 15_000) : null;
    return () => { if (timer) clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, bankingEnabled, showBanking, onMoreMenu]);

  const mutateBanking = async (path, method, body, { refreshBudget = false, resolvedEntryId } = {}) => {
    if (!bankingEnabled) return { ok: false, error: 'Банковский импорт отключён' };
    const session = sessionGenerationRef.current;
    try {
      const res = await apiFetch(`${BANKING_URL}${path}`, {
        method,
        ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
      });
      const data = await res.json().catch(() => null);
      if (session !== sessionGenerationRef.current) return { ok: false, error: 'Сессия завершена' };
      if (!res.ok) {
        if (res.status === 409 || res.status === 429) await fetchBanking({ includeReview: true });
        return { ok: false, error: data?.message || 'Не удалось выполнить действие. Обновите банковские данные и повторите.' };
      }
      if (resolvedEntryId) {
        // The decision is durable even if the following GET fails. Remove
        // that proposal locally so a failed refresh cannot invite another POST.
        setBankingReview(current => ({ ...current, items: current.items.filter(entry => entry.id !== resolvedEntryId), total: Math.max(0, current.total - 1) }));
        setBanking(current => current ? { ...current, pendingReviewCount: Math.max(0, (current.pendingReviewCount || 0) - 1) } : current);
      }
      if (refreshBudget) await Promise.all([loadData({ initial: false }), fetchBanking({ includeReview: true })]);
      else await fetchBanking({ includeReview: true });
      return { ok: true };
    } catch {
      return { ok: false, error: 'Не удалось подключиться к серверу' };
    }
  };

  const handleConnectBank = async (fields) => {
    if (!bankingEnabled) return { ok: false, error: 'Банковский импорт отключён' };
    const session = sessionGenerationRef.current;
    try {
      const res = await apiFetch(`${BANKING_URL}/connect`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields) });
      const data = await res.json().catch(() => null);
      if (session !== sessionGenerationRef.current) return { ok: false, error: 'Сессия завершена' };
      if (!res.ok) return { ok: false, error: data?.message || 'Не удалось начать подключение банка' };
      const url = new URL(data?.authorizationUrl);
      if (!['https://auth.enablebanking.com', 'https://tilisy.enablebanking.com'].includes(url.origin) || url.username || url.password) return { ok: false, error: 'Сервер вернул неожиданный адрес подключения банка' };
      window.location.assign(url.href);
      return { ok: true };
    } catch {
      return { ok: false, error: 'Не удалось начать подключение банка' };
    }
  };

  const handleAddCategory = async (name, type) => {
    const session = sessionGenerationRef.current;
    try {
      const res = await apiFetch(CATEGORIES_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, type })
      });
      if (session !== sessionGenerationRef.current) return { error: 'Сессия завершена' };
      if (res.ok) {
        const saved = await res.json();
        if (session !== sessionGenerationRef.current) return { error: 'Сессия завершена' };
        setCategories(prev => [...prev, saved]);
        // Starts a newer load generation, so any GET that began before this
        // successful write can no longer replace the category list.
        await loadData({ initial: false });
        return saved;
      } else {
        const err = await res.json();
        return { error: err.message };
      }
    } catch (err) {
      console.error('Add category error:', err);
      return { error: err.message };
    }
  };

  // Экран «Категории» ждёт от добавления Promise<boolean>, а форма операции -
  // сохранённую категорию или { error } (см. handleAddCategory), поэтому здесь
  // тонкая обёртка: причина отказа уходит в уведомление.
  const handleAddCategoryFromScreen = async (name, type) => {
    const trimmed = (name || '').trim();
    if (!trimmed) {
      showNotice('Название категории не может быть пустым');
      return false;
    }
    const saved = await handleAddCategory(trimmed, type);
    if (!saved || 'error' in saved) {
      showNotice((saved && saved.error) || 'Не удалось добавить категорию');
      return false;
    }
    showNotice('Категория добавлена', 'success');
    return true;
  };

  // Лимит из листа: при успехе, как в прежнем окне, - уведомление.
  const handleSaveLimit = async (limit) => {
    const ok = await handleSaveSettings(limit);
    if (ok) showNotice('Лимит обновлён', 'success');
    return ok;
  };

  // Calculate current balances (Total lifetime) - stays persistent
  const balances = dashboard?.data.balances || EMPTY_BALANCES;
  const summary = dashboardCache[statsKey]?.data || (dashboard?.key === statsKey ? dashboard.data : null);
  // Monthly totals are already known for every month. Keep them visible while
  // switching the month refreshes its details in the background.
  const matchingTotals = dashboard?.filterKey === summaryFilterKey;
  const accountMonthlyTotals = dashboard?.data.monthlyTotalsByAccount?.[selectedAccount || ''];
  const statsReady = Boolean(summary || ((accountMonthlyTotals || matchingTotals) && screen !== 'analytics' && timeRange === 'month'));

  // Declarative card list for the accounts strip on the overview: total
  // capital («Все счета»), then one card per individual account. The
  // type-group entries ('type:card' / 'type:cash') were dropped long ago -
  // that split is shown as a static line in the stats block instead - but
  // the filter values themselves remain valid (see getAccountFilterLabel
  // and the filtering utilities in utils/finance.js), simply unreachable
  // from here.
  const slides = useMemo(() => {
    const accountThemes = getAccountThemes(accounts);
    const base = [
      {
        key: 'total',
        theme: 'total',
        icon: 'wallet',
        name: 'Все счета',
        amount: balances.total,
        filter: null,
        // Деньги на "замороженных" счетах в капитал не входят, но и молча
        // пропадать не должны - показываем их отдельной строкой помельче.
        note: balances.held ? `${balances.held.toLocaleString('de-DE', { minimumFractionDigits: 2 })} € заморожено` : null,
      },
    ];
    const toSlide = (acc) => ({
      key: acc._id,
      theme: accountThemes.get(String(acc._id)),
      icon: acc.icon,
      type: acc.type,
      name: acc.name,
      amount: balances.byAccount[acc._id] || 0,
      filter: acc._id,
      note: acc.excludeFromTotal ? 'вне общего капитала' : null,
    });
    // Замороженные счета уезжают в конец ленты: до них доходят редко, а
    // между повседневными картами они только мешали бы.
    const spendable = accounts.filter(acc => !acc.excludeFromTotal).map(toSlide);
    const held = accounts.filter(acc => acc.excludeFromTotal).map(toSlide);
    return [...base, ...spendable, ...held];
  }, [accounts, balances]);

  // Расход текущего месяца по всем счетам для подсказки лимита в форме
  // операции. Берётся из итогов «по всем счетам» (ключ ''). Месяца без
  // операций в итогах нет - это нулевой расход. Нет итогов - undefined,
  // подсказки нет.
  const allAccountsTotals = dashboard?.data.monthlyTotalsByAccount?.[''];
  const formMonthExpense = allAccountsTotals
    ? Math.abs(allAccountsTotals[getCurrentMonth()]?.expense || 0)
    : undefined;

  const monthlyData = summary?.month || EMPTY_TOTALS;
  const yearlyData = summary?.yearly || EMPTY_TOTALS;
  const lifetimeStats = summary?.lifetime;
  const categoryUsage = dashboard?.data.categoryUsage || {};
  const comparisonData = summary?.comparison || EMPTY_COMPARISON;
  const categoryComparison = summary?.categoryComparison || {};
  const periodMonths = useMemo(() => listPeriodMonths(), []);
  const monthlyTotals = accountMonthlyTotals || summary?.monthlyTotals || (matchingTotals ? dashboard.data.monthlyTotals : {});
  const monthlySeries = periodMonths.map(month => ({
    month,
    year: Number(month.slice(0, 4)),
    label: new Date(`${month}-01T12:00:00`).toLocaleDateString('ru-RU', { month: 'short' }).replace(/\.$/, ''),
    income: monthlyTotals[month]?.income || 0,
    expense: Math.abs(monthlyTotals[month]?.expense || 0),
  }));

  // График в листе лимита: лимит один на все счета, поэтому ряд берётся из
  // итогов «по всем счетам», а не из выбранного на Обзоре счёта.
  const limitSeries = allAccountsTotals
    ? periodMonths.map(month => ({ month, expense: Math.abs(allAccountsTotals[month]?.expense || 0) }))
    : monthlySeries;

  // Корзина для экрана: у переводов в ней лежат только id счетов, названия
  // подкладываются здесь, чтобы подпись была «A → B». Счёт, которого больше
  // нет, названия не получает, и экран пишет просто «Перевод».
  const trashGroupsWithNames = useMemo(() => {
    const nameOf = (id) => accounts.find(a => a._id === id)?.name;
    return trashGroups.map(group => ({
      ...group,
      transactions: (group.transactions || []).map(tx => (tx.type === 'transfer'
        ? { ...tx, accountName: nameOf(tx.account), toAccountName: nameOf(tx.toAccount) }
        : tx)),
    }));
  }, [trashGroups, accounts]);

  const isActualCurrentMonth = useMemo(() => {
    return selectedMonth === getCurrentMonth();
  }, [selectedMonth]);

  // Пока итоги не готовы, цифры сводки размыты и недоступны (SummaryFrame).
  // Ожидание касается и смены счёта: данные другого счёта прежними
  // показывать нельзя.
  const summaryPending = !statsReady && (!syncWarning || isRefreshing);

  // Нажатие на карточку всегда выбирает её - без «нажать ещё раз, чтобы
  // снять»: ровно один счёт активен в любой момент. Прокрутка ленты выбор не
  // меняет.
  const handleSelectAccount = (slide) => {
    setSelectedAccount(prev => (prev === slide.filter ? prev : slide.filter));
  };

  // An account that got deleted out from under the current selection (the
  // strip no longer has its card) would leave the summary filtered by
  // nothing: reset the selection to «Все счета».
  useEffect(() => {
    if (selectedAccount && !slides.some(s => s.filter === selectedAccount)) {
      setSelectedAccount(null);
    }
  }, [selectedAccount, slides]);

  // Плитки «Доход» и «Расход» в сводке Обзора ведут в Историю с фильтром по
  // типу. Выбранная ранее категория другого типа в этом списке дала бы пустой
  // результат (чипы категорий фильтруются по типу, а она бы осталась
  // включённой), поэтому такую категорию сбрасываем.
  const openHistoryOfType = (type) => {
    const selected = categories.find(c => c.name === historyCategory);
    if (selected && selected.type !== type) setHistoryCategory(null);
    setHistoryType(type);
    setScreen('history');
  };

  // Нажатие на категорию в Аналитике: История, отфильтрованная этой категорией
  // за выбранный месяц. Тип сбрасывается - выбранная категория уже задаёт
  // «расходы», а оставшийся фильтр «Доходы» дал бы пустой список. У года и
  // «всего времени» месяца Истории нет, поэтому остаётся тот, что был. Поиск
  // очищается: слово из старого поиска скрыло бы строки этой категории.
  const openHistoryOfCategory = (category) => {
    setHistoryCategory(category);
    setHistoryType(null);
    if (timeRange === 'month') setHistoryMonth(selectedMonth);
    setSearchQuery('');
    setScreen('history');
  };

  // Счёт, выбранный в фильтре Истории, могли удалить из настроек: фильтр
  // остался бы на несуществующем счёте и список был бы пуст без объяснений.
  useEffect(() => {
    if (historyAccount && !accounts.some(a => a._id === historyAccount)) setHistoryAccount(null);
  }, [historyAccount, accounts]);

  // Both halves of "which period am I looking at" move together, from the
  // one PeriodPicker trigger - picking a year has to land on a concrete month
  // too, because the yearly stats derive their year from selectedMonth.
  const handlePeriodChange = ({ timeRange: nextRange, selectedMonth: nextMonth }) => {
    setTimeRange(nextRange);
    setSelectedMonth(nextMonth);
    setHistoryMonth(nextMonth);
  };

  const exportToCSV = async () => {
    if (isExporting) return;
    const session = sessionGenerationRef.current;
    setIsExporting(true);
    try {
      const raw = await readJson(API_URL, 'Не удалось экспортировать операции');
      if (session !== sessionGenerationRef.current) return;
      if (!Array.isArray(raw)) throw new Error('Некорректный ответ');
      const transactions = transformTransactions(raw, accountsRef.current);
      const headers = ['Дата', 'Название', 'Тип', 'Категория', 'Счет', 'Сумма', 'Описание', 'Компания'];
      const escapeCsv = (val) => {
        if (!val) return '""';
        let str = String(val);
        if (/^[=+\-@]/.test(str)) str = "'" + str;
        return `"${str.replace(/"/g, '""')}"`;
      };
      const rows = [...transactions].sort((a, b) => new Date(b.date) - new Date(a.date)).map(t => [
        t.date,
        t.title,
        t.type === 'income' ? 'Доход' : t.type === 'expense' ? 'Расход' : t.type === 'transfer' ? 'Перевод' : 'Начало',
        t.category,
        accountsRef.current.find(a => a._id === t.account)?.name || 'Неизвестно',
        t.amount.toFixed(2),
        t.description || '',
        t.companyName || ''
      ]);

      const csvContent = [headers.join(','), ...rows.map(row => row.map(escapeCsv).join(','))].join('\n');
      const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.href = url;
      link.download = `budget_report_${selectedMonth}.csv`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 100);
    } catch {
      if (session === sessionGenerationRef.current) showNotice('Не удалось экспортировать операции. Повторите попытку.');
    } finally { if (session === sessionGenerationRef.current) setIsExporting(false); }
  };

  const handleAddTransaction = async (newTx) => {
    const session = sessionGenerationRef.current;
    try {
      const post = payload => apiFetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      let res = await post(newTx);
      if (session !== sessionGenerationRef.current) return false;
      let data = res.ok ? null : await res.json().catch(() => null);
      if (session !== sessionGenerationRef.current) return false;
      if (res.status === 409 && data?.code === 'BANK_DUPLICATE') {
        const candidates = Array.isArray(data.candidates) ? data.candidates : [];
        let extra;
        if (candidates.length === 1) {
          const candidate = candidates[0];
          const description = `${candidate.title || 'Операция'} · ${candidate.amount} EUR · ${String(candidate.date || '').slice(0, 10)}`;
          // Оба window.confirm ниже оставлены намеренно: банковский модуль выключен
          // для владельца, диалоги заменим вместе с возвратом банковского
          // интерфейса.
          if (window.confirm(`Похожая операция уже загружена из банка: ${description}. Объединить с ней, сохранив введённые данные?`)) {
            extra = { bankMatchEntryId: candidate.entryId, bankTransactionVersion: candidate.version };
          }
        }
        if (!extra && window.confirm('В банке уже есть похожие записи. Добавить отдельную операцию?')) extra = { bankDuplicateAction: 'separate' };
        if (session !== sessionGenerationRef.current) return false;
        // Отказ от слияния - решение пользователя, а не ошибка: форма
        // остаётся открытой, но плашки «не сохранилось» не будет.
        if (!extra) return { cancelled: true };
        // A split purchase is one candidate by its total. Only the first row
        // carries the user's resolution; the server validates the whole group.
        const payload = Array.isArray(newTx) ? newTx.map((tx, index) => index === 0 ? { ...tx, ...extra } : tx) : { ...newTx, ...extra };
        res = await post(payload);
        if (session !== sessionGenerationRef.current) return false;
        data = res.ok ? null : await res.json().catch(() => null);
        if (session !== sessionGenerationRef.current) return false;
      }
      if (res.ok) {
        // The write is already durable. If the following GET refresh fails,
        // loadData keeps the old snapshot and exposes a retry that performs
        // GETs only; returning true closes the form without duplicating POST.
        await loadData({ initial: false });
        return true;
      }
      // Причину показывает сама форма плашкой над кнопкой, поэтому общего
      // уведомления нет: два сообщения об одном и том же только мешали бы.
      return { error: (data && data.message) || 'Не удалось сохранить операцию' };
    } catch (err) {
      console.error('Add error:', err);
      return { error: 'Не удалось сохранить операцию' };
    }
  };

  const mutationError = async (res, fallback) => {
    const data = await res.json().catch(() => null);
    return (data && data.message) || fallback;
  };

  const fetchTrash = async () => {
    const session = sessionGenerationRef.current;
    const generation = ++trashGenerationRef.current;
    const isCurrent = () => session === sessionGenerationRef.current
      && generation === trashGenerationRef.current;
    setTrashLoading(true);
    setTrashError('');
    try {
      const res = await apiFetch(TRASH_URL);
      if (!isCurrent()) return false;
      const data = await res.json().catch(() => null);
      if (!isCurrent()) return false;
      if (!res.ok || !Array.isArray(data)) {
        throw new DataLoadError((data && data.message) || 'Не удалось загрузить корзину');
      }
      setTrashGroups(data);
      setTrashLoaded(true);
      return true;
    } catch (err) {
      if (!isCurrent()) return false;
      console.error('Trash load error:', err);
      setTrashError(err instanceof DataLoadError ? err.message : 'Не удалось загрузить корзину');
      return false;
    } finally {
      if (isCurrent()) setTrashLoading(false);
    }
  };

  // Лист счёта принадлежит экрану «Счета»: уйти с него (системное «назад»,
  // вкладка) значит закрыть и лист, иначе он завис бы поверх чужого экрана.
  useEffect(() => {
    if (inner !== 'accounts') setAccountSheet(null);
  }, [inner]);

  // Корзина читается при каждом заходе на «Ещё» (ради счётчика в меню; заодно
  // подхватывает операции, удалённые на других вкладках) и при открытии самого
  // экрана корзины. Пока не вошли, ходить за ней рано.
  const trashScreenOpen = inner === 'trash';
  useEffect(() => {
    if (screen === 'more' && isAuthenticated === true) fetchTrash();
    // fetchTrash пересоздаётся на каждый рендер; важны только эти условия.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, trashScreenOpen, isAuthenticated]);

  const refreshAfterTrashMutation = async () => {
    await Promise.all([loadData({ initial: false }), fetchTrash()]);
  };

  const handleRestoreTrash = async (id) => {
    const session = sessionGenerationRef.current;
    try {
      const res = await apiFetch(`${TRASH_URL}/${id}/restore`, { method: 'POST' });
      if (session !== sessionGenerationRef.current) return { ok: false, error: 'Сессия завершена' };
      if (!res.ok) return { ok: false, error: await mutationError(res, 'Не удалось восстановить операции') };
      await refreshAfterTrashMutation();
      return { ok: true };
    } catch (err) {
      console.error('Restore trash error:', err);
      return { ok: false, error: 'Не удалось восстановить операции' };
    }
  };

  const handlePurgeTrash = async (id) => {
    const session = sessionGenerationRef.current;
    try {
      const res = await apiFetch(`${TRASH_URL}/${id}`, { method: 'DELETE' });
      if (session !== sessionGenerationRef.current) return { ok: false, error: 'Сессия завершена' };
      if (!res.ok) return { ok: false, error: await mutationError(res, 'Не удалось удалить операции навсегда') };
      await refreshAfterTrashMutation();
      return { ok: true };
    } catch (err) {
      console.error('Purge trash error:', err);
      return { ok: false, error: 'Не удалось удалить операции навсегда' };
    }
  };

  const showUndoDeletion = (trashId, count) => {
    if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
    undoDeletionIdRef.current = trashId;
    setUndoDeletion({ trashId, count, pending: false, error: '' });
    undoTimeoutRef.current = setTimeout(() => {
      if (undoDeletionIdRef.current !== trashId) return;
      undoDeletionIdRef.current = null;
      setUndoDeletion(null);
    }, 10000);
  };

  const handleUndoDeletion = async () => {
    if (!undoDeletion || undoDeletion.pending) return;
    const session = sessionGenerationRef.current;
    const trashId = undoDeletion.trashId;
    if (undoDeletionIdRef.current === trashId && undoTimeoutRef.current) {
      clearTimeout(undoTimeoutRef.current);
      undoTimeoutRef.current = null;
    }
    setUndoDeletion(current => current?.trashId === trashId ? { ...current, pending: true, error: '' } : current);
    try {
      const res = await apiFetch(`${TRASH_URL}/${trashId}/restore`, { method: 'POST' });
      if (session !== sessionGenerationRef.current) return;
      if (!res.ok) {
        if (undoDeletionIdRef.current === trashId) {
          setUndoDeletion(current => current?.trashId === trashId ? { ...current, pending: false, error: 'Не удалось восстановить. Попробуйте ещё раз.' } : current);
        }
        return;
      }
      if (undoDeletionIdRef.current === trashId) {
        if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
        undoDeletionIdRef.current = null;
        setUndoDeletion(null);
      }
      await loadData({ initial: false });
    } catch (err) {
      console.error('Undo delete error:', err);
      if (session === sessionGenerationRef.current) {
        if (undoDeletionIdRef.current === trashId) {
          setUndoDeletion(current => current?.trashId === trashId ? { ...current, pending: false, error: 'Не удалось восстановить. Попробуйте ещё раз.' } : current);
        }
      }
    }
  };

  const handleUpdateTransaction = async (updatedTx) => {
    const session = sessionGenerationRef.current;
    try {
      const res = await apiFetch(`${API_URL}/${updatedTx.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedTx)
      });
      if (session !== sessionGenerationRef.current) return false;
      if (res.status === 409) {
        return { error: 'Операция уже изменена. Обновите данные и повторите попытку.' };
      }
      if (res.ok) {
        await loadData({ initial: false });
        return true;
      }
      const data = await res.json().catch(() => null);
      return { error: (data && data.message) || 'Не удалось сохранить изменения' };
    } catch (err) {
      console.error('Update error:', err);
      return { error: 'Не удалось сохранить изменения' };
    }
  };

  const handleDeleteTransaction = async (id, splitId = null) => {
    const session = sessionGenerationRef.current;
    try {
      const url = splitId ? `${API_URL}/${id}?splitId=${splitId}` : `${API_URL}/${id}`;
      const res = await apiFetch(url, { method: 'DELETE' });
      if (session !== sessionGenerationRef.current) return false;
      if (res.ok) {
        const data = await res.json().catch(() => null);
        if (session !== sessionGenerationRef.current) return false;
        if (data?.trashId) showUndoDeletion(data.trashId, Number(data.count) || 1);
        await loadData({ initial: false });
        if (session !== sessionGenerationRef.current) return true;
        setEditingTransaction(null);
        return true;
      }
      const data = await res.json().catch(() => null);
      showNotice((data && data.message) || 'Не удалось удалить операцию');
      return false;
    } catch (err) {
      console.error('Delete error:', err);
      showNotice('Не удалось удалить операцию');
      return false;
    }
  };

  // Поля формы (имя, тип, значок, editingAccountId) хранит AccountEditSheet и
  // передаёт их аргументами: App владеет только данными счетов и самим
  // запросом. Возвращает, удалось ли сохранение, - лист закрывается только
  // при true.
  const handleSaveAccount = async ({ name, type, icon, excludeFromTotal, editingAccountId }) => {
    const session = sessionGenerationRef.current;
    try {
      let res;
      if (editingAccountId) {
        res = await apiFetch(`${ACCOUNTS_URL}/${editingAccountId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, icon, excludeFromTotal })
        });
      } else {
        res = await apiFetch(ACCOUNTS_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, type, icon, excludeFromTotal })
        });
      }

      if (session !== sessionGenerationRef.current) return false;
      if (res.ok) {
        await loadData({ initial: false });
        return true;
      } else {
        const err = await res.json();
        showNotice(err.message || 'Ошибка сохранения счёта');
        return false;
      }
    } catch (err) {
      console.error('Save account error:', err);
      return false;
    }
  };

  // Подтверждение удаления встроено в лист счёта (никакого confirm()), сюда
  // приходит уже решённое. Ответ сервера с причиной отказа (например, у счёта
  // есть операции) показывается уведомлением; лист закрывается только при true.
  const handleDeleteAccount = async (account) => {
    const session = sessionGenerationRef.current;
    try {
      const res = await apiFetch(`${ACCOUNTS_URL}/${account._id}`, { method: 'DELETE' });
      if (session !== sessionGenerationRef.current) return false;
      if (res.ok) {
        await loadData({ initial: false });
        return true;
      }
      const err = await res.json().catch(() => null);
      showNotice((err && err.message) || 'Не удалось удалить счёт');
      return false;
    } catch (err) {
      console.error('Delete account error:', err);
      showNotice('Не удалось удалить счёт');
      return false;
    }
  };

  // Переименование категории. Сервер вместе с самой категорией переписывает
  // и все операции с прежним названием (см. PUT /api/categories/:id), поэтому
  // после успеха перечитываются оба списка - иначе история и разбивка по
  // категориям остались бы со старым именем до перезагрузки страницы.
  const handleRenameCategory = async (category, newName) => {
    const trimmed = (newName || '').trim();
    if (!trimmed) {
      showNotice('Название категории не может быть пустым');
      return false;
    }
    if (trimmed === category.name) return true;

    const session = sessionGenerationRef.current;
    try {
      const res = await apiFetch(`${CATEGORIES_URL}/${category._id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed })
      });
      const data = await res.json().catch(() => null);
      if (session !== sessionGenerationRef.current) return false;
      if (!res.ok) {
        showNotice((data && data.message) || 'Не удалось переименовать категорию');
        return false;
      }
      const refreshed = await loadData({ initial: false });
      // The filter is string-based. Move it only when the matching refreshed
      // snapshot arrived; after a refresh failure keep the old snapshot
      // usable by clearing this one stale filter until Retry succeeds.
      setHistoryCategory(prev => prev === category.name ? (refreshed ? trimmed : null) : prev);
      showNotice('Категория переименована', 'success');
      return true;
    } catch (err) {
      console.error('Rename category error:', err);
      showNotice('Не удалось переименовать категорию');
      return false;
    }
  };

  // Удаление категории. История от этого не страдает: операция хранит
  // категорию строкой, поэтому строки в списке и разбивка по категориям
  // остаются как были - исчезает только чип в форме. Но раз операции всё же
  // осиротеют, счётчик показывается прямо в подтверждении - оно встроено в
  // строку экрана «Категории», поэтому сюда приходит уже решённое.
  const handleDeleteCategory = async (category) => {
    const session = sessionGenerationRef.current;
    try {
      const res = await apiFetch(`${CATEGORIES_URL}/${category._id}`, { method: 'DELETE' });
      if (session !== sessionGenerationRef.current) return false;
      if (res.ok) {
        // Фильтр мог стоять на только что удалённой категории - иначе экран
        // остался бы отфильтрованным по тому, чего больше нет в списке.
        setHistoryCategory(prev => prev === category.name ? null : prev);
        await loadData({ initial: false });
        return true;
      }
      const err = await res.json().catch(() => null);
      showNotice((err && err.message) || 'Не удалось удалить категорию');
      return false;
    } catch (err) {
      console.error('Delete category error:', err);
      showNotice('Не удалось удалить категорию');
      return false;
    }
  };

  // Saves the shared monthlyLimit to the server. Returns whether it
  // succeeded so the limit sheet knows whether to close.
  const handleSaveSettings = async (newLimit) => {
    const session = sessionGenerationRef.current;
    try {
      const res = await apiFetch(SETTINGS_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monthlyLimit: newLimit })
      });
      if (session !== sessionGenerationRef.current) return false;
      if (res.ok) {
        const saved = await res.json();
        if (session !== sessionGenerationRef.current) return false;
        setMonthlyLimit(typeof saved.monthlyLimit === 'number' ? saved.monthlyLimit : newLimit);
        await loadData({ initial: false });
        return true;
      } else {
        const err = await res.json();
        showNotice(err.message || 'Не удалось сохранить лимит');
        return false;
      }
    } catch (err) {
      console.error('Save settings error:', err);
      showNotice('Не удалось сохранить лимит');
      return false;
    }
  };

  // Logout lives in the «Ещё» menu rather than as new chrome on the main
  // screen. The POST clears the httpOnly cookie
  // server-side. Only drop to the login screen once that's actually
  // confirmed (an ok response) - if the request fails or errors, the cookie
  // is still valid, so switching the UI to "logged out" would be a lie: the
  // user would believe they're safely logged out (relevant on a shared/
  // borrowed device) while a refresh would silently restore access. Report
  // the failure instead and leave the authenticated state untouched so the
  // user knows to retry.
  const handleLogout = async () => {
    const session = sessionGenerationRef.current;
    try {
      const res = await fetch('/api/logout', { method: 'POST' });
      if (session !== sessionGenerationRef.current) return;
      if (res.ok) {
        // Вышли сами: «сессия закончилась» тут было бы неправдой.
        markUnauthenticated({ expired: false });
      } else {
        showNotice('Не удалось выйти. Попробуйте ещё раз.');
      }
    } catch (err) {
      console.error('Logout error:', err);
      showNotice('Не удалось выйти. Попробуйте ещё раз.');
    }
  };

  const openAddModal = (type) => {
    setTransactionType(type);
    setEditingTransaction(null);
    setShowAddTransaction(true);
  };

  const openEditModal = (tx) => {
    if (tx.type === 'initial') return;
    setEditingTransaction(tx);
    setShowAddTransaction(false);
  };

  const formatDate = (dateStr) => {
    const options = { weekday: 'long', day: 'numeric', month: 'long' };
    return new Date(dateStr + 'T12:00:00').toLocaleDateString('ru-RU', options);
  };

  const getAccountDisplay = (accountId) => {
    const acc = accounts.find(a => a._id === accountId);
    if (acc) {
      return acc.name;
    }
    if (accountId === 'card') return 'Карта';
    if (accountId === 'cash') return 'Наличные';
    return 'Неизвестно';
  };

  // Defensive against a bad stored monthlyLimit (0, negative, or non-finite -
  // the server now rejects saving those, but an old/unmigrated value could
  // still be sitting in the settings document). Dividing by such a limit
  // would otherwise render NaN% or Infinity% in the progress bar below.

  // One place decides what "income / expense / categories" mean for the
  // selected range, so the stats panel below only renders numbers.
  const periodStats = useMemo(() => {
    if (timeRange === 'year') return { income: yearlyData.income, expense: yearlyData.expense, categoryTotals: yearlyData.categoryTotals };
    if (timeRange === 'lifetime') return { income: lifetimeStats?.income || 0, expense: lifetimeStats?.expense || 0, categoryTotals: lifetimeStats?.categoryTotals || {} };
    return { income: monthlyData.income, expense: monthlyData.expense, categoryTotals: monthlyData.categoryTotals };
  }, [timeRange, monthlyData, yearlyData, lifetimeStats]);

  // Expense of this month vs the same stretch of the previous one. For the
  // current month the server (comparisonData) cuts the previous month at today's day
  // number (comparing like with like); for a past month it compares whole
  // months, and the wording below follows that split.
  const expenseComparison = useMemo(() => {
    const previous = comparisonData.expense;
    const diff = Math.abs(monthlyData.expense) - previous;
    return {
      previous,
      diff,
      percent: previous > 0 ? Math.round((diff / previous) * 100) : null,
      label: isActualCurrentMonth
        ? `на ${comparisonData.prevMonthDayLabel} было ${formatMoney(previous)}`
        : `весь ${comparisonData.prevMonthName} — ${formatMoney(previous)}`
    };
  }, [comparisonData, monthlyData.expense, isActualCurrentMonth]);

  // "к 15 января" / "к декабрю" - подпись над изменениями по категориям.
  // Reuses the fields comparisonData already carries rather than
  // recomputing the same "current vs past month" split. prevMonthDayLabel is
  // already in the genitive the day form needs, while the bare month name
  // arrives nominative and has to be declined.
  const comparisonLabel = `к ${isActualCurrentMonth ? comparisonData.prevMonthDayLabel : toDativeMonth(comparisonData.prevMonthName)}`;
  const lastSyncLabel = lastSuccessfulSync
    ? lastSuccessfulSync.toLocaleString('ru-RU', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })
    : null;
  const syncStatus = formatSyncStatus(lastSuccessfulSync, lastSyncLabel);

  // Общие для Обзора и Аналитики пропсы обёртки сводки (см.
  // screens/SummaryFrame): ожидание данных считается здесь.
  const summaryFrame = {
    pending: summaryPending,
    ready: statsReady,
    syncWarning,
    isRefreshing,
  };

  // isAuthenticated === false is the one state that always wins: a 401 mid-
  // session (expired/cleared cookie) must return the user to the login
  // screen even if data from before is still sitting in state.
  if (isAuthenticated === false) {
    return <LoginScreen onSuccess={beginAuthenticatedSession} sessionExpired={sessionExpired} />;
  }

  if (initialLoadError && !hasSnapshotRef.current) {
    return (
      <CenteredCardScreen role="alert" icon={<CloudOff size={26} />} title="Не удалось загрузить данные">
        <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 'var(--text-md)' }}>
          {initialLoadError}. Проверьте интернет и попробуйте ещё раз. Операции хранятся на сервере и никуда не пропали.
        </p>
        <Button
          block
          disabled={isRetrying}
          onClick={() => loadData({ initial: true, retry: true })}
          style={{ minHeight: '54px', fontSize: 'var(--text-lg)' }}
        >
          {isRetrying ? 'Повтор…' : 'Повторить'}
        </Button>
        {lastAttemptAt && (
          <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
            Последняя попытка в {lastAttemptAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
          </p>
        )}
      </CenteredCardScreen>
    );
  }

  if (isLoading || isAuthenticated === null) return <AppSkeleton />;

  return (
    <div className="layout-container">
      {/* Сообщение об ошибке или успехе. Если рядом висит тост «Операция в
          корзине», сообщение встаёт над ним, а не поверх. */}
      {notice && (
        <Toast
          message={notice.message}
          tone={notice.type === 'success' ? 'neutral' : 'danger'}
          bottomOffset={TOAST_BOTTOM + (undoDeletion ? TOAST_STACK_STEP : 0)}
          onClose={() => {
            if (noticeTimeoutRef.current) clearTimeout(noticeTimeoutRef.current);
            setNotice(null);
          }}
        />
      )}
      {undoDeletion && (
        <Toast
          message={undoDeletion.error || (undoDeletion.count > 1 ? `В корзине операций: ${undoDeletion.count}` : 'Операция в корзине')}
          tone={undoDeletion.error ? 'danger' : 'neutral'}
          bottomOffset={TOAST_BOTTOM}
          action={{
            label: undoDeletion.pending ? 'Восстановление…' : 'Отменить',
            onClick: handleUndoDeletion,
            disabled: undoDeletion.pending,
          }}
        />
      )}
      {/* Ровно один экран за раз. Состояние и обработчики остаются здесь, экраны
          получают их пропсами. Внизу страницы - запас под нижнюю навигацию
          (она fixed и из потока выпала); у Истории запаса нет, потому что её
          высота уже посчитана под панель и страница на этой вкладке не
          листается. */}
      <main style={{
        paddingBottom: screen === 'history' ? 0 : `calc(${NAV_OFFSET} + var(--space-4))`,
        '--status-strip-height': `${syncWarning ? statusStripHeight : 0}px`,
      }}>
        {/* Данные загружены, но обновить не вышло: тонкая полоса на любом
            экране, без красной карточки. Отступ под ней сделан padding, а не
            margin, чтобы он входил в измеренную высоту. */}
        {syncWarning && (
          <div ref={statusStripRef} style={{ paddingBottom: 'var(--space-3)' }}>
            <InlineAlert
              tone="warning"
              action={{
                label: isRefreshing ? 'Обновление…' : 'Повторить',
                disabled: isRefreshing,
                onClick: () => loadData({ initial: false }),
              }}
            >
              {lastSyncLabel
                ? `Не удалось обновить. Показаны данные на ${lastSyncLabel}`
                : 'Не удалось обновить.'}
            </InlineAlert>
          </div>
        )}
        {screen === 'overview' && (
          <OverviewScreen
            // При неудачном обновлении о свежести данных говорит строка
            // сверху, и галочка «Обновлено» рядом с ней противоречила бы ей.
            syncStatus={syncWarning ? null : syncStatus}
            slides={slides}
            selectedAccount={selectedAccount}
            onSelectAccount={handleSelectAccount}
            onOpenAccountsSettings={() => openInner('accounts')}
            summaryFrame={summaryFrame}
            timeRange={timeRange}
            selectedMonth={selectedMonth}
            monthlyTotals={monthlyTotals}
            periodStats={periodStats}
            monthlyLimit={monthlyLimit}
            typicalMonth={summary?.typicalMonth ?? null}
            onChangePeriod={handlePeriodChange}
            onOpenHistory={openHistoryOfType}
            onOpenAllHistory={() => setScreen('history')}
            onOpenPreviousMonth={(month) => handlePeriodChange({ timeRange: 'month', selectedMonth: month })}
            onAddExpense={() => openAddModal('expense')}
            request={apiFetch}
            historyRevision={historyRevision}
            openEditModal={openEditModal}
            getAccountDisplay={getAccountDisplay}
            formatDate={formatDate}
          />
        )}
        {screen === 'history' && (
          <HistoryScreen
            history={history}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            initialMonth={historyMonth}
            positionKey={selectedMonth}
            onSelectMonth={setHistoryMonth}
            accounts={accounts}
            categories={categories}
            historyAccount={historyAccount}
            setHistoryAccount={setHistoryAccount}
            historyCategory={historyCategory}
            setHistoryCategory={setHistoryCategory}
            historyType={historyType}
            setHistoryType={setHistoryType}
            exportToCSV={exportToCSV}
            isExporting={isExporting}
            openEditModal={openEditModal}
            getAccountDisplay={getAccountDisplay}
            formatDate={formatDate}
            positionRef={historyPositionRef}
          />
        )}
        {screen === 'analytics' && (
          <AnalyticsScreen
            summaryFrame={summaryFrame}
            periodStats={periodStats}
            timeRange={timeRange}
            onChangePeriod={handlePeriodChange}
            typicalMonth={summary?.typicalMonth ?? null}
            monthlyLimit={monthlyLimit}
            series={monthlySeries}
            selectedMonth={selectedMonth}
            onSelectMonth={(month) => handlePeriodChange({ timeRange: 'month', selectedMonth: month })}
            expenseComparison={expenseComparison}
            categoryComparison={categoryComparison}
            comparisonLabel={comparisonLabel}
            onOpenCategory={openHistoryOfCategory}
          />
        )}
        {screen === 'more' && !inner && (
          <MoreScreen
            monthlyLimit={monthlyLimit}
            accountsCount={accounts.length}
            categoriesCount={categories.length}
            trashCount={trashLoaded ? trashGroups.length : null}
            lastSyncLabel={lastSyncLabel}
            isRefreshing={isRefreshing}
            isExporting={isExporting}
            onOpenLimit={() => setShowLimit(true)}
            onOpenAccounts={() => openInner('accounts')}
            onOpenCategories={() => openInner('categories')}
            onOpenTrash={() => openInner('trash')}
            onOpenBanking={bankingEnabled ? openBanking : undefined}
            pendingBankingCount={banking?.pendingReviewCount || 0}
            onRefresh={() => loadData({ initial: false })}
            onExport={exportToCSV}
            onLogout={handleLogout}
          />
        )}
        {screen === 'more' && inner === 'accounts' && (
          <AccountsScreen
            accounts={accounts}
            balances={balances}
            onBack={closeInner}
            onAdd={() => setAccountSheet('new')}
            onEdit={setAccountSheet}
            onDragEnd={onAccountDragEnd}
          />
        )}
        {screen === 'more' && inner === 'categories' && (
          <CategoriesScreen
            categories={categories}
            categoryUsage={categoryUsage}
            onBack={closeInner}
            onAdd={handleAddCategoryFromScreen}
            onRename={handleRenameCategory}
            onDelete={handleDeleteCategory}
          />
        )}
        {screen === 'more' && inner === 'trash' && (
          <TrashScreen
            groups={trashGroupsWithNames}
            loading={trashLoading && !trashLoaded}
            error={trashError}
            onBack={closeInner}
            onRetry={fetchTrash}
            onRestore={handleRestoreTrash}
            onPurge={handlePurgeTrash}
          />
        )}
      </main>

      <BottomNav active={screen} onChange={setScreen} onAdd={() => openAddModal('expense')} />

      {showAddTransaction && (
        <AddTransactionForm
          apiFetch={apiFetch}
          type={transactionType}
          categories={categories}
          onAddCategory={handleAddCategory}
          onClose={() => setShowAddTransaction(false)}
          onSubmit={handleAddTransaction}
          accounts={accounts}
          categoryCounts={dashboard?.data.categoryCounts}
          monthlyLimit={monthlyLimit}
          monthExpense={formMonthExpense}
          // Only a real account id preselects - the total-capital slide
          // (null) and any residual type:* filter value must fall through
          // to no preset, forcing an explicit choice.
          presetAccountId={accounts.some(a => a._id === selectedAccount) ? selectedAccount : undefined}
        />
      )}
      {editingTransaction && <AddTransactionForm apiFetch={apiFetch} initialData={editingTransaction} categories={categories} onAddCategory={handleAddCategory} onClose={() => setEditingTransaction(null)} onSubmit={handleUpdateTransaction} onDelete={(id) => handleDeleteTransaction(id, editingTransaction.splitId)} accounts={accounts} categoryCounts={dashboard?.data.categoryCounts} />}

      {accountSheet && (
        <AccountEditSheet
          key={accountSheet === 'new' ? 'new' : accountSheet._id}
          account={accountSheet === 'new' ? null : accountSheet}
          onClose={() => setAccountSheet(null)}
          onSave={handleSaveAccount}
          onDelete={handleDeleteAccount}
        />
      )}
      {showLimit && (
        <LimitSheet
          monthlyLimit={monthlyLimit}
          series={limitSeries}
          currentMonth={getCurrentMonth()}
          onClose={() => setShowLimit(false)}
          onSave={handleSaveLimit}
        />
      )}
      {bankingEnabled && showBanking && (
        <BankingSheet
          data={banking}
          review={bankingReview}
          accounts={accounts}
          categories={categories}
          loading={bankingLoading}
          error={bankingError}
          onClose={() => {
            bankingGenerationRef.current += 1;
            bankingReadInFlightRef.current = null;
            setShowBanking(false);
            setBankingLoading(false);
          }}
          onRetry={() => fetchBanking({ includeReview: true })}
          onConnect={handleConnectBank}
          onMapAccount={(id, accountId) => mutateBanking(`/accounts/${encodeURIComponent(id)}/mapping`, 'PUT', { accountId }, { refreshBudget: true })}
          onSync={id => mutateBanking(`/connections/${encodeURIComponent(id)}/sync`, 'POST', null, { refreshBudget: true })}
          onDisconnect={id => mutateBanking(`/connections/${encodeURIComponent(id)}`, 'DELETE')}
          onResolve={(id, fields) => mutateBanking(`/review/${encodeURIComponent(id)}/resolve`, 'POST', fields, { refreshBudget: true, resolvedEntryId: id })}
        />
      )}
    </div>
  );
}

export default App;
