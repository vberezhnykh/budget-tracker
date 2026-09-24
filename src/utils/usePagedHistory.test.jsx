import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import usePagedHistory, { mergeHistoryPages } from './usePagedHistory';

const page = (id, nextCursor = null) => ({ transactions: { '2026-09-24': { dailySum: -100, items: [{ id }] } }, count: 2, nextCursor });
const response = data => ({ ok: true, json: async () => data });

describe('history request lifecycle', () => {
  it('ignores an old response after changing filters and clears data when logged out', async () => {
    let finishOld;
    const request = vi.fn(url => url.includes('old') ? new Promise(resolve => { finishOld = resolve; }) : Promise.resolve(response(page('new'))));
    const { result, rerender } = renderHook(({ url, enabled }) => usePagedHistory({ url, enabled, request, revision: 0, searching: false }), { initialProps: { url: '/api/history?old', enabled: true } });
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    rerender({ url: '/api/history?new', enabled: true });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => finishOld(response(page('old'))));
    expect(result.current.transactions['2026-09-24'].items).toEqual([{ id: 'new' }]);
    rerender({ url: '/api/history?new', enabled: false });
    expect(result.current.transactions).toEqual({});
  });

  it('deduplicates concurrent load-more requests and allows retry of a failed page', async () => {
    let finish;
    const request = vi.fn().mockResolvedValueOnce(response(page('first', 'cursor')))
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValueOnce(response(page('second')));
    const { result } = renderHook(() => usePagedHistory({ url: '/api/history?limit=40', enabled: true, request, revision: 0, searching: false }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => { result.current.loadMore(); result.current.loadMore(); });
    expect(request).toHaveBeenCalledTimes(2);
    await act(async () => finish({ ok: false, json: async () => ({}) }));
    expect(result.current.error).toBeTruthy();
    expect(result.current.transactions['2026-09-24'].items).toEqual([{ id: 'first' }]);
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.nextCursor).toBeNull());
    expect(result.current.transactions['2026-09-24'].items).toEqual([{ id: 'first' }, { id: 'second' }]);
    expect(result.current.transactions['2026-09-24'].dailySum).toBe(-100);
  });

  it('replaces duplicate rows and daily totals without double-counting', () => {
    expect(mergeHistoryPages(page('same'), page('same')).transactions['2026-09-24']).toEqual({ items: [{ id: 'same' }], dailySum: -100 });
  });
});
