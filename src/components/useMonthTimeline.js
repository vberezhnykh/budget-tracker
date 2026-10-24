import { useEffect, useRef } from 'react';
import holdScrollAnchor from '../utils/holdScrollAnchor';

// Сколько месяцев помещается на экран без прокрутки: полгода для месячного
// вида и год для годового; весь ряд при этом остаётся доступным
// горизонтальной прокруткой, а выбранный месяц всегда показывается.
export const VISIBLE_MONTHS = { month: 6, year: 12, lifetime: 12 };

// Общая механика графиков по месяцам (MonthlyTrend, IncomeExpenseChart,
// BalanceTrend): ряд кнопок-месяцев в горизонтальной прокрутке, выбранный
// месяц всегда виден, стрелки и Home/End двигают выбор.
export default function useMonthTimeline({ series, selectedMonth, onSelectMonth }) {
    const scrollRef = useRef(null);
    const monthRefs = useRef(new Map());

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

    const monthRef = month => element => {
        if (element) monthRefs.current.set(month, element);
        else monthRefs.current.delete(month);
    };

    // Выбор месяца меняет высоту блоков над графиком (категории, темп трат),
    // поэтому нажатый график держится на месте экрана (см. holdScrollAnchor).
    const selectMonth = (month, element) => {
        holdScrollAnchor(element);
        onSelectMonth(month);
    };

    const handleClick = month => event => selectMonth(month, event.currentTarget);

    const handleKeyDown = (event, index) => {
        const nextIndex = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: series.length - 1 }[event.key];
        if (nextIndex === undefined) return;
        event.preventDefault();
        const next = series[Math.max(0, Math.min(series.length - 1, nextIndex))];
        selectMonth(next.month, event.currentTarget);
        monthRefs.current.get(next.month)?.focus({ preventScroll: true });
    };

    // Год подписывается под первым месяцем ряда и под каждым, где он меняется:
    // год под всеми столбцами только засорял бы узкие подписи.
    const spansYears = new Set(series.map(month => month.year)).size > 1;
    const showYear = index => spansYears && (index === 0 || series[index - 1].year !== series[index].year);

    return { scrollRef, monthRef, handleClick, handleKeyDown, showYear };
}
