import { useState } from 'react'
import { DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'

function AccountListItem({ account, onDelete, onEdit }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: account._id });

  const rowStyle = {
    transform: transform ? `translate3d(0, ${transform.y}px, 0)` : undefined,
    transition,
  };

  return (
    <div ref={setNodeRef} style={{
      ...rowStyle,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '12px 16px',
      background: 'rgba(0, 0, 0, 0.02)',
      borderRadius: '16px',
      border: '1px solid rgba(0, 0, 0, 0.05)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
        <span
          {...attributes}
          {...listeners}
          aria-label={`Изменить порядок: ${account.name}`}
          style={{ cursor: 'grab', touchAction: 'none', color: 'var(--color-text-muted)', fontSize: '1.1rem', lineHeight: 1, padding: '4px 2px', flexShrink: 0 }}
        >
          ⠿
        </span>
        <span style={{ fontSize: '1.25rem', flexShrink: 0 }}>{account.icon || (account.type === 'cash' ? '💵' : '💳')}</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '0.9rem', fontWeight: '600', color: 'var(--color-text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{account.name}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {account.type === 'cash' ? 'Наличные' : 'Карта'} {account.isDefault ? '(Стандартный)' : ''}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
        <button
          onClick={onEdit}
          aria-label="Изменить"
          style={{
            background: 'rgba(0, 0, 0, 0.04)',
            border: 'none',
            borderRadius: '10px',
            color: 'var(--color-primary)',
            cursor: 'pointer',
            fontSize: '1rem',
            fontWeight: '600',
            padding: '8px',
            minWidth: '36px',
            minHeight: '36px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          ✏️
        </button>
        <button
          onClick={onDelete}
          aria-label="Удалить"
          style={{
            background: 'rgba(239, 68, 68, 0.08)',
            border: 'none',
            borderRadius: '10px',
            color: '#ef4444',
            cursor: 'pointer',
            fontSize: '1rem',
            fontWeight: '600',
            padding: '8px',
            minWidth: '36px',
            minHeight: '36px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          🗑️
        </button>
      </div>
    </div>
  );
}

// The "Управление счетами" settings modal - extracted out of App.jsx, which
// owns `accounts` state and every API mutation (it owns the apiFetch
// wrapper). Everything here is either local UI state (the add/edit form,
// drag sensors) or a callback passed down from App: onSaveAccount/
// onDeleteAccount/onDragEnd/onSaveSettings do the actual fetching, onLogout
// clears the session, and showNotice reports errors through App's notice
// banner.
export default function AccountsSettingsModal({
  accounts,
  monthlyLimit,
  onClose,
  onSaveAccount,
  onDeleteAccount,
  onDragEnd,
  onSaveSettings,
  onLogout,
  showNotice,
}) {
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState('card');
  const [formIcon, setFormIcon] = useState('💳');
  const [editingAccountId, setEditingAccountId] = useState(null);
  const [limitInput, setLimitInput] = useState(String(monthlyLimit));

  // Drag-to-reorder sensors for the account list below. A minimum drag
  // distance keeps an imprecise tap on the grip from being mistaken for a
  // drag, and the keyboard sensor is the only reorder path reachable
  // without a pointer.
  const accountDndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const resetForm = () => {
    setFormName('');
    setFormType('card');
    setFormIcon('💳');
    setEditingAccountId(null);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formName.trim()) return;
    const ok = await onSaveAccount(formName, formType, formIcon, editingAccountId);
    if (ok) resetForm();
  };

  // Mirrors the server's own validation (see PUT /api/settings in
  // server/index.js): the limit must be a finite, strictly positive number.
  // Number.isFinite rules out NaN and +/-Infinity (e.g. a stray "1e999") in
  // one check; `<= 0` rules out zero and negatives. Without this, a bad
  // value could reach onSaveSettings and later render as NaN%/Infinity% in
  // the limit progress bar.
  const handleSaveLimit = async (e) => {
    e.preventDefault();
    const parsed = Number(limitInput);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      showNotice('Введите корректный лимит (положительное число)');
      return;
    }
    const ok = await onSaveSettings(parsed);
    if (ok) showNotice('Лимит обновлён', 'success');
  };

  return (
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
      onClick={handleClose}
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
            onClick={handleClose}
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
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px', background: 'rgba(0,0,0,0.01)', padding: '16px', borderRadius: '16px', border: '1px dashed rgba(0,0,0,0.1)' }}>
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
                onClick={resetForm}
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
            <DndContext sensors={accountDndSensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={accounts.map(acc => acc._id)} strategy={verticalListSortingStrategy}>
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
                    onDelete={() => onDeleteAccount(acc._id, acc.name)}
                  />
                ))}
              </SortableContext>
            </DndContext>
          </div>
        </div>

        {/* Monthly spending limit - shared across devices via the server
            (see GET/PUT /api/settings in server/index.js), so it's edited
            here rather than as new chrome on the main screen. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <h3 style={{ fontSize: '0.95rem', fontWeight: '700', color: 'var(--color-text-muted)', margin: 0 }}>Лимит трат в месяц</h3>
          <form onSubmit={handleSaveLimit} style={{ display: 'flex', gap: '10px' }}>
            <input
              type="number"
              step="0.01"
              placeholder="Например, 7000"
              value={limitInput}
              onChange={(e) => setLimitInput(e.target.value)}
              style={{
                flex: 1,
                padding: '10px 14px',
                borderRadius: '12px',
                border: '1px solid rgba(0,0,0,0.15)',
                fontSize: '0.85rem',
                outline: 'none'
              }}
            />
            <button
              type="submit"
              className="btn-primary"
              style={{
                padding: '10px 16px',
                borderRadius: '12px',
                fontSize: '0.85rem',
                fontWeight: '600',
                cursor: 'pointer'
              }}
            >
              Сохранить лимит
            </button>
          </form>
        </div>

        {/* Session: the only place a logout control lives - deliberately
            not added as new chrome on the main screen. */}
        <button
          type="button"
          onClick={onLogout}
          style={{
            background: 'rgba(239, 68, 68, 0.08)',
            border: 'none',
            borderRadius: '12px',
            color: '#ef4444',
            cursor: 'pointer',
            fontSize: '0.85rem',
            fontWeight: '600',
            padding: '10px'
          }}
        >
          Выйти
        </button>
      </div>
    </div>
  );
}
