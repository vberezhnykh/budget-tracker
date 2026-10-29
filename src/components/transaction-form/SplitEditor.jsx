import { useMemo } from 'react';
import { ChevronDown, Plus, X } from 'lucide-react';
import IconButton from '../ui/IconButton';
import TransactionIcon from '../TransactionIcon';
import { splitCategoriesByUsage } from '../../utils/finance';
import { formatMoney } from '../../utils/money';

// Строка части: выбор категории, сумма, удаление. Категория и сумма - поля
// высотой 48px с той же рамкой и скруглением, что у остальных полей формы.
const CONTROL_STYLE = {
    height: '48px',
    border: '1px solid var(--color-border-strong)',
    borderRadius: 'var(--radius-md)',
    background: 'var(--color-surface)',
};

// Плашка под частями: цвет по состоянию. Недораспределено и перебор - оба
// «внимание», а не ошибка, поэтому одни тона; когда сошлось - положительные.
const STATUS_TONES = {
    pending: { background: 'var(--color-warning-soft)', color: 'var(--color-warning-text)' },
    balanced: { background: 'var(--color-positive-soft)', color: 'var(--color-positive)' },
};

// Части операции: по строке на категорию с суммой и плашка с остатком.
// Подпись «Категории» и ссылка «Не разделять» над ними - в форме.
// `split` - результат useSplits.
export default function SplitEditor({ split: { splits, total, remaining, isBalanced, add, remove, update }, categories, transactions, type, categoryCounts }) {
    // В разделении своего "Ещё" нет - выбор открывается списком целиком,
    // поэтому частые идут первыми, хвост следом
    const ordered = useMemo(() => {
        const { frequent, rest } = splitCategoriesByUsage(categories, transactions, type, { counts: categoryCounts?.[type] });
        return [...frequent, ...rest];
    }, [categories, transactions, type, categoryCounts]);

    const status = isBalanced
        ? { tone: STATUS_TONES.balanced, label: 'Распределено полностью', value: formatMoney(total) }
        : remaining > 0
            ? { tone: STATUS_TONES.pending, label: 'Осталось распределить', value: formatMoney(remaining) }
            : { tone: STATUS_TONES.pending, label: 'Части больше общей суммы на', value: formatMoney(-remaining) };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {splits.map((part, index) => {
                // категория, занятая другой частью, здесь не предлагается;
                // своя остаётся, даже если её уже нет среди категорий
                const names = ordered.map(cat => cat.name).filter(name => !splits.some(s => s.id !== part.id && s.category === name));
                if (part.category && !names.includes(part.category)) names.push(part.category);
                return (
                    <div key={part.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                        {/* Выбор - настоящий <select>, прозрачный поверх нарисованного
                            поля: на iPhone он открывает системный список. */}
                        <div className="split-part-category" style={{ ...CONTROL_STYLE, position: 'relative', flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: '0 var(--space-3)' }}>
                            <TransactionIcon item={{ type: 'expense', category: part.category }} size={28} />
                            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 'var(--text-lg)', ...(part.category ? { fontWeight: 'var(--weight-label)' } : { color: 'var(--color-text-muted)' }) }}>
                                {part.category || 'Категория'}
                            </span>
                            <ChevronDown size={16} strokeWidth={2} aria-hidden="true" color="var(--color-text-muted)" style={{ flexShrink: 0 }} />
                            <select
                                aria-label={`Категория части ${index + 1}`}
                                value={part.category}
                                onChange={e => update(part.id, 'category', e.target.value)}
                                // 16px: меньший кегль Safari на iOS при открытии увеличивает страницу
                                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', fontSize: '1rem' }}
                            >
                                {!part.category && <option value="" disabled>Категория</option>}
                                {names.map(name => <option key={name} value={name}>{name}</option>)}
                            </select>
                        </div>

                        <label style={{ ...CONTROL_STYLE, boxSizing: 'border-box', width: '112px', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 'var(--space-0-5)', padding: '0 var(--space-3)', fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-strong)' }}>
                            <span aria-hidden="true" style={{ color: 'var(--color-text-muted)' }}>€</span>
                            <input
                                className="split-part-amount"
                                type="number"
                                inputMode="decimal"
                                step="0.01"
                                placeholder="Сумма"
                                aria-label={`Сумма части ${index + 1}`}
                                value={part.amount}
                                onChange={e => update(part.id, 'amount', e.target.value)}
                                style={{ width: '100%', minWidth: 0, padding: 0, border: 'none', outline: 'none', background: 'transparent', color: 'var(--color-text-main)', font: 'inherit', textAlign: 'right' }}
                            />
                        </label>

                        {splits.length > 2 && (
                            <IconButton size={44} aria-label={`Удалить часть ${index + 1}`} onClick={() => remove(part.id)} style={{ color: 'var(--color-text-muted)' }}>
                                <X size={20} strokeWidth={1.8} aria-hidden="true" />
                            </IconButton>
                        )}
                    </div>
                );
            })}

            <button
                type="button"
                onClick={add}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-1-5)', width: '100%', minHeight: '44px', border: '1px dashed var(--color-primary-border)', borderRadius: 'var(--radius-md)', background: 'transparent', color: 'var(--color-primary)', fontSize: 'var(--text-md)', fontWeight: 'var(--weight-label)' }}
            >
                <Plus size={16} strokeWidth={2} aria-hidden="true" /> Добавить часть
            </button>

            <div
                role="status"
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--space-3)', padding: '12px 14px', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-md)', ...status.tone }}
            >
                <span>{status.label}</span>
                <span style={{ fontWeight: 'var(--weight-strong)' }}>{status.value}</span>
            </div>
        </div>
    );
}
