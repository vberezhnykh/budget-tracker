import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ScreenHeader from './ScreenHeader';

describe('ScreenHeader', () => {
    it('renders the title as a level-1 heading', () => {
        render(<ScreenHeader title="Счета" />);
        expect(screen.getByRole('heading', { level: 1, name: 'Счета' })).toBeInTheDocument();
    });

    it('has no back button without onBack', () => {
        render(<ScreenHeader title="Обзор" backLabel="Ещё" actions={<button type="button">Месяц</button>} />);

        expect(screen.queryByRole('button', { name: 'Ещё' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Месяц' })).toBeInTheDocument();
    });

    it('calls onBack from a button with the visible back label', () => {
        const onBack = vi.fn();
        render(<ScreenHeader title="Счета" onBack={onBack} backLabel="Ещё" actions={<button type="button">Добавить</button>} />);

        fireEvent.click(screen.getByRole('button', { name: 'Ещё' }));
        expect(onBack).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('button', { name: 'Добавить' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { level: 1, name: 'Счета' })).toBeInTheDocument();
    });
});
