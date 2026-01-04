import { useState, useMemo, useEffect } from 'react'
import AddTransactionForm from './components/AddTransactionForm'

// API URL - relative path for production data fetching
const API_URL = '/api/transactions';

function App() {
  const [activeTab, setActiveTab] = useState('overview');
  const [showAddTransaction, setShowAddTransaction] = useState(false);
  const [transactionType, setTransactionType] = useState('expense');
  const [editingTransaction, setEditingTransaction] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // State for selected. Defaults to current month YYYY-MM
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));

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

      const formatted = data.map(t => {
        const amount = Number(t.amount);
        const isExpense = t.type === 'expense';
        const isTransfer = t.type === 'transfer';
        const signedAmount = isExpense ? -Math.abs(amount) : Math.abs(amount);

        let cashFlow = 0;
        let cardFlow = 0;
        let visualAmount = signedAmount;

        if (isTransfer) {
          visualAmount = amount; // Show amount in history
          if (t.account === 'cash') cashFlow = -amount;
          if (t.account === 'card') cardFlow = -amount;
          if (t.toAccount === 'cash') cashFlow = amount;
          if (t.toAccount === 'card') cardFlow = amount;
        } else {
          cashFlow = t.account === 'cash' ? signedAmount : 0;
          cardFlow = t.account === 'card' ? signedAmount : 0;
        }

        return {
          id: t._id,
          title: t.title,
          category: t.category,
          description: t.description,
          date: new Date(t.date).toISOString().split('T')[0],
          account: t.account,
          toAccount: t.toAccount,
          cashFlow,
          cardFlow,
          visualAmount,
          type: t.type
        };
      }).sort((a, b) => new Date(b.date) - new Date(a.date));

      setTransactions(formatted);
    } catch (err) {
      console.error('Error fetching transactions:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Calculate current balances (Total lifetime)
  const balances = useMemo(() => {
    const b = transactions.reduce((acc, curr) => {
      return {
        cash: acc.cash + curr.cashFlow,
        card: acc.card + curr.cardFlow
      };
    }, { cash: 0, card: 0 });
    return { ...b, total: b.cash + b.card };
  }, [transactions]);

  // Filter transactions for the selected month
  const monthlyData = useMemo(() => {
    const filtered = transactions.filter(t => t.date.startsWith(selectedMonth));

    // Calculate income only from positive visual amounts, excluding initial and transfers
    const income = filtered.reduce((acc, t) => (t.visualAmount > 0 && t.type !== 'initial' && t.type !== 'transfer') ? acc + t.visualAmount : acc, 0);
    // Calculate expense only from negative visual amounts, excluding transfers
    const expense = filtered.reduce((acc, t) => (t.visualAmount < 0 && t.type !== 'transfer') ? acc + t.visualAmount : acc, 0);

    // Group by date with daily totals
    const grouped = filtered.reduce((groups, t) => {
      const date = t.date;
      if (!groups[date]) {
        groups[date] = { items: [], dailySum: 0 };
      }
      groups[date].items.push(t);
      // Only add to daily sum if it's a real income/expense (not transfer/initial)
      if (t.type !== 'initial' && t.type !== 'transfer') {
        groups[date].dailySum += t.visualAmount;
      }
      return groups;
    }, {});

    return { transactions: grouped, income, expense };
  }, [transactions, selectedMonth]);

  const handleMonthChange = (direction) => {
    const [year, month] = selectedMonth.split('-').map(Number);
    const date = new Date(year, month - 1 + direction, 1);
    const localDate = new Date(date.getTime() - (date.getTimezoneOffset() * 60000));
    const newMonth = localDate.toISOString().slice(0, 7);

    // Bounds check
    const currentMonth = new Date().toISOString().slice(0, 7);
    if (newMonth < '2025-11' || newMonth > currentMonth) {
      return;
    }

    setSelectedMonth(newMonth);
  };

  const handleAddTransaction = async (newTx) => {
    try {
      const payload = {
        title: newTx.type === 'transfer' ? 'Обмен' : (newTx.description || newTx.category),
        amount: parseFloat(newTx.amount),
        type: newTx.type,
        category: newTx.type === 'transfer' ? 'Обмен' : newTx.category,
        description: newTx.description,
        account: newTx.account,
        toAccount: newTx.toAccount,
        date: newTx.date
      };

      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        fetchTransactions(); // Refresh data
        setShowAddTransaction(false);
      }
    } catch (err) {
      console.error('Error adding transaction:', err);
    }
  };

  const handleUpdateTransaction = async (updatedTx) => {
    try {
      const payload = {
        title: updatedTx.type === 'transfer' ? 'Обмен' : (updatedTx.description || updatedTx.category),
        amount: parseFloat(updatedTx.amount),
        type: updatedTx.type,
        category: updatedTx.type === 'transfer' ? 'Обмен' : updatedTx.category,
        description: updatedTx.description,
        account: updatedTx.account,
        toAccount: updatedTx.toAccount,
        date: updatedTx.date
      };

      const res = await fetch(`${API_URL}/${updatedTx.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        fetchTransactions();
        setShowAddTransaction(false);
        setEditingTransaction(null);
      }
    } catch (err) {
      console.error('Error updating transaction:', err);
    }
  };

  const handleDeleteTransaction = async (id) => {
    try {
      const res = await fetch(`${API_URL}/${id}`, {
        method: 'DELETE'
      });

      if (res.ok) {
        fetchTransactions();
        setShowAddTransaction(false);
        setEditingTransaction(null);
      }
    } catch (err) {
      console.error('Error deleting transaction:', err);
    }
  };

  const openAddModal = (type) => {
    setTransactionType(type);
    setEditingTransaction(null);
    setShowAddTransaction(true);
  };

  const openEditModal = (tx) => {
    // Determine account based on flows for editing
    const account = tx.cashFlow !== 0 ? 'cash' : 'card';
    setEditingTransaction({
      ...tx,
      amount: Math.abs(tx.visualAmount), // Show absolute amount in form
      account
    });
    setTransactionType(tx.type);
    setShowAddTransaction(true);
  };

  const formatDate = (dateString) => {
    const options = { day: 'numeric', month: 'long', weekday: 'long' };
    return new Date(dateString).toLocaleDateString('ru-RU', options);
  };

  const formatMonth = (monthString) => {
    const [year, month] = monthString.split('-');
    const date = new Date(year, month - 1);
    // Remove 'г.' from the output manually
    let formatted = date.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
    return formatted.replace(/\s*г\.?$/, '');
  };

  const currentMonth = new Date().toISOString().slice(0, 7);
  const isPrevDisabled = selectedMonth <= '2025-11';
  const isNextDisabled = selectedMonth >= currentMonth;

  return (
    <div className="layout-container animate-fade-in">
      {showAddTransaction && (
        <AddTransactionForm
          type={transactionType}
          initialData={editingTransaction}
          onClose={() => {
            setShowAddTransaction(false);
            setEditingTransaction(null);
          }}
          onSubmit={editingTransaction ? handleUpdateTransaction : handleAddTransaction}
          onDelete={handleDeleteTransaction}
        />
      )}

      <header style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '40px',
        paddingTop: '20px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            width: '40px',
            height: '40px',
            background: 'linear-gradient(135deg, var(--color-primary), var(--color-secondary))',
            borderRadius: '10px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 15px var(--color-primary-glow)'
          }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path stroke="none" d="M0 0h24v24H0z" fill="none" />
              <path d="M17.2 7a6 7 0 1 0 0 10" />
              <path d="M13.5 10h-9" />
              <path d="M13.5 14h-9" />
            </svg>
          </div>
          <h1 style={{ fontSize: '1.5rem', letterSpacing: '-0.02em' }}>BudgetTracker</h1>
        </div>
      </header>

      <main>
        {/* Balance Section */}
        <section style={{ marginBottom: '32px' }}>
          <div className="glass-panel" style={{
            padding: '40px',
            position: 'relative',
            overflow: 'hidden',
            background: 'linear-gradient(145deg, rgba(30,41,59,0.8), rgba(17,24,39,0.9))'
          }}>
            {/* Decorative blob */}
            <div style={{
              position: 'absolute',
              top: '-50px',
              right: '-50px',
              width: '200px',
              height: '200px',
              background: 'var(--color-primary)',
              filter: 'blur(80px)',
              opacity: '0.2',
              borderRadius: '50%'
            }}></div>

            <h2 style={{
              fontSize: '1rem',
              color: 'var(--color-text-muted)',
              fontWeight: '500',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: '8px'
            }}>Общий баланс</h2>

            <div style={{
              fontSize: 'clamp(2.5rem, 8vw, 4rem)',
              fontWeight: '700',
              background: 'linear-gradient(to right, #fff, #94a3b8)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              marginBottom: '16px',
              lineHeight: 1.1,
              wordBreak: 'break-all'
            }}>
              €{balances.total.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>

            {/* Sub-balances */}
            <div style={{
              display: 'flex',
              gap: '16px',
              marginBottom: '24px',
              flexWrap: 'wrap'
            }}>
              <div style={{
                background: 'rgba(255,255,255,0.05)',
                padding: '8px 16px',
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                <span style={{ fontSize: '1.2rem' }}>💳</span>
                <span style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>Карта:</span>
                <span style={{ fontWeight: '600' }}>€{balances.card.toLocaleString('de-DE', { minimumFractionDigits: 2 })}</span>
              </div>
              <div style={{
                background: 'rgba(255,255,255,0.05)',
                padding: '8px 16px',
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                <span style={{ fontSize: '1.2rem' }}>💵</span>
                <span style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>Нал:</span>
                <span style={{ fontWeight: '600' }}>€{balances.cash.toLocaleString('de-DE', { minimumFractionDigits: 2 })}</span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button
                className="glass-panel"
                onClick={() => openAddModal('income')}
                style={{
                  flex: 1,
                  padding: '12px',
                  color: 'var(--color-text-muted)',
                  fontWeight: '500',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '4px',
                  fontSize: '0.9rem'
                }}
              >
                <span>+</span> Доход
              </button>
              <button
                className="glass-panel"
                onClick={() => openAddModal('transfer')}
                style={{
                  flex: 1,
                  padding: '12px',
                  color: 'var(--color-text-muted)',
                  fontWeight: '500',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '4px',
                  fontSize: '0.9rem'
                }}
              >
                <span>⇄</span> Обмен
              </button>
              <button
                onClick={() => openAddModal('expense')}
                style={{
                  flex: 2,
                  background: 'linear-gradient(135deg, #f43f5e, #e11d48)',
                  color: 'white',
                  padding: '12px 24px',
                  borderRadius: 'var(--radius-md)',
                  fontWeight: '700',
                  fontSize: '1rem',
                  boxShadow: '0 4px 12px rgba(244, 63, 94, 0.4)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '4px'
                }}
              >
                <span>-</span> Расход
              </button>
            </div>
          </div>
        </section>

        {/* Month Selector */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '24px',
          background: 'rgba(255,255,255,0.03)',
          padding: '12px 20px',
          borderRadius: '16px',
          border: '1px solid rgba(255,255,255,0.05)'
        }}>
          <button
            onClick={() => handleMonthChange(-1)}
            disabled={isPrevDisabled}
            style={{
              background: 'transparent',
              color: 'var(--color-text-muted)',
              fontSize: '1.5rem',
              cursor: isPrevDisabled ? 'default' : 'pointer',
              opacity: isPrevDisabled ? 0.3 : 1
            }}
          >
            ←
          </button>
          <h2 style={{
            fontSize: '1.2rem',
            marginBottom: 0,
            textTransform: 'capitalize',
            textAlign: 'center',
            minWidth: '150px'
          }}>
            {formatMonth(selectedMonth)}
          </h2>
          <button
            onClick={() => handleMonthChange(1)}
            disabled={isNextDisabled}
            style={{
              background: 'transparent',
              color: 'var(--color-text-muted)',
              fontSize: '1.5rem',
              cursor: isNextDisabled ? 'default' : 'pointer',
              opacity: isNextDisabled ? 0.3 : 1
            }}
          >
            →
          </button>
        </div>

        {/* Dashboard Grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: '24px',
          alignItems: 'start'
        }}>

          {/* Monthly Stats Summary - Moved to top as requested */}
          <div className="glass-panel" style={{ padding: '24px', order: -1 }}>
            <h3 style={{ marginBottom: '24px' }}>Итоги месяца</h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{
                background: 'rgba(34, 197, 94, 0.1)', // Green tint
                padding: '20px',
                borderRadius: '16px',
                border: '1px solid rgba(34, 197, 94, 0.2)'
              }}>
                <div style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)', marginBottom: '4px' }}>Доход</div>
                <div style={{ fontSize: '1.5rem', fontWeight: '700', color: '#4ade80' }}>
                  +€{monthlyData.income.toLocaleString('de-DE', { minimumFractionDigits: 2 })}
                </div>
              </div>

              <div style={{
                background: 'rgba(239, 68, 68, 0.1)', // Red tint
                padding: '20px',
                borderRadius: '16px',
                border: '1px solid rgba(239, 68, 68, 0.2)'
              }}>
                <div style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)', marginBottom: '4px' }}>Расход</div>
                <div style={{ fontSize: '1.5rem', fontWeight: '700', color: '#f87171' }}>
                  €{monthlyData.expense.toLocaleString('de-DE', { minimumFractionDigits: 2 })}
                </div>
              </div>

              <div style={{
                background: 'rgba(255, 255, 255, 0.05)',
                padding: '20px',
                borderRadius: '16px',
                marginTop: '8px'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ color: 'var(--color-text-muted)' }}>Сальдо:</span>
                  <span style={{ fontWeight: '600', color: (monthlyData.income + monthlyData.expense) >= 0 ? '#fff' : '#f87171' }}>
                    €{(monthlyData.income + monthlyData.expense).toLocaleString('de-DE', { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Recent Activity (Grouped by Date) */}
          <div className="glass-panel" style={{ padding: '0', minHeight: '300px', overflow: 'hidden' }}>
            <div style={{
              padding: '24px 24px 16px',
              borderBottom: '1px solid rgba(255,255,255,0.05)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <h3 style={{ margin: 0 }}>История</h3>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {Object.keys(monthlyData.transactions).length === 0 ? (
                <div style={{ padding: '32px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                  Нет операций за этот месяц
                </div>
              ) : (
                Object.keys(monthlyData.transactions).sort((a, b) => new Date(b) - new Date(a)).map(date => (
                  <div key={date}>
                    <div style={{
                      padding: '12px 24px',
                      background: 'rgba(255,255,255,0.02)',
                      fontSize: '0.875rem',
                      color: 'var(--color-text-muted)',
                      textTransform: 'capitalize',
                      fontWeight: '500',
                      borderBottom: '1px solid rgba(255,255,255,0.03)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}>
                      <span>{formatDate(date)}</span>
                      {monthlyData.transactions[date].dailySum !== 0 && (
                        <span style={{
                          fontWeight: '600',
                          color: monthlyData.transactions[date].dailySum > 0 ? '#4ade80' : 'rgba(255,255,255,0.4)',
                          fontSize: '0.75rem'
                        }}>
                          {monthlyData.transactions[date].dailySum > 0 ? '+' : ''}
                          {monthlyData.transactions[date].dailySum.toFixed(2)}€
                        </span>
                      )}
                    </div>
                    {monthlyData.transactions[date].items.map((item, i) => (
                      <div
                        key={item.id}
                        onClick={() => openEditModal(item)}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '16px 24px',
                          borderBottom: '1px solid rgba(255,255,255,0.03)',
                          cursor: 'pointer',
                          transition: 'background 0.2s'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                          <div style={{
                            width: '36px',
                            height: '36px',
                            borderRadius: '50%',
                            background: item.type === 'initial'
                              ? 'rgba(99, 102, 241, 0.1)'
                              : (item.visualAmount > 0 ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)'),
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '1rem',
                            color: item.type === 'initial' ? '#818cf8' : 'inherit'
                          }}>
                            {item.type === 'initial' ? '🚀' : (item.visualAmount > 0 ? '↓' : '↑')}
                          </div>
                          <div>
                            <div style={{ fontWeight: '500', color: '#fff' }}>{item.title}</div>
                            <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                              {item.cashFlow !== 0 ? 'Наличные' : 'Карта'}
                            </div>
                          </div>
                        </div>
                        <div style={{
                          fontWeight: '600',
                          color: (item.type === 'initial' || item.type === 'transfer') ? '#818cf8' : (item.visualAmount > 0 ? '#4ade80' : '#fff')
                        }}>
                          {item.type !== 'initial' && item.type !== 'transfer' && item.visualAmount > 0 ? '+' : ''}€{Math.abs(item.visualAmount).toFixed(2)}
                        </div>
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

export default App
