import { describe, it, expect } from 'vitest';
import {
    AMOUNT_ERROR_TEXT,
    appendOperator,
    evaluateAmount,
    formatAmountForInput,
    hasOperator,
    limitAmountInput,
    sanitizeAmountInput,
} from './amountExpression';

describe('sanitizeAmountInput', () => {
    it('заменяет клавиатурные знаки на красивые', () => {
        expect(sanitizeAmountInput('100-30')).toBe('100−30');
        expect(sanitizeAmountInput('100–30')).toBe('100−30');
        expect(sanitizeAmountInput('2*3')).toBe('2×3');
        expect(sanitizeAmountInput('2x3')).toBe('2×3');
        expect(sanitizeAmountInput('2X3')).toBe('2×3');
        expect(sanitizeAmountInput('2х3')).toBe('2×3'); // кириллическая «х»
        expect(sanitizeAmountInput('6/3')).toBe('6÷3');
        expect(sanitizeAmountInput('6:3')).toBe('6÷3');
    });

    it('схлопывает несколько знаков подряд в последний', () => {
        expect(sanitizeAmountInput('100+-30')).toBe('100−30');
        expect(sanitizeAmountInput('100+−×÷30')).toBe('100÷30');
    });

    it('убирает знак в начале строки', () => {
        expect(sanitizeAmountInput('-5')).toBe('5');
        expect(sanitizeAmountInput('+×5')).toBe('5');
        expect(sanitizeAmountInput('−')).toBe('');
    });

    it('выбрасывает всё лишнее, оставляя цифры и разделители', () => {
        expect(sanitizeAmountInput('€1 2a,5 ')).toBe('12,5');
        expect(sanitizeAmountInput('abc')).toBe('');
    });

    it('меняет точку на запятую', () => {
        expect(sanitizeAmountInput('1.5')).toBe('1,5');
        expect(sanitizeAmountInput('1.5+2.25')).toBe('1,5+2,25');
    });

    it('убирает нули в начале числа', () => {
        expect(sanitizeAmountInput('05')).toBe('5');
        expect(sanitizeAmountInput('007')).toBe('7');
        expect(sanitizeAmountInput('00')).toBe('0');
        expect(sanitizeAmountInput('0')).toBe('0');
        expect(sanitizeAmountInput('00,5')).toBe('0,5');
        expect(sanitizeAmountInput('100')).toBe('100');
        expect(sanitizeAmountInput('10,05')).toBe('10,05');
        expect(sanitizeAmountInput('5+05×007')).toBe('5+5×7');
    });

    it('дописывает ноль перед разделителем без целой части', () => {
        expect(sanitizeAmountInput(',')).toBe('0,');
        expect(sanitizeAmountInput(',5')).toBe('0,5');
        expect(sanitizeAmountInput('5+,5')).toBe('5+0,5');
    });

    it('принимает число и пустое значение', () => {
        expect(sanitizeAmountInput(50.5)).toBe('50,5');
        expect(sanitizeAmountInput(null)).toBe('');
        expect(sanitizeAmountInput(undefined)).toBe('');
    });
});

describe('limitAmountInput', () => {
    it('пропускает обычный набор', () => {
        expect(limitAmountInput('2', '')).toBe('2');
        expect(limitAmountInput('21,', '21')).toBe('21,');
        expect(limitAmountInput('21,79', '21,7')).toBe('21,79');
        expect(limitAmountInput('100-30', '100−3')).toBe('100−30');
    });

    it('не даёт поставить второй разделитель в число', () => {
        expect(limitAmountInput('21,79,', '21,79')).toBe('21,79');
        expect(limitAmountInput('21,,', '21,')).toBe('21,');
        expect(limitAmountInput('21,7.', '21,7')).toBe('21,7');
        // запятая в середине набранного числа
        expect(limitAmountInput('2,1,79', '21,79')).toBe('21,79');
    });

    it('не даёт третью цифру после разделителя', () => {
        expect(limitAmountInput('21,799', '21,79')).toBe('21,79');
        expect(limitAmountInput('21,179', '21,79')).toBe('21,79');
    });

    it('разрешает разделитель в каждом числе выражения', () => {
        expect(limitAmountInput('12,5×3,', '12,5×3')).toBe('12,5×3,');
        expect(limitAmountInput('12,5×3,25', '12,5×3,2')).toBe('12,5×3,25');
        expect(limitAmountInput('12,5×3,2,', '12,5×3,2')).toBe('12,5×3,2');
        expect(limitAmountInput('12,5×3,255', '12,5×3,25')).toBe('12,5×3,25');
    });

    it('приводит ввод к виду, как sanitizeAmountInput', () => {
        expect(limitAmountInput('05', '0')).toBe('5');
        expect(limitAmountInput(',', '')).toBe('0,');
        expect(limitAmountInput('100+-', '100+')).toBe('100−');
    });

    it('стирание всегда проходит', () => {
        expect(limitAmountInput('21,7', '21,79')).toBe('21,7');
        expect(limitAmountInput('', '5')).toBe('');
    });

    it('принимает прежнее значение числом, как приходит при правке операции', () => {
        expect(limitAmountInput('50.55', 50.5)).toBe('50,55');
        expect(limitAmountInput('50.555', 50.55)).toBe('50.55');
    });

    it('не держится за прежнее значение, если оно само негодное', () => {
        expect(limitAmountInput('1,2,3,', '1,2,3')).toBe('1,2,3,');
    });
});

describe('hasOperator', () => {
    it('находит любой из четырёх знаков', () => {
        for (const op of ['+', '−', '×', '÷']) expect(hasOperator(`5${op}2`)).toBe(true);
        expect(hasOperator('12,5')).toBe(false);
        expect(hasOperator('')).toBe(false);
    });
});

describe('evaluateAmount', () => {
    it('соблюдает приоритет умножения и деления', () => {
        expect(evaluateAmount('100−30×2')).toEqual({ value: 40, isExpression: true, error: null });
        expect(evaluateAmount('90÷3+5').value).toBe(35);
        expect(evaluateAmount('2+3×4−6÷2').value).toBe(11);
    });

    it('считает слева направо внутри одного приоритета', () => {
        expect(evaluateAmount('100−30+5').value).toBe(75);
        expect(evaluateAmount('100÷5×2').value).toBe(40);
    });

    it('понимает дроби с запятой и точкой', () => {
        expect(evaluateAmount('12,5×3').value).toBe(37.5);
        expect(evaluateAmount('12.5×3').value).toBe(37.5);
        expect(evaluateAmount('0,1+0,2').value).toBe(0.3);
    });

    it('простое число - не выражение', () => {
        expect(evaluateAmount('50,5')).toEqual({ value: 50.5, isExpression: false, error: null });
        expect(evaluateAmount('12,')).toEqual({ value: 12, isExpression: false, error: null });
        expect(evaluateAmount(50.5)).toEqual({ value: 50.5, isExpression: false, error: null });
    });

    it('пустое и непарсящееся даёт null без ошибки', () => {
        expect(evaluateAmount('')).toEqual({ value: null, isExpression: false, error: null });
        expect(evaluateAmount(',')).toEqual({ value: null, isExpression: false, error: null });
        expect(evaluateAmount(undefined).value).toBeNull();
    });

    it('игнорирует оператор в конце строки', () => {
        expect(evaluateAmount('100−')).toEqual({ value: 100, isExpression: false, error: null });
        expect(evaluateAmount('100−30+')).toEqual({ value: 70, isExpression: true, error: null });
        expect(evaluateAmount('100−,').value).toBe(100);
    });

    it('простое число ноль не считается ошибкой', () => {
        expect(evaluateAmount('0')).toEqual({ value: 0, isExpression: false, error: null });
    });

    it('делит на ноль с ошибкой', () => {
        expect(evaluateAmount('10÷0')).toEqual({ value: null, isExpression: true, error: 'divideByZero' });
        expect(evaluateAmount('10÷0,0+5').error).toBe('divideByZero');
    });

    it('итог не больше нуля - ошибка, но число остаётся', () => {
        expect(evaluateAmount('10−20')).toEqual({ value: -10, isExpression: true, error: 'notPositive' });
        expect(evaluateAmount('10−10')).toEqual({ value: 0, isExpression: true, error: 'notPositive' });
    });

    it('два разделителя в числе - ошибка разбора', () => {
        expect(evaluateAmount('1,2,3')).toEqual({ value: null, isExpression: false, error: 'invalid' });
        expect(evaluateAmount('1.2.3').error).toBe('invalid');
        expect(evaluateAmount('1,2.3').error).toBe('invalid');
        expect(evaluateAmount('5+1,2,3').error).toBe('invalid');
    });

    it('округляет до центов', () => {
        expect(evaluateAmount('10÷3').value).toBe(3.33);
        expect(evaluateAmount('20÷3').value).toBe(6.67);
        expect(evaluateAmount('1,005').value).toBe(1.01);
    });
});

describe('appendOperator', () => {
    it('дописывает знак к числу', () => {
        expect(appendOperator('100', '−')).toBe('100−');
    });

    it('в пустой строке ничего не делает', () => {
        expect(appendOperator('', '+')).toBe('');
    });

    it('заменяет знак в конце', () => {
        expect(appendOperator('100−', '+')).toBe('100+');
    });

    it('убирает висящий разделитель', () => {
        expect(appendOperator('100,', '×')).toBe('100×');
        expect(appendOperator('100.', '×')).toBe('100×');
    });

    it('не оставляет знак в пустой строке', () => {
        expect(appendOperator(',', '+')).toBe('');
    });
});

describe('formatAmountForInput', () => {
    it('даёт строку с десятичной запятой', () => {
        expect(formatAmountForInput(70)).toBe('70');
        expect(formatAmountForInput(12.5)).toBe('12,5');
        expect(formatAmountForInput(33.33)).toBe('33,33');
    });

    it('округляет хвост float', () => {
        expect(formatAmountForInput(0.1 + 0.2)).toBe('0,3');
    });
});

describe('AMOUNT_ERROR_TEXT', () => {
    it('есть текст для каждой ошибки', () => {
        expect(Object.keys(AMOUNT_ERROR_TEXT).sort()).toEqual(['divideByZero', 'invalid', 'notPositive']);
    });
});
