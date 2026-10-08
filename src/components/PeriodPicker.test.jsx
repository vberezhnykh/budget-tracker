import { render, screen, within, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import PeriodPicker from './PeriodPicker';

describe('PeriodPicker chip trigger', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(2026, 0, 15, 12));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    const renderChip = (props = {}) => render(
        <section style={{ backdropFilter: 'blur(4px)' }} data-testid="card">
            <PeriodPicker timeRange="month" selectedMonth="2026-01" onChange={() => { }} {...props} />
        </section>
    );

    it('shows the period label and names itself after it', () => {
        renderChip();
        const trigger = screen.getByRole('button', { name: 'Период: Январь 2026' });
        expect(trigger).toHaveTextContent('Январь 2026');
        expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
    });

    it('portals the sheet to body, out of a containing block like a glass card', () => {
        renderChip();
        fireEvent.click(screen.getByRole('button', { name: /^Период:/ }));

        const dialog = screen.getByRole('dialog', { name: 'Выбор периода' });
        expect(screen.getByTestId('card')).not.toContainElement(dialog);
        expect(document.body).toContainElement(dialog);
        expect(screen.getByRole('button', { name: /^Период:/ })).toHaveAttribute('aria-expanded', 'true');
    });

    it('reports the chosen month and returns focus to the trigger', () => {
        const onChange = vi.fn();
        renderChip({ onChange });
        const trigger = screen.getByRole('button', { name: /^Период:/ });
        fireEvent.click(trigger);

        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Декабрь' }));

        expect(onChange).toHaveBeenCalledWith({ timeRange: 'month', selectedMonth: '2025-12' });
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(trigger).toHaveFocus();
    });
});

describe('PeriodPicker title trigger', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(2026, 9, 8, 12));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    const renderTitle = (props = {}) => render(
        <PeriodPicker variant="title" timeRange="month" selectedMonth="2026-10" onChange={() => { }} {...props} />
    );

    it('reads as a screen title: the month alone for the current year, the full period as the accessible name', () => {
        renderTitle();
        const trigger = screen.getByRole('button', { name: 'Период: Октябрь 2026' });
        expect(trigger).toHaveTextContent(/^Октябрь$/);
        expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
        expect(trigger).toHaveStyle({ fontSize: 'var(--text-title)', fontWeight: 'var(--weight-strong)', minHeight: '44px' });
    });

    it('adds the year for another year, and names year / lifetime', () => {
        const { rerender } = renderTitle({ selectedMonth: '2025-12' });
        expect(screen.getByRole('button', { name: /^Период:/ })).toHaveTextContent(/^Декабрь 2025$/);

        rerender(<PeriodPicker variant="title" timeRange="year" selectedMonth="2026-10" onChange={() => { }} />);
        expect(screen.getByRole('button', { name: /^Период:/ })).toHaveTextContent(/^2026$/);

        rerender(<PeriodPicker variant="title" timeRange="lifetime" selectedMonth="2026-10" onChange={() => { }} />);
        expect(screen.getByRole('button', { name: /^Период:/ })).toHaveTextContent(/^Всё время$/);
    });

    it('opens the same sheet, reports the chosen month and returns focus to the title', () => {
        const onChange = vi.fn();
        renderTitle({ onChange });
        const trigger = screen.getByRole('button', { name: /^Период:/ });
        fireEvent.click(trigger);

        const dialog = screen.getByRole('dialog', { name: 'Выбор периода' });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Сентябрь' }));

        expect(onChange).toHaveBeenCalledWith({ timeRange: 'month', selectedMonth: '2026-09' });
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(trigger).toHaveFocus();
    });
});

