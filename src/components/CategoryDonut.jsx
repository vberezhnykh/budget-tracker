import React, { useState } from 'react';

const COLORS = [
    '#6366f1', // Indigo
    '#f43f5e', // Rose
    '#10b981', // Emerald
    '#f59e0b', // Amber
    '#8b5cf6', // Violet
    '#ec4899', // Pink
    '#06b6d4', // Cyan
    '#84cc16', // Lime
    '#f97316', // Orange
    '#64748b'  // Slate
];

// A category row can be four different things depending on the props this
// instance was rendered with: a plain div (no interaction), a filter button
// (onSelect), or the expandable "Прочее" toggle - all sharing the same inner
// layout so the numbers line up either way.
function CategoryRow({ name, count, value, percent, color, comparison, isSelected, onSelect, isExpander, isExpanded, indent }) {
    // A category that landed on exactly the same total as last month has no
    // change worth a badge - "−0%" would read as a drop that didn't happen.
    const showDelta = comparison && comparison.previous > 0 && comparison.percent !== 0;

    const content = (
        <div style={{ width: '100%', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                    {color && <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: color, flexShrink: 0 }} />}
                    <span style={{
                        fontSize: indent ? 'var(--text-xs)' : 'var(--text-sm)',
                        color: isSelected ? 'var(--color-primary)' : 'var(--color-text-main)',
                        fontWeight: isSelected ? '700' : '400',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                    }}>
                        {name}
                    </span>
                    {/* Kept as a sibling text node (rather than folded into the
                        name string) so the plain category name stays matchable
                        on its own, e.g. by accessible-name or text queries. */}
                    {count != null && (
                        <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--color-text-muted)', flexShrink: 0 }}>
                            ({count})
                        </span>
                    )}
                    {isExpander && (
                        <span aria-hidden="true" style={{ fontSize: '0.6rem', color: 'var(--color-text-muted)' }}>
                            {isExpanded ? '▲' : '▼'}
                        </span>
                    )}
                </div>
                <div data-account-value style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                    <span style={{ fontSize: indent ? 'var(--text-xs)' : 'var(--text-sm)', fontWeight: '500', color: isSelected ? 'var(--color-primary)' : 'var(--color-text-main)' }}>
                        €{value.toFixed(0)}
                    </span>
                    {percent !== null && (
                        <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--color-text-muted)', width: '30px', textAlign: 'right' }}>
                            {Math.round(percent * 100)}%
                        </span>
                    )}
                    {showDelta && (
                        <span style={{ fontSize: 'var(--text-2xs)', fontWeight: '700', color: comparison.diff > 0 ? 'var(--color-negative)' : 'var(--color-positive)' }}>
                            {comparison.diff > 0 ? '+' : '−'}{Math.abs(comparison.percent)}%
                        </span>
                    )}
                </div>
            </div>
            {percent !== null && (
                <div
                    aria-hidden="true"
                    data-category-bar={name}
                    style={{
                        height: indent ? '4px' : '6px',
                        marginTop: indent ? '5px' : '7px',
                        borderRadius: '999px',
                        background: 'var(--color-surface-sunken)',
                        overflow: 'hidden'
                    }}
                >
                    <div style={{
                        width: `${Math.max(0, Math.min(percent * 100, 100))}%`,
                        height: '100%',
                        borderRadius: 'inherit',
                        background: color || 'var(--color-border)',
                        opacity: isSelected ? 1 : 0.82,
                        transition: 'width 0.3s ease'
                    }} />
                </div>
            )}
        </div>
    );

    const rowStyle = {
        display: 'flex',
        width: '100%',
        paddingLeft: indent ? '16px' : 0
    };

    if (isExpander) {
        return (
            <button
                type="button"
                onClick={onSelect}
                aria-expanded={isExpanded}
                style={{ ...rowStyle, background: 'transparent', border: 'none', padding: '4px 0', cursor: 'pointer', textAlign: 'left' }}
            >
                {content}
            </button>
        );
    }

    if (onSelect) {
        return (
            <button
                type="button"
                onClick={onSelect}
                aria-pressed={isSelected}
                // Without this the name and amount spans run together into
                // "Housing€98,40" for screen readers - same fix as the "Куда
                // ушло" list in App.jsx.
                aria-label={`${name}: €${value.toLocaleString('de-DE', { minimumFractionDigits: 2 })}`}
                style={{ ...rowStyle, background: 'transparent', border: 'none', padding: '4px 0', cursor: 'pointer', textAlign: 'left' }}
            >
                {content}
            </button>
        );
    }

    return <div style={{ ...rowStyle, padding: '4px 0' }}>{content}</div>;
}

// onToggle is optional: when the category breakdown is reached through the bottom tab bar
// there is nothing to go "back" to, so the button is simply not rendered.
//
// comparison/selectedCategory/onSelectCategory are optional too, and default
// to the plain read-only breakdown this component has always been: no deltas,
// no clickable rows.
export default function CategoryDonut({ data, onToggle, comparison, selectedCategory, onSelectCategory }) {
    const [otherExpanded, setOtherExpanded] = useState(false);

    if (!data) return null;

    const rawCategories = Object.keys(data);
    const total = rawCategories.reduce((acc, cat) => acc + data[cat], 0);

    if (total === 0) return null;

    // Group small categories (< 5% of the total) into "Прочее", and cap the
    // number of categories shown on their own at 6 - anything past that,
    // even if individually above 5%, is folded in too so the legend stays
    // scannable.
    const threshold = total * 0.05;
    const entries = rawCategories.map(cat => ({ name: cat, value: data[cat] }));

    const bigEntries = entries.filter(e => e.value >= threshold).sort((a, b) => b.value - a.value);
    const smallEntries = entries.filter(e => e.value < threshold);

    const mainCategories = bigEntries.slice(0, 6);
    const overflowEntries = bigEntries.slice(6);
    const otherCategories = [...smallEntries, ...overflowEntries].sort((a, b) => b.value - a.value);
    const otherSum = otherCategories.reduce((acc, e) => acc + e.value, 0);

    // Prepare the visible rows and their proportional bar widths.
    const finalChartData = [...mainCategories];
    if (otherSum > 0) {
        finalChartData.push({ name: 'Прочее', value: otherSum, children: otherCategories });
    }

    const segments = finalChartData.map((item, i) => {
        const percent = item.value / total;

        return {
            category: item.name,
            value: item.value,
            percent,
            children: item.children,
            color: item.name === 'Прочее' ? '#64748b' : COLORS[i % COLORS.length]
        };
    });

    return (
        <div className="glass-panel" style={{ padding: '20px', marginTop: '0' }}>
            <div style={{ display: 'grid', gridTemplateColumns: onToggle ? 'auto 1fr auto' : '1fr auto', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                {onToggle && (
                    <button
                        onClick={onToggle}
                        style={{
                            background: 'var(--color-surface-sunken)',
                            border: '1px solid var(--color-border)',
                            borderRadius: 'var(--radius-sm)',
                            padding: '4px 12px',
                            color: 'var(--color-primary)',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            fontSize: 'var(--text-sm)',
                            fontWeight: '600'
                        }}
                    >
                        <span>←</span> Назад
                    </button>
                )}
                <h3 style={{ margin: 0, fontSize: 'var(--text-md)', color: 'var(--color-text-muted)', textAlign: 'left' }}>
                    Расходы по категориям
                </h3>
                <div data-account-value style={{ color: 'var(--color-text-main)', fontSize: 'var(--text-lg)', fontWeight: '700', whiteSpace: 'nowrap' }}>
                    €{total.toFixed(0)}
                </div>
            </div>

            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {segments.map((s, i) => {
                        const isOther = s.category === 'Прочее';

                        if (isOther) {
                            return (
                                <div key={i}>
                                    <CategoryRow
                                        name={s.category}
                                        count={s.children.length}
                                        value={s.value}
                                        percent={s.percent}
                                        color={s.color}
                                        comparison={null}
                                        isSelected={false}
                                        isExpander
                                        isExpanded={otherExpanded}
                                        onSelect={() => setOtherExpanded(prev => !prev)}
                                    />
                                    {otherExpanded && (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px' }}>
                                            {s.children.map(child => (
                                                <CategoryRow
                                                    key={child.name}
                                                    name={child.name}
                                                    value={child.value}
                                                    percent={child.value / total}
                                                    color={s.color}
                                                    comparison={comparison?.[child.name]}
                                                    isSelected={selectedCategory === child.name}
                                                    onSelect={onSelectCategory ? () => onSelectCategory(child.name) : null}
                                                    indent
                                                />
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        }

                        return (
                            <CategoryRow
                                key={i}
                                name={s.category}
                                value={s.value}
                                percent={s.percent}
                                color={s.color}
                                comparison={comparison?.[s.category]}
                                isSelected={selectedCategory === s.category}
                                onSelect={onSelectCategory ? () => onSelectCategory(s.category) : null}
                            />
                        );
                })}
            </div>
        </div>
    );
}
