// Список операций, сгруппированный по дням. Один и тот же список нужен в
// трёх местах - в шторке истории (результаты поиска и обычная история) и
// блоком «Последние операции» на главной, - а до этого он был написан в
// шторке дважды, почти одинаково, с уже начавшимися расхождениями:
// разбитые операции разворачивались только в истории, но не в результатах
// поиска.
//
// На вход идёт уже сгруппированная структура { дата: { items, dailySum } } -
// ровно та, что отдают getPeriodData и getSearchResults; сортировка по
// убыванию даты здесь, потому что порядок ключей объекта - не порядок дней.

// Строка операции целиком кликабельна, но внутри неё есть вторая цель -
// категория, включающая фильтр. Поэтому «растянутая» кнопка лежит
// отдельным слоем под содержимым (position: absolute + inset: 0), а не
// оборачивает его: вложенная в кнопку кнопка невалидна, а щелчок по
// категории иначе открывал бы редактирование.
function RowOverlayButton({ label, onClick }) {
    return (
        <button
            type="button"
            aria-label={label}
            onClick={onClick}
            style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                margin: 0,
                padding: 0,
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                zIndex: 0,
            }}
        />
    );
}

// Категория как переключатель фильтра. Не <button>: она лежит внутри
// строки, у которой уже есть своя кнопка-подложка, - зато role и
// обработка Enter/Space возвращают ей клавиатурное поведение кнопки.
function CategoryFilterLink({ category, selected, onToggle }) {
    return (
        <span
            role="button"
            tabIndex={0}
            onClick={() => onToggle(category)}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onToggle(category);
                }
            }}
            style={{
                position: 'relative',
                zIndex: 1,
                color: selected ? 'var(--color-primary)' : 'inherit',
                fontWeight: selected ? '700' : 'normal',
                textDecoration: 'underline',
                textUnderlineOffset: '2px',
            }}
        >
            {category}
        </span>
    );
}

export default function TransactionList({
    groups,
    selectedCategory,
    toggleCategoryFilter,
    openEditModal,
    getAccountDisplay,
    formatDate,
    emptyText = 'Нет операций',
    rowPadding = '16px 24px',
}) {
    const dates = Object.keys(groups || {}).sort((a, b) => new Date(b) - new Date(a));

    if (dates.length === 0) {
        return (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                {emptyText}
            </div>
        );
    }

    // Строка счёта. Перевод двигает деньги между счетами, поэтому назвать
    // только источник нельзя - это читалось бы как обычный расход.
    const rowAccounts = (item) => (
        item.type === 'transfer' && item.toAccount
            ? `${getAccountDisplay(item.account)} → ${getAccountDisplay(item.toAccount)}`
            : getAccountDisplay(item.account)
    );

    // Доступное имя строки повторяет то, что и так видно глазами:
    // название, счета, категория, сумма со знаком.
    const rowLabel = (item) => {
        const sign = item.type !== 'initial' && item.type !== 'transfer' && item.visualAmount > 0 ? '+' : '';
        const parts = [item.description || item.title, rowAccounts(item)];
        if (item.category) parts.push(item.category);
        parts.push(`${sign}€${Math.abs(item.visualAmount).toFixed(2)}`);
        return parts.join(', ');
    };

    return dates.map(date => (
        <div key={date}>
            <div style={{ padding: '10px 24px', background: 'var(--color-surface-muted)', fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', borderBottom: '1px solid var(--color-border-subtle)', display: 'flex', justifyContent: 'space-between' }}>
                <span>{formatDate(date)}</span>
                {groups[date].dailySum !== 0 && (
                    <span style={{ fontWeight: '600', whiteSpace: 'nowrap', color: groups[date].dailySum > 0 ? 'var(--color-positive)' : 'var(--color-text-muted)' }}>
                        {groups[date].dailySum > 0 ? '+' : ''}{groups[date].dailySum.toFixed(2)}€
                    </span>
                )}
            </div>

            {groups[date].items.map(item => {
                if (item.type === 'split_group') {
                    return (
                        <div key={item.id} style={{ borderBottom: '1px solid var(--color-border-subtle)', background: 'var(--color-surface)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: rowPadding, background: 'var(--color-surface-muted)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                    <div style={{ width: '38px', height: '38px', borderRadius: 'var(--radius-md)', background: 'var(--color-primary-tint)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--text-2xl)' }}>
                                        🗂️
                                    </div>
                                    <div>
                                        <div style={{ fontWeight: '600', fontSize: 'var(--text-lg)', color: 'var(--color-text-main)' }}>{item.description} (Разделено)</div>
                                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                                            {getAccountDisplay(item.account)} • {item.items.length} катег.
                                        </div>
                                    </div>
                                </div>
                                <div style={{ fontWeight: '700', whiteSpace: 'nowrap', flexShrink: 0, color: 'var(--color-text-main)' }}>
                                    €{Math.abs(item.visualAmount).toFixed(2)}
                                </div>
                            </div>

                            {/* Части разбитой операции. Засеянными 'initial' они не
                                бывают, поэтому редактируются всегда. */}
                            <div style={{ paddingLeft: '54px', paddingBottom: '8px' }}>
                                {item.items.map(subItem => (
                                    <div
                                        key={subItem.id}
                                        style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', padding: '8px 24px 8px 16px', fontSize: 'var(--text-base)', cursor: 'pointer', borderLeft: '2px solid var(--color-primary-glow)', marginBottom: '4px' }}
                                    >
                                        <RowOverlayButton
                                            label={`${item.description} (Разделено): ${rowLabel(subItem)}`}
                                            onClick={() => openEditModal(subItem)}
                                        />
                                        <CategoryFilterLink
                                            category={subItem.category}
                                            selected={selectedCategory === subItem.category}
                                            onToggle={toggleCategoryFilter}
                                        />
                                        <div style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-main)' }}>
                                            €{Math.abs(subItem.visualAmount).toFixed(2)}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                }

                // openEditModal ничего не делает для засеянных 'initial'
                // операций, поэтому у них нет и кнопки: фокусируемый элемент,
                // который на нажатие не отвечает, хуже его отсутствия.
                const isEditable = item.type !== 'initial';

                return (
                    <div
                        key={item.id}
                        style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: rowPadding, borderBottom: '1px solid var(--color-border-subtle)', cursor: isEditable ? 'pointer' : 'default', background: item.excludeFromStats ? 'var(--color-surface-muted)' : 'var(--color-surface)', opacity: item.excludeFromStats ? 0.5 : 1 }}
                    >
                        {isEditable && (
                            <RowOverlayButton label={rowLabel(item)} onClick={() => openEditModal(item)} />
                        )}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                            <div style={{ width: '38px', height: '38px', borderRadius: 'var(--radius-md)', background: item.type === 'initial' ? 'var(--color-primary-tint)' : (item.visualAmount > 0 ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.05)'), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--text-2xl)' }}>
                                {item.type === 'initial' ? '🚀' : (item.visualAmount > 0 ? '↓' : '↑')}
                            </div>
                            <div>
                                <div style={{ fontWeight: '600', fontSize: 'var(--text-lg)', color: 'var(--color-text-main)' }}>
                                    {item.description || item.title}
                                    {item.excludeFromStats && (
                                        <span style={{ marginLeft: '6px', fontSize: 'var(--text-2xs)', color: '#94a3b8', fontWeight: '500' }}>🚫</span>
                                    )}
                                </div>
                                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                                    {rowAccounts(item)}
                                    {item.category && (
                                        <>
                                            {' • '}
                                            <CategoryFilterLink
                                                category={item.category}
                                                selected={selectedCategory === item.category}
                                                onToggle={toggleCategoryFilter}
                                            />
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>
                        {/* nowrap - чтобы знак «+» не оставался на строке один,
                            когда сумма длинная, а название операции широкое. */}
                        <div style={{ fontWeight: '700', whiteSpace: 'nowrap', flexShrink: 0, color: (item.type === 'initial' || item.type === 'transfer') ? 'var(--color-primary)' : (item.visualAmount > 0 ? 'var(--color-positive-strong)' : 'var(--color-text-main)') }}>
                            {item.type !== 'initial' && item.type !== 'transfer' && item.visualAmount > 0 ? '+' : ''}€{Math.abs(item.visualAmount).toFixed(2)}
                        </div>
                    </div>
                );
            })}
        </div>
    ));
}
