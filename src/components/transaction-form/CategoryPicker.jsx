import { useMemo, useState } from 'react';
import { Check, LoaderCircle, Plus, X } from 'lucide-react';
import Chip from '../ui/Chip';
import Button from '../ui/Button';
import Field, { FormLabel } from '../ui/Field';
import { splitCategoriesByUsage } from '../../utils/finance';

const chipButton = {
    padding: '8px 16px',
    borderRadius: 'var(--radius-pill)',
    background: 'transparent',
    color: 'var(--color-primary)',
    fontSize: 'var(--text-base)',
    cursor: 'pointer',
    transition: 'all 0.2s'
};

// Выбор категории: частые наверху, хвост под «Ещё N», в конце ряда -
// «+ Новая» с созданием категории прямо здесь.
export default function CategoryPicker({ categories, transactions, type, categoryCounts, value, onChange, onAddCategory }) {
    // Категорий стало два десятка, и списком в один экран они уже не читаются.
    // Наверх поднимаем то, чем реально пользуются, хвост прячем под "Ещё N" -
    // в свёрнутом виде блок помещается в пару рядов.
    const [showAll, setShowAll] = useState(false);
    const [isAdding, setIsAdding] = useState(false);
    const [newName, setNewName] = useState('');
    const [error, setError] = useState('');
    const [creating, setCreating] = useState(false);

    // pinned нужен только свёрнутому блоку - удержать выбранную категорию на
    // виду. В раскрытом списке она и так видна, а прикрепление переставило бы
    // чип вверх ровно в момент нажатия, прямо под пальцем.
    const { frequent, rest } = useMemo(
        () => splitCategoriesByUsage(categories, transactions, type, {
            pinned: showAll ? null : value,
            counts: categoryCounts?.[type],
        }),
        [categories, transactions, type, value, showAll, categoryCounts]
    );
    const visible = showAll ? [...frequent, ...rest] : frequent;

    const handleCreate = async () => {
        const trimmed = newName.trim();
        if (!trimmed || !onAddCategory || creating) return;
        setError('');
        setCreating(true);
        try {
            const result = await onAddCategory(trimmed, type);
            if (result?.error) {
                setError(result.error);
                return;
            }
            if (result) {
                onChange(trimmed);
                setNewName('');
                setIsAdding(false);
                // Свежесозданная категория лежит в хвосте (частота нулевая), а
                // прятать её сразу после создания нельзя - раскрываем список.
                setShowAll(true);
            }
        } catch {
            setError('Не удалось создать категорию');
        } finally {
            setCreating(false);
        }
    };

    return (
        <div>
            <FormLabel>Категория</FormLabel>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {visible.map(cat => (
                    <Chip
                        key={cat._id}
                        selected={value === cat.name}
                        onClick={() => onChange(cat.name)}
                        style={{ padding: '8px 16px' }}
                    >
                        {cat.name}
                    </Chip>
                ))}

                {rest.length > 0 && (
                    <button
                        type="button"
                        onClick={() => setShowAll(!showAll)}
                        aria-expanded={showAll}
                        style={{ ...chipButton, border: '1px dashed var(--color-border-strong)', fontWeight: 'var(--weight-label)' }}
                    >
                        {showAll ? 'Свернуть' : `Ещё ${rest.length}`}
                    </button>
                )}

                {/* Новая категория - последний чип ряда; пока
                    идёт ввод имени, его место занимает поле ниже */}
                {!isAdding && (
                    <button
                        type="button"
                        onClick={() => setIsAdding(true)}
                        style={{ ...chipButton, border: '1px dashed var(--color-primary-border)', fontWeight: 'var(--weight-label)' }}
                    >
                        <Plus size={16} strokeWidth={1.8} aria-hidden="true" /> Новая
                    </button>
                )}
            </div>

            {isAdding && (
                <div style={{ marginTop: '10px' }}>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <Field
                            type="text"
                            tone="muted"
                            radius="var(--radius-pill)"
                            placeholder="Название..."
                            value={newName}
                            onChange={e => {
                                setNewName(e.target.value);
                                if (error) setError('');
                            }}
                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleCreate(); } }}
                            autoFocus
                            style={{
                                flex: 1,
                                minWidth: 0,
                                padding: '8px 12px',
                                // поле-чип рядом с чипами категорий: рамка
                                // фирменная, а не нейтральная
                                border: '1px solid var(--color-primary-border)',
                            }}
                        />
                        <Button
                            size="sm"
                            aria-label="Сохранить категорию"
                            aria-busy={creating}
                            onClick={handleCreate}
                            disabled={!newName.trim() || creating}
                        >{creating ? <LoaderCircle size={18} strokeWidth={1.8} aria-hidden="true" /> : <Check size={18} strokeWidth={1.8} aria-hidden="true" />}</Button>
                        <Button
                            tone="secondary"
                            size="sm"
                            aria-label="Отменить создание категории"
                            onClick={() => { setIsAdding(false); setNewName(''); setError(''); }}
                        ><X size={18} strokeWidth={1.8} aria-hidden="true" /></Button>
                    </div>
                    {error && (
                        <div role="alert" style={{ color: 'var(--color-negative)', fontSize: 'var(--text-sm)', marginTop: '6px' }}>
                            {error}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
