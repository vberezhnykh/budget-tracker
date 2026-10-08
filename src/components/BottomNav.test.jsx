import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import BottomNav, { NAV_HEIGHT } from './BottomNav';

describe('BottomNav', () => {
    it('is a labelled navigation with four tabs and the add button between them', () => {
        render(<BottomNav active="overview" onChange={() => { }} onAdd={() => { }} />);
        const nav = screen.getByRole('navigation', { name: 'Основная навигация' });

        expect(within(nav).getAllByRole('button').map(button => button.getAttribute('aria-label') || button.textContent))
            .toEqual(['Обзор', 'История', 'Добавить операцию', 'Аналитика', 'Ещё']);
        expect(NAV_HEIGHT).toBe(64);
    });

    it('marks only the active tab with aria-current="page"', () => {
        const { rerender } = render(<BottomNav active="history" onChange={() => { }} onAdd={() => { }} />);

        expect(screen.getByRole('button', { name: 'История' })).toHaveAttribute('aria-current', 'page');
        for (const name of ['Обзор', 'Аналитика', 'Ещё']) {
            expect(screen.getByRole('button', { name })).not.toHaveAttribute('aria-current');
        }
        expect(screen.getByRole('button', { name: 'Добавить операцию' })).not.toHaveAttribute('aria-current');

        rerender(<BottomNav active="more" onChange={() => { }} onAdd={() => { }} />);
        expect(screen.getByRole('button', { name: 'Ещё' })).toHaveAttribute('aria-current', 'page');
        expect(screen.getByRole('button', { name: 'История' })).not.toHaveAttribute('aria-current');
    });

    it.each([
        ['Обзор', 'overview'],
        ['История', 'history'],
        ['Аналитика', 'analytics'],
        ['Ещё', 'more'],
    ])('switches to %s with its screen id', (name, id) => {
        const onChange = vi.fn();
        render(<BottomNav active="overview" onChange={onChange} onAdd={() => { }} />);

        fireEvent.click(screen.getByRole('button', { name }));

        expect(onChange).toHaveBeenCalledWith(id);
    });

    it('calls onAdd from the center button without switching tabs', () => {
        const onChange = vi.fn();
        const onAdd = vi.fn();
        render(<BottomNav active="overview" onChange={onChange} onAdd={onAdd} />);

        fireEvent.click(screen.getByRole('button', { name: 'Добавить операцию' }));

        expect(onAdd).toHaveBeenCalledTimes(1);
        expect(onChange).not.toHaveBeenCalled();
    });
});
