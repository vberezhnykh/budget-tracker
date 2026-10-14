import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { readDismissed, reviewMonthFor, shouldShowMonthReview, writeDismissed } from './monthReview';

// Разбор прошлого месяца для карточки на Обзоре. Состояние живёт в App, пока
// приложение открыто: переключение вкладок карточку не пересоздаёт и запрос не
// повторяет. На месяц запрос уходит не больше одного раза за сеанс, в том
// числе после ошибки: сервер может писать разбор несколько секунд, и стучаться
// снова при каждом возвращении на вкладку незачем. Пока идёт запрос, при ошибке
// и когда разбора нет (review: null), карточки нет - ни скелетона, ни сообщения.
//
// «Скрыть» запоминается на устройстве (localStorage, ключ на разбираемый месяц)
// и дополнительно держится в состоянии: если хранилище недоступно, карточка
// всё равно исчезает до перезагрузки.
//
// request - apiFetch приложения: он же отправит на вход, если сессия кончилась.

const FAILED = null;

// Разбор в виде, который рисует карточка, или null, если показывать нечего.
function normalizeReview(payload) {
  const review = payload?.review;
  if (!review || typeof review.headline !== 'string' || review.headline.trim() === '' || !Array.isArray(review.points)) return null;
  const points = review.points
    .filter((point) => point && typeof point.text === 'string' && point.text.trim() !== '')
    .map((point) => ({ text: point.text, category: typeof point.category === 'string' && point.category !== '' ? point.category : null }));
  return points.length > 0 ? { headline: review.headline, points } : null;
}

export default function useMonthReview({ request, enabled, today, timeRange, selectedMonth, selectedAccount, active = true }) {
  const month = reviewMonthFor(today);
  const [reviews, setReviews] = useState({});
  const [dismissedNow, setDismissedNow] = useState(() => new Set());
  const startedRef = useRef(new Set());
  const generationRef = useRef(0);
  const requestRef = useRef(request);
  useEffect(() => {
    requestRef.current = request;
  }, [request]);

  const dismissed = useMemo(() => dismissedNow.has(month) || readDismissed(month), [dismissedNow, month]);
  const visible = shouldShowMonthReview({ enabled, today, timeRange, selectedMonth, selectedAccount, dismissed });

  // active - карточка сейчас на экране (открыт «Обзор»): запрос не тратится
  // на тех, кто сразу ушёл в другую вкладку.
  useEffect(() => {
    if (!visible || !active || startedRef.current.has(month)) return;
    startedRef.current.add(month);
    const generation = generationRef.current;
    (async () => {
      let review = FAILED;
      try {
        const response = await requestRef.current('/api/month-review', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ month, today }),
        });
        if (response.ok) review = normalizeReview(await response.json());
      } catch {
        review = FAILED;
      }
      // Сеанс кончился (выход из аккаунта) - чужой ответ не показываем.
      if (generation === generationRef.current) setReviews((current) => ({ ...current, [month]: review }));
    })();
  }, [visible, active, month, today]);

  const dismiss = useCallback(() => {
    writeDismissed(month);
    setDismissedNow((current) => new Set(current).add(month));
  }, [month]);

  // Выход из аккаунта: разбор - личные данные, сеанс начинается заново.
  const reset = useCallback(() => {
    generationRef.current += 1;
    startedRef.current = new Set();
    setReviews({});
    setDismissedNow(new Set());
  }, []);

  return { month, review: visible ? (reviews[month] ?? null) : null, dismiss, reset };
}
