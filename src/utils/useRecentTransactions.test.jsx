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

  // Вставки: только что сохранённая операция видна, пока не пришёл список,
  // который её уже содержит.
  describe('inserts of just-saved operations', () => {
    const saved = { _id: 'ff1', title: 'Кофе', amount: 4.5, type: 'expense', category: 'Еда', account: 'card', date: '2026-09-24T00:00:00.000Z' };
    const insert = { saved, untilRevision: 1 };

    it('puts the saved row on top of the old list while the refetch is in flight, and marks it fresh', async () => {
      let finishSecond;
      const request = vi.fn()
        .mockResolvedValueOnce(response(page('a1')))
        .mockImplementationOnce(() => new Promise(resolve => { finishSecond = resolve; }));
      const { result, rerender } = setup(request);
      await waitFor(() => expect(ids(result)).toEqual(['a1']));

      rerender({ revision: 1, inserts: [insert] });

      expect(result.current.loading).toBe(false);
      expect(ids(result)).toEqual(['ff1', 'a1']);
      expect([...result.current.freshIds]).toEqual(['ff1']);
      expect(result.current.groups['2026-09-24'].dailySum).toBeCloseTo(-14.5);

      // Список ревизии 1 уже содержит операцию: вставка отбрасывается, строка
      // - серверная и больше не свежая.
      await act(async () => finishSecond(response({
        transactions: { '2026-09-24': { dailySum: -14.5, items: [{ id: 'ff1' }, { id: 'a1' }] } },
      })));
      expect(ids(result)).toEqual(['ff1', 'a1']);
      expect(result.current.freshIds.size).toBe(0);
      expect(result.current.groups['2026-09-24'].dailySum).toBe(-14.5);
    });

    it('does not apply an insert to a list loaded for the same or a newer revision', async () => {
      const request = vi.fn().mockResolvedValue(response(page('a2')));
      const { result } = setup(request, { revision: 1, inserts: [insert] });
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(ids(result)).toEqual(['a2']);
      expect(result.current.freshIds.size).toBe(0);
    });

    it('keeps the insert while the loaded list is older than the revision it waits for', async () => {
      // Вставка ждёт ревизии 2: список ревизии 1 её ещё не содержит.
      const request = vi.fn().mockResolvedValue(response(page('a2')));
      const { result } = setup(request, { revision: 1, inserts: [{ saved, untilRevision: 2 }] });
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(ids(result)).toEqual(['ff1', 'a2']);
    });

    it('shows neither the insert nor fresh ids under the skeleton (account switched)', async () => {
      let finishSecond;
      const request = vi.fn()
        .mockResolvedValueOnce(response(page('all')))
        .mockImplementationOnce(() => new Promise(resolve => { finishSecond = resolve; }));
      const { result, rerender } = setup(request);
      await waitFor(() => expect(ids(result)).toEqual(['all']));

      rerender({ revision: 1, account: 'card', inserts: [insert] });

      expect(result.current.loading).toBe(true);
      expect(ids(result)).toEqual([]);
      expect(result.current.freshIds.size).toBe(0);
      await act(async () => finishSecond(response(page('card-row'))));
      expect(ids(result)).toEqual(['card-row']);
    });

    it('does not apply inserts to an error state', async () => {
      const request = vi.fn()
        .mockResolvedValueOnce(response(page('a1')))
        .mockRejectedValueOnce(new Error('offline'));
      const { result, rerender } = setup(request);
      await waitFor(() => expect(ids(result)).toEqual(['a1']));

      rerender({ revision: 1, inserts: [insert] });
      await waitFor(() => expect(result.current.error).toBe(true));

      expect(ids(result)).toEqual([]);
      expect(result.current.freshIds.size).toBe(0);
    });

    it('skips an insert that does not belong to the list (other account, future month)', async () => {
      let finishSecond;
      const request = vi.fn()
        .mockResolvedValueOnce(response(page('a1')))
        .mockImplementationOnce(() => new Promise(resolve => { finishSecond = resolve; }));
      const { result, rerender } = setup(request, { account: 'cash' });
      await waitFor(() => expect(ids(result)).toEqual(['a1']));

      rerender({ account: 'cash', revision: 1, inserts: [insert, { saved: { ...saved, _id: '700', account: 'cash', date: '2026-10-01T00:00:00.000Z' }, untilRevision: 1 }] });

      expect(ids(result)).toEqual(['a1']);
      expect(result.current.freshIds.size).toBe(0);
      await act(async () => finishSecond(response(page('a1'))));
    });
  });
  // Удаления: строка остаётся в списке уходящей, пока не пришёл список, где её уже нет.
  describe('removals of just-deleted operations', () => {
    const item = (id, amount) => ({ id, type: 'expense', visualAmount: amount, account: 'card', date: '2026-09-24' });
    const twoRows = () => ({
      transactions: { '2026-09-24': { dailySum: -15, items: [item('z1', -10), item('b2', -5)] } },
    });
    const removal = { id: 'z1', splitId: null, trashId: 'z1', untilRevision: 1 };

    it('keeps the deleted row, marks it leaving and takes it out of the day sum until the refetch lands', async () => {
      let finishSecond;
      const request = vi.fn()
        .mockResolvedValueOnce(response(twoRows()))
        .mockImplementationOnce(() => new Promise(resolve => { finishSecond = resolve; }));
      const { result, rerender } = setup(request);
      await waitFor(() => expect(ids(result)).toEqual(['z1', 'b2']));
      expect(result.current.leavingIds.size).toBe(0);

      rerender({ revision: 1, removals: [removal] });

      expect(result.current.loading).toBe(false);
      expect(ids(result)).toEqual(['z1', 'b2']);
      expect([...result.current.leavingIds]).toEqual(['z1']);
      expect(result.current.groups['2026-09-24'].dailySum).toBe(-5);

      // Список ревизии 1 пришёл без удалённой строки: она просто исчезла.
      await act(async () => finishSecond(response({
        transactions: { '2026-09-24': { dailySum: -5, items: [item('b2', -5)] } },
      })));
      expect(ids(result)).toEqual(['b2']);
      expect(result.current.leavingIds.size).toBe(0);
      expect(result.current.groups['2026-09-24'].dailySum).toBe(-5);
    });

    it('stops treating the row as leaving once the removal is dropped (undo before the refetch)', async () => {
      const request = vi.fn()
        .mockResolvedValueOnce(response(twoRows()))
        .mockImplementationOnce(() => new Promise(() => { }));
      const { result, rerender } = setup(request);
      await waitFor(() => expect(ids(result)).toEqual(['z1', 'b2']));
      rerender({ revision: 1, removals: [removal] });
      expect([...result.current.leavingIds]).toEqual(['z1']);

      rerender({ revision: 2, removals: [] });

      expect(result.current.leavingIds.size).toBe(0);
      expect(ids(result)).toEqual(['z1', 'b2']);
      expect(result.current.groups['2026-09-24'].dailySum).toBe(-15);
    });

    it('brings a restored row back as fresh when the list without it has already arrived', async () => {
      const saved = { _id: 'z1', amount: 10, type: 'expense', category: 'Еда', account: 'card', date: '2026-09-24T00:00:00.000Z' };
      let finishThird;
      const request = vi.fn()
        .mockResolvedValueOnce(response(twoRows()))
        .mockResolvedValueOnce(response({ transactions: { '2026-09-24': { dailySum: -5, items: [item('b2', -5)] } } }))
        .mockImplementationOnce(() => new Promise(resolve => { finishThird = resolve; }));
      const { result, rerender } = setup(request);
      await waitFor(() => expect(ids(result)).toEqual(['z1', 'b2']));
      rerender({ revision: 1, removals: [removal] });
      await waitFor(() => expect(ids(result)).toEqual(['b2']));

      // Отмена: запись об удалении снята, операция вернулась вставкой.
      rerender({ revision: 2, removals: [], inserts: [{ saved: [saved], untilRevision: 2 }] });

      expect(ids(result)).toEqual(['z1', 'b2']);
      expect([...result.current.freshIds]).toEqual(['z1']);
      expect(result.current.leavingIds.size).toBe(0);
      expect(result.current.groups['2026-09-24'].dailySum).toBeCloseTo(-15);
      await act(async () => finishThird(response(twoRows())));
      expect(ids(result)).toEqual(['z1', 'b2']);
      expect(result.current.freshIds.size).toBe(0);
    });

    it('ignores a removal that the loaded list already reflects', async () => {
      const request = vi.fn().mockResolvedValue(response({ transactions: { '2026-09-24': { dailySum: -5, items: [item('b2', -5)] } } }));
      const { result } = setup(request, { revision: 1, removals: [removal] });
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(ids(result)).toEqual(['b2']);
      expect(result.current.leavingIds.size).toBe(0);
    });

    it('marks no row as leaving under the skeleton (account switched) or an error', async () => {
      let finishSecond;
      const request = vi.fn()
        .mockResolvedValueOnce(response(twoRows()))
        .mockImplementationOnce(() => new Promise(resolve => { finishSecond = resolve; }));
      const { result, rerender } = setup(request);
      await waitFor(() => expect(ids(result)).toEqual(['z1', 'b2']));

      rerender({ revision: 1, account: 'card', removals: [removal] });

      expect(result.current.loading).toBe(true);
      expect(result.current.leavingIds.size).toBe(0);
      await act(async () => finishSecond(response({ transactions: {} })));
    });

    it('collapses a whole split purchase by its splitId', async () => {
      const parts = [{ ...item('p1', -30), splitId: 's1' }, { ...item('p2', -70), splitId: 's1' }];
      const request = vi.fn()
        .mockResolvedValueOnce(response({
          transactions: { '2026-09-24': { dailySum: -105, items: [{ id: 's1', type: 'split_group', visualAmount: -100, items: parts }, item('b2', -5)] } },
        }))
        .mockImplementationOnce(() => new Promise(() => { }));
      const { result, rerender } = setup(request);
      await waitFor(() => expect(ids(result)).toEqual(['s1', 'b2']));

      rerender({ revision: 1, removals: [{ id: 'p1', splitId: 's1', trashId: 'p1', untilRevision: 1 }] });

      expect([...result.current.leavingIds]).toEqual(['s1']);
      expect(result.current.groups['2026-09-24'].dailySum).toBe(-5);
    });
  });
});
