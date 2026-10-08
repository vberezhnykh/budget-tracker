import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import CategoryBarsEmpty from './CategoryBarsEmpty';

describe('CategoryBarsEmpty', () => {
    it('shows the header, two placeholder tracks and the explanation with the month in prepositional case', () => {
        render(<CategoryBarsEmpty selectedMonth="2026-11" onSelectMonth={() => { }} />);

        expect(screen.getByRole('heading', { name: 'Категории' })).toBeInTheDocument();
        expect(screen.getByTestId('category-placeholder').children).toHaveLength(2);
        expect(screen.getByText('Распределение по категориям появится, когда в ноябре будут расходы.')).toBeInTheDocument();
    });

    it('offers the previous month and selects it on tap', () => {
        const onSelectMonth = vi.fn();
        render(<CategoryBarsEmpty selectedMonth="2026-11" onSelectMonth={onSelectMonth} />);

        fireEvent.click(screen.getByRole('button', { name: 'Посмотреть октябрь' }));
        expect(onSelectMonth).toHaveBeenCalledWith('2026-10');
    });

    it('steps back over the new year', () => {
        const onSelectMonth = vi.fn();
        render(<CategoryBarsEmpty selectedMonth="2026-01" onSelectMonth={onSelectMonth} />);

        fireEvent.click(screen.getByRole('button', { name: 'Посмотреть декабрь' }));
        expect(onSelectMonth).toHaveBeenCalledWith('2025-12');
    });

    it('has no button without a handler', () => {
        render(<CategoryBarsEmpty selectedMonth="2026-11" />);

        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('has no button for the first month of the history', () => {
        render(<CategoryBarsEmpty selectedMonth="2025-11" onSelectMonth={() => { }} />);

        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
});
