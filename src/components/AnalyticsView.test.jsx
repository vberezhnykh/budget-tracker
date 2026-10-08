import { render, screen, within, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import AnalyticsView from './AnalyticsView';

// Январь 2026, идёт 15-й день из 31. «Обычно»: 100 в 1-й день (аренда) и
// по 10 в день дальше.
const byDay = Array.from({ length: 31 }, (_, i) => 100 + i * 10);
const typicalMonth = {
    months: ['2025-12', '2025-11', '2025-10'],
    byDay,
    monthTotal: byDay[30],
    actualByDay: Array.from({ length: 15 }, (_, i) => 100 + i * 12),
    today: { day: 15, typicalToDate: byDay[14], typicalRemaining: 160, spent: 268, forecast: 428 }
};

describe('AnalyticsView Component', () => {
    // «Идущий месяц» определяется по часам, поэтому «сейчас» зафиксировано.
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(2026, 0, 15, 12));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    const basePeriodStats = {
        income: 1000,
        expense: -400,
        categoryTotals: { Food: 300, Fun: 100 }
    };

    const series = [
        { month: '2025-12', label: 'дек', year: 2025, income: 900, expense: 350 },
        { month: '2026-01', label: 'янв', year: 2026, income: 1000, expense: 400 }
    ];

    const baseProps = {
        periodStats: basePeriodStats,
        timeRange: 'month',
        typicalMonth: null,
        monthlyLimit: 500,
        series,
        selectedMonth: '2026-01',
        onSelectMonth: () => { },
        expenseComparison: { previous: 350, diff: 50, percent: 14, label: 'на 15 декабря было €350,00' },
        categoryComparison: {},
        comparisonLabel: 'к 15 декабря',
        onOpenCategory: () => { }
    };

    it('renders categories, the monthly trend and the totals when the period has spending', () => {
        render(<AnalyticsView {...baseProps} />);

        expect(screen.getByRole('heading', { name: 'Категории' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^Food: €300,00/ })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'По месяцам' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Итоги' })).toBeInTheDocument();
        // Заголовок экрана с выбором периода живёт в AnalyticsScreen.
        expect(screen.queryByRole('button', { name: /^Период:/ })).not.toBeInTheDocument();
        expect(screen.queryByText(/Сводка за/)).not.toBeInTheDocument();
    });

    describe('pace card', () => {
        it('is shown for a month when the typical month exists', () => {
            render(<AnalyticsView {...baseProps} typicalMonth={typicalMonth} />);

            expect(screen.getByRole('heading', { name: 'Темп трат' })).toBeInTheDocument();
            expect(screen.getByText('15 из 31 дня')).toBeInTheDocument();
            expect(screen.getByRole('img', { name: /График темпа трат/ })).toBeInTheDocument();
        });

        it('explains the missing history instead of a chart when there is no typical month', () => {
            render(<AnalyticsView {...baseProps} typicalMonth={null} />);

            expect(screen.queryByRole('heading', { name: 'Темп трат' })).not.toBeInTheDocument();
            expect(screen.queryByRole('img', { name: /График темпа трат/ })).not.toBeInTheDocument();
            expect(screen.getByText('Для сравнения с обычным месяцем нужно хотя бы три полных месяца истории.')).toBeInTheDocument();
        });

        it.each(['year', 'lifetime'])('does not exist for the %s view, nor does the history hint', (timeRange) => {
            render(<AnalyticsView {...baseProps} timeRange={timeRange} typicalMonth={null} />);

            expect(screen.queryByRole('heading', { name: 'Темп трат' })).not.toBeInTheDocument();
            expect(screen.queryByText(/хотя бы три полных месяца/)).not.toBeInTheDocument();
        });

        it('still renders for a month without spending, next to the empty-categories card', () => {
            render(<AnalyticsView {...baseProps} typicalMonth={typicalMonth} periodStats={{ income: 0, expense: 0, categoryTotals: {} }} />);

            expect(screen.getByRole('heading', { name: 'Темп трат' })).toBeInTheDocument();
            expect(screen.getByText('За выбранный период трат нет')).toBeInTheDocument();
        });
    });

    describe('categories', () => {
        it('shows the change against last month and its date only for a month', () => {
            const categoryComparison = { Food: { value: 300, previous: 200, diff: 100, percent: 50 } };
            const { rerender } = render(<AnalyticsView {...baseProps} categoryComparison={categoryComparison} />);

            expect(screen.getByText('↑ 50%')).toBeInTheDocument();
            expect(screen.getByText('к 15 декабря')).toBeInTheDocument();

            rerender(<AnalyticsView {...baseProps} timeRange="year" categoryComparison={categoryComparison} />);
            expect(screen.queryByText('↑ 50%')).not.toBeInTheDocument();
            expect(screen.queryByText('к 15 декабря')).not.toBeInTheDocument();
            expect(screen.getByRole('button', { name: /^Food: €300,00/ })).toBeInTheDocument();
        });

        it('hands the tapped category to onOpenCategory', () => {
            const onOpenCategory = vi.fn();
            render(<AnalyticsView {...baseProps} onOpenCategory={onOpenCategory} />);

            fireEvent.click(screen.getByRole('button', { name: /^Fun: €/ }));

            expect(onOpenCategory).toHaveBeenCalledWith('Fun');
        });

        it('shows an empty-state card with the exact expected text when there is no spending', () => {
            render(<AnalyticsView {...baseProps} periodStats={{ income: 0, expense: 0, categoryTotals: {} }} />);

            expect(screen.getByText('За выбранный период трат нет')).toBeInTheDocument();
            expect(screen.queryByRole('heading', { name: 'Категории' })).not.toBeInTheDocument();
        });
    });

    describe('totals', () => {
        const totals = () => within(screen.getByRole('heading', { name: 'Итоги' }).closest('section'));

        it('shows income with a plus, expense with a minus, and the signed balance', () => {
            render(<AnalyticsView {...baseProps} />);

            expect(totals().getByText('+€1.000,00')).toBeInTheDocument();
            expect(totals().getByText('−€400,00')).toBeInTheDocument();
            expect(totals().getByText('+€600,00')).toBeInTheDocument();
        });

        it('paints a negative balance in the negative colour and a positive one in the positive colour', () => {
            const { rerender } = render(<AnalyticsView {...baseProps} periodStats={{ ...basePeriodStats, income: 100, expense: -400 }} />);

            expect(totals().getByText('−€300,00')).toHaveStyle({ color: 'var(--color-negative)' });

            rerender(<AnalyticsView {...baseProps} />);
            expect(totals().getByText('+€600,00')).toHaveStyle({ color: 'var(--color-positive)' });
        });

        it('states the change of the expense against last month with the date', () => {
            render(<AnalyticsView {...baseProps} />);

            const up = totals().getByText('↑ 14% к прошлому месяцу');
            expect(up).toHaveStyle({ color: 'var(--color-negative)' });
            expect(totals().getByText('на 15 декабря было €350,00')).toBeInTheDocument();
        });

        it('paints a decrease in the positive colour', () => {
            render(<AnalyticsView {...baseProps} expenseComparison={{ previous: 500, diff: -100, percent: -20, label: 'x' }} />);

            expect(totals().getByText('↓ 20% к прошлому месяцу')).toHaveStyle({ color: 'var(--color-positive)' });
        });

        it('says there was no spending last month instead of a percentage', () => {
            render(<AnalyticsView {...baseProps} expenseComparison={{ previous: 0, diff: 400, percent: null, label: 'x' }} />);

            expect(totals().getByText('В прошлом месяце трат не было')).toBeInTheDocument();
            expect(totals().queryByText(/к прошлому месяцу/)).not.toBeInTheDocument();
        });

        it('has no month comparison for the year or all time', () => {
            render(<AnalyticsView {...baseProps} timeRange="year" />);

            expect(totals().queryByText(/к прошлому месяцу/)).not.toBeInTheDocument();
            expect(totals().getByText('+€1.000,00')).toBeInTheDocument();
        });
    });

    it('draws the monthly trend with the limit and the caption for the month view', () => {
        render(<AnalyticsView {...baseProps} />);

        expect(screen.getByTestId('monthly-trend-limit')).toBeInTheDocument();
        expect(screen.getByText(/^Лимит не превышался ни в одном из 1 закрытых\./)).toBeInTheDocument();
    });

    it('draws the ghost bar for the current month from the forecast of the typical month', () => {
        render(<AnalyticsView {...baseProps} typicalMonth={typicalMonth} />);

        expect(screen.getByTestId('monthly-trend-ghost')).toBeInTheDocument();
    });
});
