import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import OverviewHero from './OverviewHero';

const monthProps = {
    timeRange: 'month',
    selectedMonth: '2026-01',
    income: 1000,
    expense: -400,
    monthlyLimit: 500,
    onOpenHistory: () => { },
};

describe('OverviewHero month', () => {
    it('names the period, shows the expense as one big number and the limit next to it', () => {
        render(<OverviewHero {...monthProps} />);

        expect(screen.getByText('Расход за январь')).toBeInTheDocument();
        expect(screen.getByText('€400,00')).toBeInTheDocument();
        expect(screen.getByText('из €500')).toBeInTheDocument();
    });

    it('draws the bar to spent/limit, says what is left and shows the percent', () => {
        render(<OverviewHero {...monthProps} />);

        expect(screen.getByTestId('limit-bar-fill')).toHaveStyle({ width: '80%', background: 'var(--color-primary)' });
        expect(screen.getByText(/^осталось/)).toHaveTextContent('осталось €100,00');
        expect(screen.getByText('80%')).toBeInTheDocument();
    });

    it('turns the bar negative-coloured, caps its width and counts the overrun when over the limit', () => {
        render(<OverviewHero {...monthProps} expense={-650} />);

        const fill = screen.getByTestId('limit-bar-fill');
        expect(fill).toHaveStyle({ width: '100%', background: 'var(--color-negative)' });
        const overrun = screen.getByText(/^сверх лимита/);
        expect(overrun).toHaveTextContent('сверх лимита €150,00');
        expect(overrun).toHaveStyle({ color: 'var(--color-negative)' });
        expect(screen.getByText('130%')).toBeInTheDocument();
        expect(screen.queryByText(/осталось/)).not.toBeInTheDocument();
    });

    it('omits the limit, the bar and the percent when the limit is not usable', () => {
        for (const monthlyLimit of [0, -5, NaN, undefined, null]) {
            const { unmount } = render(<OverviewHero {...monthProps} monthlyLimit={monthlyLimit} />);
            expect(screen.getByText('€400,00')).toBeInTheDocument();
            expect(screen.queryByText(/^из €/)).not.toBeInTheDocument();
            expect(screen.queryByTestId('limit-bar-fill')).not.toBeInTheDocument();
            expect(screen.queryByText(/%/)).not.toBeInTheDocument();
            unmount();
        }
    });

    it('steps the big number down for a six-figure amount so it stays inside the card', () => {
        const { rerender } = render(<OverviewHero {...monthProps} expense={-400} />);
        expect(screen.getByText('€400,00')).toHaveStyle({ fontSize: 'var(--text-display)' });

        rerender(<OverviewHero {...monthProps} expense={-123456.78} />);
        expect(screen.getByText('€123.456,78')).toHaveStyle({ fontSize: 'calc(var(--text-display) * 0.75)' });
    });

    it('shows income as a positive figure and a signed balance, negative one in the negative colour', () => {
        const { rerender } = render(<OverviewHero {...monthProps} />);
        expect(screen.getByText('+€1.000,00')).toHaveStyle({ color: 'var(--color-positive)' });
        expect(screen.getByText('+€600,00')).toBeInTheDocument();

        rerender(<OverviewHero {...monthProps} income={100} expense={-400} />);
        const saldo = screen.getByText('−€300,00');
        expect(saldo).toHaveStyle({ color: 'var(--color-negative)' });
    });

    it('renders the plaque between the bar and the income row only when given one', () => {
        const { rerender } = render(<OverviewHero {...monthProps} />);
        expect(screen.queryByRole('status')).not.toBeInTheDocument();

        rerender(<OverviewHero {...monthProps} plaque={{ tone: 'warning', title: 'До конца месяца 3 дня', text: 'Текст прогноза' }} />);
        const plaque = screen.getByRole('status');
        expect(plaque).toHaveTextContent('До конца месяца 3 дня');
        expect(plaque).toHaveTextContent('Текст прогноза');
    });
});

describe('OverviewHero year and lifetime', () => {
    it('drops the limit, the bar, the percent and the plaque, and names the period', () => {
        const plaque = { tone: 'neutral', title: 'До конца месяца 3 дня', text: 'не должна показаться' };
        const { rerender } = render(<OverviewHero {...monthProps} timeRange="year" selectedMonth="2026-01" plaque={plaque} />);

        expect(screen.getByText('Расход за 2026 год')).toBeInTheDocument();
        expect(screen.getByText('€400,00')).toBeInTheDocument();
        expect(screen.queryByText(/^из €/)).not.toBeInTheDocument();
        expect(screen.queryByTestId('limit-bar-fill')).not.toBeInTheDocument();
        expect(screen.queryByText(/%/)).not.toBeInTheDocument();
        expect(screen.queryByText(/осталось|сверх лимита/)).not.toBeInTheDocument();

        rerender(<OverviewHero {...monthProps} timeRange="lifetime" />);
        expect(screen.getByText('Расход за всё время')).toBeInTheDocument();
        expect(screen.queryByTestId('limit-bar-fill')).not.toBeInTheDocument();
        // Без лимита подпись кнопки расхода тоже без «из лимита».
        expect(screen.getByRole('button', { name: 'Расход: €400,00, открыть историю расходов' })).toBeInTheDocument();
    });
});

describe('OverviewHero history links', () => {
    it('opens the history of income from the income figure, naming that in the label', () => {
        const onOpenHistory = vi.fn();
        render(<OverviewHero {...monthProps} onOpenHistory={onOpenHistory} />);

        fireEvent.click(screen.getByRole('button', { name: 'Доход: €1.000,00, открыть историю доходов' }));

        expect(onOpenHistory).toHaveBeenCalledWith('income');
    });

    it('opens the history of expenses from the big expense number', () => {
        const onOpenHistory = vi.fn();
        render(<OverviewHero {...monthProps} onOpenHistory={onOpenHistory} />);

        fireEvent.click(screen.getByRole('button', { name: /^Расход: €400,00 из лимита €500, открыть историю расходов$/ }));

        expect(onOpenHistory).toHaveBeenCalledWith('expense');
    });

    it('is a navigation, not a toggle: exactly two buttons, no pressed state, no «filtered» hint', () => {
        render(<OverviewHero {...monthProps} onOpenHistory={() => { }} />);

        const buttons = screen.getAllByRole('button');
        expect(buttons).toHaveLength(2);
        for (const button of buttons) {
            expect(button).not.toHaveAttribute('aria-pressed');
        }
        expect(screen.queryByText(/список отфильтрован/)).not.toBeInTheDocument();
    });
});

describe('OverviewHero start of the month', () => {
    // «Текущий месяц» берётся из часов, поэтому они зафиксированы на ноябре.
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(2026, 10, 3, 12));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    const freshProps = {
        ...monthProps,
        selectedMonth: '2026-11',
        expense: 0,
        income: 0,
        monthlyLimit: 7000,
        previousMonth: { month: '2026-10', expense: 6890 },
    };

    it('mutes the zero, empties the bar and says the whole limit is ahead instead of the remainder', () => {
        render(<OverviewHero {...freshProps} />);

        expect(within(screen.getByRole('button', { name: /^Расход:/ })).getByText('€0,00')).toHaveStyle({ color: 'var(--color-text-muted)' });
        expect(screen.getByTestId('limit-bar-fill')).toHaveStyle({ width: '0%' });
        expect(screen.getByText('Месяц только начался, весь лимит впереди')).toBeInTheDocument();
        expect(screen.queryByText(/осталось/)).not.toBeInTheDocument();
        expect(screen.queryByText('0%')).not.toBeInTheDocument();
    });

    it('summarises the previous month that fit the limit and opens it on tap', () => {
        const onOpenPreviousMonth = vi.fn();
        render(<OverviewHero {...freshProps} onOpenPreviousMonth={onOpenPreviousMonth} />);

        const row = screen.getByTestId('previous-month-row');
        expect(row.tagName).toBe('BUTTON');
        expect(row).toHaveTextContent('Октябрь закрыт: €6.890 из €7.000');
        expect(row).toHaveTextContent('Уложились, запас €110');
        fireEvent.click(row);
        expect(onOpenPreviousMonth).toHaveBeenCalledWith('2026-10');
    });

    it('counts the overrun in the negative colour when the previous month went over', () => {
        render(<OverviewHero {...freshProps} previousMonth={{ month: '2026-10', expense: 7250 }} onOpenPreviousMonth={() => { }} />);

        expect(screen.getByText('Лимит превышен на €250')).toHaveStyle({ color: 'var(--color-negative)' });
        expect(screen.queryByText(/Уложились/)).not.toBeInTheDocument();
    });

    it('shows only the total of the previous month when there is no usable limit', () => {
        render(<OverviewHero {...freshProps} monthlyLimit={null} onOpenPreviousMonth={() => { }} />);

        const row = screen.getByTestId('previous-month-row');
        expect(row).toHaveTextContent('Октябрь закрыт: €6.890');
        expect(row).not.toHaveTextContent('из');
        expect(row).not.toHaveTextContent(/Уложились|превышен/);
    });

    it('renders the row as a plain block when nobody listens', () => {
        render(<OverviewHero {...freshProps} />);

        const row = screen.getByTestId('previous-month-row');
        expect(row.tagName).toBe('DIV');
        expect(screen.queryByRole('button', { name: /закрыт/ })).not.toBeInTheDocument();
    });

    it('has no row without a previous month to report', () => {
        render(<OverviewHero {...freshProps} previousMonth={null} />);

        expect(screen.queryByTestId('previous-month-row')).not.toBeInTheDocument();
        expect(screen.getByText('Месяц только начался, весь лимит впереди')).toBeInTheDocument();
    });

    it('goes back to the normal card once something is spent', () => {
        render(<OverviewHero {...freshProps} expense={-35} onOpenPreviousMonth={() => { }} />);

        expect(screen.queryByText('Месяц только начался, весь лимит впереди')).not.toBeInTheDocument();
        expect(screen.queryByTestId('previous-month-row')).not.toBeInTheDocument();
        expect(screen.getByText(/^осталось/)).toHaveTextContent('осталось €6.965,00');
    });

    it('is not the start of a month for a past month with no expenses', () => {
        render(<OverviewHero {...freshProps} selectedMonth="2026-09" previousMonth={{ month: '2026-08', expense: 100 }} />);

        expect(screen.queryByText('Месяц только начался, весь лимит впереди')).not.toBeInTheDocument();
        expect(screen.queryByTestId('previous-month-row')).not.toBeInTheDocument();
        expect(screen.getByText(/^осталось/)).toBeInTheDocument();
    });
});
