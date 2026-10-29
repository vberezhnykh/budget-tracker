import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import BalanceTrend from './BalanceTrend';
import IncomeExpenseChart from './IncomeExpenseChart';

// «Сейчас» зафиксировано: подпись идущего месяца зависит от часов.
beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 0, 15, 12));
});

afterEach(() => {
    vi.useRealTimers();
});

const month = (key, label, fields) => ({ month: key, label, year: Number(key.slice(0, 4)), income: 0, expense: 0, balance: null, ...fields });

describe('BalanceTrend', () => {
    const series = [
        month('2025-11', 'нояб', { balance: null }),
        month('2025-12', 'дек', { balance: 1200 }),
        month('2026-01', 'янв', { balance: 950.5 }),
    ];

    it('показывает остаток выбранного месяца и изменение к предыдущему', () => {
        render(<BalanceTrend series={series} selectedMonth="2026-01" onSelectMonth={() => {}} />);
        expect(screen.getByRole('heading', { name: 'Деньги в наличии' })).toBeInTheDocument();
        expect(screen.getByText('€950,50')).toBeInTheDocument();
        expect(screen.getByText(/^сейчас/)).toHaveTextContent('сейчас · −€249,50 за месяц');
    });

    it('у закрытого месяца - остаток на его конец, у первого месяца изменения нет', () => {
        render(<BalanceTrend series={series} selectedMonth="2025-12" onSelectMonth={() => {}} />);
        expect(screen.getByText(/^на конец/)).toHaveTextContent(/^на конец декабря 2025$/);
    });

    it('месяц до первой операции подписан, точки в нём нет', () => {
        render(<BalanceTrend series={series} selectedMonth="2025-11" onSelectMonth={() => {}} title="Остаток счёта" />);
        expect(screen.getByRole('heading', { name: 'Остаток счёта' })).toBeInTheDocument();
        expect(screen.getByText('В ноябре операций по счёту ещё не было')).toBeInTheDocument();
        expect(screen.queryByTestId('balance-trend-dot')).toBeNull();
    });

    it('линия нуля - только когда остаток уходил в минус', () => {
        const { rerender } = render(<BalanceTrend series={series} selectedMonth="2026-01" onSelectMonth={() => {}} />);
        expect(screen.queryByTestId('balance-trend-zero')).toBeNull();
        rerender(<BalanceTrend series={[...series.slice(0, 2), month('2026-01', 'янв', { balance: -300 })]} selectedMonth="2026-01" onSelectMonth={() => {}} />);
        expect(screen.getByTestId('balance-trend-zero')).toBeInTheDocument();
    });

    it('без остатков графика нет', () => {
        const { container } = render(<BalanceTrend series={[series[0]]} selectedMonth="2025-11" onSelectMonth={() => {}} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('нажатие выбирает месяц', () => {
        const onSelectMonth = vi.fn();
        render(<BalanceTrend series={series} selectedMonth="2026-01" onSelectMonth={onSelectMonth} />);
        fireEvent.click(screen.getByRole('button', { name: 'Декабрь 2025: остаток €1.200,00' }));
        expect(onSelectMonth).toHaveBeenCalledWith('2025-12');
    });
});

describe('IncomeExpenseChart', () => {
    const series = [
        month('2025-12', 'дек', { income: 3000, expense: 1500 }),
        month('2026-01', 'янв', { income: 1000, expense: 1250.4 }),
    ];

    it('цифры выбранного месяца и пары столбцов на общей шкале', () => {
        render(<IncomeExpenseChart series={series} selectedMonth="2026-01" onSelectMonth={() => {}} />);
        expect(screen.getByText('Январь 2026')).toBeInTheDocument();
        expect(screen.getByText('+€1.000')).toBeInTheDocument();
        expect(screen.getByText('−€1.250')).toBeInTheDocument();
        expect(screen.getByText('Сальдо')).toBeInTheDocument();
        expect(screen.queryByText('Разница')).not.toBeInTheDocument();
        expect(screen.getByText('−€250')).toBeInTheDocument();
        const december = screen.getByRole('button', { name: 'Декабрь 2025: доход €3.000,00, расход €1.500,00' });
        // Самый высокий столбец ряда - доход декабря, он и задаёт шкалу.
        const heightOf = testId => parseFloat(december.querySelector(`[data-testid="${testId}"]`).style.height);
        expect(heightOf('income-bar')).toBeCloseTo(100 / 1.1, 6);
        expect(heightOf('expense-bar')).toBeCloseTo(50 / 1.1, 6);
    });

    it('без месяцев графика нет', () => {
        const { container } = render(<IncomeExpenseChart series={[]} selectedMonth="2026-01" onSelectMonth={() => {}} />);
        expect(container).toBeEmptyDOMElement();
    });
});
