import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useMonthReview from './useMonthReview';

const review = { headline: 'Сентябрь: на €210 больше обычного', points: [{ text: 'Отпуск €1 200.', category: 'Отпуск' }, { text: 'Прочее.', category: null }] };
const ok = (body) => ({ ok: true, json: async () => body });

const base = {
    enabled: true,
    today: '2026-10-05',
    timeRange: 'month',
    selectedMonth: '2026-10',
    selectedAccount: null,
    active: true,
};

describe('useMonthReview', () => {
    beforeEach(() => window.localStorage.clear());
    afterEach(() => {
        vi.restoreAllMocks();
        window.localStorage.clear();
    });

    it('posts the reviewed month and today once, then returns the review', async () => {
        const request = vi.fn(async () => ok({ month: '2026-09', review }));
        const { result, rerender } = renderHook((props) => useMonthReview(props), { initialProps: { ...base, request } });

        expect(result.current.review).toBeNull();
        await waitFor(() => expect(result.current.review).toEqual(review));
        expect(result.current.month).toBe('2026-09');
        expect(request).toHaveBeenCalledTimes(1);
        const [url, options] = request.mock.calls[0];
        expect(url).toBe('/api/month-review');
        expect(options.method).toBe('POST');
        expect(JSON.parse(options.body)).toEqual({ month: '2026-09', today: '2026-10-05' });

        // другая вкладка и обратно: ни повторного запроса, ни потери разбора
        rerender({ ...base, request, active: false });
        expect(result.current.review).toEqual(review);
        rerender({ ...base, request, active: true });
        expect(request).toHaveBeenCalledTimes(1);
        expect(result.current.review).toEqual(review);
    });

    it('does not ask while the card is not wanted, and asks once it is', async () => {
        const request = vi.fn(async () => ok({ review }));
        const { result, rerender } = renderHook((props) => useMonthReview(props), { initialProps: { ...base, request, selectedAccount: 'acc-1' } });
        expect(request).not.toHaveBeenCalled();

        rerender({ ...base, request, selectedAccount: null });
        await waitFor(() => expect(result.current.review).toEqual(review));
        expect(request).toHaveBeenCalledTimes(1);
    });

    it('does not ask when disabled, off the Overview tab, or after day 10', () => {
        const request = vi.fn(async () => ok({ review }));
        renderHook(() => useMonthReview({ ...base, request, enabled: false }));
        renderHook(() => useMonthReview({ ...base, request, active: false }));
        renderHook(() => useMonthReview({ ...base, request, today: '2026-10-11' }));
        expect(request).not.toHaveBeenCalled();
    });

    it('shows nothing for review null, an error status, a network failure or a malformed body, and does not retry', async () => {
        const cases = [
            async () => ok({ month: '2026-09', review: null, reason: 'not_enough_history' }),
            async () => ({ ok: false, status: 502, json: async () => ({ code: 'MONTH_REVIEW_FAILED' }) }),
            async () => { throw new TypeError('network'); },
            async () => ok({ review: { headline: 'x', points: [] } }),
            async () => ok({ review: { headline: 'x', points: 'text' } }),
        ];
        for (const impl of cases) {
            const request = vi.fn(impl);
            const { result, rerender } = renderHook((props) => useMonthReview(props), { initialProps: { ...base, request } });
            await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
            await act(async () => { await Promise.resolve(); });
            rerender({ ...base, request, active: false });
            rerender({ ...base, request, active: true });
            expect(result.current.review).toBeNull();
            expect(request).toHaveBeenCalledTimes(1);
        }
    });

    it('dismiss hides the card, remembers the reviewed month and survives unavailable storage', async () => {
        const request = vi.fn(async () => ok({ review }));
        const { result } = renderHook(() => useMonthReview({ ...base, request }));
        await waitFor(() => expect(result.current.review).toEqual(review));

        act(() => result.current.dismiss());
        expect(result.current.review).toBeNull();
        expect(window.localStorage.getItem('monthReview:dismissed:2026-09')).toBe('1');

        // новый сеанс на этом же устройстве: уже скрыто, запроса нет
        const second = vi.fn(async () => ok({ review }));
        const { result: again } = renderHook(() => useMonthReview({ ...base, request: second }));
        expect(again.current.review).toBeNull();
        expect(second).not.toHaveBeenCalled();
    });

    it('dismiss still hides the card for the session when storage throws', async () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
        const request = vi.fn(async () => ok({ review }));
        const { result } = renderHook(() => useMonthReview({ ...base, request }));
        await waitFor(() => expect(result.current.review).toEqual(review));

        act(() => result.current.dismiss());
        expect(result.current.review).toBeNull();
    });

    it('reset drops the review and ignores an answer that arrives after it', async () => {
        let resolve;
        const request = vi.fn(() => new Promise((r) => { resolve = r; }));
        const { result } = renderHook(() => useMonthReview({ ...base, request }));
        await waitFor(() => expect(request).toHaveBeenCalledTimes(1));

        act(() => result.current.reset());
        await act(async () => { resolve(ok({ review })); });
        expect(result.current.review).toBeNull();
    });
});
