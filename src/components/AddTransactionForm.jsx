import { useState, useEffect } from 'react';

export default function AddTransactionForm({ type = 'expense', initialData = null, categories: allCategories = [], onAddCategory, onClose, onSubmit, onDelete, accounts = [], presetAccountId = null }) {
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

    const totalSplitAmount = splits.reduce((sum, split) => sum + (parseFloat(split.amount) || 0), 0);
    const remainingAmount = (parseFloat(formData.amount) || 0) - totalSplitAmount;

    // Validation for split: check if split mode is active, remaining amount is approx 0, and all splits have data
    const isSplitValid = isSplit && Math.abs(remainingAmount) < 0.01 && splits.every(s => s.amount && s.category);

    // Shared save-gate for both the submit button (disabled state) and the
    // submit handler (so the gate can't be bypassed some other way, e.g. an
    // Enter keypress). An account must be chosen unless transferring - that
    // flow has its own from/to selects and always starts pre-filled.
    const isSaveDisabled = !(parseFloat(formData.amount) > 0)
        || (!isTransfer && !formData.account)
        || (isSplit ? !isSplitValid : (!isTransfer && !formData.category));

    const handleSubmit = (e) => {
        e.preventDefault();
        if (isSaveDisabled) return;

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
            onSubmit(splitTransactions);
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
            onSubmit(submitData);
        }
        onClose();
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

    // New category inline creation
    const [isAddingCategory, setIsAddingCategory] = useState(false);
    const [newCategoryName, setNewCategoryName] = useState('');

    const getTitle = () => {
        if (initialData) return 'Редактировать';
        if (isTransfer) return 'Перевод';
        return formData.type === 'income' ? 'Новый доход' : 'Новый расход';
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
        if (!trimmed || !onAddCategory) return;
        const result = await onAddCategory(trimmed, formData.type);
        if (result && !result.error) {
            setFormData({ ...formData, category: trimmed });
            setNewCategoryName('');
            setIsAddingCategory(false);
        }
    };

    // Lock body scroll when modal is open
    useEffect(() => {
        const scrollY = window.scrollY;
        document.body.style.overflow = 'hidden';
        document.body.style.position = 'fixed';
        document.body.style.width = '100%';
        document.body.style.top = `-${scrollY}px`;

        return () => {
            document.body.style.overflow = '';
            document.body.style.position = '';
            document.body.style.width = '';
            document.body.style.top = '';
            window.scrollTo(0, scrollY);
        };
    }, []);


    return (
        <div style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(30, 41, 59, 0.4)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            // The sheet sits on the bottom edge rather than floating in the
            // middle: it uses the full width and the full height it needs,
            // and the gap left above it is what still reads as "a card".
            alignItems: 'flex-end',
            justifyContent: 'center',
            zIndex: 1000,
            animation: 'fadeIn 0.2s ease-out',
            overflowY: 'auto',
            overflowX: 'hidden',
            touchAction: 'pan-y',
            WebkitOverflowScrolling: 'touch'
        }} onClick={onClose}>
            <div
                onClick={e => e.stopPropagation()}
                className="glass-panel"
                style={{
                    background: 'var(--color-surface)',
                    width: '100%',
                    maxWidth: '520px',
                    // Only the top corners are rounded - the bottom ones would
                    // otherwise cut into the screen edge the sheet rests on.
                    borderRadius: '24px 24px 0 0',
                    // The extra bottom padding clears the iOS home indicator,
                    // which now overlaps the sheet's own last row.
                    padding: '24px 20px calc(24px + env(safe-area-inset-bottom, 0px))',
                    position: 'relative',
                    animation: 'slideUp 0.3s ease-out',
                    maxHeight: '92vh',
                    overflowY: 'auto',
                    overflowX: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '20px',
                    margin: 0,
                    touchAction: 'pan-y'
                }}
            >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ margin: 0 }}>{getTitle()}</h3>
                    <button
                        type="button"
                        onClick={onClose}
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
                        background: 'rgba(0,0,0,0.05)',
                        padding: '4px',
                        borderRadius: '12px'
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
                                    borderRadius: '8px',
                                    background: formData.type === t.id ? '#fff' : 'transparent',
                                    color: formData.type === t.id ? 'var(--color-primary)' : 'var(--color-text-muted)',
                                    fontWeight: '600',
                                    fontSize: '0.9rem',
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
                        <label style={{ display: 'block', color: 'var(--color-text-muted)', marginBottom: '8px', fontSize: '0.875rem' }}>
                            {isSplit ? 'Общая сумма' : 'Сумма'}
                        </label>
                        <div style={{ position: 'relative' }}>
                            <span style={{
                                position: 'absolute',
                                left: '16px',
                                top: '50%',
                                transform: 'translateY(-50%)',
                                color: 'var(--color-text-muted)',
                                fontSize: '1.25rem'
                            }}>€</span>
                            <input
                                type="number"
                                inputMode="decimal"
                                step="0.01"
                                placeholder="0.00"
                                value={formData.amount}
                                onChange={e => setFormData({ ...formData, amount: e.target.value })}
                                style={{
                                    width: '100%',
                                    background: 'rgba(0,0,0,0.03)',
                                    border: '1px solid rgba(0,0,0,0.08)',
                                    borderRadius: '16px',
                                    padding: '16px 16px 16px 36px',
                                    color: 'var(--color-text-main)',
                                    fontSize: '1.5rem',
                                    fontWeight: 'bold',
                                    outline: 'none',
                                    boxSizing: 'border-box'
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
                                        background: 'rgba(0,0,0,0.03)',
                                        borderRadius: '12px',
                                        cursor: 'pointer',
                                        border: '1px solid rgba(0,0,0,0.05)',
                                        transition: 'all 0.2s'
                                    }}
                                >
                                    <div style={{
                                        width: '40px',
                                        height: '20px',
                                        background: isSplit ? 'var(--color-primary)' : 'rgba(255,255,255,0.2)',
                                        borderRadius: '20px',
                                        position: 'relative',
                                        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
                                    }}>
                                        <div style={{
                                            position: 'absolute',
                                            top: '2px',
                                            left: isSplit ? '22px' : '2px',
                                            width: '16px',
                                            height: '16px',
                                            background: '#fff',
                                            borderRadius: '50%',
                                            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                                            boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
                                        }} />
                                    </div>
                                    <span style={{ fontSize: '0.9rem', fontWeight: '500', color: isSplit ? '#fff' : 'var(--color-text-muted)' }}>
                                        Разделить на несколько категорий
                                    </span>
                                </div>
                            )}

                            {!isSplit ? (
                                <>
                                    {/* Account Selector */}
                                    <div>
                                        <label style={{ display: 'block', color: 'var(--color-text-muted)', marginBottom: '8px', fontSize: '0.875rem' }}>
                                            {formData.type === 'expense' ? 'Списать с' : 'Зачислить на'}
                                        </label>
                                        <div style={{ 
                                            display: 'flex', 
                                            gap: '12px', 
                                            overflowX: accounts.length > 3 ? 'auto' : 'visible',
                                            paddingBottom: accounts.length > 3 ? '8px' : '0'
                                        }}>
                                            {accounts.map(acc => (
                                                <button
                                                    key={acc._id}
                                                    type="button"
                                                    onClick={() => setFormData({ ...formData, account: acc._id })}
                                                    style={{
                                                        flex: accounts.length > 3 ? '0 0 auto' : 1,
                                                        minWidth: accounts.length > 3 ? '120px' : 'auto',
                                                        padding: '12px',
                                                        borderRadius: '12px',
                                                        border: '1px solid',
                                                        borderColor: formData.account === acc._id ? 'var(--color-primary)' : 'rgba(0,0,0,0.08)',
                                                        background: formData.account === acc._id ? 'rgba(37, 99, 235, 0.05)' : '#fff',
                                                        color: formData.account === acc._id ? 'var(--color-primary)' : 'var(--color-text-muted)',
                                                        fontWeight: '600',
                                                        transition: 'all 0.2s',
                                                        whiteSpace: 'nowrap',
                                                        overflow: 'hidden',
                                                        textOverflow: 'ellipsis'
                                                    }}
                                                >
                                                    {acc.icon || (acc.type === 'cash' ? '💵' : '💳')} {acc.name}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Category Selection */}
                                    <div>
                                        <label style={{ display: 'block', color: 'var(--color-text-muted)', marginBottom: '8px', fontSize: '0.875rem' }}>Категория</label>
                                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                            {categories.map(cat => (
                                                <button
                                                    key={cat._id}
                                                    type="button"
                                                    onClick={() => setFormData({ ...formData, category: cat.name })}
                                                    style={{
                                                        padding: '8px 16px',
                                                        borderRadius: '20px',
                                                        border: '1px solid',
                                                        borderColor: formData.category === cat.name ? 'var(--color-primary)' : 'rgba(0,0,0,0.08)',
                                                        background: formData.category === cat.name ? 'rgba(37, 99, 235, 0.05)' : '#fff',
                                                        color: formData.category === cat.name ? 'var(--color-primary)' : 'var(--color-text-muted)',
                                                        fontSize: '0.875rem',
                                                        fontWeight: formData.category === cat.name ? '600' : 'normal',
                                                        transition: 'all 0.2s'
                                                    }}
                                                >
                                                    {cat.name}
                                                </button>
                                            ))}
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
                                                borderRadius: '12px',
                                                border: '1px solid',
                                                borderColor: formData.excludeFromStats ? 'rgba(239, 68, 68, 0.3)' : 'rgba(0,0,0,0.08)',
                                                background: formData.excludeFromStats ? 'rgba(239, 68, 68, 0.03)' : '#fff',
                                                cursor: 'pointer',
                                                transition: 'all 0.2s',
                                                userSelect: 'none'
                                            }}
                                        >
                                            <span style={{ fontSize: '0.85rem', color: formData.excludeFromStats ? '#ef4444' : 'var(--color-text-muted)' }}>
                                                Не считать в статистике
                                            </span>
                                            <div style={{
                                                width: '40px',
                                                height: '22px',
                                                borderRadius: '11px',
                                                background: formData.excludeFromStats ? '#ef4444' : 'rgba(0,0,0,0.15)',
                                                position: 'relative',
                                                transition: 'background 0.2s'
                                            }}>
                                                <div style={{
                                                    width: '18px',
                                                    height: '18px',
                                                    borderRadius: '50%',
                                                    background: '#fff',
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
                                        <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                                            <input
                                                type="text"
                                                placeholder="Название..."
                                                value={newCategoryName}
                                                onChange={e => setNewCategoryName(e.target.value)}
                                                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleCreateCategory(); } }}
                                                autoFocus
                                                style={{
                                                    flex: 1,
                                                    padding: '8px 12px',
                                                    borderRadius: '20px',
                                                    border: '1px solid rgba(37, 99, 235, 0.3)',
                                                    background: '#fff',
                                                    fontSize: '0.875rem',
                                                    outline: 'none',
                                                    color: 'var(--color-text-main)',
                                                    boxSizing: 'border-box'
                                                }}
                                            />
                                            <button
                                                type="button"
                                                onClick={handleCreateCategory}
                                                disabled={!newCategoryName.trim()}
                                                style={{
                                                    padding: '8px 14px',
                                                    borderRadius: '20px',
                                                    border: 'none',
                                                    background: newCategoryName.trim() ? 'var(--color-primary)' : 'rgba(0,0,0,0.05)',
                                                    color: newCategoryName.trim() ? '#fff' : 'var(--color-text-muted)',
                                                    fontSize: '0.875rem',
                                                    fontWeight: '600',
                                                    cursor: newCategoryName.trim() ? 'pointer' : 'default'
                                                }}
                                            >✓</button>
                                            <button
                                                type="button"
                                                onClick={() => { setIsAddingCategory(false); setNewCategoryName(''); }}
                                                style={{
                                                    padding: '8px 14px',
                                                    borderRadius: '20px',
                                                    border: '1px solid rgba(0,0,0,0.08)',
                                                    background: '#fff',
                                                    color: 'var(--color-text-muted)',
                                                    fontSize: '0.875rem',
                                                    cursor: 'pointer'
                                                }}
                                            >×</button>
                                        </div>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={() => setIsAddingCategory(true)}
                                            style={{
                                                padding: '8px 16px',
                                                borderRadius: '20px',
                                                border: '1px dashed rgba(37, 99, 235, 0.3)',
                                                background: 'transparent',
                                                color: 'var(--color-primary)',
                                                fontSize: '0.875rem',
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
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', background: 'rgba(0,0,0,0.02)', padding: '16px', borderRadius: '16px', border: '1px solid rgba(0,0,0,0.05)' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                                        <span>Осталось распределить:</span>
                                        <span style={{ color: remainingAmount === 0 ? '#4ade80' : ((remainingAmount < 0) ? '#ef4444' : '#fbbf24'), fontWeight: 'bold' }}>
                                            €{remainingAmount.toFixed(2)}
                                        </span>
                                    </div>

                                    {splits.map((split, index) => (
                                        <div key={split.id} style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingBottom: '16px', borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>Категория {index + 1}</span>
                                                {splits.length > 2 && (
                                                    <button type="button" onClick={() => removeSplit(split.id)} style={{ color: '#ef4444', background: 'transparent', fontSize: '1.1rem' }}>×</button>
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
                                                        <button
                                                            key={cat._id}
                                                            type="button"
                                                            onClick={() => updateSplit(split.id, 'category', cat.name)}
                                                            style={{
                                                                padding: '6px 12px',
                                                                borderRadius: '16px',
                                                                whiteSpace: 'nowrap',
                                                                border: '1px solid',
                                                                borderColor: split.category === cat.name ? 'var(--color-primary)' : 'rgba(0,0,0,0.08)',
                                                                background: split.category === cat.name ? 'rgba(37, 99, 235, 0.05)' : '#fff',
                                                                color: split.category === cat.name ? 'var(--color-primary)' : 'var(--color-text-muted)',
                                                                fontSize: '0.8rem',
                                                                fontWeight: split.category === cat.name ? '600' : 'normal'
                                                            }}
                                                        >
                                                            {cat.name}
                                                        </button>
                                                    );
                                                })}
                                            </div>

                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                <input
                                                    type="number"
                                                    placeholder="Сумма"
                                                    value={split.amount}
                                                    onChange={e => updateSplit(split.id, 'amount', e.target.value)}
                                                    style={{ flex: 1, background: '#fff', border: '1px solid rgba(0,0,0,0.08)', padding: '10px', borderRadius: '8px', color: 'var(--color-text-main)', boxSizing: 'border-box' }}
                                                />
                                            </div>
                                        </div>
                                    ))}

                                    <button
                                        type="button"
                                        onClick={addSplit}
                                        style={{ width: '100%', padding: '10px', borderRadius: '12px', background: '#fff', color: 'var(--color-text-muted)', border: '1px dashed rgba(0,0,0,0.2)', fontWeight: '500' }}
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
                                background: 'rgba(0,0,0,0.02)',
                                border: '1px solid rgba(0,0,0,0.08)',
                                borderRadius: '16px'
                            }}>
                                {[
                                    { side: 'account', label: 'Откуда', value: formData.account, accent: '#ef4444', badge: '↑' },
                                    { side: 'toAccount', label: 'Куда', value: formData.toAccount, accent: '#10b981', badge: '↓' }
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
                                            borderTop: index === 0 ? 'none' : '1px solid rgba(0,0,0,0.08)'
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
                                            fontSize: '1rem'
                                        }}>
                                            {row.badge}
                                        </div>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <label
                                                htmlFor={`transfer-${row.side}`}
                                                style={{
                                                    display: 'block',
                                                    color: 'var(--color-text-muted)',
                                                    fontSize: '0.7rem',
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
                                                    fontSize: '1rem',
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
                                <button
                                    type="button"
                                    onClick={swapTransferAccounts}
                                    aria-label="Поменять счета местами"
                                    style={{
                                        position: 'absolute',
                                        top: '50%',
                                        right: '14px',
                                        transform: 'translateY(-50%)',
                                        width: '38px',
                                        height: '38px',
                                        borderRadius: '50%',
                                        background: '#fff',
                                        border: '1px solid rgba(0,0,0,0.1)',
                                        color: 'var(--color-primary)',
                                        fontSize: '1.1rem',
                                        lineHeight: 1,
                                        cursor: 'pointer',
                                        boxShadow: '0 1px 4px rgba(0,0,0,0.08)'
                                    }}
                                >
                                    ⇅
                                </button>
                            </div>
                            <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', textAlign: 'center', margin: 0 }}>
                                Общий баланс не изменится
                            </p>
                        </div>
                    )}

                    {/* Description & Account for split (if split, account is shared) */}
                    {isSplit && (
                        <div>
                            <label style={{ display: 'block', color: 'var(--color-text-muted)', marginBottom: '8px', fontSize: '0.875rem' }}>
                                Списать с
                            </label>
                             <div style={{ 
                                 display: 'flex', 
                                 gap: '12px', 
                                 overflowX: accounts.length > 3 ? 'auto' : 'visible',
                                 paddingBottom: accounts.length > 3 ? '8px' : '0'
                             }}>
                                 {accounts.map(acc => (
                                     <button
                                         key={acc._id}
                                         type="button"
                                         onClick={() => setFormData({ ...formData, account: acc._id })}
                                         style={{
                                             flex: accounts.length > 3 ? '0 0 auto' : 1,
                                             minWidth: accounts.length > 3 ? '120px' : 'auto',
                                             padding: '12px',
                                             borderRadius: '12px',
                                             border: '1px solid',
                                             borderColor: formData.account === acc._id ? 'var(--color-primary)' : 'rgba(0,0,0,0.08)',
                                             background: formData.account === acc._id ? 'rgba(37, 99, 235, 0.05)' : '#fff',
                                             color: formData.account === acc._id ? 'var(--color-primary)' : 'var(--color-text-muted)',
                                             fontWeight: '600',
                                             transition: 'all 0.2s',
                                             whiteSpace: 'nowrap',
                                             overflow: 'hidden',
                                             textOverflow: 'ellipsis'
                                         }}
                                     >
                                         {acc.icon || (acc.type === 'cash' ? '💵' : '💳')} {acc.name}
                                     </button>
                                 ))}
                             </div>
                        </div>
                    )}

                    {/* Date Input */}
                    <div>
                        <label style={{ display: 'block', color: 'var(--color-text-muted)', marginBottom: '8px', fontSize: '0.875rem' }}>Дата</label>
                        <input
                            type="date"
                            value={formData.date}
                            min="2025-11-09"
                            max={today}
                            onChange={e => setFormData({ ...formData, date: e.target.value })}
                            style={{
                                width: '100%',
                                display: 'block',
                                margin: 0,
                                background: 'rgba(0,0,0,0.03)',
                                border: '1px solid rgba(0,0,0,0.08)',
                                borderRadius: '16px',
                                padding: '16px',
                                color: 'var(--color-text-main)',
                                fontSize: '1.25rem',
                                fontWeight: '700',
                                outline: 'none',
                                fontFamily: 'inherit',
                                colorScheme: 'light',
                                boxSizing: 'border-box',
                                WebkitAppearance: 'none',
                                appearance: 'none'
                            }}
                        />
                    </div>

                    {/* Description */}
                    <div>
                        <label style={{ display: 'block', color: 'var(--color-text-muted)', marginBottom: '8px', fontSize: '0.875rem' }}>Описание (опц.)</label>
                        <input
                            type="text"
                            placeholder="Комментарий..."
                            value={formData.description}
                            onChange={e => setFormData({ ...formData, description: e.target.value })}
                            style={{
                                width: '100%',
                                background: 'rgba(0,0,0,0.03)',
                                border: '1px solid rgba(0,0,0,0.08)',
                                borderRadius: '16px',
                                padding: '16px',
                                color: 'var(--color-text-main)',
                                fontSize: '1.25rem',
                                fontWeight: '700',
                                outline: 'none',
                                boxSizing: 'border-box'
                            }}
                        />
                    </div>

                    <div style={{ display: 'flex', gap: '12px', marginTop: '12px' }}>
                        {initialData && (
                            <button
                                type="button"
                                onClick={() => {
                                    const isSplitTx = !!initialData?.splitId;
                                    const confirmMsg = isSplitTx
                                        ? 'Это часть разделенной транзакции. Удалить всю транзакцию целиком?'
                                        : 'Вы уверены, что хотите удалить эту запись?';
                                    if (window.confirm(confirmMsg)) {
                                        onDelete(initialData.id);
                                        onClose();
                                    }
                                }}
                                style={{
                                    padding: '16px',
                                    borderRadius: '12px',
                                    background: '#fff',
                                    color: '#ef4444',
                                    fontWeight: '700',
                                    border: '1px solid rgba(239, 68, 68, 0.2)',
                                    fontSize: '1.2rem',
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
                                fontSize: '1.1rem',
                                opacity: isSaveDisabled ? 0.5 : 1,
                                cursor: isSaveDisabled ? 'not-allowed' : 'pointer'
                            }}
                        >
                            Сохранить
                        </button>
                    </div>
                </form>
            </div>
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
        </div >
    );
}
