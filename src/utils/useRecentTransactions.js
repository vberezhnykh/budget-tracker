import { useCallback, useEffect, useMemo, useState } from 'react';
import { insertRecentTransaction } from './recentInsert';

const EMPTY = {};
const NO_IDS = new Set();
const NO_INSERTS = [];

// Последние операции для блока на Обзоре: первая страница той же ленты, что и
// в Истории (`/api/history?continuous=1`), но на 5 строк и со своим запросом.
// История грузит всю ленту под свой фильтр (useHistoryList, all=1), а здесь
// нужна одна маленькая выборка в 5 строк со счётом Обзора - отдельным
// состоянием (см. docs/REDESIGN-PLAN.md), поэтому свой запрос в постраничном
// режиме.
//
// Перезапрашивается при смене месяца/счёта и при росте revision - тот же
// счётчик, которым App обновляет Историю после записи. На смену revision
// старый список остаётся на экране, пока идёт запрос: после сохранения
// операции скелетон вместо списка мигал бы без причины. На смену счёта или
// месяца список другой, и показывать чужой нельзя - тут скелетон.
//
// inserts - только что сохранённые операции `{ saved, untilRevision }` (ответ
// POST и ревизия, с которой уйдёт обновляющий запрос). Пока на экране список,
// загруженный раньше этой ревизии, они вставляются в него сверху (см.
// recentInsert.js), чтобы новая строка была видна сразу, а не после ответа
// сервера. Как только приходит список ревизии untilRevision и новее, он уже
// содержит операцию, и вставка отбрасывается. Скелетон и ошибку вставки не
// трогают: показывать нечего или нечем. freshIds - id вставленных строк,
// их список анимирует появление.
export default function useRecentTransactions({ enabled, request, month, account, revision, inserts = NO_INSERTS, limit = 5 }) {
  // attempt - ручной «Повторить»: тот же запрос, но ключ новый.
  const [attempt, setAttempt] = useState(0);
  // revision в состоянии - ревизия, с которой загружен список: по ней видно,
  // какие вставки он уже включает.
  const [state, setState] = useState({ key: null, url: null, revision: -1, groups: EMPTY, error: false });

  const params = new URLSearchParams({ month, continuous: '1', limit: String(limit) });
  if (account) params.set('account', account);
  const url = `/api/history?${params}`;
  const key = `${revision}:${attempt}:${url}`;

  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    (async () => {
      try {
        const response = await request(url, { signal: controller.signal });
        const body = await response.json();
        if (!response.ok || !body?.transactions || typeof body.transactions !== 'object') {
          throw new Error('Не удалось загрузить операции');
        }
        if (controller.signal.aborted) return;
        setState({ key, url, revision, groups: body.transactions, error: false });
      } catch (error) {
        if (controller.signal.aborted || error?.name === 'AbortError') return;
        setState({ key, url, revision, groups: EMPTY, error: true });
      }
    })();
    return () => controller.abort();
  }, [enabled, request, url, key, revision]);

  const retry = useCallback(() => setAttempt(value => value + 1), []);

  // Что на экране: ответ на текущий запрос, а при росте ревизии (тот же адрес)
  // - прежний список, пока идёт новый. Скелетон и ошибка - без данных.
  const current = state.key === key;
  const showing = enabled && (current ? !state.error : state.url === url && !state.error);

  const shown = useMemo(() => {
    if (!showing) return { groups: state.groups, freshIds: NO_IDS };
    let groups = state.groups;
    const freshIds = new Set();
    for (const { saved, untilRevision } of inserts) {
      if (untilRevision <= state.revision) continue;
      const result = insertRecentTransaction(groups, saved, { month, account, limit });
      if (result.id === null) continue;
      groups = result.groups;
      freshIds.add(result.id);
    }
    return freshIds.size > 0 ? { groups, freshIds } : { groups: state.groups, freshIds: NO_IDS };
  }, [showing, state.groups, state.revision, inserts, month, account, limit]);

  if (!enabled) return { groups: EMPTY, freshIds: NO_IDS, loading: false, error: false, retry };
  if (current) return { ...shown, loading: false, error: state.error, retry };
  // Идёт запрос по тому же адресу (ревизия выросла после записи) - до ответа
  // показываем прежний список, а не скелетон.
  if (showing) return { ...shown, loading: false, error: false, retry };
  return { groups: EMPTY, freshIds: NO_IDS, loading: true, error: false, retry };
}
