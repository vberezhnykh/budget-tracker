import { useMemo, useState } from 'react';
import Field from './ui/Field';
import IconButton from './ui/IconButton';
import Sheet from './ui/Sheet';
import { groupPlannedPayments, plannedDateKey, toLocalDateInput } from '../utils/plannedPayments';

const controlStyle = {
  width: '100%',
  padding: '10px 14px',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--color-border-strong)',
  background: 'var(--color-surface)',
  color: 'var(--color-text-main)',
  fontSize: 'var(--text-base)',
};

const secondaryButtonStyle = {
  padding: '9px 12px',
  borderRadius: 'var(--radius-md)',
  background: 'var(--color-surface-inset)',
  color: 'var(--color-text-main)',
  fontWeight: '600',
};

function money(value) {
  return `€${(Number(value) || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function displayDate(value) {
  const key = plannedDateKey(value);
  if (!key) return 'Дата не указана';
  return new Date(`${key}T00:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

function accountName(accounts, id) {
  return accounts.find(account => account._id === id)?.name
    || (id === 'card' ? 'Карта' : id === 'cash' ? 'Наличные' : 'Неизвестный счёт');
}

function FormRow({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)', fontWeight: '600' }}>
      {label}
      {children}
    </label>
  );
}

function PaymentFormSheet({ payment, accounts, categories, onSave, onClose }) {
  const [form, setForm] = useState({
    title: payment?.title || '',
    amount: payment?.amount ?? '',
    dueDate: plannedDateKey(payment?.dueDate) || toLocalDateInput(),
    account: payment?.account || accounts[0]?._id || '',
    category: payment?.category || categories.find(category => category.type === 'expense')?.name || '',
    description: payment?.description || '',
  });
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const expenseCategories = categories.filter(category => category.type === 'expense');
  const accountIsMissing = Boolean(form.account) && !accounts.some(account => account._id === form.account);
  const categoryIsMissing = Boolean(form.category) && !expenseCategories.some(category => category.name === form.category);

  const submit = async (event) => {
    event.preventDefault();
    if (pending) return;
    const amount = Number(form.amount);
    if (!form.title.trim() || !Number.isFinite(amount) || amount <= 0 || !form.dueDate || !form.account || !form.category) {
      setError('Заполните название, сумму, дату, счёт и категорию.');
      return;
    }
    setPending(true);
    setError('');
    try {
      const result = await onSave({ ...form, title: form.title.trim(), description: form.description.trim(), amount });
      if (result?.ok) onClose();
      else setError(result?.error || 'Не удалось сохранить платёж.');
    } finally {
      setPending(false);
    }
  };

  const requestClose = () => {
    if (!pending) onClose();
  };

  return (
    <Sheet ariaLabel={payment ? 'Изменить предстоящий платёж' : 'Добавить предстоящий платёж'} onClose={requestClose}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
        <h2 style={{ margin: 0, fontSize: 'var(--text-3xl)' }}>{payment ? 'Изменить платёж' : 'Новый платёж'}</h2>
        <IconButton round tone="neutral" onClick={requestClose} aria-label="Закрыть форму платежа">✕</IconButton>
      </div>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <FormRow label="Название">
          <Field value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} placeholder="Например, аренда" autoFocus />
        </FormRow>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '10px' }}>
          <FormRow label="Плановая сумма, €">
            <Field type="number" min="0.01" step="0.01" value={form.amount} onChange={event => setForm({ ...form, amount: event.target.value })} />
          </FormRow>
          <FormRow label="Дата платежа">
            <Field type="date" value={form.dueDate} onChange={event => setForm({ ...form, dueDate: event.target.value })} />
          </FormRow>
        </div>
        <FormRow label="Счёт">
          <select aria-label="Счёт платежа" value={form.account} onChange={event => setForm({ ...form, account: event.target.value })} style={controlStyle}>
            <option value="">Выберите счёт</option>
            {accountIsMissing && <option value={form.account}>{accountName(accounts, form.account)} (нет в списке)</option>}
            {accounts.map(account => <option key={account._id} value={account._id}>{account.name}</option>)}
          </select>
        </FormRow>
        <FormRow label="Категория">
          <select aria-label="Категория платежа" value={form.category} onChange={event => setForm({ ...form, category: event.target.value })} style={controlStyle}>
            <option value="">Выберите категорию</option>
            {categoryIsMissing && <option value={form.category}>{form.category} (удалена)</option>}
            {expenseCategories.map(category => <option key={category._id || category.name} value={category.name}>{category.name}</option>)}
          </select>
        </FormRow>
        <FormRow label="Комментарий (необязательно)">
          <Field value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} placeholder="Детали платежа" />
        </FormRow>
        {error && <div role="alert" style={{ color: 'var(--color-negative)', fontSize: 'var(--text-sm)' }}>{error}</div>}
        <button type="submit" className="btn-primary" disabled={pending} style={{ width: '100%' }}>
          {pending ? 'Сохранение...' : 'Сохранить'}
        </button>
      </form>
    </Sheet>
  );
}

function PaySheet({ payment, accounts, categories, transactions, onPay, onClose }) {
  const [mode, setMode] = useState('new');
  const [form, setForm] = useState({
    date: toLocalDateInput(),
    amount: payment.amount,
    account: payment.account || accounts[0]?._id || '',
    category: payment.category || categories.find(category => category.type === 'expense')?.name || '',
    transactionId: '',
  });
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const expenseCategories = categories.filter(category => category.type === 'expense');
  const accountIsMissing = Boolean(form.account) && !accounts.some(account => account._id === form.account);
  const categoryIsMissing = Boolean(form.category) && !expenseCategories.some(category => category.name === form.category);
  const existingExpenses = transactions
    .filter(transaction => transaction.type === 'expense')
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  const submit = async (event) => {
    event.preventDefault();
    if (pending) return;
    let payload;
    if (mode === 'existing') {
      if (!form.transactionId) {
        setError('Выберите уже учтённый расход.');
        return;
      }
      payload = { transactionId: form.transactionId };
    } else {
      const amount = Number(form.amount);
      if (!form.date || !Number.isFinite(amount) || amount <= 0 || !form.account || !form.category) {
        setError('Заполните дату, фактическую сумму, счёт и категорию.');
        return;
      }
      payload = { date: form.date, amount, account: form.account, category: form.category };
    }

    setPending(true);
    setError('');
    try {
      const result = await onPay(payload);
      if (result?.ok) onClose();
      else setError(result?.error || 'Не удалось отметить платёж оплаченным.');
    } finally {
      setPending(false);
    }
  };

  const requestClose = () => {
    if (!pending) onClose();
  };

  return (
    <Sheet ariaLabel={`Оплатить: ${payment.title}`} onClose={requestClose}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: 'var(--text-3xl)', overflowWrap: 'anywhere' }}>Оплатить «{payment.title}»</h2>
          <div style={{ marginTop: '4px', color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>План: {money(payment.amount)} · {displayDate(payment.dueDate)}</div>
        </div>
        <IconButton round tone="neutral" onClick={requestClose} aria-label="Закрыть форму оплаты">✕</IconButton>
      </div>
      <div role="group" aria-label="Способ учёта платежа" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
        {[
          ['new', 'Создать расход'],
          ['existing', 'Уже учтён'],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            onClick={() => { setMode(value); setError(''); }}
            style={{ ...secondaryButtonStyle, background: mode === value ? 'var(--color-primary-tint)' : 'var(--color-surface-inset)', color: mode === value ? 'var(--color-primary)' : 'var(--color-text-main)' }}
          >
            {label}
          </button>
        ))}
      </div>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {mode === 'existing' ? (
          <FormRow label="Активный расход">
            <select aria-label="Уже учтённый расход" value={form.transactionId} onChange={event => setForm({ ...form, transactionId: event.target.value })} style={controlStyle}>
              <option value="">Выберите расход</option>
              {existingExpenses.map(transaction => (
                <option key={transaction.id} value={transaction.id}>
                  {displayDate(transaction.date)} · {money(transaction.amount)} · {accountName(accounts, transaction.account)} · {transaction.category || transaction.title}
                </option>
              ))}
            </select>
          </FormRow>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '10px' }}>
              <FormRow label="Дата факта">
                <Field type="date" value={form.date} onChange={event => setForm({ ...form, date: event.target.value })} />
              </FormRow>
              <FormRow label="Фактическая сумма, €">
                <Field type="number" min="0.01" step="0.01" value={form.amount} onChange={event => setForm({ ...form, amount: event.target.value })} />
              </FormRow>
            </div>
            <FormRow label="Счёт">
              <select aria-label="Фактический счёт" value={form.account} onChange={event => setForm({ ...form, account: event.target.value })} style={controlStyle}>
                <option value="">Выберите счёт</option>
                {accountIsMissing && <option value={form.account}>{accountName(accounts, form.account)} (нет в списке)</option>}
                {accounts.map(account => <option key={account._id} value={account._id}>{account.name}</option>)}
              </select>
            </FormRow>
            <FormRow label="Категория">
              <select aria-label="Фактическая категория" value={form.category} onChange={event => setForm({ ...form, category: event.target.value })} style={controlStyle}>
                <option value="">Выберите категорию</option>
                {categoryIsMissing && <option value={form.category}>{form.category} (удалена)</option>}
                {expenseCategories.map(category => <option key={category._id || category.name} value={category.name}>{category.name}</option>)}
              </select>
            </FormRow>
          </>
        )}
        {error && <div role="alert" style={{ color: 'var(--color-negative)', fontSize: 'var(--text-sm)' }}>{error}</div>}
        <button type="submit" className="btn-primary" disabled={pending} style={{ width: '100%' }}>
          {pending ? 'Оплата...' : mode === 'existing' ? 'Связать с расходом' : 'Создать расход и оплатить'}
        </button>
      </form>
    </Sheet>
  );
}

function PaymentCard({ payment, accounts, busy, onEdit, onPay, onStatus, onOpenTrash }) {
  const actual = payment.transactionSummary;
  const differs = actual && (
    Number(actual.amount) !== Number(payment.amount)
    || plannedDateKey(actual.date) !== plannedDateKey(payment.dueDate)
    || actual.account !== payment.account
    || actual.category !== payment.category
  );

  return (
    <article style={{ padding: '14px', borderRadius: 'var(--radius-lg)', background: 'var(--color-surface)', border: '1px solid var(--color-border-subtle)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: 'var(--text-lg)', overflowWrap: 'anywhere' }}>{payment.title}</h3>
          <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)', marginTop: '3px' }}>
            {displayDate(payment.dueDate)} · {accountName(accounts, payment.account)} · {payment.category}
          </div>
        </div>
        <strong style={{ whiteSpace: 'nowrap', color: payment.status === 'paid' ? 'var(--color-positive-strong)' : 'var(--color-text-main)' }}>{money(payment.amount)}</strong>
      </div>
      {payment.description && <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)', overflowWrap: 'anywhere' }}>{payment.description}</p>}
      {payment.status === 'paid' && actual && (
        <div style={{ padding: '9px 10px', borderRadius: 'var(--radius-md)', background: 'var(--color-surface-muted)', color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
          {differs ? `План ${money(payment.amount)} · факт ${money(actual.amount)} (${displayDate(actual.date)})` : `Оплачено ${displayDate(actual.date)} · ${money(actual.amount)}`}
        </div>
      )}
      {payment.transactionDeleted && (
        <button type="button" onClick={onOpenTrash} style={{ ...secondaryButtonStyle, color: 'var(--color-danger)', background: 'var(--color-danger-soft)' }}>
          Расход находится в корзине — восстановить
        </button>
      )}
      {payment.status === 'pending' && (
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button type="button" onClick={onPay} disabled={busy} className="btn-primary" style={{ padding: '8px 12px' }}>Оплатить</button>
          <button type="button" onClick={onEdit} disabled={busy} style={secondaryButtonStyle}>Изменить</button>
          <button type="button" onClick={() => onStatus('skipped')} disabled={busy} style={{ ...secondaryButtonStyle, color: 'var(--color-danger)', background: 'var(--color-danger-soft)' }}>Отменить план</button>
        </div>
      )}
      {payment.status === 'skipped' && (
        <button type="button" onClick={() => onStatus('pending')} disabled={busy} style={{ ...secondaryButtonStyle, alignSelf: 'flex-start' }}>
          Вернуть в ожидающие
        </button>
      )}
    </article>
  );
}

function PaymentSection({ title, payments, tone, renderPayment }) {
  if (payments.length === 0) return null;
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <h2 style={{ margin: 0, fontSize: 'var(--text-xl)', color: tone || 'var(--color-text-main)' }}>{title}</h2>
      {payments.map(renderPayment)}
    </section>
  );
}

export default function PlannedPaymentsView({ plannedPayments, accounts, categories, transactions, onCreate, onUpdate, onPay, onOpenTrash }) {
  const groups = useMemo(() => groupPlannedPayments(plannedPayments), [plannedPayments]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [paying, setPaying] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState('');

  const changeStatus = async (payment, status) => {
    if (busyId) return;
    setBusyId(payment._id);
    setActionError('');
    try {
      const result = await onUpdate(payment, { status });
      if (!result?.ok) setActionError(result?.error || 'Не удалось изменить статус платежа.');
    } finally {
      setBusyId(null);
    }
  };

  const renderPayment = payment => (
    <PaymentCard
      key={payment._id}
      payment={payment}
      accounts={accounts}
      busy={busyId === payment._id}
      onEdit={() => setEditing(payment)}
      onPay={() => setPaying(payment)}
      onStatus={status => changeStatus(payment, status)}
      onOpenTrash={onOpenTrash}
    />
  );

  return (
    <div data-testid="planned-payments-view" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <section className="glass-panel" style={{ padding: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
        <div>
          <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>До конца месяца, включая просроченные</div>
          <div style={{ color: 'var(--color-text-main)', fontSize: '1.8rem', fontWeight: '800', marginTop: '4px' }}>{money(groups.pendingThroughMonth)}</div>
        </div>
        <button type="button" className="btn-primary" onClick={() => setShowForm(true)} style={{ padding: '10px 14px', flexShrink: 0 }}>+ Добавить</button>
      </section>

      {actionError && <div role="alert" className="glass-panel" style={{ padding: '12px', color: 'var(--color-negative)' }}>{actionError}</div>}
      {groups.overdue.length === 0 && groups.upcoming.length === 0 && (
        <div className="glass-panel" style={{ padding: '24px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
          Предстоящих платежей пока нет.
        </div>
      )}
      <PaymentSection title="Просрочено" tone="var(--color-negative)" payments={groups.overdue} renderPayment={renderPayment} />
      <PaymentSection title="Предстоящие" payments={groups.upcoming} renderPayment={renderPayment} />

      {groups.history.length > 0 && (
        <section>
          <button type="button" aria-expanded={historyOpen} onClick={() => setHistoryOpen(open => !open)} style={{ width: '100%', padding: '12px 14px', borderRadius: 'var(--radius-lg)', background: 'var(--color-surface)', color: 'var(--color-text-main)', fontWeight: '700', textAlign: 'left', border: '1px solid var(--color-border-subtle)' }}>
            Завершённые ({groups.history.length}) {historyOpen ? '▴' : '▾'}
          </button>
          {historyOpen && <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '10px' }}>{groups.history.map(renderPayment)}</div>}
        </section>
      )}

      {showForm && (
        <PaymentFormSheet accounts={accounts} categories={categories} onClose={() => setShowForm(false)} onSave={onCreate} />
      )}
      {editing && (
        <PaymentFormSheet payment={editing} accounts={accounts} categories={categories} onClose={() => setEditing(null)} onSave={fields => onUpdate(editing, fields)} />
      )}
      {paying && (
        <PaySheet payment={paying} accounts={accounts} categories={categories} transactions={transactions} onClose={() => setPaying(null)} onPay={payload => onPay(paying, payload)} />
      )}
    </div>
  );
}
