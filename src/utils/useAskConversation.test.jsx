import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useAskConversation from './useAskConversation';

const encoder = new TextEncoder();

// Ответ, тело которого можно выдавать кусками по ходу теста. Прерывание запроса
// (signal) обрывает чтение так же, как это делает fetch.
function stream(signal) {
  const chunks = [];
  let wake = null;
  let closed = false;
  const reader = {
    async read() {
      for (;;) {
        if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
        if (chunks.length) return { done: false, value: encoder.encode(chunks.shift()) };
        if (closed) return { done: true, value: undefined };
        await new Promise((resolve) => { wake = resolve; });
      }
    },
    cancel: async () => {},
  };
  signal?.addEventListener('abort', () => wake?.());
  return {
    response: { ok: true, status: 200, body: { getReader: () => reader } },
    send(...events) {
      chunks.push(events.map((event) => `${JSON.stringify(event)}\n`).join(''));
      wake?.();
    },
    end() {
      closed = true;
      wake?.();
    },
  };
}

const ANSWER = {
  type: 'answer',
  blocks: [{ type: 'text', text: 'Ушло **€18**.' }],
  basis: 'Кафе, сентябрь 2026',
  history: { category: 'Кафе', account: null, type: 'expense', month: '2026-09' },
};

// request отдаёт заранее подготовленные потоки по очереди.
function setup() {
  const streams = [];
  const request = vi.fn((url, options) => {
    const next = stream(options.signal);
    streams.push(next);
    return Promise.resolve(next.response);
  });
  const hook = renderHook(() => useAskConversation({ request }));
  return { ...hook, request, streams };
}

const lastTurn = (result) => result.current.turns.at(-1);

describe('useAskConversation', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 12, 12));
  });
  afterEach(() => vi.useRealTimers());

  it('sends the question with today\'s date and shows steps as they arrive, then the answer', async () => {
    const { result, request, streams } = setup();

    act(() => { expect(result.current.send('  Сколько на кафе?  ')).toBe(true); });
    expect(request).toHaveBeenCalledTimes(1);
    const [url, options] = request.mock.calls[0];
    expect(url).toBe('/api/ask');
    expect(options.method).toBe('POST');
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(options.body)).toEqual({ messages: [{ role: 'user', text: 'Сколько на кафе?' }], today: '2026-10-12' });
    expect(lastTurn(result)).toMatchObject({ question: 'Сколько на кафе?', status: 'working', steps: [] });
    expect(result.current.busy).toBe(true);

    await act(async () => { streams[0].send({ type: 'step', label: 'Кафе, сентябрь 2026' }); });
    await waitFor(() => expect(lastTurn(result).steps).toEqual([{ label: 'Кафе, сентябрь 2026', done: false }]));

    await act(async () => { streams[0].send({ type: 'step_done' }, { type: 'step', label: 'Остатки по счетам' }); });
    await waitFor(() => expect(lastTurn(result).steps).toEqual([
      { label: 'Кафе, сентябрь 2026', done: true },
      { label: 'Остатки по счетам', done: false },
    ]));

    await act(async () => { streams[0].send({ type: 'step_done' }, ANSWER); });
    await waitFor(() => expect(lastTurn(result).status).toBe('done'));
    expect(lastTurn(result).answer).toEqual({ blocks: ANSWER.blocks, basis: ANSWER.basis, history: ANSWER.history });
    expect(lastTurn(result).steps.every((step) => step.done)).toBe(true);
    expect(result.current.busy).toBe(false);
  });

  it('ignores too short questions and a second question while one is being answered', async () => {
    const { result, request } = setup();
    act(() => { expect(result.current.send(' я ')).toBe(false); });
    act(() => { expect(result.current.send(undefined)).toBe(false); });
    expect(request).not.toHaveBeenCalled();

    act(() => { result.current.send('Первый?'); });
    act(() => { expect(result.current.send('Второй?')).toBe(false); });
    expect(request).toHaveBeenCalledTimes(1);
    expect(result.current.turns).toHaveLength(1);
  });

  it('sends earlier finished answers as plain text with the next question', async () => {
    const { result, request, streams } = setup();
    act(() => { result.current.send('Первый вопрос'); });
    await act(async () => { streams[0].send({ ...ANSWER, blocks: [{ type: 'text', text: 'Первый ответ' }, { type: 'table', columns: ['М', 'Сумма'], rows: [['Июнь', '€5']] }] }); });
    await waitFor(() => expect(lastTurn(result).status).toBe('done'));

    act(() => { result.current.send('Второй вопрос'); });
    expect(JSON.parse(request.mock.calls[1][1].body).messages).toEqual([
      { role: 'user', text: 'Первый вопрос' },
      { role: 'assistant', text: 'Первый ответ\n\nМ | Сумма\nИюнь | €5' },
      { role: 'user', text: 'Второй вопрос' },
    ]);
  });

  it('turns an error event into an error turn with the server message', async () => {
    const { result, streams } = setup();
    act(() => { result.current.send('Вопрос'); });
    await act(async () => {
      streams[0].send({ type: 'step', label: 'Расходы, 2026 год' }, { type: 'error', code: 'ASK_TIMEOUT', message: 'Claude не ответил вовремя.' });
    });
    await waitFor(() => expect(lastTurn(result).status).toBe('error'));
    expect(lastTurn(result)).toMatchObject({ error: 'Claude не ответил вовремя.', answer: null });
    expect(lastTurn(result).steps).toEqual([{ label: 'Расходы, 2026 год', done: true }]);
    expect(result.current.busy).toBe(false);
  });

  it('shows the server message of a non-2xx JSON response, or a fallback', async () => {
    const responses = [
      { ok: false, status: 429, json: async () => ({ code: 'ASK_RATE_LIMITED', message: 'Дневной лимит вопросов исчерпан.' }) },
      { ok: false, status: 502, json: async () => { throw new Error('not json'); } },
    ];
    const request = vi.fn(async () => responses.shift());
    const { result } = renderHook(() => useAskConversation({ request }));

    act(() => { result.current.send('Первый вопрос'); });
    await waitFor(() => expect(lastTurn(result).status).toBe('error'));
    expect(lastTurn(result).error).toBe('Дневной лимит вопросов исчерпан.');

    act(() => { result.current.retry(lastTurn(result).id); });
    await waitFor(() => expect(lastTurn(result).error).toBe('Сервер не смог ответить. Попробуйте ещё раз.'));
  });

  it('reports a network failure and a stream that ends without an answer', async () => {
    const request = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockImplementationOnce(async (url, options) => {
        const cut = stream(options.signal);
        cut.send({ type: 'step', label: 'Остатки по счетам' });
        cut.end();
        return cut.response;
      });
    const { result } = renderHook(() => useAskConversation({ request }));

    act(() => { result.current.send('Вопрос'); });
    await waitFor(() => expect(lastTurn(result).error).toMatch(/Нет связи с сервером/));

    act(() => { result.current.retry(lastTurn(result).id); });
    await waitFor(() => expect(lastTurn(result).error).toBe('Ответ оборвался. Попробуйте ещё раз.'));
    expect(lastTurn(result).steps).toEqual([{ label: 'Остатки по счетам', done: true }]);
  });

  it('treats an answer without readable blocks as an error', async () => {
    const { result, streams } = setup();
    act(() => { result.current.send('Вопрос'); });
    await act(async () => { streams[0].send({ type: 'answer', blocks: [], basis: '', history: null }); });
    await waitFor(() => expect(lastTurn(result).status).toBe('error'));
  });

  it('retry asks the same question again in place, with the same earlier history', async () => {
    const { result, request, streams } = setup();
    act(() => { result.current.send('Первый вопрос'); });
    await act(async () => { streams[0].send(ANSWER); });
    await waitFor(() => expect(lastTurn(result).status).toBe('done'));
    act(() => { result.current.send('Второй вопрос'); });
    await act(async () => { streams[1].send({ type: 'error', code: 'ASK_FAILED', message: 'Не удалось связаться с Claude.' }); });
    await waitFor(() => expect(lastTurn(result).status).toBe('error'));

    const failedId = lastTurn(result).id;
    act(() => { expect(result.current.retry(failedId)).toBe(true); });
    expect(result.current.turns).toHaveLength(2);
    expect(lastTurn(result)).toMatchObject({ id: failedId, question: 'Второй вопрос', status: 'working', steps: [], error: null });
    expect(JSON.parse(request.mock.calls[2][1].body).messages.map((message) => message.text)).toEqual(['Первый вопрос', 'Ушло **€18**.', 'Второй вопрос']);

    await act(async () => { streams[2].send(ANSWER); });
    await waitFor(() => expect(lastTurn(result).status).toBe('done'));
  });

  it('retry only works for the last failed question', async () => {
    const { result, request, streams } = setup();
    act(() => { result.current.send('Первый вопрос'); });
    await act(async () => { streams[0].send({ type: 'error', message: 'Ошибка' }); });
    await waitFor(() => expect(lastTurn(result).status).toBe('error'));
    const firstId = lastTurn(result).id;
    act(() => { result.current.send('Второй вопрос'); });
    await act(async () => { streams[1].send(ANSWER); });
    await waitFor(() => expect(lastTurn(result).status).toBe('done'));

    act(() => { expect(result.current.retry(firstId)).toBe(false); });
    act(() => { expect(result.current.retry(lastTurn(result).id)).toBe(false); });
    expect(request).toHaveBeenCalledTimes(2);
    // Неудавшийся вопрос в историю следующего не попадает
    act(() => { result.current.send('Третий вопрос'); });
    expect(JSON.parse(request.mock.calls[2][1].body).messages.map((message) => message.text)).toEqual(['Второй вопрос', 'Ушло **€18**.', 'Третий вопрос']);
  });

  it('stop aborts the request, removes the question and hands its text back', async () => {
    const { result, streams } = setup();
    expect(result.current.stop()).toBeNull();

    act(() => { result.current.send('Долгий вопрос'); });
    await act(async () => { streams[0].send({ type: 'step', label: 'Расходы, 2026 год' }); });
    await waitFor(() => expect(lastTurn(result).steps).toHaveLength(1));

    let returned;
    act(() => { returned = result.current.stop(); });
    expect(returned).toBe('Долгий вопрос');
    expect(result.current.turns).toEqual([]);
    expect(result.current.busy).toBe(false);

    // Поздние события и ошибка прерывания ничего не возвращают
    await act(async () => { streams[0].send(ANSWER); });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current.turns).toEqual([]);
  });

  it('after stop a new question can be asked', async () => {
    const { result, request, streams } = setup();
    act(() => { result.current.send('Долгий вопрос'); });
    act(() => { result.current.stop(); });
    act(() => { expect(result.current.send('Новый вопрос')).toBe(true); });
    expect(request).toHaveBeenCalledTimes(2);
    await act(async () => { streams[1].send(ANSWER); });
    await waitFor(() => expect(lastTurn(result).status).toBe('done'));
    expect(result.current.turns).toHaveLength(1);
  });

  it('reset clears the conversation and aborts what is running', async () => {
    const { result, request, streams } = setup();
    act(() => { result.current.send('Первый вопрос'); });
    await act(async () => { streams[0].send(ANSWER); });
    await waitFor(() => expect(lastTurn(result).status).toBe('done'));
    act(() => { result.current.send('Второй вопрос'); });

    act(() => { result.current.reset(); });
    expect(result.current.turns).toEqual([]);
    expect(request.mock.calls[1][1].signal.aborted).toBe(true);

    await act(async () => { streams[1].send(ANSWER); });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current.turns).toEqual([]);

    act(() => { result.current.send('После сброса'); });
    expect(JSON.parse(request.mock.calls[2][1].body).messages).toEqual([{ role: 'user', text: 'После сброса' }]);
  });

  it('aborts the running request on unmount', () => {
    const { result, request, unmount } = setup();
    act(() => { result.current.send('Вопрос'); });
    unmount();
    expect(request.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it('never writes the conversation to browser storage', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const { result, streams } = setup();
    act(() => { result.current.send('Вопрос'); });
    await act(async () => { streams[0].send(ANSWER); });
    await waitFor(() => expect(lastTurn(result).status).toBe('done'));
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });
});
