import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Checkbox from './Checkbox';

const box = container => container.querySelector('.ui-checkbox-box');

describe('Checkbox', () => {
    it('is a real checkbox input that reports its state and fires onChange', () => {
        const onChange = vi.fn();
        render(<label>Lidl <Checkbox checked={false} onChange={onChange} /></label>);
        const input = screen.getByRole('checkbox', { name: 'Lidl' });
        expect(input).not.toBeChecked();
        fireEvent.click(input);
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('toggles when the label text is clicked', () => {
        const onChange = vi.fn();
        render(<label><span>Lidl</span><Checkbox checked={false} onChange={onChange} /></label>);
        fireEvent.click(screen.getByText('Lidl'));
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('draws an empty bordered box when off', () => {
        const { container } = render(<Checkbox checked={false} onChange={() => {}} aria-label="Флажок" />);
        expect(box(container).style.background).toBe('var(--color-surface)');
        expect(box(container).style.border).toContain('1.5px solid');
        expect(box(container).querySelector('svg')).toBeNull();
    });

    it('fills the box with a check when on', () => {
        const { container } = render(<Checkbox checked onChange={() => {}} aria-label="Флажок" />);
        expect(screen.getByRole('checkbox')).toBeChecked();
        expect(box(container).style.background).toBe('var(--color-primary)');
        expect(box(container).querySelector('svg.lucide-check')).not.toBeNull();
    });

    it('shows a minus and keeps indeterminate on the input when mixed', () => {
        const { container, rerender } = render(<Checkbox checked={false} mixed onChange={() => {}} aria-label="Флажок" />);
        const input = screen.getByRole('checkbox');
        expect(input.indeterminate).toBe(true);
        expect(box(container).style.background).toBe('var(--color-primary)');
        expect(box(container).querySelector('svg.lucide-minus')).not.toBeNull();

        rerender(<Checkbox checked={false} mixed={false} onChange={() => {}} aria-label="Флажок" />);
        expect(input.indeterminate).toBe(false);
    });

    it('hides the drawn box from assistive tech and passes other props to the input', () => {
        const { container } = render(<Checkbox checked={false} onChange={() => {}} aria-label="Флажок" disabled name="x" />);
        expect(box(container)).toHaveAttribute('aria-hidden', 'true');
        const input = screen.getByRole('checkbox');
        expect(input).toBeDisabled();
        expect(input).toHaveAttribute('name', 'x');
    });
});
