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

  describe('revision refresh', () => {
    const items = result => result.current.transactions['2026-09-24']?.items;

    it('keeps the previous rows while the first page is reloaded after a revision bump', async () => {
      let finish;
      const request = vi.fn().mockResolvedValueOnce(response(page('old')))
        .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
      const { result, rerender } = renderHook(({ revision }) => usePagedHistory({ url: '/api/history?continuous=1', enabled: true, request, revision, searching: false }), { initialProps: { revision: 0 } });
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.refreshing).toBe(false);
      rerender({ revision: 1 });
      expect(items(result)).toEqual([{ id: 'old' }]);
      expect(result.current.loading).toBe(true);
      expect(result.current.refreshing).toBe(true);
      await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
      expect(items(result)).toEqual([{ id: 'old' }]);
      expect(result.current.refreshing).toBe(true);
      await act(async () => finish(response(page('new'))));
      expect(items(result)).toEqual([{ id: 'new' }]);
      expect(result.current.loading).toBe(false);
      expect(result.current.refreshing).toBe(false);
    });

    it('does not show the old list when the url changes', async () => {
      let finish;
      const request = vi.fn().mockResolvedValueOnce(response(page('old')))
        .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
      const { result, rerender } = renderHook(({ url }) => usePagedHistory({ url, enabled: true, request, revision: 0, searching: false }), { initialProps: { url: '/api/history?month=2026-09' } });
      await waitFor(() => expect(result.current.loading).toBe(false));
      rerender({ url: '/api/history?month=2026-08' });
      expect(result.current.transactions).toEqual({});
      expect(result.current.refreshing).toBe(false);
      await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
      expect(result.current.transactions).toEqual({});
      expect(result.current.loading).toBe(true);
      expect(result.current.refreshing).toBe(false);
      await act(async () => finish(response(page('august'))));
      expect(items(result)).toEqual([{ id: 'august' }]);
    });

    it('keeps the old rows and shows the error when a revision refresh fails, then retries the first page', async () => {
      const request = vi.fn().mockResolvedValueOnce(response(page('old', 'cursor')))
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValueOnce(response(page('new')));
      const { result, rerender } = renderHook(({ revision }) => usePagedHistory({ url: '/api/history?continuous=1', enabled: true, request, revision, searching: false }), { initialProps: { revision: 0 } });
      await waitFor(() => expect(result.current.loading).toBe(false));
      rerender({ revision: 1 });
      await waitFor(() => expect(result.current.error).toBeTruthy());
      expect(items(result)).toEqual([{ id: 'old' }]);
      expect(result.current.loading).toBe(false);
      expect(result.current.refreshing).toBe(false);
      act(() => result.current.loadMore());
      await waitFor(() => expect(result.current.error).toBe(''));
      expect(request.mock.calls[2][0]).not.toContain('cursor=');
      expect(items(result)).toEqual([{ id: 'new' }]);
    });

    it('does not carry rows over a logout', async () => {
      const request = vi.fn().mockResolvedValue(response(page('old')));
      const { result, rerender } = renderHook(({ enabled, revision }) => usePagedHistory({ url: '/api/history?continuous=1', enabled, request, revision, searching: false }), { initialProps: { enabled: true, revision: 0 } });
      await waitFor(() => expect(result.current.loading).toBe(false));
      rerender({ enabled: false, revision: 1 });
      rerender({ enabled: true, revision: 2 });
      expect(result.current.transactions).toEqual({});
      expect(result.current.refreshing).toBe(false);
    });
  });
});
