import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import PaceCard from './PaceCard';

// Октябрь 2026: 31 день. «Обычно» - 100 в 1-й день и по 10 в день.
const byDay = Array.from({ length: 31 }, (_, i) => 100 + i * 10);
const months = ['2026-09', '2026-08', '2026-07', '2026-06', '2026-05', '2026-04'];

const monthInProgress = (today = {}, extra = {}) => ({
    months,
    byDay,
    monthTotal: byDay[30],
    actualByDay: Array.from({ length: 8 }, (_, i) => 100 + i * 5),
    today: { day: 8, typicalToDate: 170, typicalRemaining: 230, spent: 135, forecast: 365, ...today },
    ...extra
});

const pastMonth = (actual) => ({
    months,
    byDay,
    monthTotal: 400,
    actualByDay: Array.from({ length: 31 }, (_, i) => (i === 30 ? actual : 100)),
    today: null
});

describe('PaceCard', () => {
    it('titles the card and counts the days of the month in progress', () => {
        render(<PaceCard typicalMonth={monthInProgress()} selectedMonth="2026-10" monthlyLimit={7000} />);

        expect(screen.getByRole('heading', { name: 'Темп трат' })).toBeInTheDocument();
        expect(screen.getByText('8 из 31 дня')).toBeInTheDocument();
    });

    it('agrees «дней» with the length of the month', () => {
        const thirty = { ...monthInProgress(), byDay: byDay.slice(0, 30) };
        render(<PaceCard typicalMonth={thirty} selectedMonth="2026-11" monthlyLimit={7000} />);

        expect(screen.getByText('8 из 30 дней')).toBeInTheDocument();
    });

    it('has no day counter for a past month', () => {
        render(<PaceCard typicalMonth={pastMonth(400)} selectedMonth="2026-09" monthlyLimit={7000} />);

        expect(screen.queryByText(/ из \d+ дн/)).not.toBeInTheDocument();
    });

    describe('tiles of the month in progress', () => {
        it('compares what is usually spent by today with what is spent now: less is good', () => {
            render(<PaceCard typicalMonth={monthInProgress()} selectedMonth="2026-10" monthlyLimit={7000} />);

            expect(screen.getByText('Обычно к 8 октября')).toBeInTheDocument();
            expect(screen.getByText('€170,00')).toBeInTheDocument();
            expect(screen.getByText('Сейчас')).toBeInTheDocument();
            expect(screen.getByText('€135,00')).toBeInTheDocument();
            expect(screen.getByText('на €35,00 меньше')).toHaveStyle({ color: 'var(--color-positive)' });
        });

        it('says «больше» in the negative colour when spending is above usual', () => {
            render(<PaceCard typicalMonth={monthInProgress({ spent: 250 })} selectedMonth="2026-10" monthlyLimit={7000} />);

            expect(screen.getByText('на €80,00 больше')).toHaveStyle({ color: 'var(--color-negative)' });
        });

        it('says «как обычно» for a difference under one euro', () => {
            render(<PaceCard typicalMonth={monthInProgress({ spent: 170.9 })} selectedMonth="2026-10" monthlyLimit={7000} />);

            expect(screen.getByText('как обычно')).toBeInTheDocument();
            expect(screen.queryByText(/меньше|больше/)).not.toBeInTheDocument();
        });

        it('treats exactly one euro as a difference', () => {
            render(<PaceCard typicalMonth={monthInProgress({ spent: 171 })} selectedMonth="2026-10" monthlyLimit={7000} />);

            expect(screen.getByText('на €1,00 больше')).toBeInTheDocument();
        });
    });

    describe('tiles of a past month', () => {
        it('compares the usual month total with the fact', () => {
            render(<PaceCard typicalMonth={pastMonth(520)} selectedMonth="2026-09" monthlyLimit={7000} />);

            expect(screen.getByText('Обычно за месяц')).toBeInTheDocument();
            expect(screen.getByText('€400,00')).toBeInTheDocument();
            expect(screen.getByText('Факт')).toBeInTheDocument();
            expect(screen.getByText('€520,00')).toBeInTheDocument();
            expect(screen.getByText('на €120,00 больше')).toHaveStyle({ color: 'var(--color-negative)' });
        });

        it('has no forecast block', () => {
            render(<PaceCard typicalMonth={pastMonth(400)} selectedMonth="2026-09" monthlyLimit={7000} />);

            expect(screen.queryByText(/^Прогноз на/)).not.toBeInTheDocument();
            expect(screen.getByText('как обычно')).toBeInTheDocument();
        });
    });

    describe('forecast block', () => {
        it('shows the forecast for the last day of the month in whole euros', () => {
            render(<PaceCard typicalMonth={monthInProgress({ forecast: 364.6 })} selectedMonth="2026-10" monthlyLimit={7000} />);

            expect(screen.getByText('Прогноз на 31 октября')).toBeInTheDocument();
            expect(screen.getByText('≈ €365')).toBeInTheDocument();
        });

        it('says what is usually spent for the rest of the month and the headroom to the limit', () => {
            render(<PaceCard typicalMonth={monthInProgress()} selectedMonth="2026-10" monthlyLimit={7000} />);

            expect(screen.getByText('С 9 по 31 число вы обычно тратите около €230. Если так и будет, запас до лимита ≈ €6.635.')).toBeInTheDocument();
        });

        it('says the limit will be exceeded when the forecast is above it', () => {
            render(<PaceCard typicalMonth={monthInProgress({ forecast: 365 })} selectedMonth="2026-10" monthlyLimit={300} />);

            expect(screen.getByText('С 9 по 31 число вы обычно тратите около €230. Если так и будет, лимит будет превышен примерно на €65.')).toBeInTheDocument();
        });

        it('does not call a sub-euro excess an excess', () => {
            render(<PaceCard typicalMonth={monthInProgress({ forecast: 365.4 })} selectedMonth="2026-10" monthlyLimit={365} />);

            expect(screen.getByText(/запас до лимита ≈ €0\.$/)).toBeInTheDocument();
            expect(screen.queryByText(/превышен/)).not.toBeInTheDocument();
        });

        it('says only what is usually spent when the limit is not usable', () => {
            render(<PaceCard typicalMonth={monthInProgress()} selectedMonth="2026-10" monthlyLimit={0} />);

            expect(screen.getByText('С 9 по 31 число вы обычно тратите около €230.')).toBeInTheDocument();
            expect(screen.queryByText(/лимит/i)).not.toBeInTheDocument();
        });

        it('skips the «С … по …» sentence on the last day', () => {
            const lastDay = monthInProgress({ day: 31, typicalToDate: 400, typicalRemaining: 0, spent: 380, forecast: 380 });
            render(<PaceCard typicalMonth={lastDay} selectedMonth="2026-10" monthlyLimit={7000} />);

            expect(screen.queryByText(/^С \d+ по/)).not.toBeInTheDocument();
            expect(screen.getByText('Запас до лимита ≈ €6.620.')).toBeInTheDocument();
            expect(screen.getByText('≈ €380')).toBeInTheDocument();
        });

        it('has nothing to explain on the last day without a limit', () => {
            const lastDay = monthInProgress({ day: 31, typicalToDate: 400, typicalRemaining: 0, spent: 380, forecast: 380 });
            render(<PaceCard typicalMonth={lastDay} selectedMonth="2026-10" monthlyLimit={null} />);

            expect(screen.getByText('≈ €380')).toBeInTheDocument();
            expect(screen.queryByText(/запас|лимит/i)).not.toBeInTheDocument();
        });
    });

    describe('caption', () => {
        it('names the reference months within one year', () => {
            render(<PaceCard typicalMonth={monthInProgress()} selectedMonth="2026-10" monthlyLimit={7000} />);

            expect(screen.getByText('«Обычно» — медиана по 6 прошлым месяцам, апрель — сентябрь 2026')).toBeInTheDocument();
        });

        it('adds the year to both ends when the months span two years', () => {
            const spanning = monthInProgress({}, { months: ['2026-02', '2026-01', '2025-12', '2025-11'] });
            render(<PaceCard typicalMonth={spanning} selectedMonth="2026-03" monthlyLimit={7000} />);

            expect(screen.getByText('«Обычно» — медиана по 4 прошлым месяцам, ноябрь 2025 — февраль 2026')).toBeInTheDocument();
        });
    });
});
