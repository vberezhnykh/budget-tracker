import React from 'react';
import { formatMonthName } from '../utils/period';

// Chart area height in px - kept out of the JSX so the bar-height math and
// the container's own height agree with each other.
const CHART_HEIGHT = 110;

// A row of thin twin bars (expense/income) per month, so a spending spike or
// an income month stands out at a glance without opening the donut.
export default function MonthlyTrend({ series, selectedMonth, onSelectMonth }) {
    // A chart with a single bar can't show a trend, so there is nothing
    // useful to render.
    if (!series || series.length < 2) return null;

    const max = Math.max(1, ...series.flatMap(s => [s.income, s.expense]));
    // The year label under a bar is only worth showing when the series
    // actually crosses a year boundary - most views are a single year.
    const spansMultipleYears = new Set(series.map(s => s.year)).size > 1;

    return (
        <div className="glass-panel" style={{ padding: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                <h3 style={{ margin: 0, fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>
                    Динамика по месяцам
                </h3>
                <div style={{ display: 'flex', gap: '10px', fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <span style={{ width: '8px', height: '8px', borderRadius: '2px', background: '#f43f5e', display: 'inline-block' }} />
                        Расход
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <span style={{ width: '8px', height: '8px', borderRadius: '2px', background: '#10b981', display: 'inline-block' }} />
                        Доход
                    </span>
                </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '4px' }}>
                {series.map((s, i) => {
                    const isSelected = s.month === selectedMonth;
                    // A minimum visible sliver for non-zero values, so a
                    // small-but-real month doesn't read as empty.
                    const expenseHeight = s.expense > 0 ? Math.max((s.expense / max) * CHART_HEIGHT, 2) : 0;
                    const incomeHeight = s.income > 0 ? Math.max((s.income / max) * CHART_HEIGHT, 2) : 0;
                    const showYear = spansMultipleYears && (i === 0 || series[i - 1].year !== s.year);

                    return (
                        <button
                            key={s.month}
                            type="button"
                            onClick={() => onSelectMonth(s.month)}
                            aria-pressed={isSelected}
                            aria-label={`${formatMonthName(s.month)} ${s.year}: расход €${s.expense.toLocaleString('de-DE', { minimumFractionDigits: 2 })}, доход €${s.income.toLocaleString('de-DE', { minimumFractionDigits: 2 })}`}
                            style={{
                                flex: 1,
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                background: isSelected ? 'rgba(37, 99, 235, 0.08)' : 'transparent',
                                border: 'none',
                                borderRadius: '8px',
                                padding: '4px 2px 6px',
                                cursor: 'pointer'
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height: `${CHART_HEIGHT}px` }}>
                                <div style={{ width: '6px', height: `${expenseHeight}px`, background: '#f43f5e', borderRadius: '2px 2px 0 0', transition: 'height 0.3s ease' }} />
                                <div style={{ width: '6px', height: `${incomeHeight}px`, background: '#10b981', borderRadius: '2px 2px 0 0', transition: 'height 0.3s ease' }} />
                            </div>
                            <div style={{ fontSize: '0.7rem', color: isSelected ? 'var(--color-primary)' : 'var(--color-text-muted)', fontWeight: isSelected ? '700' : '500', marginTop: '6px' }}>
                                {s.label}
                            </div>
                            {/* Reserved for every column once any of them
                                needs a year, otherwise the taller columns
                                would push their bars up off the shared
                                baseline the chart is read against. */}
                            {spansMultipleYears && (
                                <div style={{ fontSize: '0.6rem', color: 'var(--color-text-muted)' }}>
                                    {showYear ? s.year : ' '}
                                </div>
                            )}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
