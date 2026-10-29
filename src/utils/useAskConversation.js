import { useCallback, useEffect, useRef, useState } from 'react';
import { buildAskMessages, normalizeAnswer } from './askConversation';
import { toLocalDateInput } from './period';
import { readNdjson } from './readNdjson';

// Разговор «Вопросы к данным». Живёт в состоянии приложения, пока оно открыто:
// из чата можно уйти в Историю и вернуться, разговор на месте. Нигде не
// сохраняется (ни localStorage, ни sessionStorage), а при выходе из
// аккаунта сбрасывается.
//
// Вопрос - «ход»: { id, question, status: 'working' | 'done' | 'error', steps,
// answer, error }. Шаги приходят по мере того, как сервер вызывает инструменты
// (step, step_done); ответ или ошибка закрывают ход.
//
// request - apiFetch приложения: он же отправит на вход, если сессия кончилась.

const NETWORK_MESSAGE = 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.';
const INTERRUPTED_MESSAGE = 'Ответ оборвался. Попробуйте ещё раз.';
const FAILED_MESSAGE = 'Сервер не смог ответить. Попробуйте ещё раз.';
const UNREADABLE_MESSAGE = 'Не получилось ответить. Попробуйте спросить иначе.';

const newTurn = (id, question) => ({ id, question, status: 'working', steps: [], answer: null, error: null });
const finishSteps = (steps) => steps.map((step) => (step.done ? step : { ...step, done: true }));

export default function useAskConversation({ request }) {
  const [turns, setTurns] = useState([]);
  // Актуальный список для обработчиков: из состояния его брать нельзя, оно
  // отстаёт до следующего рендера, а вопросы могут идти подряд.
  const turnsRef = useRef([]);
  const controllerRef = useRef(null);
  const nextIdRef = useRef(1);
  const requestRef = useRef(request);
  useEffect(() => {
    requestRef.current = request;
  }, [request]);

  const commit = useCallback((update) => {
    turnsRef.current = update(turnsRef.current);
    setTurns(turnsRef.current);
  }, []);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const run = useCallback(async (id, messages) => {
    const controller = new AbortController();
    controllerRef.current = controller;
    // Запрос устарел, если его остановили, сбросили разговор или начали другой.
    const isCurrent = () => controllerRef.current === controller && !controller.signal.aborted;
    const patch = (change) => {
      if (isCurrent()) commit((list) => list.map((turn) => (turn.id === id ? change(turn) : turn)));
    };
    const fail = (message) => patch((turn) => ({ ...turn, status: 'error', error: message, steps: finishSteps(turn.steps) }));

    let closed = false;
    try {
      const response = await requestRef.current('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, today: toLocalDateInput() }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        closed = true;
        fail(typeof payload?.message === 'string' && payload.message ? payload.message : FAILED_MESSAGE);
        return;
      }

      for await (const event of readNdjson(response)) {
        if (!isCurrent()) return;
        if (event.type === 'step' && typeof event.label === 'string') {
          patch((turn) => ({ ...turn, steps: [...turn.steps, { label: event.label, done: false }] }));
        } else if (event.type === 'step_done') {
          patch((turn) => {
            const index = turn.steps.map((step) => step.done).lastIndexOf(false);
            return index < 0 ? turn : { ...turn, steps: turn.steps.map((step, at) => (at === index ? { ...step, done: true } : step)) };
          });
        } else if (event.type === 'answer') {
          const answer = normalizeAnswer(event);
          closed = true;
          if (answer) patch((turn) => ({ ...turn, status: 'done', answer, steps: finishSteps(turn.steps) }));
          else fail(UNREADABLE_MESSAGE);
          break;
        } else if (event.type === 'error') {
          closed = true;
          fail(typeof event.message === 'string' && event.message ? event.message : FAILED_MESSAGE);
          break;
        }
      }
      // Поток кончился без ответа и без ошибки: прокси оборвал или сервер упал.
      if (!closed) fail(INTERRUPTED_MESSAGE);
    } catch {
      if (!controller.signal.aborted) fail(NETWORK_MESSAGE);
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }, [commit]);

  // Задаёт вопрос. Возвращает false, если вопрос не ушёл: пустой, слишком
  // короткий или предыдущий ещё считается.
  const send = useCallback((question) => {
    const text = typeof question === 'string' ? question.trim() : '';
    if (text.length < 2 || turnsRef.current.some((turn) => turn.status === 'working')) return false;
    const messages = buildAskMessages(turnsRef.current, text);
    const id = nextIdRef.current;
    nextIdRef.current += 1;
    commit((list) => [...list, newTurn(id, text)]);
    run(id, messages);
    return true;
  }, [commit, run]);

  // «Повторить»: тот же вопрос на месте неудавшегося. Только для последнего хода.
  const retry = useCallback((id) => {
    const last = turnsRef.current.at(-1);
    if (!last || last.id !== id || last.status !== 'error') return false;
    const messages = buildAskMessages(turnsRef.current.slice(0, -1), last.question);
    commit((list) => list.map((turn) => (turn.id === id ? newTurn(id, last.question) : turn)));
    run(id, messages);
    return true;
  }, [commit, run]);

  // «Остановить»: запрос отменяется, ход (вопрос и пузырь ожидания) убирается,
  // ничего вместо него не показывается. Текст вопроса возвращается, чтобы его
  // можно было поправить и отправить снова.
  const stop = useCallback(() => {
    const working = turnsRef.current.find((turn) => turn.status === 'working');
    if (!working) return null;
    controllerRef.current?.abort();
    controllerRef.current = null;
    commit((list) => list.filter((turn) => turn.id !== working.id));
    return working.question;
  }, [commit]);

  // «Новый разговор» и выход из аккаунта.
  const reset = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    commit(() => []);
  }, [commit]);

  return { turns, busy: turns.some((turn) => turn.status === 'working'), send, retry, stop, reset };
}
