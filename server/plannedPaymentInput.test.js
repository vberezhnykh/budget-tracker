// @vitest-environment node

import { describe, expect, it } from 'vitest';
import input from './plannedPaymentInput.js';

const { normalizeCreate, normalizePatch, normalizePayBody, utcDay, versionOf } = input;

describe('planned payment input', () => {
    it('принимает только существующий календарный день и сохраняет UTC-полночь', () => {
        expect(utcDay('2028-02-29')?.toISOString()).toBe('2028-02-29T00:00:00.000Z');
        expect(utcDay('2027-02-29')).toBeNull();
        expect(utcDay('2026-4-09')).toBeNull();
        expect(utcDay(new Date('2026-04-09T00:00:00.000Z'))).toBeNull();
    });

    it('не приводит массивы, объекты и пустые строки к сумме', () => {
        for (const amount of [[10], { valueOf: () => 10 }, '', 0, -1]) {
            expect(normalizeCreate({
                title: 'Счёт', amount, dueDate: '2026-04-09', account: 'card', category: 'Жилье'
            }).error).toBeTruthy();
        }
    });

    it('нормализует новый план без возможности сразу выставить paid', () => {
        const normalized = normalizeCreate({
            title: '  Интернет  ', amount: '52.50', dueDate: '2026-04-09',
            account: ' card ', category: ' Жилье ', description: '  апрель  '
        });

        expect(normalized.payment).toMatchObject({
            title: 'Интернет', amount: 52.5, account: 'card', category: 'Жилье',
            description: 'апрель', status: 'pending'
        });
        expect(normalizeCreate({ ...normalized.payment, dueDate: '2026-04-09', status: 'paid' }).error)
            .toBeTruthy();
    });

    it('требует целую неотрицательную версию для patch и pay', () => {
        for (const __v of [undefined, -1, 1.5, '0']) {
            expect(versionOf({ __v }).error).toBeTruthy();
        }
        expect(versionOf({ __v: 0 })).toEqual({ version: 0 });
        expect(normalizePatch({ amount: 20 }, { amount: 10 }).error).toBeTruthy();
        expect(normalizePayBody({ transactionId: 'abc' }).error).toBeTruthy();
    });

    it('различает явное связывание и создание фактического расхода', () => {
        expect(normalizePayBody({ __v: 2, transactionId: 'id' })).toEqual({
            mode: 'link', transactionId: 'id', version: 2
        });
        expect(normalizePayBody({
            __v: 2, amount: 55, date: '2026-04-09', account: 'cash', category: 'Жилье'
        })).toMatchObject({
            mode: 'create', amount: 55, account: 'cash', category: 'Жилье', version: 2
        });
    });
});
