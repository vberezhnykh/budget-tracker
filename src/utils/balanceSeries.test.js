import { describe, it, expect } from 'vitest';
import { withMonthEndBalances } from './balanceSeries';

const months = ['2025-12', '2026-01', '2026-02', '2026-03'].map(month => ({ month }));

describe('withMonthEndBalances', () => {
    it('месяц без операций берёт остаток предыдущего', () => {
        const series = withMonthEndBalances(months, { '2025-12': 100, '2026-02': 250.5 });
        expect(series.map(item => item.balance)).toEqual([100, 100, 250.5, 250.5]);
    });

    it('учитывает операции до начала ряда', () => {
        const series = withMonthEndBalances(months, { '2025-11': 40, '2026-03': 10 });
        expect(series.map(item => item.balance)).toEqual([40, 40, 40, 10]);
    });

    it('до первой операции остатка нет', () => {
        const series = withMonthEndBalances(months, { '2026-02': -20 });
        expect(series.map(item => item.balance)).toEqual([null, null, -20, -20]);
    });

    it('без данных - null во всех месяцах, остальные поля сохраняются', () => {
        const series = withMonthEndBalances([{ month: '2026-01', income: 5 }], undefined);
        expect(series).toEqual([{ month: '2026-01', income: 5, balance: null }]);
    });
});
