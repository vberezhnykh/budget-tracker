import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

Element.prototype.scrollIntoView = vi.fn();

const ok = (body, status = 200) => Promise.resolve({ ok: true, status, json: () => Promise.resolve(body) });
const missing = (message) => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ message }) });
const copy = (value) => JSON.parse(JSON.stringify(value));

function makeApi(overrides = {}) {
  const state = {
    accounts: [{ _id: 'card', name: 'Карта', type: 'card', icon: '💳', order: 0 }],
    categories: [{ _id: 'food', name: 'Еда', type: 'expense', order: 0 }],
    transactions: [
      { _id: 'income', __v: 0, title: 'Доход', amount: 1000, type: 'income', account: 'card', category: 'Доход', date: '2026-09-01T00:00:00.000Z' },
      { _id: 'expense', __v: 0, title: 'Кофе', description: 'Кофе утром', amount: 50, type: 'expense', account: 'card', category: 'Еда', date: '2026-09-03T00:00:00.000Z' },
    ],
    planned: [{ _id: 'plan', __v: 0, title: 'Интернет', amount: 30, dueDate: '2026-09-20T00:00:00.000Z', account: 'card', category: 'Еда', description: '', status: 'pending' }],
    trash: [],
    ...overrides,
  };

  const fetch = vi.fn(async (url, options = {}) => {
    const method = options.method || 'GET';
    if (url === '/api/accounts' && method === 'GET') return ok(copy(state.accounts));
    if (url === '/api/categories' && method === 'GET') return ok(copy(state.categories));
    if (url === '/api/settings' && method === 'GET') return ok({ monthlyLimit: 7000 });
    if (url === '/api/transactions' && method === 'GET') return ok(copy(state.transactions));
    if (url === '/api/planned-payments' && method === 'GET') return ok(copy(state.planned));
    if (url === '/api/trash' && method === 'GET') return ok(copy(state.trash));

    if (url === '/api/planned-payments' && method === 'POST') {
      const input = JSON.parse(options.body);
      const saved = { _id: `plan-${state.planned.length + 1}`, __v: 0, status: 'pending', ...input, dueDate: `${input.dueDate}T00:00:00.000Z` };
      state.planned.push(saved);
      return ok(saved, 201);
    }
    if (url.startsWith('/api/planned-payments/') && url.endsWith('/pay') && method === 'POST') {
      const id = url.split('/')[3];
      const payment = state.planned.find(item => item._id === id);
      if (!payment) return missing('Платёж не найден');
      const input = JSON.parse(options.body);
      let transaction;
      if (input.transactionId) {
        transaction = state.transactions.find(item => item._id === input.transactionId);
      } else {
        transaction = {
          _id: `paid-${id}`, __v: 0, title: payment.title, description: payment.description,
          amount: input.amount, type: 'expense', account: input.account, category: input.category,
          date: `${input.date}T00:00:00.000Z`,
        };
        state.transactions.push(transaction);
      }
      Object.assign(payment, {
        __v: payment.__v + 1,
        status: 'paid',
        transactionId: transaction._id,
        paidAt: transaction.date,
        transactionSummary: { amount: transaction.amount, date: transaction.date, account: transaction.account, category: transaction.category },
      });
      return ok({ payment, transaction, replayed: false });
    }
    if (url.startsWith('/api/planned-payments/') && method === 'PUT') {
      const id = url.split('/')[3];
      const payment = state.planned.find(item => item._id === id);
      if (!payment) return missing('Платёж не найден');
      const input = JSON.parse(options.body);
      delete input.__v;
      Object.assign(payment, input, { __v: payment.__v + 1 });
      return ok(payment);
    }

    if (url.startsWith('/api/transactions/') && method === 'DELETE') {
      const id = url.split('/')[3].split('?')[0];
      const index = state.transactions.findIndex(item => item._id === id);
      if (index < 0) return missing('Операция не найдена');
      const [transaction] = state.transactions.splice(index, 1);
      const group = { id, deletionBatchId: `batch-${id}`, deletedAt: new Date().toISOString(), count: 1, transactions: [transaction] };
      state.trash.push(group);
      state.planned.forEach(payment => {
        if (payment.transactionId === id) payment.transactionDeleted = true;
      });
      return ok({ trashId: id, count: 1 });
    }
    if (url.startsWith('/api/trash/') && url.endsWith('/restore') && method === 'POST') {
      const id = url.split('/')[3];
      const index = state.trash.findIndex(group => group.id === id);
      if (index < 0) return missing('Группа не найдена');
      const [group] = state.trash.splice(index, 1);
      state.transactions.push(...group.transactions);
      state.planned.forEach(payment => {
        if (group.transactions.some(transaction => transaction._id === payment.transactionId)) payment.transactionDeleted = false;
      });
      return ok({ count: group.count });
    }
    if (url.startsWith('/api/trash/') && method === 'DELETE') {
      const id = url.split('/')[3];
      const index = state.trash.findIndex(group => group.id === id);
      if (index < 0) return missing('Группа не найдена');
      const [group] = state.trash.splice(index, 1);
      state.planned.forEach(payment => {
        if (group.transactions.some(transaction => transaction._id === payment.transactionId)) {
          Object.assign(payment, { status: 'pending', transactionId: undefined, paidAt: undefined, transactionDeleted: false, transactionSummary: undefined, __v: payment.__v + 1 });
        }
      });
      return ok({ count: group.count });
    }
    if (url === '/api/logout') return ok({ ok: true });
    return ok({});
  });

  return { state, fetch };
}

function openDrawer() {
  const handle = screen.getByRole('button', { name: 'Открыть список операций' });
  fireEvent.pointerDown(handle, { pointerId: 1, clientY: 200 });
  fireEvent.pointerUp(handle, { pointerId: 1, clientY: 200 });
}

async function openTrash() {
  fireEvent.click(screen.getByTitle('Настройки'));
  fireEvent.click(await screen.findByRole('button', { name: /Корзина операций/ }));
  return screen.findByRole('dialog', { name: 'Корзина операций' });
}

describe('App phase 2 flows', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 5, 12));
    vi.stubGlobal('confirm', vi.fn(() => true));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('creates a plan without changing the balance, then paying it creates one expense', async () => {
    const api = makeApi();
    vi.stubGlobal('fetch', api.fetch);
    render(<App />);
    await screen.findByTestId('balance-carousel');
    expect(screen.getAllByText(/950,00/)[0]).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Платежи/ }));
    fireEvent.click(screen.getByRole('button', { name: '+ Добавить' }));
    const createDialog = screen.getByRole('dialog', { name: 'Добавить предстоящий платёж' });
    fireEvent.change(within(createDialog).getByPlaceholderText('Например, аренда'), { target: { value: 'Страховка' } });
    fireEvent.change(within(createDialog).getByLabelText('Плановая сумма, €'), { target: { value: '100' } });
    fireEvent.change(within(createDialog).getByLabelText('Дата платежа'), { target: { value: '2026-09-25' } });
    fireEvent.click(within(createDialog).getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(api.fetch).toHaveBeenCalledWith('/api/planned-payments', expect.objectContaining({ method: 'POST' })));
    expect(api.state.planned.map(payment => payment.title)).toContain('Страховка');
    expect(await screen.findByText('Страховка')).toBeInTheDocument();
    expect(api.state.transactions).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: /Главная/ }));
    expect(screen.getAllByText(/950,00/)[0]).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Платежи/ }));
    const insurance = screen.getByText('Страховка').closest('article');
    fireEvent.click(within(insurance).getByRole('button', { name: 'Оплатить' }));
    const payDialog = screen.getByRole('dialog', { name: 'Оплатить: Страховка' });
    fireEvent.click(within(payDialog).getByRole('button', { name: 'Создать расход и оплатить' }));

    await waitFor(() => expect(api.state.transactions).toHaveLength(3));
    expect(api.state.planned.find(payment => payment.title === 'Страховка').status).toBe('paid');
    fireEvent.click(screen.getByRole('button', { name: /Главная/ }));
    expect(screen.getAllByText(/850,00/)[0]).toBeInTheDocument();
  });

  it('links an existing expense without creating a duplicate transaction', async () => {
    const api = makeApi();
    vi.stubGlobal('fetch', api.fetch);
    render(<App />);
    await screen.findByTestId('balance-carousel');
    fireEvent.click(screen.getByRole('button', { name: /Платежи/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Оплатить' }));
    const dialog = screen.getByRole('dialog', { name: 'Оплатить: Интернет' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Уже учтён' }));
    fireEvent.change(within(dialog).getByLabelText('Уже учтённый расход'), { target: { value: 'expense' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Связать с расходом' }));

    await waitFor(() => expect(api.state.planned[0].status).toBe('paid'));
    expect(api.state.transactions).toHaveLength(2);
    expect(api.state.planned[0].transactionId).toBe('expense');
  });

  it('soft-deletes an expense and restores it from the Undo toast', async () => {
    const api = makeApi();
    vi.stubGlobal('fetch', api.fetch);
    render(<App />);
    await screen.findByTestId('balance-carousel');
    openDrawer();
    fireEvent.click(screen.getByRole('button', { name: /Кофе утром/ }));
    const dialog = screen.getByRole('dialog', { name: 'Редактировать' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Удалить операцию' }));

    expect(await screen.findByText(/^В корзине/)).toBeInTheDocument();
    expect(api.state.transactions.some(transaction => transaction._id === 'expense')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Отменить' }));
    await waitFor(() => expect(api.state.transactions.some(transaction => transaction._id === 'expense')).toBe(true));
    expect(screen.queryByText(/^В корзине/)).not.toBeInTheDocument();
  });

  it('keeps a newer deletion toast when an older Undo request finishes later', async () => {
    const api = makeApi({
      transactions: [
        { _id: 'expense-a', __v: 0, title: 'Расход A', description: 'Первый расход', amount: 10, type: 'expense', account: 'card', category: 'Еда', date: '2026-09-03' },
        { _id: 'expense-b', __v: 0, title: 'Расход B', description: 'Второй расход', amount: 20, type: 'expense', account: 'card', category: 'Еда', date: '2026-09-04' },
      ],
    });
    const baseFetch = api.fetch.getMockImplementation();
    let finishFirstUndo;
    api.fetch.mockImplementation((url, options) => {
      if (url === '/api/trash/expense-a/restore' && options?.method === 'POST') {
        return new Promise(resolve => {
          finishFirstUndo = () => {
            const index = api.state.trash.findIndex(group => group.id === 'expense-a');
            const [group] = api.state.trash.splice(index, 1);
            api.state.transactions.push(...group.transactions);
            resolve({ ok: true, status: 200, json: () => Promise.resolve({ count: 1 }) });
          };
        });
      }
      return baseFetch(url, options);
    });
    vi.stubGlobal('fetch', api.fetch);
    render(<App />);
    await screen.findByTestId('balance-carousel');
    openDrawer();

    fireEvent.click(screen.getByRole('button', { name: /Первый расход/ }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Редактировать' })).getByRole('button', { name: 'Удалить операцию' }));
    await screen.findByText(/^В корзине/);
    fireEvent.click(screen.getByRole('button', { name: 'Отменить' }));
    expect(screen.getByRole('button', { name: 'Восстановление...' })).toBeDisabled();

    fireEvent.click(await screen.findByRole('button', { name: /Второй расход/ }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Редактировать' })).getByRole('button', { name: 'Удалить операцию' }));
    await waitFor(() => expect(api.state.trash.some(group => group.id === 'expense-b')).toBe(true));
    expect(screen.getByRole('button', { name: 'Отменить' })).toBeInTheDocument();

    await act(async () => finishFirstUndo());
    await waitFor(() => expect(api.state.transactions.some(transaction => transaction._id === 'expense-a')).toBe(true));
    expect(screen.getByText(/^В корзине/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Отменить' })).toBeInTheDocument();
  });

  it('loads persisted trash after a remount, restores one group and permanently deletes another', async () => {
    const deletedA = { _id: 'old-a', title: 'Старый расход', amount: 20, type: 'expense', account: 'card', category: 'Еда', date: '2026-08-01' };
    const deletedB = { _id: 'old-b', title: 'Связанный расход', amount: 30, type: 'expense', account: 'card', category: 'Еда', date: '2026-08-02' };
    const api = makeApi({
      planned: [{ _id: 'paid-plan', __v: 1, title: 'Интернет', amount: 30, dueDate: '2026-08-02', account: 'card', category: 'Еда', status: 'paid', transactionId: 'old-b', transactionDeleted: true, transactionSummary: { amount: 30, date: '2026-08-02', account: 'card', category: 'Еда' } }],
      trash: [
        { id: 'old-a', deletionBatchId: 'batch-a', deletedAt: '2026-09-01T10:00:00.000Z', count: 1, transactions: [deletedA] },
        { id: 'old-b', deletionBatchId: 'batch-b', deletedAt: '2026-09-02T10:00:00.000Z', count: 1, transactions: [deletedB] },
      ],
    });
    vi.stubGlobal('fetch', api.fetch);
    const first = render(<App />);
    await screen.findByTestId('balance-carousel');
    first.unmount();

    render(<App />);
    await screen.findByTestId('balance-carousel');
    const trashDialog = await openTrash();
    expect(within(trashDialog).getByText('Старый расход')).toBeInTheDocument();
    expect(within(trashDialog).getByText('Связанный расход')).toBeInTheDocument();

    const oldA = within(trashDialog).getByText('Старый расход').closest('article');
    fireEvent.click(within(oldA).getByRole('button', { name: 'Восстановить' }));
    await waitFor(() => expect(api.state.trash).toHaveLength(1));

    const oldB = within(screen.getByRole('dialog', { name: 'Корзина операций' })).getByText('Связанный расход').closest('article');
    fireEvent.click(within(oldB).getByRole('button', { name: 'Удалить навсегда' }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('вернётся в ожидающие'));
    await waitFor(() => expect(api.state.trash).toHaveLength(0));
    expect(api.state.planned[0].status).toBe('pending');
  });

  it('ignores a delayed trash body after the sheet is closed and reopened', async () => {
    let resolveOldBody;
    const oldBody = new Promise(resolve => { resolveOldBody = resolve; });
    let trashGets = 0;
    const api = makeApi();
    const baseFetch = api.fetch.getMockImplementation();
    api.fetch.mockImplementation((url, options) => {
      if (url === '/api/trash' && (!options || !options.method)) {
        trashGets += 1;
        if (trashGets === 1) return Promise.resolve({ ok: true, status: 200, json: () => oldBody });
        return ok([{ id: 'fresh', deletedAt: '2026-09-05T10:00:00Z', count: 1, transactions: [{ _id: 'fresh', title: 'Свежая операция', amount: 1 }] }]);
      }
      return baseFetch(url, options);
    });
    vi.stubGlobal('fetch', api.fetch);
    render(<App />);
    await screen.findByTestId('balance-carousel');
    await openTrash();
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть корзину' }));
    const reopened = await openTrash();
    expect(await within(reopened).findByText('Свежая операция')).toBeInTheDocument();

    await act(async () => {
      resolveOldBody([{ id: 'stale', deletedAt: '2026-09-01T10:00:00Z', count: 1, transactions: [{ _id: 'stale', title: 'Чужая старая операция', amount: 1 }] }]);
    });
    expect(within(reopened).queryByText('Чужая старая операция')).not.toBeInTheDocument();
    expect(within(reopened).getByText('Свежая операция')).toBeInTheDocument();
  });
});
