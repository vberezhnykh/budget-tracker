// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { extractNumbers, readNumbers } from './numbersInText.js';

describe('extractNumbers', () => {
    it('читает суммы в евро с запятой и точкой', () => {
        expect(extractNumbers('€1 234,50')).toEqual([1234.5, 1, 234.5]);
        expect(extractNumbers('1234.5 €')).toEqual([1234.5]);
        expect(extractNumbers('€412')).toEqual([412]);
        expect(extractNumbers('1.234,50')).toEqual([1234.5]);
    });

    it('тысячи через NBSP, узкий NBSP и тонкий пробел - одно число', () => {
        expect(extractNumbers('€1 234')).toEqual([1234]);
        expect(extractNumbers('€1 234,50')).toEqual([1234.5]);
        expect(extractNumbers('€12 345')).toEqual([12345]);
        expect(extractNumbers('1 234 567')).toEqual([1234567]);
    });

    it('точка как разделитель тысяч: «€7.000» - это 7000, а не 7', () => {
        expect(extractNumbers('€7.000')).toEqual([7000]);
        expect(extractNumbers('€1.210 при обычных €1.000.')).toEqual([1210, 1000]);
        expect(extractNumbers('1.234.567')).toEqual([1234567]);
        expect(extractNumbers('€1.234,50')).toEqual([1234.5]);
        expect(extractNumbers('€7.000, а не €500')).toEqual([7000, 500]);
    });

    it('точка не из групп по три цифры остаётся десятичной', () => {
        expect(extractNumbers('12.5')).toEqual([12.5]);
        expect(extractNumbers('€3.75')).toEqual([3.75]);
        expect(extractNumbers('1234.567')).toEqual([1234.567]);
        expect(extractNumbers('0.5')).toEqual([0.5]);
    });

    it('даты с точкой не склеиваются в большие числа', () => {
        expect(extractNumbers('01.09.2026')).toEqual([1.09, 2026]);
    });

    it('обычные пробелы между группами читаются и целым, и отдельными числами', () => {
        expect(extractNumbers('412 1 234')).toEqual([412, 1234, 1, 234]);
    });

    it('проценты и десятичная запятая', () => {
        expect(extractNumbers('выросло на 12,5%')).toEqual([12.5]);
        expect(extractNumbers('на 18% больше')).toEqual([18]);
    });

    it('минус не читается: число идёт по модулю', () => {
        expect(extractNumbers('-€210 и −45')).toEqual([210, 45]);
    });

    it('даты дают год, месяц и день отдельными числами', () => {
        expect(extractNumbers('3 октября 2026')).toEqual([3, 2026]);
        expect(extractNumbers('2026-09-01')).toEqual([2026, 9, 1]);
    });

    it('без чисел и на нестроке - пусто', () => {
        expect(extractNumbers('ничего нет')).toEqual([]);
        expect(extractNumbers(undefined)).toEqual([]);
        expect(extractNumbers(null)).toEqual([]);
    });
});

describe('readNumbers', () => {
    it('parts есть только у групп, разделённых обычными пробелами', () => {
        expect(readNumbers('€1 234 и €5 678')).toEqual([
            { value: 1234, parts: [1, 234] },
            { value: 5678, parts: null }
        ]);
    });

    it('одна группа «1.210» без запятой имеет десятичное прочтение alt', () => {
        expect(readNumbers('€1.210')).toEqual([{ value: 1210, parts: null, alt: 1.21 }]);
        expect(readNumbers('7.000')).toEqual([{ value: 7000, parts: null, alt: 7 }]);
    });

    it('alt нет у однозначных чисел', () => {
        expect(readNumbers('1.234.567')).toEqual([{ value: 1234567, parts: null }]);
        expect(readNumbers('1.234,50')).toEqual([{ value: 1234.5, parts: null }]);
        expect(readNumbers('12.5 и 3.75')).toEqual([{ value: 12.5, parts: null }, { value: 3.75, parts: null }]);
        expect(readNumbers('€1 210')).toEqual([{ value: 1210, parts: [1, 210] }]);
    });
});
