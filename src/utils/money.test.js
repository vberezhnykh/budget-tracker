import { describe, expect, it } from 'vitest';
import { formatMoney } from './money';

describe('formatMoney', () => {
    it('puts the euro sign before a de-DE number with two decimals', () => {
        expect(formatMoney(1846.2)).toBe('€1.846,20');
        expect(formatMoney(5)).toBe('€5,00');
        expect(formatMoney(0.5)).toBe('€0,50');
        expect(formatMoney(1234567.891)).toBe('€1.234.567,89');
    });

    it('prints the absolute value without a sign by default', () => {
        expect(formatMoney(-24.9)).toBe('€24,90');
        expect(formatMoney(-24.9, { sign: 'none' })).toBe('€24,90');
    });

    it('auto: plus for positive, real minus for negative, nothing for zero', () => {
        expect(formatMoney(3900, { sign: 'auto' })).toBe('+€3.900,00');
        expect(formatMoney(-24.9, { sign: 'auto' })).toBe('−€24,90');
        expect(formatMoney(0, { sign: 'auto' })).toBe('€0,00');
    });

    it('minus: always a minus before the euro, whatever the sign of the input, except zero', () => {
        expect(formatMoney(24.9, { sign: 'minus' })).toBe('−€24,90');
        expect(formatMoney(-24.9, { sign: 'minus' })).toBe('−€24,90');
        expect(formatMoney(0, { sign: 'minus' })).toBe('€0,00');
    });

    it('uses U+2212, not a hyphen-minus', () => {
        expect(formatMoney(-1, { sign: 'auto' }).charCodeAt(0)).toBe(0x2212);
    });

    it('drops the sign when the amount rounds to zero', () => {
        expect(formatMoney(-0.004, { sign: 'auto' })).toBe('€0,00');
        expect(formatMoney(0.004, { sign: 'minus' })).toBe('€0,00');
        expect(formatMoney(-0, { sign: 'auto' })).toBe('€0,00');
    });

    it('treats missing and non-finite values as zero', () => {
        expect(formatMoney(undefined)).toBe('€0,00');
        expect(formatMoney(NaN, { sign: 'auto' })).toBe('€0,00');
        expect(formatMoney('12.5')).toBe('€12,50');
    });
});
