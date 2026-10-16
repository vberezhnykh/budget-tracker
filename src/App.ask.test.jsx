import { readApi } from '../server/test/readApi.mjs';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

Element.prototype.scrollIntoView = vi.fn();

const encoder = new TextEncoder();
const ok = (body) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });

const accounts = [{ _id: 'card', name: 'Карта', type: 'card', icon: '💳', order: 0 }];
const categories = [
  { _id: 'cafe', name: 'Кафе', type: 'expense', order: 0 },
  { _id: 'food', name: 'Еда', type: 'expense', order: 1 },
];
const transactions = [
  { _id: 't1', __v: 0, title: 'Кафе', description: 'Латте', amount: 5, type: 'expense', account: 'card', category: 'Кафе', date: '2026-08-10T00:00:00.000Z' },
  { _id: 't2', __v: 0, title: 'Еда', description: 'Продукты', amount: 40, type: 'expense', account: 'card', category: 'Еда', date: '2026-08-12T00:00:00.000Z' },
];

// Поток ответа /api/ask, который выдаётся кусками из теста.
function askStream(signal) {
  const chunks = [];
  let wake = null;
  const reader = {
    async read() {
      for (;;) {
        if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
        if (chunks.length) return { done: false, value: encoder.encode(chunks.shift()) };
        await new Promise((resolve) => { wake = resolve; });
      }
    },
    cancel: async () => {},
  };
  signal?.addEventListener('abort', () => wake?.());
  return {
    response: { ok: true, status: 200, body: { getReader: () => reader } },
    send: (...events) => {
      chunks.push(events.map((event) => `${JSON.stringify(event)}\n`).join(''));
      wake?.();
    },
  };
}

function setupApi({ features } = {}) {
  const streams = [];
  const fetch = vi.fn(async (url, options = {}) => {
    const method = options.method || 'GET';
    if (url === '/api/ask') {
      const next = askStream(options.signal);
      streams.push(next);
      return next.response;
    }
    const data = method === 'GET' ? readApi(url, transactions, accounts) : undefined;
    if (data !== undefined) return ok(data);
    if (url === '/api/accounts') return ok(accounts);
    if (url === '/api/categories') return ok(categories);
    if (url === '/api/settings') return ok({ monthlyLimit: 7000, ...(features ? { features } : {}) });
    if (url === '/api/transactions') return ok(transactions);
    if (url === '/api/trash') return ok([]);
    return ok({});
  });
  vi.stubGlobal('fetch', fetch);
  return { fetch, streams };
}

const nav = () => within(screen.getByRole('navigation', { name: 'Основная навигация' }));

async function openAnalytics() {
  await screen.findByTestId('accounts-row');
  fireEvent.click(nav().getByRole('button', { name: 'Аналитика' }));
  await screen.findByRole('heading', { level: 1, name: 'Аналитика' });
}

const ANSWER = {
  type: 'answer',
  blocks: [
    { type: 'text', text: 'На кафе в августе ушло **€5**.' },
    { type: 'table', columns: ['Месяц', 'Сумма'], rows: [['Август', '€5']] },
  ],
  basis: 'Кафе, август 2026',
  history: { category: 'Кафе', account: null, type: 'expense', month: '2026-08' },
};

describe('Вопросы к данным в приложении', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 5, 12));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('без features.ask на Аналитике нет входа в чат и чат по адресу не открывается', async () => {
    setupApi({ features: { quickEntry: true } });
    window.history.replaceState(null, '', '/#analytics/ask');
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: 'Аналитика' });
    expect(screen.queryByRole('region', { name: 'Вопрос к своим данным' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Вопросы к данным' })).not.toBeInTheDocument();
  });

  it('карточка появляется по features.ask; подсказка открывает чат и сразу задаёт вопрос', async () => {
    const { fetch, streams } = setupApi({ features: { ask: true } });
    render(<App />);
    await openAnalytics();
    expect(screen.getByRole('button', { name: 'Спросить о своих расходах' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Сколько ушло на кафе?' }));

    await screen.findByRole('heading', { level: 1, name: 'Вопросы к данным' });
    expect(window.location.hash).toBe('#analytics/ask');
    expect(nav().getByRole('button', { name: 'Аналитика' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('log', { name: 'Разговор' })).toHaveTextContent('Сколько ушло на кафе?');

    const askCalls = fetch.mock.calls.filter(([url]) => url === '/api/ask');
    expect(askCalls).toHaveLength(1);
    expect(JSON.parse(askCalls[0][1].body)).toEqual({ messages: [{ role: 'user', text: 'Сколько ушло на кафе?' }], today: '2026-09-05' });

    // Шаги появляются, пока Claude ещё считает
    await act(async () => { streams[0].send({ type: 'step', label: 'Кафе, август 2026' }); });
    expect(await within(screen.getByRole('status')).findByText('Кафе, август 2026')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Остановить' })).toBeInTheDocument();

    await act(async () => { streams[0].send({ type: 'step_done' }, ANSWER); });
    const answer = await screen.findByRole('article', { name: 'Ответ' });
    expect(within(answer).getByRole('table')).toBeInTheDocument();
    expect(within(answer).getByRole('columnheader', { name: 'Месяц' })).toHaveAttribute('scope', 'col');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('«Открыть в Истории» ставит фильтры и месяц и переключает вкладку; разговор остаётся', async () => {
    const { fetch, streams } = setupApi({ features: { ask: true } });
    render(<App />);
    await openAnalytics();
    fireEvent.click(screen.getByRole('button', { name: 'Спросить о своих расходах' }));
    const field = await screen.findByRole('textbox', { name: 'Вопрос' });
    fireEvent.change(field, { target: { value: 'Сколько ушло на кафе в августе?' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Вопрос' }));
    await waitFor(() => expect(streams).toHaveLength(1));
    await act(async () => { streams[0].send(ANSWER); });

    fireEvent.click(await screen.findByRole('button', { name: 'Открыть в Истории' }));

    expect(nav().getByRole('button', { name: 'История' })).toHaveAttribute('aria-current', 'page');
    expect(window.location.hash).toBe('#history');
    await waitFor(() => {
      const historyUrls = fetch.mock.calls.map(([url]) => url).filter((url) => url.startsWith('/api/history'));
      const params = new URL(historyUrls.at(-1), 'http://localhost').searchParams;
      expect(params.get('category')).toBe('Кафе');
      expect(params.get('all')).toBe('1');
      expect(params.get('month')).toBeNull();
      expect(params.get('type')).toBe('expense');
      expect(params.get('account')).toBeNull();
    });
    // Месяц ответа - якорь экрана, а не часть запроса.
    expect(screen.getByTestId('history-scroll').querySelector('[data-history-month]')).toHaveAttribute('data-history-month', '2026-08');
    await waitFor(() => expect(screen.queryByText('Загрузка операций…')).not.toBeInTheDocument());
    expect(await screen.findByText('Латте')).toBeInTheDocument();
    expect(screen.queryByText('Продукты')).not.toBeInTheDocument();

    // Назад в Аналитику и в чат: вопрос и ответ на месте, новый запрос не уходил
    fireEvent.click(nav().getByRole('button', { name: 'Аналитика' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Спросить о своих расходах' }));
    const log = await screen.findByRole('log', { name: 'Разговор' });
    expect(log).toHaveTextContent('Сколько ушло на кафе в августе?');
    expect(within(log).getByRole('article', { name: 'Ответ' })).toBeInTheDocument();
    expect(fetch.mock.calls.filter(([url]) => url === '/api/ask')).toHaveLength(1);

    // «Новый разговор» очищает
    fireEvent.click(screen.getByRole('button', { name: 'Новый разговор' }));
    expect(screen.queryByRole('article', { name: 'Ответ' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Примеры вопросов' })).toBeInTheDocument();
  });

  it('уход на другую вкладку во время ответа не обрывает его', async () => {
    const { streams } = setupApi({ features: { ask: true } });
    render(<App />);
    await openAnalytics();
    fireEvent.click(screen.getByRole('button', { name: 'Что выросло за месяц?' }));
    await waitFor(() => expect(streams).toHaveLength(1));

    fireEvent.click(nav().getByRole('button', { name: 'Обзор' }));
    await act(async () => { streams[0].send(ANSWER); });
    fireEvent.click(nav().getByRole('button', { name: 'Аналитика' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Спросить о своих расходах' }));

    expect(await screen.findByRole('article', { name: 'Ответ' })).toBeInTheDocument();
  });

  it('«Назад» из чата возвращает на Аналитику', async () => {
    const { streams } = setupApi({ features: { ask: true } });
    render(<App />);
    await openAnalytics();
    fireEvent.click(screen.getByRole('button', { name: 'Спросить о своих расходах' }));
    await screen.findByRole('heading', { level: 1, name: 'Вопросы к данным' });
    expect(streams).toHaveLength(0);

    fireEvent.click(within(screen.getByRole('main')).getByRole('button', { name: 'Аналитика' }));
    await screen.findByRole('heading', { level: 1, name: 'Аналитика' });
    await waitFor(() => expect(window.location.hash).toBe('#analytics'));
  });
});
