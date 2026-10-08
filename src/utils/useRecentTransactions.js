import { useCallback, useEffect, useState } from 'react';

const EMPTY = {};

// Последние операции для блока на Обзоре: первая страница той же ленты, что и
// в Истории (`/api/history?continuous=1`), но на 5 строк и со своим запросом.
// История листает постранично и держит курсоры, а здесь нужна одна маленькая
// выборка, поэтому usePagedHistory не подходит: у него общий с Историей
// фильтр, а счёт Обзора - отдельное состояние (см. docs/REDESIGN-PLAN.md).
//
// Перезапрашивается при смене месяца/счёта и при росте revision - тот же
// счётчик, которым App обновляет Историю после записи. На смену revision
// старый список остаётся на экране, пока идёт запрос: после сохранения
// операции скелетон вместо списка мигал бы без причины. На смену счёта или
// месяца список другой, и показывать чужой нельзя - тут скелетон.
export default function useRecentTransactions({ enabled, request, month, account, revision, limit = 5 }) {
  // attempt - ручной «Повторить»: тот же запрос, но ключ новый.
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({ key: null, url: null, groups: EMPTY, error: false });

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
        setState({ key, url, groups: body.transactions, error: false });
      } catch (error) {
        if (controller.signal.aborted || error?.name === 'AbortError') return;
        setState({ key, url, groups: EMPTY, error: true });
      }
    })();
    return () => controller.abort();
  }, [enabled, request, url, key]);

  const retry = useCallback(() => setAttempt(value => value + 1), []);

  if (!enabled) return { groups: EMPTY, loading: false, error: false, retry };
  if (state.key === key) return { groups: state.groups, loading: false, error: state.error, retry };
  // Идёт запрос по тому же адресу (ревизия выросла после записи) - до ответа
  // показываем прежний список, а не скелетон.
  if (state.url === url && !state.error) return { groups: state.groups, loading: false, error: false, retry };
  return { groups: EMPTY, loading: true, error: false, retry };
}
