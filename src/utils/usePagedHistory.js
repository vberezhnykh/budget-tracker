import { useCallback, useEffect, useRef, useState } from 'react';

const EMPTY = { transactions: {}, count: 0, nextCursor: null };

export function mergeHistoryPages(previous, incoming) {
  const transactions = { ...previous.transactions };
  for (const [date, group] of Object.entries(incoming.transactions)) {
    const items = new Map((transactions[date]?.items || []).map(item => [item.id, item]));
    group.items.forEach(item => items.set(item.id, item));
    transactions[date] = { ...group, items: [...items.values()] };
  }
  return { ...incoming, transactions };
}

export default function usePagedHistory({ url, enabled, revision, request, searching }) {
  const key = `${revision}:${url}`;
  const [state, setState] = useState({ key: null, data: EMPTY, loading: false, error: '' });
  const generation = useRef(0);
  const inFlight = useRef(null);
  const controller = useRef(null);

  const fetchPage = useCallback(async (cursor, append, epoch) => {
    if (inFlight.current !== null) return;
    const token = {};
    inFlight.current = token;
    controller.current = new AbortController();
    setState(previous => ({ key, data: append && previous.key === key ? previous.data : EMPTY, loading: true, error: '' }));
    try {
      const response = await request(`${url}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { signal: controller.current.signal });
      const body = await response.json();
      if (!response.ok || !body?.transactions || !Number.isInteger(body.count)
        || !(body.nextCursor === null || typeof body.nextCursor === 'string')) throw new Error('Не удалось загрузить операции');
      if (epoch !== generation.current) return;
      setState(previous => ({ key, data: append ? mergeHistoryPages(previous.data, body) : body, loading: false, error: '' }));
    } catch (error) {
      if (epoch !== generation.current || error.name === 'AbortError') return;
      setState(previous => ({ ...previous, loading: false, error: 'Не удалось загрузить операции. Повторите попытку.' }));
    } finally {
      if (inFlight.current === token) inFlight.current = null;
    }
  }, [key, request, url]);

  useEffect(() => {
    const epoch = ++generation.current;
    inFlight.current = null;
    const start = () => {
      if (epoch === generation.current) fetchPage(null, false, epoch);
    };
    let timer;
    if (enabled) {
      if (searching) timer = setTimeout(start, 250);
      else Promise.resolve().then(start);
    }
    return () => {
      clearTimeout(timer);
      generation.current += 1;
      controller.current?.abort();
      inFlight.current = null;
    };
  }, [enabled, fetchPage, searching]);

  const current = enabled && state.key === key;
  const data = current ? state.data : EMPTY;
  const loadMore = () => {
    if (enabled && !state.loading && current) fetchPage(data.nextCursor, data.nextCursor !== null, generation.current);
  };
  return { ...data, loading: enabled && (!current || state.loading), error: current ? state.error : '', loadMore, key };
}
