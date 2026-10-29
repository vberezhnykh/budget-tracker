import { ChevronDown, X } from 'lucide-react';

// Кнопка-фильтр в ряду под поиском Истории: «Категория», «Все счета»,
// «Любой тип». Выключенная - белая таблетка с шевроном, нажатие открывает лист
// выбора. Включённая показывает выбранное значение на фирменной подложке, и
// у неё две отдельные цели: подпись открывает лист, крестик снимает фильтр.
//
// Это два соседних <button> в общей оболочке, а не крестик внутри кнопки:
// вложенная кнопка невалидна, а читалка зачитала бы её частью подписи. Крестик
// получает зону нажатия 44px - он выступает за таблетку (36px) отрицательными
// полями, а ряд вокруг оставляет под это запас (см. HistoryScreen).

const PILL_HEIGHT = '36px';

const pillText = {
    fontSize: 'var(--text-sm)',
    fontWeight: 'var(--weight-label)',
    whiteSpace: 'nowrap',
};

// kind - что это за фильтр («Категория», «Счёт», «Тип»): у включённой таблетки
// видна только выбранная величина, и без названия фильтра её не поймут вслух.
export default function HistoryFilterPill({ kind, label, active, onOpen, onClear }) {
    if (!active) {
        return (
            <button
                type="button"
                onClick={onOpen}
                aria-haspopup="dialog"
                style={{
                    ...pillText,
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-1)',
                    height: PILL_HEIGHT,
                    padding: '0 var(--space-3)',
                    borderRadius: 'var(--radius-pill)',
                    border: '1px solid var(--color-border-strong)',
                    background: 'var(--color-surface)',
                    color: 'var(--color-text-main)',
                }}
            >
                {label}
                <ChevronDown size={14} strokeWidth={2.4} aria-hidden="true" />
            </button>
        );
    }

    return (
        <span
            style={{
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                height: PILL_HEIGHT,
                borderRadius: 'var(--radius-pill)',
                border: '1px solid var(--color-primary)',
                background: 'var(--color-primary-tint)',
                color: 'var(--color-primary)',
            }}
        >
            <button
                type="button"
                onClick={onOpen}
                aria-label={`${kind}: ${label}`}
                aria-haspopup="dialog"
                style={{
                    ...pillText,
                    height: '100%',
                    padding: '0 0 0 var(--space-3)',
                    background: 'transparent',
                    color: 'inherit',
                    borderRadius: 'var(--radius-pill) 0 0 var(--radius-pill)',
                }}
            >
                {label}
            </button>
            <button
                type="button"
                onClick={onClear}
                aria-label={`Снять фильтр «${label}»`}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    width: '44px',
                    height: '44px',
                    // 44px зоны нажатия при 14px значке: слева она заходит на
                    // подпись, справа и по вертикали выступает за рамку
                    // таблетки, так что значок остаётся в 10px от её края.
                    margin: '-4px -5px -4px -8px',
                    padding: 0,
                    background: 'transparent',
                    color: 'inherit',
                }}
            >
                <X size={14} strokeWidth={2.4} aria-hidden="true" />
            </button>
        </span>
    );
}
