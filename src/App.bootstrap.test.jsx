// Запуск приложения одним запросом /api/bootstrap и параллельной лентой
// истории. Здесь fetch подменен «сырым» моком без сборки ответа из отдельных
// адресов (src/test/bootstrap.js): проверяется именно то, что уходит в сеть.

import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { readApi } from '../server/test/readApi.mjs';
import App from './App';
import { flushIdle } from './test/idle';

const accounts = [{ _id: 'card', name: 'Карта', type: 'card', icon: '💳' }];
const categories = [{ _id: 'food', name: 'Еда', type: 'expense', order: 0 }];
const transactions = [
  { _id: 'income', title: 'Зарплата', amount: 1000, type: 'income', account: 'card', category: 'Работа', date: '2026-09-01' },
  { _id: 'expense', title: 'Кофе', amount: 50, type: 'expense', account: 'card', category: 'Еда', date: '2026-09-03' },
];
const deviceTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const bootstrapBody = (url, extra = {}) => ({
  accounts,
  categories,
  settings: { monthlyLimit: 1200 },
  dashboard: readApi(url.replace('/api/bootstrap', '/api/stats/dashboard'), transactions, accounts),
  ...extra,
});

let routes;
let fetchMock;
const urls = () => fetchMock.mock.calls.map(([url]) => url);
const callsTo = prefix => urls().filter(url => url.startsWith(prefix));
// Полная лента Истории (all=1); блок «Последние» на Обзоре ходит за пятью
// строками отдельным запросом и сюда не относится.
const listCalls = () => callsTo('/api/history?').filter(url => url.includes('all=1'));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-24T12:00:00Z'));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  routes = {
    bootstrap: url => response(bootstrapBody(url)),
    history: url => response(readApi(url, transactions, accounts)),
  };
  fetchMock = vi.fn(async (url, options) => {
    if (url.startsWith('/api/bootstrap?')) return routes.bootstrap(url, options);
    if (url.startsWith('/api/history?')) return routes.history(url, options);
    if (url.startsWith('/api/stats/dashboard?')) return response(readApi(url, transactions, accounts));
    if (url === '/api/accounts') return response(accounts);
    if (url === '/api/categories') return response(categories);
    if (url === '/api/settings') return response({ monthlyLimit: 1200 });
    if (url === '/api/login') return response({ ok: true });
    return response([]);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('запуск одним запросом', () => {
  it('шлет один /api/bootstrap с параметрами сводки и ни одного отдельного запроса счетов, категорий, настроек и сводки', async () => {
    render(<App />);
    await screen.findByTestId('accounts-row');

    // analytics=1: Обзор и Аналитика получают сводку одним расчетом, а tz - часовой
    // пояс устройства для прогрева ответов на сервере.
    expect(callsTo('/api/bootstrap?')).toEqual([
      `/api/bootstrap?month=2026-09&timeRange=month&today=2026-09-24&analytics=1&tz=${encodeURIComponent(deviceTimeZone)}`,
    ]);
    expect(urls().filter(url => ['/api/accounts', '/api/categories', '/api/settings'].includes(url))).toEqual([]);
    expect(callsTo('/api/stats/dashboard?')).toEqual([]);
    // Данные из ответа дошли до экрана: счет и лимит из настроек.
    expect(screen.getByText('Карта')).toBeInTheDocument();
  });

  it('кладет сводку из снимка в кэш итогов: смена счета и возврат не читают сводку заново', async () => {
    render(<App />);
    await screen.findByTestId('accounts-row');
    const reads = () => callsTo('/api/stats/dashboard?').length + callsTo('/api/bootstrap?').length;
    expect(reads()).toBe(1);

    fireEvent.focus(window);
    await act(async () => {});

    // Сводка свежая (меньше минуты): повторного чтения нет.
    expect(reads()).toBe(1);
  });

  it('после запуска фоновая подгрузка Аналитики не ходит в сеть: сводка с analytics=1 пришла в снимке', async () => {
    render(<App />);
    await screen.findByTestId('accounts-row');

    await flushIdle();
    await act(async () => {});

    expect(callsTo('/api/stats/dashboard?')).toEqual([]);
    expect(callsTo('/api/bootstrap?')).toHaveLength(1);
  });

  it('Аналитика сразу после запуска открывается без запроса', async () => {
    render(<App />);
    await screen.findByTestId('accounts-row');
    const before = urls().length;

    fireEvent.click(screen.getByRole('button', { name: 'Аналитика' }));
    await act(async () => {});
    await flushIdle();

    expect(screen.queryByRole('status', { name: 'Загрузка итогов…' })).not.toBeInTheDocument();
    expect(urls().slice(before).filter(url => url.startsWith('/api/stats/dashboard?') || url.startsWith('/api/bootstrap?'))).toEqual([]);
    expect(callsTo('/api/stats/dashboard?')).toEqual([]);
  });

  it('запрашивает ленту истории параллельно со снимком, после него в очереди, и не перезапрашивает после загрузки', async () => {
    render(<App />);
    await screen.findByTestId('accounts-row');
    await act(async () => {});

    expect(listCalls()).toEqual(['/api/history?continuous=1&all=1']);
    // Снимок ушел первым: лента не задерживает первый экран на сервере.
    expect(urls().findIndex(url => url.startsWith('/api/bootstrap?')))
      .toBeLessThan(urls().findIndex(url => url.includes('all=1')));
  });

  it('лента истории стартует, не дожидаясь ответа на снимок', async () => {
    let finishBootstrap;
    routes.bootstrap = url => new Promise(resolve => { finishBootstrap = () => resolve(response(bootstrapBody(url))); });

    render(<App />);

    await waitFor(() => expect(listCalls()).toHaveLength(1));
    expect(screen.queryByTestId('accounts-row')).not.toBeInTheDocument();
    await act(async () => finishBootstrap());
    await screen.findByTestId('accounts-row');
    expect(listCalls()).toHaveLength(1);
  });

  it('при полном обновлении (возврат в приложение) снова берет снимок и ленту', async () => {
    render(<App />);
    await screen.findByTestId('accounts-row');
    await act(async () => {});
    expect(listCalls()).toHaveLength(1);

    // Возврат в приложение после минуты - полное обновление (уже не запуск).
    vi.setSystemTime(new Date('2026-09-24T12:02:00Z'));
    fireEvent.focus(window);
    await waitFor(() => expect(callsTo('/api/bootstrap?')).toHaveLength(2));
    await waitFor(() => expect(listCalls()).toHaveLength(2));
  });
});

describe('сбой запуска', () => {
  const errorScreen = () => screen.findByRole('heading', { name: 'Не удалось загрузить данные' });

  it('сбой сети: тот же экран ошибки и повтор', async () => {
    let offline = true;
    routes.bootstrap = url => (offline ? Promise.reject(new Error('offline')) : response(bootstrapBody(url)));

    render(<App />);

    await errorScreen();
    expect(screen.getByRole('alert')).toHaveTextContent('Не удалось подключиться к серверу. Проверьте интернет');
    offline = false;
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await screen.findByTestId('accounts-row');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('повтор после сбоя перезапрашивает и ленту истории', async () => {
    let offline = true;
    routes.bootstrap = url => (offline ? Promise.reject(new Error('offline')) : response(bootstrapBody(url)));
    routes.history = url => (offline ? Promise.reject(new Error('offline')) : response(readApi(url, transactions, accounts)));

    render(<App />);
    await errorScreen();
    expect(listCalls()).toHaveLength(1);

    offline = false;
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await screen.findByTestId('accounts-row');
    await waitFor(() => expect(listCalls()).toHaveLength(2));
  });

  it('ошибка сервера: показывается сообщение из ответа', async () => {
    routes.bootstrap = () => response({ message: 'Обнаружено несколько наборов настроек' }, 409);

    render(<App />);

    await errorScreen();
    expect(screen.getByRole('alert')).toHaveTextContent('Обнаружено несколько наборов настроек');
  });

  it('ответ без сообщения: общий текст', async () => {
    routes.bootstrap = () => ({ ok: false, status: 500, json: async () => { throw new Error('not json'); } });

    render(<App />);

    await errorScreen();
    expect(screen.getByRole('alert')).toHaveTextContent('Не удалось загрузить данные');
  });

  it.each([
    ['счета не массив', { accounts: { nope: true } }, 'Сервер вернул некорректный список счетов'],
    ['категории не массив', { categories: 'x' }, 'Сервер вернул некорректный список категорий'],
    ['сводка без итогов', { dashboard: { month: {} } }, 'Сервер вернул некорректные итоги'],
    ['лимит не число', { settings: { monthlyLimit: 'много' } }, 'Сервер вернул некорректные настройки'],
    ['лимит нулевой', { settings: { monthlyLimit: 0 } }, 'Сервер вернул некорректные настройки'],
  ])('проверки ответа сохранены: %s', async (_name, extra, message) => {
    routes.bootstrap = url => response(bootstrapBody(url, extra));

    render(<App />);

    await errorScreen();
    expect(screen.getByRole('alert')).toHaveTextContent(message);
  });

  it('settings: null - лимит по умолчанию, остальное работает', async () => {
    routes.bootstrap = url => response(bootstrapBody(url, { settings: null }));

    render(<App />);

    await screen.findByTestId('accounts-row');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('сервер без /api/bootstrap (выкладка идет)', () => {
  it('на 404 один раз грузит по-старому и больше /api/bootstrap не пробует', async () => {
    routes.bootstrap = () => response({ message: 'Not found' }, 404);

    render(<App />);
    await screen.findByTestId('accounts-row');

    expect(callsTo('/api/bootstrap?')).toHaveLength(1);
    expect(urls().filter(url => url === '/api/accounts')).toHaveLength(1);
    expect(urls().filter(url => url === '/api/categories')).toHaveLength(1);
    expect(urls().filter(url => url === '/api/settings')).toHaveLength(1);
    expect(callsTo('/api/stats/dashboard?')).toHaveLength(1);
    expect(screen.getByText('Карта')).toBeInTheDocument();

    // Следующее полное обновление идет сразу по-старому, без повторной пробы.
    vi.setSystemTime(new Date('2026-09-24T12:02:00Z'));
    fireEvent.focus(window);
    await waitFor(() => expect(urls().filter(url => url === '/api/accounts')).toHaveLength(2));
    expect(callsTo('/api/bootstrap?')).toHaveLength(1);
  });

  it('старый порядок: счета идут раньше остальных, ошибки те же', async () => {
    routes.bootstrap = () => response({}, 404);
    const order = [];
    const base = fetchMock.getMockImplementation();
    fetchMock.mockImplementation((url, options) => {
      order.push(url.split('?')[0]);
      if (url === '/api/categories') return Promise.resolve(response({ message: 'Категории недоступны' }, 500));
      return base(url, options);
    });

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Не удалось загрузить данные' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Категории недоступны');
    expect(order.indexOf('/api/accounts')).toBeLessThan(order.indexOf('/api/categories'));
    expect(order.indexOf('/api/accounts')).toBeLessThan(order.indexOf('/api/stats/dashboard'));
  });
});

describe('вход', () => {
  it('401 на снимке и на ленте: один экран входа без ошибки загрузки, после входа все грузится заново', async () => {
    let authenticated = false;
    const unauthorized = () => response({ message: 'Не авторизован' }, 401);
    const protectedRoute = (route) => url => (authenticated ? route(url) : unauthorized());
    routes.bootstrap = protectedRoute(url => response(bootstrapBody(url)));
    routes.history = protectedRoute(url => response(readApi(url, transactions, accounts)));
    const base = fetchMock.getMockImplementation();
    fetchMock.mockImplementation((url, options) => {
      if (url === '/api/login') { authenticated = true; return Promise.resolve(response({ ok: true })); }
      return base(url, options);
    });

    render(<App />);

    await screen.findByLabelText('Пароль');
    await act(async () => {});
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Не удалось загрузить данные' })).not.toBeInTheDocument();
    // Первый вход, а не потеря сессии.
    expect(screen.getByText('Введите пароль, чтобы продолжить')).toBeInTheDocument();
    expect(callsTo('/api/bootstrap?')).toHaveLength(1);
    expect(listCalls()).toHaveLength(1);

    fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'family-secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));

    await screen.findByTestId('accounts-row');
    await act(async () => {});
    expect(callsTo('/api/bootstrap?')).toHaveLength(2);
    // Лента после входа запрошена один раз, без повторного запроса после загрузки.
    expect(listCalls()).toHaveLength(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('401 только на ленте (снимок успел) тоже ведет на экран входа, а не показывает ошибку', async () => {
    routes.history = () => response({ message: 'Не авторизован' }, 401);

    render(<App />);

    await screen.findByLabelText('Пароль');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByTestId('accounts-row')).not.toBeInTheDocument();
  });
});
