import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { readApi } from '../server/test/readApi.mjs';
import App from './App';
import { SAVE_BUTTON_NAME } from './test/queries';
import { flushIdle } from './test/idle';
import { withBootstrap, bootstrapCalls, dashboardCalls, analyticsDashboardCalls } from './test/bootstrap';

const accounts = [{ _id: 'card', name: 'Карта', type: 'card' }, { _id: 'cash', name: 'Наличные', type: 'cash' }];
const response = body => ({ ok: true, status: 200, json: async () => body });
let transactions, request;
// Чтения итогов: стартовый снимок (/api/bootstrap) содержит сводку, остальные
// идут отдельно.
const statsCalls = () => request.mock.calls.filter(([url]) => url.startsWith('/api/stats/dashboard?') || url.startsWith('/api/bootstrap?'));
// Справочники читаются только стартовым снимком, отдельных запросов нет.
const expectReferenceDataFromBootstrapOnly = () => {
  expect(request.mock.calls.filter(([url]) => url.startsWith('/api/bootstrap?'))).toHaveLength(1);
  for (const path of ['/api/accounts', '/api/categories', '/api/settings']) {
    expect(request.mock.calls.filter(([url]) => url === path)).toHaveLength(0);
  }
};
const select = name => fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${name}: −?€`) }));
const skeleton = () => screen.queryByRole('status', { name: 'Загрузка итогов…' });
// Лента счетов - только на Обзоре, поэтому к
// Аналитике ходим туда и обратно через нижнюю навигацию.
const goTo = name => fireEvent.click(screen.getByRole('button', { name }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-24T12:00:00Z'));
  transactions = [
    { _id: 'card-expense', title: 'Продукты', amount: 300, type: 'expense', account: 'card', category: 'Еда', date: '2026-09-20' },
    { _id: 'cash-expense', title: 'Кофе', amount: 50, type: 'expense', account: 'cash', category: 'Еда', date: '2026-09-20' },
  ];
  request = vi.fn(withBootstrap(async url => {
    if (url === '/api/accounts') return response(accounts);
    if (url === '/api/categories') return response([{ _id: 'food', name: 'Еда', type: 'expense' }]);
    if (url === '/api/settings') return response({ monthlyLimit: 1200 });
    return response(readApi(url, transactions, accounts) ?? []);
  }));
  vi.stubGlobal('fetch', request);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('instant account summaries', () => {
  it('shows the correct monthly ring on the first account switch without any summary or reference-data requests', async () => {
    render(<App />);
    await screen.findByTestId('accounts-row');
    const count = statsCalls().length;
    select('Наличные');
    expect(skeleton()).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Расход:.*50/ })).toBeVisible();
    select('Карта');
    expect(skeleton()).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Расход:.*300/ })).toBeVisible();
    select('Все счета');
    expect(screen.getByRole('button', { name: /Расход:.*350/ })).toBeVisible();
    await act(async () => {});
    expect(statsCalls()).toHaveLength(count);
    expectReferenceDataFromBootstrapOnly();
  });

  it('loads only analytics for a new selection and instantly reuses visited selections', async () => {
    render(<App />);
    await screen.findByTestId('accounts-row');
    // Все счета: Аналитика уже пришла со стартовым снимком, запроса нет.
    goTo('Аналитика');
    expect(skeleton()).not.toBeInTheDocument();
    expect(statsCalls()).toHaveLength(1);
    goTo('Обзор');
    select('Наличные');
    expect(skeleton()).not.toBeInTheDocument();
    goTo('Аналитика');
    await waitFor(() => expect(skeleton()).not.toBeInTheDocument());
    expect(statsCalls()).toHaveLength(2); // startup (with analytics) + the cash analytics view
    goTo('Обзор');
    select('Все счета');
    expect(skeleton()).not.toBeInTheDocument();
    goTo('Аналитика');
    expect(skeleton()).not.toBeInTheDocument();
    goTo('Обзор');
    select('Наличные');
    expect(skeleton()).not.toBeInTheDocument();
    goTo('Аналитика');
    expect(skeleton()).not.toBeInTheDocument();
    await act(async () => {});
    expect(statsCalls()).toHaveLength(2);
    expectReferenceDataFromBootstrapOnly();
  });

  it('refreshes expired summaries in the background and keeps custom settings', async () => {
    render(<App />);
    await screen.findByTestId('accounts-row');
    select('Наличные');
    const base = request.getMockImplementation();
    let finish;
    request.mockImplementation((url, options) => url.startsWith('/api/stats/dashboard?')
      ? new Promise(resolve => { finish = () => base(url, options).then(resolve); }) : base(url, options));
    vi.setSystemTime(new Date('2026-09-24T12:01:01Z'));
    select('Карта');
    await waitFor(() => expect(finish).toBeDefined());
    expect(skeleton()).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Расход:.*300/ })).toBeVisible();
    transactions[0].amount = 400;
    await act(async () => finish());
    expect(screen.getByRole('button', { name: /Расход:.*400/ })).toBeVisible();
    // Лимит общий и у отдельного счёта не показывается - свой лимит виден у
    // всех счетов.
    select('Все счета');
    expect(await screen.findByRole('button', { name: /Расход:.*лимита.*1\.200/ })).toBeVisible();
  });

  it('refreshes all views on return after expiry, without clearing the visible ring', async () => {
    render(<App />);
    await screen.findByTestId('accounts-row');
    select('Наличные');
    vi.setSystemTime(new Date('2026-09-24T12:01:01Z'));
    transactions[1].amount = 70;
    fireEvent.focus(window);
    expect(skeleton()).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /Расход:.*70/ })).toBeVisible());
    expect(request.mock.calls.filter(([url]) => url.startsWith('/api/bootstrap?'))).toHaveLength(2);
  });

  it('invalidates previously visited analytics after editing an operation', async () => {
    const base = request.getMockImplementation();
    request.mockImplementation((url, options) => {
      if (url === '/api/transactions/cash-expense' && options?.method === 'PUT') {
        const changes = JSON.parse(options.body);
        transactions = transactions.map(t => t._id === 'cash-expense' ? { ...t, ...changes } : t);
        return Promise.resolve(response({ ...changes, _id: 'cash-expense' }));
      }
      return base(url, options);
    });
    render(<App />);
    await screen.findByTestId('accounts-row');
    goTo('Аналитика');
    await waitFor(() => expect(skeleton()).not.toBeInTheDocument());
    goTo('Обзор');
    select('Наличные');
    goTo('Аналитика');
    await waitFor(() => expect(skeleton()).not.toBeInTheDocument());
    goTo('Обзор');
    select('Все счета');
    goTo('История');
    fireEvent.click(await screen.findByRole('button', { name: /^Кофе,/ }));
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '75' } });
    fireEvent.click(screen.getByRole('button', { name: SAVE_BUTTON_NAME }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Редактировать' })).not.toBeInTheDocument());
    goTo('Обзор');
    select('Наличные');
    goTo('Аналитика');
    await waitFor(() => expect(skeleton()).not.toBeInTheDocument());
    expect(statsCalls().filter(([url]) => url.includes('account=cash') && url.includes('analytics=1'))).toHaveLength(2);
    goTo('Обзор');
    expect(screen.getByRole('button', { name: /Расход:.*75/ })).toBeVisible();
  });

  describe('background analytics prefetch', () => {
    // Отдельные запросы /api/stats/dashboard с analytics=1: стартовый снимок
    // просит analytics=1 сам и сюда не входит.
    const analyticsCalls = () => analyticsDashboardCalls(request.mock.calls);

    it('needs no prefetch after startup: the startup snapshot already carries analytics, and the tab opens without a request', async () => {
      render(<App />);
      await screen.findByTestId('accounts-row');
      expect(bootstrapCalls(request.mock.calls)).toHaveLength(1);
      expect(bootstrapCalls(request.mock.calls)[0]).toContain('analytics=1');
      await flushIdle();
      expect(analyticsCalls()).toHaveLength(0);
      const count = statsCalls().length;
      goTo('Аналитика');
      expect(skeleton()).not.toBeInTheDocument();
      await act(async () => {});
      await flushIdle();
      expect(statsCalls()).toHaveLength(count);
      expect(count).toBe(1);
    });

    it('sends the device time zone with the startup snapshot and with summary requests, but keeps it out of the cache key', async () => {
      const timeZone = encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone);
      render(<App />);
      await screen.findByTestId('accounts-row');
      expect(bootstrapCalls(request.mock.calls)[0]).toMatch(new RegExp(`&tz=${timeZone}$`));
      select('Наличные');
      await act(async () => {});
      await flushIdle();
      expect(dashboardCalls(request.mock.calls).length).toBeGreaterThan(0);
      for (const url of dashboardCalls(request.mock.calls)) expect(url).toMatch(new RegExp(`&tz=${timeZone}$`));
      // Вернулись к «Все счета» и снова на «Наличные»: записи в кэше найдены по
      // ключу без tz, новых запросов нет.
      const count = statsCalls().length;
      select('Все счета');
      select('Наличные');
      await act(async () => {});
      await flushIdle();
      expect(statsCalls()).toHaveLength(count);
    });

    it('prefetches for a changed selection and skips keys that are already fresh', async () => {
      render(<App />);
      await screen.findByTestId('accounts-row');
      await flushIdle();
      select('Наличные');
      await act(async () => {});
      await flushIdle();
      expect(analyticsCalls().filter(url => url.includes('account=cash'))).toHaveLength(1);
      // Все счета пришли со стартовым снимком под обоими ключами: подгрузки нет.
      select('Все счета');
      await act(async () => {});
      await flushIdle();
      expect(analyticsCalls()).toHaveLength(1);
    });

    it('after a write the full reload brings analytics again, without showing the old numbers', async () => {
      const base = request.getMockImplementation();
      request.mockImplementation((url, options) => {
        if (url === '/api/transactions/cash-expense' && options?.method === 'PUT') {
          const changes = JSON.parse(options.body);
          transactions = transactions.map(t => t._id === 'cash-expense' ? { ...t, ...changes } : t);
          return Promise.resolve(response({ ...changes, _id: 'cash-expense' }));
        }
        return base(url, options);
      });
      render(<App />);
      await screen.findByTestId('accounts-row');
      await flushIdle();
      expect(bootstrapCalls(request.mock.calls)).toHaveLength(1);
      goTo('История');
      fireEvent.click(await screen.findByRole('button', { name: /^Кофе,/ }));
      fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '75' } });
      fireEvent.click(screen.getByRole('button', { name: SAVE_BUTTON_NAME }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Редактировать' })).not.toBeInTheDocument());
      // Полная перезагрузка сбросила кеш и сама принесла analytics=1: отдельной
      // подгрузки не нужно.
      await waitFor(() => expect(bootstrapCalls(request.mock.calls)).toHaveLength(2));
      expect(bootstrapCalls(request.mock.calls)[1]).toContain('analytics=1');
      await flushIdle();
      expect(analyticsCalls()).toHaveLength(0);
      goTo('Аналитика');
      expect(skeleton()).not.toBeInTheDocument();
    });

    it('stays silent when the prefetch fails', async () => {
      render(<App />);
      await screen.findByTestId('accounts-row');
      const base = request.getMockImplementation();
      request.mockImplementation((url, options) => url.startsWith('/api/stats/dashboard?') && url.includes('analytics=1')
        ? Promise.resolve({ ok: false, status: 500, json: async () => ({ message: 'boom' }) })
        : base(url, options));
      select('Наличные');
      await act(async () => {});
      await flushIdle();
      expect(analyticsCalls()).toHaveLength(1);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.queryByText(/boom/)).not.toBeInTheDocument();
      expect(skeleton()).not.toBeInTheDocument();
    });

    it('does not prefetch while the analytics tab itself is open', async () => {
      window.history.replaceState(null, '', '/#analytics');
      render(<App />);
      await waitFor(() => expect(bootstrapCalls(request.mock.calls)).toHaveLength(1));
      await flushIdle();
      expect(analyticsCalls()).toHaveLength(0);
    });

    it('does not start after unmount', async () => {
      const { unmount } = render(<App />);
      await screen.findByTestId('accounts-row');
      select('Наличные');
      unmount();
      await flushIdle();
      expect(analyticsCalls()).toHaveLength(0);
    });
  });
});
