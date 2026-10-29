import { ChevronRight, Store } from 'lucide-react';
import Button from '../ui/Button';
import { FormLabel } from '../ui/Field';
import HintChip from '../ui/HintChip';
import TransactionIcon from '../TransactionIcon';
import { companyKey } from '../../utils/companies';

// Сколько частых мест показываем под строкой.
const PLACES_LIMIT = 6;

// Строка «Где» целиком - одна кнопка: выбор компании открывается по нажатию
// в любом её месте. «Сменить» внутри - не вторая кнопка (кнопка в кнопке
// недопустима), а подпись в том же виде, что у Button tone="secondary".
const ROW_STYLE = {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-3)',
    width: '100%',
    minHeight: '48px',
    padding: 'var(--space-2) var(--space-2) var(--space-2) var(--space-3)',
    border: '1px solid var(--color-border-strong)',
    borderRadius: 'var(--radius-md)',
    background: 'var(--color-surface)',
    color: 'var(--color-text-main)',
    font: 'inherit',
    textAlign: 'left',
    cursor: 'pointer',
};

const CHANGE_STYLE = {
    display: 'inline-flex',
    alignItems: 'center',
    flexShrink: 0,
    height: '36px',
    padding: '0 var(--space-3)',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--color-surface-inset)',
    fontSize: 'var(--text-base)',
    fontWeight: 'var(--weight-strong)',
};

// Выбранное место - как выбранный чип формы: подложка и рамка фирменные.
const PLACE_SELECTED_STYLE = {
    border: '1px solid var(--color-primary)',
    background: 'var(--color-primary-tint)',
    color: 'var(--color-primary)',
    fontWeight: 'var(--weight-label)',
};

// «Где» в форме расхода: выбранная компания (или заглушка) и под ней частые
// места для текущей категории. Данные и выбор живут в форме: сюда приходят
// подсказки (getCompanySuggestions без текста) и обработчики.
//
// usualCategory - обычная категория выбранной компании: подпись под названием
// говорит, подходит ли она к категории, выбранной сейчас.
export default function WhereRow({ item, category, usualCategory, suggestions, status, onOpen, onChoose, onRetry }) {
    const name = item.companyName?.trim() || '';
    const selectedKey = companyKey(name);
    // Частое место - то, где уже тратили в этой категории; без категории
    // подсказывать нечего. Ряд не переносится: его длина не должна двигать
    // кнопку сохранения.
    const places = category
        ? suggestions.filter(company => (company.usage?.[category] || 0) > 0 || company.category === category).slice(0, PLACES_LIMIT)
        : [];
    const subline = !name || !usualCategory ? ''
        : usualCategory === category ? `Чаще всего для «${usualCategory}»` : `Обычно «${usualCategory}»`;

    return (
        <div>
            <FormLabel>Где</FormLabel>
            <button type="button" onClick={onOpen} style={ROW_STYLE}>
                {name ? (
                    <>
                        <TransactionIcon item={item} size={32} loading="eager" />
                        <span style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                            <span style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-label)', overflowWrap: 'anywhere' }}>{name}</span>
                            {subline && <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>{subline}</span>}
                        </span>
                        <span style={CHANGE_STYLE}>Сменить</span>
                    </>
                ) : (
                    <>
                        <Store size={20} strokeWidth={1.8} aria-hidden="true" color="var(--color-text-muted)" style={{ flexShrink: 0, margin: '0 var(--space-1)' }} />
                        <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--text-lg)', color: 'var(--color-text-muted)' }}>Магазин или сервис</span>
                        <ChevronRight size={18} aria-hidden="true" color="var(--color-text-subtle)" style={{ flexShrink: 0, margin: '0 var(--space-1)' }} />
                    </>
                )}
            </button>

            {places.length > 0 && (
                <div
                    role="group"
                    aria-label={`Частые места для категории «${category}»`}
                    className="no-scrollbar"
                    style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)', overflowX: 'auto', paddingBottom: 'var(--space-1)' }}
                >
                    {places.map(company => {
                        const selected = Boolean(selectedKey) && companyKey(company.name) === selectedKey;
                        return (
                            <HintChip
                                key={company._id || companyKey(company.name)}
                                aria-pressed={selected}
                                onClick={() => onChoose(company)}
                                style={{ flex: '0 0 auto', whiteSpace: 'nowrap', ...(selected ? PLACE_SELECTED_STYLE : null) }}
                            >
                                {company.name}
                            </HintChip>
                        );
                    })}
                </div>
            )}

            {status === 'error' && (
                <div style={{ marginTop: 'var(--space-2)', color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
                    Список компаний недоступен.{' '}
                    <Button tone="text" onClick={onRetry} style={{ minHeight: '28px', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-strong)' }}>Повторить</Button>
                </div>
            )}
        </div>
    );
}
