import CategoryBars from './CategoryBars';
import CategoryBarsEmpty from './CategoryBarsEmpty';
import MonthlyTrend from './MonthlyTrend';
import PaceCard from './PaceCard';
import Card from './ui/Card';
import { formatMoney } from '../utils/money';

const SECTION_TITLE_STYLE = {
    margin: 0,
    fontSize: 'var(--text-xl)',
    fontWeight: 'var(--weight-strong)',
};

// Строка «Доход / Расход / Сальдо» в итогах: подпись слева, сумма справа.
function TotalsRow({ label, value, color, divider }) {
    return (
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-3)', padding: 'var(--space-2) 0', borderTop: divider ? '1px solid var(--color-border-subtle)' : 'none' }}>
            <div style={{ fontSize: 'var(--text-md)', color: 'var(--color-text-muted)' }}>{label}</div>
            <div data-account-value style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-strong)', color, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                {value}
            </div>
        </div>
    );
}

// Содержимое вкладки «Аналитика» под заголовком экрана, сверху вниз: темп
// трат (только месяц), категории, расход по месяцам, итоги периода. Заголовок
// с выбором периода живёт в AnalyticsScreen, вне обёртки ожидания: период
// должен меняться и пока цифры грузятся.
export default function AnalyticsView({
    periodStats,
    timeRange,
    typicalMonth,
    monthlyLimit,
    series,
    selectedMonth,
    onSelectMonth,
    expenseComparison,
    categoryComparison,
    comparisonLabel,
    onOpenCategory
}) {
    const expenseAbs = Math.abs(periodStats.expense);
    const saldo = periodStats.income + periodStats.expense;
    const hasSpending = Object.values(periodStats.categoryTotals || {}).some(v => v > 0);

    // Comparing category spend against "last month" only means something
    // when the period itself is a single month - a year or lifetime total
    // has no single "previous" period to compare against.
    const showCategoryComparison = timeRange === 'month' && !!categoryComparison;

    let saldoColor = 'var(--color-text-main)';
    if (saldo < 0) saldoColor = 'var(--color-negative)';
    else if (saldo > 0) saldoColor = 'var(--color-positive)';

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', minWidth: 0 }}>
            {/* Темп трат есть только у месяца: у года и «всего времени» нет
                «обычного месяца», с которым сравнивать. Если истории меньше
                трёх полных месяцев, сервер отдаёт null - тогда вместо графика
                одна строка с объяснением. */}
            {timeRange === 'month' && (typicalMonth ? (
                <PaceCard typicalMonth={typicalMonth} selectedMonth={selectedMonth} monthlyLimit={monthlyLimit} />
            ) : (
                <Card tone="muted" padding="lg" style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-base)', lineHeight: 1.5 }}>
                    Для сравнения с обычным месяцем нужно хотя бы три полных месяца истории.
                </Card>
            ))}

            {hasSpending ? (
                <CategoryBars
                    data={periodStats.categoryTotals}
                    comparison={showCategoryComparison ? categoryComparison : undefined}
                    comparisonLabel={comparisonLabel}
                    onSelectCategory={onOpenCategory}
                />
            ) : timeRange === 'month' ? (
                <CategoryBarsEmpty selectedMonth={selectedMonth} onSelectMonth={onSelectMonth} />
            ) : (
                <Card padding="lg" style={{ textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 'var(--text-md)' }}>
                    <span data-account-value>За выбранный период трат нет</span>
                </Card>
            )}

            <MonthlyTrend
                series={series}
                selectedMonth={selectedMonth}
                onSelectMonth={onSelectMonth}
                timeRange={timeRange}
                limit={monthlyLimit}
                forecast={typicalMonth?.today?.forecast ?? null}
            />

            <Card as="section" padding="lg">
                <h2 style={{ ...SECTION_TITLE_STYLE, marginBottom: 'var(--space-2)' }}>Итоги</h2>
                <div>
                    <TotalsRow label="Доход" value={formatMoney(periodStats.income, { sign: 'auto' })} color="var(--color-positive)" />
                    <TotalsRow label="Расход" value={formatMoney(expenseAbs, { sign: 'minus' })} color="var(--color-text-main)" divider />
                    <TotalsRow label="Сальдо" value={formatMoney(saldo, { sign: 'auto' })} color={saldoColor} divider />
                </div>
                {/* Расход против прошлого месяца. Эта строка отвечает на
                    вопрос разбора («стало больше или меньше»), а не на
                    вопрос «сколько можно ещё потратить». Сравнивать с
                    «прошлым месяцем» имеет смысл только когда период - месяц. */}
                {timeRange === 'month' && expenseComparison && (
                    <div data-account-value style={{ marginTop: 'var(--space-3)', paddingTop: 'var(--space-3)', borderTop: '1px solid var(--color-border-subtle)' }}>
                        {expenseComparison.percent === null ? (
                            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
                                В прошлом месяце трат не было
                            </div>
                        ) : (
                            <>
                                <div style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--weight-strong)', color: expenseComparison.diff > 0 ? 'var(--color-negative)' : 'var(--color-positive)' }}>
                                    {expenseComparison.diff > 0 ? '↑' : '↓'} {Math.abs(expenseComparison.percent)}% к прошлому месяцу
                                </div>
                                <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--color-text-muted)', marginTop: 'var(--space-1)' }}>
                                    {expenseComparison.label}
                                </div>
                            </>
                        )}
                    </div>
                )}
            </Card>
        </div>
    );
}
