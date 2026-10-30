import { readApi } from '../server/test/readApi.mjs';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { withBootstrap } from './test/bootstrap';
import { SAVE_BUTTON_NAME } from './test/queries';

Element.prototype.scrollIntoView = vi.fn();

// Удаление и «Отменить» в списках: строка сворачивается и возвращается сразу,
// не дожидаясь ленты. Лента (/api/history) после записи держится, пока тест не
// отпустит её, - так видно, что стоит на экране в промежутке.

const ok = (body, status = 200) => Promise.resolve({ ok: true, status, json: () => Promise.resolve(body) });
const missing = message => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ message }) });
const copy = value => JSON.parse(JSON.stringify(value));

const doc = (id, title, amount, date, extra = {}) => ({
  _id: id, __v: 0, title, description: title, amount, type: 'expense', account: 'card', category: 'Еда', date: `${date}T00:00:00.000Z`, ...extra,
});

function makeApi({ restoreReturnsTransactions = true } = {}) {
  const state = {
    accounts: [{ _id: 'card', name: 'Карта', type: 'card', icon: '💳', order: 0 }],
    categories: [{ _id: 'food', name: 'Еда', type: 'expense', order: 0 }],
    transactions: [
      { _id: 'income', __v: 0, title: 'Доход', amount: 1000, type: 'income', account: 'card', category: 'Доход', date: '2026-09-01T00:00:00.000Z' },
      doc('lonely', 'Одинокая трата', 15, '2026-09-02'),
      doc('bread', 'Хлеб', 20, '2026-09-03'),
      doc('coffee', 'Кофе утром', 50, '2026-09-03'),
      doc('part1', 'Магазин', 30, '2026-09-04', { splitId: 'split-1', category: 'Еда' }),
      doc('part2', 'Магазин', 70, '2026-09-04', { splitId: 'split-1', category: 'Дом' }),
    ],
    trash: [],
  };
  // Ответы ленты, которые тест отпустит сам; held.on включается записью.
  const held = { on: false, queue: [] };
  const releaseHistory = async () => {
    const queue = held.queue.splice(0);
    await act(async () => { queue.forEach(release => release()); });
  };

  const fetch = vi.fn(withBootstrap(async (url, options = {}) => {
    const method = options.method || 'GET';
    if (held.on && method === 'GET' && url.startsWith('/api/history?')) {
      return new Promise(resolve => { held.queue.push(() => resolve(ok(readApi(url, state.transactions, state.accounts)))); });
    }
    const data = method === 'GET' ? readApi(url, state.transactions, state.accounts) : undefined;
    if (data !== undefined) return ok(data);
    if (url === '/api/accounts' && method === 'GET') return ok(copy(state.accounts));
    if (url === '/api/categories' && method === 'GET') return ok(copy(state.categories));
    if (url === '/api/settings' && method === 'GET') return ok({ monthlyLimit: 7000 });
    if (url === '/api/transactions' && method === 'GET') return ok(copy(state.transactions));
    if (url === '/api/trash' && method === 'GET') return ok(copy(state.trash));

    if (url === '/api/transactions' && method === 'POST') {
      const saved = { _id: 'zzz-new', __v: 0, ...JSON.parse(options.body) };
      state.transactions.push(saved);
      held.on = true;
      return ok(saved, 201);
    }
    if (url.startsWith('/api/transactions/') && method === 'DELETE') {
      const [path, query] = url.split('?');
      const id = path.split('/')[3];
      const target = state.transactions.find(item => item._id === id);
      if (!target) return missing('Операция не найдена');
      const splitId = new URLSearchParams(query).get('splitId');
      const removed = state.transactions.filter(item => (splitId ? item.splitId === splitId : item._id === id));
      state.transactions = state.transactions.filter(item => !removed.includes(item));
      state.trash.push({ id, count: removed.length, transactions: removed });
      held.on = true;
      return ok({ trashId: id, count: removed.length });
    }
    if (url.startsWith('/api/trash/') && url.endsWith('/restore') && method === 'POST') {
      const id = url.split('/')[3];
      const index = state.trash.findIndex(group => group.id === id);
      if (index < 0) return missing('Группа не найдена');
      const [group] = state.trash.splice(index, 1);
      const restored = group.transactions.map(item => ({ ...item, __v: item.__v + 1 }));
      state.transactions.push(...restored);
      return ok(restoreReturnsTransactions ? { count: group.count, transactions: restored } : { count: group.count });
    }
    if (url === '/api/logout') return ok({ ok: true });
    return ok({});
  }));

  return { state, fetch, held, releaseHistory };
}

const MINUS = '−';
const region = () => screen.getByRole('region', { name: 'Последние операции' });
const itemIn = (root, id) => root.querySelector(`[data-history-item="${id}"]`);
const dayIn = (root, date) => root.querySelector(`[data-history-date="${date}"]`);
const header = day => day.firstElementChild;
const COLLAPSED = { height: '0px', overflow: 'hidden', opacity: '0' };

async function start(api) {
  vi.stubGlobal('fetch', api.fetch);
  render(<App />);
  await screen.findByTestId('accounts-row');
  await waitFor(() => expect(within(region()).getByText('Кофе утром')).toBeInTheDocument());
}

// Открывает строку по имени, удаляет её и ждёт тост с «Отменить».
async function deleteRow(name) {
  fireEvent.click(screen.getByRole('button', { name }));
  const dialog = await screen.findByRole('dialog', { name: 'Редактировать' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Удалить операцию' }));
  await screen.findByRole('button', { name: 'Отменить' });
}

const undo = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Отменить' }));
};

describe('deleting and undoing in the lists', () => {
  let animate;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 5, 12));
    animate = vi.fn(() => ({ cancel: vi.fn() }));
    Element.prototype.animate = animate;
  });
  afterEach(() => {
    delete Element.prototype.animate;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe('on Overview', () => {
    it('collapses the deleted row and lowers the day sum before the list is refetched', async () => {
      const api = makeApi();
      await start(api);
      expect(header(dayIn(region(), '2026-09-03'))).toHaveTextContent(`${MINUS}€70,00`);
      const coffee = itemIn(region(), 'coffee');
      const bread = itemIn(region(), 'bread');

      await deleteRow(/Кофе утром/);

      // Лента ещё не ответила, а строка уже уходит и сумма дня пересчитана.
      expect(api.held.queue.length).toBeGreaterThan(0);
      expect(itemIn(region(), 'coffee')).toBe(coffee);
      expect(coffee).toHaveAttribute('inert');
      expect(coffee).toHaveAttribute('aria-hidden', 'true');
      expect(animate).toHaveBeenCalled();
      expect(animate.mock.contexts).toContain(coffee);
      expect(header(dayIn(region(), '2026-09-03'))).toHaveTextContent(`${MINUS}€20,00`);
      expect(itemIn(region(), 'bread')).toBe(bread);
      expect(bread).not.toHaveAttribute('inert');
      expect(screen.queryByRole('dialog', { name: 'Редактировать' })).not.toBeInTheDocument();
    });

    it('lets the late list unmount the already collapsed row without moving the others', async () => {
      const api = makeApi();
      await start(api);
      const bread = itemIn(region(), 'bread');
      await deleteRow(/Кофе утром/);
      const callsBefore = animate.mock.calls.length;

      await api.releaseHistory();

      await waitFor(() => expect(itemIn(region(), 'coffee')).toBeNull());
      expect(itemIn(region(), 'bread')).toBe(bread);
      expect(animate.mock.calls.length).toBe(callsBefore);
      expect(header(dayIn(region(), '2026-09-03'))).toHaveTextContent(`${MINUS}€20,00`);
    });

    it('collapses a whole day when its only row is deleted', async () => {
      const api = makeApi();
      await start(api);
      const day = dayIn(region(), '2026-09-02');

      await deleteRow(/Одинокая трата/);

      expect(dayIn(region(), '2026-09-02')).toBe(day);
      expect(day).toHaveAttribute('inert');
      expect(animate.mock.contexts).toContain(day);
      expect(dayIn(region(), '2026-09-03')).not.toHaveAttribute('inert');
      await api.releaseHistory();
      await waitFor(() => expect(dayIn(region(), '2026-09-02')).toBeNull());
    });

    it('collapses a whole split purchase when it is deleted from one of its parts', async () => {
      const api = makeApi();
      await start(api);
      expect(header(dayIn(region(), '2026-09-04'))).toHaveTextContent(`${MINUS}€100,00`);

      await deleteRow(/Магазин \(Разделено\): .*Дом/);

      const group = itemIn(region(), 'split-1');
      expect(group.closest('[inert]')).not.toBeNull();
      // Остальных строк в дне нет, поэтому уходит день целиком.
      expect(dayIn(region(), '2026-09-04')).toHaveAttribute('inert');
      await api.releaseHistory();
      await waitFor(() => expect(itemIn(region(), 'split-1')).toBeNull());
      expect(api.fetch.mock.calls.some(([url]) => /\/api\/transactions\/part\d\?splitId=split-1/.test(url))).toBe(true);
    });

    it('keeps the toast and shows nothing new while the restore request runs', async () => {
      const api = makeApi();
      await start(api);
      await deleteRow(/Кофе утром/);
      const baseFetch = api.fetch.getMockImplementation();
      let finishRestore;
      api.fetch.mockImplementation((url, options = {}) => (url.endsWith('/restore')
        ? new Promise(resolve => { finishRestore = () => resolve(baseFetch(url, options)); })
        : baseFetch(url, options)));
      const coffee = itemIn(region(), 'coffee');

      await undo();

      expect(screen.getByRole('button', { name: 'Восстановление…' })).toBeDisabled();
      expect(coffee).toHaveAttribute('inert');
      expect(header(dayIn(region(), '2026-09-03'))).toHaveTextContent(`${MINUS}€20,00`);
      await act(async () => finishRestore());
    });

    it('grows the row back with the tint when Undo comes before the refetch arrived', async () => {
      const api = makeApi();
      await start(api);
      await deleteRow(/Кофе утром/);
      const coffee = itemIn(region(), 'coffee');
      expect(coffee).toHaveAttribute('inert');
      animate.mockClear();

      await undo();

      await waitFor(() => expect(coffee).not.toHaveAttribute('inert'));
      // Та же строка: она не пересоздавалась, а выросла заново и засветилась.
      expect(itemIn(region(), 'coffee')).toBe(coffee);
      expect(animate.mock.contexts).toContain(coffee);
      expect(coffee.parentElement).toHaveClass('tx-fresh');
      expect(coffee.parentElement.querySelector('.tx-fresh-glow')).not.toBeNull();
      expect(header(dayIn(region(), '2026-09-03'))).toHaveTextContent(`${MINUS}€70,00`);
      expect(screen.queryByRole('button', { name: 'Отменить' })).not.toBeInTheDocument();

      // Опоздавшие ленты (после удаления и после восстановления) строку не дублируют.
      await api.releaseHistory();
      await waitFor(() => expect(within(region()).getAllByText('Кофе утром')).toHaveLength(1));
      expect(header(dayIn(region(), '2026-09-03'))).toHaveTextContent(`${MINUS}€70,00`);
    });

    it('puts the row back at once as a fresh one when the list without it had already arrived', async () => {
      const api = makeApi();
      await start(api);
      await deleteRow(/Кофе утром/);
      await api.releaseHistory();
      await waitFor(() => expect(itemIn(region(), 'coffee')).toBeNull());

      await undo();

      // Ответ restore вернул документы - строка на месте, лента ещё держится.
      await waitFor(() => expect(itemIn(region(), 'coffee')).not.toBeNull());
      expect(api.held.queue.length).toBeGreaterThan(0);
      const coffee = itemIn(region(), 'coffee');
      expect(coffee.parentElement).toHaveClass('tx-fresh');
      expect(animate.mock.contexts).toContain(coffee);
      expect(header(dayIn(region(), '2026-09-03'))).toHaveTextContent(`${MINUS}€70,00`);
      // Строка встала на своё место, до «Хлеба» (id по убыванию).
      const order = [...region().querySelectorAll('[data-history-date="2026-09-03"] [data-history-item]')].map(item => item.dataset.historyItem);
      expect(order).toEqual(['coffee', 'bread']);

      await api.releaseHistory();
      await waitFor(() => expect(within(region()).getAllByText('Кофе утром')).toHaveLength(1));
      expect(itemIn(region(), 'coffee')).toBe(coffee);
    });

    it('waits for the refetch when the restore response carries no documents (old server)', async () => {
      const api = makeApi({ restoreReturnsTransactions: false });
      await start(api);
      await deleteRow(/Кофе утром/);
      await api.releaseHistory();
      await waitFor(() => expect(itemIn(region(), 'coffee')).toBeNull());

      await undo();

      await waitFor(() => expect(api.fetch.mock.calls.some(([url]) => url === '/api/trash/coffee/restore')).toBe(true));
      await waitFor(() => expect(api.held.queue.length).toBeGreaterThan(0));
      expect(itemIn(region(), 'coffee')).toBeNull();

      await api.releaseHistory();
      await waitFor(() => expect(itemIn(region(), 'coffee')).not.toBeNull());
      expect(within(region()).getAllByText('Кофе утром')).toHaveLength(1);
    });

    it('brings back a whole split purchase after Undo, with its day sum', async () => {
      const api = makeApi();
      await start(api);
      await deleteRow(/Магазин \(Разделено\): .*Дом/);
      await api.releaseHistory();
      await waitFor(() => expect(itemIn(region(), 'split-1')).toBeNull());

      await undo();

      await waitFor(() => expect(itemIn(region(), 'split-1')).not.toBeNull());
      expect(itemIn(region(), 'split-1').closest('.tx-fresh')).not.toBeNull();
      expect(header(dayIn(region(), '2026-09-04'))).toHaveTextContent(`${MINUS}€100,00`);
      expect(within(region()).getAllByRole('button', { name: /Магазин \(Разделено\)/ })).toHaveLength(2);
    });
  });

  describe('in History', () => {
    const openHistory = async () => {
      fireEvent.click(screen.getByRole('button', { name: 'История' }));
      await waitFor(() => expect(screen.queryByText('Загрузка операций…')).not.toBeInTheDocument());
    };
    const timeline = () => document.querySelector('[data-history-month="2026-09"]');

    it('collapses the deleted row in the History list too, and lets the late list unmount it', async () => {
      const api = makeApi();
      await start(api);
      await openHistory();
      const coffee = itemIn(timeline(), 'coffee');
      const bread = itemIn(timeline(), 'bread');
      expect(header(dayIn(timeline(), '2026-09-03'))).toHaveTextContent(`${MINUS}€70,00`);

      await deleteRow(/Кофе утром/);

      expect(itemIn(timeline(), 'coffee')).toBe(coffee);
      expect(coffee).toHaveAttribute('inert');
      expect(animate.mock.contexts).toContain(coffee);
      expect(header(dayIn(timeline(), '2026-09-03'))).toHaveTextContent(`${MINUS}€20,00`);

      await api.releaseHistory();
      await waitFor(() => expect(itemIn(timeline(), 'coffee')).toBeNull());
      expect(itemIn(timeline(), 'bread')).toBe(bread);
    });

    it('collapses a deleted split purchase as one block', async () => {
      const api = makeApi();
      await start(api);
      await openHistory();

      await deleteRow(/Магазин \(Разделено\): .*Дом/);

      expect(itemIn(timeline(), 'split-1').closest('[inert]')).not.toBeNull();
      expect(dayIn(timeline(), '2026-09-04')).toHaveAttribute('inert');
      await api.releaseHistory();
      await waitFor(() => expect(itemIn(timeline(), 'split-1')).toBeNull());
    });

    it('grows the row back with the tint on Undo, in place', async () => {
      const api = makeApi();
      await start(api);
      await openHistory();
      await deleteRow(/Кофе утром/);
      const coffee = itemIn(timeline(), 'coffee');

      await undo();

      await waitFor(() => expect(coffee).not.toHaveAttribute('inert'));
      expect(itemIn(timeline(), 'coffee')).toBe(coffee);
      expect(coffee.parentElement).toHaveClass('tx-fresh');
      expect(header(dayIn(timeline(), '2026-09-03'))).toHaveTextContent(`${MINUS}€70,00`);
      await api.releaseHistory();
      await waitFor(() => expect(timeline().querySelectorAll('[data-history-item="coffee"]')).toHaveLength(1));
    });

    it('puts the restored row back instantly when the list without it had already arrived', async () => {
      const api = makeApi();
      await start(api);
      await openHistory();
      await deleteRow(/Кофе утром/);
      await api.releaseHistory();
      await waitFor(() => expect(itemIn(timeline(), 'coffee')).toBeNull());

      await undo();

      await waitFor(() => expect(itemIn(timeline(), 'coffee')).not.toBeNull());
      expect(api.held.queue.length).toBeGreaterThan(0);
      expect(itemIn(timeline(), 'coffee').parentElement).toHaveClass('tx-fresh');
      expect(header(dayIn(timeline(), '2026-09-03'))).toHaveTextContent(`${MINUS}€70,00`);
      await api.releaseHistory();
      await waitFor(() => expect(timeline().querySelectorAll('[data-history-item="coffee"]')).toHaveLength(1));
    });

    it('shows a just-saved transaction in History at once, before its list is refetched', async () => {
      const api = makeApi();
      await start(api);
      await openHistory();

      fireEvent.click(screen.getByRole('button', { name: 'Добавить операцию' }));
      const form = within(screen.getByRole('dialog', { name: 'Новый расход' }));
      fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '25' } });
      fireEvent.click(form.getByText('Еда'));
      fireEvent.click(form.getByRole('button', { name: 'Карта', exact: true }));
      fireEvent.click(screen.getByRole('button', { name: SAVE_BUTTON_NAME }));

      await waitFor(() => expect(itemIn(timeline(), 'zzz-new')).not.toBeNull());
      expect(api.held.queue.length).toBeGreaterThan(0);
      expect(itemIn(timeline(), 'zzz-new').parentElement).toHaveClass('tx-fresh');
      expect(animate.mock.contexts).toContain(itemIn(timeline(), 'zzz-new'));
      const saved = itemIn(timeline(), 'zzz-new');

      await api.releaseHistory();
      await waitFor(() => expect(timeline().querySelectorAll('[data-history-item="zzz-new"]')).toHaveLength(1));
      expect(itemIn(timeline(), 'zzz-new')).toBe(saved);
    });

    it('falls back to the refetch in History when the restore response has no documents', async () => {
      const api = makeApi({ restoreReturnsTransactions: false });
      await start(api);
      await openHistory();
      await deleteRow(/Кофе утром/);
      await api.releaseHistory();
      await waitFor(() => expect(itemIn(timeline(), 'coffee')).toBeNull());

      await undo();

      await waitFor(() => expect(api.held.queue.length).toBeGreaterThan(0));
      expect(itemIn(timeline(), 'coffee')).toBeNull();
      await api.releaseHistory();
      await waitFor(() => expect(itemIn(timeline(), 'coffee')).not.toBeNull());
    });
  });
});
