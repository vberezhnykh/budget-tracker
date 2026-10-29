import Card from './ui/Card';
import { formatMoney } from '../utils/money';
import { formatMonthName } from '../utils/period';
import useMonthTimeline, { VISIBLE_MONTHS } from './useMonthTimeline';
import './MonthlyTrend.css';
import './MonthCharts.css';

// Доход и расход по месяцам парами столбцов на одной шкале: видно, как они
// соотносятся в каждом месяце. Цифры выбранного месяца стоят над графиком и
// заодно служат легендой; они в целых евро, чтобы три суммы помещались в
// строку и на узком телефоне (точные - в подписях столбцов). Под цифрами -
// сравнение расхода с прошлым месяцем (только в режиме «месяц»): отдельной
// карточки «Итоги» у месяца нет. Месяцы те же, что у «По месяцам», и нажатие так же выбирает
// месяц всего экрана. Переводы и операции «не в статистике» в эти итоги не
// входят (их отсекает сервер, см. computeMonthlyTotalsByAccount).

// Запас сверху шкалы, чтобы самый высокий столбец не упирался в край.
const HEADROOM = 1.1;

// Расход против прошлого месяца. Эта строка отвечает на вопрос разбора
// («стало больше или меньше»), а не на вопрос «сколько можно ещё потратить».
function ExpenseComparison({ comparison }) {
    return (
        <div
            data-account-value
            data-testid="expense-comparison"
            style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-0-5)',
                margin: '0 0 var(--space-4)',
                padding: '10px 12px',
                borderRadius: 'var(--radius-md)',
                background: 'var(--color-surface-muted)',
            }}
        >
            {comparison.percent === null ? (
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
                    В прошлом месяце трат не было
                </span>
            ) : (
                <>
                    <span style={{ fontSize: 'var(--text-md)', fontWeight: 'var(--weight-strong)', color: comparison.diff > 0 ? 'var(--color-negative)' : 'var(--color-positive)' }}>
                        {comparison.diff > 0 ? '↑' : '↓'} {Math.abs(comparison.percent)}% к прошлому месяцу
                    </span>
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                        {comparison.label}
                    </span>
                </>
            )}
        </div>
    );
}

export default function IncomeExpenseChart({ series = [], selectedMonth, onSelectMonth, timeRange = 'month', expenseComparison = null }) {
    const { scrollRef, monthRef, handleClick, handleKeyDown, showYear } = useMonthTimeline({ series, selectedMonth, onSelectMonth });

    if (series.length === 0) return null;

    const visible = VISIBLE_MONTHS[timeRange] ?? VISIBLE_MONTHS.month;
    // Шкала по всему ряду, а не по видимой части: при прокрутке столбцы не
    // должны менять высоту.
    const max = Math.max(0, ...series.flatMap(month => [month.income, month.expense])) * HEADROOM || 1;
    const height = amount => `${Math.min(Math.max(amount / max, 0), 1) * 100}%`;
    const selected = series.find(month => month.month === selectedMonth);
    const difference = selected ? selected.income - selected.expense : 0;
    let differenceColor = 'var(--color-text-main)';
    if (difference < 0) differenceColor = 'var(--color-negative)';
    else if (difference > 0) differenceColor = 'var(--color-positive)';

    return (
        <Card as="section" padding="lg" className="monthly-trend month-chart" aria-labelledby="income-expense-title">
            <div className="month-chart__head">
                <h2 id="income-expense-title" className="monthly-trend__title">Доходы и расходы</h2>
                {selected && <span className="month-chart__period">{`${formatMonthName(selected.month)} ${selected.year}`}</span>}
            </div>

            {selected && (
                <dl data-account-value className="month-chart__stats">
                    {/* Целые евро: в узком ряду из трёх колонок на 320px центы не помещаются */}
                    <div>
                        <dt><i className="month-chart__key month-chart__key--income" aria-hidden="true" />Доход</dt>
                        <dd style={{ color: 'var(--color-positive)' }}>{formatMoney(selected.income, { sign: 'auto', whole: true })}</dd>
                    </div>
                    <div>
                        <dt><i className="month-chart__key month-chart__key--expense" aria-hidden="true" />Расход</dt>
                        <dd>{formatMoney(selected.expense, { sign: 'minus', whole: true })}</dd>
                    </div>
                    <div>
                        <dt>Сальдо</dt>
                        <dd style={{ color: differenceColor }}>{formatMoney(difference, { sign: 'auto', whole: true })}</dd>
                    </div>
                </dl>
            )}

            {/* Сравнение относится к месяцу периода, а им в режиме «месяц» и
                есть выбранный: в других режимах AnalyticsView его не передаёт. */}
            {selected && timeRange === 'month' && expenseComparison && <ExpenseComparison comparison={expenseComparison} />}

            <div data-account-value className="monthly-trend__scroll" data-testid="income-expense-scroll" ref={scrollRef}>
                <div className="monthly-trend__track" style={{ width: `${Math.max(100, (series.length / visible) * 100)}%` }}>
                    {series.map((month, index) => {
                        const isSelected = month.month === selectedMonth;
                        const label = `${formatMonthName(month.month)} ${month.year}: доход ${formatMoney(month.income)}, расход ${formatMoney(month.expense)}`;
                        return (
                            <button
                                key={month.month}
                                ref={monthRef(month.month)}
                                type="button"
                                className="monthly-trend__month"
                                data-month={month.month}
                                aria-pressed={isSelected}
                                aria-label={label}
                                title={label}
                                onClick={handleClick(month.month)}
                                onKeyDown={event => handleKeyDown(event, index)}
                            >
                                <span className="monthly-trend__plot" aria-hidden="true">
                                    <span className="month-chart__pair">
                                        <span
                                            data-testid="income-bar"
                                            className="month-chart__bar month-chart__bar--income"
                                            style={{ height: height(month.income), minHeight: month.income > 0 ? 2 : 0 }}
                                        />
                                        <span
                                            data-testid="expense-bar"
                                            className="month-chart__bar month-chart__bar--expense"
                                            style={{ height: height(month.expense), minHeight: month.expense > 0 ? 2 : 0 }}
                                        />
                                    </span>
                                </span>
                                <span className="monthly-trend__label" style={{ fontWeight: isSelected ? 'var(--weight-strong)' : 'var(--weight-text)', color: isSelected ? 'var(--color-text-main)' : undefined }}>
                                    {month.label}
                                    {showYear(index) && <small>{month.year}</small>}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </div>
        </Card>
    );
}
