import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import SummaryCard from './SummaryCard';

describe('SummaryCard headline', () => {
    const baseProps = { income: 1000, expense: -400, monthlyLimit: 500, showLimitBar: true, onOpenHistory: () => { } };

    it('keeps an interactive headline outside the expense button', () => {
        render(<SummaryCard {...baseProps} headline={<button type="button">Период</button>} />);

        const expense = screen.getByRole('button', { name: /^Расход:/ });
        const headline = screen.getByRole('button', { name: 'Период' });
        // A button cannot contain another button.
        expect(expense).not.toContainElement(headline);
    });

    it('renders a plain-text headline on a neighbour card without adding a button for it', () => {
        render(<SummaryCard {...baseProps} isActive={false} headline="Расход за август" />);

        expect(screen.getByText('Расход за август')).toBeInTheDocument();
        expect(screen.queryAllByRole('button')).toHaveLength(0);
    });
});

describe('SummaryCard history links', () => {
    const baseProps = { income: 1000, expense: -400, monthlyLimit: 500, showLimitBar: true };

    it('opens the history of income from the income tile, naming that in the label', () => {
        const onOpenHistory = vi.fn();
        render(<SummaryCard {...baseProps} onOpenHistory={onOpenHistory} />);

        const income = screen.getByRole('button', { name: 'Доход: €1.000,00, открыть историю доходов' });
        fireEvent.click(income);

        expect(onOpenHistory).toHaveBeenCalledWith('income');
    });

    it('opens the history of expenses from the expense figure', () => {
        const onOpenHistory = vi.fn();
        render(<SummaryCard {...baseProps} onOpenHistory={onOpenHistory} />);

        fireEvent.click(screen.getByRole('button', { name: /^Расход: €400,00 из лимита €500, открыть историю расходов$/ }));

        expect(onOpenHistory).toHaveBeenCalledWith('expense');
    });

    it('is a navigation, not a toggle: no pressed state and no «filtered» hint', () => {
        render(<SummaryCard {...baseProps} onOpenHistory={() => { }} />);

        for (const button of screen.getAllByRole('button')) {
            expect(button).not.toHaveAttribute('aria-pressed');
        }
        expect(screen.queryByText(/список отфильтрован/)).not.toBeInTheDocument();
    });

    it('does not make a neighbour card navigable', () => {
        render(<SummaryCard {...baseProps} isActive={false} onOpenHistory={() => { }} />);
        expect(screen.queryAllByRole('button')).toHaveLength(0);
    });
});
