import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { insertRecentTransaction } from './recentInsert';
import { applyListRemovals } from './listRemoval';
import { applyListEdits, NO_EDITS } from './listEdit';

const EMPTY = {};
const NO_IDS = new Set();
const NO_ENTRIES = [];
// Потолок месяца для вставки: лента с all=1 не режется по месяцам и страницам.
const NO_MONTH_CAP = '9999-12';
// Сколько фильтров держим в памяти: вернуться на только что виденный список
// надо мгновенно, но каждый занимает до нескольких МБ объектов.
const MAX_KEYS = 8;
// Поиск плодит ключи (по одному на запрос) и не должен вытеснять фильтры,
// к которым возвращаются, поэтому поисковых записей в кэше не больше трёх.
const MAX_SEARCH_KEYS = 3;
const LOAD_ERROR = 'Не удалось загрузить операции. Повторите попытку.';

const isSearchKey = key => /[?&]q=/.test(key);

// Адрес запроса и он же ключ кэша: только фильтры. Месяц в него не входит - он
// решает лишь, где в готовом списке встать экрану, а не что запрашивать.
export function historyKey({ account, category, type, q } = {}) {
  const params = new URLSearchParams({ continuous: '1', all: '1' });
  if (account) params.set('account', account);
  if (category) params.set('category', category);
  if (type) params.set('type', type);
  const query = typeof q === 'string' ? q.trim() : '';
  if (query) params.set('q', query);
  return `/api/history?${params}`;
}

// Вся лента под фильтр одним запросом (`all=1`, ~60 КБ в сжатом виде на ~2000
// операций) и кэш последних 8 ключей в памяти.
//
// - Ключ в кэше: показываем сразу. Если запись снята на более старой ревизии
//   (после записи операции), обновляем в фоне и не убираем данные (refreshing).
// - Нового ключа в кэше нет: loading, пустой список и скелетон.
// - Смена ключа обрывает запрос предыдущего; опоздавший ответ может осесть в
//   кэше под своим ключом, но для текущего не показывается. Ответ кладётся с
//   той ревизией, на которой он был запрошен, поэтому ответ до записи не
//   выдаётся за свежий.
// - Выход (enabled=false) стирает весь кэш: это чужие личные данные.
// - Ошибка не убирает данные, если они есть; retry() запрашивает заново.
//
// inserts / edits / removals - только что сохранённые `{ saved, untilRevision }`,
// изменённые `{ id, saved, seq, untilRevision }` и удалённые
// `{ id, splitId, untilRevision }` операции (App ведёт их, как и для «Последних
// операций»). Пока на экране запись, снятая раньше untilRevision, список правится
// на месте, не дожидаясь ответа сервера: удалённая строка остаётся и значится в
// leavingIds (её сворачивает TransactionList), сумма дня уже без неё; сохранённая
// вставляется на своё место и значится в freshIds; изменённая показывает новые
// данные и значится в editedIds, а при смене даты остается на старом месте
// призраком и вырастает в новом дне (см. listEdit.js).
// Удаления не зависят от фильтра, а вставка - только в список без фильтра по
// категории, типу и поиска (иначе непонятно, подходит ли ему новая операция).
// Правка знает фильтры (счёт, категория, тип) и сама решает, остается ли строка
// в списке; под поиском не применяется - совпадение с запросом не проверить.
// В остальных случаях строку принесёт обычное обновление.
export default function useHistoryList({ filters, enabled, revision, request, searching, inserts = NO_ENTRIES, edits = NO_ENTRIES, removals = NO_ENTRIES }) {
  const key = historyKey(filters);
  const [cache, setCache] = useState(() => new Map());
  const [attempt, setAttempt] = useState(0);
  const [failure, setFailure] = useState(null);
  // Зеркало кэша для эффекта запроса: ему нужно знать, есть ли свежая запись,
  // но перезапускаться на каждое её обновление он не должен.
  const cacheRef = useRef(cache);
  const generation = useRef(0);
  const usedRef = useRef(new Map());
  const tick = useRef(0);
  const currentKey = useRef(key);

  useEffect(() => {
    cacheRef.current = cache;
  }, [cache]);

  const touch = useCallback(target => {
    tick.current += 1;
    usedRef.current.set(target, tick.current);
  }, []);

  // Запись в кэш с вытеснением самых давно использованных ключей. Текущий ключ
  // не вытесняется никогда, а старая ревизия не затирает более новую.
  const put = useCallback((target, entry) => {
    setCache(previous => {
      const existing = previous.get(target);
      if (existing && existing.revision > entry.revision) return previous;
      const next = new Map(previous);
      next.set(target, entry);
      touch(target);
      const evict = candidates => {
        const victim = candidates
          .filter(name => name !== target && name !== currentKey.current)
          .sort((a, b) => (usedRef.current.get(a) || 0) - (usedRef.current.get(b) || 0))[0];
        if (victim === undefined) return false;
        next.delete(victim);
        usedRef.current.delete(victim);
        return true;
      };
      while ([...next.keys()].filter(isSearchKey).length > MAX_SEARCH_KEYS && evict([...next.keys()].filter(isSearchKey)));
      while (next.size > MAX_KEYS && evict([...next.keys()]));
      return next;
    });
  }, [touch]);

  useEffect(() => {
    currentKey.current = key;
    if (!enabled) {
      // Выход: список прошлого пользователя не должен пережить сессию.
      generation.current += 1;
      usedRef.current.clear();
      setCache(previous => (previous.size ? new Map() : previous));
      return undefined;
    }
    touch(key);
    const entry = cacheRef.current.get(key);
    if (entry && entry.revision >= revision) return undefined;

    const controller = new AbortController();
    const epoch = generation.current;
    let timer;
    const start = async () => {
      try {
        const response = await request(key, { signal: controller.signal });
        const body = await response.json();
        if (!response.ok || !body?.transactions || typeof body.transactions !== 'object'
          || !Number.isInteger(body.count) || body.complete !== true) throw new Error(LOAD_ERROR);
        if (epoch !== generation.current) return;
        put(key, { data: body, revision });
      } catch (error) {
        if (controller.signal.aborted || error?.name === 'AbortError' || epoch !== generation.current) return;
        setFailure({ key, revision, attempt, message: LOAD_ERROR });
      }
    };
    if (searching) timer = setTimeout(start, 250);
    else start();
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [enabled, key, revision, attempt, request, searching, put, touch]);

  const retry = useCallback(() => setAttempt(value => value + 1), []);
  // clearPrivateData: сбросить кэш, не дожидаясь выхода, и запросить текущий
  // список заново (attempt перезапускает эффект).
  const reset = useCallback(() => {
    generation.current += 1;
    usedRef.current.clear();
    setCache(new Map());
    setFailure(null);
    setAttempt(value => value + 1);
  }, []);

  const entry = enabled ? cache.get(key) : undefined;

  // Правки поверх записи кэша. Сам кэш остаётся ответом сервера: правки живут
  // только до ответа ревизии untilRevision и новее.
  const { account: filterAccount, category, type, q } = filters || {};
  const hasQuery = typeof q === 'string' && q.trim() !== '';
  const insertable = !category && !type && !hasQuery;
  const entryRevision = entry?.revision;
  const entryGroups = entry?.data.transactions;
  const edited = useMemo(() => {
    if (!entryGroups) return { groups: EMPTY, freshIds: NO_IDS, leavingIds: NO_IDS, editedIds: NO_EDITS };
    let groups = entryGroups;
    const freshIds = new Set();
    if (insertable) {
      for (const { saved, untilRevision } of inserts) {
        if (untilRevision <= entryRevision) continue;
        const result = insertRecentTransaction(groups, saved, { month: NO_MONTH_CAP, account: filterAccount || null, limit: Infinity });
        if (result.id === null) continue;
        groups = result.groups;
        freshIds.add(result.id);
      }
    }
    let editedIds = NO_EDITS;
    if (!hasQuery) {
      const applied = applyListEdits(groups, edits.filter(edit => edit.untilRevision > entryRevision), {
        month: NO_MONTH_CAP, account: filterAccount || null, category: category || null, type: type || null, limit: Infinity,
      });
      groups = applied.groups;
      editedIds = applied.editedIds;
      for (const id of applied.freshIds) freshIds.add(id);
    }
    const removed = applyListRemovals(groups, removals.filter(removal => removal.untilRevision > entryRevision));
    return { groups: removed.groups, freshIds: freshIds.size > 0 ? freshIds : NO_IDS, leavingIds: removed.leavingIds, editedIds };
  }, [entryGroups, entryRevision, insertable, hasQuery, inserts, edits, removals, filterAccount, category, type]);
  const failed = enabled && failure !== null && failure.key === key
    && failure.revision === revision && failure.attempt === attempt;
  return {
    transactions: edited.groups,
    freshIds: edited.freshIds,
    leavingIds: edited.leavingIds,
    editedIds: edited.editedIds,
    count: entry?.data.count ?? 0,
    loading: enabled && !entry && !failed,
    // Данные есть, но сняты до последней записи: показываем их и обновляем.
    refreshing: enabled && Boolean(entry) && entry.revision < revision && !failed,
    error: failed ? failure.message : '',
    retry,
    reset,
    dataKey: key,
  };
}
