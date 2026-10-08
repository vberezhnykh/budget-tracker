import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import OverviewScreen from './OverviewScreen';

// Последние операции - отдельный запрос; сами состояния блока проверяются
// здесь, поэтому хук подменён.
const recent = vi.hoisted(() => ({ value: { groups: {}, loading: false, error: false, retry: () => { } } }));
vi.mock('../utils/useRecentTransactions', () => ({ default: () => recent.value }));

const baseProps = {
    syncStatus: null,
    slides: [],
    selectedAccount: null,
    onSelectAccount: () => { },
    onOpenAccountsSettings: () => { },
    summaryFrame: { status: 'ready' },
    timeRange: 'month',
    selectedMonth: '2026-11',
    monthlyTotals: { '2026-10': { income: 3000, expense: -6890 } },
    periodStats: { income: 0, expense: 0 },
    monthlyLimit: 7000,
    typicalMonth: null,
    onChangePeriod: () => { },
    onOpenHistory: () => { },
    onOpenAllHistory: () => { },
    request: () => { },
    historyRevision: 0,
    openEditModal: () => { },
    getAccountDisplay: () => ({}),
    formatDate: (d) => d,
};

describe('OverviewScreen empty states', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(2026, 10, 3, 12));
        recent.value = { groups: {}, loading: false, error: false, retry: () => { } };
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('previous month row', () => {
        it('summarises the previous month at the start of a month and reports the tap', () => {
            const onOpenPreviousMonth = vi.fn();
            render(<OverviewScreen {...baseProps} onOpenPreviousMonth={onOpenPreviousMonth} />);

            const row = screen.getByTestId('previous-month-row');
            expect(row).toHaveTextContent('Октябрь закрыт: €6.890 из €7.000');
            fireEvent.click(row);
            expect(onOpenPreviousMonth).toHaveBeenCalledWith('2026-10');
        });

        it('renders it as a non-interactive row without the handler', () => {
            render(<OverviewScreen {...baseProps} />);

            expect(screen.getByTestId('previous-month-row').tagName).toBe('DIV');
        });

        it('is hidden when the previous month had no expenses', () => {
            render(<OverviewScreen {...baseProps} monthlyTotals={{ '2026-10': { income: 100, expense: 0 } }} />);

            expect(screen.queryByTestId('previous-month-row')).not.toBeInTheDocument();
        });

        it('is hidden once the current month has spending', () => {
            render(<OverviewScreen {...baseProps} monthlyTotals={{ '2026-10': { income: 0, expense: -6890 }, '2026-11': { income: 0, expense: -20 } }} />);

            expect(screen.queryByTestId('previous-month-row')).not.toBeInTheDocument();
        });

        it('is hidden for a year', () => {
            render(<OverviewScreen {...baseProps} timeRange="year" />);

            expect(screen.queryByTestId('previous-month-row')).not.toBeInTheDocument();
        });
    });

    describe('empty recent operations', () => {
        it('shows the empty state with both actions wired', () => {
            const onAddExpense = vi.fn();
            const onOpenAllHistory = vi.fn();
            render(<OverviewScreen {...baseProps} onAddExpense={onAddExpense} onOpenAllHistory={onOpenAllHistory} />);

            expect(screen.getByText('Операций пока нет')).toBeInTheDocument();
            expect(screen.getByText('Новые расходы и доходы появятся здесь')).toBeInTheDocument();

            fireEvent.click(screen.getByRole('button', { name: 'Добавить расход' }));
            expect(onAddExpense).toHaveBeenCalledTimes(1);

            fireEvent.click(screen.getByRole('button', { name: 'Открыть историю' }));
            expect(onOpenAllHistory).toHaveBeenCalledTimes(1);
        });

        it('has no «Добавить расход» without the handler', () => {
            render(<OverviewScreen {...baseProps} />);

            expect(screen.queryByRole('button', { name: 'Добавить расход' })).not.toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Открыть историю' })).toBeInTheDocument();
        });

        it('shows neither the empty state while loading nor on error', () => {
            recent.value = { groups: {}, loading: true, error: false, retry: () => { } };
            const { rerender } = render(<OverviewScreen {...baseProps} />);
            expect(screen.queryByText('Операций пока нет')).not.toBeInTheDocument();

            recent.value = { groups: {}, loading: false, error: true, retry: () => { } };
            rerender(<OverviewScreen {...baseProps} />);
            expect(screen.queryByText('Операций пока нет')).not.toBeInTheDocument();
            expect(screen.getByRole('alert')).toHaveTextContent('Не удалось загрузить операции');
        });
    });
});
