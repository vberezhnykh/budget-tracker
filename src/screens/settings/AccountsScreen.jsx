import { GripVertical, Plus } from 'lucide-react';
import { DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import AccountIcon from '../../components/AccountIcon';
import '../../components/accountThemes.css';
import Card from '../../components/ui/Card';
import IconButton from '../../components/ui/IconButton';
import ListRow from '../../components/ui/ListRow';
import ScreenHeader from '../../components/ui/ScreenHeader';
import { getAccountThemes } from '../../utils/accountThemes';
import { formatMoney } from '../../utils/money';

// Экран «Счета»: список счетов двумя секциями - те, что входят в общий
// капитал, и «замороженные» (залог, вклад). Состав секции задаёт флаг
// excludeFromTotal, поэтому перетаскивание работает только внутри секции:
// у каждой свой DndContext, а защита в onDragEnd не даёт перенести счёт в
// чужую секцию, даже если событие всё же пришло.

// Ручка перетаскивания и строка - соседние кнопки, а не вложенные: нажатие
// на строку открывает лист счёта, а ручка отвечает только за порядок.
function AccountRow({ account, theme, balance, divider, onEdit }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: account._id });
  const excluded = Boolean(account.excludeFromTotal);

  return (
    <div
      ref={setNodeRef}
      style={{
        display: 'flex',
        alignItems: 'center',
        borderBottom: divider ? '1px solid var(--color-border-subtle)' : 'none',
        transform: transform ? `translate3d(0, ${transform.y}px, 0)` : undefined,
        transition,
        // Поднятая строка не должна уходить под соседние карточки.
        position: 'relative',
        zIndex: isDragging ? 1 : 'auto',
        background: 'var(--color-surface)',
      }}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`Переместить: ${account.name}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          width: '44px',
          minHeight: '44px',
          alignSelf: 'stretch',
          padding: 0,
          border: 'none',
          background: 'transparent',
          color: 'var(--color-text-subtle)',
          cursor: 'grab',
          touchAction: 'none',
        }}
      >
        <GripVertical size={18} strokeWidth={1.8} aria-hidden="true" />
      </button>
      <ListRow
        onClick={() => onEdit?.(account)}
        style={{ padding: 'var(--space-3) var(--space-4) var(--space-3) 0', flex: 1, minWidth: 0, width: 'auto' }}
        leading={(
          <span
            data-account-theme={theme}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '40px',
              height: '40px',
              borderRadius: '12px',
              background: 'var(--account-tint)',
              color: 'var(--account-accent)',
            }}
          >
            <AccountIcon icon={account.icon} type={account.type} />
          </span>
        )}
        title={account.name}
        subtitle={`${account.type === 'cash' ? 'Наличные' : 'Карта'}${excluded ? ' · заморожен' : ''}`}
        trailing={(
          <span
            style={{
              fontSize: 'var(--text-lg)',
              fontWeight: 'var(--weight-strong)',
              color: excluded ? 'var(--color-text-muted)' : 'var(--color-text-main)',
            }}
          >
            {formatMoney(balance)}
          </span>
        )}
      />
    </div>
  );
}

// Одна секция: заголовок с суммой и белая карточка со строками. Сумма
// считается по балансам счетов секции, а не берётся из balances.total, чтобы
// не зависеть от того, как сервер считает «общий» итог.
function AccountSection({ title, accounts, themes, balances, sensors, onEdit, onDragEnd }) {
  const ids = accounts.map(account => account._id);
  const sum = accounts.reduce((total, account) => total + (Number(balances?.byAccount?.[account._id]) || 0), 0);

  // Перенос в другую секцию игнорируется: вне этой секции over быть не
  // должно, но проверка дешёвая, а ошибка тихо поменяла бы счёту флаг порядка.
  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (!over || !ids.includes(active.id) || !ids.includes(over.id)) return;
    onDragEnd?.(event);
  };

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-3)', padding: '0 var(--space-1)' }}>
        <h2 style={{ margin: 0, fontSize: 'var(--text-base)', fontWeight: 'var(--weight-label)', color: 'var(--color-text-muted)' }}>
          {title}
        </h2>
        <span style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--weight-label)', color: 'var(--color-text-muted)' }}>
          {formatMoney(sum)}
        </span>
      </div>
      <Card tone="plain" padding="none" style={{ overflow: 'hidden' }}>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            {accounts.map((account, index) => (
              <AccountRow
                key={account._id}
                account={account}
                onEdit={onEdit}
                theme={themes.get(String(account._id))}
                balance={balances?.byAccount?.[account._id] ?? 0}
                divider={index < accounts.length - 1}
              />
            ))}
          </SortableContext>
        </DndContext>
      </Card>
    </section>
  );
}

export default function AccountsScreen({ accounts, balances, onBack, onAdd, onEdit, onDragEnd }) {
  // Сенсоры те же, что в прежнем окне настроек: минимальное расстояние
  // отсекает случайное нажатие на ручку, а клавиатурный сенсор - единственный
  // способ поменять порядок без указателя.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const themes = getAccountThemes(accounts);
  const counted = accounts.filter(account => !account.excludeFromTotal);
  const excluded = accounts.filter(account => account.excludeFromTotal);

  const sectionProps = { themes, balances, sensors, onEdit, onDragEnd };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <ScreenHeader
        title="Счета"
        backLabel="Ещё"
        onBack={onBack}
        actions={(
          <IconButton tone="primary" round size={44} onClick={() => onAdd()} aria-label="Добавить счёт">
            <Plus size={20} strokeWidth={2} aria-hidden="true" />
          </IconButton>
        )}
      />

      <AccountSection title="В общем капитале" accounts={counted} {...sectionProps} />
      {excluded.length > 0 && (
        <AccountSection title="Не в общем капитале" accounts={excluded} {...sectionProps} />
      )}

      <p style={{ margin: 0, padding: '0 var(--space-1)', fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
        В таком же порядке счета стоят на Обзоре. Чтобы поменять порядок, перетащите счёт за точки слева.
      </p>
    </div>
  );
}
