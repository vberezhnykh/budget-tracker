import { useEffect, useRef, useState } from 'react'
import { MoreHorizontal, Plus } from 'lucide-react'
import ScreenHeader from '../../components/ui/ScreenHeader'
import SegmentedControl from '../../components/ui/SegmentedControl'
import IconButton from '../../components/ui/IconButton'
import Button from '../../components/ui/Button'
import Field, { FormLabel } from '../../components/ui/Field'
import { categoryUsageKey } from '../../utils/finance'
import { pluralForm } from '../../utils/plural'

const OPERATIONS = ['операция', 'операции', 'операций'];
const OPERATIONS_PREPOSITIONAL = ['операции', 'операциях', 'операциях'];

const usageLine = (used) => (used === 0 ? 'не используется' : `${used} ${pluralForm(used, OPERATIONS)}`);

const rowStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-3)',
  padding: 'var(--space-2) var(--space-4)',
};

const nameStyle = {
  fontSize: 'var(--text-md)',
  fontWeight: 'var(--weight-label)',
  color: 'var(--color-text-main)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const mutedStyle = { fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' };

// Поле с кнопками «Отмена» / «Сохранить»: общий вид переименования и новой
// категории. Enter отправляет форму, Escape отменяет. Подпись над полем задаёт
// вызывающий. Форма сама ничего не закрывает: решает родитель по ответу.
function InlineNameForm({ label, fieldId, value, onChange, onSubmit, onCancel, submitLabel, saving }) {
  return (
    <form
      onSubmit={onSubmit}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        }
      }}
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', padding: 'var(--space-2) 0' }}
    >
      <FormLabel htmlFor={fieldId} style={{ marginBottom: 0 }}>{label}</FormLabel>
      <Field
        id={fieldId}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus
        style={{ width: '100%', minHeight: '44px' }}
      />
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <Button tone="secondary" onClick={onCancel} style={{ flex: 1 }}>Отмена</Button>
        <Button type="submit" disabled={saving} style={{ flex: 1 }}>{submitLabel}</Button>
      </div>
    </form>
  );
}

// Меню «⋯» у строки. Закрывается по клику вне него и по Escape; фокус при
// закрытии по Escape возвращается на кнопку, с которой меню открыли.
function RowMenu({ category, onRename, onDelete, onClose, triggerRef }) {
  const menuRef = useRef(null);
  // onClose приходит новой функцией на каждый рендер: держим свежую в ref,
  // чтобы подписки и фокус не пересоздавались.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    menuRef.current?.querySelector('[role="menuitem"]')?.focus();
  }, []);

  useEffect(() => {
    const handleClick = (e) => {
      if (menuRef.current?.contains(e.target) || triggerRef.current?.contains(e.target)) return;
      onCloseRef.current();
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
        triggerRef.current?.focus();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const list = Array.from(menuRef.current?.querySelectorAll('[role="menuitem"]') || []);
        const index = list.indexOf(document.activeElement);
        const step = e.key === 'ArrowDown' ? 1 : -1;
        list[(index + step + list.length) % list.length]?.focus();
      }
    };
    document.addEventListener('click', handleClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('click', handleClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [triggerRef]);

  const itemStyle = {
    display: 'block',
    width: '100%',
    minHeight: '44px',
    padding: '0 var(--space-4)',
    border: 'none',
    background: 'transparent',
    textAlign: 'left',
    fontFamily: 'inherit',
    fontSize: 'var(--text-md)',
    fontWeight: 'var(--weight-label)',
    color: 'var(--color-text-main)',
    cursor: 'pointer',
  };

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={`Действия: ${category.name}`}
      style={{
        position: 'absolute',
        top: '100%',
        right: 0,
        zIndex: 10,
        minWidth: '180px',
        padding: 'var(--space-1) 0',
        borderRadius: 'var(--radius-md)',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border-subtle)',
        boxShadow: 'var(--shadow-menu)',
      }}
    >
      <button type="button" role="menuitem" onClick={onRename} style={itemStyle}>Переименовать</button>
      <button type="button" role="menuitem" onClick={onDelete} style={{ ...itemStyle, color: 'var(--color-danger)' }}>Удалить</button>
    </div>
  );
}

function CategoryRow({ divider, category, used, mode, nameInput, saving, onNameChange, onOpenMenu, onCloseMenu, onStartRename, onStartDelete, onCancel, onSubmitRename, onConfirmDelete }) {
  const triggerRef = useRef(null);
  const menuOpen = mode === 'menu';

  const style = divider ? { ...rowStyle, borderTop: '1px solid var(--color-border-subtle)' } : rowStyle;

  if (mode === 'rename') {
    return (
      <div style={style}>
        <InlineNameForm
          label={used > 0 ? `Новое название · изменится в ${used} ${pluralForm(used, OPERATIONS_PREPOSITIONAL)}` : 'Новое название'}
          fieldId={`rename-${category._id}`}
          value={nameInput}
          onChange={onNameChange}
          onSubmit={onSubmitRename}
          onCancel={onCancel}
          submitLabel="Сохранить"
          saving={saving}
        />
      </div>
    );
  }

  const singular = pluralForm(used, [true, false, false]);

  return (
    <div style={style}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={nameStyle}>{category.name}</div>
          <div style={mutedStyle}>{usageLine(used)}</div>
        </div>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <IconButton
            ref={triggerRef}
            size={44}
            aria-label={`Действия: ${category.name}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={menuOpen ? onCloseMenu : onOpenMenu}
            style={{ color: 'var(--color-text-muted)' }}
          >
            <MoreHorizontal size={20} strokeWidth={1.8} aria-hidden="true" />
          </IconButton>
          {menuOpen && (
            <RowMenu
              category={category}
              triggerRef={triggerRef}
              onClose={onCloseMenu}
              onRename={onStartRename}
              onDelete={onStartDelete}
            />
          )}
        </div>
      </div>

      {mode === 'delete' && (
        <div
          role="group"
          aria-label={`Удаление категории: ${category.name}`}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-3)',
            padding: 'var(--space-3) var(--space-4)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-danger-soft)',
            color: 'var(--color-danger-text)',
            fontSize: 'var(--text-base)',
          }}
        >
          <div>
            <div style={{ fontWeight: 'var(--weight-strong)' }}>Удалить категорию «{category.name}»?</div>
            {used > 0 && (
              <div>
                {singular ? 'Её использует' : 'Её используют'} {used} {pluralForm(used, OPERATIONS)}.{' '}
                {singular ? 'Она останется' : 'Они останутся'} в истории с прежним названием, но выбрать категорию заново будет нельзя.
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <Button tone="secondary" onClick={onCancel} style={{ flex: 1 }}>Отмена</Button>
            <Button tone="danger" onClick={onConfirmDelete} disabled={saving} style={{ flex: 1 }}>Удалить</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// Экран «Категории». Данные и запросы остаются в App: сюда приходят
// категории, счётчики использования и три обработчика, каждый возвращает
// Promise<boolean>. Строка закрывается только при true: если сервер отказал
// (пустое имя, дубль), форма остаётся открытой с введённым текстом.
//
// В любой момент раскрыта одна строка: меню, переименование, подтверждение
// удаления или строка новой категории - `active` хранит только одну из них.
// Подтверждение удаления встроено в строку, а не window.confirm: системный
// диалог нельзя оформить и он ломает e2e.
export default function CategoriesScreen({ categories = [], categoryUsage = {}, onBack, onAdd, onRename, onDelete }) {
  const [type, setType] = useState('expense');
  // { kind: 'menu' | 'rename' | 'delete', id } или { kind: 'add' } или null.
  const [active, setActive] = useState(null);
  const [nameInput, setNameInput] = useState('');
  const [saving, setSaving] = useState(false);

  const counts = {
    expense: categories.filter((c) => c.type === 'expense').length,
    income: categories.filter((c) => c.type === 'income').length,
  };
  const visible = categories.filter((c) => c.type === type);

  const close = () => {
    setActive(null);
    setNameInput('');
  };
  // Закрывает меню только этой строки: клик по «⋯» другой строки открывает её
  // меню раньше, чем это сработает по document, и его гасить нельзя.
  const closeMenu = (id) => setActive((current) => (current?.kind === 'menu' && current.id === id ? null : current));

  const run = async (action) => {
    if (saving) return;
    setSaving(true);
    try {
      if (await action()) close();
    } finally {
      setSaving(false);
    }
  };

  const handleTypeChange = (next) => {
    setType(next);
    close();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <ScreenHeader
        title="Категории"
        backLabel="Ещё"
        onBack={onBack}
        actions={(
          <IconButton
            tone="primary"
            round
            size={44}
            aria-label="Новая категория"
            onClick={() => {
              setNameInput('');
              setActive({ kind: 'add' });
            }}
          >
            <Plus size={20} strokeWidth={1.8} aria-hidden="true" />
          </IconButton>
        )}
      />

      <SegmentedControl
        value={type}
        onChange={handleTypeChange}
        style={{ background: 'var(--color-surface-sunken)' }}
        options={[
          { id: 'expense', label: `Расходы · ${counts.expense}` },
          { id: 'income', label: `Доходы · ${counts.income}` },
        ]}
      />

      {/* Без overflow: hidden - иначе меню «⋯» у нижних строк обрежется. */}
      <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border-subtle)' }}>
        {active?.kind === 'add' && (
          <div style={rowStyle}>
            <InlineNameForm
              label="Новая категория"
              fieldId="new-category-name"
              value={nameInput}
              onChange={setNameInput}
              onSubmit={(e) => {
                e.preventDefault();
                run(() => onAdd(nameInput, type));
              }}
              onCancel={close}
              submitLabel="Добавить"
              saving={saving}
            />
          </div>
        )}

        {visible.length === 0 && active?.kind !== 'add' && (
          <div style={{ padding: 'var(--space-4)', fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
            Категорий пока нет
          </div>
        )}

        {visible.map((category, index) => {
          const used = categoryUsage[categoryUsageKey(category)] || 0;
          const mode = active?.id === category._id ? active.kind : null;
          return (
            <CategoryRow
              key={category._id}
              divider={index > 0 || active?.kind === 'add'}
              category={category}
              used={used}
              mode={mode}
              nameInput={nameInput}
              saving={saving}
              onNameChange={setNameInput}
              onOpenMenu={() => setActive({ kind: 'menu', id: category._id })}
              onCloseMenu={() => closeMenu(category._id)}
              onStartRename={() => {
                setNameInput(category.name);
                setActive({ kind: 'rename', id: category._id });
              }}
              onStartDelete={() => setActive({ kind: 'delete', id: category._id })}
              onCancel={close}
              onSubmitRename={(e) => {
                e.preventDefault();
                run(() => onRename(category, nameInput));
              }}
              onConfirmDelete={() => run(() => onDelete(category, used))}
            />
          );
        })}
      </div>
    </div>
  );
}
