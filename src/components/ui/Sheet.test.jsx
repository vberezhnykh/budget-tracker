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

    it('leaves inert content out of the Tab cycle', () => {
        render(
            <Sheet ariaLabel="Тестовый лист" onClose={vi.fn()}>
                <div inert>
                    <button type="button">Скрытая</button>
                </div>
                <button type="button">Видимая</button>
            </Sheet>
        );
        const visible = screen.getByRole('button', { name: 'Видимая' });
        // «Скрытая» не считается ни первой, ни последней: Tab с единственной видимой кнопки остаётся на ней
        expect(visible).toHaveFocus();
        fireEvent.keyDown(document, { key: 'Tab' });
        expect(visible).toHaveFocus();
        fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
        expect(visible).toHaveFocus();
    });
});
