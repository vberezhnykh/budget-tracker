import { useState, useMemo } from 'react';
import Field from './ui/Field'
import Chip from './ui/Chip'
import Sheet from './ui/Sheet'
import IconButton from './ui/IconButton'
import { getDescriptionSuggestions, splitCategoriesByUsage } from '../utils/finance';

export default function AddTransactionForm({ type = 'expense', initialData = null, categories: allCategories = [], onAddCategory, onClose, onSubmit, onDelete, accounts = [], presetAccountId = null, transactions = [] }) {
    const defaultAccount = accounts.find(a => a.type === 'cash')?._id || accounts[0]?._id || 'cash';
    const defaultToAccount = accounts.find(a => a.type === 'card' && a._id !== defaultAccount)?._id || accounts.find(a => a._id !== defaultAccount)?._id || 'card';

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

    // The two transfer sides can never point at the same account (see
    // setTransferAccount below), so a preset "from" that happens to be the
    // usual destination pushes "to" onto the first other account.
    const initialToAccount = defaultToAccount !== initialAccount
        ? defaultToAccount
        : (accounts.find(a => a._id !== initialAccount)?._id || defaultToAccount);

    const [formData, setFormData] = useState(initialData ? {
        ...initialData,
        __v: Number.isInteger(initialData.__v) ? initialData.__v : 0,
        date: initialData.date || new Date().toISOString().split('T')[0],
        account: initialAccount,
        toAccount: initialData.toAccount || (initialData.account === defaultToAccount ? defaultAccount : defaultToAccount)
    } : {
        amount: '',
        category: '',
        description: '',
        date: new Date().toISOString().split('T')[0],
        type: type, // 'income', 'expense', or 'transfer'
        account: initialAccount,
        toAccount: initialToAccount,
        excludeFromStats: false
    });

    const isTransfer = formData.type === 'transfer';
    const today = new Date().toISOString().split('T')[0];

    // Split Logic
    const [isSplit, setIsSplit] = useState(false);
    const [splits, setSplits] = useState([{ id: 1, amount: '', category: '' }, { id: 2, amount: '', category: '' }]);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const totalSplitAmount = splits.reduce((sum, split) => sum + (parseFloat(split.amount) || 0), 0);
    const remainingAmount = (parseFloat(formData.amount) || 0) - totalSplitAmount;

    // Validation for split: check if split mode is active, remaining amount is approx 0, and all splits have data
    const isSplitValid = isSplit && Math.abs(remainingAmount) < 0.01 && splits.every(s => s.amount && s.category);

    // Shared save-gate for both the submit button (disabled state) and the
    // submit handler (so the gate can't be bypassed some other way, e.g. an
    // Enter keypress). An account must be chosen unless transferring - that
    // flow has its own from/to selects and always starts pre-filled.
    const isSaveDisabled = isSubmitting
        || !(parseFloat(formData.amount) > 0)
        || (!isTransfer && !formData.account)
        || (isSplit ? !isSplitValid : (!isTransfer && !formData.category));

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (isSaveDisabled) return;

        setIsSubmitting(true);
        try {
            let submission;
            if (isSplit && splits.length > 0) {
                const splitGroupId = `split_${Date.now()}`;
                const splitTransactions = splits.map(split => ({
                    title: split.category,
                    amount: parseFloat(split.amount),
                    category: split.category,
                    description: (formData.description + (split.description ? ` (${split.description})` : '')).trim(),
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
                    ...formData,
                    amount: parseFloat(formData.amount),
                    category: isTransfer ? 'Перевод' : formData.category,
                    id: initialData ? initialData.id : Date.now()
                };
                // Only include toAccount for transfers to avoid polluting the data
                if (!isTransfer) {
                    delete submitData.toAccount;
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
        } finally {
            setIsSubmitting(false);
        }
    };

    // Both transfer selects go through here so the two sides can never point
    // at the same account: picking an account that is already on the other
    // side pushes that side to the first different account available.
    const setTransferAccount = (side, id) => {
        const otherSide = side === 'account' ? 'toAccount' : 'account';
        const other = formData[otherSide] === id
            ? (accounts.find(a => a._id !== id)?._id || '')
            : formData[otherSide];
        setFormData({ ...formData, [side]: id, [otherSide]: other });
    };

    const swapTransferAccounts = () => {
        setFormData({ ...formData, account: formData.toAccount, toAccount: formData.account });
    };

    const getAccountLabel = (acc) => `${acc.icon || (acc.type === 'cash' ? '💵' : '💳')} ${acc.name}`;

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
        }),
        [categories, transactions, formData.type, formData.category, showAllCategories]
    );
    const visibleCategories = showAllCategories ? [...frequentCategories, ...restCategories] : frequentCategories;

    // Подсказки для поля комментария: то, что уже писалось для выбранной
    // категории. В режиме разделения одно описание относится сразу к
    // нескольким категориям, поэтому подсказывать там нечего.
    const suggestionCategory = isSplit ? null : (isTransfer ? 'Перевод' : formData.category);
    const descriptionSuggestions = useMemo(
        () => getDescriptionSuggestions(transactions, suggestionCategory, formData.type),
        [transactions, suggestionCategory, formData.type]
    );

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
                        onClick={requestClose}
                        style={{
                            background: 'transparent',
                            color: 'var(--color-text-muted)',
                            fontSize: '1.5rem',
                            lineHeight: 1
                        }}
                    >×</button>
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
                                // Switching into a transfer while no account has
                                // been chosen yet (a new expense/income opened
                                // from the "Общий капитал" slide starts with an
                                // empty account) would leave "Откуда" pointing at
                                // nothing while the select displays its first
                                // option - and the save gate doesn't require an
                                // account on transfers. Fall back to the default
                                // pairing so both sides are always real.
                                onClick={() => setFormData(prev => {
                                    if (t.id !== 'transfer' || prev.account) return { ...prev, type: t.id };
                                    const account = defaultAccount;
                                    return {
                                        ...prev,
                                        type: t.id,
                                        account,
                                        toAccount: prev.toAccount !== account
                                            ? prev.toAccount
                                            : (accounts.find(a => a._id !== account)?._id || prev.toAccount)
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
                        <label style={{ display: 'block', color: 'var(--color-text-muted)', marginBottom: '8px', fontSize: 'var(--text-base)' }}>
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
                                        background: isSplit ? 'var(--color-primary)' : 'rgba(255,255,255,0.2)',
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
                                    <span style={{ fontSize: 'var(--text-md)', fontWeight: '500', color: isSplit ? 'var(--color-text-inverse)' : 'var(--color-text-muted)' }}>
                                        Разделить на несколько категорий
                                    </span>
                                </div>
                            )}

                            {!isSplit ? (
                                <>
                                    {/* Account Selector */}
                                    <div>
                                        <label style={{ display: 'block', color: 'var(--color-text-muted)', marginBottom: '8px', fontSize: 'var(--text-base)' }}>
                                            {formData.type === 'expense' ? 'Списать с' : 'Зачислить на'}
                                        </label>
                                        <div style={{ 
                                            display: 'flex', 
                                            gap: '12px', 
                                            overflowX: accounts.length > 3 ? 'auto' : 'visible',
                                            paddingBottom: accounts.length > 3 ? '8px' : '0'
                                        }}>
                                            {accounts.map(acc => (
                                                <Chip
                                                    key={acc._id}
                                                    shape="block"
                                                    selected={formData.account === acc._id}
                                                    onClick={() => setFormData({ ...formData, account: acc._id })}
                                                    style={{
                                                        flex: accounts.length > 3 ? '0 0 auto' : 1,
                                                        minWidth: accounts.length > 3 ? '120px' : 'auto',
                                                        padding: '12px',
                                                        fontWeight: '600',
                                                        whiteSpace: 'nowrap',
                                                        overflow: 'hidden',
                                                        textOverflow: 'ellipsis'
                                                    }}
                                                >
                                                    {acc.icon || (acc.type === 'cash' ? '💵' : '💳')} {acc.name}
                                                </Chip>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Category Selection */}
                                    <div>
                                        <label style={{ display: 'block', color: 'var(--color-text-muted)', marginBottom: '8px', fontSize: 'var(--text-base)' }}>Категория</label>
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
                                        </div>
                                    </div>

                                    {/* Exclude from stats toggle */}
                                    {!isTransfer && (
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

                                    {/* Add New Category */}
                                    {isAddingCategory ? (
                                        <div style={{ marginTop: '4px' }}>
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
                                                    padding: '8px 12px',
                                                    // поле-чип рядом с чипами категорий: рамка
                                                    // фирменная, а не нейтральная
                                                    border: '1px solid rgba(37, 99, 235, 0.3)',
                                                }}
                                              />
                                            <button
                                                type="button"
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
                                            >{isCreatingCategory ? '…' : '✓'}</button>
                                            <button
                                                type="button"
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
                                            >×</button>
                                            </div>
                                            {categoryError && (
                                                <div role="alert" style={{ color: 'var(--color-negative)', fontSize: 'var(--text-sm)', marginTop: '6px' }}>
                                                    {categoryError}
                                                </div>
                                            )}
                                        </div>
                                    ) : (
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
                                            + Новая
                                        </button>
                                    )}
                                </>
                            ) : (
                                /* Split UI */
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', background: 'var(--color-surface-muted)', padding: '16px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border-subtle)' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-md)' }}>
                                        <span>Осталось распределить:</span>
                                        <span style={{ color: remainingAmount === 0 ? '#4ade80' : ((remainingAmount < 0) ? 'var(--color-negative)' : 'var(--color-warning)'), fontWeight: 'bold' }}>
                                            €{remainingAmount.toFixed(2)}
                                        </span>
                                    </div>

                                    {splits.map((split, index) => (
                                        <div key={split.id} style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingBottom: '16px', borderBottom: '1px solid var(--color-border-subtle)' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <span style={{ fontSize: 'var(--text-base)', color: 'var(--color-text-muted)' }}>Категория {index + 1}</span>
                                                {splits.length > 2 && (
                                                    <button type="button" onClick={() => removeSplit(split.id)} style={{ color: 'var(--color-negative)', background: 'transparent', fontSize: 'var(--text-2xl)' }}>×</button>
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
                                                {categories.map(cat => {
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
                                        + Добавить категорию
                                    </button>
                                </div>
                            )}
                        </>
                    )}

                    {isTransfer && (
                        /* Transfer direction. The two accounts are stacked as
                           full-width rows instead of two narrow side-by-side
                           selects: at phone width those clipped anything longer
                           than a word, which is exactly the part that has to be
                           readable here. Each row carries its own colour-coded
                           arrow badge, and the swap button on the divider
                           reverses the direction in one tap. */
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            <div style={{
                                position: 'relative',
                                background: 'var(--color-surface-muted)',
                                border: '1px solid var(--color-border)',
                                borderRadius: 'var(--radius-lg)'
                            }}>
                                {[
                                    { side: 'account', label: 'Откуда', value: formData.account, accent: 'var(--color-negative)', badge: '↑' },
                                    { side: 'toAccount', label: 'Куда', value: formData.toAccount, accent: 'var(--color-positive)', badge: '↓' }
                                ].map((row, index) => (
                                    <div
                                        key={row.side}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '12px',
                                            padding: '12px 14px',
                                            // Room for the swap button so a long
                                            // account name never runs under it.
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
                                            {row.badge}
                                        </div>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <label
                                                htmlFor={`transfer-${row.side}`}
                                                style={{
                                                    display: 'block',
                                                    color: 'var(--color-text-muted)',
                                                    fontSize: 'var(--text-2xs)',
                                                    fontWeight: '600',
                                                    letterSpacing: '0.6px',
                                                    textTransform: 'uppercase',
                                                    marginBottom: '2px'
                                                }}
                                            >
                                                {row.label}
                                            </label>
                                            <select
                                                id={`transfer-${row.side}`}
                                                value={row.value}
                                                onChange={(e) => setTransferAccount(row.side, e.target.value)}
                                                style={{
                                                    width: '100%',
                                                    background: 'transparent',
                                                    border: 'none',
                                                    padding: 0,
                                                    color: 'var(--color-text-main)',
                                                    fontFamily: 'inherit',
                                                    fontSize: 'var(--text-xl)',
                                                    fontWeight: '700',
                                                    cursor: 'pointer',
                                                    outline: 'none'
                                                }}
                                            >
                                                {accounts.map(acc => (
                                                    <option key={acc._id} value={acc._id}>
                                                        {getAccountLabel(acc)}
                                                    </option>
                                                ))}
                                            </select>
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
                                    ⇅
                                </IconButton>
                            </div>
                            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', textAlign: 'center', margin: 0 }}>
                                Общий баланс не изменится
                            </p>
                        </div>
                    )}

                    {/* Description & Account for split (if split, account is shared) */}
                    {isSplit && (
                        <div>
                            <label style={{ display: 'block', color: 'var(--color-text-muted)', marginBottom: '8px', fontSize: 'var(--text-base)' }}>
                                Списать с
                            </label>
                             <div style={{ 
                                 display: 'flex', 
                                 gap: '12px', 
                                 overflowX: accounts.length > 3 ? 'auto' : 'visible',
                                 paddingBottom: accounts.length > 3 ? '8px' : '0'
                             }}>
                                 {accounts.map(acc => (
                                     <Chip
                                         key={acc._id}
                                         shape="block"
                                         selected={formData.account === acc._id}
                                         onClick={() => setFormData({ ...formData, account: acc._id })}
                                         style={{
                                             flex: accounts.length > 3 ? '0 0 auto' : 1,
                                             minWidth: accounts.length > 3 ? '120px' : 'auto',
                                             padding: '12px',
                                             fontWeight: '600',
                                             whiteSpace: 'nowrap',
                                             overflow: 'hidden',
                                             textOverflow: 'ellipsis'
                                         }}
                                     >
                                         {acc.icon || (acc.type === 'cash' ? '💵' : '💳')} {acc.name}
                                     </Chip>
                                 ))}
                             </div>
                        </div>
                    )}

                    {/* Date Input */}
                    <div>
                        <label style={{ display: 'block', color: 'var(--color-text-muted)', marginBottom: '8px', fontSize: 'var(--text-base)' }}>Дата</label>
                        <Field
                            type="date"
                            tone="sunken"
                            size="xl"
                            value={formData.date}
                            min="2025-11-09"
                            max={today}
                            onChange={e => setFormData({ ...formData, date: e.target.value })}
                            style={{
                                width: '100%',
                                display: 'block',
                                margin: 0,
                                // родное оформление поля даты в iOS/Safari
                                // сбивается только этими четырьмя строками
                                fontFamily: 'inherit',
                                colorScheme: 'light',
                                WebkitAppearance: 'none',
                                appearance: 'none'
                            }}
                        />
                    </div>

                    {/* Description */}
                    <div>
                        <label style={{ display: 'block', color: 'var(--color-text-muted)', marginBottom: '8px', fontSize: 'var(--text-base)' }}>Описание (опц.)</label>
                        <Field
                            type="text"
                            tone="sunken"
                            size="xl"
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

                    <div style={{ display: 'flex', gap: '12px', marginTop: '12px' }}>
                        {initialData && (
                            <button
                                type="button"
                                aria-label="Удалить операцию"
                                disabled={isSubmitting}
                                onClick={async () => {
                                    if (isSubmitting) return;
                                    const isSplitTx = !!initialData?.splitId;
                                    const confirmMsg = isSplitTx
                                        ? 'Это часть разделенной транзакции. Удалить всю транзакцию целиком?'
                                        : 'Вы уверены, что хотите удалить эту запись?';
                                    if (window.confirm(confirmMsg)) {
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
                                🗑
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
