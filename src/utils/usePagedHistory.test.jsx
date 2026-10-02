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
    expect(result.current.transactions['2026-09-24'].items).toEqual([{ id: 'second' }, { id: 'first' }]);
    expect(result.current.transactions['2026-09-24'].dailySum).toBe(-100);
  });

  it('replaces duplicate rows and daily totals without double-counting', () => {
    expect(mergeHistoryPages(page('same'), page('same')).transactions['2026-09-24']).toEqual({ items: [{ id: 'same' }], dailySum: -100 });
  });

  it('prepends newer pages, retains the older cursor and retries in the failed direction', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(response({ ...page('middle', 'older'), previousCursor: 'newer' }))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(response({ ...page('newest', 'middle'), previousCursor: null }));
    const { result } = renderHook(() => usePagedHistory({ url: '/api/history?continuous=1', enabled: true, request, revision: 0, searching: false }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.loadNewer());
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.direction).toBe('newer');
    expect(result.current.previousCursor).toBe('newer');
    act(() => result.current.loadNewer());
    await waitFor(() => expect(result.current.previousCursor).toBeNull());
    expect(result.current.nextCursor).toBe('older');
    expect(result.current.transactions['2026-09-24'].items).toEqual([{ id: 'newest' }, { id: 'middle' }]);
    expect(request.mock.calls[2][0]).toContain('cursor=newer&direction=newer');
  });
});
