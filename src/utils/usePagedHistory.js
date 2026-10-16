import { useCallback, useEffect, useRef, useState } from 'react';

const EMPTY = { transactions: {}, count: 0, nextCursor: null, previousCursor: null };

const INITIAL = { key: null, url: null, data: EMPTY, loading: false, error: '', direction: 'older', stale: false };

const hasRows = data => Object.keys(data?.transactions || {}).length > 0;

export function mergeHistoryPages(previous, incoming, direction = 'older') {
  const transactions = { ...previous.transactions };
  for (const [date, group] of Object.entries(incoming.transactions)) {
    const items = new Map((transactions[date]?.items || []).map(item => [item.id, item]));
    group.items.forEach(item => items.set(item.id, item));
    transactions[date] = { ...group, items: [...items.values()].sort((a, b) => String(b.id).localeCompare(String(a.id))) };
  }
  return { ...incoming, transactions,
    ...(direction === 'newer' ? { nextCursor: previous.nextCursor } : { previousCursor: previous.previousCursor }),
  };
}

// Смена revision (после любой записи) при том же url не очищает список: прежние
// строки остаются на экране, пока не придет свежая первая страница (refreshing).
// Смена url (фильтры, месяц, поиск) - это другой список, показывать старый нельзя,
// поэтому там по-прежнему пусто/скелетон. Как в useRecentTransactions.
export default function usePagedHistory({ url, enabled, revision, request, searching }) {
  const key = `${revision}:${url}`;
  // stale: в data лежит список прошлой ревизии, свежая первая страница еще не пришла.
  const [state, setState] = useState(INITIAL);
  const generation = useRef(0);
  const inFlight = useRef(null);
  const controller = useRef(null);

  const fetchPage = useCallback(async (cursor, append, epoch, direction = 'older') => {
    if (inFlight.current !== null) return;
    const token = {};
    inFlight.current = token;
    controller.current = new AbortController();
    setState(previous => {
      if (append && previous.key === key) return { ...previous, loading: true, error: '', direction };
      // Тот же url, другая ревизия: оставляем прежние строки до ответа.
      const keep = !append && previous.url === url && hasRows(previous.data);
      return { key, url, data: keep ? previous.data : EMPTY, loading: true, error: '', direction, stale: keep };
    });
    try {
      const response = await request(`${url}${cursor ? `&cursor=${encodeURIComponent(cursor)}&direction=${direction}` : ''}`, { signal: controller.current.signal });
      const body = await response.json();
      if (!response.ok || !body?.transactions || !Number.isInteger(body.count)
        || !(body.nextCursor === null || typeof body.nextCursor === 'string')) throw new Error('Не удалось загрузить операции');
      if (epoch !== generation.current) return;
      setState(previous => ({ key, url, data: append ? mergeHistoryPages(previous.data, body, direction) : { ...EMPTY, ...body }, loading: false, error: '', direction, stale: false }));
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
    // После выхода список прошлого пользователя не должен пережить сессию и
    // всплыть как «прежний» при следующем входе.
    if (!enabled) setState(previous => (previous.key === null ? previous : INITIAL));
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
  // Ревизия уже выросла, а запрос первой страницы еще не стартовал (или идет).
  const waiting = enabled && !current && state.url === url && hasRows(state.data);
  const data = current || waiting ? state.data : EMPTY;
  const refreshing = (current && state.stale && state.loading) || waiting;
  const loadMore = () => {
    if (!enabled || state.loading || !current) return;
    // Прежний список остался после неудачного обновления: повторяем первую
    // страницу, а не листаем старые курсоры.
    if (state.stale) fetchPage(null, false, generation.current);
    else fetchPage(data.nextCursor, data.nextCursor !== null, generation.current);
  };
  const loadNewer = () => {
    if (enabled && !state.loading && current && !state.stale && data.previousCursor) fetchPage(data.previousCursor, true, generation.current, 'newer');
  };
  return { ...data, loading: enabled && (!current || state.loading), refreshing, error: current ? state.error : '',
    direction: refreshing ? 'older' : state.direction, loadMore, loadNewer, key };
}
