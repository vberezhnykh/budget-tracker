import React from 'react';

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

export default function CategoryDonut({ data, onToggle }) {
    const rawCategories = Object.keys(data);
    const total = rawCategories.reduce((acc, cat) => acc + data[cat], 0);

    if (total === 0) return null;

    // Group small categories (< 5%)
    const threshold = total * 0.05;
    const mainCategories = [];
    let otherSum = 0;

    rawCategories.forEach(cat => {
        if (data[cat] < threshold) {
            otherSum += data[cat];
        } else {
            mainCategories.push({ name: cat, value: data[cat] });
        }
    });

    // Sort main categories by value
    mainCategories.sort((a, b) => b.value - a.value);

    // Add "Other" if it exists
    const finalChartData = [...mainCategories];
    if (otherSum > 0) {
        finalChartData.push({ name: 'Прочее', value: otherSum });
    }

    // Prepare data for SVG segments
    let cumulativePercent = 0;
    const segments = finalChartData.map((item, i) => {
        const percent = item.value / total;
        const startPercent = cumulativePercent;
        cumulativePercent += percent;

        return {
            category: item.name,
            value: item.value,
            percent,
            startPercent,
            color: item.name === 'Прочее' ? '#64748b' : COLORS[i % COLORS.length]
        };
    });

    const getCoordinatesForPercent = (percent) => {
        const x = Math.cos(2 * Math.PI * percent);
        const y = Math.sin(2 * Math.PI * percent);
        return [x, y];
    };

    return (
        <div className="glass-panel" style={{ padding: '20px', marginTop: '0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <button
                    onClick={onToggle}
                    style={{
                        background: 'rgba(0,0,0,0.03)',
                        border: '1px solid rgba(0,0,0,0.08)',
                        borderRadius: '8px',
                        padding: '4px 12px',
                        color: 'var(--color-primary)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        fontSize: '0.8rem',
                        fontWeight: '600'
                    }}
                >
                    <span>←</span> Назад
                </button>
                <h3 style={{ margin: 0, fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>
                    Аналитика трат
                </h3>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px' }}>
                {/* SVG Donut */}
                <div style={{ position: 'relative', width: '150px', height: '150px' }}>
                    <svg viewBox="-1 -1 2 2" style={{ transform: 'rotate(-90deg)', width: '100%', height: '100%' }}>
                        {segments.map((s, i) => {
                            const [startX, startY] = getCoordinatesForPercent(s.startPercent);
                            const [endX, endY] = getCoordinatesForPercent(s.startPercent + s.percent);
                            const largeArcFlag = s.percent > 0.5 ? 1 : 0;
                            const pathData = [
                                `M ${startX} ${startY}`,
                                `A 1 1 0 ${largeArcFlag} 1 ${endX} ${endY}`,
                                `L 0 0`,
                            ].join(' ');

                            return (
                                <path
                                    key={i}
                                    d={pathData}
                                    fill={s.color}
                                    stroke="var(--color-bg)"
                                    strokeWidth="0.01"
                                    style={{ transition: 'all 0.3s ease' }}
                                />
                            );
                        })}
                        <circle cx="0" cy="0" r="0.78" fill="var(--color-bg)" />
                    </svg>

                    <div style={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        textAlign: 'center'
                    }}>
                        <div style={{ width: '100%' }}>
                            <div style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '2px' }}>Всего</div>
                            <div style={{ fontWeight: '700', fontSize: '1rem', color: 'var(--color-text-main)' }}>€{total.toFixed(0)}</div>
                        </div>
                    </div>
                </div>

                {/* Legend */}
                <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {segments.map((s, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: s.color }} />
                                <span style={{ fontSize: '0.8rem', color: 'var(--color-text-main)' }}>{s.category}</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ fontSize: '0.8rem', fontWeight: '500', color: 'var(--color-text-main)' }}>€{s.value.toFixed(0)}</span>
                                <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', width: '30px', textAlign: 'right' }}>
                                    {Math.round(s.percent * 100)}%
                                </span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
