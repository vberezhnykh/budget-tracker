import Card from './ui/Card';
import { formatMoney } from '../utils/money';
import { formatDayMonth, formatMonthName, getCurrentMonth } from '../utils/period';
import { monthLocative } from '../utils/monthNames';
import useMonthTimeline, { VISIBLE_MONTHS } from './useMonthTimeline';
import './MonthlyTrend.css';
import './MonthCharts.css';

// Деньги в наличии по месяцам: остаток на конец каждого месяца линией. У
// всех счетов это капитал без счетов «вне общего капитала» (вклады, обмен) -
// та же цифра, что на карточке «Все счета»; у выбранного счёта - его остаток.
// Ряд месяцев и выбор те же, что у остальных графиков экрана.
//
// Линия рисуется одним SVG поверх всего ряда (viewBox растягивается на
// ширину дорожки, толщина линии от растяжения не зависит), а точка
// выбранного месяца - внутри его кнопки, чтобы оставаться круглой.

// Запас сверху и снизу, доля от размаха значений.
const PADDING = 0.15;

// Шкала не от нуля: остаток меняется на проценты, и от нуля линия выглядела
// бы прямой. Если все значения равны, размах берётся от самого значения.
// Линия нуля рисуется, только когда остаток уходил в минус.
function getDomain(values) {
    const low = Math.min(...values);
    const high = Math.max(...values);
    const span = high - low || Math.max(Math.abs(high), 1);
    // Запас снизу не уводит шкалу за ноль, если остаток в минус не уходил:
    // иначе линия нуля появилась бы там, где отрицательных значений нет.
    const paddedLow = low - span * PADDING;
    return { low: low >= 0 ? Math.max(paddedLow, 0) : paddedLow, high: high + span * PADDING };
}

// «на конец августа 2026», а для идущего месяца - «сейчас».
function balanceCaption(month, currentMonth) {
    if (month === currentMonth) return 'сейчас';
    const genitive = formatDayMonth(month, 1).replace(/^\d+\s/, '');
    return `на конец ${genitive} ${month.slice(0, 4)}`;
}

export default function BalanceTrend({ series = [], selectedMonth, onSelectMonth, timeRange = 'month', title = 'Деньги в наличии' }) {
    const { scrollRef, monthRef, handleKeyDown, showYear } = useMonthTimeline({ series, selectedMonth, onSelectMonth });

    const values = series.filter(month => month.balance !== null).map(month => month.balance);
    if (values.length === 0) return null;

    const currentMonth = getCurrentMonth();
    const visible = VISIBLE_MONTHS[timeRange] ?? VISIBLE_MONTHS.month;
    const { low, high } = getDomain(values);
    const ratio = value => (value - low) / (high - low);
    const y = value => (1 - ratio(value)) * 100;

    // Остатки нет только в начале ряда (до первой операции), поэтому линия
    // одна, без разрывов.
    const points = series
        .map((month, index) => (month.balance === null ? null : [index + 0.5, y(month.balance)]))
        .filter(Boolean);
    const line = points.map(([x, py], index) => `${index === 0 ? 'M' : 'L'}${x} ${py}`).join(' ');
    const area = `${line} L${points[points.length - 1][0]} 100 L${points[0][0]} 100 Z`;
    const zeroY = low < 0 && high > 0 ? y(0) : null;

    const selectedIndex = series.findIndex(month => month.month === selectedMonth);
    const selected = selectedIndex >= 0 ? series[selectedIndex] : null;
    const previous = selectedIndex > 0 ? series[selectedIndex - 1].balance : null;
    const change = selected && selected.balance !== null && previous !== null ? selected.balance - previous : null;
    let changeColor = 'var(--color-text-muted)';
    if (change < 0) changeColor = 'var(--color-negative)';
    else if (change > 0) changeColor = 'var(--color-positive)';

    return (
        <Card as="section" padding="lg" className="monthly-trend month-chart balance-trend" aria-labelledby="balance-trend-title">
            <h2 id="balance-trend-title" className="monthly-trend__title">{title}</h2>

            {selected && (
                <div data-account-value className="balance-trend__summary">
                    {selected.balance === null ? (
                        <div className="month-chart__period">{`${monthLocative(selected.month).replace(/^в/, 'В')} операций по счёту ещё не было`}</div>
                    ) : (
                        <>
                            <div className="balance-trend__value">{formatMoney(selected.balance)}</div>
                            <div className="month-chart__period">
                                {balanceCaption(selected.month, currentMonth)}
                                {change !== null && (
                                    <span style={{ color: changeColor }}>
                                        {` · ${change === 0 ? 'без изменений' : `${formatMoney(change, { sign: 'auto' })} за месяц`}`}
                                    </span>
                                )}
                            </div>
                        </>
                    )}
                </div>
            )}

            <div data-account-value className="monthly-trend__scroll" data-testid="balance-trend-scroll" ref={scrollRef}>
                <div className="monthly-trend__track" style={{ width: `${Math.max(100, (series.length / visible) * 100)}%` }}>
                    <svg className="balance-trend__lines" viewBox={`0 0 ${series.length} 100`} preserveAspectRatio="none" aria-hidden="true">
                        {zeroY !== null && (
                            <line data-testid="balance-trend-zero" className="balance-trend__zero" x1="0" x2={series.length} y1={zeroY} y2={zeroY} vectorEffect="non-scaling-stroke" />
                        )}
                        <path className="balance-trend__area" d={area} />
                        <path data-testid="balance-trend-line" className="balance-trend__line" d={line} vectorEffect="non-scaling-stroke" />
                    </svg>
                    {series.map((month, index) => {
                        const isSelected = month.month === selectedMonth;
                        const hasBalance = month.balance !== null;
                        const label = `${formatMonthName(month.month)} ${month.year}: `
                            + (hasBalance ? `остаток ${formatMoney(month.balance)}` : 'операций ещё не было');
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
                                onClick={() => onSelectMonth(month.month)}
                                onKeyDown={event => handleKeyDown(event, index)}
                            >
                                <span className="monthly-trend__plot balance-trend__plot" aria-hidden="true">
                                    {isSelected && hasBalance && (
                                        <>
                                            <span className="balance-trend__guide" style={{ height: `${ratio(month.balance) * 100}%` }} />
                                            <span data-testid="balance-trend-dot" className="balance-trend__dot" style={{ bottom: `${ratio(month.balance) * 100}%` }} />
                                        </>
                                    )}
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
