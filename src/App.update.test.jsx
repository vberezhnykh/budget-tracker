import { readApi } from '../server/test/readApi.mjs';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { reloadPage } from './utils/appUpdate';

// Перезагрузку подменяем: window.location.reload в jsdom не переопределить,
// а проверять нужно именно факт вызова.
vi.mock('./utils/appUpdate', async (importOriginal) => ({
  ...(await importOriginal()),
  reloadPage: vi.fn(),
}));

Element.prototype.scrollIntoView = vi.fn();

const CURRENT = '/assets/index-OLD.js';
const NEWER = '/assets/index-NEW.js';

const ok = (body, status = 200) => Promise.resolve({ ok: true, status, json: () => Promise.resolve(body) });
const copy = (value) => JSON.parse(JSON.stringify(value));

function makeApi({ serverVersion = NEWER } = {}) {
  const state = {
    version: serverVersion,
    accounts: [{ _id: 'card', name: 'Карта', type: 'card', icon: '💳', order: 0 }],
    categories: [{ _id: 'food', name: 'Еда', type: 'expense', order: 0 }],
    transactions: [
      { _id: 'income', __v: 0, title: 'Доход', amount: 1000, type: 'income', account: 'card', category: 'Доход', date: '2026-09-01T00:00:00.000Z' },
      { _id: 'expense', __v: 0, title: 'Кофе', description: 'Кофе утром', amount: 50, type: 'expense', account: 'card', category: 'Еда', date: '2026-09-03T00:00:00.000Z' },
    ],
    trash: [],
  };

  const fetch = vi.fn(async (url, options = {}) => {
    const method = options.method || 'GET';
    if (url === '/api/version') return ok({ version: state.version });
    const data = method === 'GET' ? readApi(url, state.transactions, state.accounts) : undefined;
    if (data !== undefined) return ok(data);
    if (url === '/api/accounts' && method === 'GET') return ok(copy(state.accounts));
    if (url === '/api/categories' && method === 'GET') return ok(copy(state.categories));
    if (url === '/api/settings' && method === 'GET') return ok({ monthlyLimit: 7000 });
    if (url === '/api/transactions' && method === 'GET') return ok(copy(state.transactions));
    if (url === '/api/trash' && method === 'GET') return ok(copy(state.trash));
    if (url.startsWith('/api/transactions/') && method === 'DELETE') {
      const id = url.split('/')[3].split('?')[0];
      const [transaction] = state.transactions.splice(state.transactions.findIndex(item => item._id === id), 1);
      state.trash.push({ id, deletionBatchId: `batch-${id}`, deletedAt: new Date().toISOString(), count: 1, transactions: [transaction] });
      return ok({ trashId: id, count: 1 });
    }
    if (url.startsWith('/api/trash/') && url.endsWith('/restore') && method === 'POST') {
      const id = url.split('/')[3];
      const [group] = state.trash.splice(state.trash.findIndex(item => item.id === id), 1);
      state.transactions.push(...group.transactions);
      return ok({ count: group.count });
    }
    return ok({});
  });

  return { state, fetch };
}

const versionCalls = (api) => api.fetch.mock.calls.filter(([url]) => url === '/api/version');

// Приложение вернулось из фона: страница снова видима.
async function returnFromBackground() {
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

async function renderApp(api) {
  vi.stubGlobal('fetch', api.fetch);
  render(<App />);
  await screen.findByTestId('accounts-row');
}

const UPDATE_TOAST = 'Доступна новая версия';

describe('Обновление приложения при возвращении из фона', () => {
  let script;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 5, 12));
    // Страница «загружена» из сборки OLD: в jsdom скрипты не выполняются,
    // тег нужен только затем, чтобы currentBuildVersion его нашёл.
    script = document.createElement('script');
    script.type = 'module';
    script.src = CURRENT;
    document.head.appendChild(script);
    reloadPage.mockClear();
  });

  afterEach(() => {
    script.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('перезагружает страницу, когда версия сменилась и ничего не открыто', async () => {
    const api = makeApi();
    await renderApp(api);
    expect(versionCalls(api)).toHaveLength(0);

    await returnFromBackground();

    await waitFor(() => expect(reloadPage).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(UPDATE_TOAST)).not.toBeInTheDocument();
  });

  it('ничего не делает, если версия та же', async () => {
    const api = makeApi({ serverVersion: CURRENT });
    await renderApp(api);

    await returnFromBackground();

    await waitFor(() => expect(versionCalls(api)).toHaveLength(1));
    expect(reloadPage).not.toHaveBeenCalled();
    expect(screen.queryByText(UPDATE_TOAST)).not.toBeInTheDocument();
  });

  it('при открытой форме операции показывает плашку вместо перезагрузки, а «Обновить» перезагружает', async () => {
    const api = makeApi();
    await renderApp(api);
    fireEvent.click(screen.getByRole('button', { name: 'Добавить операцию' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await returnFromBackground();

    const toast = (await screen.findByText(UPDATE_TOAST)).closest('[role]');
    expect(toast).toHaveAttribute('role', 'status');
    // Плашка без крестика: она остаётся, пока не нажали «Обновить».
    expect(within(toast).queryByRole('button', { name: 'Закрыть' })).not.toBeInTheDocument();
    expect(reloadPage).not.toHaveBeenCalled();

    fireEvent.click(within(toast).getByRole('button', { name: 'Обновить' }));
    expect(reloadPage).toHaveBeenCalledTimes(1);
  });

  it('после закрытия формы при ожидающем обновлении перезагружает страницу сама', async () => {
    const api = makeApi();
    await renderApp(api);
    fireEvent.click(screen.getByRole('button', { name: 'Добавить операцию' }));
    await returnFromBackground();
    await screen.findByText(UPDATE_TOAST);
    expect(reloadPage).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Закрыть', exact: true }));

    await waitFor(() => expect(reloadPage).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(UPDATE_TOAST)).not.toBeInTheDocument();
  });

  it('выбор периода тоже считается открытым листом: состояние у него своё, не в App', async () => {
    const api = makeApi();
    await renderApp(api);
    fireEvent.click(screen.getByRole('button', { name: /^Период:/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Выбор периода' });

    await returnFromBackground();

    await screen.findByText(UPDATE_TOAST);
    expect(reloadPage).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: /^Всё время/ }));
    await waitFor(() => expect(reloadPage).toHaveBeenCalledTimes(1));
  });

  it('не стирает тост «Операция в корзине»: ждёт его и встаёт над ним', async () => {
    const api = makeApi({ serverVersion: CURRENT });
    await renderApp(api);
    fireEvent.click(screen.getByRole('button', { name: 'История' }));
    await waitFor(() => expect(screen.queryByText('Загрузка операций…')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Кофе утром/ }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Редактировать' })).getByRole('button', { name: 'Удалить операцию' }));
    const undoToast = (await screen.findByRole('button', { name: 'Отменить' })).closest('[role]');
    expect(undoToast.style.bottom).toBe('88px');

    // Сервер выкатил новую версию, пока висит возможность отмены.
    api.state.version = NEWER;
    await returnFromBackground();

    const updateToast = (await screen.findByText(UPDATE_TOAST)).closest('[role]');
    expect(updateToast.style.bottom).toBe('152px');
    expect(undoToast).toBeInTheDocument();
    expect(reloadPage).not.toHaveBeenCalled();

    // Отмена удаления убирает тост, и обновление применяется.
    fireEvent.click(within(undoToast).getByRole('button', { name: 'Отменить' }));
    await waitFor(() => expect(reloadPage).toHaveBeenCalledTimes(1));
  });
});
