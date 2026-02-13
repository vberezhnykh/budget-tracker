import { useState } from 'react';

export default function AddTransactionForm({ type = 'expense', initialData = null, onClose, onSubmit, onDelete }) {
    const [formData, setFormData] = useState(initialData ? {
        ...initialData,
        date: initialData.date || new Date().toISOString().split('T')[0],
        account: initialData.account || 'cash',
        toAccount: initialData.toAccount || (initialData.account === 'card' ? 'cash' : 'card')
    } : {
        amount: '',
        category: '',
        description: '',
        date: new Date().toISOString().split('T')[0],
        type: type, // 'income', 'expense', or 'transfer'
        account: 'cash',
        toAccount: 'card'
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

    const handleSubmit = (e) => {
        e.preventDefault();
        // Allow save if: (amount exists) AND (isTransfer OR category chosen OR (isSplit AND split is valid))
        const canSave = formData.amount && (isTransfer || formData.category || (isSplit && isSplitValid));
        if (!canSave) return;

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
                category: isTransfer ? 'Обмен' : formData.category,
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

    const categories = formData.type === 'expense'
        ? ['Продукты', 'Еда вне дома', 'Транспорт', 'Развлечения', 'Шопинг', 'Красота', 'Жилье', 'Питомцы', 'Услуги', 'Отпуск', 'Другое']
        : ['Зарплата', 'Фриланс', 'Подарок', 'Кэшбэк', 'Другое'];

    const getTitle = () => {
        if (initialData) return 'Редактировать';
        if (isTransfer) return 'Обмен / Перевод';
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



    return (
        <div style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(30, 41, 59, 0.4)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            animation: 'fadeIn 0.2s ease-out',
            overflowY: 'auto',
            padding: '20px 0'
        }} onClick={onClose}>
            <div
                onClick={e => e.stopPropagation()}
                className="glass-panel"
                style={{
                    background: 'var(--color-surface)',
                    width: '90%',
                    maxWidth: '450px',
                    borderRadius: '24px',
                    padding: '24px',
                    position: 'relative',
                    animation: 'slideUp 0.3s ease-out',
                    maxHeight: '90vh',
                    overflowY: 'auto',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '20px',
                    margin: 'auto'
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
                            { id: 'transfer', label: 'Обмен' }
                        ].map(t => (
                            <button
                                key={t.id}
                                onClick={() => setFormData({ ...formData, type: t.id })}
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
                                        <div style={{ display: 'flex', gap: '12px' }}>
                                            {[
                                                { id: 'card', label: '💳 Карта' },
                                                { id: 'cash', label: '💵 Наличные' }
                                            ].map(acc => (
                                                <button
                                                    key={acc.id}
                                                    type="button"
                                                    onClick={() => setFormData({ ...formData, account: acc.id })}
                                                    style={{
                                                        flex: 1,
                                                        padding: '12px',
                                                        borderRadius: '12px',
                                                        border: '1px solid',
                                                        borderColor: formData.account === acc.id ? 'var(--color-primary)' : 'rgba(0,0,0,0.08)',
                                                        background: formData.account === acc.id ? 'rgba(37, 99, 235, 0.05)' : '#fff',
                                                        color: formData.account === acc.id ? 'var(--color-primary)' : 'var(--color-text-muted)',
                                                        fontWeight: '600',
                                                        transition: 'all 0.2s'
                                                    }}
                                                >
                                                    {acc.label}
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
                                                    key={cat}
                                                    type="button"
                                                    onClick={() => setFormData({ ...formData, category: cat })}
                                                    style={{
                                                        padding: '8px 16px',
                                                        borderRadius: '20px',
                                                        border: '1px solid',
                                                        borderColor: formData.category === cat ? 'var(--color-primary)' : 'rgba(0,0,0,0.08)',
                                                        background: formData.category === cat ? 'rgba(37, 99, 235, 0.05)' : '#fff',
                                                        color: formData.category === cat ? 'var(--color-primary)' : 'var(--color-text-muted)',
                                                        fontSize: '0.875rem',
                                                        fontWeight: formData.category === cat ? '600' : 'normal',
                                                        transition: 'all 0.2s'
                                                    }}
                                                >
                                                    {cat}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
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
                                                    const isSelectedInOtherSplit = splits.some(s => s.id !== split.id && s.category === cat);
                                                    if (isSelectedInOtherSplit) return null;

                                                    return (
                                                        <button
                                                            key={cat}
                                                            type="button"
                                                            onClick={() => updateSplit(split.id, 'category', cat)}
                                                            style={{
                                                                padding: '6px 12px',
                                                                borderRadius: '16px',
                                                                whiteSpace: 'nowrap',
                                                                border: '1px solid',
                                                                borderColor: split.category === cat ? 'var(--color-primary)' : 'rgba(0,0,0,0.08)',
                                                                background: split.category === cat ? 'rgba(37, 99, 235, 0.05)' : '#fff',
                                                                color: split.category === cat ? 'var(--color-primary)' : 'var(--color-text-muted)',
                                                                fontSize: '0.8rem',
                                                                fontWeight: split.category === cat ? '600' : 'normal'
                                                            }}
                                                        >
                                                            {cat}
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
                        /* Transfer specific UI */
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <div style={{ flex: 1 }}>
                                    <label style={{ display: 'block', color: 'var(--color-text-muted)', marginBottom: '8px', fontSize: '0.875rem' }}>ОТКУДА</label>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const newFrom = formData.account === 'card' ? 'cash' : 'card';
                                            setFormData({ ...formData, account: newFrom, toAccount: formData.account });
                                        }}
                                        style={{
                                            width: '100%',
                                            padding: '16px',
                                            borderRadius: '16px',
                                            background: '#fff',
                                            border: '1px solid rgba(239, 68, 68, 0.2)',
                                            color: '#ef4444',
                                            fontWeight: '700',
                                            cursor: 'pointer',
                                            boxShadow: '0 2px 4px rgba(239, 68, 68, 0.05)'
                                        }}
                                    >
                                        {formData.account === 'card' ? '💳 Карта' : '💵 Наличные'}
                                    </button>
                                </div>
                                <div style={{ fontSize: '1.5rem', paddingTop: '20px' }}>→</div>
                                <div style={{ flex: 1 }}>
                                    <label style={{ display: 'block', color: 'var(--color-text-muted)', marginBottom: '8px', fontSize: '0.875rem' }}>КУДА</label>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const newTo = formData.toAccount === 'card' ? 'cash' : 'card';
                                            setFormData({ ...formData, toAccount: newTo, account: formData.toAccount });
                                        }}
                                        style={{
                                            width: '100%',
                                            padding: '16px',
                                            borderRadius: '16px',
                                            background: '#fff',
                                            border: '1px solid rgba(34, 197, 94, 0.2)',
                                            color: '#10b981',
                                            fontWeight: '700',
                                            cursor: 'pointer',
                                            boxShadow: '0 2px 4px rgba(34, 197, 94, 0.05)'
                                        }}
                                    >
                                        {formData.toAccount === 'card' ? '💳 Карта' : '💵 Наличные'}
                                    </button>
                                </div>
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
                            <div style={{ display: 'flex', gap: '12px' }}>
                                {[
                                    { id: 'card', label: '💳 Карта' },
                                    { id: 'cash', label: '💵 Наличные' }
                                ].map(acc => (
                                    <button
                                        key={acc.id}
                                        type="button"
                                        onClick={() => setFormData({ ...formData, account: acc.id })}
                                        style={{
                                            flex: 1,
                                            padding: '12px',
                                            borderRadius: '12px',
                                            border: '1px solid',
                                            borderColor: formData.account === acc.id ? 'var(--color-primary)' : 'rgba(0,0,0,0.08)',
                                            background: formData.account === acc.id ? 'rgba(37, 99, 235, 0.05)' : '#fff',
                                            color: formData.account === acc.id ? 'var(--color-primary)' : 'var(--color-text-muted)',
                                            fontWeight: '600',
                                            transition: 'all 0.2s'
                                        }}
                                    >
                                        {acc.label}
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
                                background: 'rgba(0,0,0,0.03)',
                                border: '1px solid rgba(0,0,0,0.08)',
                                borderRadius: '12px',
                                padding: '12px',
                                color: 'var(--color-text-main)',
                                fontSize: '1rem',
                                outline: 'none',
                                fontFamily: 'inherit',
                                colorScheme: 'light',
                                boxSizing: 'border-box'
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
                            disabled={isSplit ? !isSplitValid : (!formData.amount || (!isTransfer && !formData.category))}
                            style={{
                                flex: 1,
                                padding: '16px',
                                fontSize: '1.1rem',
                                opacity: (isSplit ? !isSplitValid : (!formData.amount || (!isTransfer && !formData.category))) ? 0.5 : 1,
                                cursor: (isSplit ? !isSplitValid : (!formData.amount || (!isTransfer && !formData.category))) ? 'not-allowed' : 'pointer'
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
        </div>
    );
}
