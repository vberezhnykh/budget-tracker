import { render, screen, within, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import PeriodPicker from './PeriodPicker';

describe('PeriodPicker inline trigger', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(2026, 0, 15, 12));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    const renderInline = (props = {}) => render(
        <section style={{ backdropFilter: 'blur(4px)' }} data-testid="card">
            <PeriodPicker variant="inline" prefix="Расход за" timeRange="month" selectedMonth="2026-01" onChange={() => { }} {...props} />
        </section>
    );

    it('reads as a phrase and keeps the chip\'s accessible name', () => {
        renderInline();
        const trigger = screen.getByRole('button', { name: 'Период: Январь 2026' });
        expect(trigger).toHaveTextContent('Расход за январь');
        expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
    });

    it('adds the year to the phrase for a month of another year, and names year / lifetime', () => {
        const { rerender } = renderInline({ selectedMonth: '2025-12' });
        expect(screen.getByRole('button', { name: /^Период:/ })).toHaveTextContent('Расход за декабрь 2025');

        rerender(<PeriodPicker variant="inline" prefix="Расход за" timeRange="year" selectedMonth="2026-01" onChange={() => { }} />);
        expect(screen.getByRole('button', { name: /^Период:/ })).toHaveTextContent('Расход за 2026');

        rerender(<PeriodPicker variant="inline" prefix="Расход за" timeRange="lifetime" selectedMonth="2026-01" onChange={() => { }} />);
        expect(screen.getByRole('button', { name: /^Период:/ })).toHaveTextContent('Расход за всё время');
    });

    it('portals the sheet to body, out of a containing block like a glass card', () => {
        renderInline();
        fireEvent.click(screen.getByRole('button', { name: /^Период:/ }));

        const dialog = screen.getByRole('dialog', { name: 'Выбор периода' });
        expect(screen.getByTestId('card')).not.toContainElement(dialog);
        expect(document.body).toContainElement(dialog);
        expect(screen.getByRole('button', { name: /^Период:/ })).toHaveAttribute('aria-expanded', 'true');
    });

    it('reports the chosen month and returns focus to the trigger', () => {
        const onChange = vi.fn();
        renderInline({ onChange });
        const trigger = screen.getByRole('button', { name: /^Период:/ });
        fireEvent.click(trigger);

        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Декабрь' }));

        expect(onChange).toHaveBeenCalledWith({ timeRange: 'month', selectedMonth: '2025-12' });
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(trigger).toHaveFocus();
    });
});
