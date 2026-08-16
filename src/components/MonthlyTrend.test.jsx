import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import MonthlyTrend from './MonthlyTrend';

describe('MonthlyTrend Component', () => {
    const series = [
        { month: '2025-12', label: 'дек', year: 2025, income: 500, expense: 200 },
        { month: '2026-01', label: 'янв', year: 2026, income: 300, expense: 400 }
    ];

    it('renders one column per month', () => {
        render(<MonthlyTrend series={series} selectedMonth="2026-01" onSelectMonth={() => { }} />);

        expect(screen.getByText('дек')).toBeInTheDocument();
        expect(screen.getByText('янв')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Декабрь 2025/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Январь 2026/ })).toBeInTheDocument();
    });

    it('marks the selected month as pressed and clicking a column calls onSelectMonth', () => {
        const handleSelect = vi.fn();
        render(<MonthlyTrend series={series} selectedMonth="2026-01" onSelectMonth={handleSelect} />);

        const decColumn = screen.getByRole('button', { name: /Декабрь 2025/ });
        const janColumn = screen.getByRole('button', { name: /Январь 2026/ });

        expect(decColumn).toHaveAttribute('aria-pressed', 'false');
        expect(janColumn).toHaveAttribute('aria-pressed', 'true');

        fireEvent.click(decColumn);
        expect(handleSelect).toHaveBeenCalledWith('2025-12');
    });

    it('returns null when there are fewer than 2 months', () => {
        const { container } = render(
            <MonthlyTrend series={[series[0]]} selectedMonth="2025-12" onSelectMonth={() => { }} />
        );
        expect(container.firstChild).toBeNull();
    });

    it('returns null for an empty series', () => {
        const { container } = render(
            <MonthlyTrend series={[]} selectedMonth="2026-01" onSelectMonth={() => { }} />
        );
        expect(container.firstChild).toBeNull();
    });
});
