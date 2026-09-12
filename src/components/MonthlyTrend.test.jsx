import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
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

    it('keeps a single month readable with both navigation boundaries disabled', () => {
        render(
            <MonthlyTrend series={[series[0]]} selectedMonth="2025-12" onSelectMonth={() => { }} />
        );
        expect(screen.getByText('+€300,00')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Предыдущий месяц' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Следующий месяц' })).toBeDisabled();
    });

    it('returns null for an empty series', () => {
        const { container } = render(
            <MonthlyTrend series={[]} selectedMonth="2026-01" onSelectMonth={() => { }} />
        );
        expect(container.firstChild).toBeNull();
    });

    function InteractiveTrend() {
        const [month, setMonth] = useState('2026-01');
        return <MonthlyTrend series={series} selectedMonth={month} onSelectMonth={setMonth} />;
    }

    it('navigates both directions across a year boundary and updates exact signed totals', () => {
        render(<InteractiveTrend />);
        expect(screen.getByText('−€100,00')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Предыдущий месяц' }));
        expect(screen.getByRole('button', { name: /Декабрь 2025:/ })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByText('+€300,00')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Предыдущий месяц' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Следующий месяц' }));
        expect(screen.getByRole('button', { name: /Январь 2026:/ })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByText('−€100,00')).toBeInTheDocument();
    });

    it('supports keyboard navigation while keeping focus on the selected month', () => {
        render(<InteractiveTrend />);
        const december = screen.getByRole('button', { name: /Декабрь 2025:/ });
        const january = screen.getByRole('button', { name: /Январь 2026:/ });
        fireEvent.keyDown(january, { key: 'ArrowLeft' });
        expect(december).toHaveFocus();
        expect(december).toHaveAttribute('aria-pressed', 'true');
        fireEvent.keyDown(december, { key: 'End' });
        expect(january).toHaveFocus();
        expect(january).toHaveAttribute('aria-pressed', 'true');
        fireEvent.keyDown(january, { key: 'ArrowRight' });
        expect(january).toHaveFocus();
    });

    it('shows zero activity explicitly and preserves the month for navigation', () => {
        render(<MonthlyTrend series={series.map(month => ({ ...month, income: 0, expense: 0 }))} selectedMonth="2026-01" onSelectMonth={() => { }} />);
        expect(screen.getByText('Нет доходов и расходов за этот месяц')).toBeInTheDocument();
        expect(screen.getAllByText('€0,00')).toHaveLength(3);
        expect(screen.getByRole('button', { name: 'Предыдущий месяц' })).toBeEnabled();
    });
});
