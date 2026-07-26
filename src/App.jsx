import { useState, useMemo, useEffect, useRef } from 'react'
import AddTransactionForm from './components/AddTransactionForm'
import CategoryDonut from './components/CategoryDonut'
import { transformTransactions, calculateBalances, getMonthlyData, getYearlyData, getLifetimeStats, getSearchResults, getComparisonData } from './utils/finance'

// API URL - relative path for production data fetching
const API_URL = '/api/transactions';
const CATEGORIES_URL = '/api/categories';
const ACCOUNTS_URL = '/api/accounts';
const MONTHLY_LIMIT = 7000;

function AccountListItem({ account, onDelete, onEdit }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '12px 16px',
      background: 'rgba(0, 0, 0, 0.02)',
      borderRadius: '16px',
      border: '1px solid rgba(0, 0, 0, 0.05)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{ fontSize: '1.25rem' }}>{account.icon || (account.type === 'cash' ? '💵' : '💳')}</span>
        <div>
          <div style={{ fontSize: '0.9rem', fontWeight: '600', color: 'var(--color-text-main)' }}>{account.name}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
            {account.type === 'cash' ? 'Наличные' : 'Карта'} {account.isDefault ? '(Стандартный)' : ''}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '8px' }}>
        <button 
          onClick={onEdit}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--color-primary)',
            cursor: 'pointer',
            fontSize: '0.8rem',
            fontWeight: '600',
            padding: '4px'
          }}
        >
          Изменить
        </button>
        <button 
          onClick={onDelete}
          style={{
            background: 'none',
            border: 'none',
            color: '#ef4444',
            cursor: 'pointer',
            fontSize: '0.8rem',
            fontWeight: '600',
            padding: '4px'
          }}
        >
          Удалить
        </button>
      </div>
    </div>
  );
}

function App() {
  const [activeTab, setActiveTab] = useState('overview');
  const [showAddTransaction, setShowAddTransaction] = useState(false);
  const [transactionType, setTransactionType] = useState('expense');
  const [editingTransaction, setEditingTransaction] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

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
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState('card');
  const [formIcon, setFormIcon] = useState('💳');
  const [editingAccountId, setEditingAccountId] = useState(null);

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

  // Fetch data on mount
  useEffect(() => {
    const initData = async () => {
      try {
        const loadedAccounts = await fetchAccounts();
        await fetchTransactions(loadedAccounts);
        await fetchCategories();
      } catch (err) {
        console.error('Initialization error:', err);
        setIsLoading(false);
      }
    };
    initData();
  }, []);

  // Lock body scroll when modal is open
  useEffect(() => {
    if (showAddTransaction || editingTransaction) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }

    // Cleanup on unmount
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [showAddTransaction, editingTransaction]);

  // Cancel any pending rAF-throttled carousel scroll handler / settle-debounce timer on unmount
  useEffect(() => {
    return () => {
      if (carouselRafRef.current) cancelAnimationFrame(carouselRafRef.current);
      if (carouselSettleTimeoutRef.current) clearTimeout(carouselSettleTimeoutRef.current);
    };
  }, []);

  const fetchAccounts = async () => {
    try {
      const res = await fetch(ACCOUNTS_URL);
      const data = await res.json();
      setAccounts(data);
      return data;
    } catch (err) {
      console.error('Fetch accounts error:', err);
      return [];
    }
  };

  const fetchTransactions = async (currentAccounts) => {
    try {
      const res = await fetch(API_URL);
      if (!res.ok) throw new Error('Failed to fetch transactions');
      const data = await res.json();
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
      const res = await fetch(CATEGORIES_URL);
      const data = await res.json();
      setCategories(data);
    } catch (err) {
      console.error('Fetch categories error:', err);
    }
  };

  const handleAddCategory = async (name, type) => {
    try {
      const res = await fetch(CATEGORIES_URL, {
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
  // then the two type groups, then one slide per individual account.
  const slides = useMemo(() => {
    const base = [
      { key: 'total', icon: '💰', name: 'Общий капитал', amount: balances.total, filter: null },
      { key: 'type:card', icon: '💳', name: 'Безналичные', amount: balances.byType.card, filter: 'type:card' },
      { key: 'type:cash', icon: '💵', name: 'Наличные', amount: balances.byType.cash, filter: 'type:cash' },
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
      const res = await fetch(API_URL, {
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
      const res = await fetch(`${API_URL}/${updatedTx.id}`, {
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
      const res = await fetch(url, { method: 'DELETE' });
      if (res.ok) {
        fetchTransactions();
        setEditingTransaction(null);
      } else console.error('Delete failed:', await res.text());
    } catch (err) { console.error('Delete error:', err); }
  };

  const handleSaveAccount = async (e) => {
    e.preventDefault();
    if (!formName.trim()) return;

    try {
      let res;
      if (editingAccountId) {
        res = await fetch(`${ACCOUNTS_URL}/${editingAccountId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: formName, icon: formIcon })
        });
      } else {
        res = await fetch(ACCOUNTS_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: formName, type: formType, icon: formIcon })
        });
      }

      if (res.ok) {
        setFormName('');
        setFormType('card');
        setFormIcon('💳');
        setEditingAccountId(null);
        const freshAccounts = await fetchAccounts();
        await fetchTransactions(freshAccounts);
      } else {
        const err = await res.json();
        alert(err.message || 'Ошибка сохранения счёта');
      }
    } catch (err) {
      console.error('Save account error:', err);
    }
  };

  const handleDeleteAccount = async (id, name) => {
    if (!confirm(`Вы уверены, что хотите удалить счёт "${name}"?`)) return;

    try {
      const res = await fetch(`${ACCOUNTS_URL}/${id}`, { method: 'DELETE' });
      if (res.ok) {
        const freshAccounts = await fetchAccounts();
        await fetchTransactions(freshAccounts);
      } else {
        const err = await res.json();
        alert(err.message || 'Не удалось удалить счёт');
      }
    } catch (err) {
      console.error('Delete account error:', err);
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

  const isPrevDisabled = selectedMonth === '2025-11';
  const isNextDisabled = selectedMonth === new Date().toISOString().slice(0, 7);

  if (isLoading) return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', color: '#fff' }}>Загрузка...</div>;

  return (
    <div className="layout-container">
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
          {slides.map((slide, index) => {
            const isActive = slide.filter === selectedAccount;
            return (
              <div
                key={slide.key}
                data-carousel-slide
                onClick={() => handleSlideClick(slide, index)}
                style={{
                  flex: '0 0 88%',
                  scrollSnapAlign: 'center',
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
                  {slide.name.toUpperCase()}
                </div>
                <div className="balance-amount" style={{ fontSize: '2.2rem', fontWeight: '800', color: 'var(--color-text-main)' }}>
                  €{slide.amount.toLocaleString('de-DE', { minimumFractionDigits: 2 })}
                </div>
              </div>
            );
          })}
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
                  // Dot stays 6px, but the button carries padding so the touch
                  // target is finger-sized rather than 6px.
                  width: '22px',
                  height: '22px',
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

      <main>
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

                  {timeRange === 'month' && (
                    <>
                      {/* Progress Bar */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '0.8rem' }}>
                        <span style={{ color: 'var(--color-text-muted)' }}>Лимит €{MONTHLY_LIMIT.toLocaleString()}</span>
                        <span style={{ fontWeight: '600', color: Math.abs(monthlyData.expense) > MONTHLY_LIMIT ? '#ef4444' : 'var(--color-text-main)' }}>{Math.round((Math.abs(monthlyData.expense) / MONTHLY_LIMIT) * 100)}%</span>
                      </div>
                      <div style={{ height: '8px', background: 'rgba(0,0,0,0.05)', borderRadius: '4px', overflow: 'hidden' }}>
                        <div style={{
                          height: '100%',
                          width: `${Math.min((Math.abs(monthlyData.expense) / MONTHLY_LIMIT) * 100, 100)}%`,
                          background: Math.abs(monthlyData.expense) > MONTHLY_LIMIT ? '#ef4444' : 'var(--color-primary-gradient)',
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

          {/* Transaction History */}
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
                      Счет: <strong>{selectedAccount === 'type:card' ? 'Все карты' : selectedAccount === 'type:cash' ? 'Все наличные' : (accounts.find(a => a._id === selectedAccount)?.name || selectedAccount)}</strong>
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
      </main>

      {showAddTransaction && <AddTransactionForm type={transactionType} categories={categories} onAddCategory={handleAddCategory} onClose={() => setShowAddTransaction(false)} onSubmit={handleAddTransaction} accounts={accounts} />}
      {editingTransaction && <AddTransactionForm initialData={editingTransaction} categories={categories} onAddCategory={handleAddCategory} onClose={() => setEditingTransaction(null)} onSubmit={handleUpdateTransaction} onDelete={(id) => handleDeleteTransaction(id, editingTransaction.splitId)} accounts={accounts} />}

      {showAccountsSettings && (
        <div 
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(15, 23, 42, 0.4)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '20px'
          }}
          onClick={() => {
            setShowAccountsSettings(false);
            setEditingAccountId(null);
            setFormName('');
            setFormIcon('💳');
            setFormType('card');
          }}
        >
          <div 
            style={{
              background: '#fff',
              borderRadius: '24px',
              width: '100%',
              maxWidth: '500px',
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: '24px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
              display: 'flex',
              flexDirection: 'column',
              gap: '20px',
              position: 'relative'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: '1.25rem', fontWeight: '800', color: 'var(--color-text-main)', margin: 0 }}>Управление счетами</h2>
              <button 
                onClick={() => {
                  setShowAccountsSettings(false);
                  setEditingAccountId(null);
                  setFormName('');
                  setFormIcon('💳');
                  setFormType('card');
                }}
                style={{
                  background: 'rgba(0,0,0,0.05)',
                  border: 'none',
                  borderRadius: '50%',
                  width: '32px',
                  height: '32px',
                  cursor: 'pointer',
                  fontSize: '1rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--color-text-muted)',
                  fontWeight: 'bold'
                }}
              >
                ✕
              </button>
            </div>

            {/* Account Form */}
            <form onSubmit={handleSaveAccount} style={{ display: 'flex', flexDirection: 'column', gap: '12px', background: 'rgba(0,0,0,0.01)', padding: '16px', borderRadius: '16px', border: '1px dashed rgba(0,0,0,0.1)' }}>
              <h3 style={{ fontSize: '0.9rem', fontWeight: '700', color: 'var(--color-text-muted)', margin: 0 }}>
                {editingAccountId ? 'Редактировать счёт' : 'Добавить новый счёт'}
              </h3>
              
              <div style={{ display: 'flex', gap: '10px' }}>
                <input 
                  type="text" 
                  placeholder="Имя счёта (например, Мой Revolut)" 
                  value={formName} 
                  onChange={(e) => setFormName(e.target.value)}
                  required
                  style={{
                    flex: 1,
                    padding: '10px 14px',
                    borderRadius: '12px',
                    border: '1px solid rgba(0,0,0,0.15)',
                    fontSize: '0.85rem',
                    outline: 'none'
                  }}
                />
                
                <input 
                  type="text" 
                  placeholder="Иконка/Эмодзи" 
                  value={formIcon} 
                  onChange={(e) => setFormIcon(e.target.value)}
                  style={{
                    width: '60px',
                    padding: '10px 0',
                    textAlign: 'center',
                    borderRadius: '12px',
                    border: '1px solid rgba(0,0,0,0.15)',
                    fontSize: '1rem',
                    outline: 'none'
                  }}
                  title="Эмодзи для счёта"
                />
              </div>

              {!editingAccountId && (
                <div style={{ display: 'flex', gap: '16px', fontSize: '0.85rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                    <input 
                      type="radio" 
                      name="formType" 
                      value="card" 
                      checked={formType === 'card'} 
                      onChange={() => {
                        setFormType('card');
                        setFormIcon('💳');
                      }} 
                    />
                    Карта 💳
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                    <input 
                      type="radio" 
                      name="formType" 
                      value="cash" 
                      checked={formType === 'cash'} 
                      onChange={() => {
                        setFormType('cash');
                        setFormIcon('💵');
                      }} 
                    />
                    Наличные 💵
                  </label>
                </div>
              )}

              <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                <button 
                  type="submit" 
                  className="btn-primary" 
                  style={{
                    flex: 1,
                    padding: '10px',
                    borderRadius: '12px',
                    fontSize: '0.85rem',
                    fontWeight: '600',
                    cursor: 'pointer'
                  }}
                >
                  {editingAccountId ? 'Сохранить изменения' : 'Добавить счёт'}
                </button>
                
                {editingAccountId && (
                  <button 
                    type="button" 
                    onClick={() => {
                      setFormName('');
                      setFormType('card');
                      setFormIcon('💳');
                      setEditingAccountId(null);
                    }}
                    style={{
                      background: 'rgba(0,0,0,0.05)',
                      border: 'none',
                      padding: '10px 16px',
                      borderRadius: '12px',
                      fontSize: '0.85rem',
                      fontWeight: '600',
                      cursor: 'pointer',
                      color: 'var(--color-text-main)'
                    }}
                  >
                    Отмена
                  </button>
                )}
              </div>
            </form>

            {/* Accounts List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <h3 style={{ fontSize: '0.95rem', fontWeight: '700', color: 'var(--color-text-muted)', margin: 0 }}>Список счетов</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto', maxHeight: '250px', paddingRight: '4px' }}>
                {accounts.map(acc => (
                  <AccountListItem 
                    key={acc._id} 
                    account={acc}
                    onEdit={() => {
                      setFormName(acc.name);
                      setFormType(acc.type);
                      setFormIcon(acc.icon || (acc.type === 'cash' ? '💵' : '💳'));
                      setEditingAccountId(acc._id);
                    }}
                    onDelete={() => handleDeleteAccount(acc._id, acc.name)}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
