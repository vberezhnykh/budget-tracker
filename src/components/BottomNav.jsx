import { ChartNoAxesCombined, Ellipsis, House, List, Plus } from 'lucide-react';

// Высота самой панели без отступа под системную полосу. Экспортируется для
// отступов экранов: панель fixed, из потока выпала, и без запаса снизу она
// закрыла бы конец страницы.
export const NAV_HEIGHT = 64;

// Отступ под панелью: зона жеста «домой» на iPhone (её размер браузер
// сообщает только при viewport-fit=cover в index.html), но не меньше 8px -
// на телефонах без такой зоны иначе кнопки стояли бы вплотную к краю, где
// живут системные жесты.
const NAV_BOTTOM_GAP = 'max(env(safe-area-inset-bottom, 0px), 8px)';

// Полная высота, которую панель занимает у нижнего края, с учётом отступа
// снизу. Готовая строка для CSS: calc здесь нужен, потому что env() в px
// заранее не посчитать.
export const NAV_OFFSET = `calc(${NAV_HEIGHT}px + ${NAV_BOTTOM_GAP})`;

const ADD_BUTTON_SIZE = 56;
// Насколько кнопка «+» приподнята над верхней гранью панели.
const ADD_BUTTON_RAISE = 16;

const TABS = [
  { id: 'overview', icon: House, label: 'Обзор' },
  { id: 'history', icon: List, label: 'История' },
  { id: 'add' },
  { id: 'analytics', icon: ChartNoAxesCombined, label: 'Аналитика' },
  { id: 'more', icon: Ellipsis, label: 'Ещё' },
];

const cellStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 0,
};

// Нижняя навигация на пять равных ячеек: четыре вкладки и по центру кнопка
// добавления операции. Кнопка - не вкладка (экрана у неё нет, она открывает
// форму), поэтому aria-current ей не ставится, а сама она приподнята над
// панелью, чтобы читаться главным действием.
//
// Фон непрозрачный: панель лежит поверх прокручиваемой страницы, и текст,
// просвечивающий сквозь неё, мешал бы читать подписи вкладок.
export default function BottomNav({ active, onChange, onAdd }) {
  return (
    <nav
      aria-label="Основная навигация"
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 800,
        boxSizing: 'border-box',
        // Высота вместе с верхней гранью и отступом под системную полосу:
        // тогда NAV_OFFSET - ровно та высота, что панель занимает на экране.
        height: NAV_OFFSET,
        background: 'var(--color-surface)',
        borderTop: '1px solid var(--color-border)',
        // Отступ под системную полосу лежит под ячейками: иначе подписи
        // уехали бы под жест «домой».
        paddingBottom: NAV_BOTTOM_GAP,
        display: 'grid',
        gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
      }}
    >
      {TABS.map(tab => {
        if (tab.id === 'add') {
          return (
            <div key={tab.id} style={{ ...cellStyle, alignItems: 'flex-start' }}>
              <button
                type="button"
                onClick={onAdd}
                aria-label="Добавить операцию"
                style={{
                  width: `${ADD_BUTTON_SIZE}px`,
                  height: `${ADD_BUTTON_SIZE}px`,
                  marginTop: `-${ADD_BUTTON_RAISE}px`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 0,
                  border: 'none',
                  borderRadius: '18px',
                  background: 'var(--color-primary)',
                  color: 'var(--color-text-inverse)',
                  cursor: 'pointer',
                }}
              >
                <Plus size={28} aria-hidden="true" />
              </button>
            </div>
          );
        }

        const isActive = active === tab.id;
        const TabIcon = tab.icon;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            aria-current={isActive ? 'page' : undefined}
            style={{
              ...cellStyle,
              flexDirection: 'column',
              gap: 'var(--space-0-5)',
              padding: 0,
              border: 'none',
              background: 'transparent',
              color: isActive ? 'var(--color-primary)' : 'var(--color-text-muted)',
              fontFamily: 'inherit',
              fontSize: 'var(--text-2xs)',
              fontWeight: 'var(--weight-label)',
              cursor: 'pointer',
            }}
          >
            <TabIcon size={22} aria-hidden="true" />
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
