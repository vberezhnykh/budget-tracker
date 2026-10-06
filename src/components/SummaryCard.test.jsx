import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import SummaryCard from './SummaryCard';

describe('SummaryCard headline', () => {
    const baseProps = { income: 1000, expense: -400, monthlyLimit: 500, showLimitBar: true, selectedType: null, onToggleType: () => { } };

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
