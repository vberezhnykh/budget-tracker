import { useState } from 'react';

export default function AddTransactionForm({ type = 'expense', initialData = null, onClose, onSubmit, onDelete }) {
    const [formData, setFormData] = useState(initialData || {
        amount: '',
        category: '',
        description: '',
        date: new Date().toISOString().split('T')[0],
        type: type, // 'income' or 'expense'
        account: 'card' // 'card' or 'cash'
    });

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!formData.amount || !formData.category) return;

        onSubmit({
            ...formData,
            amount: parseFloat(formData.amount),
            id: initialData ? initialData.id : Date.now()
        });
        onClose();
    };

    const categories = formData.type === 'expense'
        ? ['Продукты', 'Еда вне дома', 'Транспорт', 'Развлечения', 'Шопинг', 'Красота', 'Жилье', 'Питомцы', 'Услуги', 'Другое']
        : ['Зарплата', 'Фриланс', 'Подарок', 'Кэшбэк', 'Другое'];

    return (
        <div style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(3, 7, 18, 0.8)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'flex-end', // Bottom sheet style for mobile
            justifyContent: 'center',
            zIndex: 100,
            animation: 'fadeIn 0.2s ease-out'
        }} onClick={onClose}>
            <div
                onClick={e => e.stopPropagation()}
                className="glass-panel"
                style={{
                    width: '100%',
                    maxWidth: '500px',
                    padding: '24px',
                    borderBottomLeftRadius: 0,
                    borderBottomRightRadius: 0,
                    borderTopLeftRadius: '24px',
                    borderTopRightRadius: '24px',
                    animation: 'slideUp 0.3s ease-out',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '20px',
                    maxHeight: '90vh',
                    overflowY: 'auto'
                }}
            >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3>{initialData ? 'Редактировать' : (formData.type === 'income' ? 'Новый доход' : 'Новый расход')}</h3>
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

                {/* Type Toggle */}
                <div style={{
                    display: 'flex',
                    background: 'rgba(0,0,0,0.2)',
                    padding: '4px',
                    borderRadius: '12px'
                }}>
                    {[
                        { id: 'expense', label: 'Расход' },
                        { id: 'income', label: 'Доход' }
                    ].map(t => (
                        <button
                            key={t.id}
                            onClick={() => setFormData({ ...formData, type: t.id })}
                            style={{
                                flex: 1,
                                padding: '8px',
                                borderRadius: '8px',
                                background: formData.type === t.id ? 'rgba(255,255,255,0.1)' : 'transparent',
                                color: formData.type === t.id ? '#fff' : 'var(--color-text-muted)',
                                fontWeight: '500',
                                textTransform: 'capitalize',
                                transition: 'all 0.2s'
                            }}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

                    {/* Amount Input */}
                    <div>
                        <label style={{ display: 'block', color: 'var(--color-text-muted)', marginBottom: '8px', fontSize: '0.875rem' }}>Сумма</label>
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
                                onKeyDown={(e) => {
                                    // Allow: backspace, delete, tab, escape, enter and . or ,
                                    if ([46, 8, 9, 27, 13, 110, 190, 188].indexOf(e.keyCode) !== -1 ||
                                        // Allow: Ctrl+A, Ctrl+C, Ctrl+V, Ctrl+X
                                        (e.ctrlKey === true && [65, 67, 86, 88].indexOf(e.keyCode) !== -1) ||
                                        // Allow: home, end, left, right
                                        (e.keyCode >= 35 && e.keyCode <= 39)) {
                                        return;
                                    }
                                    // Ensure that it is a number and stop the keypress
                                    if ((e.shiftKey || (e.keyCode < 48 || e.keyCode > 57)) && (e.keyCode < 96 || e.keyCode > 105)) {
                                        e.preventDefault();
                                    }
                                }}
                                style={{
                                    width: '100%',
                                    background: 'rgba(255,255,255,0.05)',
                                    border: '1px solid rgba(255,255,255,0.1)',
                                    borderRadius: '16px',
                                    padding: '16px 16px 16px 36px',
                                    color: '#fff',
                                    fontSize: '1.5rem',
                                    fontWeight: 'bold',
                                    outline: 'none'
                                }}
                            />
                        </div>
                    </div>

                    {/* Date Input */}
                    <div>
                        <label style={{ display: 'block', color: 'var(--color-text-muted)', marginBottom: '8px', fontSize: '0.875rem' }}>Дата</label>
                        <input
                            type="date"
                            value={formData.date}
                            onChange={e => setFormData({ ...formData, date: e.target.value })}
                            style={{
                                width: '100%',
                                background: 'rgba(255,255,255,0.05)',
                                border: '1px solid rgba(255,255,255,0.1)',
                                borderRadius: '12px',
                                padding: '12px',
                                color: '#fff',
                                fontSize: '1rem',
                                outline: 'none',
                                fontFamily: 'inherit'
                            }}
                        />
                    </div>

                    {/* Account Source */}
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
                                        borderColor: formData.account === acc.id ? 'var(--color-primary)' : 'rgba(255,255,255,0.1)',
                                        background: formData.account === acc.id ? 'rgba(99, 102, 241, 0.2)' : 'rgba(255,255,255,0.05)',
                                        color: formData.account === acc.id ? '#fff' : 'var(--color-text-muted)',
                                        fontWeight: '500',
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
                                        borderColor: formData.category === cat ? 'var(--color-primary)' : 'rgba(255,255,255,0.1)',
                                        background: formData.category === cat ? 'rgba(99, 102, 241, 0.2)' : 'rgba(255,255,255,0.05)',
                                        color: formData.category === cat ? 'var(--color-primary)' : 'var(--color-text-muted)',
                                        fontSize: '0.875rem',
                                        transition: 'all 0.2s'
                                    }}
                                >
                                    {cat}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Description */}
                    <div>
                        <label style={{ display: 'block', color: 'var(--color-text-muted)', marginBottom: '8px', fontSize: '0.875rem' }}>Описание</label>
                        <input
                            type="text"
                            placeholder="Комментарий..."
                            value={formData.description}
                            onChange={e => setFormData({ ...formData, description: e.target.value })}
                            style={{
                                width: '100%',
                                background: 'rgba(255,255,255,0.05)',
                                border: '1px solid rgba(255,255,255,0.1)',
                                borderRadius: '12px',
                                padding: '12px',
                                color: '#fff',
                                fontSize: '1rem',
                                outline: 'none'
                            }}
                        />
                    </div>

                    <div style={{ display: 'flex', gap: '12px', marginTop: '12px' }}>
                        {initialData && (
                            <button
                                type="button"
                                onClick={() => {
                                    if (window.confirm('Вы уверены, что хотите удалить эту запись?')) {
                                        onDelete(initialData.id);
                                    }
                                }}
                                style={{
                                    padding: '16px',
                                    borderRadius: '12px',
                                    background: 'rgba(239, 68, 68, 0.1)',
                                    color: '#ef4444',
                                    fontWeight: '600',
                                    border: '1px solid rgba(239, 68, 68, 0.2)',
                                    fontSize: '1.2rem',
                                    lineHeight: 1
                                }}
                            >
                                🗑
                            </button>
                        )}
                        <button
                            type="submit"
                            className="btn-primary"
                            disabled={!formData.amount || !formData.category}
                            style={{
                                flex: 1,
                                padding: '16px',
                                fontSize: '1.1rem',
                                opacity: (!formData.amount || !formData.category) ? 0.5 : 1,
                                cursor: (!formData.amount || !formData.category) ? 'not-allowed' : 'pointer'
                            }}
                        >
                            Сохранить
                        </button>
                    </div>
                </form>
            </div>
            <style>{`
        @keyframes slideUp {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
      `}</style>
        </div>
    );
}
