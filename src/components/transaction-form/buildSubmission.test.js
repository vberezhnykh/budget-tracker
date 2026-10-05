import { describe, it, expect } from 'vitest';
import { buildSubmission } from './buildSubmission';

const now = () => 1000;
const random = () => 0.5;

const base = {
    amount: '12.5',
    category: 'Продукты',
    description: '  молоко ',
    date: '2026-10-05',
    type: 'expense',
    account: 'card',
    toAccount: 'cash',
    companyName: 'Lidl',
    companyId: 'c1',
    logoMode: 'domain',
    merchantDomain: 'lidl.com',
    excludeFromStats: false,
};

describe('buildSubmission', () => {
    it('keeps company and logo fields on a plain expense', () => {
        const result = buildSubmission({ formData: base, now });
        expect(result).toMatchObject({
            amount: 12.5, category: 'Продукты', id: 1000, companyName: 'Lidl', companyId: 'c1', logoMode: 'domain', merchantDomain: 'lidl.com',
        });
        expect(result).not.toHaveProperty('toAccount');
    });

    it('uses savedForm (with the saved company) instead of formData for a plain expense', () => {
        const result = buildSubmission({ formData: base, savedForm: { ...base, companyId: 'saved' }, now });
        expect(result.companyId).toBe('saved');
    });

    it('strips company and logo fields from income', () => {
        const income = { ...base, type: 'income', category: 'Зарплата' };
        const result = buildSubmission({ formData: income, now });
        expect(result.category).toBe('Зарплата');
        for (const key of ['companyName', 'companyId', 'logoMode', 'merchantDomain', 'toAccount']) {
            expect(result).not.toHaveProperty(key);
        }
    });

    it('turns a transfer into category «Перевод» and keeps toAccount', () => {
        const transfer = { ...base, type: 'transfer', category: '' };
        const result = buildSubmission({ formData: transfer, now });
        expect(result.category).toBe('Перевод');
        expect(result.toAccount).toBe('cash');
        expect(result).not.toHaveProperty('companyName');
    });

    it('keeps the id of the edited transaction', () => {
        const result = buildSubmission({ formData: base, initialData: { id: 'existing' }, now });
        expect(result.id).toBe('existing');
    });

    describe('split', () => {
        const splits = [
            { id: 1, amount: '4', category: 'Продукты' },
            { id: 2, amount: '8.5', category: 'Транспорт' },
        ];

        it('returns one transaction per part with a shared splitId', () => {
            const result = buildSubmission({ formData: base, splits, isSplit: true, now, random });
            expect(result).toHaveLength(2);
            expect(result.map(r => r.splitId)).toEqual(['split_1000', 'split_1000']);
            expect(result.map(r => r.id)).toEqual([1000.5, 1000.5]);
        });

        it('takes amount, category and title from each part and the rest from the form', () => {
            const [first, second] = buildSubmission({ formData: base, splits, isSplit: true, now, random });
            expect(first).toMatchObject({ amount: 4, category: 'Продукты', title: 'Продукты', description: 'молоко', date: '2026-10-05', type: 'expense', account: 'card' });
            expect(second).toMatchObject({ amount: 8.5, category: 'Транспорт', title: 'Транспорт' });
        });

        it('carries logo and company fields on expense parts', () => {
            const [first] = buildSubmission({ formData: base, splits, isSplit: true, now, random });
            expect(first).toMatchObject({ logoMode: 'domain', merchantDomain: 'lidl.com', companyName: 'Lidl', companyId: 'c1' });
        });

        it('falls back to auto logo mode and omits company when the form has none', () => {
            const bare = { ...base, logoMode: undefined, merchantDomain: undefined, companyName: undefined, companyId: undefined };
            const [first] = buildSubmission({ formData: bare, splits, isSplit: true, now, random });
            expect(first).toMatchObject({ logoMode: 'auto', merchantDomain: '' });
            expect(first).not.toHaveProperty('companyName');
        });

        it('has no logo or company fields on income parts', () => {
            const income = { ...base, type: 'income' };
            const [first] = buildSubmission({ formData: income, splits, isSplit: true, now, random });
            for (const key of ['logoMode', 'merchantDomain', 'companyName', 'companyId']) {
                expect(first).not.toHaveProperty(key);
            }
        });
    });
});
