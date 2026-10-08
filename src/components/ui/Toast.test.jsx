import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Toast from './Toast';

describe('Toast', () => {
    it('is a polite status by default and an alert for the danger tone', () => {
        const { rerender } = render(<Toast message="Сохранено" />);
        expect(screen.getByRole('status')).toHaveTextContent('Сохранено');

        rerender(<Toast message="Не удалось сохранить" tone="danger" />);
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
        expect(screen.getByRole('alert')).toHaveTextContent('Не удалось сохранить');
    });

    it('fires the action', () => {
        const onClick = vi.fn();
        render(<Toast message="Операция удалена" action={{ label: 'Отменить', onClick }} />);

        fireEvent.click(screen.getByRole('button', { name: 'Отменить' }));
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('shows a labelled close button only when onClose is given', () => {
        const onClose = vi.fn();
        const { rerender } = render(<Toast message="Готово" />);
        expect(screen.queryByRole('button', { name: 'Закрыть' })).not.toBeInTheDocument();

        rerender(<Toast message="Готово" onClose={onClose} />);
        fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('floats above the bottom bar by default and honours bottomOffset', () => {
        const { rerender } = render(<Toast message="Готово" />);
        expect(screen.getByRole('status').style.bottom).toBe('104px');

        rerender(<Toast message="Готово" bottomOffset={24} />);
        expect(screen.getByRole('status').style.bottom).toBe('24px');
    });
});
