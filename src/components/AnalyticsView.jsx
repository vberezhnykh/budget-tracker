import React from 'react';
import CategoryDonut from './CategoryDonut';
import MonthlyTrend from './MonthlyTrend';

// maximumFractionDigits matters here in a way it doesn't for the plain sums
// elsewhere in the app: pace figures come out of a division, so without a cap
// "€230,06 в день" renders as the unreadable "€230,063".
const formatEuro = (value) => value.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// "1 день / 2 дня / 5 дней" - Russian needs three forms, and the teens are
// the exception that a plain "ends in 1" rule gets wrong (11 дней, not день).
const pluralDays = (count) => {
    const mod100 = count % 100;
    if (mod100 >= 11 && mod100 <= 14) return 'дней';
    const mod10 = count % 10;
    if (mod10 === 1) return 'день';
    if (mod10 >= 2 && mod10 <= 4) return 'дня';
    return 'дней';
};

// The whole "Аналитика" tab, pulled out of App.jsx so that file stops
// growing: a period summary, the spending-pace card (month view only), the
// monthly bar trend, and the category donut with month-over-month deltas.
export default function AnalyticsView({
    periodStats,
    periodLabel,
    timeRange,
    pace,
    monthlyLimit,
    series,
    selectedMonth,
    onSelectMonth,
    expenseComparison,
    categoryComparison,
    comparisonLabel,
    selectedCategory,
    onSelectCategory
}) {
    const expenseAbs = Math.abs(periodStats.expense);
    const saldo = periodStats.income + periodStats.expense;
    const hasSpending = Object.values(periodStats.categoryTotals || {}).some(v => v > 0);

    // Comparing category spend against "last month" only means something
    // when the period itself is a single month - a year or lifetime total
    // has no single "previous" period to compare against.
    const showCategoryComparison = timeRange === 'month' && !!categoryComparison;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="glass-panel" style={{ padding: '20px' }}>
                <h3 style={{ margin: '0 0 16px', fontSize: 'var(--text-md)', color: 'var(--color-text-muted)' }}>
                    Сводка
                </h3>
                {/* Three equal boxes at phone width leave ~100px each, so the
                    amounts are sized down and pinned to one line: a wrapped
                    "+\n€3.400,00" reads as two separate numbers. The sign is
                    rendered before the € rather than letting toLocaleString
                    put it after it ("€-281,00"). */}
                <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                    {[
                        { label: 'Расход', value: expenseAbs, color: 'var(--color-text-main)', sign: '' },
                        { label: 'Доход', value: periodStats.income, color: 'var(--color-positive)', sign: '' },
                        { label: 'Сальдо', value: Math.abs(saldo), color: saldo < 0 ? 'var(--color-negative)' : 'var(--color-positive)', sign: saldo < 0 ? '−' : (saldo > 0 ? '+' : '') }
                    ].map(box => (
                        <div key={box.label} style={{ flex: 1, minWidth: 0, background: 'var(--color-surface-muted)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-lg)', padding: '12px 10px' }}>
                            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginBottom: '2px' }}>{box.label}</div>
                            <div style={{
                                fontSize: 'var(--text-lg)',
                                fontWeight: '700',
                                color: box.color,
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis'
                            }}>
                                {box.sign}€{formatEuro(box.value)}
                            </div>
                        </div>
                    ))}
                </div>
                <div style={{ fontSize: 'var(--text-2xs)', fontWeight: '700', letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>
                    {periodLabel}
                </div>

                {/* Расход против прошлого месяца. Раньше эта строка стояла на
                    главной, но отвечает она на вопрос разбора («стало больше
                    или меньше»), а не на вопрос «сколько можно ещё потратить»,
                    ради которого туда заходят. Сравнивать с «прошлым месяцем»
                    имеет смысл только когда период - месяц. */}
                {timeRange === 'month' && expenseComparison && (
                    <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--color-border-subtle)' }}>
                        {expenseComparison.percent === null ? (
                            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
                                В прошлом месяце трат не было
                            </div>
                        ) : (
                            <>
                                <div style={{ fontSize: 'var(--text-base)', fontWeight: '700', color: expenseComparison.diff > 0 ? 'var(--color-negative)' : 'var(--color-positive)' }}>
                                    {expenseComparison.diff > 0 ? '↑' : '↓'} {Math.abs(expenseComparison.percent)}% к прошлому месяцу
                                </div>
                                <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                                    {expenseComparison.label}
                                </div>
                            </>
                        )}
                    </div>
                )}
            </div>

            {/* Pace only exists (getPaceForecast returns non-null) for the
                month actually in progress, and only reads sensibly next to
                the month view - a year/lifetime total isn't "on pace". */}
            {pace && timeRange === 'month' && (
                <div className="glass-panel" style={{ padding: '20px' }}>
                    <h3 style={{ margin: '0 0 12px', fontSize: 'var(--text-md)', color: 'var(--color-text-muted)' }}>
                        Темп трат
                    </h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: 'var(--text-base)', color: 'var(--color-text-main)' }}>
                        <div>В среднем €{formatEuro(pace.perDay)} в день</div>
                        <div>Прогноз до конца месяца ~€{formatEuro(pace.forecast)}</div>
                        {/* On the last day of the month there is no "per day
                            left" figure to give (daysLeft is 0), so that half
                            of the sentence drops out rather than dividing by
                            zero or claiming "0 дней". */}
                        {pace.remaining !== null && pace.remaining >= 0 && (
                            <div>
                                Осталось €{formatEuro(pace.remaining)}
                                {pace.perDayLeft !== null && ` — это €${formatEuro(pace.perDayLeft)} в день на оставшиеся ${pace.daysLeft} ${pluralDays(pace.daysLeft)}`}
                            </div>
                        )}
                        {/* An already-blown limit is stated as fact; the
                            forecast warning would only muddy it by adding
                            that it "will be" exceeded. */}
                        {pace.remaining !== null && pace.remaining < 0 ? (
                            <div style={{ color: 'var(--color-negative)', fontWeight: '600' }}>
                                Лимит €{monthlyLimit.toLocaleString('de-DE')} уже превышен на €{formatEuro(Math.abs(pace.remaining))}
                            </div>
                        ) : pace.willExceedLimit && (
                            <div style={{ color: 'var(--color-negative)', fontWeight: '600' }}>
                                При текущем темпе лимит €{monthlyLimit.toLocaleString('de-DE')} будет превышен
                            </div>
                        )}
                    </div>
                </div>
            )}

            <MonthlyTrend series={series} selectedMonth={selectedMonth} onSelectMonth={onSelectMonth} />

            {hasSpending ? (
                <div>
                    {showCategoryComparison && comparisonLabel && (
                        <div style={{ textAlign: 'center', fontSize: 'var(--text-2xs)', color: 'var(--color-text-muted)', marginBottom: '4px' }}>
                            {comparisonLabel}
                        </div>
                    )}
                    <CategoryDonut
                        data={periodStats.categoryTotals}
                        comparison={showCategoryComparison ? categoryComparison : undefined}
                        selectedCategory={selectedCategory}
                        onSelectCategory={onSelectCategory}
                    />
                </div>
            ) : (
                <div className="glass-panel" style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 'var(--text-md)' }}>
                    За выбранный период трат нет
                </div>
            )}
        </div>
    );
}
