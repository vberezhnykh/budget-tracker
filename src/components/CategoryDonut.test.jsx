import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import CategoryDonut from './CategoryDonut';

describe('CategoryDonut Component', () => {
    const mockData = {
        'Products': 100,
        'Rent': 500,
        'Coffee': 10
    };

    it('renders category names and totals', () => {
        render(<CategoryDonut data={mockData} onToggle={() => { }} />);

        expect(screen.getByText('Products')).toBeInTheDocument();
        expect(screen.getByText('Rent')).toBeInTheDocument();
        // Total trats display
        expect(screen.getByText('€610')).toBeInTheDocument();
    });

    it('groups small categories into "Прочее"', () => {
        // Total is 100+500+10 = 610. 5% is 30.5. 'Coffee' (10) should be grouped.
        render(<CategoryDonut data={mockData} onToggle={() => { }} />);

        expect(screen.getByText('Прочее')).toBeInTheDocument();
        expect(screen.queryByText('Coffee')).not.toBeInTheDocument();
    });

    it('calls onToggle when "Back" button is clicked', () => {
        const handleToggle = vi.fn();
        render(<CategoryDonut data={mockData} onToggle={handleToggle} />);

        const backButton = screen.getByText(/Назад/i);
        fireEvent.click(backButton);

        expect(handleToggle).toHaveBeenCalledTimes(1);
    });

    it('returns null if there is no data', () => {
        const { container } = render(<CategoryDonut data={{}} onToggle={() => { }} />);
        expect(container.firstChild).toBeNull();
    });

    it('expands and collapses "Прочее" to reveal its member categories', () => {
        render(<CategoryDonut data={mockData} onToggle={() => { }} />);

        expect(screen.queryByText('Coffee')).not.toBeInTheDocument();

        fireEvent.click(screen.getByText('Прочее'));
        expect(screen.getByText('Coffee')).toBeInTheDocument();

        fireEvent.click(screen.getByText('Прочее'));
        expect(screen.queryByText('Coffee')).not.toBeInTheDocument();
    });

    it('caps visible categories at 6, folding the rest into "Прочее" even above the 5% threshold', () => {
        // 7 equally-sized categories: each is well above 5% of the total,
        // so only the 6-category cap pushes the 7th into "Прочее".
        const manyCategories = {
            A: 100, B: 90, C: 80, D: 70, E: 60, F: 50, G: 40
        };
        render(<CategoryDonut data={manyCategories} onToggle={() => { }} />);

        ['A', 'B', 'C', 'D', 'E', 'F'].forEach(name => {
            expect(screen.getByText(name)).toBeInTheDocument();
        });
        expect(screen.getByText('Прочее')).toBeInTheDocument();
        expect(screen.getByText('(1)')).toBeInTheDocument();

        fireEvent.click(screen.getByText('Прочее'));
        expect(screen.getByText('G')).toBeInTheDocument();
    });

    it('shows the month-over-month delta next to a category with prior spending', () => {
        const comparison = {
            Products: { value: 100, previous: 80, diff: 20, percent: 25 },
            Rent: { value: 500, previous: 600, diff: -100, percent: -17 }
        };
        render(<CategoryDonut data={mockData} onToggle={() => { }} comparison={comparison} />);

        expect(screen.getByText('+25%')).toBeInTheDocument();
        expect(screen.getByText('−17%')).toBeInTheDocument();
    });

    it('does not show a delta for a category with no prior spending', () => {
        const comparison = { Products: { value: 100, previous: 0, diff: 100, percent: null } };
        render(<CategoryDonut data={mockData} onToggle={() => { }} comparison={comparison} />);

        expect(screen.queryByText(/^\+/)).not.toBeInTheDocument();
    });

    it('turns legend rows into filter buttons when onSelectCategory is passed, and highlights the selected one', () => {
        const handleSelect = vi.fn();
        render(
            <CategoryDonut
                data={mockData}
                onToggle={() => { }}
                selectedCategory="Rent"
                onSelectCategory={handleSelect}
            />
        );

        const rentButton = screen.getByRole('button', { name: /^Rent: €/ });
        expect(rentButton).toHaveAttribute('aria-pressed', 'true');

        const productsButton = screen.getByRole('button', { name: /^Products: €/ });
        expect(productsButton).toHaveAttribute('aria-pressed', 'false');

        fireEvent.click(productsButton);
        expect(handleSelect).toHaveBeenCalledWith('Products');
    });

    it('leaves legend rows as non-interactive divs when onSelectCategory is not passed', () => {
        render(<CategoryDonut data={mockData} onToggle={() => { }} />);
        expect(screen.queryByRole('button', { name: /^Rent: €/ })).not.toBeInTheDocument();
    });
});
