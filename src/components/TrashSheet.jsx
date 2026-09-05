import { useState } from 'react';
import IconButton from './ui/IconButton';
import Sheet from './ui/Sheet';

function money(value) {
  return `€${(Number(value) || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function groupTitle(group) {
  if (group.count > 1) return `Группа операций (${group.count})`;
  const transaction = group.transactions?.[0];
  return transaction?.title || transaction?.category || 'Операция';
}

export default function TrashSheet({ groups, loading, error, onRetry, onRestore, onPurge, onClose }) {
  const [pendingAction, setPendingAction] = useState(null);
  const [actionError, setActionError] = useState('');

  const run = async (kind, group) => {
    if (pendingAction) return;
    if (kind === 'purge' && !window.confirm(
      `Удалить «${groupTitle(group)}» навсегда? Это действие нельзя отменить. Связанный оплаченный план, если он есть, вернётся в ожидающие.`
    )) return;

    setPendingAction(`${kind}:${group.id}`);
    setActionError('');
    try {
      const result = await (kind === 'restore' ? onRestore(group.id) : onPurge(group.id));
      if (!result?.ok) setActionError(result?.error || 'Не удалось выполнить действие.');
    } finally {
      setPendingAction(null);
    }
  };

  const requestClose = () => {
    if (!pendingAction) onClose();
  };

  return (
    <Sheet ariaLabel="Корзина операций" onClose={requestClose}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 'var(--text-3xl)' }}>Корзина</h2>
          <p style={{ margin: '4px 0 0', color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>Удалённые операции сохраняются после перезагрузки.</p>
        </div>
        <IconButton round tone="neutral" onClick={requestClose} aria-label="Закрыть корзину">✕</IconButton>
      </div>

      {(error || actionError) && (
        <div role="alert" style={{ padding: '12px', borderRadius: 'var(--radius-md)', background: 'var(--color-danger-soft)', color: 'var(--color-negative)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
          <span>{actionError || error}</span>
          {error && <button type="button" onClick={onRetry} disabled={loading} style={{ padding: '7px 10px', borderRadius: 'var(--radius-sm)', background: 'var(--color-surface)', color: 'var(--color-primary)', fontWeight: '700' }}>Повторить</button>}
        </div>
      )}

      {loading ? (
        <div style={{ padding: '24px', textAlign: 'center', color: 'var(--color-text-muted)' }}>Загрузка корзины...</div>
      ) : groups.length === 0 ? (
        <div style={{ padding: '24px', textAlign: 'center', borderRadius: 'var(--radius-lg)', background: 'var(--color-surface-muted)', color: 'var(--color-text-muted)' }}>Корзина пуста.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {groups.map(group => {
            const total = (group.transactions || []).reduce((sum, transaction) => sum + (Number(transaction.amount) || 0), 0);
            const isBusy = pendingAction?.endsWith(`:${group.id}`);
            return (
              <article key={group.id} style={{ padding: '14px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border-subtle)', background: 'var(--color-surface)', display: 'flex', flexDirection: 'column', gap: '9px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                  <div style={{ minWidth: 0 }}>
                    <h3 style={{ margin: 0, fontSize: 'var(--text-lg)', overflowWrap: 'anywhere' }}>{groupTitle(group)}</h3>
                    <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', marginTop: '3px' }}>
                      Удалено {new Date(group.deletedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                  <strong style={{ whiteSpace: 'nowrap' }}>{money(total)}</strong>
                </div>
                {group.transactions?.length > 1 && (
                  <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
                    {group.transactions.map(transaction => transaction.category || transaction.title).join(' · ')}
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <button type="button" disabled={Boolean(pendingAction)} onClick={() => run('restore', group)} className="btn-primary" style={{ padding: '9px 10px' }}>
                    {isBusy && pendingAction.startsWith('restore') ? 'Восстановление...' : 'Восстановить'}
                  </button>
                  <button type="button" disabled={Boolean(pendingAction)} onClick={() => run('purge', group)} style={{ padding: '9px 10px', borderRadius: 'var(--radius-md)', background: 'var(--color-danger-soft)', color: 'var(--color-danger)', fontWeight: '700' }}>
                    {isBusy && pendingAction.startsWith('purge') ? 'Удаление...' : 'Удалить навсегда'}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </Sheet>
  );
}
