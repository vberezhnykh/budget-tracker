import { describe, it, expect } from 'vitest';
import { getPreviousMonth, isMonthInHistory, monthLocative, monthNominative } from './monthNames';

describe('monthNames', () => {
    it('gives the lowercase nominative', () => {
        expect(monthNominative('2026-10')).toBe('октябрь');
    });

    it('declines every month into the prepositional case', () => {
        const expected = [
            'в январе', 'в феврале', 'в марте', 'в апреле', 'в мае', 'в июне',
            'в июле', 'в августе', 'в сентябре', 'в октябре', 'в ноябре', 'в декабре',
        ];
        const actual = Array.from({ length: 12 }, (_, i) => monthLocative(`2026-${String(i + 1).padStart(2, '0')}`));
        expect(actual).toEqual(expected);
    });

    it('steps back one month, across the year boundary too', () => {
        expect(getPreviousMonth('2026-11')).toBe('2026-10');
        expect(getPreviousMonth('2026-01')).toBe('2025-12');
    });

    it('knows where the history starts', () => {
        expect(isMonthInHistory('2025-11')).toBe(true);
        expect(isMonthInHistory('2025-10')).toBe(false);
    });
});
