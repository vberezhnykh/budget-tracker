import { useState } from 'react'
import { categoryUsageKey } from '../utils/finance'
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
      background: 'var(--color-surface-muted)',
      borderRadius: 'var(--radius-lg)',
      border: '1px solid var(--color-border-subtle)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
        <span
          {...attributes}
          {...listeners}
          aria-label={`Изменить порядок: ${account.name}`}
          style={{ cursor: 'grab', touchAction: 'none', color: 'var(--color-text-muted)', fontSize: 'var(--text-2xl)', lineHeight: 1, padding: '4px 2px', flexShrink: 0 }}
        >
          ⠿
        </span>
        <span style={{ fontSize: 'var(--text-3xl)', flexShrink: 0 }}>{account.icon || (account.type === 'cash' ? '💵' : '💳')}</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 'var(--text-md)', fontWeight: '600', color: 'var(--color-text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{account.name}</div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {account.type === 'cash' ? 'Наличные' : 'Карта'} {account.isDefault ? '(Стандартный)' : ''}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
        <button
          onClick={onEdit}
          aria-label="Изменить"
          style={{
            background: 'var(--color-surface-sunken)',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            color: 'var(--color-primary)',
            cursor: 'pointer',
            fontSize: 'var(--text-xl)',
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
            background: 'var(--color-danger-soft)',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            color: 'var(--color-danger)',
            cursor: 'pointer',
            fontSize: 'var(--text-xl)',
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

// The "Настройки" modal - extracted out of App.jsx, which owns the
// `accounts` and `categories` state and every API mutation (it owns the
// apiFetch wrapper). Everything here is either local UI state (the add/edit
// form, drag sensors) or a callback passed down from App: onSaveAccount/
// onDeleteAccount/onDeleteCategory/onRenameCategory/onDragEnd/onSaveSettings do the actual
// fetching, onLogout clears the session, and showNotice reports errors
// through App's notice banner.
export default function AccountsSettingsModal({
  accounts,
  categories = [],
  categoryUsage = {},
  monthlyLimit,
  onClose,
  onSaveAccount,
  onDeleteAccount,
  onDeleteCategory,
  onRenameCategory,
  onDragEnd,
  onSaveSettings,
  onLogout,
  showNotice,
}) {
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState('card');
  const [formIcon, setFormIcon] = useState('💳');
  const [formExcludeFromTotal, setFormExcludeFromTotal] = useState(false);
  const [editingAccountId, setEditingAccountId] = useState(null);
  const [limitInput, setLimitInput] = useState(String(monthlyLimit));
  // Переименование категории правится прямо в строке списка: отдельная форма
  // сверху уже занята счетами, а у категории и редактировать-то нечего, кроме
  // названия. Хранится id редактируемой строки и текущий текст поля.
  const [editingCategoryId, setEditingCategoryId] = useState(null);
  const [categoryNameInput, setCategoryNameInput] = useState('');
  const [savingCategory, setSavingCategory] = useState(false);

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
    setFormExcludeFromTotal(false);
    setEditingAccountId(null);
  };

  const startCategoryEdit = (cat) => {
    setEditingCategoryId(cat._id);
    setCategoryNameInput(cat.name);
  };

  const cancelCategoryEdit = () => {
    setEditingCategoryId(null);
    setCategoryNameInput('');
  };

  // Строка возвращается в обычный вид только при успехе: если сервер
  // отказал (пустое имя, дубль), поле остаётся открытым с введённым
  // текстом, чтобы было что поправить.
  const handleCategoryRenameSubmit = async (e, cat) => {
    e.preventDefault();
    if (savingCategory) return;
    setSavingCategory(true);
    try {
      const ok = await onRenameCategory(cat, categoryNameInput);
      if (ok) cancelCategoryEdit();
    } finally {
      setSavingCategory(false);
    }
  };

  const handleClose = () => {
    resetForm();
    cancelCategoryEdit();
    onClose();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formName.trim()) return;
    const ok = await onSaveAccount({
      name: formName,
      type: formType,
      icon: formIcon,
      excludeFromTotal: formExcludeFromTotal,
      editingAccountId,
    });
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
        // Same bottom-sheet shape as the transaction form: full width, resting
        // on the bottom edge, with the gap above it doing the "this is a card"
        // work (see AddTransactionForm).
        alignItems: 'flex-end',
        justifyContent: 'center',
        zIndex: 1000
      }}
      onClick={handleClose}
    >
      <div
        style={{
          background: 'var(--color-surface)',
          borderRadius: 'var(--radius-xl) var(--radius-xl) 0 0',
          width: '100%',
          maxWidth: '520px',
          maxHeight: '92vh',
          overflowY: 'auto',
          padding: '24px 20px calc(24px + env(safe-area-inset-bottom, 0px))',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
          position: 'relative'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: 'var(--text-3xl)', fontWeight: '800', color: 'var(--color-text-main)', margin: 0 }}>Настройки</h2>
          <button
            onClick={handleClose}
            style={{
              background: 'var(--color-surface-inset)',
              border: 'none',
              borderRadius: '50%',
              width: '32px',
              height: '32px',
              cursor: 'pointer',
              fontSize: 'var(--text-xl)',
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
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px', background: 'var(--color-surface-muted)', padding: '16px', borderRadius: 'var(--radius-lg)', border: '1px dashed var(--color-border)' }}>
          <h3 style={{ fontSize: 'var(--text-md)', fontWeight: '700', color: 'var(--color-text-muted)', margin: 0 }}>
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
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-border-strong)',
                fontSize: 'var(--text-base)',
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
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-border-strong)',
                fontSize: 'var(--text-xl)',
                outline: 'none'
              }}
              title="Эмодзи для счёта"
            />
          </div>

          {!editingAccountId && (
            <div style={{ display: 'flex', gap: '16px', fontSize: 'var(--text-base)' }}>
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

          {/* Показывается и при редактировании, в отличие от типа счёта: тип
              задаётся раз и навсегда, а "заморожен ли счёт" со временем
              меняется - залог возвращают, вклад закрывают. */}
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: 'var(--text-base)', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={formExcludeFromTotal}
              onChange={e => setFormExcludeFromTotal(e.target.checked)}
            />
            Не учитывать в общем капитале
          </label>

          <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
            <button
              type="submit"
              className="btn-primary"
              style={{
                flex: 1,
                padding: '10px',
                borderRadius: 'var(--radius-md)',
                fontSize: 'var(--text-base)',
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
                  background: 'var(--color-surface-inset)',
                  border: 'none',
                  padding: '10px 16px',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 'var(--text-base)',
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
          <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: '700', color: 'var(--color-text-muted)', margin: 0 }}>Список счетов</h3>
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
                      setFormExcludeFromTotal(Boolean(acc.excludeFromTotal));
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
        {/* Categories */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: '700', color: 'var(--color-text-muted)', margin: 0 }}>Категории</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto', maxHeight: '250px', paddingRight: '4px' }}>
            {categories.length === 0 ? (
              <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>Категорий пока нет</div>
            ) : (
              categories.map(cat => {
                const used = categoryUsage[categoryUsageKey(cat)] || 0;
                const isEditing = editingCategoryId === cat._id;
                const meta = `${cat.type === 'income' ? 'Доход' : 'Расход'} · ${used === 0 ? 'не используется' : `операций: ${used}`}`;
                return (
                  <div
                    key={cat._id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--color-border-subtle)',
                      background: 'var(--color-surface)',
                    }}
                  >
                    {isEditing ? (
                      <form
                        onSubmit={(e) => handleCategoryRenameSubmit(e, cat)}
                        style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <input
                            type="text"
                            value={categoryNameInput}
                            onChange={(e) => setCategoryNameInput(e.target.value)}
                            aria-label={`Название категории: ${cat.name}`}
                            autoFocus
                            style={{
                              width: '100%',
                              boxSizing: 'border-box',
                              padding: '6px 10px',
                              borderRadius: 'var(--radius-md)',
                              border: '1px solid var(--color-border-strong)',
                              fontSize: 'var(--text-base)',
                              outline: 'none',
                            }}
                          />
                          {/* Тот же подстрочник, что и в обычном виде строки:
                              переименование затрагивает все эти операции, и
                              счётчик лучше держать перед глазами. */}
                          <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                            {meta}
                          </div>
                        </div>
                        <button
                          type="submit"
                          disabled={savingCategory}
                          aria-label={`Сохранить название категории: ${cat.name}`}
                          style={{
                            background: 'rgba(37, 99, 235, 0.08)',
                            border: 'none',
                            borderRadius: 'var(--radius-md)',
                            color: 'var(--color-primary)',
                            cursor: savingCategory ? 'default' : 'pointer',
                            opacity: savingCategory ? 0.6 : 1,
                            padding: '8px',
                            minWidth: '36px',
                            minHeight: '36px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                          }}
                        >
                          ✓
                        </button>
                        <button
                          type="button"
                          onClick={cancelCategoryEdit}
                          aria-label={`Отменить переименование: ${cat.name}`}
                          style={{
                            background: 'var(--color-surface-sunken)',
                            border: 'none',
                            borderRadius: 'var(--radius-md)',
                            color: 'var(--color-text-muted)',
                            cursor: 'pointer',
                            padding: '8px',
                            minWidth: '36px',
                            minHeight: '36px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                          }}
                        >
                          ✕
                        </button>
                      </form>
                    ) : (
                      <>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 'var(--text-md)', fontWeight: '600', color: 'var(--color-text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {cat.name}
                          </div>
                          <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--color-text-muted)' }}>
                            {meta}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => startCategoryEdit(cat)}
                          aria-label={`Переименовать категорию: ${cat.name}`}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            padding: '8px',
                            minWidth: '36px',
                            minHeight: '36px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                          }}
                        >
                          ✏️
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteCategory(cat, used)}
                          aria-label={`Удалить категорию: ${cat.name}`}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            padding: '8px',
                            minWidth: '36px',
                            minHeight: '36px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                          }}
                        >
                          🗑️
                        </button>
                      </>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Monthly limit */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: '700', color: 'var(--color-text-muted)', margin: 0 }}>Лимит трат в месяц</h3>
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
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-border-strong)',
                fontSize: 'var(--text-base)',
                outline: 'none'
              }}
            />
            <button
              type="submit"
              className="btn-primary"
              style={{
                padding: '10px 16px',
                borderRadius: 'var(--radius-md)',
                fontSize: 'var(--text-base)',
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
            background: 'var(--color-danger-soft)',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            color: 'var(--color-danger)',
            cursor: 'pointer',
            fontSize: 'var(--text-base)',
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
