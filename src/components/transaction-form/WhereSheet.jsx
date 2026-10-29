import { useEffect, useState } from 'react';
import { Check, ChevronLeft, Plus, Search, X } from 'lucide-react';
import Button from '../ui/Button';
import Chip from '../ui/Chip';
import Field from '../ui/Field';
import IconButton from '../ui/IconButton';
import ListRow from '../ui/ListRow';
import TransactionIcon from '../TransactionIcon';
import LogoPickerPanel from '../LogoPickerPanel';
import { companyKey, companyUses } from '../../utils/companies';
import { getTransactionLogoUrl } from '../../utils/logoDev';
import { pluralForm } from '../../utils/plural';

// Сколько знакомых компаний показываем в списке.
const SUGGESTIONS_LIMIT = 6;

const LOGO_MODES = [
    { id: 'auto', label: 'По названию' },
    { id: 'category', label: 'Категории' },
    { id: 'domain', label: 'По сайту' },
];

const NOT_FOUND_TEXT = 'Логотип не найден, показан значок категории';

// Подпись раздела: мелкая, серая, с весом label.
const SECTION_LABEL_STYLE = { color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-label)' };

// Лист «Где»: второй вид внутри листа формы (форма под ним скрыта, но жива).
// Сверху поиск, привязанный к названию компании, под ним знакомые компании и
// выбор значка в списке операций; внизу «Готово» и «Без компании».
//
// Название меняется сразу, пока печатают (onNameChange), поэтому «Готово»
// просто возвращает в форму. query - вводил ли пользователь текст: пока нет,
// список не сужен названием уже выбранной компании, иначе «Сменить» показало
// бы только её саму. suggestions приходят от формы под текущий текст.
export default function WhereSheet({ item, category, backLabel, suggestions, edited, logoChanged, apiFetch, autoFocusSearch, onNameChange, onChoose, onLogoChange, onMerchantSelect, onClear, onBack }) {
    const name = item.companyName || '';
    const trimmed = name.trim();
    const nameKey = companyKey(name);
    const mode = item.logoMode || 'auto';
    const [searchFocused, setSearchFocused] = useState(false);
    // Выбор «По сайту» без готового сайта в операцию не попадает, пока сайт не
    // применён: режим domain без адреса нельзя сохранить. До тех пор вкладка
    // открыта только здесь.
    const [domainDraft, setDomainDraft] = useState(false);
    const tab = mode === 'domain' || domainDraft ? 'domain' : mode;

    // Адрес логотипа печатается по буквам, а запрос за превью нужен один после
    // паузы; пока ждём, показываем значок категории.
    const desiredUrl = getTransactionLogoUrl(item);
    const [previewUrl, setPreviewUrl] = useState(desiredUrl);
    const [previewStatus, setPreviewStatus] = useState('disabled');
    const waitingForTyping = desiredUrl !== previewUrl;
    useEffect(() => {
        const timer = setTimeout(() => setPreviewUrl(desiredUrl), 400);
        return () => clearTimeout(timer);
    }, [desiredUrl]);

    const shown = suggestions.slice(0, SUGGESTIONS_LIMIT);
    const exactMatch = suggestions.some(company => companyKey(company.name) === nameKey);
    const showNew = edited && Boolean(trimmed) && !exactMatch;

    const pickMode = id => {
        if (id === 'domain') { setDomainDraft(true); return; }
        setDomainDraft(false);
        onLogoChange({ logoMode: id, merchantDomain: '' });
    };

    // Статус логотипа: текст в role="status", чтобы смену состояния озвучивали.
    let statusText = '';
    if (tab === 'category') {
        statusText = `Значок категории${category ? ` «${category}»` : ''}`;
    } else if (tab === 'auto' || mode === 'domain') {
        if (!desiredUrl) {
            statusText = NOT_FOUND_TEXT;
        } else if (waitingForTyping || (previewStatus !== 'loaded' && previewStatus !== 'error')) {
            // Пока картинка не ответила, статус ещё 'disabled' от значка
            // категории или 'loading' - «подобран» только после загрузки.
            statusText = 'Загружаем логотип…';
        } else if (previewStatus === 'error') {
            statusText = NOT_FOUND_TEXT;
        } else {
            statusText = mode === 'domain' ? `Логотип: ${item.merchantDomain}` : 'Логотип подобран по названию';
        }
    }
    if (statusText && logoChanged) statusText += ` · запомним для «${trimmed}»`;
    const previewItem = tab === 'category' || waitingForTyping ? { ...item, logoMode: 'category' } : item;
    // В «По сайту» превью нужно, только когда сайт уже применён
    const showPreview = Boolean(statusText);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 'var(--space-3)' }}>
                <Button
                    tone="text"
                    aria-label={`Назад: ${backLabel}`}
                    onClick={onBack}
                    style={{ justifySelf: 'start', minHeight: '44px', gap: 'var(--space-1)', fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-label)' }}
                >
                    <ChevronLeft size={20} strokeWidth={2} aria-hidden="true" />{backLabel}
                </Button>
                <h2 style={{ margin: 0, fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-strong)' }}>Где</h2>
                <span />
            </div>

            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                height: '48px',
                padding: '0 2px 0 var(--space-3)',
                border: '1px solid var(--color-border-strong)',
                borderRadius: 'var(--radius-md)',
                ...(searchFocused ? { borderColor: 'var(--color-primary)', boxShadow: 'inset 0 0 0 0.5px var(--color-primary)' } : null),
            }}>
                <Search size={18} strokeWidth={2} aria-hidden="true" color="var(--color-text-muted)" style={{ flexShrink: 0 }} />
                <Field
                    id="where-company"
                    aria-label="Компания"
                    value={name}
                    onChange={event => onNameChange(event.target.value)}
                    onFocus={() => setSearchFocused(true)}
                    onBlur={() => setSearchFocused(false)}
                    onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); onBack(); } }}
                    maxLength={120}
                    placeholder="Название магазина или сервиса"
                    autoComplete="off"
                    autoFocus={autoFocusSearch}
                    style={{ flex: 1, minWidth: 0, padding: 0, border: 'none', background: 'transparent', fontSize: 'var(--text-xl)' }}
                />
                {name && (
                    <IconButton round size={44} aria-label="Очистить" onClick={() => { onNameChange(''); document.getElementById('where-company')?.focus(); }} style={{ color: 'var(--color-text-muted)' }}>
                        <X size={18} strokeWidth={2} aria-hidden="true" />
                    </IconButton>
                )}
            </div>

            {(shown.length > 0 || showNew) && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                    {shown.length > 0 && <span style={SECTION_LABEL_STYLE}>Знакомые компании</span>}
                    <ul aria-label="Знакомые компании" style={{ margin: 0, padding: 0, listStyle: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                        {shown.map((company, index) => {
                            const uses = companyUses(company);
                            const details = [
                                company.category && `Обычно «${company.category}»`,
                                uses > 0 ? `${uses} ${pluralForm(uses, ['операция', 'операции', 'операций'])}` : (company.source === 'saved' ? 'Сохранённая компания' : 'Из истории'),
                            ].filter(Boolean).join(' · ');
                            return (
                                <li key={company._id || companyKey(company.name)}>
                                    <ListRow
                                        leading={<TransactionIcon item={{ type: 'expense', companyName: company.name, category: category || company.category, logoMode: company.logoMode, merchantDomain: company.merchantDomain }} size={32} />}
                                        title={company.name}
                                        subtitle={details}
                                        trailing={nameKey && companyKey(company.name) === nameKey ? <Check size={20} strokeWidth={2.4} role="img" aria-label="Выбрано" color="var(--color-primary)" /> : undefined}
                                        divider={index < shown.length - 1 || showNew}
                                        onClick={() => onChoose(company)}
                                        style={{ padding: 'var(--space-2) var(--space-3)' }}
                                    />
                                </li>
                            );
                        })}
                        {showNew && (
                            <li>
                                <ListRow
                                    leading={<span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '32px', height: '32px', borderRadius: 'var(--radius-sm)', background: 'var(--color-primary-tint)', color: 'var(--color-primary)' }}><Plus size={18} strokeWidth={2} aria-hidden="true" /></span>}
                                    title={<span style={{ color: 'var(--color-primary)' }}>Новая компания «{trimmed}»</span>}
                                    onClick={() => { onNameChange(name); onBack(); }}
                                    style={{ padding: 'var(--space-2) var(--space-3)' }}
                                />
                            </li>
                        )}
                    </ul>
                </div>
            )}

            {trimmed && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                    <span style={SECTION_LABEL_STYLE}>Значок в списке операций</span>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 'var(--space-2)' }}>
                        {LOGO_MODES.map(option => (
                            <Chip key={option.id} shape="block" selected={tab === option.id} onClick={() => pickMode(option.id)} style={{ minHeight: '48px', padding: '0 var(--space-2)' }}>
                                {option.label}
                            </Chip>
                        ))}
                    </div>
                    {showPreview && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: '10px var(--space-3)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface-muted)' }}>
                            <TransactionIcon item={previewItem} size={32} loading="eager" onLogoStateChange={setPreviewStatus} />
                            <span role="status" style={{ flex: 1, minWidth: 0, fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', lineHeight: 1.4, overflowWrap: 'anywhere' }}>{statusText}</span>
                        </div>
                    )}
                    {tab === 'domain' && (
                        <LogoPickerPanel id="where-logo" item={item} apiFetch={apiFetch} onChange={onLogoChange} onMerchantSelect={onMerchantSelect} />
                    )}
                </div>
            )}

            {/* Футер прилипает к низу листа, как у формы: лист даёт нижний
                отступ 24px + safe-area, bottom его компенсирует. */}
            <div style={{
                position: 'sticky',
                bottom: 'calc(-24px - env(safe-area-inset-bottom, 0px))',
                zIndex: 1,
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-1)',
                padding: 'var(--space-3) 0 calc(var(--space-3) + env(safe-area-inset-bottom, 0px))',
                background: 'var(--color-surface)',
                boxShadow: 'var(--shadow-sticky-footer)',
            }}>
                <Button size="lg" block onClick={onBack} style={{ minHeight: '54px' }}>Готово</Button>
                <Button tone="text" block onClick={onClear} style={{ minHeight: '44px', color: 'var(--color-text-muted)', fontSize: 'var(--text-md)', fontWeight: 'var(--weight-label)' }}>Без компании</Button>
            </div>
        </div>
    );
}
