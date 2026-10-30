import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import OverviewScreen from './OverviewScreen';

// Последние операции - отдельный запрос; сами состояния блока проверяются
// здесь, поэтому хук подменён.
const recent = vi.hoisted(() => ({ value: { groups: {}, loading: false, error: false, retry: () => { } }, args: null }));
vi.mock('../utils/useRecentTransactions', () => ({ default: args => { recent.args = args; return recent.value; } }));

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

        it('is hidden while the month review card is shown, and back once it is gone', () => {
            const monthReview = { month: '2026-10', headline: 'Октябрь: как обычно', points: [] };
            const { rerender } = render(<OverviewScreen {...baseProps} monthReview={monthReview} />);

            expect(screen.getByTestId('month-review-card')).toBeInTheDocument();
            expect(screen.queryByTestId('previous-month-row')).not.toBeInTheDocument();

            rerender(<OverviewScreen {...baseProps} monthReview={null} />);
            expect(screen.queryByTestId('month-review-card')).not.toBeInTheDocument();
            expect(screen.getByTestId('previous-month-row')).toHaveTextContent('Октябрь закрыт: €6.890 из €7.000');
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

    describe('just-saved operations', () => {
        const groups = {
            '2026-11-03': {
                dailySum: -12,
                items: [
                    { id: 'new', type: 'expense', visualAmount: -7, account: 'card', category: 'Кафе', description: 'Латте', date: '2026-11-03' },
                    { id: 'old', type: 'expense', visualAmount: -5, account: 'card', category: 'Еда', description: 'Хлеб', date: '2026-11-03' },
                ],
            },
        };
        const props = { ...baseProps, getAccountDisplay: () => 'Карта' };

        it('hands the inserts and the revision to the recent list hook', () => {
            const recentInserts = [{ saved: { _id: 'new' }, untilRevision: 3 }];
            render(<OverviewScreen {...props} historyRevision={2} recentInserts={recentInserts} selectedAccount="card" />);

            expect(recent.args).toMatchObject({ revision: 2, inserts: recentInserts, account: 'card', month: '2026-11' });
        });

        it('animates only the rows the hook reports as fresh', () => {
            recent.value = { groups, freshIds: new Set(['new']), loading: false, error: false, retry: () => { } };
            const { container } = render(<OverviewScreen {...props} />);

            expect(container.querySelector('[data-history-item="new"]').parentElement).toHaveClass('tx-fresh');
            expect(container.querySelector('[data-history-item="old"]').parentElement).not.toHaveClass('tx-fresh');
        });

        it('lists plain rows when the hook reports no fresh ones', () => {
            recent.value = { groups, freshIds: new Set(), loading: false, error: false, retry: () => { } };
            const { container } = render(<OverviewScreen {...props} />);

            expect(container.querySelector('.tx-fresh')).toBeNull();
            expect(screen.getByText('Латте')).toBeInTheDocument();
        });
    });

    describe('month review card', () => {
        const monthReview = { month: '2026-10', headline: 'Октябрь: как обычно', points: [{ text: 'Расходы близки к обычным.', category: null }] };

        it('sits between the hero and the accounts section, and is absent without a review', () => {
            const { rerender } = render(<OverviewScreen {...baseProps} />);
            expect(screen.queryByTestId('month-review-card')).not.toBeInTheDocument();

            rerender(<OverviewScreen {...baseProps} monthReview={monthReview} />);
            const card = screen.getByTestId('month-review-card');
            const accounts = screen.getByRole('heading', { name: 'Счета' }).closest('section');
            expect(card.compareDocumentPosition(accounts) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
            expect(card).toHaveStyle({ marginBottom: 'var(--space-6)' });
        });

        it('puts the previous month expense and the limit into the label', () => {
            render(<OverviewScreen {...baseProps} monthReview={monthReview} />);

            expect(screen.getByText('Итоги октября · €6.890 из €7.000')).toBeInTheDocument();
        });

        it('leaves out the limit for a single account', () => {
            render(<OverviewScreen {...baseProps} selectedAccount="cash" monthReview={monthReview} />);

            expect(screen.getByText('Итоги октября · €6.890')).toBeInTheDocument();
        });

        it('leaves the label bare when the review is not for the previous month of the shown period', () => {
            render(<OverviewScreen {...baseProps} monthReview={{ ...monthReview, month: '2026-09' }} />);

            expect(screen.getByText('Итоги сентября')).toBeInTheDocument();
        });

        it('passes the dismiss and category taps up', () => {
            const onDismissMonthReview = vi.fn();
            const onOpenMonthReviewCategory = vi.fn();
            const withCategory = { ...monthReview, points: [{ text: 'Отпуск вырос.', category: 'Отпуск' }] };
            render(<OverviewScreen {...baseProps} monthReview={withCategory} onDismissMonthReview={onDismissMonthReview} onOpenMonthReviewCategory={onOpenMonthReviewCategory} />);

            fireEvent.click(screen.getByRole('button', { name: /Отпуск вырос/ }));
            expect(onOpenMonthReviewCategory).toHaveBeenCalledWith('Отпуск');
            fireEvent.click(screen.getByRole('button', { name: 'Скрыть итоги месяца' }));
            expect(onDismissMonthReview).toHaveBeenCalledTimes(1);
        });
    });
});
