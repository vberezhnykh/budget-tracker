import { useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import TransactionIcon from '../../components/TransactionIcon';
import Button from '../../components/ui/Button';
import EmptyState from '../../components/ui/EmptyState';
import IconButton from '../../components/ui/IconButton';
import InlineAlert from '../../components/ui/InlineAlert';
import ListRow from '../../components/ui/ListRow';
import ScreenHeader from '../../components/ui/ScreenHeader';
import { ListSkeleton } from '../../components/ui/Skeleton';
import { formatMoney } from '../../utils/money';
import { pluralForm } from '../../utils/plural';

// Корзина как вложенный экран «Ещё → Корзина». Раньше это был лист
// (TrashSheet) с window.confirm; теперь подтверждение удаления навсегда
// раскрывается прямо в карточке группы. Данные и действия приходят снаружи:
// экран хранит только то, что нужно его виду, - какая карточка в режиме
// подтверждения и какое действие сейчас выполняется.
//
// Группа - ответ /api/trash как есть: { id, count, deletedAt, transactions }.
// В транзакциях счета лежат id (account, toAccount), без названий. Названия
// подкладывает App в accountName / toAccountName: с ними у перевода подпись
// «A → B», без них (счёт удалён или названий нет) - просто «Перевод».

const PARTS = ['часть', 'части', 'частей'];

function isSplit(group) {
  return (group.count ?? group.transactions?.length ?? 0) > 1;
}

function groupCount(group) {
  return group.count ?? group.transactions?.length ?? 1;
}

function groupTitle(group) {
  const first = group.transactions?.[0];
  if (isSplit(group)) {
    // Разделённая операция: у всех частей один магазин, его и показываем.
    return first?.companyName || `Группа операций (${groupCount(group)})`;
  }
  return first?.companyName || first?.title || first?.category || 'Операция';
}

function transferLabel(transaction) {
  return transaction.accountName && transaction.toAccountName
    ? `${transaction.accountName} → ${transaction.toAccountName}`
    : 'Перевод';
}

function groupCategories(group) {
  const transactions = group.transactions || [];
  if (!isSplit(group) && transactions[0]?.type === 'transfer') return transferLabel(transactions[0]);
  const names = [];
  for (const transaction of transactions) {
    const name = transaction.type === 'transfer' ? transferLabel(transaction) : transaction.category || transaction.title;
    if (name && !names.includes(name)) names.push(name);
  }
  return names.join(', ');
}

// «сегодня в 09:30» или «8 окт., 09:30».
function formatDeleted(value, now = new Date()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const time = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === now.toDateString()) return `сегодня в ${time}`;
  return date.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function groupSubtitle(group) {
  const parts = [];
  const categories = groupCategories(group);
  if (categories) parts.push(categories);
  if (isSplit(group)) parts.push(`${groupCount(group)} ${pluralForm(groupCount(group), PARTS)}`);
  const deleted = formatDeleted(group.deletedAt);
  if (deleted) parts.push(`удалено ${deleted}`);
  return parts.join(' · ');
}

const cardStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-3)',
  padding: 'var(--space-4)',
  background: 'var(--color-surface)',
  borderRadius: 'var(--radius-lg)',
};

function TrashCard({ group, pendingAction, confirming, onRestore, onAskPurge, onCancelPurge, onPurge }) {
  const title = groupTitle(group);
  const total = (group.transactions || []).reduce((sum, transaction) => sum + (Number(transaction.amount) || 0), 0);
  const busy = Boolean(pendingAction);
  const restoring = pendingAction === `restore:${group.id}`;
  const purging = pendingAction === `purge:${group.id}`;
  const multi = isSplit(group);
  const cancelRef = useRef(null);

  // Фокус уходит на «Отмена», когда раскрывается подтверждение: кнопка
  // корзины в этот момент пропадает, и без этого фокус потерялся бы.
  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
  }, [confirming]);

  return (
    <article style={cardStyle} aria-label={title}>
      <ListRow
        leading={group.transactions?.[0] ? <TransactionIcon item={group.transactions[0]} /> : null}
        title={<span style={{ overflowWrap: 'anywhere' }}>{title}</span>}
        subtitle={groupSubtitle(group)}
        trailing={<strong style={{ fontSize: 'var(--text-lg)', whiteSpace: 'nowrap' }}>{formatMoney(total)}</strong>}
        style={{ padding: 0, alignItems: 'flex-start' }}
      />

      {confirming ? (
        <div
          role="group"
          aria-label={`Подтверждение удаления: ${title}`}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-3)',
            padding: 'var(--space-3)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-danger-soft)',
            color: 'var(--color-danger-text)',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            <span style={{ fontSize: 'var(--text-md)', fontWeight: 'var(--weight-label)' }}>
              {multi
                ? `Удалить навсегда все части (${groupCount(group)})? Вернуть их будет нельзя.`
                : 'Удалить навсегда? Вернуть будет нельзя.'}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }}>
            <Button
              ref={cancelRef}
              tone="secondary"
              disabled={busy}
              onClick={onCancelPurge}
              style={{ background: 'var(--color-surface)' }}
            >
              Отмена
            </Button>
            <Button
              tone="danger"
              disabled={busy}
              onClick={() => onPurge(group)}
              style={{ background: 'var(--color-danger)', color: 'var(--color-text-inverse)' }}
            >
              {purging ? 'Удаление…' : 'Удалить'}
            </Button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <Button
            tone="soft"
            disabled={busy}
            onClick={() => onRestore(group)}
            style={{ flex: 1 }}
          >
            {restoring ? 'Восстановление…' : 'Восстановить'}
          </Button>
          <IconButton
            tone="neutral"
            size={44}
            disabled={busy}
            onClick={() => onAskPurge(group)}
            aria-label={`Удалить навсегда: ${title}`}
            style={{ color: 'var(--color-danger)', opacity: busy ? 0.5 : 1 }}
          >
            <Trash2 size={18} aria-hidden="true" />
          </IconButton>
        </div>
      )}
    </article>
  );
}

export default function TrashScreen({ groups, loading, error, onBack, onRetry, onRestore, onPurge }) {
  const [pendingAction, setPendingAction] = useState(null);
  const [confirmId, setConfirmId] = useState(null);
  const [actionError, setActionError] = useState('');

  const run = async (kind, group) => {
    if (pendingAction) return;
    setPendingAction(`${kind}:${group.id}`);
    setActionError('');
    try {
      const result = await (kind === 'restore' ? onRestore(group.id) : onPurge(group.id));
      if (result?.ok) {
        if (kind === 'purge') setConfirmId(null);
      } else {
        setActionError(result?.error || 'Не удалось выполнить действие.');
      }
    } finally {
      setPendingAction(null);
    }
  };

  const items = groups || [];
  const failure = actionError || error;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <ScreenHeader title="Корзина" backLabel="Ещё" onBack={onBack} />
      <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 'var(--text-md)' }}>
        Операции лежат здесь, пока вы не удалите их навсегда. В итогах и истории они не учитываются.
      </p>

      {failure && (
        <InlineAlert
          tone="danger"
          action={!actionError && error ? { label: 'Повторить', onClick: onRetry, disabled: loading } : undefined}
        >
          {failure}
        </InlineAlert>
      )}

      {loading ? (
        <ListSkeleton label="Загрузка корзины…" />
      ) : items.length === 0 && !error ? (
        <EmptyState
          icon={<Trash2 size={24} />}
          title="Корзина пуста"
          description="Сюда попадают удалённые операции. Их можно вернуть, пока вы не удалите их навсегда."
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {items.map(group => (
            <TrashCard
              key={group.id}
              group={group}
              pendingAction={pendingAction}
              confirming={confirmId === group.id}
              onRestore={target => { setConfirmId(null); run('restore', target); }}
              onAskPurge={target => setConfirmId(target.id)}
              onCancelPurge={() => setConfirmId(null)}
              onPurge={target => run('purge', target)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
