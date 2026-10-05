import { useMemo } from 'react';
import { Plus, X } from 'lucide-react';
import Chip from '../ui/Chip';
import Field from '../ui/Field';
import { splitCategoriesByUsage } from '../../utils/finance';

// Блок разделения: сколько осталось распределить и по строке на часть -
// категория (чипы) и сумма. `split` - результат useSplits.
export default function SplitEditor({ split: { splits, remaining, isBalanced, add, remove, update }, categories, transactions, type, categoryCounts }) {
    // В разделении своего "Ещё" нет - ряд и так прокручивается, поэтому
    // частые идут первыми, хвост следом
    const ordered = useMemo(() => {
        const { frequent, rest } = splitCategoriesByUsage(categories, transactions, type, { counts: categoryCounts?.[type] });
        return [...frequent, ...rest];
    }, [categories, transactions, type, categoryCounts]);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', background: 'var(--color-surface-muted)', padding: '16px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border-subtle)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-md)' }}>
                <span>Осталось распределить:</span>
                <span style={{ color: isBalanced ? 'var(--color-positive)' : ((remaining < 0) ? 'var(--color-negative)' : 'var(--color-warning)'), fontWeight: 'bold' }}>
                    €{(isBalanced ? 0 : remaining).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
            </div>

            {splits.map((part, index) => (
                <div key={part.id} style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingBottom: '16px', borderBottom: '1px solid var(--color-border-subtle)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 'var(--text-base)', color: 'var(--color-text-muted)' }}>Категория {index + 1}</span>
                        {splits.length > 2 && (
                            <button type="button" aria-label={`Удалить часть ${index + 1}`} onClick={() => remove(part.id)} style={{ color: 'var(--color-negative)', background: 'transparent', fontSize: 'var(--text-2xl)' }}><X size={20} strokeWidth={1.8} aria-hidden="true" /></button>
                        )}
                    </div>

                    <div className="no-scrollbar" style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '4px' }}>
                        {ordered.map(cat => {
                            // категория, занятая другой частью, здесь не предлагается
                            if (splits.some(s => s.id !== part.id && s.category === cat.name)) return null;
                            return (
                                <Chip
                                    key={cat._id}
                                    selected={part.category === cat.name}
                                    onClick={() => update(part.id, 'category', cat.name)}
                                    style={{
                                        padding: '6px 12px',
                                        borderRadius: 'var(--radius-lg)',
                                        whiteSpace: 'nowrap',
                                        fontSize: 'var(--text-sm)',
                                    }}
                                >
                                    {cat.name}
                                </Chip>
                            );
                        })}
                    </div>

                    <div style={{ display: 'flex', gap: '8px' }}>
                        <Field
                            type="number"
                            tone="muted"
                            radius="var(--radius-sm)"
                            inputMode="decimal"
                            step="0.01"
                            placeholder="Сумма"
                            value={part.amount}
                            onChange={e => update(part.id, 'amount', e.target.value)}
                            style={{ flex: 1, padding: '10px' }}
                        />
                    </div>
                </div>
            ))}

            <button
                type="button"
                onClick={add}
                style={{ width: '100%', padding: '10px', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', color: 'var(--color-text-muted)', border: '1px dashed var(--color-border-strong)', fontWeight: '500' }}
            >
                <Plus size={18} strokeWidth={1.8} aria-hidden="true" /> Добавить категорию
            </button>
        </div>
    );
}
