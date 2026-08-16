import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import AnalyticsView from './AnalyticsView';

describe('AnalyticsView Component', () => {
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
        periodLabel: 'Январь 2026',
        timeRange: 'month',
        pace: null,
        monthlyLimit: 500,
        series,
        selectedMonth: '2026-01',
        onSelectMonth: () => { },
        categoryComparison: {},
        comparisonLabel: 'к 15 января',
        selectedCategory: null,
        onSelectCategory: () => { }
    };

    it('renders the summary card and the donut when the period has spending', () => {
        render(<AnalyticsView {...baseProps} />);

        expect(screen.getByText('Сводка')).toBeInTheDocument();
        expect(screen.getByText('Январь 2026')).toBeInTheDocument();
        expect(screen.getByText('Аналитика трат')).toBeInTheDocument();
        expect(screen.getByText('Food')).toBeInTheDocument();
    });

    it('hides the pace card when pace is null', () => {
        render(<AnalyticsView {...baseProps} pace={null} />);
        expect(screen.queryByText('Темп трат')).not.toBeInTheDocument();
    });

    it('shows the pace card with its figures when pace is provided for the month view', () => {
        const pace = {
            daysInMonth: 31,
            daysElapsed: 15,
            daysLeft: 16,
            perDay: 20,
            forecast: 620,
            remaining: 200,
            perDayLeft: 12.5,
            willExceedLimit: true
        };
        render(<AnalyticsView {...baseProps} pace={pace} />);

        expect(screen.getByText('Темп трат')).toBeInTheDocument();
        expect(screen.getByText(/В среднем €20,00 в день/)).toBeInTheDocument();
        expect(screen.getByText(/Прогноз до конца месяца ~€620,00/)).toBeInTheDocument();
        expect(screen.getByText(/будет превышен/)).toBeInTheDocument();
    });

    it('caps pace figures at two decimals', () => {
        // perDay/forecast come out of a division, so minimumFractionDigits
        // alone let "€230,06" render as "€230,063".
        const pace = {
            daysInMonth: 31, daysElapsed: 16, daysLeft: 15,
            perDay: 3681 / 16, forecast: (3681 / 16) * 31,
            remaining: null, perDayLeft: null, willExceedLimit: null
        };
        render(<AnalyticsView {...baseProps} pace={pace} />);

        expect(screen.getByText('В среднем €230,06 в день')).toBeInTheDocument();
        expect(screen.getByText('Прогноз до конца месяца ~€7.131,94')).toBeInTheDocument();
    });

    it('agrees the day count with the number and drops it on the last day of the month', () => {
        const base = { daysInMonth: 31, daysElapsed: 30, perDay: 20, forecast: 620, willExceedLimit: false };

        const { unmount } = render(<AnalyticsView {...baseProps} pace={{ ...base, daysLeft: 1, remaining: 100, perDayLeft: 100 }} />);
        expect(screen.getByText(/на оставшиеся 1 день$/)).toBeInTheDocument();
        unmount();

        const { unmount: unmount2 } = render(<AnalyticsView {...baseProps} pace={{ ...base, daysLeft: 3, remaining: 90, perDayLeft: 30 }} />);
        expect(screen.getByText(/на оставшиеся 3 дня$/)).toBeInTheDocument();
        unmount2();

        const { unmount: unmount3 } = render(<AnalyticsView {...baseProps} pace={{ ...base, daysLeft: 11, remaining: 110, perDayLeft: 10 }} />);
        expect(screen.getByText(/на оставшиеся 11 дней$/)).toBeInTheDocument();
        unmount3();

        // On the last day there is nothing left to divide the remainder by,
        // so that half of the sentence drops out.
        render(<AnalyticsView {...baseProps} pace={{ ...base, daysElapsed: 31, daysLeft: 0, remaining: 50, perDayLeft: null }} />);
        expect(screen.getByText('Осталось €50,00')).toBeInTheDocument();
        expect(screen.queryByText(/оставшиеся/)).not.toBeInTheDocument();
    });

    it('states an already-blown limit as fact instead of forecasting it', () => {
        const pace = {
            daysInMonth: 31, daysElapsed: 20, daysLeft: 11,
            perDay: 30, forecast: 930, remaining: -100, perDayLeft: -9.09, willExceedLimit: true
        };
        render(<AnalyticsView {...baseProps} pace={pace} />);

        expect(screen.getByText(/уже превышен на €100,00/)).toBeInTheDocument();
        expect(screen.queryByText(/будет превышен/)).not.toBeInTheDocument();
        // A negative "осталось" must never be printed.
        expect(screen.queryByText(/Осталось/)).not.toBeInTheDocument();
    });

    it('shows an empty-state card with the exact expected text when there is no spending', () => {
        render(<AnalyticsView {...baseProps} periodStats={{ income: 0, expense: 0, categoryTotals: {} }} />);

        expect(screen.getByText('За выбранный период трат нет')).toBeInTheDocument();
        expect(screen.queryByText('Аналитика трат')).not.toBeInTheDocument();
    });

    it('does not pass category comparison through for a non-month time range', () => {
        render(<AnalyticsView {...baseProps} timeRange="year" pace={null} />);
        // The pace card never shows outside the month view even if pace were set,
        // and the comparison label above the donut is skipped too.
        expect(screen.queryByText('к 15 января')).not.toBeInTheDocument();
    });
});
