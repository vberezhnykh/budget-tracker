import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useState } from 'react';
import MonthlyTrend from './MonthlyTrend';

describe('MonthlyTrend Component', () => {
    // Идущий месяц и «закрытые» определяются по часам, поэтому «сейчас» зафиксировано.
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(2026, 0, 15, 12));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    const series = [
        { month: '2025-12', label: 'дек', year: 2025, income: 500, expense: 200 },
        { month: '2026-01', label: 'янв', year: 2026, income: 300, expense: 400 }
    ];

    // Полгода: октябрь - март, сегодня январь.
    const half = [
        { month: '2025-10', label: 'окт', year: 2025, income: 0, expense: 300 },
        { month: '2025-11', label: 'ноя', year: 2025, income: 0, expense: 800 },
        { month: '2025-12', label: 'дек', year: 2025, income: 0, expense: 450 },
        { month: '2026-01', label: 'янв', year: 2026, income: 0, expense: 200 }
    ];

    const barOf = (name) => screen.getByRole('button', { name }).querySelector('[data-testid="monthly-trend-bar"]');

    it('renders a bar button per month, labelled with the month and the expense', () => {
        render(<MonthlyTrend series={series} selectedMonth="2026-01" onSelectMonth={() => { }} />);

        expect(screen.getByText('дек')).toBeInTheDocument();
        expect(screen.getByText('янв')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Декабрь 2025: расход €200,00' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Январь 2026: расход €400,00' })).toBeInTheDocument();
    });

    it('marks the selected month as pressed and clicking a bar calls onSelectMonth', () => {
        const handleSelect = vi.fn();
        render(<MonthlyTrend series={series} selectedMonth="2026-01" onSelectMonth={handleSelect} />);

        const decColumn = screen.getByRole('button', { name: /Декабрь 2025/ });
        const janColumn = screen.getByRole('button', { name: /Январь 2026/ });

        expect(decColumn).toHaveAttribute('aria-pressed', 'false');
        expect(janColumn).toHaveAttribute('aria-pressed', 'true');

        fireEvent.click(decColumn);
        expect(handleSelect).toHaveBeenCalledWith('2025-12');
    });

    it('returns null for an empty series', () => {
        const { container } = render(
            <MonthlyTrend series={[]} selectedMonth="2026-01" onSelectMonth={() => { }} />
        );
        expect(container.firstChild).toBeNull();
    });

    it('is a named section with the heading «По месяцам»', () => {
        render(<MonthlyTrend series={series} selectedMonth="2026-01" onSelectMonth={() => { }} />);

        expect(screen.getByRole('region', { name: 'По месяцам' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'По месяцам' })).toBeInTheDocument();
    });

    it('draws only expenses: no income in the names and no income/expense legend', () => {
        render(<MonthlyTrend series={series} selectedMonth="2026-01" onSelectMonth={() => { }} />);

        expect(screen.queryByText('Доход')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Декабрь 2025/ }).getAttribute('aria-label')).not.toMatch(/доход/);
    });

    function InteractiveTrend() {
        const [month, setMonth] = useState('2026-01');
        return <MonthlyTrend series={series} selectedMonth={month} onSelectMonth={setMonth} />;
    }

    it('supports keyboard navigation while keeping focus on the selected month', () => {
        render(<InteractiveTrend />);
        const december = screen.getByRole('button', { name: /Декабрь 2025:/ });
        const january = screen.getByRole('button', { name: /Январь 2026:/ });
        fireEvent.keyDown(january, { key: 'ArrowLeft' });
        expect(december).toHaveFocus();
        expect(december).toHaveAttribute('aria-pressed', 'true');
        fireEvent.keyDown(december, { key: 'End' });
        expect(january).toHaveFocus();
        expect(january).toHaveAttribute('aria-pressed', 'true');
        fireEvent.keyDown(january, { key: 'ArrowRight' });
        expect(january).toHaveFocus();
    });

    it('bolds the label of the selected month only', () => {
        render(<MonthlyTrend series={series} selectedMonth="2026-01" onSelectMonth={() => { }} />);

        expect(screen.getByText('янв')).toHaveStyle({ fontWeight: 'var(--weight-strong)' });
        expect(screen.getByText('дек')).toHaveStyle({ fontWeight: 'var(--weight-text)' });
    });

    it('shows the year under the first month and where it changes, when the series spans two years', () => {
        render(<MonthlyTrend series={half} selectedMonth="2026-01" onSelectMonth={() => { }} />);

        // Октябрь - декабрь 2025 и январь 2026: по одной подписи на год.
        expect(screen.getAllByText('2025')).toHaveLength(1);
        expect(screen.getAllByText('2026')).toHaveLength(1);
        expect(within(screen.getByRole('button', { name: /^Октябрь 2025/ })).getByText('2025')).toBeInTheDocument();
        expect(within(screen.getByRole('button', { name: /^Январь 2026/ })).getByText('2026')).toBeInTheDocument();
    });

    it('shows no year at all when the series stays within one year', () => {
        render(<MonthlyTrend series={half.slice(0, 3)} selectedMonth="2025-12" onSelectMonth={() => { }} />);

        expect(screen.queryByText('2025')).not.toBeInTheDocument();
    });

    it('sizes the bars relative to the biggest expense and keeps a zero month empty', () => {
        const withZero = [{ month: '2025-12', label: 'дек', year: 2025, income: 0, expense: 0 }, series[1]];
        render(<MonthlyTrend series={withZero} selectedMonth="2026-01" onSelectMonth={() => { }} />);

        expect(barOf(/Декабрь 2025/)).toHaveStyle({ height: '0%' });
        expect(parseFloat(barOf(/Январь 2026/).style.height)).toBeGreaterThan(80);
    });

    describe('bar colours', () => {
        it('the selected month is the accent, the others neutral grey', () => {
            render(<MonthlyTrend series={half} selectedMonth="2025-12" onSelectMonth={() => { }} limit={null} />);

            expect(barOf(/Декабрь 2025/)).toHaveStyle({ background: 'var(--color-primary)' });
            expect(barOf(/Ноябрь 2025/)).toHaveStyle({ background: 'var(--color-control-off)' });
            expect(barOf(/Январь 2026/)).toHaveStyle({ background: 'var(--color-control-off)' });
        });

        it('months above the limit are negative, those at or below it are grey', () => {
            render(<MonthlyTrend series={half} selectedMonth="2026-01" onSelectMonth={() => { }} limit={450} />);

            expect(barOf(/Ноябрь 2025/)).toHaveStyle({ background: 'var(--color-negative)' });
            expect(barOf(/Ноябрь 2025/)).toHaveAttribute('data-over-limit', 'true');
            // Ровно по лимиту - ещё не превышение.
            expect(barOf(/Декабрь 2025/)).toHaveStyle({ background: 'var(--color-control-off)' });
            expect(barOf(/Октябрь 2025/)).toHaveStyle({ background: 'var(--color-control-off)' });
        });

        it('the selection wins over the over-limit colour', () => {
            render(<MonthlyTrend series={half} selectedMonth="2025-11" onSelectMonth={() => { }} limit={450} />);

            expect(barOf(/Ноябрь 2025/)).toHaveStyle({ background: 'var(--color-primary)' });
        });

        it('says in the name that the limit is exceeded', () => {
            render(<MonthlyTrend series={half} selectedMonth="2026-01" onSelectMonth={() => { }} limit={450} />);

            expect(screen.getByRole('button', { name: 'Ноябрь 2025: расход €800,00, лимит превышен' })).toBeInTheDocument();
        });

        it('has no over-limit colouring without a usable limit', () => {
            render(<MonthlyTrend series={half} selectedMonth="2026-01" onSelectMonth={() => { }} limit={0} />);

            expect(barOf(/Ноябрь 2025/)).toHaveStyle({ background: 'var(--color-control-off)' });
        });
    });

    describe('limit line', () => {
        it('is a dashed negative line with a legend entry in whole euros', () => {
            render(<MonthlyTrend series={half} selectedMonth="2026-01" onSelectMonth={() => { }} limit={7000} />);

            expect(screen.getByTestId('monthly-trend-limit')).toBeInTheDocument();
            expect(screen.getByText('лимит €7.000')).toBeInTheDocument();
        });

        it('is positioned by the share of the limit in the scale', () => {
            render(<MonthlyTrend series={half} selectedMonth="2026-01" onSelectMonth={() => { }} limit={400} />);

            // Шкала: max(лимит, 800) * 1.1 = 880 -> 400 / 880.
            const ratio = Number(screen.getByTestId('monthly-trend-limit').style.bottom.match(/\* ([\d.]+)\)$/)[1]);
            expect(ratio).toBeCloseTo(400 / 880, 6);
        });

        it('lifts the scale when the limit is above every bar', () => {
            render(<MonthlyTrend series={half} selectedMonth="2026-01" onSelectMonth={() => { }} limit={7000} />);

            expect(parseFloat(barOf(/Ноябрь 2025/).style.height)).toBeLessThan(15);
        });

        it.each([[null], [0], [NaN], [undefined]])('is absent when the limit is %s', (limit) => {
            render(<MonthlyTrend series={half} selectedMonth="2026-01" onSelectMonth={() => { }} limit={limit} />);

            expect(screen.queryByTestId('monthly-trend-limit')).not.toBeInTheDocument();
            expect(screen.queryByText(/^лимит/)).not.toBeInTheDocument();
        });

        it('is drawn for the year view but not for all time', () => {
            const { rerender } = render(<MonthlyTrend series={half} selectedMonth="2026-01" onSelectMonth={() => { }} timeRange="year" limit={7000} />);
            expect(screen.getByTestId('monthly-trend-limit')).toBeInTheDocument();

            rerender(<MonthlyTrend series={half} selectedMonth="2026-01" onSelectMonth={() => { }} timeRange="lifetime" limit={7000} />);
            expect(screen.queryByTestId('monthly-trend-limit')).not.toBeInTheDocument();
        });
    });

    describe('forecast ghost bar', () => {
        it('stands behind the bar of the current month, up to the forecast, as a dashed outline', () => {
            render(<MonthlyTrend series={half} selectedMonth="2026-01" onSelectMonth={() => { }} limit={null} forecast={600} />);

            const january = screen.getByRole('button', { name: /^Январь 2026/ });
            const ghost = within(january).getByTestId('monthly-trend-ghost');
            expect(ghost).toHaveClass('monthly-trend__bar--ghost');
            // Прогноз 600 из шкалы 880: контур выше факта (200).
            expect(parseFloat(ghost.style.height)).toBeCloseTo((600 / 880) * 100, 3);
            expect(parseFloat(ghost.style.height)).toBeGreaterThan(parseFloat(barOf(/Январь 2026/).style.height));
            // Контур лежит в DOM раньше факта, то есть позади него.
            expect(ghost.compareDocumentPosition(barOf(/Январь 2026/)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        });

        it('is only for the current month', () => {
            render(<MonthlyTrend series={half} selectedMonth="2026-01" onSelectMonth={() => { }} limit={null} forecast={600} />);

            expect(screen.getAllByTestId('monthly-trend-ghost')).toHaveLength(1);
            expect(within(screen.getByRole('button', { name: /^Декабрь 2025/ })).queryByTestId('monthly-trend-ghost')).not.toBeInTheDocument();
        });

        it('names the forecast in the button and the legend', () => {
            render(<MonthlyTrend series={half} selectedMonth="2026-01" onSelectMonth={() => { }} limit={null} forecast={599.6} />);

            expect(screen.getByRole('button', { name: 'Январь 2026: расход €200,00, прогноз €600' })).toBeInTheDocument();
            expect(screen.getByText('прогноз месяца')).toBeInTheDocument();
        });

        it.each([[null], [0], [NaN], [undefined]])('is absent without a forecast (%s)', (forecast) => {
            render(<MonthlyTrend series={half} selectedMonth="2026-01" onSelectMonth={() => { }} limit={null} forecast={forecast} />);

            expect(screen.queryByTestId('monthly-trend-ghost')).not.toBeInTheDocument();
            expect(screen.queryByText('прогноз месяца')).not.toBeInTheDocument();
        });

        it('is absent when the current month is not in the series', () => {
            render(<MonthlyTrend series={half.slice(0, 3)} selectedMonth="2025-12" onSelectMonth={() => { }} limit={null} forecast={600} />);

            expect(screen.queryByTestId('monthly-trend-ghost')).not.toBeInTheDocument();
        });
    });

    describe('caption', () => {
        it('counts the closed months over the limit and gives the average, for the month view', () => {
            render(<MonthlyTrend series={half} selectedMonth="2026-01" onSelectMonth={() => { }} limit={450} />);

            // Закрытые: октябрь 300, ноябрь 800, декабрь 450 -> превышен в 1 из 3; среднее 516,67.
            expect(screen.getByText('Лимит превышен в 1 месяце из 3 закрытых. Средний расход €517.')).toBeInTheDocument();
        });

        it('uses the plural «месяцах»', () => {
            render(<MonthlyTrend series={half} selectedMonth="2026-01" onSelectMonth={() => { }} limit={299} />);

            expect(screen.getByText(/^Лимит превышен в 3 месяцах из 3 закрытых\./)).toBeInTheDocument();
        });

        it('drops the limit part without a usable limit', () => {
            render(<MonthlyTrend series={half} selectedMonth="2026-01" onSelectMonth={() => { }} limit={null} />);

            expect(screen.getByText('Средний расход €517.')).toBeInTheDocument();
        });

        it('is not shown for the year view', () => {
            render(<MonthlyTrend series={half} selectedMonth="2026-01" onSelectMonth={() => { }} timeRange="year" limit={450} />);

            expect(screen.queryByText(/Средний расход/)).not.toBeInTheDocument();
        });
    });

    describe('scrolling and size', () => {
        it('fits six months on the screen for the month view and twelve for the year view', () => {
            const { rerender } = render(<MonthlyTrend series={half} selectedMonth="2026-01" onSelectMonth={() => { }} />);
            // 4 месяца из 6 помещаются без прокрутки: дорожка не шире окна.
            expect(screen.getByTestId('monthly-trend-scroll').firstChild.style.width).toBe('100%');

            const eleven = Array.from({ length: 11 }, (_, i) => ({
                month: `2025-${String(i + 2).padStart(2, '0')}`, label: `м${i}`, year: 2025, income: 0, expense: 100
            }));
            rerender(<MonthlyTrend series={eleven} selectedMonth="2025-12" onSelectMonth={() => { }} />);
            expect(parseFloat(screen.getByTestId('monthly-trend-scroll').firstChild.style.width)).toBeCloseTo((11 / 6) * 100, 3);

            rerender(<MonthlyTrend series={eleven} selectedMonth="2025-12" onSelectMonth={() => { }} timeRange="year" />);
            expect(screen.getByTestId('monthly-trend-scroll').firstChild.style.width).toBe('100%');
        });
    });
});
