import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { readApi } from '../server/test/readApi.mjs';
import App from './App';
import { SAVE_BUTTON_NAME } from './test/queries';

const accounts = [{ _id: 'card', name: 'Карта', type: 'card' }, { _id: 'cash', name: 'Наличные', type: 'cash' }];
const response = body => ({ ok: true, status: 200, json: async () => body });
let transactions, request;
const statsCalls = () => request.mock.calls.filter(([url]) => url.startsWith('/api/stats/dashboard?'));
const select = name => fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${name}: €`) }));
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
  request = vi.fn(async url => {
    if (url === '/api/accounts') return response(accounts);
    if (url === '/api/categories') return response([{ _id: 'food', name: 'Еда', type: 'expense' }]);
    if (url === '/api/settings') return response({ monthlyLimit: 1200 });
    return response(readApi(url, transactions, accounts) ?? []);
  });
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
    for (const path of ['/api/accounts', '/api/categories', '/api/settings']) {
      expect(request.mock.calls.filter(([url]) => url === path)).toHaveLength(1);
    }
  });

  it('loads only analytics for a new selection and instantly reuses visited selections', async () => {
    render(<App />);
    await screen.findByTestId('accounts-row');
    goTo('Аналитика');
    await waitFor(() => expect(skeleton()).not.toBeInTheDocument());
    goTo('Обзор');
    select('Наличные');
    expect(skeleton()).not.toBeInTheDocument();
    goTo('Аналитика');
    await waitFor(() => expect(skeleton()).not.toBeInTheDocument());
    expect(statsCalls()).toHaveLength(3); // startup + two analytics views
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
    expect(statsCalls()).toHaveLength(3);
    for (const path of ['/api/accounts', '/api/categories', '/api/settings']) {
      expect(request.mock.calls.filter(([url]) => url === path)).toHaveLength(1);
    }
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
    expect(screen.getByRole('button', { name: /Расход:.*400.*лимита.*1\.200/ })).toBeVisible();
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
    expect(request.mock.calls.filter(([url]) => url === '/api/settings')).toHaveLength(2);
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
});
