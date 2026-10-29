import Card from './ui/Card';
import { formatMoney } from '../utils/money';
import { formatMonthName, getCurrentMonth } from '../utils/period';
import { isLimitUsable } from '../utils/paceChart';
import { getTrendCaption } from '../utils/trendCaption';
import useMonthTimeline, { VISIBLE_MONTHS } from './useMonthTimeline';
import './MonthlyTrend.css';

// Расход по месяцам столбцами. Сколько месяцев помещается на экран без
// прокрутки - см. VISIBLE_MONTHS.

// Запас сверху шкалы, чтобы самый высокий столбец не упирался в край.
const HEADROOM = 1.1;

function getScaleMax(series, limit, forecast) {
    const max = Math.max(0, limit ?? 0, forecast ?? 0, ...series.map(month => month.expense)) * HEADROOM;
    return max > 0 ? max : 1;
}

export default function MonthlyTrend({ series = [], selectedMonth, onSelectMonth, timeRange = 'month', limit = null, forecast = null }) {
    const { scrollRef, monthRef, handleClick, handleKeyDown, showYear } = useMonthTimeline({ series, selectedMonth, onSelectMonth });

    if (series.length === 0) return null;

    const currentMonth = getCurrentMonth();
    const visible = VISIBLE_MONTHS[timeRange] ?? VISIBLE_MONTHS.month;
    // Лимит месячный, поэтому имеет смысл рядом со столбцами месяцев, но не в
    // «всём времени», где период - не месяц.
    const showLimit = timeRange !== 'lifetime' && isLimitUsable(limit);
    const ghostForecast = Number.isFinite(forecast) && forecast > 0 ? forecast : null;
    const max = getScaleMax(series, showLimit ? limit : null, ghostForecast);
    const ratio = amount => Math.min(Math.max(amount / max, 0), 1);
    const hasGhost = ghostForecast !== null && series.some(month => month.month === currentMonth);
    const caption = timeRange === 'month' ? getTrendCaption(series, { limit, currentMonth, visible }) : null;

    return (
        <Card as="section" padding="lg" className="monthly-trend" aria-labelledby="monthly-trend-title">
            <h2 id="monthly-trend-title" className="monthly-trend__title">По месяцам</h2>

            <div
                data-account-value
                className="monthly-trend__scroll"
                data-testid="monthly-trend-scroll"
                ref={scrollRef}
            >
                <div className="monthly-trend__track" style={{ width: `${Math.max(100, (series.length / visible) * 100)}%` }}>
                    {showLimit && (
                        <div
                            data-testid="monthly-trend-limit"
                            className="monthly-trend__limit"
                            style={{ bottom: `calc(var(--trend-label-height) + var(--trend-plot-height) * ${ratio(limit)})` }}
                        />
                    )}
                    {series.map((month, index) => {
                        const isSelected = month.month === selectedMonth;
                        const isOver = showLimit && month.expense > limit;
                        const isCurrent = month.month === currentMonth;
                        const ghost = hasGhost && isCurrent;
                        // Цвет столбца: за лимитом - тревожный; у идущего месяца с
                        // прогнозом - акцент, одного семейства с пунктирным контуром;
                        // остальные - серые. Выбранный месяц столбцом не выделяется:
                        // его отмечает светлое поле за столбцом (см. MonthlyTrend.css).
                        let barColor = 'var(--color-control-off)';
                        if (isOver) barColor = 'var(--color-negative)';
                        else if (ghost) barColor = 'var(--color-primary)';
                        const label = `${formatMonthName(month.month)} ${month.year}: расход ${formatMoney(month.expense)}`
                            + (ghost ? `, прогноз ${formatMoney(ghostForecast, { whole: true })}` : '')
                            + (isOver ? ', лимит превышен' : '');
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
                                    {ghost && (
                                        <span
                                            data-testid="monthly-trend-ghost"
                                            className="monthly-trend__bar monthly-trend__bar--ghost"
                                            style={{ height: `${ratio(Math.max(ghostForecast, month.expense)) * 100}%` }}
                                        />
                                    )}
                                    <span
                                        data-testid="monthly-trend-bar"
                                        data-over-limit={isOver || undefined}
                                        className="monthly-trend__bar"
                                        style={{
                                            height: `${ratio(month.expense) * 100}%`,
                                            minHeight: month.expense > 0 ? 2 : 0,
                                            background: barColor,
                                        }}
                                    />
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

            {(showLimit || hasGhost) && (
                <div className="monthly-trend__legend">
                    {showLimit && (
                        <span><i className="monthly-trend__key monthly-trend__key--limit" />{`лимит ${formatMoney(limit, { whole: true })}`}</span>
                    )}
                    {hasGhost && (
                        <span><i className="monthly-trend__key monthly-trend__key--forecast" />прогноз месяца</span>
                    )}
                </div>
            )}

            {caption && <p className="monthly-trend__caption">{caption}</p>}
        </Card>
    );
}
