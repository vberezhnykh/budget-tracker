import { useState, useMemo, useEffect, useRef } from 'react';
import { ArrowDownLeft, ArrowDownUp, ArrowUpRight, Check, ChevronDown, LoaderCircle, Plus, Trash2, X } from 'lucide-react';
import AccountIcon from './AccountIcon';
import TransactionLogoPicker from './TransactionLogoPicker';
import CompanyField from './CompanyField';
import Field from './ui/Field'
import Chip from './ui/Chip'
import Sheet from './ui/Sheet'
import IconButton from './ui/IconButton'
import { getDescriptionSuggestions, splitCategoriesByUsage } from '../utils/finance';
import { saveCompanySelection } from '../utils/companies';
import { MIN_DATE, toLocalDateInput } from '../utils/period';

const EMPTY_SUGGESTIONS = [];

const labelStyle = { display: 'block', color: 'var(--color-text-muted)', marginBottom: '8px', fontSize: 'var(--text-base)' };

// Значения logoMode, при которых в «Дополнительно» нечего показывать
// раскрытым: новый расход стартует с 'category', 'auto' - умолчание пикера.
const DEFAULT_LOGO_MODES = ['category', 'auto', ''];

// 'YYYY-MM-DD' -> «5 окт.»; год добавляем только для чужого года
const formatShortDate = (value) => {
    const [y, m, d] = value.split('-').map(Number);
    if (!y || !m || !d) return value;
    return new Date(y, m - 1, d).toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'short',
        ...(y !== new Date().getFullYear() ? { year: 'numeric' } : {}),
    });
};

// Ряд чипов счетов: общий для списания/зачисления и для сторон перевода.
// scrollAlways - в узкой строке перевода чипы не сжимаются, а прокручиваются.
function AccountChips({ accounts, isSelected, onPick, scrollAlways = false, ...props }) {
    const scrolls = scrollAlways || accounts.length > 3;
    const rowRef = useRef(null);
    // Выбранный счёт может оказаться за краем прокрутки - подводим его в
    // видимую часть при открытии формы
    useEffect(() => {
        const row = rowRef.current;
        const chip = row?.querySelector('[aria-pressed="true"]');
        if (row && chip && scrolls) row.scrollLeft = Math.max(0, chip.offsetLeft - row.offsetLeft - 8);
    }, [scrolls]);
    return (
        <div
            {...props}
            ref={rowRef}
            style={{
                display: 'flex',
                gap: scrollAlways ? '8px' : '12px',
                overflowX: scrolls ? 'auto' : 'visible',
                paddingBottom: scrolls ? '8px' : '0'
            }}
        >
            {accounts.map(acc => (
                <Chip
                    key={acc._id}
                    shape="block"
                    selected={isSelected(acc)}
                    onClick={() => onPick(acc)}
                    style={{
                        flex: scrolls ? '0 0 auto' : 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                        minWidth: scrolls && !scrollAlways ? '120px' : 'auto',
                        padding: scrollAlways ? '10px 12px' : '12px',
                        fontWeight: '600',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                    }}
                >
                    <AccountIcon icon={acc.icon} type={acc.type} size={18} />
                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{acc.name}</span>
                </Chip>
            ))}
        </div>
    );
}

export default function AddTransactionForm({ type = 'expense', initialData = null, categories: allCategories = [], onAddCategory, onClose, onSubmit, onDelete, accounts = [], presetAccountId = null, transactions = [], categoryCounts, apiFetch }) {
    const defaultAccount = accounts.find(a => a.type === 'cash')?._id || accounts[0]?._id || 'cash';
    const defaultToAccount = accounts.find(a => a.type === 'card' && a._id !== defaultAccount)?._id || accounts.find(a => a._id !== defaultAccount)?._id || '';

    // For a brand-new income/expense transaction, the account must be an
    // explicit user choice - unless a specific account was already active
    // (presetAccountId) when the form was opened. A transfer opened with an
    // account active starts *from* that account, so the only thing left to
    // pick is the destination; with no account active (the "Общий капитал"
    // slide) it falls back to the defaultAccount/defaultToAccount pairing,
    // since an empty account on that flow would break its two from/to
    // selects for no gain.
    const initialAccount = initialData
        ? (initialData.account || defaultAccount)
        : (type === 'transfer' ? (presetAccountId || defaultAccount) : (presetAccountId || ''));

    // Keep the current destination when possible, including when returning
    // from income/expense mode after its account has changed.
    const getTransferDestination = (account, destination) =>
        accounts.some(a => a._id === destination && a._id !== account)
            ? destination
            : (accounts.find(a => a._id !== account)?._id || '');
    const initialToAccount = getTransferDestination(initialAccount, initialData?.toAccount || defaultToAccount);

    const [formData, setFormData] = useState(initialData ? {
        ...initialData,
        __v: Number.isInteger(initialData.__v) ? initialData.__v : 0,
        date: initialData.date || toLocalDateInput(),
        account: initialAccount,
        toAccount: initialToAccount
    } : {
        amount: '',
        category: '',
        description: '',
        ...(type === 'expense' ? { companyName: '', logoMode: 'category' } : {}),
        date: toLocalDateInput(),
        type: type, // 'income', 'expense', or 'transfer'
        account: initialAccount,
        toAccount: initialToAccount,
        excludeFromStats: false
    });

    const [companyLogoChanged, setCompanyLogoChanged] = useState(false);
    const [companyError, setCompanyError] = useState('');

    const isTransfer = formData.type === 'transfer';
    const today = toLocalDateInput();
    const yesterdayDate = new Date();
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterday = toLocalDateInput(yesterdayDate);
    const showYesterday = yesterday >= MIN_DATE;

    // «Другая…»: нативное поле даты открывается по нажатию, а у операции со
    // старой датой видно сразу - иначе дату не увидеть и не поправить.
    const [customDateOpen, setCustomDateOpen] = useState(false);
    const [dateFocusTick, setDateFocusTick] = useState(0);
    const dateInputRef = useRef(null);
    const isCustomDate = formData.date !== today && !(showYesterday && formData.date === yesterday);
    const showDateInput = customDateOpen || isCustomDate;
    const pickDate = (value) => {
        setCustomDateOpen(false);
        setFormData(prev => ({ ...prev, date: value }));
    };
    const openCustomDate = () => {
        setCustomDateOpen(true);
        setDateFocusTick(t => t + 1);
    };
    useEffect(() => {
        if (!dateFocusTick) return;
        const input = dateInputRef.current;
        if (!input) return;
        input.focus();
        try { input.showPicker?.(); } catch { /* пикер доступен не везде */ }
    }, [dateFocusTick]);

    // Split Logic
    const [isSplit, setIsSplit] = useState(false);
    const [splits, setSplits] = useState([{ id: 1, amount: '', category: '' }, { id: 2, amount: '', category: '' }]);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // «Дополнительно»: свёрнуто, если у редактируемой операции там нет ничего
    // нестандартного (исключение из статистики, выбранная иконка)
    const showExcludeToggle = !isTransfer && !isSplit;
    const hasExtra = !isTransfer && (showExcludeToggle || formData.type === 'expense');
    const [showExtra, setShowExtra] = useState(() => Boolean(initialData && (
        initialData.excludeFromStats
        || (initialData.type === 'expense' && !DEFAULT_LOGO_MODES.includes(initialData.logoMode ?? ''))
    )));

    const totalSplitAmount = splits.reduce((sum, split) => sum + (parseFloat(split.amount) || 0), 0);
    const remainingAmount = (parseFloat(formData.amount) || 0) - totalSplitAmount;

    // Копейки float: сравниваем с допуском, а не с нулём
    const isSplitBalanced = Math.abs(remainingAmount) < 0.01;
    // Validation for split: check if split mode is active, remaining amount is approx 0, and all splits have data
    const isSplitValid = isSplit && isSplitBalanced && splits.every(s => s.amount && s.category);

    // Shared save-gate for both the submit button (disabled state) and the
    // submit handler (so the gate can't be bypassed some other way, e.g. an
    // Enter keypress). Transfers require two distinct existing accounts.
    const isSaveDisabled = isSubmitting
        || !(parseFloat(formData.amount) > 0)
        || (!isTransfer && !formData.account)
        || (isTransfer && (formData.account === formData.toAccount
            || !accounts.some(a => a._id === formData.account)
            || !accounts.some(a => a._id === formData.toAccount)))
        || (isSplit ? !isSplitValid : (!isTransfer && !formData.category));

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (isSaveDisabled) return;

        setIsSubmitting(true);
        setCompanyError('');
        try {
            const savedForm = formData.type === 'expense' && formData.companyName?.trim() && (!formData.companyId || companyLogoChanged)
                ? await saveCompanySelection(formData, { request: apiFetch || fetch, logoChanged: companyLogoChanged })
                : formData;
            let submission;
            if (isSplit && splits.length > 0) {
                const splitGroupId = `split_${Date.now()}`;
                const splitTransactions = splits.map(split => ({
                    title: split.category,
                    amount: parseFloat(split.amount),
                    category: split.category,
                    description: (formData.description + (split.description ? ` (${split.description})` : '')).trim(),
                    ...(formData.type === 'expense' ? {
                        logoMode: savedForm.logoMode || 'auto', merchantDomain: savedForm.merchantDomain || '',
                        ...(savedForm.companyName !== undefined ? { companyName: savedForm.companyName, companyId: savedForm.companyId || '' } : {}),
                    } : {}),
                    date: formData.date,
                    type: formData.type,
                    account: formData.account,
                    toAccount: formData.toAccount,
                    splitId: splitGroupId,
                    id: Date.now() + Math.random()
                }));
                submission = onSubmit(splitTransactions);
            } else {
                const submitData = {
                    ...savedForm,
                    amount: parseFloat(formData.amount),
                    category: isTransfer ? 'Перевод' : formData.category,
                    id: initialData ? initialData.id : Date.now()
                };
                // Only include toAccount for transfers to avoid polluting the data
                if (!isTransfer) {
                    delete submitData.toAccount;
                }
                if (formData.type !== 'expense') {
                    delete submitData.logoMode;
                    delete submitData.merchantDomain;
                    delete submitData.companyName;
                    delete submitData.companyId;
                }
                submission = onSubmit(submitData);
            }
            const succeeded = submission && typeof submission.then === 'function'
                ? await submission
                : submission;
            // Existing embedders that do not return a result retain the old
            // close-on-submit contract; App returns false on an API failure
            // so the user's entered values stay available for a retry.
            if (succeeded !== false) onClose();
        } catch (error) {
            setCompanyError(error.message || 'Не удалось сохранить операцию. Попробуйте ещё раз.');
        } finally {
            setIsSubmitting(false);
        }
    };

    // Both rows list every account; picking the one already chosen on the
    // opposite side swaps the sides, so from !== to always holds.
    const setTransferAccount = (side, id) => {
        setFormData(prev => {
            const otherSide = side === 'account' ? 'toAccount' : 'account';
            if (!accounts.some(a => a._id === id)) return prev;
            if (id === prev[otherSide]) return { ...prev, [side]: id, [otherSide]: prev[side] };
            return { ...prev, [side]: id };
        });
    };

    const swapTransferAccounts = () => {
        setFormData({ ...formData, account: formData.toAccount, toAccount: formData.account });
    };

    const categories = (allCategories || []).filter(c => c.type === formData.type);

    // Категорий стало два десятка, и списком в один экран они уже не читаются.
    // Наверх поднимаем то, чем реально пользуются, хвост прячем под "Ещё N" -
    // в свёрнутом виде блок помещается в пару рядов.
    const [showAllCategories, setShowAllCategories] = useState(false);
    // pinned нужен только свёрнутому блоку - удержать выбранную категорию на
    // виду. В раскрытом списке она и так видна, а прикрепление переставило бы
    // чип вверх ровно в момент нажатия, прямо под пальцем.
    const { frequent: frequentCategories, rest: restCategories } = useMemo(
        () => splitCategoriesByUsage(categories, transactions, formData.type, {
            pinned: showAllCategories ? null : formData.category,
            counts: categoryCounts?.[formData.type],
        }),
        [categories, transactions, formData.type, formData.category, showAllCategories, categoryCounts]
    );
    // В разделении своего "Ещё" нет - ряд и так прокручивается, поэтому
    // частые идут первыми, хвост следом
    const { frequent: splitFrequent, rest: splitRest } = useMemo(
        () => splitCategoriesByUsage(categories, transactions, formData.type, {
            counts: categoryCounts?.[formData.type],
        }),
        [categories, transactions, formData.type, categoryCounts]
    );
    const splitCategories = [...splitFrequent, ...splitRest];
    const visibleCategories = showAllCategories ? [...frequentCategories, ...restCategories] : frequentCategories;

    // Подсказки для поля комментария: то, что уже писалось для выбранной
    // категории. В режиме разделения одно описание относится сразу к
    // нескольким категориям, поэтому подсказывать там нечего.
    const suggestionCategory = isSplit ? null : (isTransfer ? 'Перевод' : formData.category);
    const localDescriptionSuggestions = useMemo(
        () => getDescriptionSuggestions(transactions, suggestionCategory, formData.type),
        [transactions, suggestionCategory, formData.type]
    );

    const [remoteSuggestions, setRemoteSuggestions] = useState(null);
    const suggestionKey = `${formData.type}:${suggestionCategory}`;
    useEffect(() => {
        if (!apiFetch || !suggestionCategory) return;
        let current = true;
        const controller = new AbortController();
        const params = new URLSearchParams({ category: suggestionCategory, type: formData.type });
        apiFetch(`/api/suggestions/descriptions?${params}`, { signal: controller.signal })
            .then(async response => {
                if (!response.ok) throw new Error();
                const values = await response.json();
                if (current && Array.isArray(values) && values.every(value => typeof value === 'string')) setRemoteSuggestions({ key: suggestionKey, values });
            }).catch(() => {});
        return () => { current = false; controller.abort(); };
    }, [apiFetch, suggestionCategory, suggestionKey, formData.type]);
    const descriptionSuggestions = apiFetch
        ? (remoteSuggestions?.key === suggestionKey ? remoteSuggestions.values : EMPTY_SUGGESTIONS)
        : localDescriptionSuggestions;

    // Пока поле пустое - показываем весь топ; как только пользователь начал
    // печатать, подсказки сужаются до подходящих, а точное совпадение
    // (уже выбранная подсказка) убирается - нажимать на него нечего.
    const visibleSuggestions = useMemo(() => {
        const typed = (formData.description || '').trim().toLowerCase();
        if (!typed) return descriptionSuggestions;
        return descriptionSuggestions.filter(s => {
            const lower = s.toLowerCase();
            return lower !== typed && lower.includes(typed);
        });
    }, [descriptionSuggestions, formData.description]);

    // New category inline creation
    const [isAddingCategory, setIsAddingCategory] = useState(false);
    const [newCategoryName, setNewCategoryName] = useState('');
    const [categoryError, setCategoryError] = useState('');
    const [isCreatingCategory, setIsCreatingCategory] = useState(false);

    const getTitle = () => {
        if (initialData) return 'Редактировать';
        if (isTransfer) return 'Перевод';
        return formData.type === 'income' ? 'Новый доход' : 'Новый расход';
    };

    // Do not let backdrop/close-button/Escape destroy the entered values
    // while the request is still in flight. Once a failed request settles,
    // the form becomes closable again and remains filled for a retry.
    const requestClose = () => {
        if (!isSubmitting) onClose();
    };

    const addSplit = () => {
        setSplits([...splits, { id: Date.now(), amount: '', category: '' }]);
    };

    const removeSplit = (id) => {
        if (splits.length > 2) {
            setSplits(splits.filter(s => s.id !== id));
        }
    };

    const updateSplit = (id, field, value) => {
        setSplits(splits.map(s => s.id === id ? { ...s, [field]: value } : s));
    };

    const handleCreateCategory = async () => {
        const trimmed = newCategoryName.trim();
        if (!trimmed || !onAddCategory || isCreatingCategory) return;
        setCategoryError('');
        setIsCreatingCategory(true);
        try {
            const result = await onAddCategory(trimmed, formData.type);
            if (result?.error) {
                setCategoryError(result.error);
                return;
            }
            if (result) {
                setFormData({ ...formData, category: trimmed });
                setNewCategoryName('');
                setIsAddingCategory(false);
                // Свежесозданная категория лежит в хвосте (частота нулевая), а
                // прятать её сразу после создания нельзя - раскрываем список.
                setShowAllCategories(true);
            }
        } catch {
            setCategoryError('Не удалось создать категорию');
        } finally {
            setIsCreatingCategory(false);
        }
    };


    return (
        <Sheet ariaLabel={getTitle()} onClose={requestClose}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ margin: 0 }}>{getTitle()}</h3>
                    <button
                        type="button"
                        aria-label="Закрыть"
                        onClick={requestClose}
                        style={{
                            background: 'transparent',
                            color: 'var(--color-text-muted)',
                            fontSize: '1.5rem',
                            lineHeight: 1
                        }}
                    ><X size={22} strokeWidth={1.8} aria-hidden="true" /></button>
                </div>

                {/* Type Toggle - Hide if splitting or editing */}
                {!initialData && !isSplit && (
                    <div style={{
                        display: 'flex',
                        background: 'var(--color-surface-inset)',
                        padding: '4px',
                        borderRadius: 'var(--radius-md)'
                    }}>
                        {[
                            { id: 'expense', label: 'Расход' },
                            { id: 'income', label: 'Доход' },
                            ...(accounts.length >= 2 ? [{ id: 'transfer', label: 'Перевод' }] : [])
                        ].map(t => (
                            <button
                                key={t.id}
                                onClick={() => setFormData(prev => {
                                    if (t.id !== 'transfer') return { ...prev, type: t.id };
                                    const account = prev.account || defaultAccount;
                                    return {
                                        ...prev,
                                        type: t.id,
                                        account,
                                        toAccount: getTransferDestination(account, prev.toAccount)
                                    };
                                })}
                                style={{
                                    flex: 1,
                                    padding: '8px',
                                    borderRadius: 'var(--radius-sm)',
                                    background: formData.type === t.id ? 'var(--color-surface)' : 'transparent',
                                    color: formData.type === t.id ? 'var(--color-primary)' : 'var(--color-text-muted)',
                                    fontWeight: '600',
                                    fontSize: 'var(--text-md)',
                                    transition: 'all 0.2s',
                                    boxShadow: formData.type === t.id ? '0 2px 4px rgba(0,0,0,0.05)' : 'none'
                                }}
                            >
                                {t.label}
                            </button>
                        ))}
                    </div>
                )}

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

                    {/* Main Amount Input */}
                    <div>
                        <label style={labelStyle}>
                            {isSplit ? 'Общая сумма' : 'Сумма'}
                        </label>
                        <div style={{ position: 'relative' }}>
                            <span style={{
                                position: 'absolute',
                                left: '16px',
                                top: '50%',
                                transform: 'translateY(-50%)',
                                color: 'var(--color-text-muted)',
                                fontSize: 'var(--text-3xl)'
                            }}>€</span>
                            <Field
                                type="number"
                                tone="sunken"
                                size="xl"
                                inputMode="decimal"
                                step="0.01"
                                placeholder="0.00"
                                value={formData.amount}
                                onChange={e => setFormData({ ...formData, amount: e.target.value })}
                                style={{
                                    width: '100%',
                                    // слева оставлено место под знак валюты,
                                    // который лежит поверх поля
                                    padding: '16px 16px 16px 36px',
                                    fontSize: '1.5rem',
                                    fontWeight: 'bold',
                                }}
                            />
                        </div>
                    </div>

                    {!isTransfer && (
                        <>
                            {/* Split Toggle */}
                            {!initialData && formData.amount && parseFloat(formData.amount) > 0 && (
                                <div
                                    onClick={() => setIsSplit(!isSplit)}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '12px',
                                        padding: '12px',
                                        background: 'var(--color-surface-sunken)',
                                        borderRadius: 'var(--radius-md)',
                                        cursor: 'pointer',
                                        border: '1px solid var(--color-border-subtle)',
                                        transition: 'all 0.2s'
                                    }}
                                >
                                    <div style={{
                                        width: '40px',
                                        height: '20px',
                                        background: isSplit ? 'var(--color-primary)' : 'var(--color-control-off)',
                                        borderRadius: 'var(--radius-pill)',
                                        position: 'relative',
                                        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
                                    }}>
                                        <div style={{
                                            position: 'absolute',
                                            top: '2px',
                                            left: isSplit ? '22px' : '2px',
                                            width: '16px',
                                            height: '16px',
                                            background: 'var(--color-surface)',
                                            borderRadius: '50%',
                                            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                                            boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
                                        }} />
                                    </div>
                                    <span style={{ fontSize: 'var(--text-md)', fontWeight: '500', color: isSplit ? 'var(--color-text-main)' : 'var(--color-text-muted)' }}>
                                        Разделить на несколько категорий
                                    </span>
                                </div>
                            )}

                            {!isSplit ? (
                                /* Category Selection */
                                <div>
                                    <label style={labelStyle}>Категория</label>
                                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                        {visibleCategories.map(cat => (
                                            <Chip
                                                key={cat._id}
                                                selected={formData.category === cat.name}
                                                onClick={() => setFormData({ ...formData, category: cat.name })}
                                                style={{ padding: '8px 16px' }}
                                            >
                                                {cat.name}
                                            </Chip>
                                        ))}

                                        {restCategories.length > 0 && (
                                            <button
                                                type="button"
                                                onClick={() => setShowAllCategories(!showAllCategories)}
                                                aria-expanded={showAllCategories}
                                                style={{
                                                    padding: '8px 16px',
                                                    borderRadius: 'var(--radius-pill)',
                                                    border: '1px dashed var(--color-border-strong)',
                                                    background: 'transparent',
                                                    color: 'var(--color-primary)',
                                                    fontSize: 'var(--text-base)',
                                                    fontWeight: '600',
                                                    cursor: 'pointer',
                                                    transition: 'all 0.2s'
                                                }}
                                            >
                                                {showAllCategories ? 'Свернуть' : `Ещё ${restCategories.length}`}
                                            </button>
                                        )}

                                        {/* Новая категория - последний чип ряда; пока
                                            идёт ввод имени, его место занимает поле ниже */}
                                        {!isAddingCategory && (
                                            <button
                                                type="button"
                                                onClick={() => setIsAddingCategory(true)}
                                                style={{
                                                    padding: '8px 16px',
                                                    borderRadius: 'var(--radius-pill)',
                                                    border: '1px dashed rgba(37, 99, 235, 0.3)',
                                                    background: 'transparent',
                                                    color: 'var(--color-primary)',
                                                    fontSize: 'var(--text-base)',
                                                    fontWeight: '500',
                                                    cursor: 'pointer',
                                                    transition: 'all 0.2s'
                                                }}
                                            >
                                                <Plus size={16} strokeWidth={1.8} aria-hidden="true" /> Новая
                                            </button>
                                        )}
                                    </div>

                                    {isAddingCategory && (
                                        <div style={{ marginTop: '10px' }}>
                                            <div style={{ display: 'flex', gap: '8px' }}>
                                              <Field
                                                type="text"
                                                tone="muted"
                                                radius="var(--radius-pill)"
                                                placeholder="Название..."
                                                value={newCategoryName}
                                                onChange={e => {
                                                    setNewCategoryName(e.target.value);
                                                    if (categoryError) setCategoryError('');
                                                }}
                                                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleCreateCategory(); } }}
                                                autoFocus
                                                style={{
                                                    flex: 1,
                                                    minWidth: 0,
                                                    padding: '8px 12px',
                                                    // поле-чип рядом с чипами категорий: рамка
                                                    // фирменная, а не нейтральная
                                                    border: '1px solid rgba(37, 99, 235, 0.3)',
                                                }}
                                              />
                                            <button
                                                type="button"
                                                aria-label="Сохранить категорию"
                                                aria-busy={isCreatingCategory}
                                                onClick={handleCreateCategory}
                                                disabled={!newCategoryName.trim() || isCreatingCategory}
                                                style={{
                                                    padding: '8px 14px',
                                                    borderRadius: 'var(--radius-pill)',
                                                    border: 'none',
                                                    background: newCategoryName.trim() ? 'var(--color-primary)' : 'var(--color-surface-inset)',
                                                    color: newCategoryName.trim() ? 'var(--color-text-inverse)' : 'var(--color-text-muted)',
                                                    fontSize: 'var(--text-base)',
                                                    fontWeight: '600',
                                                    cursor: newCategoryName.trim() ? 'pointer' : 'default'
                                                }}
                                            >{isCreatingCategory ? <LoaderCircle size={18} strokeWidth={1.8} aria-hidden="true" /> : <Check size={18} strokeWidth={1.8} aria-hidden="true" />}</button>
                                            <button
                                                type="button"
                                                aria-label="Отменить создание категории"
                                                onClick={() => { setIsAddingCategory(false); setNewCategoryName(''); setCategoryError(''); }}
                                                style={{
                                                    padding: '8px 14px',
                                                    borderRadius: 'var(--radius-pill)',
                                                    border: '1px solid var(--color-border)',
                                                    background: 'var(--color-surface)',
                                                    color: 'var(--color-text-muted)',
                                                    fontSize: 'var(--text-base)',
                                                    cursor: 'pointer'
                                                }}
                                            ><X size={18} strokeWidth={1.8} aria-hidden="true" /></button>
                                            </div>
                                            {categoryError && (
                                                <div role="alert" style={{ color: 'var(--color-negative)', fontSize: 'var(--text-sm)', marginTop: '6px' }}>
                                                    {categoryError}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ) : (
                                /* Split UI */
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', background: 'var(--color-surface-muted)', padding: '16px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border-subtle)' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-md)' }}>
                                        <span>Осталось распределить:</span>
                                        <span style={{ color: isSplitBalanced ? 'var(--color-positive)' : ((remainingAmount < 0) ? 'var(--color-negative)' : 'var(--color-warning)'), fontWeight: 'bold' }}>
                                            €{(isSplitBalanced ? 0 : remainingAmount).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </span>
                                    </div>

                                    {splits.map((split, index) => (
                                        <div key={split.id} style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingBottom: '16px', borderBottom: '1px solid var(--color-border-subtle)' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <span style={{ fontSize: 'var(--text-base)', color: 'var(--color-text-muted)' }}>Категория {index + 1}</span>
                                                {splits.length > 2 && (
                                                    <button type="button" aria-label={`Удалить часть ${index + 1}`} onClick={() => removeSplit(split.id)} style={{ color: 'var(--color-negative)', background: 'transparent', fontSize: 'var(--text-2xl)' }}><X size={20} strokeWidth={1.8} aria-hidden="true" /></button>
                                                )}
                                            </div>

                                            {/* Category Scroll */}
                                            <div
                                                className="no-scrollbar"
                                                style={{
                                                    display: 'flex',
                                                    gap: '8px',
                                                    overflowX: 'auto',
                                                    paddingBottom: '4px',
                                                }}
                                            >
                                                {splitCategories.map(cat => {
                                                    const isSelectedInOtherSplit = splits.some(s => s.id !== split.id && s.category === cat.name);
                                                    if (isSelectedInOtherSplit) return null;

                                                    return (
                                                        <Chip
                                                            key={cat._id}
                                                            selected={split.category === cat.name}
                                                            onClick={() => updateSplit(split.id, 'category', cat.name)}
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
                                                    value={split.amount}
                                                    onChange={e => updateSplit(split.id, 'amount', e.target.value)}
                                                    style={{ flex: 1, padding: '10px' }}
                                                />
                                            </div>
                                        </div>
                                    ))}

                                    <button
                                        type="button"
                                        onClick={addSplit}
                                        style={{ width: '100%', padding: '10px', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', color: 'var(--color-text-muted)', border: '1px dashed var(--color-border-strong)', fontWeight: '500' }}
                                    >
                                        <Plus size={18} strokeWidth={1.8} aria-hidden="true" /> Добавить категорию
                                    </button>
                                </div>
                            )}

                            {/* Account Selector (общий и для обычного режима, и для разделения) */}
                            <div>
                                <label style={labelStyle}>
                                    {formData.type === 'expense' ? 'Списать с' : 'Зачислить на'}
                                </label>
                                <AccountChips
                                    accounts={accounts}
                                    isSelected={acc => formData.account === acc._id}
                                    onPick={acc => setFormData({ ...formData, account: acc._id })}
                                />
                            </div>
                        </>
                    )}

                    {isTransfer && (
                        /* Transfer direction. Each side is its own row of
                           account chips (the same ones income/expense use)
                           instead of a native select: every account is one
                           tap away and long names stay readable. Each row
                           carries its own colour-coded arrow badge, and the
                           swap button on the divider reverses the direction
                           in one tap. */
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            <div style={{
                                position: 'relative',
                                background: 'var(--color-surface-muted)',
                                border: '1px solid var(--color-border)',
                                borderRadius: 'var(--radius-lg)'
                            }}>
                                {[
                                    { side: 'account', label: 'Откуда', value: formData.account, accent: 'var(--color-negative)', icon: ArrowUpRight },
                                    { side: 'toAccount', label: 'Куда', value: formData.toAccount, accent: 'var(--color-positive)', icon: ArrowDownLeft }
                                ].map((row, index) => (
                                    <div
                                        key={row.side}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '12px',
                                            padding: '12px 14px',
                                            // Room for the swap button so the chips
                                            // never run under it.
                                            paddingRight: '62px',
                                            borderTop: index === 0 ? 'none' : '1px solid var(--color-border)'
                                        }}
                                    >
                                        <div style={{
                                            width: '30px',
                                            height: '30px',
                                            flexShrink: 0,
                                            borderRadius: '50%',
                                            background: `${row.accent}1a`,
                                            color: row.accent,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            fontWeight: '700',
                                            fontSize: 'var(--text-xl)'
                                        }}>
                                            <row.icon size={20} strokeWidth={1.8} aria-hidden="true" />
                                        </div>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div
                                                style={{
                                                    color: 'var(--color-text-muted)',
                                                    fontSize: 'var(--text-2xs)',
                                                    fontWeight: '600',
                                                    letterSpacing: '0.6px',
                                                    textTransform: 'uppercase',
                                                    marginBottom: '6px'
                                                }}
                                            >
                                                {row.label}
                                            </div>
                                            <AccountChips
                                                role="group"
                                                aria-label={row.label}
                                                accounts={accounts}
                                                scrollAlways
                                                isSelected={acc => row.value === acc._id}
                                                onPick={acc => setTransferAccount(row.side, acc._id)}
                                            />
                                        </div>
                                    </div>
                                ))}
                                <IconButton
                                    round
                                    size={38}
                                    onClick={swapTransferAccounts}
                                    aria-label="Поменять счета местами"
                                    style={{
                                        position: 'absolute',
                                        top: '50%',
                                        right: '14px',
                                        transform: 'translateY(-50%)',
                                        // приподнята над строками счетов, между
                                        // которыми лежит - отсюда своя подложка,
                                        // рамка и тень вместо тона
                                        background: 'var(--color-surface)',
                                        border: '1px solid var(--color-border)',
                                        color: 'var(--color-primary)',
                                        fontSize: 'var(--text-2xl)',
                                        lineHeight: 1,
                                        boxShadow: '0 1px 4px rgba(0,0,0,0.08)'
                                    }}
                                >
                                    <ArrowDownUp size={20} strokeWidth={1.8} aria-hidden="true" />
                                </IconButton>
                            </div>
                            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', textAlign: 'center', margin: 0 }}>
                                Общий баланс не изменится
                            </p>
                        </div>
                    )}

                    {/* Date: быстрые чипы вместо крупного поля - почти всегда
                        нужна сегодняшняя или вчерашняя дата */}
                    <div>
                        <label htmlFor="transaction-date" style={labelStyle}>Дата</label>
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                            <Chip
                                selected={!showDateInput && formData.date === today}
                                onClick={() => pickDate(today)}
                                style={{ padding: '8px 16px' }}
                            >
                                Сегодня
                            </Chip>
                            {showYesterday && (
                                <Chip
                                    selected={!showDateInput && formData.date === yesterday}
                                    onClick={() => pickDate(yesterday)}
                                    style={{ padding: '8px 16px' }}
                                >
                                    Вчера
                                </Chip>
                            )}
                            <Chip
                                selected={showDateInput}
                                onClick={openCustomDate}
                                style={{ padding: '8px 16px' }}
                            >
                                {showDateInput && formData.date ? formatShortDate(formData.date) : 'Другая…'}
                            </Chip>
                        </div>
                        {showDateInput && (
                            <Field
                                id="transaction-date"
                                ref={dateInputRef}
                                type="date"
                                tone="sunken"
                                value={formData.date}
                                min={MIN_DATE}
                                max={today}
                                onChange={e => setFormData({ ...formData, date: e.target.value })}
                                style={{
                                    width: '100%',
                                    display: 'block',
                                    margin: '10px 0 0',
                                    // родное оформление поля даты в iOS/Safari
                                    // сбивается только этими четырьмя строками
                                    fontFamily: 'inherit',
                                    colorScheme: 'light',
                                    WebkitAppearance: 'none',
                                    appearance: 'none'
                                }}
                            />
                        )}
                    </div>

                    {formData.type === 'expense' && (
                        <CompanyField item={formData} transactions={transactions} apiFetch={apiFetch} onChange={choice => {
                            setCompanyLogoChanged(false);
                            setCompanyError('');
                            setFormData(prev => ({ ...prev, ...choice }));
                        }} />
                    )}

                    {/* Description */}
                    <div>
                        <label style={labelStyle}>Описание (опц.)</label>
                        <Field
                            type="text"
                            tone="sunken"
                            placeholder="Комментарий..."
                            value={formData.description}
                            onChange={e => setFormData({ ...formData, description: e.target.value })}
                            style={{ width: '100%' }}
                        />
                        {visibleSuggestions.length > 0 && (
                            <div
                                className="no-scrollbar"
                                style={{
                                    display: 'flex',
                                    gap: '8px',
                                    marginTop: '10px',
                                    // Одна строка с горизонтальной прокруткой:
                                    // перенос подсказок в несколько рядов
                                    // сдвигал бы кнопку сохранения вниз при
                                    // каждой смене категории.
                                    overflowX: 'auto',
                                    paddingBottom: '2px'
                                }}
                            >
                                {visibleSuggestions.map(suggestion => (
                                    <button
                                        key={suggestion}
                                        type="button"
                                        onClick={() => setFormData({ ...formData, description: suggestion })}
                                        style={{
                                            flex: '0 0 auto',
                                            maxWidth: '100%',
                                            padding: '6px 12px',
                                            borderRadius: 'var(--radius-lg)',
                                            border: '1px solid var(--color-border)',
                                            background: 'var(--color-surface)',
                                            color: 'var(--color-text-muted)',
                                            fontSize: 'var(--text-sm)',
                                            whiteSpace: 'nowrap',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            cursor: 'pointer'
                                        }}
                                    >
                                        {suggestion}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Дополнительно: редко нужные настройки спрятаны, чтобы
                        форма не вырастала на два экрана */}
                    {hasExtra && (
                        <div>
                            <button
                                type="button"
                                aria-expanded={showExtra}
                                aria-controls="transaction-extra"
                                onClick={() => setShowExtra(v => !v)}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    padding: '4px 0',
                                    background: 'transparent',
                                    color: 'var(--color-text-muted)',
                                    fontSize: 'var(--text-base)',
                                    fontWeight: '600',
                                    cursor: 'pointer'
                                }}
                            >
                                <ChevronDown
                                    size={18}
                                    strokeWidth={1.8}
                                    aria-hidden="true"
                                    style={{ transition: 'transform 0.2s', transform: showExtra ? 'rotate(180deg)' : 'none' }}
                                />
                                Дополнительно
                                {/* включённая настройка не должна быть невидимой */}
                                {!showExtra && showExcludeToggle && formData.excludeFromStats && (
                                    <span style={{ fontWeight: '400' }}>· не в статистике</span>
                                )}
                            </button>
                            {showExtra && (
                                <div id="transaction-extra" style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginTop: '12px' }}>
                                    {/* Exclude from stats toggle */}
                                    {showExcludeToggle && (
                                        <div
                                            onClick={() => setFormData({ ...formData, excludeFromStats: !formData.excludeFromStats })}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'space-between',
                                                padding: '10px 14px',
                                                borderRadius: 'var(--radius-md)',
                                                border: '1px solid',
                                                borderColor: formData.excludeFromStats ? 'rgba(239, 68, 68, 0.3)' : 'var(--color-border)',
                                                background: formData.excludeFromStats ? 'rgba(239, 68, 68, 0.03)' : 'var(--color-surface)',
                                                cursor: 'pointer',
                                                transition: 'all 0.2s',
                                                userSelect: 'none'
                                            }}
                                        >
                                            <span style={{ fontSize: 'var(--text-base)', color: formData.excludeFromStats ? 'var(--color-negative)' : 'var(--color-text-muted)' }}>
                                                Не считать в статистике
                                            </span>
                                            <div style={{
                                                width: '40px',
                                                height: '22px',
                                                borderRadius: 'var(--radius-pill)',
                                                background: formData.excludeFromStats ? 'var(--color-negative)' : 'var(--color-control-off)',
                                                position: 'relative',
                                                transition: 'background 0.2s'
                                            }}>
                                                <div style={{
                                                    width: '18px',
                                                    height: '18px',
                                                    borderRadius: '50%',
                                                    background: 'var(--color-surface)',
                                                    position: 'absolute',
                                                    top: '2px',
                                                    left: formData.excludeFromStats ? '20px' : '2px',
                                                    transition: 'left 0.2s',
                                                    boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
                                                }} />
                                            </div>
                                        </div>
                                    )}

                                    {formData.type === 'expense' && (
                                        <TransactionLogoPicker
                                            item={formData}
                                            canChoose={formData.companyName === undefined || Boolean(formData.companyName.trim())}
                                            apiFetch={apiFetch}
                                            onChange={choice => { setCompanyLogoChanged(true); setFormData(prev => ({ ...prev, ...choice })); }}
                                            onMerchantSelect={merchant => { setCompanyLogoChanged(true); setFormData(prev => ({ ...prev, companyId: '', companyName: merchant.name, logoMode: 'domain', merchantDomain: merchant.domain })); }}
                                        />
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                    {companyError && <p role="alert" style={{ color: 'var(--color-danger)', fontSize: 'var(--text-sm)', margin: 0 }}>{companyError}</p>}

                    {/* Футер прилипает к низу листа, пока форма прокручивается.
                        Лист даёт нижний отступ 24px + safe-area, поэтому bottom
                        компенсирует его, а paddingBottom возвращает воздух. */}
                    <div style={{
                        position: 'sticky',
                        bottom: 'calc(-24px - env(safe-area-inset-bottom, 0px))',
                        zIndex: 1,
                        display: 'flex',
                        gap: '12px',
                        padding: '12px 0 calc(12px + env(safe-area-inset-bottom, 0px))',
                        background: 'var(--color-surface)',
                        boxShadow: '0 -1px 0 var(--color-border-subtle), 0 -8px 12px -6px rgba(0,0,0,0.06)'
                    }}>
                        {initialData && (
                            <button
                                type="button"
                                aria-label="Удалить операцию"
                                disabled={isSubmitting}
                                onClick={async () => {
                                    if (isSubmitting) return;
                                    // Без confirm: App переносит запись в корзину
                                    // и показывает тост «Отменить»
                                    setIsSubmitting(true);
                                    try {
                                        const deletion = onDelete(initialData.id);
                                        const succeeded = deletion && typeof deletion.then === 'function'
                                            ? await deletion
                                            : deletion;
                                        if (succeeded !== false) onClose();
                                    } finally {
                                        setIsSubmitting(false);
                                    }
                                }}
                                style={{
                                    padding: '16px',
                                    borderRadius: 'var(--radius-md)',
                                    background: 'var(--color-surface)',
                                    color: 'var(--color-negative)',
                                    fontWeight: '700',
                                    border: '1px solid rgba(239, 68, 68, 0.2)',
                                    fontSize: 'var(--text-3xl)',
                                    lineHeight: 1,
                                    boxShadow: '0 2px 4px rgba(239, 68, 68, 0.05)'
                                }}
                            >
                                <Trash2 size={22} strokeWidth={1.8} aria-hidden="true" />
                            </button>
                        )}
                        <button
                            type="submit"
                            className="btn-primary"
                            disabled={isSaveDisabled}
                            style={{
                                flex: 1,
                                padding: '16px',
                                fontSize: 'var(--text-2xl)',
                                opacity: isSaveDisabled ? 0.5 : 1,
                                cursor: isSaveDisabled ? 'not-allowed' : 'pointer'
                            }}
                        >
                            {isSubmitting ? 'Сохранение...' : 'Сохранить'}
                        </button>
                    </div>
                </form>
            <style>{`
        @keyframes scaleIn {
          from { transform: scale(0.9); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
        .no-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .no-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
        </Sheet>
    );
}
