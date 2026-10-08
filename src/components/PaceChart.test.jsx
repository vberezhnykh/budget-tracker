import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import PaceChart from './PaceChart';

// Октябрь: 31 день, сегодня 8-е. «Обычно»: 100 в 1-й день и по 10 в день.
const byDay = Array.from({ length: 31 }, (_, i) => 100 + i * 10);
const current = {
    months: ['2026-09', '2026-08', '2026-07'],
    byDay,
    monthTotal: byDay[30],
    actualByDay: [120, 120, 130, 150, 150, 160, 170, 180],
    today: { day: 8, typicalToDate: byDay[7], typicalRemaining: 230, spent: 180, forecast: 410 }
};
const past = { ...current, today: null, actualByDay: byDay.map(value => value + 5) };

describe('PaceChart', () => {
    it('is an image with a description of the pace', () => {
        render(<PaceChart typicalMonth={current} selectedMonth="2026-10" limit={7000} />);

        const chart = screen.getByRole('img');
        const label = chart.getAttribute('aria-label');
        expect(label).toContain('на 8 октября потрачено €180,00');
        expect(label).toContain('обычно к этому дню €170,00');
        expect(label).toContain('прогноз на конец месяца около €410');
        expect(label).toContain('лимит €7.000');
    });

    it('describes a finished month by its totals', () => {
        render(<PaceChart typicalMonth={past} selectedMonth="2026-09" limit={null} />);

        const label = screen.getByRole('img').getAttribute('aria-label');
        expect(label).toContain('за месяц потрачено €405,00');
        expect(label).toContain('обычно за месяц €400,00');
        expect(label).not.toContain('лимит');
        expect(label).not.toContain('прогноз');
    });

    it('draws the three lines, the dot at the last day and the limit for the month in progress', () => {
        render(<PaceChart typicalMonth={current} selectedMonth="2026-10" limit={7000} />);

        expect(screen.getByTestId('pace-typical')).toHaveStyle({ stroke: 'var(--color-control-off)', strokeWidth: '6' });
        expect(screen.getByTestId('pace-actual')).toHaveStyle({ stroke: 'var(--color-primary)', strokeWidth: '3' });
        expect(screen.getByTestId('pace-forecast')).toHaveStyle({ stroke: 'var(--color-primary)', strokeDasharray: '6 5' });
        expect(screen.getByTestId('pace-dot')).toBeInTheDocument();
        expect(screen.getByTestId('pace-limit').querySelector('line')).toHaveStyle({ stroke: 'var(--color-negative)' });
    });

    it('has a legend with факт, прогноз and обычно', () => {
        render(<PaceChart typicalMonth={current} selectedMonth="2026-10" limit={null} />);

        expect(screen.getByText('факт')).toBeInTheDocument();
        expect(screen.getByText('прогноз')).toBeInTheDocument();
        expect(screen.getByText('обычно')).toBeInTheDocument();
    });

    it('has no forecast line and no forecast legend for a past month', () => {
        render(<PaceChart typicalMonth={past} selectedMonth="2026-09" limit={7000} />);

        expect(screen.queryByTestId('pace-forecast')).not.toBeInTheDocument();
        expect(screen.queryByText('прогноз')).not.toBeInTheDocument();
        expect(screen.getByText('факт')).toBeInTheDocument();
        expect(screen.getByText('обычно')).toBeInTheDocument();
    });

    it('labels the limit in whole euros', () => {
        render(<PaceChart typicalMonth={current} selectedMonth="2026-10" limit={7000} />);

        expect(screen.getByText('лимит €7.000')).toBeInTheDocument();
    });

    it.each([[null], [0], [undefined], [NaN]])('hides the limit line and its label when the limit is %s', (limit) => {
        render(<PaceChart typicalMonth={current} selectedMonth="2026-10" limit={limit} />);

        expect(screen.queryByTestId('pace-limit')).not.toBeInTheDocument();
        expect(screen.queryByText(/^лимит/)).not.toBeInTheDocument();
    });

    it('labels the days 1, 8, 15, 22 and the last one with the month on the ends', () => {
        render(<PaceChart typicalMonth={current} selectedMonth="2026-10" limit={null} />);

        ['1 окт', '8', '15', '22', '31 окт'].forEach(text => {
            expect(screen.getByText(text, { selector: 'text' })).toBeInTheDocument();
        });
    });

    it('shows the values of the touched day in a tooltip', () => {
        render(<PaceChart typicalMonth={current} selectedMonth="2026-10" limit={null} />);
        const chart = screen.getByRole('img');
        chart.getBoundingClientRect = () => ({ left: 0, top: 0, width: 320, height: 150 });

        // x = 8 + (day - 1) / 30 * 298 -> день 4 примерно в 37.8.
        fireEvent.pointerDown(chart, { clientX: 38, pointerType: 'touch' });

        const tooltip = screen.getByTestId('pace-tooltip');
        expect(tooltip).toHaveTextContent('4 окт');
        expect(tooltip).toHaveTextContent('€150,00 факт');
        expect(tooltip).toHaveTextContent('€130,00 обычно');
        expect(tooltip).not.toHaveTextContent('прогноз');
    });

    it('shows the forecast value, not the fact, for a day after today', () => {
        render(<PaceChart typicalMonth={current} selectedMonth="2026-10" limit={null} />);
        const chart = screen.getByRole('img');
        chart.getBoundingClientRect = () => ({ left: 0, top: 0, width: 320, height: 150 });

        fireEvent.pointerMove(chart, { clientX: 306, pointerType: 'mouse' });

        const tooltip = screen.getByTestId('pace-tooltip');
        expect(tooltip).toHaveTextContent('31 окт');
        expect(tooltip).toHaveTextContent('€410 прогноз');
        expect(tooltip).not.toHaveTextContent('факт');

        fireEvent.pointerLeave(chart, { pointerType: 'mouse' });
        expect(screen.queryByTestId('pace-tooltip')).not.toBeInTheDocument();
    });
});
