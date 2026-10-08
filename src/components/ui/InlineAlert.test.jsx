import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import InlineAlert from './InlineAlert';

describe('InlineAlert', () => {
    it('is a neutral status by default', () => {
        render(<InlineAlert>Пояснение</InlineAlert>);
        expect(screen.getByRole('status')).toHaveTextContent('Пояснение');
    });

    it('uses role status for warning and role alert for danger', () => {
        const { rerender } = render(<InlineAlert tone="warning" title="Данные устарели">Обновите</InlineAlert>);
        expect(screen.getByRole('status')).toHaveTextContent('Данные устарели');
        expect(screen.getByRole('status')).toHaveTextContent('Обновите');

        rerender(<InlineAlert tone="danger" title="Не сохранилось">Повторите</InlineAlert>);
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
        expect(screen.getByRole('alert')).toHaveTextContent('Не сохранилось');
    });

    it('hides the tone icon from assistive tech', () => {
        const { container } = render(<InlineAlert tone="danger">Ошибка</InlineAlert>);
        expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    });

    it('fires the action and respects disabled', () => {
        const onClick = vi.fn();
        const { rerender } = render(<InlineAlert tone="warning" action={{ label: 'Обновить', onClick }}>Устарело</InlineAlert>);

        fireEvent.click(screen.getByRole('button', { name: 'Обновить' }));
        expect(onClick).toHaveBeenCalledTimes(1);

        rerender(<InlineAlert tone="warning" action={{ label: 'Обновить', onClick, disabled: true }}>Устарело</InlineAlert>);
        expect(screen.getByRole('button', { name: 'Обновить' })).toBeDisabled();
    });
});
