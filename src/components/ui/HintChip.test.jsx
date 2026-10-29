import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import HintChip from './HintChip';

describe('HintChip', () => {
    it('is a plain button, not a toggle', () => {
        render(<HintChip>Сколько ушло на кафе?</HintChip>);
        const button = screen.getByRole('button', { name: 'Сколько ушло на кафе?' });
        expect(button).toHaveAttribute('type', 'button');
        expect(button).not.toHaveAttribute('aria-pressed');
    });

    it('fires onClick and passes other props through', () => {
        const onClick = vi.fn();
        render(<HintChip onClick={onClick} data-testid="hint">Кофе</HintChip>);
        fireEvent.click(screen.getByTestId('hint'));
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('merges style last so layout can override the look', () => {
        render(<HintChip style={{ flex: '0 0 auto', minHeight: '40px' }}>Кофе</HintChip>);
        const button = screen.getByRole('button');
        expect(button.style.flex).toBe('0 0 auto');
        expect(button.style.minHeight).toBe('40px');
        expect(button.style.borderRadius).toBe('var(--radius-pill)');
    });
});
