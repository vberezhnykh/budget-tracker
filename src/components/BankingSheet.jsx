import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import Sheet from './ui/Sheet';
import IconButton from './ui/IconButton';

const cardStyle = { padding: '14px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border-subtle)', background: 'var(--color-surface)', display: 'flex', flexDirection: 'column', gap: '10px' };
const smallStyle = { margin: 0, color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' };
const buttonStyle = { padding: '10px 12px', borderRadius: 'var(--radius-md)', background: 'var(--color-surface-inset)', color: 'var(--color-text-main)', fontWeight: '600' };
const selectStyle = { ...buttonStyle, width: '100%', border: '1px solid var(--color-border)' };
const statusLabels = { connected: 'Подключён', disconnected: 'Отключён', error: 'Не удалось обновить', expired: 'Требуется повторное подключение' };
const balanceLabels = { BOOK: 'Проведённый остаток', CLBD: 'Проведённый остаток', OPBD: 'Остаток на начало периода', ITBD: 'Текущий проведённый остаток', CLAV: 'Доступно на конец периода', OPAV: 'Доступно на начало дня', ITAV: 'Доступно сейчас', PRCD: 'Остаток предыдущего периода', XPCD: 'Ожидаемый остаток', FWAV: 'Ожидаемый доступный остаток', INFO: 'Информационный остаток', VALU: 'Остаток по дате валютирования', OTHR: 'Другой остаток' };

function timestamp(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return '—';
  return new Date(value).toLocaleString('ru-RU', { timeZone: 'Europe/Bucharest', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function money(amount, currency) {
  return `${amount == null ? '—' : String(amount).replace('.', ',')} ${currency || ''}`.trim();
}

function defaultImportDate() {
  return new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
}

function BankAccount({ account, accounts, disabled, onMap }) {
  const [selected, setSelected] = useState('');
  const mapped = accounts.find(item => item._id === account.accountId);
  return (
    <div style={{ ...cardStyle, background: 'var(--color-surface-muted)' }}>
      <strong style={{ overflowWrap: 'anywhere' }}>{account.name || 'Банковский счёт'}{account.maskedNumber ? ` · ${account.maskedNumber}` : ''}</strong>
      <p style={smallStyle}>Валюта счёта: {account.currency === 'XXX' ? 'мультивалютный / не указана' : account.currency || 'не указана'}</p>
      {account.accountId ? (
        <p style={smallStyle}>В приложении: {mapped?.name || 'Счёт недоступен'}. Привязка сохранена.</p>
      ) : (
        <>
          <label>
            Счёт в приложении
            <select aria-label={`Счёт в приложении: ${account.name || 'Банковский счёт'}`} value={selected} onChange={event => setSelected(event.target.value)} disabled={disabled} style={{ ...selectStyle, marginTop: '6px' }}>
              <option value="">Выберите существующий счёт</option>
              {accounts.filter(item => item.type !== 'cash').map(item => <option key={item._id} value={item._id}>{item.name}</option>)}
            </select>
          </label>
          <button type="button" disabled={disabled || !selected} onClick={() => onMap(account.id, selected)} style={buttonStyle}>Связать счёт</button>
          <p style={smallStyle}>Выберите счёт, куда уже вносите покупки вручную. После импорта привязку изменить нельзя.</p>
        </>
      )}
      {account.balances?.length ? (
        <div>
          <p style={smallStyle}>Баланс по данным банка</p>
          {account.balances.map((balance, index) => (
            <p key={`${balance.currency}:${balance.type}:${index}`} style={{ margin: '6px 0 0' }}>
              <strong>{money(balance.amount, balance.currency)}</strong>
              <span style={smallStyle}> · {balanceLabels[balance.type] || 'Баланс'} · {balance.asOf ? 'На ' : 'Получен '}{timestamp(balance.asOf || account.balancesUpdatedAt)}</span>
            </p>
          ))}
        </div>
      ) : <p style={smallStyle}>Банк пока не передал баланс.</p>}
    </div>
  );
}

function ReviewEntry({ entry, accounts, categories, disabled, onResolve }) {
  const [category, setCategory] = useState('Без категории');
  const [description, setDescription] = useState(entry.description || '');
  const [transferAccount, setTransferAccount] = useState('');
  const [showTransfer, setShowTransfer] = useState(false);
  const income = ['income', 'CRDT'].includes(entry.direction);
  const supported = entry.currency === 'EUR';
  const account = accounts.find(item => item._id === entry.accountId);
  const canImport = supported && Boolean(account);
  const candidates = entry.candidates || [];
  const categoryNames = [...new Set(['Без категории', ...categories.filter(item => item.type === (income ? 'income' : 'expense')).map(item => item.name)])];
  const resolve = fields => onResolve(entry.id, { version: entry.version, ...fields });

  return (
    <article style={cardStyle} aria-label={`Проверка: ${entry.description || 'Банковская операция'}`}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
        <strong style={{ overflowWrap: 'anywhere' }}>{entry.description || 'Банковская операция'}</strong>
        <strong>{income ? '+' : '−'}{money(entry.amount, entry.currency)}</strong>
        <p style={smallStyle}>{String(entry.date || '').slice(0, 10)} · {account?.name || 'Счёт ещё не связан'}</p>
      </div>
      {!supported && <p style={smallStyle}>Эта операция в {entry.currency || 'неизвестной валюте'}. В бюджет можно добавлять только EUR; конвертация не выполняется.</p>}
      {!account && <p style={smallStyle}>Сначала свяжите банковский счёт со счётом приложения выше.</p>}
      {['own_transfer', 'possible_transfer'].includes(entry.reason) && <p style={smallStyle}>Возможно, это перевод между своими счетами. Проверьте направление и выберите «Это перевод между своими счетами» ниже, чтобы не учитывать его как покупку или доход.</p>}
      {entry.reason === 'missing_reference' && <p style={smallStyle}>Банк не передал постоянный идентификатор операции. Перед добавлением особенно внимательно проверьте похожие записи в бюджете.</p>}
      {candidates.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <p style={smallStyle}>Возможно, вы уже внесли эту покупку. Совпадение даты и суммы не означает, что это одна операция.</p>
          <p style={smallStyle}>При сопоставлении категория и описание ручной записи сохраняются.</p>
          {candidates.map(candidate => (
            <div key={candidate.transactionId} style={{ padding: '10px', borderRadius: 'var(--radius-md)', background: 'var(--color-surface-muted)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <strong style={{ overflowWrap: 'anywhere' }}>{candidate.title || candidate.category || 'Операция'}</strong>
              <span style={smallStyle}>{String(candidate.date || '').slice(0, 10)} · {money(candidate.amount, candidate.currency || 'EUR')} · {candidate.category || 'Без категории'}</span>
              {candidate.groupCount > 1 && <span style={smallStyle}>Разбита на {candidate.groupCount} части</span>}
              {candidate.deleted && <span style={smallStyle}>В корзине. Для сопоставления сначала восстановите запись.</span>}
              <button type="button" aria-label={`Это эта операция: ${candidate.title || candidate.category || 'Операция'}`} disabled={disabled || !canImport || candidate.deleted} onClick={() => resolve({ action: 'match', transactionId: candidate.transactionId, transactionVersion: candidate.version })} style={buttonStyle}>Это эта операция</button>
            </div>
          ))}
        </div>
      )}
      <label style={smallStyle}>
        Категория при добавлении
        <select aria-label={`Категория: ${entry.description || 'Банковская операция'}`} value={category} onChange={event => setCategory(event.target.value)} disabled={disabled || !canImport} style={{ ...selectStyle, marginTop: '6px' }}>
          {categoryNames.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
      </label>
      <label style={smallStyle}>
        Описание при добавлении
        <textarea aria-label={`Описание: ${entry.description || 'Банковская операция'}`} value={description} onChange={event => setDescription(event.target.value)} disabled={disabled || !canImport} maxLength={1000} rows={2} style={{ ...selectStyle, marginTop: '6px', resize: 'vertical' }} />
      </label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
        <button type="button" disabled={disabled || !canImport} onClick={() => resolve({ action: 'import', category, description, candidateToken: entry.candidateToken })} className="btn-primary" style={{ padding: '10px 12px', borderRadius: 'var(--radius-md)' }}>{candidates.length ? 'Добавить отдельно' : 'Добавить в бюджет'}</button>
        <button type="button" disabled={disabled} onClick={() => resolve({ action: 'ignore' })} style={buttonStyle}>Отклонить</button>
      </div>
      <button type="button" aria-expanded={showTransfer} onClick={() => setShowTransfer(current => !current)} disabled={disabled} style={{ ...buttonStyle, textAlign: 'left', color: 'var(--color-primary)', fontSize: 'var(--text-sm)' }}>Это перевод между своими счетами</button>
      {showTransfer && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingTop: '10px' }}>
          <label style={smallStyle}>
            {income ? 'Откуда переведены деньги' : 'Куда переведены деньги'}
            <select aria-label={income ? 'Счёт отправителя' : 'Счёт получателя'} value={transferAccount} onChange={event => setTransferAccount(event.target.value)} disabled={disabled || !canImport} style={{ ...selectStyle, marginTop: '6px' }}>
              <option value="">Выберите другой свой счёт</option>
              {accounts.filter(item => item._id !== entry.accountId).map(item => <option key={item._id} value={item._id}>{item.name}</option>)}
            </select>
          </label>
          <button type="button" disabled={disabled || !canImport || !transferAccount} onClick={() => resolve({ action: 'transfer', description, candidateToken: entry.candidateToken, [income ? 'fromAccountId' : 'toAccountId']: transferAccount })} style={buttonStyle}>Добавить перевод</button>
        </div>
      )}
    </article>
  );
}

export default function BankingSheet({ data, review = { items: [], total: 0 }, accounts = [], categories = [], loading = false, error = '', onClose, onRetry, onConnect, onMapAccount, onSync, onDisconnect, onResolve }) {
  const [importFrom, setImportFrom] = useState(defaultImportDate);
  const [pendingAction, setPendingAction] = useState(null);
  const [actionError, setActionError] = useState('');
  const [now, setNow] = useState(Date.now);
  const busyRef = useRef(false);
  const today = new Date(now).toISOString().slice(0, 10);
  const earliestImportDate = new Date(now - 90 * 86400_000).toISOString().slice(0, 10);
  const busy = Boolean(pendingAction);
  const validImportDate = /^\d{4}-\d{2}-\d{2}$/.test(importFrom) && importFrom >= earliestImportDate && importFrom <= today && Number.isFinite(Date.parse(importFrom));

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const run = async (key, action) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setPendingAction(key);
    setActionError('');
    try {
      const result = await action();
      if (!result?.ok) setActionError(result?.error || 'Не удалось выполнить действие. Попробуйте ещё раз.');
    } catch {
      setActionError('Не удалось выполнить действие. Попробуйте ещё раз.');
    } finally {
      busyRef.current = false;
      setPendingAction(null);
    }
  };

  const connect = bank => {
    if (!validImportDate) return;
    return run(`connect:${bank}`, () => onConnect({ bank, importFrom }));
  };
  const requestClose = () => { if (!busyRef.current) onClose(); };

  return (
    <Sheet ariaLabel="Банки" onClose={requestClose}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 'var(--text-3xl)' }}>Банки</h2>
          <p style={{ ...smallStyle, marginTop: '5px' }}>Обновление: {data?.scheduleLabel || '08:00, 14:00 и 20:00'} · {data?.timeZone || 'Europe/Bucharest'}.</p>
        </div>
        <IconButton round tone="neutral" onClick={requestClose} disabled={busy} aria-label="Закрыть банки"><X size={20} /></IconButton>
      </div>

      <button type="button" onClick={onRetry} disabled={loading || busy} style={buttonStyle}>Обновить список предложений</button>

      {(error || actionError) && <div role="alert" style={{ ...cardStyle, background: 'var(--color-danger-soft)', color: 'var(--color-negative)' }}>
        <span>{actionError || error}</span>
        {error && <button type="button" onClick={onRetry} disabled={loading || busy} style={buttonStyle}>Повторить загрузку</button>}
      </div>}
      {loading && <p role="status" style={smallStyle}>Загрузка банковских данных…</p>}
      {data?.configured === false && <p style={smallStyle}>Подключение банков пока не настроено. Оно появится после настройки приложения.</p>}

      {data?.configured && <>
        <section style={cardStyle} aria-label="Подключить банк">
          <h3 style={{ margin: 0, fontSize: 'var(--text-lg)' }}>Подключить банк</h3>
          <label>
            Загрузить операции начиная с
            <input aria-label="Загрузить операции начиная с" type="date" value={importFrom} min={earliestImportDate} max={today} onChange={event => setImportFrom(event.target.value)} disabled={busy} style={{ ...selectStyle, marginTop: '6px' }} />
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {[['boc', 'Bank of Cyprus'], ['revolut', 'Revolut']].map(([bank, name]) => (
              <button type="button" key={bank} onClick={() => connect(bank)} disabled={busy || !validImportDate || data.connections?.some(connection => connection.bank === bank && connection.status === 'connected')} style={buttonStyle}>{pendingAction === `connect:${bank}` ? 'Открываем банк…' : `Подключить ${name}`}</button>
            ))}
          </div>
          <p style={smallStyle}>Подтвердите доступ на странице банка. Пароль от банка сюда вводить не нужно.</p>
        </section>

        {(data.connections || []).map(connection => {
          const next = Date.parse(connection.nextSyncAt);
          const notDue = Number.isFinite(next) && next > now;
          const canSync = ['connected', 'error'].includes(connection.status) && !notDue && !connection.syncing;
          return (
            <section key={connection.id} aria-label={connection.name || connection.bank} style={cardStyle}>
              <h3 style={{ margin: 0, fontSize: 'var(--text-lg)' }}>{connection.name || (connection.bank === 'boc' ? 'Bank of Cyprus' : 'Revolut')}</h3>
              <strong>{connection.syncing ? 'Получаем данные из банка…' : statusLabels[connection.status] || 'Статус неизвестен'}</strong>
              <p style={smallStyle}>Обновлено: {timestamp(connection.lastSuccessfulSyncAt)}</p>
              <p style={smallStyle}>Следующее обновление: {timestamp(connection.nextSyncAt)}</p>
              {connection.consentExpiresAt && <p style={smallStyle}>Доступ до: {timestamp(connection.consentExpiresAt)}</p>}
              {connection.warningsCount > 0 && <p style={smallStyle}>Часть данных требует внимания: {connection.warningsCount}. Полученные операции доступны в предложениях ниже.</p>}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                <button type="button" disabled={busy || !canSync} onClick={() => run(`sync:${connection.id}`, () => onSync(connection.id))} style={buttonStyle}>{pendingAction === `sync:${connection.id}` ? 'Обновление…' : notDue ? `Обновить после ${timestamp(connection.nextSyncAt)}` : 'Обновить сейчас'}</button>
                {['expired', 'disconnected', 'error'].includes(connection.status) && <button type="button" disabled={busy || !validImportDate || connection.syncing} onClick={() => connect(connection.bank)} style={buttonStyle}>Подключить заново</button>}
                {connection.status !== 'disconnected' && <button type="button" disabled={busy || connection.syncing} onClick={() => run(`disconnect:${connection.id}`, () => onDisconnect(connection.id))} style={buttonStyle}>Отключить банк</button>}
              </div>
              <p style={smallStyle}>Снимки баланса банка показаны отдельно от капитала, рассчитанного по операциям приложения.</p>
              {(connection.accounts || []).map(account => <BankAccount key={account.id} account={account} accounts={accounts} disabled={busy || connection.status === 'disconnected'} onMap={(id, accountId) => run(`map:${id}`, () => onMapAccount(id, accountId))} />)}
            </section>
          );
        })}

        <section aria-label="Предложения из банков" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <h3 style={{ margin: 0, fontSize: 'var(--text-lg)' }}>Предложения из банков ({review.total || 0})</h3>
          <p style={smallStyle}>Ни одна операция не попадёт в бюджет без вашего подтверждения. Можно изменить категорию и описание перед добавлением, а затем отредактировать запись в истории.</p>
          {(review.items || []).length === 0 && !loading && <p style={smallStyle}>Предложений пока нет.</p>}
          {(review.items || []).map(entry => <ReviewEntry key={`${entry.id}:${entry.version}`} entry={entry} accounts={accounts} categories={categories} disabled={busy} onResolve={(id, fields) => run(`resolve:${id}`, () => onResolve(id, fields))} />)}
          {review.total > (review.items || []).length && <p style={smallStyle}>Показаны первые {review.items.length}. После проверки появятся следующие.</p>}
        </section>
      </>}
    </Sheet>
  );
}
