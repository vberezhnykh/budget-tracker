import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import useSplits from './useSplits';

describe('useSplits.replace', () => {
    it('sets the parts with unique ids, amounts with two decimals and categories', () => {
        const { result } = renderHook(() => useSplits(40.5));
        act(() => result.current.replace([{ category: 'Продукты', amount: 32.4 }, { category: 'Дом', amount: 8.1 }, { category: 'Кафе', amount: 5 }]));

        const { splits } = result.current;
        expect(splits.map(({ amount, category }) => ({ amount, category }))).toEqual([
            { amount: '32.40', category: 'Продукты' },
            { amount: '8.10', category: 'Дом' },
            { amount: '5.00', category: 'Кафе' },
        ]);
        expect(new Set(splits.map(split => split.id)).size).toBe(3);
        expect(splits.every(split => split.id !== 1 && split.id !== 2)).toBe(true);
    });

    it('feeds the remainder and the completeness flags', () => {
        const { result } = renderHook(() => useSplits(40.5));
        expect(result.current.isComplete).toBe(false);
        act(() => result.current.replace([{ category: 'Продукты', amount: 32.4 }, { category: 'Дом', amount: 8.1 }]));
        expect(result.current.isBalanced).toBe(true);
        expect(result.current.isComplete).toBe(true);
        expect(result.current.remaining).toBeCloseTo(0, 5);
    });

    it('keeps ids unique across repeated replaces and later additions', () => {
        const { result } = renderHook(() => useSplits(10));
        act(() => result.current.replace([{ category: 'A', amount: 5 }, { category: 'B', amount: 5 }]));
        const first = result.current.splits.map(split => split.id);
        act(() => result.current.replace([{ category: 'A', amount: 5 }, { category: 'B', amount: 5 }]));
        const second = result.current.splits.map(split => split.id);
        expect(new Set([...first, ...second]).size).toBe(4);
        act(() => result.current.add());
        expect(new Set([...second, result.current.splits.at(-1).id]).size).toBe(3);
    });

    it('does not break editing a replaced part', () => {
        const { result } = renderHook(() => useSplits(10));
        act(() => result.current.replace([{ category: 'A', amount: 6 }, { category: 'B', amount: 4 }]));
        const [first] = result.current.splits;
        act(() => result.current.update(first.id, 'amount', '7'));
        expect(result.current.splits[0].amount).toBe('7');
        expect(result.current.splits[1].amount).toBe('4.00');
    });
});

describe('useSplits.restore', () => {
    it('brings back a snapshot taken earlier, ids included', () => {
        const { result } = renderHook(() => useSplits(10));
        const snapshot = result.current.splits;
        act(() => result.current.replace([{ category: 'A', amount: 6 }, { category: 'B', amount: 4 }]));
        expect(result.current.splits).not.toBe(snapshot);
        act(() => result.current.restore(snapshot));
        expect(result.current.splits).toBe(snapshot);
        expect(result.current.splits.map(split => split.id)).toEqual([1, 2]);
    });
});
