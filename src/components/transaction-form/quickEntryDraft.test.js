import { describe, expect, it } from 'vitest';
import { applyQuickEntryDraft } from './quickEntryDraft';

const accounts = [
    { _id: 'card', name: 'Карта', type: 'card' },
    { _id: 'cash', name: 'Наличные', type: 'cash' },
    { _id: 'wallet', name: 'Кошелёк', type: 'cash' },
];

const blank = {
    amount: '', category: '', description: '', companyName: '', logoMode: 'category',
    date: '2026-10-12', type: 'expense', account: '', toAccount: 'card', excludeFromStats: false,
};

describe('applyQuickEntryDraft', () => {
    it('fills only what the draft determined and keeps the rest', () => {
        const prev = { ...blank, account: 'cash', description: 'старое', date: '2026-10-01' };
        const next = applyQuickEntryDraft(prev, { type: 'expense', amount: 3.5 }, accounts);
        expect(next).toEqual({ ...prev, amount: '3,5' });
    });

    it('fills a complete expense', () => {
        const next = applyQuickEntryDraft(blank, {
            type: 'expense', amount: 12, category: 'Кафе', account: 'card', date: '2026-10-11', description: 'латте',
            companyId: 'co-1', companyName: 'Starbucks', logoMode: 'domain', merchantDomain: 'starbucks.com',
        }, accounts);
        expect(next).toMatchObject({
            type: 'expense', amount: '12', category: 'Кафе', account: 'card', date: '2026-10-11', description: 'латте',
            companyId: 'co-1', companyName: 'Starbucks', logoMode: 'domain', merchantDomain: 'starbucks.com',
        });
    });

    it('resets the merchant domain when a new company has none', () => {
        const prev = { ...blank, companyId: 'old', companyName: 'Old', logoMode: 'domain', merchantDomain: 'old.com' };
        const next = applyQuickEntryDraft(prev, { type: 'expense', companyId: '', companyName: 'Новая', logoMode: 'auto' }, accounts);
        expect(next).toMatchObject({ companyId: '', companyName: 'Новая', logoMode: 'auto', merchantDomain: '' });
    });

    it('ignores an account that no longer exists', () => {
        const next = applyQuickEntryDraft({ ...blank, account: 'cash' }, { type: 'expense', account: 'gone', amount: 1 }, accounts);
        expect(next.account).toBe('cash');
    });

    it('switches to income, drops the expense category and leaves company fields alone', () => {
        const prev = { ...blank, category: 'Кафе', companyName: 'Starbucks', companyId: 'co-1' };
        const next = applyQuickEntryDraft(prev, { type: 'income', amount: 1000, companyName: 'Игнор', companyId: '', logoMode: 'auto' }, accounts);
        expect(next).toMatchObject({ type: 'income', amount: '1000', category: '', companyName: 'Starbucks', companyId: 'co-1' });
        expect(applyQuickEntryDraft(prev, { type: 'income', category: 'Зарплата' }, accounts).category).toBe('Зарплата');
    });

    it('keeps the category when the type does not change', () => {
        expect(applyQuickEntryDraft({ ...blank, category: 'Кафе' }, { type: 'expense', amount: 5 }, accounts).category).toBe('Кафе');
    });

    it('fills a transfer with distinct accounts', () => {
        const next = applyQuickEntryDraft(blank, { type: 'transfer', amount: 50, account: 'cash', toAccount: 'card' }, accounts);
        expect(next).toMatchObject({ type: 'transfer', amount: '50', account: 'cash', toAccount: 'card' });
    });

    it('falls back to the default source and a different destination for a transfer', () => {
        // счёт не назван: откуда - наличные по умолчанию, куда - прежний, если он другой
        expect(applyQuickEntryDraft(blank, { type: 'transfer', amount: 5 }, accounts)).toMatchObject({ account: 'cash', toAccount: 'card' });
        // прежний "куда" совпал с новым "откуда": берётся первый другой счёт
        expect(applyQuickEntryDraft(blank, { type: 'transfer', account: 'card' }, accounts)).toMatchObject({ account: 'card', toAccount: 'cash' });
        // назван только "куда"
        expect(applyQuickEntryDraft({ ...blank, account: 'card', toAccount: 'cash' }, { type: 'transfer', toAccount: 'wallet' }, accounts))
            .toMatchObject({ account: 'card', toAccount: 'wallet' });
        // "куда" совпало с "откуда" из черновика
        const same = applyQuickEntryDraft(blank, { type: 'transfer', account: 'cash', toAccount: 'cash' }, accounts);
        expect(same.account).not.toBe(same.toAccount);
    });

    it('does not switch to a transfer with fewer than two accounts', () => {
        const next = applyQuickEntryDraft(blank, { type: 'transfer', amount: 5, account: 'cash' }, [accounts[1]]);
        expect(next).toMatchObject({ type: 'expense', amount: '5', account: 'cash' });
    });

    it('returns from a transfer to an expense without touching the destination', () => {
        const prev = { ...blank, type: 'transfer', account: 'cash', toAccount: 'card' };
        const next = applyQuickEntryDraft(prev, { type: 'expense', amount: 7, category: 'Кафе' }, accounts);
        expect(next).toMatchObject({ type: 'expense', account: 'cash', category: 'Кафе', amount: '7' });
    });

    it('does not mutate the previous data', () => {
        const prev = Object.freeze({ ...blank });
        expect(() => applyQuickEntryDraft(prev, { type: 'expense', amount: 1 }, accounts)).not.toThrow();
    });
});
