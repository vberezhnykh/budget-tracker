import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import CategoryBars from './CategoryBars';

describe('CategoryBars Component', () => {
    const data = {
        Products: 100,
        Rent: 500,
        Coffee: 10
    };

    const rowNames = () => screen.getAllByRole('button')
        .map(button => button.getAttribute('aria-label'))
        .filter(label => /: €/.test(label))
        .map(label => label.split(':')[0]);

    it('renders the heading and a button per category with its amount', () => {
        render(<CategoryBars data={data} />);

        expect(screen.getByRole('heading', { name: 'Категории' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^Rent: €500,00/ })).toHaveTextContent('€500,00');
        expect(screen.getByRole('button', { name: /^Products: €100,00/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^Coffee: €10,00/ })).toBeInTheDocument();
    });

    it('sorts by amount, biggest first', () => {
        render(<CategoryBars data={data} />);

        expect(rowNames()).toEqual(['Rent', 'Products', 'Coffee']);
    });

    it('draws horizontal bars relative to the biggest category, not to the total', () => {
        const { container } = render(<CategoryBars data={data} />);

        expect(container.querySelector('svg')).not.toBeInTheDocument();
        expect(container.querySelector('[data-category-bar="Rent"] > span')).toHaveStyle({ width: '100%' });
        expect(container.querySelector('[data-category-bar="Products"] > span')).toHaveStyle({ width: '20%' });
        expect(container.querySelector('[data-category-bar="Coffee"] > span')).toHaveStyle({ width: '2%' });
    });

    it('paints the bar with the accent over a sunken track, 8px tall', () => {
        const { container } = render(<CategoryBars data={data} />);

        const track = container.querySelector('[data-category-bar="Rent"]');
        expect(track).toHaveStyle({ height: '8px', background: 'var(--color-surface-sunken)' });
        expect(track.firstChild).toHaveStyle({ background: 'var(--color-primary)' });
    });

    it('returns null if there is no data or nothing was spent', () => {
        expect(render(<CategoryBars data={{}} />).container.firstChild).toBeNull();
        expect(render(<CategoryBars data={{ A: 0 }} />).container.firstChild).toBeNull();
        expect(render(<CategoryBars data={undefined} />).container.firstChild).toBeNull();
    });

    it('calls onSelectCategory with the tapped category name', () => {
        const onSelectCategory = vi.fn();
        render(<CategoryBars data={data} onSelectCategory={onSelectCategory} />);

        fireEvent.click(screen.getByRole('button', { name: /^Products: €/ }));

        expect(onSelectCategory).toHaveBeenCalledTimes(1);
        expect(onSelectCategory).toHaveBeenCalledWith('Products');
    });

    it('gives the rows a button type and no pressed state: they navigate, not toggle', () => {
        render(<CategoryBars data={data} />);

        const row = screen.getByRole('button', { name: /^Rent: €/ });
        expect(row).toHaveAttribute('type', 'button');
        expect(row).not.toHaveAttribute('aria-pressed');
    });

    describe('change against the previous month', () => {
        const comparison = {
            Products: { value: 100, previous: 80, diff: 20, percent: 25 },
            Rent: { value: 500, previous: 560, diff: -60, percent: -11 },
            Coffee: { value: 10, previous: 0, diff: 10, percent: null }
        };

        it('arrow up in the negative colour for growth, arrow down in the positive colour for a drop', () => {
            render(<CategoryBars data={data} comparison={comparison} comparisonLabel="к 15 декабря" />);

            expect(screen.getByText('↑ 25%')).toHaveStyle({ color: 'var(--color-negative)' });
            expect(screen.getByText('↓ 11%')).toHaveStyle({ color: 'var(--color-positive)' });
        });

        it('says «новая» in muted ink when there was nothing last month', () => {
            render(<CategoryBars data={data} comparison={comparison} comparisonLabel="к 15 декабря" />);

            expect(screen.getByText('новая')).toHaveStyle({ color: 'var(--color-text-muted)' });
        });

        it('says «без изменений» in muted ink when the change is under one percent', () => {
            const steady = { Rent: { value: 500, previous: 499, diff: 1, percent: 0 } };
            render(<CategoryBars data={data} comparison={steady} comparisonLabel="к 15 декабря" />);

            expect(screen.getByText('без изменений')).toHaveStyle({ color: 'var(--color-text-muted)' });
            expect(screen.queryByText(/↑|↓/)).not.toBeInTheDocument();
        });

        it('treats exactly one percent as a change', () => {
            render(<CategoryBars data={{ Rent: 101 }} comparison={{ Rent: { value: 101, previous: 100, diff: 1, percent: 1 } }} comparisonLabel="к 15 декабря" />);

            expect(screen.getByText('↑ 1%')).toBeInTheDocument();
        });

        it('shows the comparison date in the header, and the change in the accessible name', () => {
            render(<CategoryBars data={data} comparison={comparison} comparisonLabel="к 15 декабря" />);

            expect(screen.getByText('к 15 декабря')).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Products: €100,00, на 25% больше' })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Rent: €500,00, на 11% меньше' })).toBeInTheDocument();
        });

        it('shows neither the change column nor the date without a comparison', () => {
            render(<CategoryBars data={data} comparisonLabel="к 15 декабря" />);

            expect(screen.queryByText('к 15 декабря')).not.toBeInTheDocument();
            expect(screen.queryByText(/↑|↓|новая|без изменений/)).not.toBeInTheDocument();
        });
    });

    describe('top five and the rest', () => {
        const many = { A: 100, B: 90, C: 80, D: 70, E: 60, F: 50, G: 40 };

        it('shows the five biggest and a button with the count and sum of the rest', () => {
            render(<CategoryBars data={many} />);

            expect(rowNames()).toEqual(['A', 'B', 'C', 'D', 'E']);
            expect(screen.getByRole('button', { name: 'Ещё 2 категории · €90,00' })).toHaveAttribute('aria-expanded', 'false');
        });

        it('expands to all categories and collapses back', () => {
            render(<CategoryBars data={many} />);

            fireEvent.click(screen.getByRole('button', { name: /^Ещё 2 категории/ }));
            expect(rowNames()).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
            const collapse = screen.getByRole('button', { name: 'Свернуть' });
            expect(collapse).toHaveAttribute('aria-expanded', 'true');

            fireEvent.click(collapse);
            expect(rowNames()).toEqual(['A', 'B', 'C', 'D', 'E']);
        });

        it('keeps the bars of an expanded list relative to the biggest category', () => {
            const { container } = render(<CategoryBars data={many} />);

            fireEvent.click(screen.getByRole('button', { name: /^Ещё/ }));

            expect(container.querySelector('[data-category-bar="G"] > span')).toHaveStyle({ width: '40%' });
        });

        it('has no expander for five categories or fewer', () => {
            render(<CategoryBars data={{ A: 5, B: 4, C: 3, D: 2, E: 1 }} />);

            expect(screen.queryByRole('button', { name: /Ещё|Свернуть/ })).not.toBeInTheDocument();
        });

        it.each([
            [1, 'Ещё 1 категория'],
            [4, 'Ещё 4 категории'],
            [6, 'Ещё 6 категорий'],
            [11, 'Ещё 11 категорий']
        ])('agrees the word with the number of hidden categories (%i)', (hiddenCount, label) => {
            const data = Object.fromEntries(Array.from({ length: 5 + hiddenCount }, (_, i) => [`C${i}`, 100 - i]));
            render(<CategoryBars data={data} />);

            expect(screen.getByRole('button', { name: new RegExp(`^${label} ·`) })).toBeInTheDocument();
        });

        it('lets a hidden category be tapped once expanded', () => {
            const onSelectCategory = vi.fn();
            render(<CategoryBars data={many} onSelectCategory={onSelectCategory} />);

            fireEvent.click(screen.getByRole('button', { name: /^Ещё/ }));
            fireEvent.click(within(screen.getByRole('heading', { name: 'Категории' }).closest('section')).getByRole('button', { name: /^G: €/ }));

            expect(onSelectCategory).toHaveBeenCalledWith('G');
        });
    });
});
