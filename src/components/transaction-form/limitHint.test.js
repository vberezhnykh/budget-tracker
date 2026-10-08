import { describe, expect, it } from 'vitest';
import { getLimitHint } from './limitHint';

const base = {
    type: 'expense',
    date: '2026-10-08',
    today: '2026-10-08',
    monthlyLimit: 2000,
    monthExpense: 1500,
    amount: '',
};

describe('getLimitHint', () => {
    it('shows what is left of the limit when the amount is empty', () => {
        expect(getLimitHint(base)).toEqual({ exceeded: false, text: 'После него можно потратить €500,00' });
    });

    it('subtracts the typed amount from the remainder', () => {
        expect(getLimitHint({ ...base, amount: '24.9' }))
            .toEqual({ exceeded: false, text: 'После него можно потратить €475,10' });
    });

    it('is not an overrun when the amount exactly uses up the limit', () => {
        expect(getLimitHint({ ...base, amount: '500' }))
            .toEqual({ exceeded: false, text: 'После него можно потратить €0,00' });
    });

    it('warns about the overrun with the exceeding sum', () => {
        expect(getLimitHint({ ...base, amount: '620.5' }))
            .toEqual({ exceeded: true, text: 'Лимит будет превышен на €120,50' });
    });

    it('reports an overrun when the month is already over the limit', () => {
        expect(getLimitHint({ ...base, monthExpense: 2100 }))
            .toEqual({ exceeded: true, text: 'Лимит будет превышен на €100,00' });
    });

    it('treats an invalid or negative amount as zero', () => {
        for (const amount of ['', 'abc', '-5', undefined]) {
            expect(getLimitHint({ ...base, amount }).text).toBe('После него можно потратить €500,00');
        }
    });

    it('does not turn float dust into an overrun', () => {
        expect(getLimitHint({ ...base, monthlyLimit: 0.3, monthExpense: 0.1, amount: '0.2' }).exceeded).toBe(false);
    });

    it('hides for income, transfer, editing and excluded expenses', () => {
        expect(getLimitHint({ ...base, type: 'income' })).toBeNull();
        expect(getLimitHint({ ...base, type: 'transfer' })).toBeNull();
        expect(getLimitHint({ ...base, isEditing: true })).toBeNull();
        expect(getLimitHint({ ...base, excludeFromStats: true })).toBeNull();
    });

    it('hides when the date is outside the current month', () => {
        expect(getLimitHint({ ...base, date: '2026-09-30' })).toBeNull();
        expect(getLimitHint({ ...base, date: '2025-10-08' })).toBeNull();
        expect(getLimitHint({ ...base, date: '2026-10-01' })).not.toBeNull();
        expect(getLimitHint({ ...base, date: undefined })).toBeNull();
    });

    it('hides without a usable limit or a known month expense', () => {
        for (const monthlyLimit of [undefined, null, 0, -100, NaN, Infinity]) {
            expect(getLimitHint({ ...base, monthlyLimit })).toBeNull();
        }
        for (const monthExpense of [undefined, null, NaN, Infinity]) {
            expect(getLimitHint({ ...base, monthExpense })).toBeNull();
        }
    });

    it('treats a month with no spending (0) as known', () => {
        expect(getLimitHint({ ...base, monthExpense: 0 }).text).toBe('После него можно потратить €2.000,00');
    });
});
