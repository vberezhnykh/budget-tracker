import { readApi } from '../server/test/readApi.mjs';
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
    trash: [],
    ...overrides,
  };

  const fetch = vi.fn(async (url, options = {}) => {
    const method = options.method || 'GET';
    const data = method === 'GET' ? readApi(url, state.transactions, state.accounts) : undefined;
    if (data !== undefined) return ok(data);
    if (url === '/api/accounts' && method === 'GET') return ok(copy(state.accounts));
    if (url === '/api/categories' && method === 'GET') return ok(copy(state.categories));
    if (url === '/api/settings' && method === 'GET') return ok({ monthlyLimit: 7000 });
    if (url === '/api/transactions' && method === 'GET') return ok(copy(state.transactions));
    if (url === '/api/trash' && method === 'GET') return ok(copy(state.trash));

    if (url.startsWith('/api/transactions/') && method === 'DELETE') {
      const id = url.split('/')[3].split('?')[0];
      const index = state.transactions.findIndex(item => item._id === id);
      if (index < 0) return missing('Операция не найдена');
      const [transaction] = state.transactions.splice(index, 1);
      const group = { id, deletionBatchId: `batch-${id}`, deletedAt: new Date().toISOString(), count: 1, transactions: [transaction] };
      state.trash.push(group);
      return ok({ trashId: id, count: 1 });
    }
    if (url.startsWith('/api/trash/') && url.endsWith('/restore') && method === 'POST') {
      const id = url.split('/')[3];
      const index = state.trash.findIndex(group => group.id === id);
      if (index < 0) return missing('Группа не найдена');
      const [group] = state.trash.splice(index, 1);
      state.transactions.push(...group.transactions);
      return ok({ count: group.count });
    }
    if (url.startsWith('/api/trash/') && method === 'DELETE') {
      const id = url.split('/')[3];
      const index = state.trash.findIndex(group => group.id === id);
      if (index < 0) return missing('Группа не найдена');
      const [group] = state.trash.splice(index, 1);
      return ok({ count: group.count });
    }
    if (url === '/api/logout') return ok({ ok: true });
    return ok({});
  });

  return { state, fetch };
}

async function openHistory() {
  fireEvent.click(screen.getByRole('button', { name: 'История' }));
  await waitFor(() => expect(screen.queryByText('Загрузка операций…')).not.toBeInTheDocument());
}

// Корзина - строка на экране «Ещё», открывается внутренним экраном.
const nav = () => within(screen.getByRole('navigation', { name: 'Основная навигация' }));

async function openTrash() {
  fireEvent.click(nav().getByRole('button', { name: 'Ещё' }));
  fireEvent.click(await screen.findByRole('button', { name: /^Корзина/ }));
  await screen.findByRole('heading', { level: 1, name: 'Корзина' });
  return screen.getByRole('main');
}

// Назад из внутреннего экрана: кнопка в шапке подписана «Ещё».
function backToMore() {
  fireEvent.click(within(screen.getByRole('main')).getByRole('button', { name: 'Ещё' }));
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

  it('shows four tabs and the add button, and does not load planned payments', async () => {
    const api = makeApi();
    vi.stubGlobal('fetch', api.fetch);
    render(<App />);
    await screen.findByTestId('accounts-row');
    const nav = screen.getByRole('navigation', { name: 'Основная навигация' });
    expect(within(nav).getAllByRole('button').map(button => button.getAttribute('aria-label') || button.textContent))
      .toEqual(['Обзор', 'История', 'Добавить операцию', 'Аналитика', 'Ещё']);
    expect(within(nav).queryByRole('button', { name: /Платежи/ })).not.toBeInTheDocument();
    fireEvent.click(within(nav).getByRole('button', { name: /Аналитика/ }));
    expect(within(nav).getByRole('button', { name: /Аналитика/ })).toHaveAttribute('aria-current', 'page');
    fireEvent.click(within(nav).getByRole('button', { name: 'Обзор' }));
    // На Обзоре вместо трёх быстрых кнопок - секция счетов; добавляет «+» внизу.
    expect(screen.getByRole('heading', { level: 2, name: 'Счета' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Добавить перевод' })).not.toBeInTheDocument();
    expect(api.fetch.mock.calls.some(([url]) => url.startsWith('/api/planned-payments'))).toBe(false);
  });

  it('soft-deletes an expense and restores it from the Undo toast', async () => {
    const api = makeApi();
    vi.stubGlobal('fetch', api.fetch);
    render(<App />);
    await screen.findByTestId('accounts-row');
    await openHistory();
    fireEvent.click(screen.getByRole('button', { name: /Кофе утром/ }));
    const dialog = screen.getByRole('dialog', { name: 'Редактировать' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Удалить операцию' }));

    expect(await screen.findByText(/^Операция в корзине/)).toBeInTheDocument();
    expect(api.state.transactions.some(transaction => transaction._id === 'expense')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Отменить' }));
    await waitFor(() => expect(api.state.transactions.some(transaction => transaction._id === 'expense')).toBe(true));
    expect(screen.queryByText(/^Операция в корзине/)).not.toBeInTheDocument();
  });

  // Удаляет «Кофе утром» из Истории и возвращает тост с «Отменить», который
  // после этого висит над нижней панелью.
  async function deleteCoffee(api) {
    vi.stubGlobal('fetch', api.fetch);
    render(<App />);
    await screen.findByTestId('accounts-row');
    await openHistory();
    fireEvent.click(screen.getByRole('button', { name: /Кофе утром/ }));
    const dialog = screen.getByRole('dialog', { name: 'Редактировать' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Удалить операцию' }));
    return (await screen.findByRole('button', { name: 'Отменить' })).closest('[role]');
  }

  it('shows the deletion as a status toast above the bottom bar', async () => {
    const toast = await deleteCoffee(makeApi());
    expect(toast).toHaveTextContent('Операция в корзине');
    expect(toast).toHaveAttribute('role', 'status');
    expect(toast.style.bottom).toBe('88px');
    expect(within(toast).getByRole('button', { name: 'Отменить' })).toBeEnabled();
  });

  it('counts the operations when a whole group went to the trash', async () => {
    const api = makeApi();
    const baseFetch = api.fetch.getMockImplementation();
    api.fetch.mockImplementation((url, options = {}) => {
      if (url.startsWith('/api/transactions/') && options.method === 'DELETE') {
        return baseFetch(url, options).then(() => ok({ trashId: 'expense', count: 3 }));
      }
      return baseFetch(url, options);
    });
    await deleteCoffee(api);
    expect(screen.getByText('В корзине операций: 3')).toBeInTheDocument();
  });

  it('turns the toast into a danger alert with the reason when the Undo request fails, and lets retry', async () => {
    const api = makeApi();
    const baseFetch = api.fetch.getMockImplementation();
    let failRestore = true;
    api.fetch.mockImplementation((url, options = {}) => {
      if (failRestore && url === '/api/trash/expense/restore' && options.method === 'POST') {
        return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
      }
      return baseFetch(url, options);
    });
    await deleteCoffee(api);
    fireEvent.click(screen.getByRole('button', { name: 'Отменить' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Не удалось восстановить. Попробуйте ещё раз.');
    // Кнопка снова доступна: ошибку можно повторить.
    failRestore = false;
    fireEvent.click(within(alert).getByRole('button', { name: 'Отменить' }));
    await waitFor(() => expect(api.state.transactions.some(transaction => transaction._id === 'expense')).toBe(true));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('stacks a notice above the deletion toast instead of covering it', async () => {
    const api = makeApi();
    const baseFetch = api.fetch.getMockImplementation();
    api.fetch.mockImplementation((url, options = {}) => (url === '/api/logout'
      ? Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) })
      : baseFetch(url, options)));
    const undoToast = await deleteCoffee(api);

    fireEvent.click(nav().getByRole('button', { name: 'Ещё' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Выйти' }));
    const notice = await screen.findByRole('alert');

    expect(notice).toHaveTextContent('Не удалось выйти. Попробуйте ещё раз.');
    expect(undoToast).toBeInTheDocument();
    expect(Number.parseInt(notice.style.bottom, 10)).toBe(Number.parseInt(undoToast.style.bottom, 10) + 64);
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
    await screen.findByTestId('accounts-row');
    await openHistory();

    fireEvent.click(screen.getByRole('button', { name: /Первый расход/ }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Редактировать' })).getByRole('button', { name: 'Удалить операцию' }));
    await screen.findByText(/^Операция в корзине/);
    fireEvent.click(screen.getByRole('button', { name: 'Отменить' }));
    expect(screen.getByRole('button', { name: 'Восстановление…' })).toBeDisabled();

    fireEvent.click(await screen.findByRole('button', { name: /Второй расход/ }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Редактировать' })).getByRole('button', { name: 'Удалить операцию' }));
    await waitFor(() => expect(api.state.trash.some(group => group.id === 'expense-b')).toBe(true));
    expect(screen.getByRole('button', { name: 'Отменить' })).toBeInTheDocument();

    await act(async () => finishFirstUndo());
    await waitFor(() => expect(api.state.transactions.some(transaction => transaction._id === 'expense-a')).toBe(true));
    expect(screen.getByText(/^Операция в корзине/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Отменить' })).toBeInTheDocument();
  });

  it('loads persisted trash after a remount, counts it on «Ещё», restores one group and permanently deletes another', async () => {
    const deletedA = { _id: 'old-a', title: 'Старый расход', amount: 20, type: 'expense', account: 'card', category: 'Еда', date: '2026-08-01' };
    const deletedB = { _id: 'old-b', title: 'Связанный расход', amount: 30, type: 'expense', account: 'card', category: 'Еда', date: '2026-08-02' };
    const api = makeApi({
      trash: [
        { id: 'old-a', deletionBatchId: 'batch-a', deletedAt: '2026-09-01T10:00:00.000Z', count: 1, transactions: [deletedA] },
        { id: 'old-b', deletionBatchId: 'batch-b', deletedAt: '2026-09-02T10:00:00.000Z', count: 1, transactions: [deletedB] },
      ],
    });
    vi.stubGlobal('fetch', api.fetch);
    const first = render(<App />);
    await screen.findByTestId('accounts-row');
    first.unmount();

    render(<App />);
    await screen.findByTestId('accounts-row');
    // Пока «Ещё» не открывали, корзину никто не читал.
    expect(api.fetch.mock.calls.some(([url]) => url === '/api/trash')).toBe(false);

    // Счётчик на строке меню появляется после чтения корзины.
    fireEvent.click(nav().getByRole('button', { name: 'Ещё' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /^Корзина/ })).toHaveTextContent(/2$/));

    const trash = await openTrash();
    expect(window.location.hash).toBe('#more/trash');
    expect(within(trash).getByText('Старый расход')).toBeInTheDocument();
    expect(within(trash).getByText('Связанный расход')).toBeInTheDocument();

    const oldA = within(trash).getByText('Старый расход').closest('article');
    fireEvent.click(within(oldA).getByRole('button', { name: 'Восстановить' }));
    await waitFor(() => expect(api.state.trash).toHaveLength(1));
    await waitFor(() => expect(within(screen.getByRole('main')).queryByText('Старый расход')).not.toBeInTheDocument());

    // Удаление навсегда подтверждается в карточке; системный confirm не нужен.
    const oldB = within(screen.getByRole('main')).getByText('Связанный расход').closest('article');
    fireEvent.click(within(oldB).getByRole('button', { name: /^Удалить навсегда/ }));
    expect(api.state.trash).toHaveLength(1);
    const confirmation = within(oldB).getByRole('group', { name: /^Подтверждение удаления/ });
    expect(confirmation).toHaveTextContent('Удалить навсегда? Вернуть будет нельзя.');
    expect(confirmation).not.toHaveTextContent('план');
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(api.state.trash).toHaveLength(0));
    expect(confirm).not.toHaveBeenCalled();
    expect(await within(screen.getByRole('main')).findByText('Корзина пуста')).toBeInTheDocument();

    // Счётчик в меню следует за корзиной.
    backToMore();
    await waitFor(() => expect(screen.getByRole('button', { name: /^Корзина/ })).toHaveTextContent(/0$/));
  });

  it('labels a deleted transfer «A → B» with the account names', async () => {
    const api = makeApi({
      accounts: [
        { _id: 'card', name: 'Карта', type: 'card', icon: '💳', order: 0 },
        { _id: 'cash', name: 'Наличные', type: 'cash', icon: '💵', order: 1 },
      ],
      trash: [{
        id: 'tr', deletionBatchId: 'batch-tr', deletedAt: '2026-09-04T10:00:00.000Z', count: 1,
        transactions: [{ _id: 'tr', title: 'Снятие', amount: 100, type: 'transfer', account: 'card', toAccount: 'cash', date: '2026-09-04' }],
      }],
    });
    vi.stubGlobal('fetch', api.fetch);
    render(<App />);
    await screen.findByTestId('accounts-row');

    const trash = await openTrash();

    expect(await within(trash).findByText(/Карта → Наличные/)).toBeInTheDocument();
  });

  it('ignores a delayed trash body after the screen is closed and reopened', async () => {
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
    await screen.findByTestId('accounts-row');
    // Первое чтение стартует при заходе на «Ещё» и зависает; второе - при
    // открытии самого экрана.
    const trash = await openTrash();
    expect(await within(trash).findByText('Свежая операция')).toBeInTheDocument();
    backToMore();
    fireEvent.click(await screen.findByRole('button', { name: /^Корзина/ }));
    expect(await within(await screen.findByRole('main')).findByText('Свежая операция')).toBeInTheDocument();

    await act(async () => {
      resolveOldBody([
        { id: 'stale-1', deletedAt: '2026-09-01T10:00:00Z', count: 1, transactions: [{ _id: 'stale-1', title: 'Чужая старая операция', amount: 1 }] },
        { id: 'stale-2', deletedAt: '2026-09-01T11:00:00Z', count: 1, transactions: [{ _id: 'stale-2', title: 'Вторая чужая операция', amount: 1 }] },
      ]);
    });
    const main = within(screen.getByRole('main'));
    expect(main.queryByText('Чужая старая операция')).not.toBeInTheDocument();
    expect(main.getByText('Свежая операция')).toBeInTheDocument();
    backToMore();
    await waitFor(() => expect(screen.getByRole('button', { name: /^Корзина/ })).toHaveTextContent(/1$/));
  });
});
