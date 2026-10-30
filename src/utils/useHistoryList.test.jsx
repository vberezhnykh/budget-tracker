import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import useHistoryList, { historyKey } from './useHistoryList';

const list = id => ({ transactions: { '2026-09-24': { dailySum: -100, items: [{ id }] } }, count: 1, nextCursor: null, previousCursor: null, complete: true });
const response = data => ({ ok: true, json: async () => data });
const ids = result => Object.values(result.current.transactions).flatMap(day => day.items.map(item => item.id));
// Ответ по умолчанию: id равен значению фильтра account.
const byAccount = vi.fn(url => Promise.resolve(response(list(new URL(url, 'http://x').searchParams.get('account') || 'all'))));
const setup = (overrides = {}, request = byAccount) => renderHook(
  props => useHistoryList({ enabled: true, revision: 0, request, searching: false, ...props }),
  { initialProps: { filters: {}, ...overrides } },
);

afterEach(() => {
  vi.useRealTimers();
  byAccount.mockClear();
});

describe('historyKey', () => {
  it('is the whole-list URL of the filters, without month or limit', () => {
    expect(historyKey({})).toBe('/api/history?continuous=1&all=1');
    expect(historyKey({ account: 'a', category: 'Еда', type: 'expense', q: ' кофе ' }))
      .toBe('/api/history?continuous=1&all=1&account=a&category=%D0%95%D0%B4%D0%B0&type=expense&q=%D0%BA%D0%BE%D1%84%D0%B5');
  });
});

describe('useHistoryList', () => {
  it('loads once, shows loading with no data and then the whole list', async () => {
    const { result } = setup();
    expect(result.current).toMatchObject({ loading: true, refreshing: false, error: '', transactions: {}, count: 0 });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(ids(result)).toEqual(['all']);
    expect(result.current.count).toBe(1);
    expect(byAccount).toHaveBeenCalledTimes(1);
    expect(byAccount.mock.calls[0][0]).toBe('/api/history?continuous=1&all=1');
  });

  it('shows a cached key immediately without a request (A -> B -> A)', async () => {
    const { result, rerender } = setup({ filters: { account: 'A' } });
    await waitFor(() => expect(ids(result)).toEqual(['A']));
    rerender({ filters: { account: 'B' } });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(ids(result)).toEqual(['B']));
    rerender({ filters: { account: 'A' } });
    expect(ids(result)).toEqual(['A']);
    expect(result.current).toMatchObject({ loading: false, refreshing: false });
    await act(async () => { await Promise.resolve(); });
    expect(byAccount).toHaveBeenCalledTimes(2);
  });

  it('keeps the data and refreshes in the background after a revision bump', async () => {
    let second;
    const request = vi.fn()
      .mockResolvedValueOnce(response(list('old')))
      .mockImplementationOnce(() => new Promise(resolve => { second = resolve; }));
    const { result, rerender } = setup({}, request);
    await waitFor(() => expect(ids(result)).toEqual(['old']));
    const key = result.current.dataKey;
    rerender({ revision: 1 });
    expect(ids(result)).toEqual(['old']);
    expect(result.current).toMatchObject({ loading: false, refreshing: true });
    await act(async () => second(response(list('new'))));
    expect(ids(result)).toEqual(['new']);
    expect(result.current).toMatchObject({ loading: false, refreshing: false, dataKey: key });
  });

  it('refreshes a stale cached key when it is visited again, keeping its data', async () => {
    const { result, rerender } = setup({ filters: { account: 'A' } });
    await waitFor(() => expect(ids(result)).toEqual(['A']));
    rerender({ filters: { account: 'B' } });
    await waitFor(() => expect(ids(result)).toEqual(['B']));
    rerender({ filters: { account: 'B' }, revision: 1 });
    await waitFor(() => expect(result.current.refreshing).toBe(false));
    expect(byAccount).toHaveBeenCalledTimes(3);
    let refresh;
    byAccount.mockImplementationOnce(() => new Promise(resolve => { refresh = resolve; }));
    rerender({ filters: { account: 'A' }, revision: 1 });
    expect(ids(result)).toEqual(['A']);
    expect(result.current).toMatchObject({ loading: false, refreshing: true });
    await act(async () => refresh(response(list('A2'))));
    expect(ids(result)).toEqual(['A2']);
    expect(result.current.refreshing).toBe(false);
  });

  it('keeps only the last 8 keys (LRU)', async () => {
    const { result, rerender } = setup({ filters: { account: 'a0' } });
    await waitFor(() => expect(ids(result)).toEqual(['a0']));
    for (let i = 1; i <= 8; i += 1) {
      rerender({ filters: { account: `a${i}` } });
      await waitFor(() => expect(ids(result)).toEqual([`a${i}`]));
    }
    expect(byAccount).toHaveBeenCalledTimes(9);
    // a0 вытеснен, a8..a1 в кэше.
    rerender({ filters: { account: 'a1' } });
    expect(ids(result)).toEqual(['a1']);
    rerender({ filters: { account: 'a0' } });
    expect(result.current).toMatchObject({ loading: true, transactions: {} });
    await waitFor(() => expect(ids(result)).toEqual(['a0']));
    expect(byAccount).toHaveBeenCalledTimes(10);
  });

  it('evicts the least recently USED key, not the oldest loaded one', async () => {
    const { result, rerender } = setup({ filters: { account: 'a0' } });
    await waitFor(() => expect(ids(result)).toEqual(['a0']));
    for (let i = 1; i <= 7; i += 1) {
      rerender({ filters: { account: `a${i}` } });
      await waitFor(() => expect(ids(result)).toEqual([`a${i}`]));
    }
    rerender({ filters: { account: 'a0' } });
    expect(ids(result)).toEqual(['a0']);
    rerender({ filters: { account: 'a8' } });
    await waitFor(() => expect(ids(result)).toEqual(['a8']));
    rerender({ filters: { account: 'a0' } });
    expect(ids(result)).toEqual(['a0']);
    rerender({ filters: { account: 'a1' } });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(ids(result)).toEqual(['a1']));
  });

  it('aborts the in-flight request when the key changes and never shows its late response', async () => {
    const signals = [];
    let finishA;
    const request = vi.fn((url, { signal }) => {
      signals.push(signal);
      if (url.includes('account=A')) return new Promise(resolve => { finishA = resolve; });
      return Promise.resolve(response(list('B')));
    });
    const { result, rerender } = setup({ filters: { account: 'A' } }, request);
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    rerender({ filters: { account: 'B' } });
    expect(signals[0].aborted).toBe(true);
    await waitFor(() => expect(ids(result)).toEqual(['B']));
    // Запрос проигнорировал abort и всё же ответил.
    await act(async () => finishA(response(list('A'))));
    expect(ids(result)).toEqual(['B']);
    // Ответ осел в кэше под своим ключом: возврат на A мгновенный.
    rerender({ filters: { account: 'A' } });
    expect(ids(result)).toEqual(['A']);
  });

  it('does not store a response requested before a revision bump as fresh', async () => {
    let first;
    const request = vi.fn()
      .mockImplementationOnce(() => new Promise(resolve => { first = resolve; }))
      .mockImplementationOnce(() => new Promise(() => {}));
    const { result, rerender } = setup({}, request);
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    rerender({ revision: 1 });
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    await act(async () => first(response(list('before-write'))));
    // Данные показать можно, но свежими они не считаются: обновление идёт.
    expect(ids(result)).toEqual(['before-write']);
    expect(result.current.refreshing).toBe(true);
  });

  it('wipes the whole cache on logout and does not take a late response afterwards', async () => {
    let late;
    const request = vi.fn()
      .mockResolvedValueOnce(response(list('mine')))
      .mockImplementationOnce(() => new Promise(resolve => { late = resolve; }))
      .mockResolvedValue(response(list('next-user')));
    const { result, rerender } = setup({}, request);
    await waitFor(() => expect(ids(result)).toEqual(['mine']));
    rerender({ revision: 1 });
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    rerender({ enabled: false, revision: 1 });
    expect(result.current).toMatchObject({ transactions: {}, loading: false, refreshing: false });
    await act(async () => late(response(list('late-mine'))));
    expect(result.current.transactions).toEqual({});
    rerender({ enabled: true, revision: 2 });
    expect(result.current).toMatchObject({ transactions: {}, loading: true });
    await waitFor(() => expect(ids(result)).toEqual(['next-user']));
  });

  it('reset() drops the cache and loads the current list again', async () => {
    const request = vi.fn().mockResolvedValueOnce(response(list('a'))).mockResolvedValueOnce(response(list('b')));
    const { result } = setup({}, request);
    await waitFor(() => expect(ids(result)).toEqual(['a']));
    act(() => result.current.reset());
    expect(result.current.transactions).toEqual({});
    await waitFor(() => expect(ids(result)).toEqual(['b']));
  });

  it('debounces search keys by 250 ms and requests immediately for plain filters', async () => {
    vi.useFakeTimers();
    const { result, rerender } = setup({ filters: { q: 'ко' }, searching: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(byAccount).not.toHaveBeenCalled();
    rerender({ filters: { q: 'коф' }, searching: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(byAccount).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(60); });
    expect(byAccount).toHaveBeenCalledTimes(1);
    expect(byAccount.mock.calls[0][0]).toContain('q=');
    expect(byAccount.mock.calls[0][0]).toContain('%D0%BA%D0%BE%D1%84');
    expect(result.current.loading).toBe(false);
    rerender({ filters: {}, searching: false });
    await act(async () => { await Promise.resolve(); });
    expect(byAccount).toHaveBeenCalledTimes(2);
  });

  it('does not let searches push the plain lists out of the cache', async () => {
    const { result, rerender } = setup({ filters: { account: 'A' } });
    await waitFor(() => expect(ids(result)).toEqual(['A']));
    for (let i = 0; i < 5; i += 1) {
      rerender({ filters: { account: 'A', q: `q${i}` }, searching: true });
      await waitFor(() => expect(result.current.loading).toBe(false), { timeout: 2000 });
    }
    rerender({ filters: { account: 'A' }, searching: false });
    expect(ids(result)).toEqual(['A']);
    expect(result.current.loading).toBe(false);
  });

  it('keeps the data and reports the error when a refresh fails, then retry() refetches', async () => {
    const request = vi.fn().mockResolvedValueOnce(response(list('old')))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(response(list('new')));
    const { result, rerender } = setup({}, request);
    await waitFor(() => expect(ids(result)).toEqual(['old']));
    rerender({ revision: 1 });
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(ids(result)).toEqual(['old']);
    expect(result.current).toMatchObject({ loading: false, refreshing: false });
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.error).toBe(''));
    await waitFor(() => expect(ids(result)).toEqual(['new']));
    expect(request).toHaveBeenCalledTimes(3);
  });

  it('reports an error with no data (no endless skeleton) and an incomplete answer counts as an error', async () => {
    const request = vi.fn().mockResolvedValueOnce(response({ ...list('x'), complete: undefined }))
      .mockResolvedValueOnce(response(list('ok')));
    const { result } = setup({}, request);
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current).toMatchObject({ loading: false, transactions: {} });
    act(() => result.current.retry());
    await waitFor(() => expect(ids(result)).toEqual(['ok']));
  });

  it('keeps dataKey stable across a refresh and changes it only with the filters', async () => {
    const { result, rerender } = setup({ filters: { account: 'A' } });
    await waitFor(() => expect(ids(result)).toEqual(['A']));
    const key = result.current.dataKey;
    rerender({ filters: { account: 'A' }, revision: 1 });
    expect(result.current.dataKey).toBe(key);
    await waitFor(() => expect(result.current.refreshing).toBe(false));
    expect(result.current.dataKey).toBe(key);
    rerender({ filters: { account: 'B' }, revision: 1 });
    expect(result.current.dataKey).not.toBe(key);
    await waitFor(() => expect(ids(result)).toEqual(['B']));
  });
});

// Правки поверх списка до ответа сервера: сохранённые и удалённые операции.
describe('useHistoryList with just-saved and just-deleted operations', () => {
  const item = (id, amount, extra = {}) => ({ id, type: 'expense', visualAmount: amount, account: 'card', date: '2026-09-24', ...extra });
  const full = () => ({
    transactions: {
      '2026-09-24': { dailySum: -15, items: [item('b2', -10), item('a1', -5)] },
      '2026-08-30': { dailySum: -3, items: [item('c0', -3, { date: '2026-08-30' })] },
    },
    count: 3, complete: true,
  });
  const saved = { _id: 'z9', amount: 7, type: 'expense', category: 'Еда', account: 'card', date: '2026-09-24T00:00:00.000Z' };
  const removal = { id: 'a1', splitId: null, trashId: 'a1', untilRevision: 1 };
  // Запрос ревизии 1 держится: список остаётся прежним.
  const held = () => vi.fn()
    .mockResolvedValueOnce(response(full()))
    .mockImplementation(() => new Promise(() => { }));

  it('keeps a deleted row marked as leaving, with the day sum already lower, until the refreshed list arrives', async () => {
    let second;
    const request = vi.fn()
      .mockResolvedValueOnce(response(full()))
      .mockImplementationOnce(() => new Promise(resolve => { second = resolve; }));
    const { result, rerender } = setup({}, request);
    await waitFor(() => expect(ids(result)).toEqual(['b2', 'a1', 'c0']));

    rerender({ revision: 1, removals: [removal] });

    expect(ids(result)).toEqual(['b2', 'a1', 'c0']);
    expect([...result.current.leavingIds]).toEqual(['a1']);
    expect(result.current.transactions['2026-09-24'].dailySum).toBe(-10);
    expect(result.current.refreshing).toBe(true);

    await act(async () => second(response({
      transactions: { '2026-09-24': { dailySum: -10, items: [item('b2', -10)] }, '2026-08-30': full().transactions['2026-08-30'] },
      count: 2, complete: true,
    })));
    expect(ids(result)).toEqual(['b2', 'c0']);
    expect(result.current.leavingIds.size).toBe(0);
  });

  it('applies removals whatever the filter is', async () => {
    const { result, rerender } = setup({ filters: { category: 'Еда', q: 'кофе', type: 'expense' } }, held());
    await waitFor(() => expect(ids(result)).toEqual(['b2', 'a1', 'c0']));

    rerender({ filters: { category: 'Еда', q: 'кофе', type: 'expense' }, revision: 1, removals: [removal] });

    expect([...result.current.leavingIds]).toEqual(['a1']);
  });

  it('puts a just-saved row into an unfiltered list as fresh, with no page limit and no month cap', async () => {
    const { result, rerender } = setup({}, held());
    await waitFor(() => expect(ids(result)).toEqual(['b2', 'a1', 'c0']));

    rerender({ revision: 1, inserts: [{ saved, untilRevision: 1 }, { saved: { ...saved, _id: 'z8', date: '2027-02-01T00:00:00.000Z' }, untilRevision: 1 }] });

    expect(ids(result)).toEqual(['z8', 'z9', 'b2', 'a1', 'c0']);
    expect([...result.current.freshIds].sort()).toEqual(['z8', 'z9']);
    expect(result.current.transactions['2026-09-24'].dailySum).toBe(-22);
  });

  it('inserts into an account-only filter when the account matches, and skips other accounts', async () => {
    const { result, rerender } = setup({ filters: { account: 'card' } }, held());
    await waitFor(() => expect(ids(result)).toEqual(['b2', 'a1', 'c0']));

    rerender({ filters: { account: 'card' }, revision: 1, inserts: [{ saved, untilRevision: 1 }, { saved: { ...saved, _id: 'z8', account: 'cash' }, untilRevision: 1 }] });

    expect(ids(result)).toEqual(['z9', 'b2', 'a1', 'c0']);
    expect([...result.current.freshIds]).toEqual(['z9']);
  });

  it.each([
    ['category', { category: 'Еда' }],
    ['type', { type: 'expense' }],
    ['search', { q: 'кофе' }],
  ])('does not insert into a list filtered by %s', async (_name, filters) => {
    const { result, rerender } = setup({ filters }, held());
    await waitFor(() => expect(ids(result)).toEqual(['b2', 'a1', 'c0']));

    rerender({ filters, revision: 1, inserts: [{ saved, untilRevision: 1 }] });

    expect(ids(result)).toEqual(['b2', 'a1', 'c0']);
    expect(result.current.freshIds.size).toBe(0);
  });

  it('drops an insert and a removal once the list of their revision is on screen', async () => {
    const { result } = setup({ revision: 1, inserts: [{ saved, untilRevision: 1 }], removals: [removal] });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.freshIds.size).toBe(0);
    expect(result.current.leavingIds.size).toBe(0);
  });

  it('gives back the server list untouched when there is nothing to apply', async () => {
    const { result } = setup({}, held());
    await waitFor(() => expect(ids(result)).toEqual(['b2', 'a1', 'c0']));

    expect(result.current.freshIds.size).toBe(0);
    expect(result.current.leavingIds.size).toBe(0);
    expect(result.current.transactions['2026-09-24'].dailySum).toBe(-15);
  });
});
