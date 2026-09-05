import { useState, useMemo, useEffect, useRef } from 'react'
import AddTransactionForm from './components/AddTransactionForm'
import AnalyticsView from './components/AnalyticsView'
import LoginScreen from './components/LoginScreen'
import TransactionsDrawer, { PEEK_HEIGHT } from './components/TransactionsDrawer'
import AccountsSettingsModal from './components/AccountsSettingsModal'
import BottomTabs, { TAB_BAR_RESERVED_HEIGHT } from './components/BottomTabs'
import PeriodPicker from './components/PeriodPicker'
import SummaryCard from './components/SummaryCard'
import PlannedPaymentsView from './components/PlannedPaymentsView'
import TrashSheet from './components/TrashSheet'
import IconButton from './components/ui/IconButton'
import { formatPeriodLabel, toDativeMonth, listPeriodMonths, formatMonthName } from './utils/period'
import { transformTransactions, calculateBalances, getMonthlyData, getPeriodData, getPeriodPrefix, getYearlyData, getLifetimeStats, getSearchResults, getCategoryUsage, getComparisonData, getMonthlySeries, getCategoryComparison, getPaceForecast, getMonthlyTotals } from './utils/finance'
import { handleAccountDragEnd } from './utils/accountReorder'
import useSnapCarousel from './utils/useSnapCarousel'

// API URL - relative path for production data fetching
const API_URL = '/api/transactions';
const CATEGORIES_URL = '/api/categories';
const ACCOUNTS_URL = '/api/accounts';
const SETTINGS_URL = '/api/settings';
const PLANNED_PAYMENTS_URL = '/api/planned-payments';
const TRASH_URL = '/api/trash';
// Used until the server's settings document has loaded (or if it 404s on an
// older deployment) - mirrors the server's own default in server/app.js.
const DEFAULT_MONTHLY_LIMIT = 7000;

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
  const [syncWarning, setSyncWarning] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastSuccessfulSync, setLastSuccessfulSync] = useState(null);
  const [plannedPayments, setPlannedPayments] = useState([]);
  const [trashGroups, setTrashGroups] = useState([]);
  const [trashLoading, setTrashLoading] = useState(false);
  const [trashError, setTrashError] = useState('');
  const [showTrash, setShowTrash] = useState(false);
  const [undoDeletion, setUndoDeletion] = useState(null);
  const sessionGenerationRef = useRef(0);
  const loadGenerationRef = useRef(0);
  const trashGenerationRef = useRef(0);
  const hasSnapshotRef = useRef(false);
  const undoTimeoutRef = useRef(null);
  const undoDeletionIdRef = useRef(null);

  // Auth: null = "don't know yet" (still checking / never asked), true =
  // logged in, false = show the login screen. Deliberately not persisted to
  // localStorage - the httpOnly session cookie is the only source of truth,
  // and this state is just the UI's best current guess at what that cookie
  // says, driven entirely by 401 responses from the API (see apiFetch below).
  const [isAuthenticated, setIsAuthenticated] = useState(null);

  // State for selected. Defaults to current month YYYY-MM
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));
  // Which of the two bottom tabs is showing. 'stats' is the default screen
  // (spending ring, income/saldo, top categories); 'analytics' is the
  // category breakdown donut.
  const [summaryView, setSummaryView] = useState('stats'); // 'stats' or 'analytics'
  const [timeRange, setTimeRange] = useState('month'); // 'month' or 'lifetime'

  // Accounts state
  const [accounts, setAccounts] = useState([]);
  const accountsRef = useRef([]);
  useEffect(() => {
    accountsRef.current = accounts;
  }, [accounts]);
  const [showAccountsSettings, setShowAccountsSettings] = useState(false);

  // Monthly spending limit, driving the limit progress bar in the stats
  // panel. Shared across devices via GET/PUT /api/settings rather than
  // per-browser, so it starts at the server's own default until that fetch
  // resolves (see loadData below).
  const [monthlyLimit, setMonthlyLimit] = useState(DEFAULT_MONTHLY_LIMIT);

  // In-app notice banner, replacing blocking alert()s for errors raised by
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
  const [transactions, setTransactions] = useState([]);
  const [categories, setCategories] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [selectedType, setSelectedType] = useState(null);

  // Bottom drawer (transaction history) - collapsed by default, App owns
  // the expanded/collapsed state since the drawer is a controlled component.
  const [historyDrawerExpanded, setHistoryDrawerExpanded] = useState(false);

  // Прокрутку под раскрытой шторкой истории здесь больше не трогаем: этим
  // занимается сама шторка (useBodyScrollLock в utils/), тем же замком, что
  // и модальные листы. Владелец у стилей body должен быть один - иначе,
  // когда шторка и лист открыты одновременно, закрытие любого из них
  // затирало бы замок другого. Раньше отсюда выставлялся только
  // `overflow: hidden`, а его в мобильном Safari мало: касание он не
  // останавливает, и палец, ведущий по размытому фону, продолжал двигать
  // страницу под шторкой.

  const clearPrivateData = () => {
    if (noticeTimeoutRef.current) clearTimeout(noticeTimeoutRef.current);
    setNotice(null);
    setAccounts([]);
    accountsRef.current = [];
    setTransactions([]);
    setCategories([]);
    setPlannedPayments([]);
    setTrashGroups([]);
    setTrashError('');
    setTrashLoading(false);
    setShowTrash(false);
    setUndoDeletion(null);
    undoDeletionIdRef.current = null;
    trashGenerationRef.current += 1;
    if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
    undoTimeoutRef.current = null;
    setMonthlyLimit(DEFAULT_MONTHLY_LIMIT);
    setSelectedAccount(null);
    setSelectedCategory(null);
    setSelectedType(null);
    setSearchQuery('');
    setEditingTransaction(null);
    setShowAddTransaction(false);
    setShowAccountsSettings(false);
    setHistoryDrawerExpanded(false);
    setLastSuccessfulSync(null);
    setSyncWarning(null);
    setInitialLoadError(null);
    hasSnapshotRef.current = false;
  };

  const markUnauthenticated = () => {
    sessionGenerationRef.current += 1;
    loadGenerationRef.current += 1;
    clearPrivateData();
    setIsRefreshing(false);
    setIsLoading(false);
    setIsAuthenticated(false);
  };

  // Thin fetch wrapper used for every /api/* call. A 401 means the session
  // cookie is missing/expired - flip to the login screen right away rather
  // than letting each call site duplicate that check. This is the single
  // place that drives isAuthenticated back to false mid-session.
  const apiFetch = async (url, options) => {
    const requestSession = sessionGenerationRef.current;
    const res = await fetch(url, options);
    if (res.status === 401 && requestSession === sessionGenerationRef.current) {
      markUnauthenticated();
    }
    return res;
  };

  const readJson = async (url, fallbackMessage, { allowMissing = false } = {}) => {
    const res = await apiFetch(url);
    if (res.status === 401) throw new DataLoadError('Требуется повторный вход');
    if (allowMissing && res.status === 404) return null;
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new DataLoadError((data && data.message) || fallbackMessage);
    if (data === null) throw new DataLoadError(fallbackMessage);
    return data;
  };

  // Loads one complete UI data set. Accounts stay first because both auth and
  // transaction transformation depend on them; the remaining resources are
  // independent and begin together. State is committed only after every
  // critical response succeeds, so the UI never mixes partial load results.
  const loadData = async ({ initial = !hasSnapshotRef.current } = {}) => {
    const session = sessionGenerationRef.current;
    const generation = ++loadGenerationRef.current;
    const isCurrent = () => session === sessionGenerationRef.current
      && generation === loadGenerationRef.current;

    if (initial) {
      setIsLoading(true);
      setInitialLoadError(null);
    } else {
      setIsRefreshing(true);
    }

    try {
      const loadedAccounts = await readJson(ACCOUNTS_URL, 'Не удалось загрузить счета');
      if (!Array.isArray(loadedAccounts)) throw new DataLoadError('Сервер вернул некорректный список счетов');
      if (!isCurrent()) return false;

      const [rawTransactions, loadedCategories, loadedSettings, loadedPlannedPayments] = await Promise.all([
        readJson(API_URL, 'Не удалось загрузить операции'),
        readJson(CATEGORIES_URL, 'Не удалось загрузить категории'),
        // Compatibility with deployments from before shared settings: a 404
        // means the documented default, while network/5xx failures still make
        // the whole snapshot unsuccessful.
        readJson(SETTINGS_URL, 'Не удалось загрузить настройки', { allowMissing: true }),
        readJson(PLANNED_PAYMENTS_URL, 'Не удалось загрузить предстоящие платежи'),
      ]);
      if (!Array.isArray(rawTransactions)) throw new DataLoadError('Сервер вернул некорректный список операций');
      if (!Array.isArray(loadedCategories)) throw new DataLoadError('Сервер вернул некорректный список категорий');
      if (!Array.isArray(loadedPlannedPayments)) throw new DataLoadError('Сервер вернул некорректный список платежей');
      if (loadedSettings !== null && (
        typeof loadedSettings !== 'object'
        || typeof loadedSettings.monthlyLimit !== 'number'
        || !Number.isFinite(loadedSettings.monthlyLimit)
        || loadedSettings.monthlyLimit <= 0
      )) {
        throw new DataLoadError('Сервер вернул некорректные настройки');
      }
      if (!isCurrent()) return false;

      const nextLimit = loadedSettings === null ? DEFAULT_MONTHLY_LIMIT : loadedSettings.monthlyLimit;
      setAccounts(loadedAccounts);
      accountsRef.current = loadedAccounts;
      setTransactions(transformTransactions(rawTransactions, loadedAccounts));
      setCategories(loadedCategories);
      setPlannedPayments(loadedPlannedPayments);
      setMonthlyLimit(nextLimit);
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
      }
      return false;
    } finally {
      if (isCurrent()) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  };

  const beginAuthenticatedSession = () => {
    sessionGenerationRef.current += 1;
    loadGenerationRef.current += 1;
    clearPrivateData();
    setIsAuthenticated(null);
    loadData({ initial: true });
  };

  // Fetch data on mount.
  useEffect(() => {
    loadData({ initial: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Calculate current balances (Total lifetime) - stays persistent
  const balances = useMemo(() => calculateBalances(transactions, accounts), [transactions, accounts]);

  // Declarative slide list for the header balance carousel: total capital,
  // then one slide per individual account. The type-group slides
  // ('type:card' / 'type:cash') were dropped from the carousel - that
  // split is now shown as a static line in the stats block instead - but
  // the filter values themselves remain valid (see getAccountFilterLabel
  // and the filtering utilities in utils/finance.js), simply unreachable
  // from here.
  const slides = useMemo(() => {
    const base = [
      {
        key: 'total',
        icon: '💰',
        name: 'Общий капитал',
        amount: balances.total,
        filter: null,
        // Деньги на "замороженных" счетах в капитал не входят, но и молча
        // пропадать не должны - показываем их отдельной строкой помельче.
        note: balances.held ? `${balances.held.toLocaleString('de-DE', { minimumFractionDigits: 2 })} € заморожено` : null,
      },
    ];
    const toSlide = (acc) => ({
      key: acc._id,
      icon: acc.icon || (acc.type === 'cash' ? '💵' : '💳'),
      name: acc.name,
      amount: balances.byAccount[acc._id] || 0,
      filter: acc._id,
      note: acc.excludeFromTotal ? 'вне общего капитала' : null,
    });
    // Замороженные счета уезжают в конец карусели: до них доходят редко, а
    // между повседневными картами они были бы лишней остановкой при свайпе.
    const spendable = accounts.filter(acc => !acc.excludeFromTotal).map(toSlide);
    const held = accounts.filter(acc => acc.excludeFromTotal).map(toSlide);
    return [...base, ...spendable, ...held];
  }, [accounts, balances]);

  // Filter transactions for the selected month and account/category/type
  const monthlyData = useMemo(() => getMonthlyData(transactions, selectedMonth, selectedAccount, selectedCategory, selectedType), [transactions, selectedMonth, selectedAccount, selectedCategory, selectedType]);

  // The history list follows the period picker, not just the month: on
  // "Год" it covers the whole year and on "Всё время" the whole history,
  // while monthlyData above stays monthly for the limit and pace math.
  const periodData = useMemo(
    () => getPeriodData(transactions, getPeriodPrefix(timeRange, selectedMonth), selectedAccount, selectedCategory, selectedType),
    [transactions, timeRange, selectedMonth, selectedAccount, selectedCategory, selectedType]
  );

  // Yearly data with filters
  const yearlyData = useMemo(() => getYearlyData(transactions, selectedMonth, selectedAccount, selectedCategory), [transactions, selectedMonth, selectedAccount, selectedCategory]);

  // Calculate lifetime stats with filters
  const lifetimeStats = useMemo(() => getLifetimeStats(transactions, '2025-11-09', selectedAccount, selectedCategory), [transactions, selectedAccount, selectedCategory]);

  // Сколько операций ссылается на каждую категорию - показывается в
  // настройках рядом с кнопкой удаления.
  const categoryUsage = useMemo(() => getCategoryUsage(transactions), [transactions]);

  // Search results with filters
  const searchResults = useMemo(() => getSearchResults(transactions, searchQuery, selectedAccount, selectedCategory, selectedType), [transactions, searchQuery, selectedAccount, selectedCategory, selectedType]);

  // Comparison data for indicators
  const comparisonData = useMemo(() => getComparisonData(transactions, selectedMonth), [transactions, selectedMonth]);

  // Bar-chart series for the Аналитика tab: 6 trailing months in the
  // month view, a full year's worth when looking at a year/lifetime total.
  const monthlySeries = useMemo(
    () => getMonthlySeries(transactions, selectedMonth, timeRange === 'month' ? 6 : 12, selectedAccount, selectedCategory),
    [transactions, selectedMonth, timeRange, selectedAccount, selectedCategory]
  );

  // Per-category month-over-month deltas, shown next to the donut legend.
  const categoryComparison = useMemo(
    () => getCategoryComparison(transactions, selectedMonth, selectedAccount),
    [transactions, selectedMonth, selectedAccount]
  );

  const isActualCurrentMonth = useMemo(() => {
    const now = new Date();
    const currentMonthStr = now.toISOString().slice(0, 7);
    return selectedMonth === currentMonthStr;
  }, [selectedMonth]);

  // Карусель счетов: вся механика прокрутки со снапом - в useSnapCarousel,
  // она же обслуживает карусель месяцев ниже. Здесь остаётся только то, что
  // значит выбор слайда именно для счетов - фильтр по счёту.
  const accountCarousel = useSnapCarousel({
    onSettle: (index) => {
      const filter = slides[index]?.filter ?? null;
      setSelectedAccount(prev => (prev === filter ? prev : filter));
    },
  });

  // Нажатие на слайд всегда выбирает его - без «нажать ещё раз, чтобы
  // снять»: ровно один слайд активен в любой момент.
  const handleSlideClick = (slide, index) => {
    setSelectedAccount(prev => (prev === slide.filter ? prev : slide.filter));
    accountCarousel.scrollToIndex(index);
  };

  // Keep the carousel in sync with filter changes that didn't originate from
  // the carousel itself (the "reset filter" control, or an account that got
  // deleted out from under the current selection). Also resets a selection
  // that no longer matches any slide.
  useEffect(() => {
    if (selectedAccount && !slides.some(s => s.filter === selectedAccount)) {
      setSelectedAccount(null);
      return;
    }
    const index = slides.findIndex(s => s.filter === selectedAccount);
    if (index === -1) return;
    accountCarousel.scrollToIndex(index, { skipIfSynced: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccount, slides]);

  const toggleCategoryFilter = (category) => {
    setSelectedCategory(prev => prev === category ? null : category);
  };

  const toggleTypeFilter = (type) => {
    setSelectedType(prev => prev === type ? null : type);
  };

  // Both halves of "which period am I looking at" move together, from the
  // one PeriodPicker chip - picking a year has to land on a concrete month
  // too, because getYearlyData derives its year from selectedMonth.
  const handlePeriodChange = ({ timeRange: nextRange, selectedMonth: nextMonth }) => {
    setTimeRange(nextRange);
    setSelectedMonth(nextMonth);
  };

  const exportToCSV = () => {
    const headers = ['Дата', 'Название', 'Тип', 'Категория', 'Счет', 'Сумма', 'Описание'];
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
      t.description || ''
    ]);

    const csvContent = [headers.join(','), ...rows.map(row => row.map(escapeCsv).join(','))].join('\n');
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = `budget_report_${selectedMonth}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 100);
  };

  const handleAddTransaction = async (newTx) => {
    const session = sessionGenerationRef.current;
    try {
      const res = await apiFetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newTx)
      });
      if (session !== sessionGenerationRef.current) return false;
      if (res.ok) {
        // The write is already durable. If the following GET refresh fails,
        // loadData keeps the old snapshot and exposes a retry that performs
        // GETs only; returning true closes the form without duplicating POST.
        await loadData({ initial: false });
        return true;
      }
      const data = await res.json().catch(() => null);
      showNotice((data && data.message) || 'Не удалось сохранить операцию');
      return false;
    } catch (err) {
      console.error('Add error:', err);
      showNotice('Не удалось сохранить операцию');
      return false;
    }
  };

  const mutationError = async (res, fallback) => {
    const data = await res.json().catch(() => null);
    return (data && data.message) || fallback;
  };

  const handleCreatePlannedPayment = async (fields) => {
    const session = sessionGenerationRef.current;
    try {
      const res = await apiFetch(PLANNED_PAYMENTS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      });
      if (session !== sessionGenerationRef.current) return { ok: false, error: 'Сессия завершена' };
      if (!res.ok) return { ok: false, error: await mutationError(res, 'Не удалось сохранить платёж') };
      await loadData({ initial: false });
      return { ok: true };
    } catch (err) {
      console.error('Create planned payment error:', err);
      return { ok: false, error: 'Не удалось сохранить платёж' };
    }
  };

  const handleUpdatePlannedPayment = async (payment, fields) => {
    const session = sessionGenerationRef.current;
    try {
      const res = await apiFetch(`${PLANNED_PAYMENTS_URL}/${payment._id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ __v: Number.isInteger(payment.__v) ? payment.__v : 0, ...fields }),
      });
      if (session !== sessionGenerationRef.current) return { ok: false, error: 'Сессия завершена' };
      if (!res.ok) {
        const fallback = res.status === 409
          ? 'Платёж уже изменён. Обновите данные и повторите попытку.'
          : 'Не удалось изменить платёж';
        return { ok: false, error: await mutationError(res, fallback) };
      }
      await loadData({ initial: false });
      return { ok: true };
    } catch (err) {
      console.error('Update planned payment error:', err);
      return { ok: false, error: 'Не удалось изменить платёж' };
    }
  };

  const handlePayPlannedPayment = async (payment, fields) => {
    const session = sessionGenerationRef.current;
    try {
      const res = await apiFetch(`${PLANNED_PAYMENTS_URL}/${payment._id}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ __v: Number.isInteger(payment.__v) ? payment.__v : 0, ...fields }),
      });
      if (session !== sessionGenerationRef.current) return { ok: false, error: 'Сессия завершена' };
      if (!res.ok) {
        const fallback = res.status === 409
          ? 'Платёж уже изменён. Обновите данные и повторите попытку.'
          : 'Не удалось оплатить платёж';
        return { ok: false, error: await mutationError(res, fallback) };
      }
      await loadData({ initial: false });
      return { ok: true };
    } catch (err) {
      console.error('Pay planned payment error:', err);
      return { ok: false, error: 'Не удалось оплатить платёж' };
    }
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

  const openTrash = () => {
    setShowAccountsSettings(false);
    setShowTrash(true);
    fetchTrash();
  };

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
        showNotice('Операция уже изменена. Обновите данные и повторите попытку.');
        return false;
      }
      if (res.ok) {
        await loadData({ initial: false });
        return true;
      }
      const data = await res.json().catch(() => null);
      showNotice((data && data.message) || 'Не удалось сохранить изменения');
      return false;
    } catch (err) {
      console.error('Update error:', err);
      showNotice('Не удалось сохранить изменения');
      return false;
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

  // formName/formType/formIcon/editingAccountId are local UI state owned by
  // AccountsSettingsModal now - it passes them in as arguments rather than
  // this function reading them off App state, since App only owns the
  // accounts data and the API mutation itself. Returns whether the save
  // succeeded so the modal knows whether to reset its form.
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

  const handleDeleteAccount = async (id, name) => {
    if (!confirm(`Вы уверены, что хотите удалить счёт "${name}"?`)) return;

    const session = sessionGenerationRef.current;
    try {
      const res = await apiFetch(`${ACCOUNTS_URL}/${id}`, { method: 'DELETE' });
      if (session !== sessionGenerationRef.current) return;
      if (res.ok) {
        await loadData({ initial: false });
      } else {
        const err = await res.json();
        showNotice(err.message || 'Не удалось удалить счёт');
      }
    } catch (err) {
      console.error('Delete account error:', err);
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
      setSelectedCategory(prev => prev === category.name ? (refreshed ? trimmed : null) : prev);
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
  // осиротеют, счётчик показывается прямо в подтверждении.
  const handleDeleteCategory = async (category, usedCount) => {
    const warning = usedCount > 0
      ? `\n\nЭту категорию используют операций: ${usedCount}. Они останутся в истории с прежним названием, но выбрать категорию заново будет нельзя.`
      : '';
    if (!confirm(`Удалить категорию "${category.name}"?${warning}`)) return;

    const session = sessionGenerationRef.current;
    try {
      const res = await apiFetch(`${CATEGORIES_URL}/${category._id}`, { method: 'DELETE' });
      if (session !== sessionGenerationRef.current) return;
      if (res.ok) {
        // Фильтр мог стоять на только что удалённой категории - иначе экран
        // остался бы отфильтрованным по тому, чего больше нет в списке.
        setSelectedCategory(prev => prev === category.name ? null : prev);
        await loadData({ initial: false });
      } else {
        const err = await res.json().catch(() => null);
        showNotice((err && err.message) || 'Не удалось удалить категорию');
      }
    } catch (err) {
      console.error('Delete category error:', err);
      showNotice('Не удалось удалить категорию');
    }
  };

  // Saves the shared monthlyLimit to the server. Returns whether it
  // succeeded so the modal knows whether to surface a success notice.
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

  // Logout lives in the "Настройки" settings modal rather than as
  // new chrome on the main screen. The POST clears the httpOnly cookie
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
        markUnauthenticated();
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
      return `${acc.icon || '💳'} ${acc.name}`;
    }
    if (accountId === 'card') return '💳 Карта';
    if (accountId === 'cash') return '💵 Наличные';
    return '❓ Неизвестно';
  };

  // Single source of truth for the "Счет" account-filter label, shared by
  // the active-filter chip and the drawer's contextual title so they can
  // never disagree.
  const getAccountFilterLabel = (accountFilter) => {
    if (accountFilter === 'type:card') return 'Все карты';
    if (accountFilter === 'type:cash') return 'Все наличные';
    return accounts.find(a => a._id === accountFilter)?.name || accountFilter;
  };

  const historyDrawerTitle = selectedAccount
    ? `Список операций «${getAccountFilterLabel(selectedAccount)}»`
    : 'Список операций';

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

  // Месяцы, по которым листается карточка сводки, и итоги по каждому. Список
  // тот же, что предлагает чип периода, - иначе свайп уводил бы туда, куда
  // через чип не попасть.
  const carouselMonths = useMemo(() => listPeriodMonths(), []);
  const monthlyTotals = useMemo(
    () => getMonthlyTotals(transactions, selectedAccount, selectedCategory),
    [transactions, selectedAccount, selectedCategory]
  );
  const selectedMonthIndex = carouselMonths.indexOf(selectedMonth);

  // Карусель месяцев на той же механике, что и карусель счетов: осевшая
  // прокрутка выбирает слайд, отличается только смысл выбора.
  const monthCarousel = useSnapCarousel({
    onSettle: (index) => {
      const month = carouselMonths[index];
      if (!month || month === selectedMonth) return;
      handlePeriodChange({ timeRange: 'month', selectedMonth: month });
    },
  });

  // Месяц сменили не свайпом (чип периода, столбик тренда в «Аналитике») -
  // карусель должна доехать до него сама.
  useEffect(() => {
    if (timeRange !== 'month' || selectedMonthIndex === -1) return;
    monthCarousel.scrollToIndex(selectedMonthIndex, { skipIfSynced: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeRange, selectedMonthIndex]);



  // Expense of this month vs the same stretch of the previous one. For the
  // current month getComparisonData cuts the previous month at today's day
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
        ? `на ${comparisonData.prevMonthDayLabel} было €${previous.toLocaleString('de-DE', { minimumFractionDigits: 2 })}`
        : `весь ${comparisonData.prevMonthName} — €${previous.toLocaleString('de-DE', { minimumFractionDigits: 2 })}`
    };
  }, [comparisonData, monthlyData.expense, isActualCurrentMonth]);

  // Spending pace for the Аналитика tab's "Темп трат" card - null outside
  // the month actually in progress, since a finished month has no "rate" left.
  const paceForecast = useMemo(
    () => getPaceForecast(Math.abs(monthlyData.expense), selectedMonth, monthlyLimit),
    [monthlyData.expense, selectedMonth, monthlyLimit]
  );

  // "к 15 января" / "к декабрю" - reuses the fields getComparisonData already
  // derived rather than recomputing the same "current vs past month" split.
  // prevMonthDayLabel is already in the genitive the day form needs, while
  // the bare month name arrives nominative and has to be declined.
  const comparisonLabel = `Изменения к ${isActualCurrentMonth ? comparisonData.prevMonthDayLabel : toDativeMonth(comparisonData.prevMonthName)}`;
  const lastSyncLabel = lastSuccessfulSync
    ? lastSuccessfulSync.toLocaleString('ru-RU', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })
    : null;

  // isAuthenticated === false is the one state that always wins: a 401 mid-
  // session (expired/cleared cookie) must return the user to the login
  // screen even if data from before is still sitting in state.
  if (isAuthenticated === false) {
    return <LoginScreen onSuccess={beginAuthenticatedSession} />;
  }

  if (initialLoadError && !hasSnapshotRef.current) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', padding: '20px' }}>
        <div className="glass-panel" role="alert" style={{ padding: '28px', width: '100%', maxWidth: '380px', textAlign: 'center' }}>
          <h1 style={{ margin: 0, fontSize: 'var(--text-3xl)', color: 'var(--color-text-main)' }}>Не удалось загрузить данные</h1>
          <p style={{ margin: '12px 0 20px', color: 'var(--color-text-muted)', fontSize: 'var(--text-md)' }}>
            {initialLoadError}. Проверьте подключение и попробуйте ещё раз.
          </p>
          <button
            type="button"
            className="btn-primary"
            onClick={() => loadData({ initial: true })}
            style={{ padding: '12px 20px', borderRadius: 'var(--radius-md)', fontWeight: '700' }}
          >
            Повторить
          </button>
        </div>
      </div>
    );
  }

  if (isLoading || isAuthenticated === null) return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', color: 'var(--color-text-inverse)' }}>Загрузка...</div>;

  return (
    <div className="layout-container">
      {notice && (
        <div
          role="alert"
          className="glass-panel"
          style={{
            position: 'fixed',
            top: '16px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 1100,
            width: 'calc(100% - 40px)',
            maxWidth: '420px',
            padding: '14px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            borderLeft: `4px solid ${notice.type === 'success' ? 'var(--color-success)' : 'var(--color-negative)'}`,
          }}
        >
          <span style={{ fontSize: 'var(--text-md)', fontWeight: '500', color: 'var(--color-text-main)' }}>
            {notice.message}
          </span>
          <button
            type="button"
            onClick={() => {
              if (noticeTimeoutRef.current) clearTimeout(noticeTimeoutRef.current);
              setNotice(null);
            }}
            aria-label="Закрыть"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              fontSize: 'var(--text-2xl)',
              lineHeight: 1,
              color: 'var(--color-text-muted)',
              flexShrink: 0,
              padding: 0,
            }}
          >
            ✕
          </button>
        </div>
      )}
      {undoDeletion && (
        <div
          role={undoDeletion.error ? 'alert' : 'status'}
          className="glass-panel"
          style={{
            position: 'fixed',
            left: '50%',
            bottom: `${PEEK_HEIGHT + TAB_BAR_RESERVED_HEIGHT + 16}px`,
            transform: 'translateX(-50%)',
            zIndex: 950,
            width: 'calc(100% - 40px)',
            maxWidth: '420px',
            padding: '12px 14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            borderLeft: `4px solid ${undoDeletion.error ? 'var(--color-negative)' : 'var(--color-primary)'}`,
          }}
        >
          <span style={{ color: undoDeletion.error ? 'var(--color-negative)' : 'var(--color-text-main)', fontSize: 'var(--text-sm)', fontWeight: '600' }}>
            {undoDeletion.error || `В корзине.${undoDeletion.count > 1 ? ` Операций: ${undoDeletion.count}.` : ''}`}
          </span>
          <button type="button" onClick={handleUndoDeletion} disabled={undoDeletion.pending} style={{ padding: '8px 10px', borderRadius: 'var(--radius-md)', background: 'var(--color-primary-tint)', color: 'var(--color-primary)', fontWeight: '700', flexShrink: 0 }}>
            {undoDeletion.pending ? 'Восстановление...' : 'Отменить'}
          </button>
        </div>
      )}
      {syncWarning && (
        <div
          role="alert"
          className="glass-panel"
          style={{
            marginBottom: '12px',
            padding: '12px 14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            borderLeft: '4px solid var(--color-negative)',
          }}
        >
          <div>
            <div style={{ color: 'var(--color-text-main)', fontWeight: '700', fontSize: 'var(--text-base)' }}>
              Не удалось обновить данные
            </div>
            <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)', marginTop: '2px' }}>
              Показана синхронизация: {lastSyncLabel}. {syncWarning}
            </div>
          </div>
          <button
            type="button"
            className="btn-primary"
            disabled={isRefreshing}
            onClick={() => loadData({ initial: false })}
            style={{ padding: '9px 12px', borderRadius: 'var(--radius-md)', flexShrink: 0 }}
          >
            {isRefreshing ? 'Обновление...' : 'Повторить'}
          </button>
        </div>
      )}
      {/* Premium Header */}
      <header className="glass-panel" style={{ padding: '24px', marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '28px' }}>
          <div style={{ width: '24px' }}></div>
          <div style={{ textAlign: 'center' }}>
            <h1 style={{ fontSize: '1.8rem', fontWeight: '800', letterSpacing: '-0.8px', color: 'var(--color-primary)', margin: 0 }}>BudgetTracker</h1>
            {lastSyncLabel && (
              <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-2xs)', marginTop: '2px' }}>
                Синхронизировано: {lastSyncLabel}
              </div>
            )}
          </div>
          <IconButton
            tone="neutral"
            round
            size={38}
            onClick={() => setShowAccountsSettings(true)}
            title="Настройки"
            style={{ fontSize: 'var(--text-3xl)', transition: 'all 0.2s ease', outline: 'none' }}
          >
            ⚙️
          </IconButton>
        </div>

        {/* Balance Carousel: total capital, type groups, then one slide per account */}
        <style>{`
          div::-webkit-scrollbar { display: none; }
        `}</style>
        <div
          ref={accountCarousel.setContainer}
          onScroll={accountCarousel.handleScroll}
          data-testid="balance-carousel"
          style={{
            display: 'flex',
            overflowX: 'auto',
            scrollSnapType: 'x mandatory',
            WebkitOverflowScrolling: 'touch',
            gap: '12px',
            scrollbarWidth: 'none',
            msOverflowStyle: 'none'
          }}
        >
          {/* Leading spacer: with center snap-alignment there is no slack before
              slide 0, so its centre snap position would need a negative scroll
              offset (impossible). This spacer supplies that slack so slide 0
              can still reach centre alignment at scrollLeft 0. Not a slide, so
              no data-carousel-slide - getCarouselSlideElements() must not see it. */}
          <div
            aria-hidden="true"
            style={{
              flexGrow: 0,
              flexShrink: 0,
              flexBasis: 'max(0px, 6% - 12px)',
              pointerEvents: 'none'
            }}
          />
          {slides.map((slide, index) => {
            const isActive = slide.filter === selectedAccount;
            const balanceText = `€${slide.amount.toLocaleString('de-DE', { minimumFractionDigits: 2 })}`;
            return (
              <div
                key={slide.key}
                data-carousel-slide
                role="button"
                tabIndex={0}
                aria-label={slide.note ? `${slide.name}: ${balanceText}, ${slide.note}` : `${slide.name}: ${balanceText}`}
                aria-current={isActive}
                onClick={() => handleSlideClick(slide, index)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleSlideClick(slide, index);
                  }
                }}
                style={{
                  position: 'relative',
                  flex: '0 0 88%',
                  scrollSnapAlign: 'center',
                  scrollSnapStop: 'always',
                  boxSizing: 'border-box',
                  textAlign: 'center',
                  background: isActive ? 'var(--color-primary-soft)' : 'var(--color-surface-muted)',
                  borderRadius: 'var(--radius-xl)',
                  border: isActive ? '1.5px solid var(--color-primary)' : '1px solid var(--color-border-subtle)',
                  transition: 'all 0.2s ease',
                  padding: '18px 16px',
                  cursor: 'pointer'
                }}
              >
                {/* The account symbol sits in the card's top-right corner instead of
                    taking a full row of its own, so the card stays compact. It is
                    absolutely positioned and non-interactive: the name/amount block
                    below keeps the card's height, and centred text is unaffected. */}
                <div
                  aria-hidden="true"
                  style={{ position: 'absolute', top: '12px', right: '14px', fontSize: 'var(--text-3xl)', lineHeight: 1, pointerEvents: 'none' }}
                >
                  {slide.icon}
                </div>
                <div style={{ fontSize: 'var(--text-md)', color: isActive ? 'var(--color-primary)' : 'var(--color-text-muted)', fontWeight: '700', marginBottom: '8px', letterSpacing: '0.5px', padding: '0 28px' }}>
                  {slide.name}
                </div>
                <div className="balance-amount" style={{ fontSize: '2.2rem', fontWeight: '800', color: 'var(--color-text-main)' }}>
                  {balanceText}
                </div>
                {slide.note && (
                  <div style={{ marginTop: '4px', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                    {slide.note}
                  </div>
                )}
              </div>
            );
          })}
          {/* Trailing spacer: mirrors the leading one so the last slide has
              equal slack after it and can also reach centre snap alignment. */}
          <div
            aria-hidden="true"
            style={{
              flexGrow: 0,
              flexShrink: 0,
              flexBasis: 'max(0px, 6% - 12px)',
              pointerEvents: 'none'
            }}
          />
        </div>

        {/* Carousel dot indicators */}
        <div style={{ display: 'flex', flexWrap: 'nowrap', justifyContent: 'center', marginTop: '12px' }}>
          {slides.map((slide, index) => {
            const isActive = slide.filter === selectedAccount;
            return (
              <button
                key={slide.key}
                type="button"
                onClick={() => handleSlideClick(slide, index)}
                aria-label={`Показать ${slide.name}`}
                aria-current={isActive}
                style={{
                  // Hit target wants to be 40x40 for touch, but with many
                  // accounts a row of fixed 40px boxes no longer fits the
                  // width and used to wrap onto a second line. So the box is
                  // 40px wide at most and allowed to shrink (flexShrink: 1)
                  // down to 20px, which keeps every dot on one row up to
                  // ~16 accounts. The horizontal margin stays at 0 so the
                  // boxes tile edge-to-edge instead of overlapping (a
                  // negative horizontal margin here made a wider dot's box
                  // paint over its neighbour, so taps meant for one dot's
                  // visible marker landed on the next dot instead); only the
                  // vertical margin is pulled back, where there are no
                  // neighbours to overlap and it keeps the row from growing
                  // taller.
                  flexShrink: 1,
                  flexGrow: 0,
                  flexBasis: '40px',
                  maxWidth: '40px',
                  minWidth: '20px',
                  height: '40px',
                  margin: '-9px 0',
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer'
                }}
              >
                <span
                  style={{
                    display: 'block',
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    background: isActive ? 'var(--color-primary)' : 'var(--color-control-off)',
                    transition: 'background 0.2s ease'
                  }}
                />
              </button>
            );
          })}
        </div>

      </header>

      <main style={{ paddingBottom: `${PEEK_HEIGHT + TAB_BAR_RESERVED_HEIGHT + 16}px` }}>
        {/* Quick Actions */}
        {summaryView !== 'payments' && <section style={{ marginBottom: '32px' }}>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button onClick={() => openAddModal('income')} className="btn-primary" style={{ flex: 1, background: 'var(--color-positive-gradient)', boxShadow: '0 4px 15px rgba(16, 185, 129, 0.3)', padding: '12px 8px', fontSize: 'var(--text-md)', whiteSpace: 'nowrap' }}>
              <span>+</span> Доход
            </button>
            <button onClick={() => openAddModal('expense')} className="btn-primary" style={{ flex: 1, background: 'var(--color-expense-gradient)', boxShadow: '0 4px 15px rgba(244, 63, 94, 0.3)', padding: '12px 8px', fontSize: 'var(--text-md)', whiteSpace: 'nowrap' }}>
              <span>-</span> Расход
            </button>
            <button onClick={() => openAddModal('transfer')} className="glass-panel" style={{ flex: 1, border: '1px solid rgba(129, 140, 248, 0.2)', color: '#818cf8', padding: '12px 8px', borderRadius: 'var(--radius-lg)', fontWeight: '600', fontSize: 'var(--text-md)', whiteSpace: 'nowrap' }}>
              ⇄ Перевод
            </button>
          </div>
        </section>}

        {/* One period control for the whole screen: the chip carries both
            the granularity (месяц/год/всё время) and the concrete month or
            year, replacing the old header arrow row plus the range toggle
            that used to live inside the stats card. It sits above the
            summary card so both bottom tabs share it. */}
        {summaryView !== 'payments' && <section style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <PeriodPicker timeRange={timeRange} selectedMonth={selectedMonth} onChange={handlePeriodChange} />
        </section>}

        {/* Summary Card with Budget Limit */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '24px', marginBottom: '24px' }}>
          {summaryView === 'payments' ? (
            <PlannedPaymentsView
              plannedPayments={plannedPayments}
              accounts={accounts}
              categories={categories}
              transactions={transactions}
              onCreate={handleCreatePlannedPayment}
              onUpdate={handleUpdatePlannedPayment}
              onPay={handlePayPlannedPayment}
              onOpenTrash={openTrash}
            />
          ) : summaryView === 'stats' ? (
            timeRange === 'month' ? (
              /* Месяцы листаются так же, как счета в шапке: не «жест меняет
                 данные», а лента карточек, которая едет за пальцем. Соседние
                 месяцы видно по краям и приглушены, чтобы читалось, какой
                 сейчас выбран. */
              <div
                ref={monthCarousel.setContainer}
                onScroll={monthCarousel.handleScroll}
                data-testid="month-carousel"
                style={{
                  display: 'flex',
                  overflowX: 'auto',
                  scrollSnapType: 'x mandatory',
                  WebkitOverflowScrolling: 'touch',
                  gap: '12px',
                  scrollbarWidth: 'none',
                  msOverflowStyle: 'none'
                }}
              >
                {/* Отступы по краям: при выравнивании по центру у первого и
                    последнего слайда иначе не хватает слака, чтобы доехать до
                    середины. Не слайды - без data-carousel-slide. */}
                <div aria-hidden="true" style={{ flex: '0 0 max(0px, 6% - 12px)', pointerEvents: 'none' }} />
                {carouselMonths.map((month) => {
                  const totals = monthlyTotals[month] || { income: 0, expense: 0 };
                  const isActive = month === selectedMonth;
                  const [monthYear] = month.split('-');
                  return (
                    <div
                      key={month}
                      data-carousel-slide
                      className="glass-panel"
                      style={{
                        flex: '0 0 88%',
                        scrollSnapAlign: 'center',
                        scrollSnapStop: 'always',
                        boxSizing: 'border-box',
                        padding: '20px 24px 24px',
                        opacity: isActive ? 1 : 0.5,
                        transition: 'opacity 0.2s ease'
                      }}
                    >
                      {/* Свой месяц подписан на каждой карточке - иначе во
                          время свайпа не понять, куда едешь. */}
                      <div style={{ fontSize: 'var(--text-2xs)', fontWeight: '700', letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--color-text-muted)', textAlign: 'center', marginBottom: '12px' }}>
                        {formatMonthName(month)} {monthYear}
                      </div>
                      <SummaryCard
                        income={totals.income}
                        expense={totals.expense}
                        monthlyLimit={monthlyLimit}
                        showLimitRing
                        selectedType={selectedType}
                        onToggleType={toggleTypeFilter}
                        isActive={isActive}
                      />
                    </div>
                  );
                })}
                <div aria-hidden="true" style={{ flex: '0 0 max(0px, 6% - 12px)', pointerEvents: 'none' }} />
              </div>
            ) : (
              /* Год и «всё время» листать нечем - одна карточка без кольца:
                 месячный лимит для такого периода ничего не значит. */
              <div className="glass-panel" style={{ padding: '24px' }}>
                <SummaryCard
                  income={periodStats.income}
                  expense={periodStats.expense}
                  monthlyLimit={monthlyLimit}
                  showLimitRing={false}
                  headlineLabel={timeRange === 'year' ? 'Расход за год' : 'Расход за всё время'}
                  selectedType={selectedType}
                  onToggleType={toggleTypeFilter}
                />
              </div>
            )
          ) : (
            /* Analytics tab: same period as the stats tab (periodStats), so
               switching tabs never silently changes what range you're
               looking at. AnalyticsView owns its own empty state for a
               period with no spending - a tab that can go blank would look
               broken. */
            <AnalyticsView
              periodStats={periodStats}
              periodLabel={formatPeriodLabel(timeRange, selectedMonth)}
              timeRange={timeRange}
              pace={paceForecast}
              monthlyLimit={monthlyLimit}
              series={monthlySeries}
              selectedMonth={selectedMonth}
              onSelectMonth={(month) => handlePeriodChange({ timeRange: 'month', selectedMonth: month })}
              expenseComparison={expenseComparison}
              categoryComparison={categoryComparison}
              comparisonLabel={comparisonLabel}
              selectedCategory={selectedCategory}
              onSelectCategory={toggleCategoryFilter}
            />
          )}

          {/* AI Analytics Removed */}

        </div>
      </main>

      <BottomTabs active={summaryView} onChange={setSummaryView} />

      {showAddTransaction && (
        <AddTransactionForm
          type={transactionType}
          categories={categories}
          onAddCategory={handleAddCategory}
          onClose={() => setShowAddTransaction(false)}
          onSubmit={handleAddTransaction}
          accounts={accounts}
          transactions={transactions}
          // Only a real account id preselects - the total-capital slide
          // (null) and any residual type:* filter value must fall through
          // to no preset, forcing an explicit choice.
          presetAccountId={accounts.some(a => a._id === selectedAccount) ? selectedAccount : undefined}
        />
      )}
      {editingTransaction && <AddTransactionForm initialData={editingTransaction} categories={categories} onAddCategory={handleAddCategory} onClose={() => setEditingTransaction(null)} onSubmit={handleUpdateTransaction} onDelete={(id) => handleDeleteTransaction(id, editingTransaction.splitId)} accounts={accounts} transactions={transactions} />}

      {/* Bottom drawer: transaction history, always mounted (collapsed =
          transformed off-screen, not unmounted) so filters applied elsewhere
          keep reflecting in it immediately. */}
      <TransactionsDrawer
        expanded={historyDrawerExpanded}
        setExpanded={setHistoryDrawerExpanded}
        title={historyDrawerTitle}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        searchResults={searchResults}
        periodData={periodData}
        categories={categories}
        selectedCategory={selectedCategory}
        selectedType={selectedType}
        selectedAccount={selectedAccount}
        toggleCategoryFilter={toggleCategoryFilter}
        setSelectedAccount={setSelectedAccount}
        setSelectedType={setSelectedType}
        setSelectedCategory={setSelectedCategory}
        exportToCSV={exportToCSV}
        openEditModal={openEditModal}
        getAccountDisplay={getAccountDisplay}
        formatDate={formatDate}
        getAccountFilterLabel={getAccountFilterLabel}
      />

      {showAccountsSettings && (
        <AccountsSettingsModal
          accounts={accounts}
          monthlyLimit={monthlyLimit}
          onClose={() => setShowAccountsSettings(false)}
          onSaveAccount={handleSaveAccount}
          onDeleteAccount={handleDeleteAccount}
          categories={categories}
          categoryUsage={categoryUsage}
          onDeleteCategory={handleDeleteCategory}
          onRenameCategory={handleRenameCategory}
          onDragEnd={onAccountDragEnd}
          onSaveSettings={handleSaveSettings}
          onOpenTrash={openTrash}
          onLogout={handleLogout}
          showNotice={showNotice}
        />
      )}
      {showTrash && (
        <TrashSheet
          groups={trashGroups}
          loading={trashLoading}
          error={trashError}
          onRetry={fetchTrash}
          onRestore={handleRestoreTrash}
          onPurge={handlePurgeTrash}
          onClose={() => {
            trashGenerationRef.current += 1;
            setShowTrash(false);
          }}
        />
      )}
    </div>
  );
}

export default App;
