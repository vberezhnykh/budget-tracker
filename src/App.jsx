import { useState, useMemo, useEffect, useRef } from 'react'
import AddTransactionForm from './components/AddTransactionForm'
import CategoryDonut from './components/CategoryDonut'
import LoginScreen from './components/LoginScreen'
import TransactionsDrawer, { PEEK_HEIGHT } from './components/TransactionsDrawer'
import AccountsSettingsModal from './components/AccountsSettingsModal'
import { transformTransactions, calculateBalances, getMonthlyData, getYearlyData, getLifetimeStats, getSearchResults, getComparisonData } from './utils/finance'
import { handleAccountDragEnd } from './utils/accountReorder'

// API URL - relative path for production data fetching
const API_URL = '/api/transactions';
const CATEGORIES_URL = '/api/categories';
const ACCOUNTS_URL = '/api/accounts';
const SETTINGS_URL = '/api/settings';
// Used until the server's settings document has loaded (or if it 404s on an
// older deployment) - mirrors the server's own default in server/index.js.
const DEFAULT_MONTHLY_LIMIT = 7000;

function App() {
  const [showAddTransaction, setShowAddTransaction] = useState(false);
  const [transactionType, setTransactionType] = useState('expense');
  const [editingTransaction, setEditingTransaction] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // Auth: null = "don't know yet" (still checking / never asked), true =
  // logged in, false = show the login screen. Deliberately not persisted to
  // localStorage - the httpOnly session cookie is the only source of truth,
  // and this state is just the UI's best current guess at what that cookie
  // says, driven entirely by 401 responses from the API (see apiFetch below).
  const [isAuthenticated, setIsAuthenticated] = useState(null);

  // State for selected. Defaults to current month YYYY-MM
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));
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
  // resolves (see fetchSettings/initData below).
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
    };
  }, []);

  const onAccountDragEnd = (event) => {
    handleAccountDragEnd(event, { accounts: accountsRef.current, setAccounts, apiUrl: ACCOUNTS_URL, apiFetch, onError: showNotice });
  };

  // Balance carousel refs:
  // - carouselRef: the scroll container
  // - carouselRafRef: rAF throttle handle for the scroll listener
  // - carouselSettleTimeoutRef: debounce handle - the active filter is only
  //   committed once scroll events stop arriving for a short while, so
  //   swiping/animating past several slides doesn't filter by each one
  // - carouselProgrammaticRef: true while a tap or an external filter change
  //   is driving the scroll, so the settle handler doesn't fight it
  // - carouselSyncedIndexRef: index of the slide our own code last drove the
  //   carousel/filter to, used to avoid redundant programmatic scrolls
  const carouselRef = useRef(null);
  const carouselRafRef = useRef(null);
  const carouselSettleTimeoutRef = useRef(null);
  const carouselProgrammaticRef = useRef(false);
  const carouselSyncedIndexRef = useRef(0);

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

  // Fetch data on mount
  useEffect(() => {
    initData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const initData = async () => {
    try {
      setIsLoading(true);
      const loadedAccounts = await fetchAccounts();
      // fetchAccounts returns null specifically when the request came back
      // 401 - apiFetch already flipped isAuthenticated to false in that case,
      // so there's nothing further to load until the user logs back in. Any
      // other failure (e.g. a 503 from unconfigured auth) already reported
      // itself via showNotice and returns undefined, not null - initData
      // falls through and still renders the main UI (with empty data) rather
      // than getting stuck on the loading screen forever.
      if (loadedAccounts === null) return;
      setIsAuthenticated(true);
      await fetchTransactions(loadedAccounts);
      await fetchCategories();
      await fetchSettings();
    } catch (err) {
      console.error('Initialization error:', err);
      setIsLoading(false);
    }
  };

  // Lock body scroll when a modal or the expanded history drawer is open.
  // The drawer's own list still scrolls - it's inside the fixed sheet with
  // its own overflowY: 'auto'.
  useEffect(() => {
    if (showAddTransaction || editingTransaction || historyDrawerExpanded) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }

    // Cleanup on unmount
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [showAddTransaction, editingTransaction, historyDrawerExpanded]);

  // Cancel any pending rAF-throttled carousel scroll handler / settle-debounce timer on unmount
  useEffect(() => {
    return () => {
      if (carouselRafRef.current) cancelAnimationFrame(carouselRafRef.current);
      if (carouselSettleTimeoutRef.current) clearTimeout(carouselSettleTimeoutRef.current);
    };
  }, []);

  // Thin fetch wrapper used for every /api/* call. A 401 means the session
  // cookie is missing/expired - flip to the login screen right away rather
  // than letting each call site duplicate that check. This is the single
  // place that drives isAuthenticated back to false mid-session.
  const apiFetch = async (url, options) => {
    const res = await fetch(url, options);
    if (res.status === 401) {
      setIsAuthenticated(false);
    }
    return res;
  };

  // Guards against two failure shapes that used to fall straight into
  // setState: a non-ok response (e.g. the 503 the server returns with a
  // Russian message when its auth config is missing) whose JSON body is
  // `{ message }` rather than the expected array, and any other response
  // that parses but isn't actually an array. Either one used to get stored
  // as-is, and the later `.map(...)` over it threw - tripping the error
  // boundary and showing the generic crash screen instead of anything
  // actionable. Reported through showNotice so there's a comprehensible
  // message instead of a blank/crashed app; existing state is left alone
  // rather than clobbered with the bad payload.
  const fetchAccounts = async () => {
    try {
      const res = await apiFetch(ACCOUNTS_URL);
      if (res.status === 401) {
        setIsLoading(false);
        return null;
      }
      const data = await res.json().catch(() => null);
      if (!res.ok || !Array.isArray(data)) {
        showNotice((data && data.message) || 'Не удалось загрузить счета');
        setIsLoading(false);
        return undefined;
      }
      setAccounts(data);
      return data;
    } catch (err) {
      console.error('Fetch accounts error:', err);
      return [];
    }
  };

  const fetchTransactions = async (currentAccounts) => {
    try {
      const res = await apiFetch(API_URL);
      if (res.status === 401) {
        setIsLoading(false);
        return;
      }
      const data = await res.json().catch(() => null);
      if (!res.ok || !Array.isArray(data)) {
        showNotice((data && data.message) || 'Не удалось загрузить операции');
        setIsLoading(false);
        return;
      }
      const accountsList = currentAccounts || accountsRef.current;
      setTransactions(transformTransactions(data, accountsList));
      setIsLoading(false);
    } catch (err) {
      console.error('Fetch error:', err);
      setIsLoading(false);
    }
  };

  const fetchCategories = async () => {
    try {
      const res = await apiFetch(CATEGORIES_URL);
      if (res.status === 401) return;
      const data = await res.json().catch(() => null);
      if (!res.ok || !Array.isArray(data)) {
        showNotice((data && data.message) || 'Не удалось загрузить категории');
        return;
      }
      setCategories(data);
    } catch (err) {
      console.error('Fetch categories error:', err);
    }
  };

  // Loads the shared monthlyLimit from the server. If the response is
  // missing, not ok, or doesn't carry a usable number (e.g. an unstubbed
  // /api/settings in a test mock), the existing default stays in place
  // rather than throwing - this must never block the rest of initData.
  const fetchSettings = async () => {
    try {
      const res = await apiFetch(SETTINGS_URL);
      if (!res.ok) return;
      const data = await res.json();
      if (data && typeof data.monthlyLimit === 'number' && !Number.isNaN(data.monthlyLimit)) {
        setMonthlyLimit(data.monthlyLimit);
      }
    } catch (err) {
      console.error('Fetch settings error:', err);
    }
  };

  const handleAddCategory = async (name, type) => {
    try {
      const res = await apiFetch(CATEGORIES_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, type })
      });
      if (res.ok) {
        const saved = await res.json();
        setCategories(prev => [...prev, saved]);
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
      { key: 'total', icon: '💰', name: 'Общий капитал', amount: balances.total, filter: null },
    ];
    const accountSlides = accounts.map(acc => ({
      key: acc._id,
      icon: acc.icon || (acc.type === 'cash' ? '💵' : '💳'),
      name: acc.name,
      amount: balances.byAccount[acc._id] || 0,
      filter: acc._id,
    }));
    return [...base, ...accountSlides];
  }, [accounts, balances]);

  // Filter transactions for the selected month and account/category/type
  const monthlyData = useMemo(() => getMonthlyData(transactions, selectedMonth, selectedAccount, selectedCategory, selectedType), [transactions, selectedMonth, selectedAccount, selectedCategory, selectedType]);

  // Yearly data with filters
  const yearlyData = useMemo(() => getYearlyData(transactions, selectedMonth, selectedAccount, selectedCategory), [transactions, selectedMonth, selectedAccount, selectedCategory]);

  // Calculate lifetime stats with filters
  const lifetimeStats = useMemo(() => getLifetimeStats(transactions, '2025-11-09', selectedAccount, selectedCategory), [transactions, selectedAccount, selectedCategory]);

  // Search results with filters
  const searchResults = useMemo(() => getSearchResults(transactions, searchQuery, selectedAccount, selectedCategory, selectedType), [transactions, searchQuery, selectedAccount, selectedCategory, selectedType]);

  // Comparison data for indicators
  const comparisonData = useMemo(() => getComparisonData(transactions, selectedMonth), [transactions, selectedMonth]);

  const isActualCurrentMonth = useMemo(() => {
    const now = new Date();
    const currentMonthStr = now.toISOString().slice(0, 7);
    return selectedMonth === currentMonthStr;
  }, [selectedMonth]);

  // Slide elements are located via the data-carousel-slide attribute rather
  // than container.children, so a stray non-slide child (e.g. a <style> tag)
  // can never shift every index off by one.
  const getCarouselSlideElements = () => {
    const container = carouselRef.current;
    if (!container) return [];
    return Array.from(container.querySelectorAll('[data-carousel-slide]'));
  };

  // (Re)start the settle-debounce: the active filter is only committed once
  // scroll events (real or programmatic) stop arriving for a short while, so
  // a swipe or an animated scroll that passes over several slides doesn't
  // filter by each intermediate one.
  const scheduleCarouselSettle = () => {
    if (carouselSettleTimeoutRef.current) clearTimeout(carouselSettleTimeoutRef.current);
    carouselSettleTimeoutRef.current = setTimeout(commitSettledCarouselSlide, 120);
  };

  const commitSettledCarouselSlide = () => {
    carouselSettleTimeoutRef.current = null;
    const wasProgrammatic = carouselProgrammaticRef.current;
    carouselProgrammaticRef.current = false;
    // A tap (or an external filter sync) already set the exact destination
    // filter/index up front - don't let the settled scroll position override it.
    if (wasProgrammatic) return;

    const container = carouselRef.current;
    const slideEls = getCarouselSlideElements();
    if (!container || !slideEls.length) return;

    // Pick the slide whose centre is nearest the container's visible centre,
    // from real element positions - not a single assumed slide width.
    const containerCenter = container.scrollLeft + container.clientWidth / 2;
    let nearestIndex = -1;
    let nearestDistance = Infinity;
    let hasLayout = false;
    slideEls.forEach((el, i) => {
      if (el.offsetWidth > 0 || el.offsetLeft > 0) hasLayout = true;
      const center = el.offsetLeft + el.offsetWidth / 2;
      const distance = Math.abs(center - containerCenter);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = i;
      }
    });
    // jsdom (unit tests without stubbed geometry) reports everything as 0x0 -
    // bail rather than confidently picking the wrong slide.
    if (!hasLayout || nearestIndex === -1) return;

    carouselSyncedIndexRef.current = nearestIndex;
    const filter = slides[nearestIndex]?.filter ?? null;
    setSelectedAccount(prev => (prev === filter ? prev : filter));
  };

  // Selecting a carousel slide (by tap, or by scroll settling on it) always
  // sets the filter directly - no toggle-off behavior, since exactly one
  // slide is "active" at all times.
  const handleSlideClick = (slide, index) => {
    setSelectedAccount(prev => (prev === slide.filter ? prev : slide.filter));
    carouselSyncedIndexRef.current = index;
    carouselProgrammaticRef.current = true;
    // Guarantee the programmatic flag clears even if the tap causes no
    // scroll events at all (e.g. the slide is already centred).
    scheduleCarouselSettle();
    const slideEl = getCarouselSlideElements()[index];
    // jsdom (unit tests) doesn't implement scrollIntoView - guard the call.
    slideEl?.scrollIntoView?.({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  };

  const handleCarouselScroll = () => {
    if (carouselRafRef.current) return;
    carouselRafRef.current = requestAnimationFrame(() => {
      carouselRafRef.current = null;
      scheduleCarouselSettle();
    });
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
    if (index === -1 || index === carouselSyncedIndexRef.current) return;
    const slideEl = getCarouselSlideElements()[index];
    if (!slideEl) return;
    carouselSyncedIndexRef.current = index;
    carouselProgrammaticRef.current = true;
    scheduleCarouselSettle();
    slideEl.scrollIntoView?.({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccount, slides]);

  const toggleCategoryFilter = (category) => {
    setSelectedCategory(prev => prev === category ? null : category);
  };

  const toggleTypeFilter = (type) => {
    setSelectedType(prev => prev === type ? null : type);
  };

  const handleMonthChange = (direction) => {
    const [year, month] = selectedMonth.split('-').map(Number);
    const date = new Date(year, month - 1 + direction, 1);
    const localDate = new Date(date.getTime() - (date.getTimezoneOffset() * 60000));
    const newMonth = localDate.toISOString().slice(0, 7);

    if (newMonth < '2025-11' || newMonth > new Date().toISOString().slice(0, 7)) return;
    setSelectedMonth(newMonth);
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
    try {
      const res = await apiFetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newTx)
      });
      if (res.ok) fetchTransactions();
      else console.error('Add failed:', await res.text());
    } catch (err) { console.error('Add error:', err); }
  };

  const handleUpdateTransaction = async (updatedTx) => {
    try {
      const res = await apiFetch(`${API_URL}/${updatedTx.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedTx)
      });
      if (res.ok) fetchTransactions();
      else console.error('Update failed:', await res.text());
    } catch (err) { console.error('Update error:', err); }
  };

  const handleDeleteTransaction = async (id, splitId = null) => {
    try {
      const url = splitId ? `${API_URL}/${id}?splitId=${splitId}` : `${API_URL}/${id}`;
      const res = await apiFetch(url, { method: 'DELETE' });
      if (res.ok) {
        fetchTransactions();
        setEditingTransaction(null);
      } else console.error('Delete failed:', await res.text());
    } catch (err) { console.error('Delete error:', err); }
  };

  // formName/formType/formIcon/editingAccountId are local UI state owned by
  // AccountsSettingsModal now - it passes them in as arguments rather than
  // this function reading them off App state, since App only owns the
  // accounts data and the API mutation itself. Returns whether the save
  // succeeded so the modal knows whether to reset its form.
  const handleSaveAccount = async (formName, formType, formIcon, editingAccountId) => {
    try {
      let res;
      if (editingAccountId) {
        res = await apiFetch(`${ACCOUNTS_URL}/${editingAccountId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: formName, icon: formIcon })
        });
      } else {
        res = await apiFetch(ACCOUNTS_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: formName, type: formType, icon: formIcon })
        });
      }

      if (res.ok) {
        const freshAccounts = await fetchAccounts();
        await fetchTransactions(freshAccounts);
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

    try {
      const res = await apiFetch(`${ACCOUNTS_URL}/${id}`, { method: 'DELETE' });
      if (res.ok) {
        const freshAccounts = await fetchAccounts();
        await fetchTransactions(freshAccounts);
      } else {
        const err = await res.json();
        showNotice(err.message || 'Не удалось удалить счёт');
      }
    } catch (err) {
      console.error('Delete account error:', err);
    }
  };

  // Saves the shared monthlyLimit to the server. Returns whether it
  // succeeded so the modal knows whether to surface a success notice.
  const handleSaveSettings = async (newLimit) => {
    try {
      const res = await apiFetch(SETTINGS_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monthlyLimit: newLimit })
      });
      if (res.ok) {
        const saved = await res.json();
        setMonthlyLimit(typeof saved.monthlyLimit === 'number' ? saved.monthlyLimit : newLimit);
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

  // Logout lives in the "Управление счетами" settings modal rather than as
  // new chrome on the main screen. The POST clears the httpOnly cookie
  // server-side. Only drop to the login screen once that's actually
  // confirmed (an ok response) - if the request fails or errors, the cookie
  // is still valid, so switching the UI to "logged out" would be a lie: the
  // user would believe they're safely logged out (relevant on a shared/
  // borrowed device) while a refresh would silently restore access. Report
  // the failure instead and leave the authenticated state untouched so the
  // user knows to retry.
  const handleLogout = async () => {
    try {
      const res = await fetch('/api/logout', { method: 'POST' });
      if (res.ok) {
        setShowAccountsSettings(false);
        setIsAuthenticated(false);
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

  const isPrevDisabled = selectedMonth === '2025-11';
  const isNextDisabled = selectedMonth === new Date().toISOString().slice(0, 7);

  // Defensive against a bad stored monthlyLimit (0, negative, or non-finite -
  // the server now rejects saving those, but an old/unmigrated value could
  // still be sitting in the settings document). Dividing by such a limit
  // would otherwise render NaN% or Infinity% in the progress bar below.
  const isLimitUsable = Number.isFinite(monthlyLimit) && monthlyLimit > 0;
  const limitRatio = isLimitUsable ? Math.abs(monthlyData.expense) / monthlyLimit : 0;
  const isOverLimit = isLimitUsable && Math.abs(monthlyData.expense) > monthlyLimit;
  const limitPercentDisplay = Number.isFinite(limitRatio) ? Math.round(limitRatio * 100) : 0;
  const limitBarWidthDisplay = Number.isFinite(limitRatio) ? Math.min(limitRatio * 100, 100) : 0;

  // isAuthenticated === false is the one state that always wins: a 401 mid-
  // session (expired/cleared cookie) must return the user to the login
  // screen even if data from before is still sitting in state.
  if (isAuthenticated === false) {
    return <LoginScreen onSuccess={() => { setIsAuthenticated(null); initData(); }} />;
  }

  if (isLoading || isAuthenticated === null) return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', color: '#fff' }}>Загрузка...</div>;

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
            borderLeft: `4px solid ${notice.type === 'success' ? '#22c55e' : '#ef4444'}`,
          }}
        >
          <span style={{ fontSize: '0.9rem', fontWeight: '500', color: 'var(--color-text-main)' }}>
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
              fontSize: '1.1rem',
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
      {/* Premium Header */}
      <header className="glass-panel" style={{ padding: '24px', marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '28px' }}>
          <div style={{ width: '24px' }}></div>
          <h1 style={{ fontSize: '1.8rem', fontWeight: '800', letterSpacing: '-0.8px', color: 'var(--color-primary)', margin: 0 }}>BudgetTracker</h1>
          <button 
            onClick={() => setShowAccountsSettings(true)}
            style={{ 
              background: 'rgba(0,0,0,0.03)', 
              border: 'none', 
              borderRadius: '50%', 
              width: '38px', 
              height: '38px', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center', 
              cursor: 'pointer',
              fontSize: '1.2rem',
              color: 'var(--color-text-main)',
              transition: 'all 0.2s ease',
              outline: 'none'
            }}
            title="Управление счетами"
          >
            ⚙️
          </button>
        </div>

        {/* Balance Carousel: total capital, type groups, then one slide per account */}
        <style>{`
          div::-webkit-scrollbar { display: none; }
        `}</style>
        <div
          ref={carouselRef}
          onScroll={handleCarouselScroll}
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
                aria-label={`${slide.name}: ${balanceText}`}
                aria-current={isActive}
                onClick={() => handleSlideClick(slide, index)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleSlideClick(slide, index);
                  }
                }}
                style={{
                  flex: '0 0 88%',
                  scrollSnapAlign: 'center',
                  scrollSnapStop: 'always',
                  boxSizing: 'border-box',
                  textAlign: 'center',
                  background: isActive ? 'rgba(37, 99, 235, 0.05)' : 'rgba(0,0,0,0.02)',
                  borderRadius: '24px',
                  border: isActive ? '1.5px solid var(--color-primary)' : '1px solid rgba(0,0,0,0.05)',
                  transition: 'all 0.2s ease',
                  padding: '24px 16px',
                  cursor: 'pointer'
                }}
              >
                <div style={{ fontSize: '1.6rem', marginBottom: '8px' }}>{slide.icon}</div>
                <div style={{ fontSize: '0.9rem', color: isActive ? 'var(--color-primary)' : 'var(--color-text-muted)', fontWeight: '700', marginBottom: '8px', letterSpacing: '0.5px' }}>
                  {slide.name}
                </div>
                <div className="balance-amount" style={{ fontSize: '2.2rem', fontWeight: '800', color: 'var(--color-text-main)' }}>
                  {balanceText}
                </div>
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
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', marginTop: '12px' }}>
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
                  flexShrink: 0,
                  // Hit target is enlarged to 40x40 for touch, but only the
                  // vertical margin is pulled back with a negative value -
                  // there are no vertical neighbours, so that can't overlap
                  // anything and keeps the row from growing taller. The
                  // horizontal margin is left at 0 so adjacent 40px boxes
                  // tile edge-to-edge instead of overlapping (a negative
                  // horizontal margin here made a wider dot's box paint over
                  // its neighbour, so taps meant for one dot's visible
                  // marker landed on the next dot instead). The row is
                  // wider as a result and may wrap (flexWrap: 'wrap' above
                  // already handles that) - that's an acceptable trade for
                  // correct tap targeting.
                  width: '40px',
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
                    background: isActive ? 'var(--color-primary)' : 'rgba(0,0,0,0.15)',
                    transition: 'background 0.2s ease'
                  }}
                />
              </button>
            );
          })}
        </div>
      </header>

      <main style={{ paddingBottom: `${PEEK_HEIGHT + 16}px` }}>
        {/* Quick Actions */}
        <section style={{ marginBottom: '32px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <button onClick={() => openAddModal('transfer')} className="glass-panel" style={{ width: '100%', border: '1px solid rgba(129, 140, 248, 0.2)', color: '#818cf8', padding: '14px', borderRadius: '16px', fontWeight: '600' }}>
              ⇄ Обмен / Перевод
            </button>
            <div style={{ display: 'flex', gap: '16px' }}>
              <button onClick={() => openAddModal('income')} className="btn-primary" style={{ flex: 1, background: 'linear-gradient(135deg, #10b981, #059669)', boxShadow: '0 4px 15px rgba(16, 185, 129, 0.3)' }}>
                <span>+</span> Доход
              </button>
              <button onClick={() => openAddModal('expense')} className="btn-primary" style={{ flex: 2, background: 'linear-gradient(135deg, #f43f5e, #e11d48)', boxShadow: '0 4px 15px rgba(244, 63, 94, 0.3)' }}>
                <span>-</span> Расход
              </button>
            </div>
          </div>
        </section>

        {/* Month Navigation */}
        <div className="glass-panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', padding: '12px 20px' }}>
          <button onClick={() => handleMonthChange(-1)} disabled={isPrevDisabled} style={{ background: 'transparent', color: 'var(--color-text-muted)', fontSize: '1.5rem', opacity: isPrevDisabled ? 0.3 : 1 }}>←</button>
          <h2 style={{ fontSize: '1.1rem', fontWeight: '600', textTransform: 'capitalize' }}>
            {new Date(selectedMonth + '-01T12:00:00').toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }).replace(' г.', '')}
          </h2>
          <button onClick={() => handleMonthChange(1)} disabled={isNextDisabled} style={{ background: 'transparent', color: 'var(--color-text-muted)', fontSize: '1.5rem', opacity: isNextDisabled ? 0.3 : 1 }}>→</button>
        </div>

        {/* Summary Card with Budget Limit */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '24px', marginBottom: '24px' }}>
          {summaryView === 'stats' ? (
            <div className="glass-panel" style={{ padding: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
                <div style={{ display: 'flex', gap: '4px', background: 'rgba(0,0,0,0.04)', padding: '4px', borderRadius: '10px', flexShrink: 0 }}>
                  <button
                    onClick={() => setTimeRange('month')}
                    style={{
                      background: timeRange === 'month' ? '#fff' : 'transparent',
                      border: 'none',
                      borderRadius: '6px',
                      padding: '4px 12px',
                      color: timeRange === 'month' ? 'var(--color-primary)' : 'var(--color-text-muted)',
                      fontSize: '0.75rem',
                      fontWeight: '600',
                      boxShadow: timeRange === 'month' ? '0 2px 4px rgba(0,0,0,0.05)' : 'none'
                    }}
                  >
                    Месяц
                  </button>
                  <button
                    onClick={() => setTimeRange('year')}
                    style={{
                      background: timeRange === 'year' ? '#fff' : 'transparent',
                      border: 'none',
                      borderRadius: '6px',
                      padding: '4px 12px',
                      color: timeRange === 'year' ? 'var(--color-primary)' : 'var(--color-text-muted)',
                      fontSize: '0.75rem',
                      fontWeight: '600',
                      boxShadow: timeRange === 'year' ? '0 2px 4px rgba(0,0,0,0.05)' : 'none'
                    }}
                  >
                    Год
                  </button>
                  <button
                    onClick={() => setTimeRange('lifetime')}
                    style={{
                      background: timeRange === 'lifetime' ? '#fff' : 'transparent',
                      border: 'none',
                      borderRadius: '6px',
                      padding: '4px 12px',
                      color: timeRange === 'lifetime' ? 'var(--color-primary)' : 'var(--color-text-muted)',
                      fontSize: '0.75rem',
                      fontWeight: '600',
                      boxShadow: timeRange === 'lifetime' ? '0 2px 4px rgba(0,0,0,0.05)' : 'none'
                    }}
                  >
                    Всё время
                  </button>
                </div>
                <button onClick={() => setSummaryView('analytics')} style={{ background: 'rgba(0,0,0,0.03)', border: '1px solid rgba(0,0,0,0.08)', borderRadius: '8px', padding: '6px 12px', color: 'var(--color-text-main)', fontSize: '0.8rem', fontWeight: '500' }}>
                  Аналитика →
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div
                  onClick={() => toggleTypeFilter('income')}
                  style={{
                    background: selectedType === 'income' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(34, 197, 94, 0.08)',
                    padding: '18px',
                    borderRadius: '18px',
                    border: '1px solid',
                    borderColor: selectedType === 'income' ? '#4ade80' : 'rgba(34, 197, 94, 0.15)',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    transform: selectedType === 'income' ? 'scale(1.02)' : 'scale(1)'
                  }}
                >
                  <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '4px' }}>Доход</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: '700', color: '#4ade80' }}>
                    +€{(timeRange === 'month' ? monthlyData.income : timeRange === 'year' ? yearlyData.income : (lifetimeStats?.income || 0)).toLocaleString('de-DE', { minimumFractionDigits: 2 })}
                  </div>
                </div>
                <div
                  onClick={() => toggleTypeFilter('expense')}
                  style={{
                    background: selectedType === 'expense' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(239, 68, 68, 0.08)',
                    padding: '18px',
                    borderRadius: '18px',
                    border: '1px solid',
                    borderColor: selectedType === 'expense' ? '#f87171' : 'rgba(239, 68, 68, 0.15)',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    transform: selectedType === 'expense' ? 'scale(1.02)' : 'scale(1)'
                  }}
                >
                  <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '4px' }}>Расход</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: '700', color: '#f87171' }}>
                    €{(timeRange === 'month' ? monthlyData.expense : timeRange === 'year' ? yearlyData.expense : (lifetimeStats?.expense || 0)).toLocaleString('de-DE', { minimumFractionDigits: 2 })}
                  </div>
                  {timeRange === 'month' && isActualCurrentMonth && (
                    <div style={{ fontSize: '0.7rem', color: 'rgba(239, 68, 68, 0.6)', marginTop: '2px', fontWeight: '500' }}>
                      Месяц назад: €{comparisonData.expense.toLocaleString('de-DE', { minimumFractionDigits: 2 })}
                    </div>
                  )}
                </div>
                <div style={{ background: 'rgba(0,0,0,0.02)', padding: '18px', borderRadius: '18px', border: '1px solid rgba(0,0,0,0.03)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: timeRange === 'month' ? '12px' : '0' }}>
                    <span style={{ color: 'var(--color-text-muted)' }}>Сальдо:</span>
                    <span style={{ fontWeight: '700', color: ((timeRange === 'month' ? (monthlyData.income + monthlyData.expense) : timeRange === 'year' ? (yearlyData.income + yearlyData.expense) : (lifetimeStats?.total || 0)) >= 0) ? 'var(--color-text-main)' : '#ef4444' }}>
                      €{(timeRange === 'month' ? (monthlyData.income + monthlyData.expense) : timeRange === 'year' ? (yearlyData.income + yearlyData.expense) : (lifetimeStats?.total || 0)).toLocaleString('de-DE', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  {timeRange === 'month' && isActualCurrentMonth && (
                    <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', textAlign: 'right', marginTop: '-10px', marginBottom: '12px', fontWeight: '500' }}>
                      Месяц назад: <span style={{ color: comparisonData.saldo >= 0 ? '#10b981' : '#f87171' }}>{comparisonData.saldo > 0 ? '+' : ''}€{comparisonData.saldo.toLocaleString('de-DE', { minimumFractionDigits: 2 })}</span>
                    </div>
                  )}

                  {/* Current balance split by account type. Unlike the rows
                      above (period income/expense/saldo), these are current
                      balances - the divider marks that boundary so they
                      don't read as more period data. */}
                  <div style={{ height: '1px', background: 'rgba(0,0,0,0.06)', margin: '12px 0' }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '6px' }}>
                    <span style={{ color: 'var(--color-text-muted)' }}>💳 Безналичные</span>
                    <span style={{ fontWeight: '600', color: 'var(--color-text-main)' }}>€{balances.byType.card.toLocaleString('de-DE', { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                    <span style={{ color: 'var(--color-text-muted)' }}>💵 Наличные</span>
                    <span style={{ fontWeight: '600', color: 'var(--color-text-main)' }}>€{balances.byType.cash.toLocaleString('de-DE', { minimumFractionDigits: 2 })}</span>
                  </div>

                  {timeRange === 'month' && (
                    <>
                      {/* Progress Bar */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '0.8rem' }}>
                        <span style={{ color: 'var(--color-text-muted)' }}>Лимит €{monthlyLimit.toLocaleString()}</span>
                        <span style={{ fontWeight: '600', color: isOverLimit ? '#ef4444' : 'var(--color-text-main)' }}>{limitPercentDisplay}%</span>
                      </div>
                      <div style={{ height: '8px', background: 'rgba(0,0,0,0.05)', borderRadius: '4px', overflow: 'hidden' }}>
                        <div style={{
                          height: '100%',
                          width: `${limitBarWidthDisplay}%`,
                          background: isOverLimit ? '#ef4444' : 'var(--color-primary-gradient)',
                          transition: 'width 0.4s ease'
                        }} />
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <CategoryDonut data={monthlyData.categoryTotals} onToggle={() => setSummaryView('stats')} />
          )}

          {/* AI Analytics Removed */}

        </div>
      </main>

      {showAddTransaction && (
        <AddTransactionForm
          type={transactionType}
          categories={categories}
          onAddCategory={handleAddCategory}
          onClose={() => setShowAddTransaction(false)}
          onSubmit={handleAddTransaction}
          accounts={accounts}
          // Only a real account id preselects - the total-capital slide
          // (null) and any residual type:* filter value must fall through
          // to no preset, forcing an explicit choice.
          presetAccountId={accounts.some(a => a._id === selectedAccount) ? selectedAccount : undefined}
        />
      )}
      {editingTransaction && <AddTransactionForm initialData={editingTransaction} categories={categories} onAddCategory={handleAddCategory} onClose={() => setEditingTransaction(null)} onSubmit={handleUpdateTransaction} onDelete={(id) => handleDeleteTransaction(id, editingTransaction.splitId)} accounts={accounts} />}

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
        monthlyData={monthlyData}
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
          onDragEnd={onAccountDragEnd}
          onSaveSettings={handleSaveSettings}
          onLogout={handleLogout}
          showNotice={showNotice}
        />
      )}
    </div>
  );
}

export default App;
