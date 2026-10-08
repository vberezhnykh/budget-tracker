import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import AccountStrip from './AccountStrip';

const slides = [
    { key: 'total', theme: 'total', icon: 'wallet', name: 'Все счета', amount: 3500, filter: null, note: '1.500,00 € заморожено' },
    { key: 'card', theme: 'teal', icon: 'credit-card', type: 'card', name: 'Карта', amount: 2000, filter: 'card', note: null },
    { key: 'dep', theme: 'violet', icon: 'vault', type: 'card', name: 'Залог', amount: 1500, filter: 'dep', note: 'вне общего капитала' },
];

beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
});

describe('AccountStrip', () => {
    it('renders one pressed-state button per slide, in order, with name, balance and note', () => {
        render(<AccountStrip slides={slides} selectedAccount={null} onSelect={() => { }} />);

        const buttons = screen.getAllByRole('button');
        expect(buttons.map(button => button.getAttribute('aria-label'))).toEqual([
            'Все счета: €3.500,00, 1.500,00 € заморожено',
            'Карта: €2.000,00',
            'Залог: €1.500,00, вне общего капитала',
        ]);
        expect(buttons[0]).toHaveAttribute('aria-pressed', 'true');
        expect(buttons[1]).toHaveAttribute('aria-pressed', 'false');
        expect(buttons[2]).toHaveAttribute('aria-pressed', 'false');
        expect(buttons[1]).toHaveAttribute('data-account-theme', 'teal');
        expect(buttons[1]).toHaveTextContent('€2.000,00');
        expect(buttons[2]).toHaveTextContent('вне общего капитала');
    });

    it('marks the card of the selected account and reports the tapped slide', () => {
        const onSelect = vi.fn();
        render(<AccountStrip slides={slides} selectedAccount="card" onSelect={onSelect} />);

        expect(screen.getByRole('button', { name: /^Карта:/ })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: /^Все счета:/ })).toHaveAttribute('aria-pressed', 'false');

        fireEvent.click(screen.getByRole('button', { name: /^Залог:/ }));
        expect(onSelect).toHaveBeenCalledWith(slides[2]);
    });

    it('brings the selected card into view and again when the selection changes from outside', () => {
        const { rerender } = render(<AccountStrip slides={slides} selectedAccount="card" onSelect={() => { }} />);
        expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
        expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ inline: 'nearest', block: 'nearest' });
        expect(Element.prototype.scrollIntoView.mock.contexts[0]).toBe(screen.getByRole('button', { name: /^Карта:/ }));

        rerender(<AccountStrip slides={slides} selectedAccount="dep" onSelect={() => { }} />);
        expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(2);
        expect(Element.prototype.scrollIntoView.mock.contexts[1]).toBe(screen.getByRole('button', { name: /^Залог:/ }));
    });

    it('does not select anything on scroll, and does not re-scroll when only balances change', () => {
        const onSelect = vi.fn();
        const { rerender } = render(<AccountStrip slides={slides} selectedAccount={null} onSelect={onSelect} />);
        Element.prototype.scrollIntoView.mockClear();

        fireEvent.scroll(screen.getByTestId('accounts-row'));
        rerender(<AccountStrip slides={slides.map(slide => ({ ...slide, amount: slide.amount + 1 }))} selectedAccount={null} onSelect={onSelect} />);

        expect(onSelect).not.toHaveBeenCalled();
        expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    });
});
