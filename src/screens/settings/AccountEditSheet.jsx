import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import AccountIcon from '../../components/AccountIcon';
import Button from '../../components/ui/Button';
import Field, { FormLabel } from '../../components/ui/Field';
import IconButton from '../../components/ui/IconButton';
import InlineAlert from '../../components/ui/InlineAlert';
import SegmentedControl from '../../components/ui/SegmentedControl';
import Sheet from '../../components/ui/Sheet';
import Switch from '../../components/ui/Switch';
import { ACCOUNT_ICON_OPTIONS, resolveAccountIcon } from '../../utils/accountIcons';

// Лист счёта: создание (account = null) и правка. Состояние формы берётся из
// account один раз при монтировании, поэтому родитель должен пересоздавать
// лист при смене счёта (key={account?._id ?? 'new'}). Сохранение и удаление
// выполняет родитель; лист закрывается только когда он ответил true.

const TYPE_OPTIONS = [
  { id: 'card', label: 'Карта' },
  { id: 'cash', label: 'Наличные' },
];

// Значок по умолчанию для типа: при выборе типа у нового счёта значок
// переключается на соответствующий, как в прежнем окне настроек.
const DEFAULT_ICON = { card: 'credit-card', cash: 'banknote' };

export default function AccountEditSheet({ account, onClose, onSave, onDelete }) {
  const isNew = !account;
  const [name, setName] = useState(account?.name ?? '');
  const [type, setType] = useState(account?.type ?? 'card');
  const [icon, setIcon] = useState(() => (account ? resolveAccountIcon(account.icon, account.type) : DEFAULT_ICON.card));
  const [excludeFromTotal, setExcludeFromTotal] = useState(Boolean(account?.excludeFromTotal));
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const nameRef = useRef(null);

  // Лист сам переводит фокус на первый элемент (кнопку закрытия), а для нового
  // счёта нужно сразу печатать название. Эффект родителя выполняется после
  // эффекта листа, поэтому фокус остаётся на поле.
  useEffect(() => {
    if (isNew) nameRef.current?.focus();
  }, [isNew]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      const ok = await onSave({
        name,
        type,
        icon,
        excludeFromTotal,
        editingAccountId: account?._id ?? null,
      });
      if (ok) onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      const ok = await onDelete(account);
      if (ok) onClose();
    } finally {
      setDeleting(false);
    }
  };

  const selectType = (nextType) => {
    setType(nextType);
    setIcon(DEFAULT_ICON[nextType]);
  };

  return (
    <Sheet ariaLabel={isNew ? 'Новый счёт' : 'Счёт'} onClose={onClose} gap="var(--space-4)">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
        <h2 style={{ margin: 0, fontSize: 'var(--text-3xl)', fontWeight: 'var(--weight-strong)', color: 'var(--color-text-main)' }}>
          {isNew ? 'Новый счёт' : 'Счёт'}
        </h2>
        <IconButton tone="neutral" round size={44} onClick={onClose} aria-label="Закрыть">
          <X size={18} strokeWidth={1.8} aria-hidden="true" />
        </IconButton>
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <div>
          <FormLabel htmlFor="account-name">Название</FormLabel>
          <Field
            id="account-name"
            ref={nameRef}
            type="text"
            placeholder="Например, Мой Revolut"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            style={{ width: '100%', minHeight: '44px' }}
          />
        </div>

        <div>
          <span style={{ display: 'block', marginBottom: 'var(--space-2)', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-label)', color: 'var(--color-text-muted)' }}>
            Тип
          </span>
          {isNew ? (
            <SegmentedControl
              ariaLabel="Тип счёта"
              options={TYPE_OPTIONS}
              value={type}
              onChange={selectType}
              style={{ background: 'var(--color-surface-sunken)' }}
            />
          ) : (
            // Тип задаётся при создании и дальше не меняется (сервер его не
            // принимает в PUT), поэтому у существующего счёта это просто строка.
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 'var(--space-3)',
                minHeight: '44px',
                padding: '0 var(--space-4)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--color-surface-sunken)',
              }}
            >
              <span style={{ fontSize: 'var(--text-md)', fontWeight: 'var(--weight-label)', color: 'var(--color-text-main)' }}>
                {type === 'cash' ? 'Наличные' : 'Карта'}
              </span>
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>задаётся при создании</span>
            </div>
          )}
        </div>

        <fieldset style={{ margin: 0, padding: 0, border: 'none', minWidth: 0 }}>
          <legend style={{ padding: 0, marginBottom: 'var(--space-2)', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-label)', color: 'var(--color-text-muted)' }}>
            Значок
          </legend>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 'var(--space-2)' }}>
            {ACCOUNT_ICON_OPTIONS.map(option => {
              const selected = icon === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-label={option.label}
                  title={option.label}
                  aria-pressed={selected}
                  onClick={() => setIcon(option.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '52px',
                    padding: 0,
                    boxSizing: 'border-box',
                    borderRadius: 'var(--radius-md)',
                    border: selected ? '1.5px solid var(--color-primary)' : '1.5px solid transparent',
                    background: selected ? 'var(--color-primary-tint)' : 'var(--color-surface-sunken)',
                    color: selected ? 'var(--color-primary)' : 'var(--color-text-muted)',
                    cursor: 'pointer',
                  }}
                >
                  <AccountIcon icon={option.id} size={22} />
                </button>
              );
            })}
          </div>
        </fieldset>

        {/* Показывается и у существующего счёта: тип задаётся раз и навсегда,
            а «заморожен ли счёт» со временем меняется - залог возвращают,
            вклад закрывают. */}
        <div>
          <Switch checked={excludeFromTotal} onChange={setExcludeFromTotal} label="Не учитывать в общем капитале" />
          <p style={{ margin: 'var(--space-2) var(--space-1) 0', fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
            Для залогов и вкладов: баланс виден, но в итог не входит
          </p>
        </div>

        <Button type="submit" size="lg" block disabled={saving || !name.trim()}>
          {saving ? 'Сохранение…' : 'Сохранить'}
        </Button>
      </form>

      {!isNew && !confirmingDelete && (
        <Button tone="text" block onClick={() => setConfirmingDelete(true)} style={{ minHeight: '44px', color: 'var(--color-danger)' }}>
          Удалить счёт
        </Button>
      )}

      {/* Подтверждение прямо в листе вместо window.confirm. Текст повторяет
          правила сервера (DELETE /api/accounts/:id): счёт удаляется, только
          если на него не ссылаются операции (корзина тоже считается),
          предстоящие платежи и банковский счёт. */}
      {!isNew && confirmingDelete && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <InlineAlert tone="danger">
            Удалить счёт «{account.name}»? Это возможно, только если по нему нет операций (в том числе в корзине), предстоящих платежей и привязанного банка.
          </InlineAlert>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <Button tone="secondary" onClick={() => setConfirmingDelete(false)} disabled={deleting} style={{ flex: 1 }}>
              Отмена
            </Button>
            <Button tone="danger" onClick={handleDelete} disabled={deleting} style={{ flex: 1 }}>
              {deleting ? 'Удаление…' : 'Удалить'}
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
