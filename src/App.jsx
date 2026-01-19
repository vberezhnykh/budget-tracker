import { useState, useMemo, useEffect } from 'react'
import AddTransactionForm from './components/AddTransactionForm'
import CategoryDonut from './components/CategoryDonut'
import { transformTransactions, calculateBalances, getMonthlyData, getLifetimeStats } from './utils/finance'

// API URL - relative path for production data fetching
const API_URL = '/api/transactions';
const MONTHLY_LIMIT = 7000;

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

  // Transactions state
  const [transactions, setTransactions] = useState([]);

  // Fetch transactions on mount
  useEffect(() => {
    fetchTransactions();
  }, []);

  const fetchTransactions = async () => {
    try {
      const res = await fetch(API_URL);
      const data = await res.json();
      setTransactions(transformTransactions(data));
      setIsLoading(false);
    } catch (err) {
      console.error('Fetch error:', err);
      setIsLoading(false);
    }
  };

  // Calculate current balances (Total lifetime)
  const balances = useMemo(() => calculateBalances(transactions), [transactions]);

  // Filter transactions for the selected month
  const monthlyData = useMemo(() => getMonthlyData(transactions, selectedMonth), [transactions, selectedMonth]);

  // Calculate lifetime stats
  const lifetimeStats = useMemo(() => getLifetimeStats(transactions), [transactions]);

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
    const rows = transactions.sort((a, b) => new Date(b.date) - new Date(a.date)).map(t => [
      t.date,
      t.title,
      t.type === 'income' ? 'Доход' : t.type === 'expense' ? 'Расход' : t.type === 'transfer' ? 'Перевод' : 'Начало',
      t.category,
      t.account === 'cash' ? 'Наличные' : 'Карта',
      t.amount.toFixed(2),
      t.description || ''
    ]);

    const csvContent = [headers.join(','), ...rows.map(row => row.map(cell => `"${cell}"`).join(','))].join('\n');
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `budget_report_${selectedMonth}.csv`;
    link.click();
  };

  const handleAddTransaction = async (newTx) => {
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newTx)
      });
      if (res.ok) fetchTransactions();
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
    } catch (err) { console.error('Update error:', err); }
  };

  const handleDeleteTransaction = async (id, splitId = null) => {
    try {
      const url = splitId ? `${API_URL}/${id}?splitId=${splitId}` : `${API_URL}/${id}`;
      const res = await fetch(url, { method: 'DELETE' });
      if (res.ok) {
        fetchTransactions();
        setEditingTransaction(null);
      }
    } catch (err) { console.error('Delete error:', err); }
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
    return new Date(dateStr).toLocaleDateString('ru-RU', options);
  };

  const isPrevDisabled = selectedMonth === '2025-11';
  const isNextDisabled = selectedMonth === new Date().toISOString().slice(0, 7);

  if (isLoading) return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', color: '#fff' }}>Загрузка...</div>;

  return (
    <div className="layout-container">
      {/* Premium Header */}
      <header className="glass-panel" style={{ padding: '24px', marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '28px' }}>
          <div style={{
            fontSize: '1.8rem',
            background: 'var(--color-primary-gradient)',
            width: '48px',
            height: '48px',
            borderRadius: '14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 15px var(--color-primary-glow)'
          }}>
            👛
          </div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: '800', letterSpacing: '-0.5px' }}>BudgetTracker</h1>
        </div>

        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)', marginBottom: '8px', letterSpacing: '0.5px' }}>ОБЩИЙ КАПИТАЛ</div>
          <div className="balance-amount" style={{ fontSize: '2.5rem', fontWeight: '800' }}>
            €{balances.total.toLocaleString('de-DE', { minimumFractionDigits: 2 })}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '16px' }}>
          {/* Card Account */}
          <div style={{ flex: 1, padding: '20px', background: 'rgba(255,255,255,0.03)', borderRadius: '20px', border: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
              <span style={{ fontSize: '1.2rem' }}>💳</span>
              <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', fontWeight: '500' }}>Карта</div>
            </div>
            <div style={{ fontSize: '1.3rem', fontWeight: '700' }}>€{balances.card.toLocaleString('de-DE', { minimumFractionDigits: 2 })}</div>
          </div>
          {/* Cash Account */}
          <div style={{ flex: 1, padding: '20px', background: 'rgba(255,255,255,0.03)', borderRadius: '20px', border: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
              <span style={{ fontSize: '1.2rem' }}>💵</span>
              <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', fontWeight: '500' }}>Наличные</div>
            </div>
            <div style={{ fontSize: '1.3rem', fontWeight: '700' }}>€{balances.cash.toLocaleString('de-DE', { minimumFractionDigits: 2 })}</div>
          </div>
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
            {new Date(selectedMonth).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }).replace(' г.', '')}
          </h2>
          <button onClick={() => handleMonthChange(1)} disabled={isNextDisabled} style={{ background: 'transparent', color: 'var(--color-text-muted)', fontSize: '1.5rem', opacity: isNextDisabled ? 0.3 : 1 }}>→</button>
        </div>

        {/* Summary Card with Budget Limit */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '24px', marginBottom: '24px' }}>
          {summaryView === 'stats' ? (
            <div className="glass-panel" style={{ padding: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <div style={{ display: 'flex', gap: '8px', background: 'rgba(255,255,255,0.05)', padding: '4px', borderRadius: '10px' }}>
                  <button
                    onClick={() => setTimeRange('month')}
                    style={{
                      background: timeRange === 'month' ? 'rgba(255,255,255,0.1)' : 'transparent',
                      border: 'none',
                      borderRadius: '6px',
                      padding: '4px 12px',
                      color: '#fff',
                      fontSize: '0.75rem',
                      fontWeight: timeRange === 'month' ? 'bold' : 'normal'
                    }}
                  >
                    Месяц
                  </button>
                  <button
                    onClick={() => setTimeRange('lifetime')}
                    style={{
                      background: timeRange === 'lifetime' ? 'rgba(255,255,255,0.1)' : 'transparent',
                      border: 'none',
                      borderRadius: '6px',
                      padding: '4px 12px',
                      color: '#fff',
                      fontSize: '0.75rem',
                      fontWeight: timeRange === 'lifetime' ? 'bold' : 'normal'
                    }}
                  >
                    Всё время
                  </button>
                </div>
                <button onClick={() => setSummaryView('analytics')} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '6px 12px', color: '#fff', fontSize: '0.8rem' }}>
                  Аналитика →
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ background: 'rgba(34, 197, 94, 0.08)', padding: '18px', borderRadius: '18px', border: '1px solid rgba(34, 197, 94, 0.15)' }}>
                  <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '4px' }}>Доход</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: '700', color: '#4ade80' }}>
                    +€{(timeRange === 'month' ? monthlyData.income : lifetimeStats.income).toLocaleString('de-DE', { minimumFractionDigits: 2 })}
                  </div>
                </div>
                <div style={{ background: 'rgba(239, 68, 68, 0.08)', padding: '18px', borderRadius: '18px', border: '1px solid rgba(239, 68, 68, 0.15)' }}>
                  <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '4px' }}>Расход</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: '700', color: '#f87171' }}>
                    €{(timeRange === 'month' ? monthlyData.expense : lifetimeStats.expense).toLocaleString('de-DE', { minimumFractionDigits: 2 })}
                  </div>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.03)', padding: '18px', borderRadius: '18px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: timeRange === 'month' ? '12px' : '0' }}>
                    <span style={{ color: 'var(--color-text-muted)' }}>Сальдо:</span>
                    <span style={{ fontWeight: '700', color: ((timeRange === 'month' ? (monthlyData.income + monthlyData.expense) : lifetimeStats.total) >= 0) ? '#fff' : '#f87171' }}>
                      €{(timeRange === 'month' ? (monthlyData.income + monthlyData.expense) : lifetimeStats.total).toLocaleString('de-DE', { minimumFractionDigits: 2 })}
                    </span>
                  </div>

                  {timeRange === 'month' && (
                    <>
                      {/* Progress Bar */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '0.8rem' }}>
                        <span style={{ color: 'var(--color-text-muted)' }}>Лимит €{MONTHLY_LIMIT.toLocaleString()}</span>
                        <span>{Math.round((Math.abs(monthlyData.expense) / MONTHLY_LIMIT) * 100)}%</span>
                      </div>
                      <div style={{ height: '6px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px', overflow: 'hidden' }}>
                        <div style={{
                          height: '100%',
                          width: `${Math.min((Math.abs(monthlyData.expense) / MONTHLY_LIMIT) * 100, 100)}%`,
                          background: Math.abs(monthlyData.expense) > MONTHLY_LIMIT ? '#f87171' : 'var(--color-primary-gradient)',
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
            <div style={{ padding: '24px', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0 }}>История</h3>
              <button onClick={exportToCSV} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', padding: '6px 12px', borderRadius: '8px', color: 'var(--color-text-muted)', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '5px' }}>
                <span>💾</span> Экспорт
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {Object.keys(monthlyData.transactions).length === 0 ? (
                <div style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-muted)' }}>Нет операций</div>
              ) : (
                Object.keys(monthlyData.transactions).sort((a, b) => new Date(b) - new Date(a)).map(date => (
                  <div key={date}>
                    <div style={{ padding: '10px 24px', background: 'rgba(255,255,255,0.02)', fontSize: '0.8rem', color: 'var(--color-text-muted)', borderBottom: '1px solid rgba(255,255,255,0.03)', display: 'flex', justifyContent: 'space-between' }}>
                      <span>{formatDate(date)}</span>
                      {monthlyData.transactions[date].dailySum !== 0 && (
                        <span style={{ fontWeight: '600', color: monthlyData.transactions[date].dailySum > 0 ? '#4ade80' : 'rgba(255,255,255,0.3)' }}>
                          {monthlyData.transactions[date].dailySum > 0 ? '+' : ''}{monthlyData.transactions[date].dailySum.toFixed(2)}€
                        </span>
                      )}
                    </div>
                    {monthlyData.transactions[date].items.map(item => {
                      if (item.type === 'split_group') {
                        return (
                          <div key={item.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', background: 'rgba(255,255,255,0.01)' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                <div style={{ width: '38px', height: '38px', borderRadius: '12px', background: 'rgba(129, 140, 248, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem' }}>
                                  🗂️
                                </div>
                                <div>
                                  <div style={{ fontWeight: '600', fontSize: '0.95rem' }}>{item.description} (Разделено)</div>
                                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                                    {item.account === 'cash' ? '💵 Наличные' : '💳 Карта'} • {item.items.length} катег.
                                  </div>
                                </div>
                              </div>
                              <div style={{ fontWeight: '700' }}>
                                €{Math.abs(item.visualAmount).toFixed(2)}
                              </div>
                            </div>
                            {/* Sub-items */}
                            <div style={{ paddingLeft: '54px', paddingBottom: '8px' }}>
                              {item.items.map(subItem => (
                                <div key={subItem.id} onClick={() => openEditModal(subItem)} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 24px 8px 16px', fontSize: '0.85rem', cursor: 'pointer', borderLeft: '2px solid rgba(129, 140, 248, 0.2)', marginBottom: '4px' }}>
                                  <div style={{ color: 'var(--color-text-muted)' }}>
                                    {subItem.category}
                                  </div>
                                  <div style={{ fontVariantNumeric: 'tabular-nums' }}>
                                    €{Math.abs(subItem.visualAmount).toFixed(2)}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      }

                      return (
                        <div key={item.id} onClick={() => openEditModal(item)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', borderBottom: '1px solid rgba(255,255,255,0.03)', cursor: 'pointer' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                            <div style={{ width: '38px', height: '38px', borderRadius: '12px', background: item.type === 'initial' ? 'rgba(99, 102, 241, 0.1)' : (item.visualAmount > 0 ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.05)'), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem' }}>
                              {item.type === 'initial' ? '🚀' : (item.visualAmount > 0 ? '↓' : '↑')}
                            </div>
                            <div>
                              <div style={{ fontWeight: '600', fontSize: '0.95rem' }}>
                                {item.description || item.title}
                              </div>
                              <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                                {item.account === 'cash' ? '💵 Наличные' : '💳 Карта'}
                                {item.category ? ` • ${item.category}` : ''}
                              </div>
                            </div>
                          </div>
                          <div style={{ fontWeight: '700', color: (item.type === 'initial' || item.type === 'transfer') ? '#818cf8' : (item.visualAmount > 0 ? '#4ade80' : '#fff') }}>
                            {item.type !== 'initial' && item.type !== 'transfer' && item.visualAmount > 0 ? '+' : ''}€{Math.abs(item.visualAmount).toFixed(2)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </main>

      {showAddTransaction && <AddTransactionForm type={transactionType} onClose={() => setShowAddTransaction(false)} onSubmit={handleAddTransaction} />}
      {editingTransaction && <AddTransactionForm initialData={editingTransaction} onClose={() => setEditingTransaction(null)} onSubmit={handleUpdateTransaction} onDelete={(id) => handleDeleteTransaction(id, editingTransaction.splitId)} />}
    </div>
  );
}

export default App;
