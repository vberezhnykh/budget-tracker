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
});
