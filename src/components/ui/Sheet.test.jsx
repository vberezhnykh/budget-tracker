import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Sheet from './Sheet';

describe('Sheet', () => {
    it('moves focus into the dialog, traps Tab, closes on Escape, and restores focus', () => {
        const opener = document.createElement('button');
        document.body.appendChild(opener);
        opener.focus();
        const onClose = vi.fn();

        const { unmount } = render(
            <Sheet ariaLabel="Тестовый лист" onClose={onClose}>
                <button type="button">Первая</button>
                <button type="button">Последняя</button>
            </Sheet>
        );

        const first = screen.getByRole('button', { name: 'Первая' });
        const last = screen.getByRole('button', { name: 'Последняя' });
        expect(first).toHaveFocus();

        first.focus();
        fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
        expect(last).toHaveFocus();

        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);

        unmount();
        expect(opener).toHaveFocus();
        opener.remove();
    });
});
