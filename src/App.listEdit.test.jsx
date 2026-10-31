import { readApi } from '../server/test/readApi.mjs';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { withBootstrap } from './test/bootstrap';
import { SAVE_BUTTON_NAME } from './test/queries';

Element.prototype.scrollIntoView = vi.fn();

// Правка операции в списках: строка сразу показывает ответ PUT и подсвечивается,
// не дожидаясь ленты; при смене даты старая строка сворачивается, а в новом дне
// вырастает копия. Лента (/api/history) после записи держится, пока тест не
// отпустит её, - так видно, что стоит на экране в промежутке.

const ok = (body, status = 200) => Promise.resolve({ ok: true, status, json: () => Promise.resolve(body) });
const missing = message => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ message }) });
const copy = value => JSON.parse(JSON.stringify(value));

const doc = (id, title, amount, date, extra = {}) => ({
  _id: id, __v: 0, title, description: title, amount, type: 'expense', account: 'card', category: 'Еда', date: `${date}T00:00:00.000Z`, ...extra,
});

function makeApi({ failPut = false } = {}) {
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

    if (url.startsWith('/api/transactions/') && method === 'PUT') {
      const id = url.split('/')[3];
      const target = state.transactions.find(item => item._id === id);
      if (!target) return missing('Операция не найдена');
      if (failPut) return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ message: 'Сбой' }) });
      const { id: _ignored, date, ...fields } = JSON.parse(options.body);
      Object.assign(target, fields, { __v: target.__v + 1, ...(date ? { date: date.length === 10 ? `${date}T00:00:00.000Z` : date } : {}) });
      held.on = true;
      return ok(copy(target));
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

async function start(api) {
  vi.stubGlobal('fetch', api.fetch);
  render(<App />);
  await screen.findByTestId('accounts-row');
  await waitFor(() => expect(within(region()).getByText('Кофе утром')).toBeInTheDocument());
}

// Открывает строку по имени, правит поля и сохраняет; ждет закрытия формы.
async function editRow(name, { amount, date } = {}) {
  fireEvent.click(screen.getByRole('button', { name }));
  const dialog = await screen.findByRole('dialog', { name: 'Редактировать' });
  if (amount !== undefined) fireEvent.change(within(dialog).getByPlaceholderText('0'), { target: { value: String(amount) } });
  if (date !== undefined) fireEvent.change(dialog.querySelector('#transaction-date'), { target: { value: date } });
  fireEvent.click(within(dialog).getByRole('button', { name: SAVE_BUTTON_NAME }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Редактировать' })).not.toBeInTheDocument());
}

describe('editing a transaction in the lists', () => {
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
    it('shows the new amount, the new day sum and the tint at once, before the list is refetched, and keeps the row when the list lands', async () => {
      const api = makeApi();
      await start(api);
      expect(header(dayIn(region(), '2026-09-03'))).toHaveTextContent(`${MINUS}€70,00`);
      const coffee = itemIn(region(), 'coffee');
      const bread = itemIn(region(), 'bread');

      await editRow(/Кофе утром/, { amount: 75 });

      // Лента держится, а строка уже с новой суммой и подсвечена.
      expect(api.held.queue.length).toBeGreaterThan(0);
      expect(itemIn(region(), 'coffee')).toBe(coffee);
      expect(coffee).toHaveTextContent(`${MINUS}€75,00`);
      expect(header(dayIn(region(), '2026-09-03'))).toHaveTextContent(`${MINUS}€95,00`);
      expect(coffee.parentElement).toHaveClass('tx-fresh');
      expect(coffee.parentElement.querySelector('.tx-fresh-glow')).not.toBeNull();
      expect(coffee).not.toHaveAttribute('inert');
      expect(itemIn(region(), 'bread')).toBe(bread);
      expect(bread.parentElement.querySelector('.tx-fresh-glow')).toBeNull();

      await api.releaseHistory();
      await waitFor(() => expect(api.held.queue).toHaveLength(0));
      expect(itemIn(region(), 'coffee')).toBe(coffee);
      expect(coffee).toHaveTextContent(`${MINUS}€75,00`);
      expect(header(dayIn(region(), '2026-09-03'))).toHaveTextContent(`${MINUS}€95,00`);
      expect(within(region()).getAllByText('Кофе утром')).toHaveLength(1);
    });

    it('collapses the old row and grows a tinted copy in the new day when the date changes', async () => {
      const api = makeApi();
      await start(api);
      expect(header(dayIn(region(), '2026-09-02'))).toHaveTextContent(`${MINUS}€15,00`);
      const coffee = itemIn(dayIn(region(), '2026-09-03'), 'coffee');

      await editRow(/Кофе утром/, { date: '2026-09-02' });

      // Старая строка осталась призраком и сворачивается, сумма дня уже без нее.
      expect(itemIn(dayIn(region(), '2026-09-03'), 'coffee')).toBe(coffee);
      expect(coffee).toHaveAttribute('inert');
      expect(animate.mock.contexts).toContain(coffee);
      expect(header(dayIn(region(), '2026-09-03'))).toHaveTextContent(`${MINUS}€20,00`);
      // В новом дне выросла копия с подсветкой, сумма дня с ней.
      const copy = itemIn(dayIn(region(), '2026-09-02'), 'coffee');
      expect(copy).not.toBeNull();
      expect(copy).not.toHaveAttribute('inert');
      expect(copy.parentElement).toHaveClass('tx-fresh');
      expect(animate.mock.contexts).toContain(copy);
      expect(header(dayIn(region(), '2026-09-02'))).toHaveTextContent(`${MINUS}€65,00`);

      // Пришла лента: призрак исчез, копия на месте и не пересоздана.
      await api.releaseHistory();
      await waitFor(() => expect(itemIn(dayIn(region(), '2026-09-03'), 'coffee')).toBeNull());
      expect(itemIn(dayIn(region(), '2026-09-02'), 'coffee')).toBe(copy);
      expect(header(dayIn(region(), '2026-09-03'))).toHaveTextContent(`${MINUS}€20,00`);
      expect(header(dayIn(region(), '2026-09-02'))).toHaveTextContent(`${MINUS}€65,00`);
    });

    it('changes nothing when the save fails', async () => {
      const api = makeApi({ failPut: true });
      await start(api);
      const coffee = itemIn(region(), 'coffee');

      fireEvent.click(screen.getByRole('button', { name: /Кофе утром/ }));
      const dialog = await screen.findByRole('dialog', { name: 'Редактировать' });
      fireEvent.change(within(dialog).getByPlaceholderText('0'), { target: { value: '75' } });
      fireEvent.click(within(dialog).getByRole('button', { name: SAVE_BUTTON_NAME }));
      await screen.findByRole('alert');

      expect(coffee).toHaveTextContent(`${MINUS}€50,00`);
      expect(coffee.parentElement.querySelector('.tx-fresh-glow')).toBeNull();
      expect(header(dayIn(region(), '2026-09-03'))).toHaveTextContent(`${MINUS}€70,00`);
      expect(api.held.queue).toHaveLength(0);
    });
  });

  describe('in History', () => {
    const openHistory = async () => {
      fireEvent.click(screen.getByRole('button', { name: 'История' }));
      await waitFor(() => expect(screen.queryByText('Загрузка операций…')).not.toBeInTheDocument());
    };
    const timeline = () => document.querySelector('[data-history-month="2026-09"]');

    it('shows the edited row in the History list at once too', async () => {
      const api = makeApi();
      await start(api);
      await openHistory();
      const coffee = itemIn(timeline(), 'coffee');

      await editRow(/Кофе утром/, { amount: 75 });

      expect(itemIn(timeline(), 'coffee')).toBe(coffee);
      expect(coffee).toHaveTextContent(`${MINUS}€75,00`);
      expect(header(dayIn(timeline(), '2026-09-03'))).toHaveTextContent(`${MINUS}€95,00`);
      expect(coffee.parentElement.querySelector('.tx-fresh-glow')).not.toBeNull();

      await api.releaseHistory();
      await waitFor(() => expect(api.held.queue).toHaveLength(0));
      expect(itemIn(timeline(), 'coffee')).toBe(coffee);
      expect(timeline().querySelectorAll('[data-history-item="coffee"]')).toHaveLength(1);
    });

    it('moves the row to its new day with a collapsing ghost behind it', async () => {
      const api = makeApi();
      await start(api);
      await openHistory();
      const coffee = itemIn(dayIn(timeline(), '2026-09-03'), 'coffee');

      await editRow(/Кофе утром/, { date: '2026-09-02' });

      expect(coffee).toHaveAttribute('inert');
      expect(header(dayIn(timeline(), '2026-09-03'))).toHaveTextContent(`${MINUS}€20,00`);
      const copy = itemIn(dayIn(timeline(), '2026-09-02'), 'coffee');
      expect(copy.parentElement).toHaveClass('tx-fresh');
      expect(header(dayIn(timeline(), '2026-09-02'))).toHaveTextContent(`${MINUS}€65,00`);

      await api.releaseHistory();
      await waitFor(() => expect(itemIn(dayIn(timeline(), '2026-09-03'), 'coffee')).toBeNull());
      expect(itemIn(dayIn(timeline(), '2026-09-02'), 'coffee')).toBe(copy);
    });
  });
});
