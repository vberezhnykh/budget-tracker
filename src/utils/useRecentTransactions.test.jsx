import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import useRecentTransactions from './useRecentTransactions';

const page = id => ({ transactions: { '2026-09-24': { dailySum: -10, items: [{ id }] } }, count: 1, nextCursor: null });
const response = data => ({ ok: true, json: async () => data });
const ids = result => Object.values(result.current.groups).flatMap(group => group.items.map(item => item.id));

const setup = (request, props = {}) => renderHook(
  hookProps => useRecentTransactions({ enabled: true, request, month: '2026-09', account: null, revision: 0, ...hookProps }),
  { initialProps: props },
);

describe('useRecentTransactions', () => {
  it('asks for the five newest rows of the month, continuous, without an account by default', async () => {
    const request = vi.fn().mockResolvedValue(response(page('a')));
    const { result } = setup(request);

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(request).toHaveBeenCalledTimes(1);
    const [url, options] = request.mock.calls[0];
    expect(url).toBe('/api/history?month=2026-09&continuous=1&limit=5');
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(ids(result)).toEqual(['a']);
    expect(result.current.error).toBe(false);
  });

  it('adds the selected account to the query and shows a skeleton, not the other account\'s rows, while it loads', async () => {
    let finishSecond;
    const request = vi.fn()
      .mockResolvedValueOnce(response(page('all')))
      .mockImplementationOnce(() => new Promise(resolve => { finishSecond = resolve; }));
    const { result, rerender } = setup(request);
    await waitFor(() => expect(ids(result)).toEqual(['all']));

    rerender({ account: 'card' });

    expect(request.mock.calls[1][0]).toBe('/api/history?month=2026-09&continuous=1&limit=5&account=card');
    expect(result.current.loading).toBe(true);
    expect(ids(result)).toEqual([]);

    await act(async () => finishSecond(response(page('card-row'))));
    expect(result.current.loading).toBe(false);
    expect(ids(result)).toEqual(['card-row']);
  });

  it('refetches on a revision bump and keeps the old rows on screen meanwhile', async () => {
    let finishSecond;
    const request = vi.fn()
      .mockResolvedValueOnce(response(page('old')))
      .mockImplementationOnce(() => new Promise(resolve => { finishSecond = resolve; }));
    const { result, rerender } = setup(request);
    await waitFor(() => expect(ids(result)).toEqual(['old']));

    rerender({ revision: 1 });

    expect(request).toHaveBeenCalledTimes(2);
    expect(result.current.loading).toBe(false);
    expect(ids(result)).toEqual(['old']);

    await act(async () => finishSecond(response(page('new'))));
    expect(ids(result)).toEqual(['new']);
  });

  it('ignores a response that arrives after the account has changed', async () => {
    let finishFirst;
    const request = vi.fn()
      .mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; }))
      .mockResolvedValueOnce(response(page('card-row')));
    const { result, rerender } = setup(request);
    rerender({ account: 'card' });
    await waitFor(() => expect(ids(result)).toEqual(['card-row']));

    await act(async () => finishFirst(response(page('stale'))));

    expect(ids(result)).toEqual(['card-row']);
  });

  it('reports an error for a failed or malformed response and retries on demand', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ ok: false, json: async () => ({}) })
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response(page('ok')));
    const { result } = setup(request);
    await waitFor(() => expect(result.current.error).toBe(true));
    expect(ids(result)).toEqual([]);

    act(() => result.current.retry());
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.error).toBe(true));

    // Ждём сами данные, а не error === false: пока повтор загружается, хук
    // тоже отдаёт error: false, и такое ожидание срабатывало до ответа.
    act(() => result.current.retry());
    await waitFor(() => expect(ids(result)).toEqual(['ok']));
    expect(result.current.error).toBe(false);
  });

  it('treats a network failure as an error', async () => {
    const request = vi.fn().mockRejectedValue(new Error('offline'));
    const { result } = setup(request);
    await waitFor(() => expect(result.current.error).toBe(true));
    expect(result.current.loading).toBe(false);
  });

  it('does not request anything while disabled', () => {
    const request = vi.fn();
    const { result } = setup(request, { enabled: false });
    expect(request).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ loading: false, error: false, groups: {} });
  });
});
