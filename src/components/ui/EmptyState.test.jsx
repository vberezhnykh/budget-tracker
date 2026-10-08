import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import EmptyState from './EmptyState';

describe('EmptyState', () => {
    it('renders icon, title and description', () => {
        render(<EmptyState icon={<svg data-testid="icon" />} title="Операций нет" description="Добавьте первую операцию." />);

        expect(screen.getByTestId('icon')).toBeInTheDocument();
        expect(screen.getByText('Операций нет')).toBeInTheDocument();
        expect(screen.getByText('Добавьте первую операцию.')).toBeInTheDocument();
    });

    it('renders the provided actions and keeps them clickable', () => {
        const onAdd = vi.fn();
        render(<EmptyState title="Пусто" actions={<button type="button" onClick={onAdd}>Добавить</button>} />);

        fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));
        expect(onAdd).toHaveBeenCalledTimes(1);
    });

    it('omits optional parts when they are not given', () => {
        const { container } = render(<EmptyState title="Пусто" />);
        expect(container.querySelector('button')).toBeNull();
        expect(screen.getByText('Пусто')).toBeInTheDocument();
    });
});
