import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { readApi } from '../server/test/readApi.mjs';
import App from './App';

const accounts = [{ _id: 'card', name: 'Карта', type: 'card' }];
const response = body => ({ ok: true, status: 200, json: async () => body });
let transactions;
let request;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-24T12:00:00Z'));
  transactions = [
    { _id: 'old', title: 'Старая зарплата', amount: 5000, type: 'income', account: 'card', category: 'Работа', date: '2025-12-01' },
    ...Array.from({ length: 85 }, (_, index) => ({ _id: String(index).padStart(3, '0'), title: `Покупка ${index}`, amount: 10, type: 'expense', account: 'card', category: 'Еда', date: '2026-09-20', __v: 4 })),
  ];
  request = vi.fn(async (url, options) => {
    if (url === '/api/accounts') return response(accounts);
    if (url === '/api/categories') return response([{ _id: 'food', name: 'Еда', type: 'expense' }]);
    if (url === '/api/settings') return response({ monthlyLimit: 7000 });
    if (url === '/api/transactions' && !options?.method) return response(transactions);
    const data = readApi(url, transactions, accounts);
    return response(data ?? []);
  });
  vi.stubGlobal('fetch', request);
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function openHistory() {
  await screen.findByTestId('balance-carousel');
  const handle = screen.getByRole('button', { name: 'Открыть список операций' });
  fireEvent.pointerDown(handle, { pointerId: 1, clientY: 200 });
  fireEvent.pointerUp(handle, { pointerId: 1, clientY: 200 });
  await screen.findByText('Покупка 84');
  return within(screen.getByTestId('transactions-drawer'));
}

describe('lazy budget reads', () => {
  it('loads 40 operations while totals include the whole ledger, then appends on demand', async () => {
    render(<App />);
    const drawer = await openHistory();
    expect(drawer.getAllByRole('button', { name: /^Покупка \d+,/ })).toHaveLength(40);
    expect(screen.getAllByText(/4\.150/).length).toBeGreaterThan(0);
    expect(drawer.getByText('-850.00€')).toBeInTheDocument();
    expect(request.mock.calls.some(([url]) => url === '/api/transactions')).toBe(false);
    expect(request.mock.calls.some(([url]) => url.includes('analytics=1'))).toBe(false);

    fireEvent.click(drawer.getByRole('button', { name: 'Загрузить еще' }));
    await waitFor(() => expect(drawer.getAllByRole('button', { name: /^Покупка \d+,/ })).toHaveLength(80));
    expect(drawer.getByText('-850.00€')).toBeInTheDocument();
    expect(screen.getAllByText(/4\.150/).length).toBeGreaterThan(0);
    fireEvent.click(drawer.getByRole('button', { name: 'Загрузить еще' }));
    await waitFor(() => expect(drawer.getAllByRole('button', { name: /^Покупка \d+,/ })).toHaveLength(85));
    expect(drawer.queryByRole('button', { name: 'Загрузить еще' })).not.toBeInTheDocument();
    fireEvent.click(drawer.getByRole('button', { name: /^Покупка 0,/ }));
    expect(screen.getByRole('dialog', { name: 'Редактировать' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('0.00')).toHaveValue(10);
  });

  it('searches older unloaded operations and delays detailed analytics until its tab opens', async () => {
    render(<App />);
    const drawer = await openHistory();
    fireEvent.change(drawer.getByPlaceholderText(/Поиск/), { target: { value: 'Старая' } });
    expect(await drawer.findByText('Старая зарплата')).toBeInTheDocument();
    expect(drawer.getByText('Результаты поиска (1)')).toBeInTheDocument();
    const handle = screen.getByRole('button', { name: 'Закрыть список операций' });
    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 200 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientY: 200 });
    fireEvent.click(screen.getByRole('button', { name: /Аналитика/ }));
    await waitFor(() => expect(request.mock.calls.some(([url]) => url.includes('analytics=1'))).toBe(true));
  });

  it('exports the entire ledger only after an explicit click', async () => {
    let exported;
    const createObjectURL = vi.fn(blob => { exported = blob; return 'blob:export'; });
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = createObjectURL;
      static revokeObjectURL() {}
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<App />);
    const drawer = await openHistory();
    expect(request.mock.calls.some(([url]) => url === '/api/transactions')).toBe(false);
    fireEvent.click(drawer.getByRole('button', { name: 'Экспорт' }));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    const text = await new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsText(exported);
    });
    expect(text).toContain('Старая зарплата');
    expect(text.split('\n')).toHaveLength(87);
  });

  it('can display summaries while the first history page is still pending', async () => {
    const base = request.getMockImplementation();
    let finishHistory;
    request.mockImplementation((url, options) => url.startsWith('/api/history?')
      ? new Promise(resolve => { finishHistory = () => resolve(response(readApi(url, transactions, accounts))); })
      : base(url, options));
    render(<App />);
    await screen.findByTestId('balance-carousel');
    expect(screen.getAllByText(/4\.150/).length).toBeGreaterThan(0);
    await waitFor(() => expect(finishHistory).toBeDefined());
    await act(async () => finishHistory());
  });
});
