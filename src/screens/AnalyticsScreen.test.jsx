import { render, screen, within, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import AnalyticsScreen from './AnalyticsScreen';

describe('AnalyticsScreen', () => {
    // Период без года для текущего года, поэтому «сейчас» зафиксировано.
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(2026, 0, 15, 12));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    const props = {
        summaryFrame: { pending: false, ready: true, syncWarning: null, isRefreshing: false },
        periodStats: { income: 1000, expense: -400, categoryTotals: { Food: 400 } },
        timeRange: 'month',
        typicalMonth: null,
        monthlyLimit: 500,
        series: [{ month: '2026-01', label: 'янв', year: 2026, income: 1000, expense: 400 }],
        selectedMonth: '2026-01',
        onSelectMonth: () => { },
        onChangePeriod: () => { },
        expenseComparison: { previous: 0, diff: 400, percent: null, label: '' },
        categoryComparison: {},
        comparisonLabel: 'к 15 декабря',
        onOpenCategory: () => { }
    };

    it('titles the screen «Аналитика» and keeps the period chip in the header', () => {
        render(<AnalyticsScreen {...props} />);

        expect(screen.getByRole('heading', { level: 1, name: 'Аналитика' })).toBeInTheDocument();
        const chip = screen.getByRole('button', { name: 'Период: Январь 2026' });
        expect(chip).toHaveTextContent('Январь 2026');
        expect(chip).toHaveAttribute('aria-haspopup', 'dialog');
    });

    it('labels the chip by period: month, year, lifetime', () => {
        const { rerender } = render(<AnalyticsScreen {...props} />);
        expect(screen.getByRole('button', { name: /^Период:/ })).toHaveTextContent(/^Январь 2026$/);

        rerender(<AnalyticsScreen {...props} timeRange="year" />);
        expect(screen.getByRole('button', { name: 'Период: 2026 год' })).toHaveTextContent('2026 год');

        rerender(<AnalyticsScreen {...props} timeRange="lifetime" />);
        expect(screen.getByRole('button', { name: 'Период: Всё время' })).toHaveTextContent('Всё время');
    });

    it('keeps exactly one period trigger, and it still opens the sheet, when the period is empty', () => {
        const onChangePeriod = vi.fn();
        render(<AnalyticsScreen {...props} onChangePeriod={onChangePeriod} periodStats={{ income: 0, expense: 0, categoryTotals: {} }} />);

        // An empty month must not leave the tab without a way to change it.
        expect(screen.getAllByRole('button', { name: /^Период:/ })).toHaveLength(1);
        fireEvent.click(screen.getByRole('button', { name: /^Период:/ }));
        fireEvent.click(within(screen.getByRole('dialog', { name: 'Выбор периода' })).getByRole('button', { name: 'Декабрь' }));
        expect(onChangePeriod).toHaveBeenCalledWith({ timeRange: 'month', selectedMonth: '2025-12' });
    });

    it('keeps the period chip usable while the summary is still loading', () => {
        render(<AnalyticsScreen {...props} summaryFrame={{ pending: true, ready: false, syncWarning: null, isRefreshing: false }} />);

        // Заголовок вне обёртки ожидания, которая делает содержимое inert.
        expect(screen.getByRole('button', { name: /^Период:/ }).closest('[inert]')).toBeNull();
    });
});
