import { Check, X } from 'lucide-react';
import IconButton from './ui/IconButton';
import ListRow from './ui/ListRow';
import Sheet from './ui/Sheet';

// Лист выбора одного значения фильтра Истории: категория, счёт или тип
// операции. Вид один на все три, различаются заголовок и набор строк.
//
// Это группа радиокнопок: первая строка - «все» (value === null), дальше
// варианты. Нажатие на строку применяет фильтр сразу и закрывает лист, кнопки
// «Показать» нет. Числа операций у вариантов не показываем: счётчиков по
// чужим фильтрам у приложения нет, а считать их запросом на каждый вариант
// значило бы нагрузить сервер ради подписи.
//
// Выбранная строка отмечена цветом, весом и галочкой справа: цвета одного
// недостаточно, а aria-checked читают и без глаз.

export default function HistoryFilterSheet({ title, allLabel, options, value, onPick, onClose }) {
    const rows = [{ value: null, label: allLabel }, ...options];
    const current = value ?? null;

    return (
        <Sheet ariaLabel={title} onClose={onClose} maxHeight="85vh" gap="var(--space-3)">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)' }}>
                <h2 style={{ margin: 0, fontSize: 'var(--text-3xl)', fontWeight: 'var(--weight-strong)', color: 'var(--color-text-main)' }}>
                    {title}
                </h2>
                <IconButton tone="neutral" round size={44} onClick={onClose} aria-label="Закрыть">
                    <X size={20} strokeWidth={2} aria-hidden="true" />
                </IconButton>
            </div>

            {/* Длинный список листается сам, а заголовок с кнопкой закрытия
                остаётся на месте. */}
            <div role="radiogroup" aria-label={title} style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain' }}>
                {rows.map((row, index) => {
                    const selected = row.value === current;
                    return (
                        <ListRow
                            key={row.value ?? 'all'}
                            role="radio"
                            aria-checked={selected}
                            onClick={() => onPick(row.value)}
                            divider={index < rows.length - 1}
                            style={{ minHeight: '52px' }}
                            title={(
                                <span style={{
                                    overflowWrap: 'anywhere',
                                    color: selected ? 'var(--color-primary)' : 'var(--color-text-main)',
                                    fontWeight: selected ? 'var(--weight-label)' : 'var(--weight-text)',
                                }}
                                >
                                    {row.label}
                                </span>
                            )}
                            trailing={selected ? <Check size={20} strokeWidth={2.4} aria-hidden="true" color="var(--color-primary)" /> : null}
                        />
                    );
                })}
            </div>
        </Sheet>
    );
}
