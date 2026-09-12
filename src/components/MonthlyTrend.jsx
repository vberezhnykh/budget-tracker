import { useEffect, useRef } from 'react';
import { formatMonthName, formatPeriodLabel, getCurrentMonth } from '../utils/period';
import './MonthlyTrend.css';

const HEIGHT = 176;
const INSET = 12;
const COLUMN_WIDTH = 64;
const formatEuro = value => value.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatTick = value => value.toLocaleString('ru-RU', { notation: 'compact', maximumFractionDigits: 1 });

function getScaleMax(series) {
    const max = Math.max(0, ...series.flatMap(month => [month.income, month.expense]));
    if (max === 0) return 1;
    const rawStep = max / 4;
    const unit = 10 ** Math.floor(Math.log10(rawStep));
    const step = [1, 2, 5, 10].find(value => value * unit >= rawStep) * unit;
    return step * 4;
}

export default function MonthlyTrend({ series = [], selectedMonth, onSelectMonth }) {
    const scrollRef = useRef(null);
    const monthRefs = useRef(new Map());
    const selectedIndex = series.findIndex(month => month.month === selectedMonth);
    const selected = series[selectedIndex];

    // Keep selection visible without rebuilding or recentering the timeline.
    useEffect(() => {
        const scroll = scrollRef.current;
        const button = monthRefs.current.get(selectedMonth);
        if (!scroll || !button) return;
        const reveal = () => {
            const left = button.offsetLeft;
            const right = left + button.offsetWidth;
            if (left < scroll.scrollLeft || right > scroll.scrollLeft + scroll.clientWidth) {
                scroll.scrollTo?.({ left: Math.max(0, right - scroll.clientWidth), behavior: 'instant' });
            }
        };
        reveal();
        if (typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(reveal);
        observer.observe(scroll);
        return () => observer.disconnect();
    }, [selectedMonth, series.length]);

    if (series.length === 0) return null;

    const max = getScaleMax(series);
    const width = series.length * COLUMN_WIDTH;
    const x = index => (index + 0.5) * COLUMN_WIDTH;
    const y = amount => HEIGHT - INSET - (amount / max) * (HEIGHT - INSET * 2);
    const points = key => series.map((month, index) => `${x(index)},${y(month[key])}`).join(' ');
    const ticks = [max, max * 0.75, max * 0.5, max * 0.25, 0];
    const spansYears = new Set(series.map(month => month.year)).size > 1;
    const net = selected ? selected.income - selected.expense : 0;
    const currentMonth = getCurrentMonth();

    const selectRelativeMonth = delta => {
        const month = series[selectedIndex + delta];
        if (month) onSelectMonth(month.month);
    };

    const handleKeyDown = (event, index) => {
        const nextIndex = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: series.length - 1 }[event.key];
        if (nextIndex === undefined) return;
        event.preventDefault();
        const next = series[Math.max(0, Math.min(series.length - 1, nextIndex))];
        onSelectMonth(next.month);
        monthRefs.current.get(next.month)?.focus({ preventScroll: true });
    };

    return (
        <section className="glass-panel monthly-trend" aria-label="Динамика по месяцам">
            <div className="monthly-trend__heading">
                <div>
                    <h3>Динамика по месяцам</h3>
                    <p>Доходы и расходы, €</p>
                </div>
                <div className="monthly-trend__navigation">
                    <button type="button" aria-label="Предыдущий месяц" disabled={selectedIndex <= 0} onClick={() => selectRelativeMonth(-1)}>‹</button>
                    <button type="button" aria-label="Следующий месяц" disabled={selectedIndex < 0 || selectedIndex >= series.length - 1} onClick={() => selectRelativeMonth(1)}>›</button>
                </div>
            </div>

            <div className="monthly-trend__legend">
                <span><i className="monthly-trend__key monthly-trend__key--income" />Доход</span>
                <span><i className="monthly-trend__key monthly-trend__key--expense" />Расход</span>
            </div>

            <div className="monthly-trend__plot">
                <div className="monthly-trend__axis" aria-hidden="true" style={{ height: HEIGHT }}>
                    {ticks.map(tick => <span key={tick} style={{ top: y(tick) }}>{formatTick(tick)}</span>)}
                </div>
                <div ref={scrollRef} className="monthly-trend__scroll" data-testid="monthly-trend-scroll">
                    <div className="monthly-trend__track" style={{ minWidth: width }}>
                        <svg width="100%" height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} preserveAspectRatio="none" aria-hidden="true" className="monthly-trend__chart">
                            {ticks.map(tick => <line key={tick} x1="0" x2={width} y1={y(tick)} y2={y(tick)} className="monthly-trend__grid" />)}
                            <polygon points={`${x(0)},${y(0)} ${points('expense')} ${x(series.length - 1)},${y(0)}`} className="monthly-trend__area" />
                            <polyline points={points('income')} className="monthly-trend__line monthly-trend__line--income" />
                            <polyline points={points('expense')} className="monthly-trend__line monthly-trend__line--expense" />
                            {series.map((month, index) => (
                                <g key={month.month}>
                                    <circle cx={x(index)} cy={y(month.income)} r={index === selectedIndex ? 5 : 3} className="monthly-trend__point monthly-trend__point--income" />
                                    <rect x={x(index) - (index === selectedIndex ? 4 : 2.5)} y={y(month.expense) - (index === selectedIndex ? 4 : 2.5)} width={index === selectedIndex ? 8 : 5} height={index === selectedIndex ? 8 : 5} rx="1" className="monthly-trend__point monthly-trend__point--expense" />
                                </g>
                            ))}
                        </svg>
                        <div className="monthly-trend__months">
                            {series.map((month, index) => (
                                <button
                                    key={month.month}
                                    ref={element => { if (element) monthRefs.current.set(month.month, element); else monthRefs.current.delete(month.month); }}
                                    type="button"
                                    className="monthly-trend__month"
                                    aria-pressed={month.month === selectedMonth}
                                    aria-label={`${formatMonthName(month.month)} ${month.year}: расход €${formatEuro(month.expense)}, доход €${formatEuro(month.income)}`}
                                    onClick={() => onSelectMonth(month.month)}
                                    onKeyDown={event => handleKeyDown(event, index)}
                                    style={{ paddingTop: HEIGHT + 8 }}
                                >
                                    <span>{month.label}</span>
                                    {spansYears && <small>{month.year}</small>}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
            <p className="monthly-trend__hint">Листайте график · Нажмите на месяц для подробностей</p>

            {selected && (
                <div className="monthly-trend__detail" aria-live="polite" aria-atomic="true">
                    <div className="monthly-trend__selected-label">
                        <strong>{formatPeriodLabel('month', selectedMonth)}</strong>
                        {selectedMonth === currentMonth && <span>Месяц ещё идёт</span>}
                    </div>
                    <dl className="monthly-trend__totals">
                        <div><dt>Доход</dt><dd className="monthly-trend__income">€{formatEuro(selected.income)}</dd></div>
                        <div><dt>Расход</dt><dd>€{formatEuro(selected.expense)}</dd></div>
                        <div><dt>Сальдо</dt><dd className={net < 0 ? 'monthly-trend__negative' : 'monthly-trend__income'}>{net < 0 ? '−' : net > 0 ? '+' : ''}€{formatEuro(Math.abs(net))}</dd></div>
                    </dl>
                    {selected.income === 0 && selected.expense === 0 && <p className="monthly-trend__empty">Нет доходов и расходов за этот месяц</p>}
                </div>
            )}
        </section>
    );
}
