import { readApi } from '../server/test/readApi.mjs';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import App from './App';
import { computeAccountReorder, handleAccountDragEnd } from './utils/accountReorder';
import { SAVE_BUTTON_NAME } from './test/queries';

// Mock the API response
const mockTransactions = [
    {
        _id: '1',
        title: 'Salary',
        amount: 5000,
        type: 'income',
        account: 'card',
        date: '2026-01-01T00:00:00Z',
        category: 'Job'
    },
    {
        _id: '2',
        title: 'Rent',
        description: 'Monthly flat rent',
        amount: 1000,
        type: 'expense',
        account: 'card',
        date: '2026-01-02T00:00:00Z',
        category: 'Housing'
    }
];

let currentTransactions = [...mockTransactions];
let currentAccounts = [
    { _id: 'card', name: 'Карта', type: 'card', icon: '💳', isDefault: true },
    { _id: 'cash', name: 'Наличные', type: 'cash', icon: '💵', isDefault: true }
];
let currentCategories = [];

// Setup fetch mock. Stubbed fresh in the describe block's beforeEach (rather
// than assigned once at module scope) so it can be paired with
// vi.unstubAllGlobals() in afterEach, same idiom as LoginScreen.test.jsx and
// the accountReorder tests below.
let fetchMock;
function createFetchMock() {
    return vi.fn((url, options) => {
        const data = !options?.method ? readApi(url, currentTransactions, currentAccounts) : undefined;
        if (data !== undefined) return Promise.resolve({ ok: true, status: 200, json: async () => data });
        if (typeof url === 'string' && url.includes('/api/accounts')) {
            if (options?.method === 'DELETE') {
                const id = url.split('/').pop();
                currentAccounts = currentAccounts.filter(a => a._id !== id);
            }
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve(currentAccounts),
            });
        }
        if (typeof url === 'string' && url.includes('/api/categories')) {
            if (options?.method === 'DELETE') {
                const id = url.split('/').pop();
                currentCategories = currentCategories.filter(c => c._id !== id);
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ message: 'Category deleted' }) });
            }
            // Переименование - как на сервере (PUT /api/categories/:id):
            // вместе с категорией переписываются операции того же типа со
            // старым названием.
            if (options?.method === 'PUT') {
                const id = url.split('/').pop();
                const { name } = JSON.parse(options.body);
                const cat = currentCategories.find(c => c._id === id);
                if (!cat) {
                    return Promise.resolve({ ok: false, json: () => Promise.resolve({ message: 'Category not found' }) });
                }
                const oldName = cat.name;
                currentTransactions = currentTransactions.map(t => (
                    t.type === cat.type && t.category === oldName ? { ...t, category: name } : t
                ));
                currentCategories = currentCategories.map(c => (c._id === id ? { ...c, name } : c));
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ category: { ...cat, name }, updatedTransactions: 1 }) });
            }
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve(currentCategories),
            });
        }
        if (typeof url === 'string' && url.includes('/api/settings')) {
            return Promise.resolve({
                ok: true,
                status: 200,
                json: () => Promise.resolve({ monthlyLimit: 7000 }),
            });
        }
        return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(currentTransactions),
        });
    });
}

// jsdom doesn't implement scrollIntoView; the accounts strip guards the call,
// but tests need a spy to verify *which* card it was asked to scroll to.
Element.prototype.scrollIntoView = vi.fn();

// Обзор загружен, когда в нём появилась лента счетов.
const waitForOverview = () => screen.findByTestId('accounts-row');

// Карточка счёта в ленте Обзора: <button aria-pressed>, имя вида «Карта: €…».
const accountCard = name => screen.getByRole('button', { name: new RegExp(`^${name}: −?€`) });

// История - отдельная вкладка нижней навигации. Её содержимое (поиск, фильтры,
// полная история) существует в дереве только пока вкладка открыта.
async function openHistory() {
    fireEvent.click(screen.getByRole('button', { name: 'История' }));
    await waitFor(() => expect(screen.queryByText('Загрузка операций…')).not.toBeInTheDocument());
}

// Переход на вкладку нижней навигации по её названию.
function goTo(name) {
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Основная навигация' })).getByRole('button', { name }));
}

// Строка меню «Ещё» по названию: /^Счета/, /^Категории/, /^Корзина/, /^Лимит/.
function openMoreRow(name) {
    goTo('Ещё');
    fireEvent.click(screen.getByRole('button', { name }));
}

// Содержимое экрана без нижней навигации: на внутренних экранах кнопка
// «назад» подписана «Ещё», как и вкладка внизу.
const inMain = () => within(screen.getByRole('main'));

// Вкладка «Ещё» в нижней панели.
const moreTab = () => within(screen.getByRole('navigation', { name: 'Основная навигация' })).getByRole('button', { name: 'Ещё' });

// «Назад» в приложении: кнопка в шапке внутреннего экрана вызывает
// history.back(), в jsdom это асинхронный popstate.
function goBackFromInner() {
    fireEvent.click(inMain().getByRole('button', { name: 'Ещё' }));
}

// Заполняет и сохраняет лист нового счёта.
function addAccountThroughSheet(name) {
    fireEvent.click(screen.getByRole('button', { name: 'Добавить счёт' }));
    const sheet = screen.getByRole('dialog', { name: 'Новый счёт' });
    fireEvent.change(within(sheet).getByLabelText('Название'), { target: { value: name } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Сохранить' }));
}

// Разбивка по категориям живёт на вкладке «Аналитика»: на главной её больше
// нет, чтобы вкладки не повторяли друг друга.
async function openAnalytics() {
    fireEvent.click(screen.getByRole('button', { name: /Аналитика/ }));
    await waitFor(() => expect(screen.queryByText('Загрузка итогов…')).not.toBeInTheDocument());
}

describe('App Integration Tests', () => {
    beforeEach(() => {
        currentTransactions = [...mockTransactions];
        currentAccounts = [
            { _id: 'card', name: 'Карта', type: 'card', icon: '💳', isDefault: true },
            { _id: 'cash', name: 'Наличные', type: 'cash', icon: '💵', isDefault: true }
        ];
        currentCategories = [];
        fetchMock = createFetchMock();
        vi.stubGlobal('fetch', fetchMock);
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-01-15'));
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('renders content after loading', async () => {
        render(<App />);

        await waitForOverview();

        expect(screen.getAllByText(/4\.000/)[0]).toBeInTheDocument();
        // Названия приложения на Обзоре больше нет: заголовок - выбор периода.
        expect(screen.queryByText('BudgetTracker')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Период: Январь 2026' })).toHaveTextContent('Январь');
    });

    it('shows an explicit initial error offline and applies the complete data set on retry', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const onlineFetch = createFetchMock();
        let offline = true;
        fetchMock.mockImplementation((url, options) => {
            if (url === '/api/accounts' && offline) return Promise.reject(new Error('offline'));
            return onlineFetch(url, options);
        });

        render(<App />);

        expect(await screen.findByRole('heading', { name: 'Не удалось загрузить данные' })).toBeInTheDocument();
        expect(screen.queryByTestId('accounts-row')).not.toBeInTheDocument();
        // Причина, подсказка про интернет и успокоение: данные на сервере.
        expect(screen.getByRole('alert')).toHaveTextContent(
            'Не удалось подключиться к серверу. Проверьте интернет и попробуйте ещё раз. Операции хранятся на сервере и никуда не пропали.'
        );

        offline = false;
        fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));

        await waitFor(() => expect(screen.getByTestId('accounts-row')).toBeInTheDocument());
        expect(screen.getByText(/^Обновлено \d{2}:\d{2}$/)).toBeInTheDocument();
        consoleSpy.mockRestore();
    });

    it('shows the time of the last failed attempt and keeps the error screen with a disabled «Повтор…» while retrying', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const onlineFetch = createFetchMock();
        let mode = 'offline';
        let releaseRetry;
        fetchMock.mockImplementation((url, options) => {
            if (url === '/api/accounts' && mode === 'offline') return Promise.reject(new Error('offline'));
            if (url === '/api/accounts' && mode === 'hanging') {
                return new Promise(resolve => { releaseRetry = () => resolve(onlineFetch(url, options)); });
            }
            return onlineFetch(url, options);
        });
        vi.setSystemTime(new Date(2026, 0, 15, 9, 5));

        render(<App />);
        await screen.findByRole('heading', { name: 'Не удалось загрузить данные' });
        expect(screen.getByText('Последняя попытка в 09:05')).toBeInTheDocument();

        mode = 'hanging';
        fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
        // Экран ошибки остаётся, а не подменяется скелетоном; кнопка занята.
        expect(await screen.findByRole('button', { name: 'Повтор…' })).toBeDisabled();
        expect(screen.getByRole('heading', { name: 'Не удалось загрузить данные' })).toBeInTheDocument();

        await act(async () => releaseRetry());
        await waitFor(() => expect(screen.getByTestId('accounts-row')).toBeInTheDocument());
        expect(screen.queryByText(/Последняя попытка/)).not.toBeInTheDocument();

        consoleSpy.mockRestore();
    });

    it('updates the time of the last attempt when a retry fails again', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        fetchMock.mockImplementation(url => (url === '/api/accounts'
            ? Promise.reject(new Error('offline'))
            : Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) })));
        vi.setSystemTime(new Date(2026, 0, 15, 9, 5));

        render(<App />);
        await screen.findByText('Последняя попытка в 09:05');

        vi.setSystemTime(new Date(2026, 0, 15, 9, 12));
        fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
        expect(await screen.findByText('Последняя попытка в 09:12')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Повторить' })).toBeEnabled();

        consoleSpy.mockRestore();
    });

    it('starts categories and settings while the summary request is still pending', async () => {
        let resolveTransactions;
        const pendingTransactions = new Promise(resolve => { resolveTransactions = resolve; });
        const categoriesJson = vi.fn().mockResolvedValue([]);
        const settingsJson = vi.fn().mockResolvedValue({ monthlyLimit: 7000 });

        fetchMock.mockImplementation((url) => {
            if (url === '/api/accounts') {
                return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(currentAccounts) });
            }
            if (url.startsWith('/api/stats/dashboard?')) return pendingTransactions;
            if (url === '/api/categories') {
                return Promise.resolve({ ok: true, status: 200, json: categoriesJson });
            }
            if (url === '/api/settings') {
                return Promise.resolve({ ok: true, status: 200, json: settingsJson });
            }
            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
        });

        render(<App />);

        await waitFor(() => {
            expect(categoriesJson).toHaveBeenCalledTimes(1);
            expect(settingsJson).toHaveBeenCalledTimes(1);
        });
        expect(screen.getByRole('status', { name: 'Загрузка приложения…' })).toBeInTheDocument();
        expect(screen.queryByText('Загрузка...')).not.toBeInTheDocument();

        await act(async () => {
            resolveTransactions({ ok: true, status: 200, json: async () => readApi('/api/stats/dashboard?month=2026-01&today=2026-01-15', currentTransactions, currentAccounts) });
        });
        await waitForOverview();
    });

    it('changes the month from the period title in the header', async () => {
        render(<App />);

        await waitForOverview();

        // Заголовок экрана - единственный способ сменить период: месяц
        // капитализирован, год в нём - только если он не текущий.
        expect(screen.getByRole('button', { name: 'Период: Январь 2026' })).toHaveTextContent(/^Январь$/);
        expect(screen.getAllByRole('button', { name: /^Период:/ })).toHaveLength(1);
        expect(screen.getByText('Расход за январь')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /^Период:/ }));

        const dialog = screen.getByRole('dialog', { name: 'Выбор периода' });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Декабрь' }));

        await waitFor(() => {
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        });
        expect(screen.getByRole('button', { name: 'Период: Декабрь 2025' })).toHaveTextContent(/^Декабрь 2025$/);
        expect(screen.getByText('Расход за декабрь 2025')).toBeInTheDocument();
    });

    it('offers only months between the start of history and the current month', async () => {
        render(<App />);

        await waitForOverview();
        fireEvent.click(screen.getByRole('button', { name: /^Период:/ }));

        // System time is mocked to 2026-01-15, so the selectable range is
        // 2025-11 .. 2026-01: no October 2025, and no February 2026.
        const dialog = screen.getByRole('dialog', { name: 'Выбор периода' });
        expect(within(dialog).getByRole('button', { name: 'Ноябрь' })).toBeInTheDocument();
        expect(within(dialog).getByRole('button', { name: 'Январь' })).toBeInTheDocument();
        expect(within(dialog).queryByRole('button', { name: 'Октябрь' })).not.toBeInTheDocument();
        expect(within(dialog).queryByRole('button', { name: 'Февраль' })).not.toBeInTheDocument();
    });

    it('switches between the four screens from the bottom navigation, one screen at a time', async () => {
        render(<App />);

        await waitForOverview();

        const nav = screen.getByRole('navigation', { name: 'Основная навигация' });
        const tab = name => within(nav).getByRole('button', { name });
        expect(tab('Обзор')).toHaveAttribute('aria-current', 'page');
        expect(screen.getByTestId('accounts-row')).toBeInTheDocument();

        fireEvent.click(tab('Аналитика'));

        await waitFor(() => {
            expect(screen.getByRole('heading', { name: 'Категории' })).toBeInTheDocument();
        });
        // The period trigger follows you across tabs (it sits in the
        // «Аналитика» header as a chip) rather than being owned by the overview.
        expect(screen.getByRole('heading', { level: 1, name: 'Аналитика' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^Период:/ })).toHaveTextContent('Январь 2026');
        expect(tab('Аналитика')).toHaveAttribute('aria-current', 'page');
        expect(tab('Обзор')).not.toHaveAttribute('aria-current');
        // Шапка со счетами принадлежит Обзору.
        expect(screen.queryByTestId('accounts-row')).not.toBeInTheDocument();

        fireEvent.click(tab('История'));
        expect(await screen.findByTestId('history-scroll')).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: 'Категории' })).not.toBeInTheDocument();
        expect(screen.getByRole('heading', { level: 1, name: 'История' })).toBeInTheDocument();

        fireEvent.click(tab('Ещё'));
        expect(await screen.findByRole('heading', { level: 1, name: 'Ещё' })).toBeInTheDocument();
        expect(screen.queryByTestId('history-scroll')).not.toBeInTheDocument();

        fireEvent.click(tab('Обзор'));
        expect(await screen.findByTestId('accounts-row')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^Период:/ })).toBeInTheDocument();
    });

    it('reflects the screen in the hash without piling up browser history, and follows hashchange', async () => {
        render(<App />);
        await waitForOverview();
        const entries = window.history.length;

        fireEvent.click(screen.getByRole('button', { name: 'История' }));
        expect(window.location.hash).toBe('#history');
        fireEvent.click(screen.getByRole('button', { name: 'Ещё' }));
        expect(window.location.hash).toBe('#more');
        fireEvent.click(screen.getByRole('button', { name: 'Обзор' }));
        expect(window.location.hash).toBe('');
        expect(window.history.length).toBe(entries);

        act(() => {
            window.history.replaceState(null, '', '/#analytics');
            window.dispatchEvent(new HashChangeEvent('hashchange'));
        });
        expect(await screen.findByRole('heading', { name: 'Категории' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Аналитика' })).toHaveAttribute('aria-current', 'page');
    });

    it('opens on the screen named by the hash', async () => {
        window.history.replaceState(null, '', '/#more');
        render(<App />);

        expect(await screen.findByRole('heading', { level: 1, name: 'Ещё' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Ещё' })).toHaveAttribute('aria-current', 'page');
        expect(screen.queryByTestId('accounts-row')).not.toBeInTheDocument();
    });

    it('adds an expense from the center button of the bottom navigation', async () => {
        render(<App />);
        await waitForOverview();

        fireEvent.click(screen.getByRole('button', { name: 'Добавить операцию' }));

        expect(screen.getByRole('dialog', { name: 'Новый расход' })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Закрыть', exact: true }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('keeps settings out of the overview header and opens the accounts screen from «Ещё»', async () => {
        render(<App />);
        await waitForOverview();
        expect(screen.queryByTitle('Настройки')).not.toBeInTheDocument();

        openMoreRow(/^Счета/);

        expect(await screen.findByRole('heading', { level: 1, name: 'Счета' })).toBeInTheDocument();
        expect(window.location.hash).toBe('#more/accounts');
        // Внутренний экран подсвечивает «Ещё» в нижней панели.
        expect(moreTab()).toHaveAttribute('aria-current', 'page');
    });

    it('opens and closes the add transaction modal', async () => {
        render(<App />);

        await waitForOverview();

        // Быстрых кнопок «Доход / Расход / Перевод» на Обзоре больше нет: добавить
        // операцию можно «+» в нижней панели.
        expect(screen.queryByRole('button', { name: 'Добавить доход' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Добавить перевод' })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Добавить операцию' }));

        expect(screen.getByRole('dialog', { name: 'Новый расход' })).toBeInTheDocument();

        const closeBtn = screen.getByRole('button', { name: 'Закрыть', exact: true });
        fireEvent.click(closeBtn);

        await waitFor(() => {
            expect(screen.queryByRole('dialog', { name: 'Новый расход' })).not.toBeInTheDocument();
        });
    });

    it('shows what is left of the monthly limit under the amount of a new expense', async () => {
        const normalFetch = createFetchMock();
        fetchMock.mockImplementation(async (url, options) => {
            const res = await normalFetch(url, options);
            if (typeof url !== 'string' || !url.startsWith('/api/stats/dashboard')) return res;
            // Расход месяца по всем счетам - ровно то, из чего форма считает остаток
            const data = await res.json();
            data.monthlyTotalsByAccount = { ...data.monthlyTotalsByAccount, '': { '2026-01': { income: 5000, expense: -2500 } } };
            return { ...res, json: async () => data };
        });
        render(<App />);
        await waitForOverview();

        fireEvent.click(screen.getByRole('button', { name: 'Добавить операцию' }));
        const dialog = screen.getByRole('dialog', { name: 'Новый расход' });
        // лимит в тестовых настройках - 7000
        expect(within(dialog).getByTestId('limit-hint')).toHaveTextContent('После него можно потратить €4.500,00');

        fireEvent.change(within(dialog).getByPlaceholderText('0'), { target: { value: '4620.5' } });
        expect(within(dialog).getByTestId('limit-hint')).toHaveTextContent('Лимит будет превышен на €120,50');

        // доход лимит не трогает
        fireEvent.click(within(dialog).getByRole('button', { name: 'Доход' }));
        expect(within(dialog).queryByTestId('limit-hint')).not.toBeInTheDocument();
    });

    it('takes the month expense for the limit hint from the real dashboard totals', async () => {
        render(<App />);
        await waitForOverview();

        fireEvent.click(screen.getByRole('button', { name: 'Добавить операцию' }));
        // в январе потрачено 1000 из 7000
        expect(within(screen.getByRole('dialog', { name: 'Новый расход' })).getByTestId('limit-hint'))
            .toHaveTextContent('После него можно потратить €6.000,00');
    });

    it('does not offer the limit hint when editing an existing expense', async () => {
        render(<App />);
        await waitForOverview();
        await openHistory();

        fireEvent.click(screen.getByRole('button', { name: /Monthly flat rent/ }));
        const dialog = await screen.findByRole('dialog', { name: 'Редактировать' });
        expect(within(dialog).queryByTestId('limit-hint')).not.toBeInTheDocument();
    });

    it('keeps the transaction form open and reports an API save failure', async () => {
        currentCategories = [{ _id: 'food', name: 'Продукты', type: 'expense', order: 1 }];
        const normalFetch = createFetchMock();
        fetchMock.mockImplementation((url, options) => {
            if (url === '/api/transactions' && options?.method === 'POST') {
                return Promise.resolve({
                    ok: false,
                    status: 500,
                    json: () => Promise.resolve({ message: 'База временно недоступна' }),
                });
            }
            return normalFetch(url, options);
        });
        render(<App />);

        await waitForOverview();
        fireEvent.click(screen.getByRole('button', { name: 'Добавить операцию' }));
        fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '25' } });
        fireEvent.click(screen.getByText('Продукты'));
        fireEvent.click(within(screen.getByRole('dialog', { name: 'Новый расход' })).getByRole('button', { name: 'Карта', exact: true }));
        fireEvent.click(screen.getByRole('button', { name: SAVE_BUTTON_NAME }));

        expect(await screen.findByRole('alert')).toHaveTextContent('База временно недоступна');
        expect(screen.getByRole('dialog', { name: 'Новый расход' })).toBeInTheDocument();
        expect(screen.getByPlaceholderText('0')).toHaveValue(25);
        expect(fetchMock.mock.calls.filter(([url, options]) => url === '/api/transactions' && options?.method === 'POST')).toHaveLength(1);
    });

    it('keeps an edit open on a 409 and sends the loaded transaction version once', async () => {
        const normalFetch = createFetchMock();
        fetchMock.mockImplementation((url, options) => {
            if (url === '/api/transactions/2' && options?.method === 'PUT') {
                return Promise.resolve({
                    ok: false,
                    status: 409,
                    json: () => Promise.resolve({ message: 'stale' }),
                });
            }
            return normalFetch(url, options);
        });
        render(<App />);
        await waitForOverview();

        await openHistory();
        fireEvent.click(screen.getByRole('button', { name: /Monthly flat rent/ }));
        fireEvent.click(screen.getByRole('button', { name: SAVE_BUTTON_NAME }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Операция уже изменена');
        expect(screen.getByRole('dialog', { name: 'Редактировать' })).toBeInTheDocument();
        const putCalls = fetchMock.mock.calls.filter(([url, options]) => url === '/api/transactions/2' && options?.method === 'PUT');
        expect(putCalls).toHaveLength(1);
        expect(JSON.parse(putCalls[0][1].body).__v).toBe(0);
    });

    it('keeps the previous snapshot when a successful write cannot refresh, then retries GET only', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        currentCategories = [{ _id: 'food', name: 'Продукты', type: 'expense', order: 1 }];
        const normalFetch = createFetchMock();
        let failNextAccountsGet = false;
        fetchMock.mockImplementation((url, options) => {
            if (url === '/api/transactions' && options?.method === 'POST') {
                currentTransactions = [...currentTransactions, {
                    _id: 'new-expense', amount: 25, type: 'expense', account: 'card',
                    category: 'Продукты', description: 'Новая покупка', date: '2026-01-15T00:00:00Z',
                }];
                failNextAccountsGet = true;
                return Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve(currentTransactions.at(-1)) });
            }
            if (url === '/api/accounts' && !options?.method && failNextAccountsGet) {
                failNextAccountsGet = false;
                return Promise.reject(new Error('offline after write'));
            }
            return normalFetch(url, options);
        });

        render(<App />);
        await waitForOverview();
        const firstSyncLabel = screen.getByText(/^Обновлено /).textContent;

        fireEvent.click(screen.getByRole('button', { name: 'Добавить операцию' }));
        fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '25' } });
        fireEvent.click(screen.getByText('Продукты'));
        fireEvent.click(within(screen.getByRole('dialog', { name: 'Новый расход' })).getByRole('button', { name: 'Карта', exact: true }));
        fireEvent.click(screen.getByRole('button', { name: SAVE_BUTTON_NAME }));

        // Тонкая полоса вверху <main> вместо красной карточки: статус, а не alert.
        const strip = await screen.findByText(/^Не удалось обновить\. Показаны данные на /);
        expect(within(screen.getByRole('main')).getByRole('status')).toContainElement(strip);
        expect(screen.getByRole('main').firstElementChild).toContainElement(strip);
        expect(screen.queryByText('Не удалось обновить данные')).not.toBeInTheDocument();
        expect(screen.getAllByText(/4\.000/)[0]).toBeInTheDocument();

        vi.setSystemTime(new Date('2026-01-15T13:30:00Z'));
        fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));

        await waitFor(() => expect(screen.queryByText(/^Не удалось обновить\./)).not.toBeInTheDocument());
        expect(screen.getByText(/^Обновлено /).textContent).not.toBe(firstSyncLabel);
        expect(fetchMock.mock.calls.filter(([url, options]) => url === '/api/transactions' && options?.method === 'POST')).toHaveLength(1);
        consoleSpy.mockRestore();
    });

    describe('sync warning strip', () => {
        // Общая подготовка: данные загружены, дальше обновление падает.
        const renderWithFailingRefresh = async ({ holdRetry = false } = {}) => {
            const normalFetch = createFetchMock();
            let failAccountsGets = false;
            let releaseRetry;
            fetchMock.mockImplementation((url, options) => {
                if (url === '/api/accounts' && !options?.method && failAccountsGets) {
                    if (holdRetry && failAccountsGets === 'retry') {
                        return new Promise(resolve => { releaseRetry = () => resolve(normalFetch(url, options)); });
                    }
                    return Promise.reject(new Error('offline'));
                }
                return normalFetch(url, options);
            });
            render(<App />);
            await waitForOverview();
            return {
                failRefresh: () => { failAccountsGets = true; },
                holdNextRetry: () => { failAccountsGets = 'retry'; },
                recover: () => { failAccountsGets = false; },
                release: () => releaseRetry(),
            };
        };

        // Обёртка полосы: прямой ребёнок <main> с плашкой role=status внутри.
        const isStrip = element => element.parentElement?.tagName === 'MAIN'
            && element.firstElementChild?.getAttribute('role') === 'status';

        const failRefreshFromMore = async control => {
            control.failRefresh();
            goTo('Ещё');
            fireEvent.click(screen.getByRole('button', { name: /Обновить/ }));
            return screen.findByText(/^Не удалось обновить\. Показаны данные на /);
        };

        it('shows the strip on every screen and exposes its height as --status-strip-height on <main>', async () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () {
                const height = isStrip(this) ? 52.4 : 0;
                return { height, width: 0, top: 0, left: 0, right: 0, bottom: height, x: 0, y: 0, toJSON() {} };
            });
            const control = await renderWithFailingRefresh();
            expect(screen.getByRole('main').style.getPropertyValue('--status-strip-height')).toBe('0px');

            await failRefreshFromMore(control);
            const main = screen.getByRole('main');
            expect(main.style.getPropertyValue('--status-strip-height')).toBe('53px');

            // Аналитика запрашивает свои итоги заново и успешной загрузкой
            // сама снимает предупреждение, поэтому здесь её нет.
            for (const tab of ['Обзор', 'История']) {
                goTo(tab);
                expect(within(screen.getByRole('main')).getByText(/^Не удалось обновить\./)).toBeInTheDocument();
            }

            control.recover();
            fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
            await waitFor(() => expect(screen.queryByText(/^Не удалось обновить\./)).not.toBeInTheDocument());
            expect(screen.getByRole('main').style.getPropertyValue('--status-strip-height')).toBe('0px');
            rect.mockRestore();
            consoleSpy.mockRestore();
        });

        it('follows the strip height when it changes (ResizeObserver)', async () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            let height = 40;
            const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () {
                const value = isStrip(this) ? height : 0;
                return { height: value, width: 0, top: 0, left: 0, right: 0, bottom: value, x: 0, y: 0, toJSON() {} };
            });
            const observers = [];
            vi.stubGlobal('ResizeObserver', class {
                constructor(callback) { this.callback = callback; this.disconnect = vi.fn(); observers.push(this); }
                observe() {}
            });
            const control = await renderWithFailingRefresh();
            await failRefreshFromMore(control);
            expect(screen.getByRole('main').style.getPropertyValue('--status-strip-height')).toBe('40px');

            height = 76;
            await act(async () => observers.at(-1).callback());
            expect(screen.getByRole('main').style.getPropertyValue('--status-strip-height')).toBe('76px');

            control.recover();
            fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
            await waitFor(() => expect(screen.queryByText(/^Не удалось обновить\./)).not.toBeInTheDocument());
            expect(observers.at(-1).disconnect).toHaveBeenCalled();
            rect.mockRestore();
            consoleSpy.mockRestore();
        });

        it('disables the action and says «Обновление…» while the retry is in flight', async () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const control = await renderWithFailingRefresh({ holdRetry: true });
            await failRefreshFromMore(control);
            // На «Ещё» своя кнопка «Обновить» с тем же текстом занятости.
            goTo('Обзор');

            control.holdNextRetry();
            fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
            expect(await screen.findByRole('button', { name: 'Обновление…' })).toBeDisabled();

            control.recover();
            await act(async () => control.release());
            await waitFor(() => expect(screen.queryByText(/^Не удалось обновить\./)).not.toBeInTheDocument());
            consoleSpy.mockRestore();
        });
    });

    // Нажатие на категорию в Аналитике ведёт в Историю с фильтром по ней, а не
    // фильтрует саму сводку: ни один запрос итогов не несёт category=.
    describe('category breakdown on the analytics tab', () => {
        const historyUrls = () => fetchMock.mock.calls
            .map(([url]) => url)
            .filter(url => typeof url === 'string' && url.startsWith('/api/history?') && !url.includes('limit=5'));
        const statsUrls = () => fetchMock.mock.calls
            .map(([url]) => url)
            .filter(url => typeof url === 'string' && url.startsWith('/api/stats/dashboard'));

        // Месяц Истории переключается её собственным выбором месяца.
        const pickHistoryMonth = async (monthName) => {
            const section = await screen.findByTestId('history-scroll');
            fireEvent.click(within(section.querySelector('[data-history-month]')).getByRole('button', { name: /^Месяц истории:/ }));
            fireEvent.click(screen.getByRole('button', { name: monthName, exact: true }));
            await waitFor(() => expect(screen.queryByText('Загрузка операций…')).not.toBeInTheDocument());
        };

        beforeEach(() => {
            currentCategories = [{ _id: 'c1', name: 'Housing', type: 'expense', order: 1 }];
        });

        it('breaks the period expense down by category into buttons without a pressed state', async () => {
            render(<App />);
            await waitForOverview();

            await openAnalytics();
            const housing = await screen.findByRole('button', { name: /^Housing: €/ });

            // Это кнопка перехода, а не переключатель фильтра.
            expect(housing).not.toHaveAttribute('aria-pressed');
            expect(housing).toHaveTextContent('Housing');
        });

        it('opens the history filtered by the tapped category for the selected month', async () => {
            render(<App />);
            await waitForOverview();
            await openAnalytics();

            fireEvent.click(await screen.findByRole('button', { name: /^Housing: €/ }));

            expect(await screen.findByTestId('history-scroll')).toBeInTheDocument();
            expect(screen.getByRole('heading', { level: 1, name: 'История' })).toBeInTheDocument();
            const group = await screen.findByRole('group', { name: 'Фильтр по категории' });
            expect(within(group).getByRole('button', { name: 'Housing' })).toHaveAttribute('aria-pressed', 'true');
            await waitFor(() => {
                const last = historyUrls().at(-1);
                expect(last).toContain('category=Housing');
                expect(last).toContain('month=2026-01');
            });
        });

        it('resets the type filter and the search when opening a category', async () => {
            render(<App />);
            await waitForOverview();
            // Фильтр «Доходы» и поиск, оставленные в Истории, не должны скрыть
            // расходы выбранной категории.
            fireEvent.click(screen.getByRole('button', { name: /^Доход: .*открыть историю доходов$/ }));
            await waitFor(() => expect(historyUrls().at(-1)).toContain('type=income'));
            fireEvent.change(screen.getByPlaceholderText(/Поиск/), { target: { value: 'Salary' } });
            await waitFor(() => expect(historyUrls().at(-1)).toContain('q=Salary'));

            await openAnalytics();
            fireEvent.click(await screen.findByRole('button', { name: /^Housing: €/ }));

            await waitFor(() => {
                const last = historyUrls().at(-1);
                expect(last).toContain('category=Housing');
                expect(last).not.toContain('type=');
                expect(last).not.toContain('q=');
            });
        });

        it('uses the month selected in analytics, not the month the history was left on', async () => {
            render(<App />);
            await waitForOverview();
            await openHistory();
            await pickHistoryMonth('Декабрь');
            await waitFor(() => expect(historyUrls().at(-1)).toContain('month=2025-12'));

            await openAnalytics();
            fireEvent.click(await screen.findByRole('button', { name: /^Housing: €/ }));

            await waitFor(() => expect(historyUrls().at(-1)).toContain('month=2026-01'));
            expect(historyUrls().at(-1)).toContain('category=Housing');
        });

        it('keeps the month of the history when the analytics period is a year', async () => {
            render(<App />);
            await waitForOverview();
            await openAnalytics();
            fireEvent.click(screen.getByRole('button', { name: /^Период:/ }));
            fireEvent.click(within(screen.getByRole('dialog', { name: 'Выбор периода' })).getByRole('button', { name: 'Год', exact: true }));
            fireEvent.click(screen.getByRole('button', { name: '2026 год', exact: true }));
            await waitFor(() => expect(screen.queryByText('Загрузка итогов…')).not.toBeInTheDocument());

            await openHistory();
            await pickHistoryMonth('Декабрь');
            await waitFor(() => expect(historyUrls().at(-1)).toContain('month=2025-12'));
            await openAnalytics();
            fireEvent.click(await screen.findByRole('button', { name: /^Housing: €/ }));

            await waitFor(() => {
                expect(historyUrls().at(-1)).toContain('category=Housing');
                expect(historyUrls().at(-1)).toContain('month=2025-12');
            });
        });

        it('never sends a category parameter with the summary requests', async () => {
            render(<App />);
            await waitForOverview();
            await openAnalytics();
            fireEvent.click(await screen.findByRole('button', { name: /^Housing: €/ }));
            await screen.findByTestId('history-scroll');
            await openAnalytics();
            await screen.findByRole('button', { name: /^Housing: €/ });

            expect(statsUrls().length).toBeGreaterThan(0);
            statsUrls().forEach(url => expect(url).not.toContain('category='));
        });
    });

    it('displays transaction description and account/category correctly', async () => {
        render(<App />);

        await waitForOverview();
        // Операции живут в шторке, и её содержимое существует только когда
        // она раскрыта - открываем, как это делает пользователь.
        await openHistory();

        // Check for the transaction with description (Rent)
        expect(screen.getByText('Monthly flat rent')).toBeInTheDocument();

        // Subtitle text: "💳 Карта • Housing". The category name also shows
        // up in the stats panel's category breakdown, so the row itself is
        // matched through its accessible name rather than by bare text.
        const cardElements = screen.getAllByText(/Карта/);
        expect(cardElements.length).toBeGreaterThan(1);
        expect(screen.getByRole('button', { name: /Monthly flat rent.*Housing/ })).toBeInTheDocument();

        // Check for the transaction without description (Salary)
        expect(screen.getByText('Salary')).toBeInTheDocument();
    });

    it('deletes a transaction correctly', async () => {
        window.confirm = vi.fn(() => true);
        render(<App />);

        await waitForOverview();
        await openHistory();

        // Each editable row exposes a full-row button (see the accessible
        // stretched-overlay restructuring in TransactionsDrawer.jsx) rather
        // than the row div itself carrying the click handler, so it's found
        // by its accessible name instead of the inner text node.
        const rentTx = screen.getByRole('button', { name: /Monthly flat rent/ });
        fireEvent.click(rentTx);

        // Find delete button and click it
        const deleteBtn = await screen.findByRole('button', { name: 'Удалить операцию' });
        const callsBeforeDelete = fetchMock.mock.calls.length;
        fireEvent.click(deleteBtn);

        expect(window.confirm).not.toHaveBeenCalled();
        expect(fetchMock).toHaveBeenCalledWith(
            expect.stringContaining('/api/transactions/2'),
            expect.objectContaining({ method: 'DELETE' })
        );

        // handleDeleteTransaction fires the DELETE then, on success, kicks off
        // an un-awaited fetchTransactions() refetch. Wait for that follow-up
        // request (and the setState it drives) to actually land so it settles
        // inside act() before the test ends, instead of leaking into whatever
        // runs next and triggering React's "update not wrapped in act" warning.
        await waitFor(() => {
            expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBeforeDelete + 1);
        });
    });

    it('deletes an entire split group', async () => {
        // Add a split group item to mock
        const splitItem = {
            _id: 'split-1',
            splitId: 'group-123',
            title: 'Split Part 1',
            amount: 50,
            type: 'expense',
            category: 'Food',
            date: '2026-01-03T00:00:00Z',
            description: 'Grouped'
        };

        currentTransactions = [...mockTransactions, splitItem];

        window.confirm = vi.fn(() => true);
        render(<App />);
        await waitForOverview();
        await openHistory();

        // Open split sub-item via its full-row button (see the accessible
        // stretched-overlay restructuring in TransactionsDrawer.jsx) rather
        // than clicking its amount text directly.
        await waitFor(() => screen.getAllByText('€50,00'));
        fireEvent.click(screen.getByRole('button', { name: /Grouped \(Разделено\)/ }));

        // Wait for modal to open (find delete button)
        const deleteBtn = await screen.findByRole('button', { name: 'Удалить операцию' });
        const callsBeforeDelete = fetchMock.mock.calls.length;
        fireEvent.click(deleteBtn);

        expect(fetchMock).toHaveBeenCalledWith(
            expect.stringContaining('splitId=group-123'),
            expect.objectContaining({ method: 'DELETE' })
        );

        // Same as above: wait for the post-delete refetch so its setState
        // settles inside act() before the test finishes.
        await waitFor(() => {
            expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBeforeDelete + 1);
        });
    });

    it('shows the totals of the selected month in the hero, with no month carousel to swipe', async () => {
        // Декабрьская операция - чтобы у декабря были свои числа.
        currentTransactions = [...mockTransactions, {
            _id: '9',
            title: 'Декабрьская трата',
            amount: 700,
            type: 'expense',
            account: 'card',
            date: '2025-12-10T00:00:00Z',
            category: 'Housing'
        }];

        render(<App />);
        await waitForOverview();

        // Январь: расход из mockTransactions, декабрьская трата в него не
        // просочилась.
        expect(screen.getByRole('button', { name: /^Расход: €1\.000,00/ })).toBeInTheDocument();
        expect(screen.queryByText('€700,00')).not.toBeInTheDocument();
        expect(screen.queryByTestId('month-carousel')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /^Период:/ }));
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Декабрь' }));

        expect(await screen.findByRole('button', { name: /^Расход: €700,00/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^Доход: €0,00/ })).toBeInTheDocument();
    });

    it('has exactly one history button for expenses and one for income, without a pressed state', async () => {
        render(<App />);
        await waitForOverview();

        const expenseButtons = screen.getAllByRole('button', { name: /^Расход: / });
        const incomeButtons = screen.getAllByRole('button', { name: /^Доход: / });
        expect(expenseButtons).toHaveLength(1);
        expect(incomeButtons).toHaveLength(1);
        // Переход в Историю, а не переключатель.
        expect(expenseButtons[0]).not.toHaveAttribute('aria-pressed');
        expect(incomeButtons[0]).not.toHaveAttribute('aria-pressed');
    });

    describe('late-month plaque', () => {
        // Март 2026, 25-е: до конца месяца 6 дней. В эталонных месяцах
        // (февраль, январь, декабрь, ноябрь) к 25-му уходит 1000, а после -
        // ещё 600, поэтому «обычно уходит около €600».
        const referenceMonths = ['2025-11', '2025-12', '2026-01', '2026-02'].flatMap((month, index) => [
            { _id: `a${index}`, title: 'Аренда', amount: 1000, type: 'expense', account: 'card', date: `${month}-02T00:00:00Z`, category: 'Housing' },
            { _id: `b${index}`, title: 'Хвост месяца', amount: 600, type: 'expense', account: 'card', date: `${month}-28T00:00:00Z`, category: 'Food' },
        ]);
        const marchSpent = amount => ({ _id: 'm1', title: 'Март', amount, type: 'expense', account: 'card', date: '2026-03-03T00:00:00Z', category: 'Housing' });

        beforeEach(() => {
            vi.setSystemTime(new Date('2026-03-25T12:00:00'));
        });

        it('says how many days are left, what usually goes out, and the headroom to the limit', async () => {
            currentTransactions = [...referenceMonths, marchSpent(1500)];
            render(<App />);
            await waitForOverview();

            // 1500 + 600 = 2100 прогноз; 7000 - 2100 = 4900
            const plaque = await screen.findByText('До конца месяца 6 дней');
            expect(plaque.closest('[role="status"]')).toHaveTextContent(
                'С 26 по 31 число у вас обычно уходит около €600. Если так и будет, запас до лимита ≈ €4.900.'
            );
        });

        it('warns that the limit will be exceeded when the forecast is above it', async () => {
            currentTransactions = [...referenceMonths, marchSpent(6500)];
            render(<App />);
            await waitForOverview();

            // 6500 + 600 = 7100 прогноз; превышение на 100
            const plaque = await screen.findByText('До конца месяца 6 дней');
            expect(plaque.closest('[role="status"]')).toHaveTextContent('Если так и будет, лимит будет превышен примерно на €100.');
        });

        it('is not shown once the limit is already exceeded, or for another period', async () => {
            currentTransactions = [...referenceMonths, marchSpent(7500)];
            render(<App />);
            await waitForOverview();
            await screen.findByRole('button', { name: /^Расход: €7\.500,00/ });
            expect(screen.queryByText(/До конца месяца/)).not.toBeInTheDocument();
        });

        it('is not shown for a past month or for the whole year', async () => {
            currentTransactions = [...referenceMonths, marchSpent(1500)];
            render(<App />);
            await screen.findByText('До конца месяца 6 дней');

            fireEvent.click(screen.getByRole('button', { name: /^Период:/ }));
            fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Февраль' }));
            await screen.findByText('Расход за февраль');
            expect(screen.queryByText(/До конца месяца/)).not.toBeInTheDocument();

            fireEvent.click(screen.getByRole('button', { name: /^Период:/ }));
            fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Год' }));
            fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '2026 год' }));
            await screen.findByText('Расход за 2026 год');
            expect(screen.queryByText(/До конца месяца/)).not.toBeInTheDocument();
        });

        it('is not shown outside the last ten days (the 15th)', async () => {
            vi.setSystemTime(new Date('2026-03-15T12:00:00'));
            currentTransactions = [...referenceMonths, marchSpent(1500)];
            render(<App />);
            await waitForOverview();
            await screen.findByRole('button', { name: /^Расход: €1\.500,00/ });
            expect(screen.queryByText(/До конца месяца/)).not.toBeInTheDocument();
        });
    });

    it('toggles between monthly and lifetime stats', async () => {
        render(<App />);

        await waitForOverview();

        // Default is monthly income (Salary = 5000)
        expect(await screen.findByRole('button', { name: /^Доход: €5\.000,00/ })).toBeInTheDocument();

        // Switch to lifetime. "Всё время" has nothing further to pick, so it
        // applies and closes the sheet on the spot.
        fireEvent.click(screen.getByRole('button', { name: /^Период:/ }));
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Всё время' }));

        // Should show lifetime stats (same as monthly in this mock since all are in Jan 2026)
        expect(await screen.findByRole('button', { name: /^Доход: €5\.000,00/ })).toBeInTheDocument();

        // Progress bar (Limit) should be gone
        expect(screen.queryByText(/Лимит €/)).not.toBeInTheDocument();
    });

    it('keeps history continuous while dashboard periods only change its starting month', async () => {
        currentTransactions = [...mockTransactions, {
            _id: '3',
            title: 'Подарки',
            amount: 120,
            type: 'expense',
            account: 'card',
            date: '2025-12-20T00:00:00Z',
            category: 'Housing'
        }];

        render(<App />);
        await waitForOverview();
        await openHistory();

        // December follows January even when the dashboard shows one month.
        expect(await screen.findByText('Подарки')).toBeInTheDocument();

        // Период выбирается на Обзоре, а История открывается уже на нём.
        // "Всё время": every operation, whatever month it falls in.
        goTo('Обзор');
        fireEvent.click(screen.getByRole('button', { name: /^Период:/ }));
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Всё время' }));
        await openHistory();
        expect(await screen.findByText('Подарки')).toBeInTheDocument();
        expect(screen.getByText('Salary')).toBeInTheDocument();

        // "Год" 2025 anchors history in December; January is available above.
        goTo('Обзор');
        fireEvent.click(screen.getByRole('button', { name: /^Период:/ }));
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Год' }));
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '2025 год' }));
        expect(await screen.findByRole('button', { name: 'Период: 2025 год' })).toBeInTheDocument();
        await openHistory();
        expect(await screen.findByText('Подарки')).toBeInTheDocument();
        expect(screen.queryByText('Salary')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Загрузить более новые' }));
        expect(await screen.findByText('Salary')).toBeInTheDocument();
    });

    it('filters transactions by search query', async () => {
        render(<App />);

        await waitForOverview();
        await openHistory();

        // Initially shows both (Salary and Rent) in January view (since we mocked time)
        expect(screen.getByText('Salary')).toBeInTheDocument();
        expect(screen.getByText('Monthly flat rent')).toBeInTheDocument();

        // Type "Rent" in search
        const searchInput = screen.getByPlaceholderText(/Поиск/);
        fireEvent.change(searchInput, { target: { value: 'Rent' } });

        const list = within(screen.getByTestId('history-scroll'));
        await waitFor(() => {
            expect(list.queryByText('Salary')).not.toBeInTheDocument();
            expect(list.getByText('Monthly flat rent')).toBeInTheDocument();
            expect(screen.getByText(/Результаты поиска \(1\)/)).toBeInTheDocument();
        });

        // Clear search
        const clearBtn = screen.getByRole('button', { name: 'Очистить поиск' });
        fireEvent.click(clearBtn);

        // Should show both again.
        await waitFor(() => {
            expect(list.getByText('Salary')).toBeInTheDocument();
            expect(list.getByText('Monthly flat rent')).toBeInTheDocument();
            expect(screen.getByRole('heading', { level: 1, name: 'История' })).toBeInTheDocument();
        });
    });
    it('filters the history by account with the account chips', async () => {
        const cashTx = {
            _id: '3',
            title: 'Coffee',
            amount: 5,
            type: 'expense',
            account: 'cash',
            date: '2026-01-05T00:00:00Z',
            category: 'Food'
        };

        currentTransactions = [...mockTransactions, cashTx];

        render(<App />);

        await waitForOverview();
        await openHistory();
        await waitFor(() => screen.getByText('Coffee'));
        expect((await screen.findAllByText('Salary')).length).toBeGreaterThan(0);

        // Свой ряд чипов в Истории: «Все счета» и по чипу на счёт.
        const accountChips = () => within(screen.getByRole('group', { name: 'Фильтр по счёту' }));
        fireEvent.click(accountChips().getByRole('button', { name: 'Карта' }));

        // Should show Salary (card) but NOT Coffee (cash)
        await waitFor(() => {
            expect(screen.queryAllByText('Salary').length).toBeGreaterThan(0);
            expect(screen.queryByText('Coffee')).not.toBeInTheDocument();
        });
        expect(fetchMock.mock.calls.some(([url]) => typeof url === 'string' && url.startsWith('/api/history?') && url.includes('account=card'))).toBe(true);

        fireEvent.click(accountChips().getByRole('button', { name: 'Наличные' }));

        // Should show Coffee (cash) but NOT Salary (card)
        await waitFor(() => {
            expect(screen.getByText('Coffee')).toBeInTheDocument();
            expect(screen.queryByText('Salary')).not.toBeInTheDocument();
        });

        fireEvent.click(accountChips().getByRole('button', { name: 'Все счета' }));
        await waitFor(() => {
            expect(screen.getByText('Coffee')).toBeInTheDocument();
            expect(screen.getAllByText('Salary').length).toBeGreaterThan(0);
        });
    });

    it('keeps the history filters separate from the account selected on the overview', async () => {
        const cashTx = {
            _id: '3',
            title: 'Coffee',
            amount: 5,
            type: 'expense',
            account: 'cash',
            date: '2026-01-05T00:00:00Z',
            category: 'Food'
        };
        currentTransactions = [...mockTransactions, cashTx];

        render(<App />);
        await waitForOverview();

        // Счёт выбран на Обзоре...
        fireEvent.click(accountCard('Карта'));
        await waitFor(() => expect(accountCard('Карта')).toHaveAttribute('aria-pressed', 'true'));

        // ...а История его не видит: в ней по-прежнему все счета, и запрос
        // истории (40 строк) без параметра account. Блок «Последние операции»
        // на Обзоре, наоборот, счёт получает - его запрос на 5 строк.
        await openHistory();
        await waitFor(() => screen.getByText('Coffee'));
        expect(screen.getAllByText('Salary').length).toBeGreaterThan(0);
        expect(within(screen.getByRole('group', { name: 'Фильтр по счёту' })).getByRole('button', { name: 'Все счета' })).toHaveAttribute('aria-pressed', 'true');
        expect(fetchMock.mock.calls.some(([url]) => typeof url === 'string' && url.startsWith('/api/history?') && url.includes('limit=40') && url.includes('account='))).toBe(false);

        // И наоборот: фильтр Истории не меняет выбранный на Обзоре счёт.
        fireEvent.click(within(screen.getByRole('group', { name: 'Фильтр по счёту' })).getByRole('button', { name: 'Наличные' }));
        await waitFor(() => expect(screen.queryByText('Salary')).not.toBeInTheDocument());
        goTo('Обзор');
        expect(accountCard('Карта')).toHaveAttribute('aria-pressed', 'true');
        expect(accountCard('Наличные')).toHaveAttribute('aria-pressed', 'false');
    });

    it('opens the history of income from the income tile and the history of expenses from the expense figure', async () => {
        render(<App />);
        await waitForOverview();

        fireEvent.click(screen.getByRole('button', { name: /^Доход: .*открыть историю доходов$/ }));

        expect(window.location.hash).toBe('#history');
        expect(screen.getByRole('button', { name: 'История' })).toHaveAttribute('aria-current', 'page');
        expect(await screen.findByText('Тип:')).toBeInTheDocument();
        expect(screen.getByText('Доходы')).toBeInTheDocument();
        await waitFor(() => expect(screen.queryByText('Загрузка операций…')).not.toBeInTheDocument());
        const list = within(screen.getByTestId('history-scroll'));
        expect(list.getByText('Salary')).toBeInTheDocument();
        expect(list.queryByText('Monthly flat rent')).not.toBeInTheDocument();
        expect(fetchMock.mock.calls.some(([url]) => typeof url === 'string' && url.startsWith('/api/history?') && url.includes('type=income'))).toBe(true);

        goTo('Обзор');
        fireEvent.click(screen.getByRole('button', { name: /^Расход: .*открыть историю расходов$/ }));

        await waitFor(() => expect(screen.getByText('Расходы')).toBeInTheDocument());
        await waitFor(() => expect(screen.queryByText('Загрузка операций…')).not.toBeInTheDocument());
        const expenses = within(screen.getByTestId('history-scroll'));
        expect(expenses.getByText('Monthly flat rent')).toBeInTheDocument();
        expect(expenses.queryByText('Salary')).not.toBeInTheDocument();
    });

    it('selects an account by tapping its card: one at a time, with a pending summary while it loads', async () => {
        render(<App />);
        await waitForOverview();

        // Порядок: «Все счета», затем счета. Выбрано «Все счета».
        expect(accountCard('Все счета')).toHaveAttribute('aria-pressed', 'true');
        expect(accountCard('Карта')).toHaveAttribute('aria-pressed', 'false');

        fireEvent.click(accountCard('Карта'));

        await waitFor(() => expect(accountCard('Карта')).toHaveAttribute('aria-pressed', 'true'));
        expect(accountCard('Наличные')).toHaveAttribute('aria-pressed', 'false');
        expect(accountCard('Все счета')).toHaveAttribute('aria-pressed', 'false');
        await waitFor(() => expect(screen.getByTestId('account-summary')).not.toHaveClass('account-summary--pending'));

        // Повторное нажатие на выбранную карточку выбор не снимает.
        fireEvent.click(accountCard('Карта'));
        expect(accountCard('Карта')).toHaveAttribute('aria-pressed', 'true');

        fireEvent.click(accountCard('Все счета'));
        await waitFor(() => expect(accountCard('Все счета')).toHaveAttribute('aria-pressed', 'true'));
        expect(accountCard('Карта')).toHaveAttribute('aria-pressed', 'false');
    });

    it('does not change the selected account when the accounts row is scrolled', async () => {
        render(<App />);
        await waitForOverview();
        fireEvent.click(accountCard('Карта'));
        await waitFor(() => expect(accountCard('Карта')).toHaveAttribute('aria-pressed', 'true'));
        await waitFor(() => expect(screen.getByTestId('account-summary')).not.toHaveClass('account-summary--pending'));
        const requestsBefore = fetchMock.mock.calls.length;

        // Раньше осевшая прокрутка выбирала ближайшую карточку; теперь
        // лента листается свободно, а выбор делает только нажатие.
        const row = screen.getByTestId('accounts-row');
        row.scrollLeft = 400;
        fireEvent.scroll(row);
        await new Promise(resolve => setTimeout(resolve, 200));

        expect(accountCard('Карта')).toHaveAttribute('aria-pressed', 'true');
        expect(accountCard('Все счета')).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByTestId('account-summary')).not.toHaveClass('account-summary--pending');
        expect(fetchMock.mock.calls.length).toBe(requestsBefore);
    });

    it('filters the recent operations by the account selected on the overview', async () => {
        const cashTx = {
            _id: '3',
            title: 'Coffee',
            amount: 5,
            type: 'expense',
            account: 'cash',
            date: '2026-01-05T00:00:00Z',
            category: 'Food'
        };
        currentTransactions = [...mockTransactions, cashTx];

        render(<App />);
        await waitForOverview();

        const recent = () => within(screen.getByRole('region', { name: 'Последние операции' }));
        expect(await recent().findByText('Coffee')).toBeInTheDocument();
        expect(recent().getByText('Monthly flat rent')).toBeInTheDocument();
        const recentUrl = fetchMock.mock.calls.map(([url]) => url).find(url => typeof url === 'string' && url.includes('limit=5'));
        expect(recentUrl).toBe('/api/history?month=2026-01&continuous=1&limit=5');

        fireEvent.click(accountCard('Наличные'));

        await waitFor(() => expect(recent().queryByText('Monthly flat rent')).not.toBeInTheDocument());
        expect(recent().getByText('Coffee')).toBeInTheDocument();
        expect(fetchMock.mock.calls.some(([url]) => url === '/api/history?month=2026-01&continuous=1&limit=5&account=cash')).toBe(true);
    });

    it('в начале месяца показывает итог прошлого и по нажатию открывает этот месяц', async () => {
        currentTransactions = [{
            _id: 'd1', title: 'Rent', amount: 6890, type: 'expense', account: 'card',
            date: '2025-12-02T00:00:00Z', category: 'Food',
        }];

        render(<App />);
        await waitForOverview();

        expect(await screen.findByText('Месяц только начался, весь лимит впереди')).toBeInTheDocument();
        fireEvent.click(await screen.findByRole('button', { name: /Декабрь закрыт/ }));

        expect(await screen.findByText(/Расход за декабрь/)).toBeInTheDocument();
    });

    it('в пустых «Последних операциях» кнопка «Добавить расход» открывает форму расхода', async () => {
        currentTransactions = [];

        render(<App />);
        await waitForOverview();

        const recent = within(screen.getByRole('region', { name: 'Последние операции' }));
        fireEvent.click(await recent.findByRole('button', { name: 'Добавить расход' }));

        expect(await screen.findByRole('dialog', { name: /Новый расход/ })).toBeInTheDocument();
    });

    it('shows the five newest operations, opens one for editing and has a link to the whole history', async () => {
        currentTransactions = Array.from({ length: 7 }, (_, index) => ({
            _id: `t${index + 1}`,
            title: `Покупка ${index + 1}`,
            amount: 10 + index,
            type: 'expense',
            account: 'card',
            date: `2026-01-0${index + 1}T00:00:00Z`,
            category: 'Food',
        }));

        render(<App />);
        await waitForOverview();

        const recent = within(screen.getByRole('region', { name: 'Последние операции' }));
        expect(await recent.findByText('Покупка 7')).toBeInTheDocument();
        expect(recent.getByText('Покупка 3')).toBeInTheDocument();
        expect(recent.queryByText('Покупка 2')).not.toBeInTheDocument();
        expect(recent.queryByText('Покупка 1')).not.toBeInTheDocument();

        // Список лежит прямо на сером фоне: белые карточки в нём - это дни,
        // внешней карточки вокруг всего списка нет.
        const region = screen.getByRole('region', { name: 'Последние операции' });
        expect(region.querySelector('.glass-panel')).toBeNull();
        const dayCard = region.querySelector('[data-history-date]').children[1];
        expect(dayCard.style.background).toBe('var(--color-surface)');
        expect(region.querySelector('[data-history-date]').parentElement.style.background).toBe('');

        fireEvent.click(recent.getByRole('button', { name: /^Покупка 7/ }));
        expect(await screen.findByRole('dialog', { name: 'Редактировать' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Закрыть', exact: true }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

        fireEvent.click(screen.getByRole('button', { name: 'Вся история' }));
        expect(window.location.hash).toBe('#history');
        expect(await screen.findByTestId('history-scroll')).toBeInTheDocument();
    });

    it('says there are no operations yet, and offers a retry when the list cannot be loaded', async () => {
        currentTransactions = [];
        const normalFetch = createFetchMock();
        let failRecent = true;
        fetchMock.mockImplementation((url, options) => {
            if (typeof url === 'string' && url.includes('limit=5') && failRecent) {
                return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ message: 'boom' }) });
            }
            return normalFetch(url, options);
        });

        render(<App />);
        await waitForOverview();

        const recent = within(screen.getByRole('region', { name: 'Последние операции' }));
        expect(await recent.findByText('Не удалось загрузить операции')).toBeInTheDocument();

        failRecent = false;
        fireEvent.click(recent.getByRole('button', { name: 'Повторить' }));

        expect(await recent.findByText('Операций пока нет')).toBeInTheDocument();
        expect(recent.queryByText('Не удалось загрузить операции')).not.toBeInTheDocument();
    });

    it('opens the accounts screen from «Настроить» and Back returns to the overview', async () => {
        render(<App />);
        await waitForOverview();

        fireEvent.click(within(screen.getByRole('region', { name: 'Счета' })).getByRole('button', { name: 'Настроить' }));

        expect(await screen.findByRole('heading', { level: 1, name: 'Счета' })).toBeInTheDocument();
        expect(window.location.hash).toBe('#more/accounts');
        expect(screen.queryByTestId('accounts-row')).not.toBeInTheDocument();

        goBackFromInner();

        // Запись в истории добавлена openInner, поэтому «назад» возвращает на
        // Обзор, а не на «Ещё»: хэш снова пустой.
        expect(await screen.findByTestId('accounts-row')).toBeInTheDocument();
        expect(window.location.hash).toBe('');
        expect(screen.queryByRole('heading', { level: 1, name: 'Счета' })).not.toBeInTheDocument();
    });

    it('opens an inner screen from «Ещё» and closes it with the system Back (popstate)', async () => {
        render(<App />);
        await waitForOverview();
        goTo('Ещё');
        fireEvent.click(screen.getByRole('button', { name: /^Категории/ }));
        expect(await screen.findByRole('heading', { level: 1, name: 'Категории' })).toBeInTheDocument();
        expect(window.location.hash).toBe('#more/categories');

        // Системный жест «назад»: браузер возвращает прежнюю запись и шлёт popstate.
        act(() => {
            window.history.replaceState(null, '', '/#more');
            window.dispatchEvent(new PopStateEvent('popstate'));
        });

        expect(await screen.findByRole('heading', { level: 1, name: 'Ещё' })).toBeInTheDocument();
        expect(screen.queryByRole('heading', { level: 1, name: 'Категории' })).not.toBeInTheDocument();
        expect(moreTab()).toHaveAttribute('aria-current', 'page');
    });

    it('opens an inner screen directly after a reload on #more/categories, and Back replaces it with #more', async () => {
        window.history.replaceState(null, '', '/#more/categories');
        render(<App />);

        expect(await screen.findByRole('heading', { level: 1, name: 'Категории' })).toBeInTheDocument();
        expect(moreTab()).toHaveAttribute('aria-current', 'page');
        const entries = window.history.length;

        fireEvent.click(inMain().getByRole('button', { name: 'Ещё' }));

        expect(await screen.findByRole('heading', { level: 1, name: 'Ещё' })).toBeInTheDocument();
        expect(window.location.hash).toBe('#more');
        expect(window.history.length).toBe(entries);
    });

    it('replaces an inner screen with the tapped tab instead of stacking history', async () => {
        render(<App />);
        await waitForOverview();
        openMoreRow(/^Корзина/);
        expect(await screen.findByRole('heading', { level: 1, name: 'Корзина' })).toBeInTheDocument();

        goTo('История');
        expect(await screen.findByTestId('history-scroll')).toBeInTheDocument();
        expect(window.location.hash).toBe('#history');

        openMoreRow(/^Категории/);
        expect(await screen.findByRole('heading', { level: 1, name: 'Категории' })).toBeInTheDocument();
        // «Ещё» из внутреннего экрана - обратно в меню.
        goTo('Ещё');
        expect(await screen.findByRole('heading', { level: 1, name: 'Ещё' })).toBeInTheDocument();
        expect(window.location.hash).toBe('#more');
    });

    it('scrolls the selected card into view when the row is mounted again after switching tabs', async () => {
        render(<App />);
        await waitForOverview();

        fireEvent.click(accountCard('Карта'));
        await waitFor(() => expect(accountCard('Карта')).toHaveAttribute('aria-pressed', 'true'));

        // Лента живёт только на Обзоре: с него уходим, и она исчезает из дерева.
        goTo('История');
        expect(screen.queryByTestId('accounts-row')).not.toBeInTheDocument();
        Element.prototype.scrollIntoView.mockClear();

        // Вернувшись, она рождается с нулевой прокруткой и должна подвести
        // выбранную карточку в видимую область, а выбор - остаться прежним.
        goTo('Обзор');
        const card = accountCard('Карта');
        expect(Element.prototype.scrollIntoView.mock.contexts).toContain(card);
        expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ inline: 'nearest', block: 'nearest' });
        expect(card).toHaveAttribute('aria-pressed', 'true');
    });

    it('clears the selection when the currently selected account is deleted', async () => {
        currentAccounts = [
            { _id: 'card', name: 'Карта', type: 'card', icon: '💳', isDefault: true },
            { _id: 'cash', name: 'Наличные', type: 'cash', icon: '💵', isDefault: true },
            { _id: 'wallet', name: 'Кошелёк', type: 'cash', icon: '👛', isDefault: false }
        ];
        const confirmSpy = vi.spyOn(window, 'confirm').mockImplementation(() => true);

        render(<App />);
        await waitForOverview();

        // Select the account we're about to delete.
        fireEvent.click(accountCard('Кошелёк'));
        await waitFor(() => {
            expect(accountCard('Кошелёк')).toHaveAttribute('aria-pressed', 'true');
        });

        // Delete it through the account sheet: the confirmation is inline.
        openMoreRow(/^Счета/);
        fireEvent.click(await screen.findByRole('button', { name: /^Кошелёк/ }));
        const sheet = await screen.findByRole('dialog', { name: 'Счёт' });
        fireEvent.click(within(sheet).getByRole('button', { name: 'Удалить счёт' }));
        expect(fetchMock).not.toHaveBeenCalledWith('/api/accounts/wallet', expect.objectContaining({ method: 'DELETE' }));
        fireEvent.click(within(sheet).getByRole('button', { name: 'Удалить' }));

        expect(confirmSpy).not.toHaveBeenCalled();

        // The filter pointed at an id that no longer exists - it must be reset
        // and the selection taken back to «Все счета». Экран счетов лежит под
        // «Ещё», поэтому на Обзор переходим вкладкой.
        await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/accounts/wallet', expect.objectContaining({ method: 'DELETE' })));
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Счёт' })).not.toBeInTheDocument());
        expect(screen.queryByRole('button', { name: /^Кошелёк/ })).not.toBeInTheDocument();
        goTo('Обзор');
        await waitFor(() => {
            expect(accountCard('Все счета')).toHaveAttribute('aria-pressed', 'true');
        });
        expect(screen.queryByRole('button', { name: /^Кошелёк: / })).not.toBeInTheDocument();
    });

    it('adds an account through the sheet, shows it in the list and on the overview', async () => {
        const baseFetch = fetchMock.getMockImplementation();
        fetchMock.mockImplementation((url, options) => {
            if (url === '/api/accounts' && options?.method === 'POST') {
                const body = JSON.parse(options.body);
                currentAccounts = [...currentAccounts, { _id: 'revolut', ...body }];
                return Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve(currentAccounts[currentAccounts.length - 1]) });
            }
            return baseFetch(url, options);
        });

        render(<App />);
        await waitForOverview();
        openMoreRow(/^Счета/);
        await screen.findByRole('heading', { level: 1, name: 'Счета' });

        addAccountThroughSheet('Revolut');

        await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/accounts', expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ name: 'Revolut', type: 'card', icon: 'credit-card', excludeFromTotal: false }),
        })));
        // Лист закрылся только после успешного ответа, список перечитан.
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Новый счёт' })).not.toBeInTheDocument());
        expect(inMain().getByRole('button', { name: /^Revolut/ })).toBeInTheDocument();

        goTo('Обзор');
        expect(await screen.findByLabelText(/^Revolut: /)).toBeInTheDocument();
    });

    it('edits an account through the sheet: the type is fixed, the name and the frozen flag are saved', async () => {
        const baseFetch = fetchMock.getMockImplementation();
        fetchMock.mockImplementation((url, options) => {
            if (url === '/api/accounts/card' && options?.method === 'PUT') {
                const body = JSON.parse(options.body);
                currentAccounts = currentAccounts.map(a => (a._id === 'card' ? { ...a, ...body } : a));
                return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
            }
            return baseFetch(url, options);
        });

        render(<App />);
        await waitForOverview();
        openMoreRow(/^Счета/);
        fireEvent.click(await screen.findByRole('button', { name: /^Карта/ }));

        const sheet = await screen.findByRole('dialog', { name: 'Счёт' });
        expect(within(sheet).getByLabelText('Название')).toHaveValue('Карта');
        // У существующего счёта тип показывается строкой, а не переключателем.
        expect(within(sheet).queryByRole('radiogroup', { name: 'Тип счёта' })).not.toBeInTheDocument();
        fireEvent.change(within(sheet).getByLabelText('Название'), { target: { value: 'Основная карта' } });
        fireEvent.click(within(sheet).getByRole('switch', { name: 'Не учитывать в общем капитале' }));
        fireEvent.click(within(sheet).getByRole('button', { name: 'Сохранить' }));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/accounts/card', expect.objectContaining({
            method: 'PUT',
            body: JSON.stringify({ name: 'Основная карта', icon: 'credit-card', excludeFromTotal: true }),
        })));
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Счёт' })).not.toBeInTheDocument());
        expect(inMain().getByRole('button', { name: /^Основная карта/ })).toBeInTheDocument();
    });

    it('keeps the account sheet open and shows the server reason when the save is refused', async () => {
        const baseFetch = fetchMock.getMockImplementation();
        fetchMock.mockImplementation((url, options) => {
            if (url === '/api/accounts' && options?.method === 'POST') {
                return Promise.resolve({ ok: false, status: 400, json: () => Promise.resolve({ message: 'Счёт с таким названием уже есть' }) });
            }
            return baseFetch(url, options);
        });

        render(<App />);
        await waitForOverview();
        openMoreRow(/^Счета/);
        addAccountThroughSheet('Карта');

        expect(await screen.findByRole('alert')).toHaveTextContent('Счёт с таким названием уже есть');
        expect(screen.getByRole('dialog', { name: 'Новый счёт' })).toBeInTheDocument();
    });

    it('closes the account sheet when the system Back leaves the accounts screen', async () => {
        render(<App />);
        await waitForOverview();
        openMoreRow(/^Счета/);
        fireEvent.click(await screen.findByRole('button', { name: 'Добавить счёт' }));
        expect(screen.getByRole('dialog', { name: 'Новый счёт' })).toBeInTheDocument();

        act(() => {
            window.history.replaceState(null, '', '/#more');
            window.dispatchEvent(new PopStateEvent('popstate'));
        });

        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Новый счёт' })).not.toBeInTheDocument());
        expect(screen.getByRole('heading', { level: 1, name: 'Ещё' })).toBeInTheDocument();
    });

    it('adds a category from the categories screen', async () => {
        currentCategories = [{ _id: 'c1', name: 'Продукты', type: 'expense', order: 1 }];
        const baseFetch = fetchMock.getMockImplementation();
        fetchMock.mockImplementation((url, options) => {
            if (url === '/api/categories' && options?.method === 'POST') {
                const body = JSON.parse(options.body);
                const saved = { _id: 'c2', order: 2, ...body };
                currentCategories = [...currentCategories, saved];
                return Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve(saved) });
            }
            return baseFetch(url, options);
        });

        render(<App />);
        await waitForOverview();
        openMoreRow(/^Категории/);
        fireEvent.click(await screen.findByRole('button', { name: 'Новая категория' }));
        fireEvent.change(screen.getByLabelText('Новая категория', { selector: 'input' }), { target: { value: 'Кафе' } });
        fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/categories', expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ name: 'Кафе', type: 'expense' }),
        })));
        expect(await screen.findByLabelText('Действия: Кафе')).toBeInTheDocument();
        // Поле закрылось только после успеха.
        expect(screen.queryByRole('button', { name: 'Добавить' })).not.toBeInTheDocument();
    });

    it('keeps the new-category field open and reports the server reason when the add is refused', async () => {
        const baseFetch = fetchMock.getMockImplementation();
        fetchMock.mockImplementation((url, options) => {
            if (url === '/api/categories' && options?.method === 'POST') {
                return Promise.resolve({ ok: false, status: 400, json: () => Promise.resolve({ message: 'Категория уже существует' }) });
            }
            return baseFetch(url, options);
        });

        render(<App />);
        await waitForOverview();
        openMoreRow(/^Категории/);
        fireEvent.click(await screen.findByRole('button', { name: 'Новая категория' }));
        fireEvent.change(screen.getByLabelText('Новая категория', { selector: 'input' }), { target: { value: 'Еда' } });
        fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Категория уже существует');
        expect(screen.getByLabelText('Новая категория', { selector: 'input' })).toHaveValue('Еда');
    });

    it('saves the monthly limit from the sheet, shows the notice and updates the row in «Ещё»', async () => {
        let savedLimit = 7000;
        const baseFetch = fetchMock.getMockImplementation();
        fetchMock.mockImplementation((url, options) => {
            if (url === '/api/settings' && options?.method === 'PUT') {
                savedLimit = JSON.parse(options.body).monthlyLimit;
                return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ monthlyLimit: savedLimit }) });
            }
            if (url === '/api/settings') {
                return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ monthlyLimit: savedLimit }) });
            }
            return baseFetch(url, options);
        });

        render(<App />);
        await waitForOverview();
        openMoreRow(/^Лимит трат/);

        const sheet = await screen.findByRole('dialog', { name: 'Лимит трат в месяц' });
        // График «за последние 6 месяцев» - из месячных итогов приложения.
        expect(within(sheet).getByTestId('limit-chart')).toBeInTheDocument();
        fireEvent.change(within(sheet).getByLabelText('Сумма лимита в евро'), { target: { value: '1500' } });
        fireEvent.click(within(sheet).getByRole('button', { name: 'Сохранить' }));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/settings', expect.objectContaining({
            method: 'PUT',
            body: JSON.stringify({ monthlyLimit: 1500 }),
        })));
        expect(await screen.findByText('Лимит обновлён')).toBeInTheDocument();
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Лимит трат в месяц' })).not.toBeInTheDocument());
        expect(screen.getByRole('button', { name: /^Лимит трат/ })).toHaveTextContent('€1.500');
    });

    it('keeps the limit sheet open and reports the reason when the server rejects the limit', async () => {
        const baseFetch = fetchMock.getMockImplementation();
        fetchMock.mockImplementation((url, options) => {
            if (url === '/api/settings' && options?.method === 'PUT') {
                return Promise.resolve({ ok: false, status: 400, json: () => Promise.resolve({ message: 'Лимит должен быть положительным' }) });
            }
            return baseFetch(url, options);
        });

        render(<App />);
        await waitForOverview();
        openMoreRow(/^Лимит трат/);
        const sheet = await screen.findByRole('dialog', { name: 'Лимит трат в месяц' });
        fireEvent.change(within(sheet).getByLabelText('Сумма лимита в евро'), { target: { value: '1500' } });
        fireEvent.click(within(sheet).getByRole('button', { name: 'Сохранить' }));

        expect(await screen.findByText('Лимит должен быть положительным')).toBeInTheDocument();
        expect(screen.getByRole('dialog', { name: 'Лимит трат в месяц' })).toBeInTheDocument();
        expect(screen.queryByText('Лимит обновлён')).not.toBeInTheDocument();
    });

    it('держит замороженный счёт вне общего капитала и подписывает сумму отдельно', async () => {
        currentAccounts = [
            { _id: 'card', name: 'Карта', type: 'card', icon: '💳', isDefault: true },
            { _id: 'dep', name: 'Залог', type: 'card', icon: '🏠', excludeFromTotal: true },
        ];
        currentTransactions = [
            { _id: '1', title: 'Salary', amount: 5000, type: 'income', account: 'card', date: '2026-01-01T00:00:00Z', category: 'Job' },
            { _id: '2', title: 'Депозит', amount: 1500, type: 'transfer', account: 'card', toAccount: 'dep', date: '2026-01-03T00:00:00Z' },
        ];

        render(<App />);
        await screen.findByLabelText(/Все счета: /);

        // 5000 - 1500: залог в капитал не входит, но и не исчезает - он
        // назван отдельной строкой на той же карточке.
        expect(screen.getByLabelText(/Все счета: €3\.500,00/)).toBeInTheDocument();
        expect(screen.getByText('1.500,00 € заморожено')).toBeInTheDocument();
        expect(screen.getByLabelText(/Залог: €1\.500,00, вне общего капитала/)).toBeInTheDocument();
    });

    it('удаляет категорию из настроек и снимает фильтр, стоявший на ней', async () => {
        currentCategories = [
            { _id: 'c1', name: 'Продукты', type: 'expense', order: 1 },
            { _id: 'c2', name: 'Подписки', type: 'expense', order: 2 },
        ];
        currentTransactions = [
            { _id: '1', title: 'Netflix', amount: 20, type: 'expense', account: 'card', date: '2026-01-05T00:00:00Z', category: 'Подписки' },
        ];

        const confirmSpy = vi.spyOn(window, 'confirm').mockImplementation(() => true);

        render(<App />);
        await screen.findByRole('button', { name: 'Ещё' });

        // Ставим фильтр Истории на категорию, которую сейчас удалим: нажатием
        // на неё в разбивке расхода на вкладке «Аналитика».
        await openAnalytics();
        fireEvent.click(await screen.findByRole('button', { name: /^Подписки: €/ }));
        expect(await screen.findByText('Категория:')).toBeInTheDocument();

        openMoreRow(/^Категории/);
        fireEvent.click(await screen.findByLabelText('Действия: Подписки'));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Удалить' }));

        // Подтверждение встроено в строку и называет число операций; запроса
        // на удаление до него нет, системный confirm не вызывается.
        const confirmation = screen.getByRole('group', { name: 'Удаление категории: Подписки' });
        expect(confirmation).toHaveTextContent(/1 операци/);
        expect(fetchMock).not.toHaveBeenCalledWith('/api/categories/c2', expect.objectContaining({ method: 'DELETE' }));
        fireEvent.click(within(confirmation).getByRole('button', { name: 'Удалить' }));

        await waitFor(() => {
            expect(fetchMock).toHaveBeenCalledWith('/api/categories/c2', expect.objectContaining({ method: 'DELETE' }));
        });
        expect(confirmSpy).not.toHaveBeenCalled();
        await waitFor(() => expect(screen.queryByLabelText('Действия: Подписки')).not.toBeInTheDocument());
        expect(screen.getByLabelText('Действия: Продукты')).toBeInTheDocument();
        // Фильтр указывал на исчезнувшую категорию - его нужно снять.
        await openHistory();
        expect(screen.queryByText('Категория:')).not.toBeInTheDocument();
    });

    it('переименовывает категорию, переписывает историю и переносит фильтр на новое имя', async () => {
        currentCategories = [
            { _id: 'c1', name: 'Продукты', type: 'expense', order: 1 },
            { _id: 'c2', name: 'Подписки', type: 'expense', order: 2 },
        ];
        currentTransactions = [
            { _id: '1', title: 'Netflix', amount: 20, type: 'expense', account: 'card', date: '2026-01-05T00:00:00Z', category: 'Подписки' },
        ];

        render(<App />);
        await screen.findByRole('button', { name: 'Ещё' });

        // Фильтр Истории стоит на категории, которую сейчас переименуем: он
        // выставлен нажатием на неё в разбивке на «Аналитике» и должен
        // переехать на новое имя.
        await openAnalytics();
        fireEvent.click(await screen.findByRole('button', { name: /^Подписки: €/ }));
        expect(await screen.findByText('Категория:')).toBeInTheDocument();

        openMoreRow(/^Категории/);
        fireEvent.click(await screen.findByLabelText('Действия: Подписки'));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Переименовать' }));
        // Подпись поля называет, сколько операций затронет переименование.
        fireEvent.change(screen.getByLabelText(/^Новое название · изменится в 1 операци/), { target: { value: 'Сервисы' } });
        fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

        await waitFor(() => {
            expect(fetchMock).toHaveBeenCalledWith('/api/categories/c2', expect.objectContaining({
                method: 'PUT',
                body: JSON.stringify({ name: 'Сервисы' }),
            }));
        });
        // Список категорий перечитан - строка уже под новым именем.
        expect(await screen.findByLabelText('Действия: Сервисы')).toBeInTheDocument();
        expect(screen.queryByLabelText('Действия: Подписки')).not.toBeInTheDocument();

        // Итоги перечитаны: разбивка расхода знает только новое имя.
        await openAnalytics();
        expect(await screen.findByRole('button', { name: /^Сервисы: €/ })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^Подписки: €/ })).not.toBeInTheDocument();

        // Фильтр Истории переехал на новое имя тоже: список перечитан по нему.
        await openHistory();
        expect(screen.getByText('Категория:').parentElement).toHaveTextContent('Сервисы');
        expect(within(screen.getByRole('group', { name: 'Фильтр по категории' })).getByRole('button', { name: 'Сервисы' })).toHaveAttribute('aria-pressed', 'true');
        expect(within(screen.getByTestId('history-scroll')).getByText('Netflix')).toBeInTheDocument();
    });

    // Finding 3: a non-ok response (or one whose body isn't actually an
    // array - e.g. the 503 an unconfigured server returns, `{ message }`
    // instead of a list) used to get assigned straight into state, and the
    // later `.map(...)` over it threw, tripping the error boundary. It must
    // instead surface the server's own message via the notice banner and
    // leave state alone, rather than crashing or staying silently blank.
    it('shows the server message in the initial error state when /api/accounts responds with a non-array body', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.stubGlobal('fetch', vi.fn((url) => {
            const data = readApi(url, currentTransactions, currentAccounts);
            if (data !== undefined) return Promise.resolve({ ok: true, status: 200, json: async () => data });
            if (typeof url === 'string' && url.includes('/api/accounts')) {
                return Promise.resolve({
                    ok: false,
                    status: 503,
                    json: () => Promise.resolve({ message: 'Сервер не настроен: отсутствуют переменные окружения APP_PASSWORD/SESSION_SECRET.' })
                });
            }
            if (typeof url === 'string' && url.includes('/api/categories')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
        }));

        render(<App />);

        // Must not expose empty financial UI as a successful load.
        await waitFor(() => {
            expect(screen.getByText(/Сервер не настроен/)).toBeInTheDocument();
        });
        expect(screen.getByRole('heading', { name: 'Не удалось загрузить данные' })).toBeInTheDocument();
        expect(screen.queryByTestId('accounts-row')).not.toBeInTheDocument();

        consoleSpy.mockRestore();
        vi.unstubAllGlobals();
    });

    // Finding 4: the server now rejects saving a non-finite/non-positive
    // monthlyLimit, but a stale value could still be sitting in the settings
    // document from before that validation existed. fetchSettings' own guard
    // (typeof === 'number' && !isNaN) lets a legitimate-looking 0 through, so
    // the render-side guard is what actually has to catch it here.
    it('rejects an invalid settings response instead of treating the default limit as synchronized', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.stubGlobal('fetch', vi.fn((url) => {
            const data = readApi(url, currentTransactions, currentAccounts);
            if (data !== undefined) return Promise.resolve({ ok: true, status: 200, json: async () => data });
            if (typeof url === 'string' && url.includes('/api/settings')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ monthlyLimit: 0 }) });
            }
            if (typeof url === 'string' && url.includes('/api/accounts')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve(currentAccounts) });
            }
            if (typeof url === 'string' && url.includes('/api/categories')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve(currentTransactions) });
        }));

        render(<App />);
        expect(await screen.findByText(/Сервер вернул некорректные настройки/)).toBeInTheDocument();
        expect(screen.queryByTestId('accounts-row')).not.toBeInTheDocument();

        consoleSpy.mockRestore();
        vi.unstubAllGlobals();
    });

    // Сообщения об ошибке и успехе - тосты над нижней панелью.
    describe('notice toast', () => {
        // Прячет таймер автозакрытия на 5 секунд, чтобы сработал сразу.
        const captureAutoDismiss = () => {
            const real = globalThis.setTimeout;
            const fired = [];
            const spy = vi.spyOn(globalThis, 'setTimeout').mockImplementation((callback, delay, ...rest) => {
                if (delay === 5000) { fired.push(callback); return 0; }
                return real(callback, delay, ...rest);
            });
            return { fired, restore: () => spy.mockRestore() };
        };

        const failLogout = async () => {
            const baseMock = fetchMock;
            vi.stubGlobal('fetch', vi.fn((url, options) => {
                if (typeof url === 'string' && url.includes('/api/logout')) {
                    return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
                }
                return baseMock(url, options);
            }));
            goTo('Ещё');
            fireEvent.click(screen.getByRole('button', { name: 'Выйти' }));
            return screen.findByRole('alert');
        };

        it('shows an error as an alert toast above the bottom bar, closable, and dismisses itself after 5 seconds', async () => {
            render(<App />);
            await waitForOverview();
            const timer = captureAutoDismiss();

            const toast = await failLogout();
            expect(toast).toHaveTextContent('Не удалось выйти. Попробуйте ещё раз.');
            // Над панелью: высота панели, минимальный зазор под ней и 16px.
            expect(toast.style.bottom).toBe('88px');
            expect(within(toast).getByRole('button', { name: 'Закрыть' })).toBeInTheDocument();

            expect(timer.fired).toHaveLength(1);
            act(() => timer.fired[0]());
            expect(screen.queryByRole('alert')).not.toBeInTheDocument();
            timer.restore();
        });

        it('closes with the close button', async () => {
            render(<App />);
            await waitForOverview();

            const toast = await failLogout();
            fireEvent.click(within(toast).getByRole('button', { name: 'Закрыть' }));
            expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        });

        it('shows a success as a polite status toast, not an alert', async () => {
            const baseFetch = fetchMock.getMockImplementation();
            fetchMock.mockImplementation((url, options) => {
                if (url === '/api/settings' && options?.method === 'PUT') {
                    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ monthlyLimit: 1500 }) });
                }
                return baseFetch(url, options);
            });
            render(<App />);
            await waitForOverview();
            openMoreRow(/^Лимит трат/);
            const sheet = await screen.findByRole('dialog', { name: 'Лимит трат в месяц' });
            fireEvent.change(within(sheet).getByLabelText('Сумма лимита в евро'), { target: { value: '1500' } });
            fireEvent.click(within(sheet).getByRole('button', { name: 'Сохранить' }));

            const message = await screen.findByText('Лимит обновлён');
            const toast = message.closest('[role]');
            expect(toast).toHaveAttribute('role', 'status');
            expect(screen.queryByRole('alert')).not.toBeInTheDocument();
            fireEvent.click(within(toast).getByRole('button', { name: 'Закрыть' }));
            expect(screen.queryByText('Лимит обновлён')).not.toBeInTheDocument();
        });
    });

    // Finding 1: logout must only switch the UI to the logged-out state once
    // the server has actually confirmed the session cookie is cleared. This
    // is nested here (rather than a sibling describe) so it inherits the
    // shared beforeEach that renders the ordinary authenticated app and
    // stubs `fetch` with fetchMock - the «Ещё» screen and its
    // "Выйти" button need that same authenticated state to be reachable.
    describe('Logout', () => {
        it('keeps the authenticated state and reports the failure via the notice banner when /api/logout fails', async () => {
            render(<App />);
            await waitForOverview();

            const baseMock = fetchMock;
            vi.stubGlobal('fetch', vi.fn((url, options) => {
                if (typeof url === 'string' && url.includes('/api/logout')) {
                    return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ message: 'boom' }) });
                }
                return baseMock(url, options);
            }));

            goTo('Ещё');
            fireEvent.click(screen.getByRole('button', { name: 'Выйти' }));

            await waitFor(() => {
                expect(screen.getByRole('alert')).toBeInTheDocument();
            });
            // Still authenticated: the main UI is showing, not the login screen -
            // a stale cookie left over from a failed logout must not look like a
            // successful one.
            expect(screen.getByRole('heading', { level: 1, name: 'Ещё' })).toBeInTheDocument();
            expect(screen.queryByLabelText('Пароль')).not.toBeInTheDocument();
        });

        it('drops to the login screen once /api/logout actually confirms success', async () => {
            render(<App />);
            await waitForOverview();

            goTo('Ещё');
            fireEvent.click(screen.getByRole('button', { name: 'Выйти' }));

            await waitFor(() => {
                expect(screen.getByLabelText('Пароль')).toBeInTheDocument();
            });
        });

        it('reports a network failure via the notice banner and stays authenticated', async () => {
            render(<App />);
            await waitForOverview();

            const baseMock = fetchMock;
            vi.stubGlobal('fetch', vi.fn((url, options) => {
                if (typeof url === 'string' && url.includes('/api/logout')) {
                    return Promise.reject(new Error('network down'));
                }
                return baseMock(url, options);
            }));
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            goTo('Ещё');
            fireEvent.click(screen.getByRole('button', { name: 'Выйти' }));

            await waitFor(() => {
                expect(screen.getByRole('alert')).toBeInTheDocument();
            });
            expect(screen.getByRole('heading', { level: 1, name: 'Ещё' })).toBeInTheDocument();
            expect(screen.queryByLabelText('Пароль')).not.toBeInTheDocument();

            consoleSpy.mockRestore();
        });
    });
});

// computeAccountReorder is the pure piece of the drag-to-reorder feature: it
// takes the accounts in their current display order plus dnd-kit's
// active/over ids and returns the reordered list (with `order` recomputed)
// plus only the accounts whose `order` actually changed. It's tested in
// isolation from React and dnd-kit since it has no dependency on either.
describe('computeAccountReorder', () => {
    const orderedAccounts = [
        { _id: 'a', name: 'A', order: 0 },
        { _id: 'b', name: 'B', order: 1 },
        { _id: 'c', name: 'C', order: 2 },
        { _id: 'd', name: 'D', order: 3 }
    ];

    it('moves an account down and reassigns the order slots it passed through', () => {
        const { reordered, changed } = computeAccountReorder(orderedAccounts, 'a', 'c');

        expect(reordered.map(a => a._id)).toEqual(['b', 'c', 'a', 'd']);
        expect(reordered.find(a => a._id === 'b').order).toBe(0);
        expect(reordered.find(a => a._id === 'c').order).toBe(1);
        expect(reordered.find(a => a._id === 'a').order).toBe(2);
        expect(reordered.find(a => a._id === 'd').order).toBe(3);
        expect(changed.map(a => a._id).sort()).toEqual(['a', 'b', 'c']);
    });

    it('moves an account up and leaves accounts before the move untouched', () => {
        const { reordered, changed } = computeAccountReorder(orderedAccounts, 'd', 'b');

        expect(reordered.map(a => a._id)).toEqual(['a', 'd', 'b', 'c']);
        expect(reordered.find(a => a._id === 'a').order).toBe(0);
        expect(changed.map(a => a._id).sort()).toEqual(['b', 'c', 'd']);
        expect(changed.find(a => a._id === 'a')).toBeUndefined();
    });

    it('is a no-op when dropped onto itself', () => {
        const { reordered, changed } = computeAccountReorder(orderedAccounts, 'b', 'b');

        expect(reordered).toBe(orderedAccounts);
        expect(changed).toEqual([]);
    });

    it('only reports accounts whose order actually changed', () => {
        const { reordered, changed } = computeAccountReorder(orderedAccounts, 'd', 'b');

        // Every entry in `changed` must genuinely differ from its original order...
        changed.forEach(acc => {
            const original = orderedAccounts.find(a => a._id === acc._id);
            expect(acc.order).not.toBe(original.order);
        });
        // ...and everything NOT in `changed` must be unchanged.
        reordered
            .filter(acc => !changed.some(c => c._id === acc._id))
            .forEach(acc => {
                const original = orderedAccounts.find(a => a._id === acc._id);
                expect(acc.order).toBe(original.order);
            });
        expect(changed.length).toBe(3);
    });
});

// handleAccountDragEnd is the onDragEnd handler dnd-kit's DndContext calls,
// extracted so its persistence logic (optimistic update, selective PUT,
// rollback on failure) can be exercised directly - a real pointer or
// keyboard drag isn't reproducible in jsdom because dnd-kit's sensors rely
// on layout measurements (getBoundingClientRect) that jsdom never provides.
//
// It now persists through an injected `apiFetch` (App.jsx passes its own
// 401-aware wrapper) rather than reaching for the raw global `fetch`, so
// these tests supply their own `apiFetch` mock directly instead of stubbing
// the global - exercising the injection itself, not just falling back to
// the default parameter.
describe('handleAccountDragEnd', () => {
    const baseAccounts = [
        { _id: 'a', name: 'A', order: 0 },
        { _id: 'b', name: 'B', order: 1 },
        { _id: 'c', name: 'C', order: 2 }
    ];

    it('updates state optimistically and PUTs only the changed accounts with their new order', async () => {
        const puts = [];
        const apiFetch = vi.fn((url, options) => {
            if (options?.method === 'PUT') {
                puts.push({ url, body: JSON.parse(options.body) });
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
        });
        const setAccounts = vi.fn();
        const onPersisted = vi.fn();

        await handleAccountDragEnd(
            { active: { id: 'a' }, over: { id: 'c' } },
            { accounts: baseAccounts, setAccounts, apiFetch, onPersisted }
        );

        // Optimistic update: state was set once, synchronously, to the reordered list.
        expect(setAccounts).toHaveBeenCalledTimes(1);
        const optimistic = setAccounts.mock.calls[0][0];
        expect(optimistic.map(a => a._id)).toEqual(['b', 'c', 'a']);

        // All three accounts shifted by this particular move, so all three were PUT -
        // each with only an `order` body, to its own id - through the injected apiFetch.
        expect(puts.length).toBe(3);
        expect(puts.map(p => p.url).sort()).toEqual(
            ['/api/accounts/a', '/api/accounts/b', '/api/accounts/c'].sort()
        );
        puts.forEach(p => expect(Object.keys(p.body)).toEqual(['order']));
        expect(puts.find(p => p.url === '/api/accounts/a').body).toEqual({ order: 2 });
        expect(puts.find(p => p.url === '/api/accounts/b').body).toEqual({ order: 0 });
        expect(puts.find(p => p.url === '/api/accounts/c').body).toEqual({ order: 1 });
        expect(onPersisted).toHaveBeenCalledTimes(1);
    });

    it('sends no request and does not touch state when the drop is a no-op', async () => {
        const apiFetch = vi.fn();
        const setAccounts = vi.fn();

        await handleAccountDragEnd(
            { active: { id: 'a' }, over: { id: 'a' } },
            { accounts: baseAccounts, setAccounts, apiFetch }
        );

        expect(apiFetch).not.toHaveBeenCalled();
        expect(setAccounts).not.toHaveBeenCalled();
    });

    it('rolls back to the previous order and reports the error via onError when a PUT is rejected', async () => {
        const apiFetch = vi.fn((url, options) => {
            if (options?.method === 'PUT' && url.endsWith('/b')) {
                return Promise.resolve({ ok: false, json: () => Promise.resolve({ message: 'Save failed' }) });
            }
            if (options?.method === 'PUT') {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
        });
        const setAccounts = vi.fn();
        const onError = vi.fn();

        await handleAccountDragEnd(
            { active: { id: 'a' }, over: { id: 'c' } },
            { accounts: baseAccounts, setAccounts, apiFetch, onError }
        );

        // First call is the optimistic reorder, second (last) call rolls it back
        // to the exact array the handler was given.
        expect(setAccounts).toHaveBeenCalledTimes(2);
        expect(setAccounts.mock.calls[0][0].map(a => a._id)).toEqual(['b', 'c', 'a']);
        expect(setAccounts.mock.calls[1][0]).toBe(baseAccounts);
        expect(onError).toHaveBeenCalledWith('Save failed');
    });

    it('rolls back and logs when the request throws (network failure)', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const apiFetch = vi.fn(() => Promise.reject(new Error('network down')));
        const setAccounts = vi.fn();

        await handleAccountDragEnd(
            { active: { id: 'a' }, over: { id: 'c' } },
            { accounts: baseAccounts, setAccounts, apiFetch }
        );

        expect(setAccounts).toHaveBeenCalledTimes(2);
        expect(setAccounts.mock.calls[1][0]).toBe(baseAccounts);
        expect(consoleSpy).toHaveBeenCalled();

        consoleSpy.mockRestore();
    });

    it('persists through the App-supplied apiFetch wrapper, not the raw global fetch (keeps 401 handling consistent with every other mutation)', async () => {
        const globalFetch = vi.fn();
        vi.stubGlobal('fetch', globalFetch);

        const apiFetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
        const setAccounts = vi.fn();

        await handleAccountDragEnd(
            { active: { id: 'a' }, over: { id: 'c' } },
            { accounts: baseAccounts, setAccounts, apiFetch }
        );

        expect(apiFetch).toHaveBeenCalled();
        expect(globalFetch).not.toHaveBeenCalled();

        vi.unstubAllGlobals();
    });
});

// Authentication: App drives its unauthenticated/authenticated state purely
// off 401 responses from the API (never localStorage - the session cookie
// is httpOnly, so JS can't read it either way). Each test here stubs its own
// fetch implementation rather than relying on the shared one above, since
// the shared mock always answers /api/accounts with 200.
describe('Authentication flow', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    const authAccounts = [
        { _id: 'card', name: 'Карта', type: 'card', icon: '💳', isDefault: true }
    ];

    it('ignores a delayed refresh from the previous session after logout and login', async () => {
        let resolveOldAccounts;
        const delayedOldAccounts = new Promise(resolve => { resolveOldAccounts = resolve; });
        let accountGets = 0;
        let transactionGets = 0;
        const initialAccounts = [{ _id: 'initial', name: 'Начальный счёт', type: 'card', icon: '💳' }];
        const freshAccounts = [{ _id: 'fresh', name: 'Свежий счёт', type: 'card', icon: '💳' }];

        vi.stubGlobal('fetch', vi.fn((url, options) => {
            if (url === '/api/accounts' && options?.method === 'POST') {
                return Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve({ _id: 'saved' }) });
            }
            if (url === '/api/accounts') {
                accountGets += 1;
                if (accountGets === 1) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(initialAccounts) });
                if (accountGets === 2) return delayedOldAccounts;
                return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(freshAccounts) });
            }
            if (url === '/api/logout' || url === '/api/login') {
                return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
            }
            if (url.startsWith('/api/stats/dashboard?')) {
                transactionGets += 1;
                return Promise.resolve({ ok: true, status: 200, json: async () => readApi(url, [], accountGets === 1 ? initialAccounts : freshAccounts) });
            }
            if (url === '/api/settings') {
                return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ monthlyLimit: 7000 }) });
            }
            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
        }));

        render(<App />);
        await waitFor(() => screen.getByText('Начальный счёт'));

        openMoreRow(/^Счета/);
        addAccountThroughSheet('Сохранённый счёт');
        await waitFor(() => expect(accountGets).toBe(2));

        // Выход живёт в меню «Ещё»: на вкладку возвращаемся из экрана счетов.
        goTo('Ещё');
        fireEvent.click(screen.getByRole('button', { name: 'Выйти' }));
        await waitFor(() => screen.getByLabelText('Пароль'));
        expect(screen.queryByText('Начальный счёт')).not.toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'family-secret' } });
        fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
        await waitFor(() => screen.getByText('Свежий счёт'));

        await act(async () => {
            resolveOldAccounts({
                ok: true,
                status: 200,
                json: () => Promise.resolve([{ _id: 'old', name: 'Устаревший счёт', type: 'card', icon: '💳' }]),
            });
        });

        expect(screen.getByText('Свежий счёт')).toBeInTheDocument();
        expect(screen.queryByText('Устаревший счёт')).not.toBeInTheDocument();
        // Initial session + fresh session only. The stale accounts response
        // must stop before it launches child requests under the new session.
        expect(transactionGets).toBe(2);
    });

    it('shows the login screen when the initial accounts fetch comes back 401', async () => {
        vi.stubGlobal('fetch', vi.fn((url) => {
            const data = readApi(url, currentTransactions, currentAccounts);
            if (data !== undefined) return Promise.resolve({ ok: true, status: 200, json: async () => data });
            if (typeof url === 'string' && url.includes('/api/accounts')) {
                return Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({ message: 'Не авторизован' }) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
        }));

        render(<App />);

        await waitFor(() => {
            expect(screen.getByLabelText('Пароль')).toBeInTheDocument();
        });
        // На экране входа нет ничего из авторизованного интерфейса.
        expect(screen.queryByTestId('accounts-row')).not.toBeInTheDocument();
        // Первый запуск, а не потеря сессии: обычный подзаголовок.
        expect(screen.getByRole('heading', { level: 1, name: 'Бюджет' })).toBeInTheDocument();
        expect(screen.getByText('Введите пароль, чтобы продолжить')).toBeInTheDocument();
        expect(screen.queryByText(/Сессия закончилась/)).not.toBeInTheDocument();
    });

    it('reveals the app after a successful login', async () => {
        let authenticated = false;
        vi.stubGlobal('fetch', vi.fn((url) => {
            const data = readApi(url, currentTransactions, currentAccounts);
            if (data !== undefined) return Promise.resolve({ ok: true, status: 200, json: async () => data });
            if (typeof url === 'string' && url.includes('/api/login')) {
                authenticated = true;
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
            }
            if (typeof url === 'string' && url.includes('/api/accounts')) {
                if (!authenticated) {
                    return Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({ message: 'Не авторизован' }) });
                }
                return Promise.resolve({ ok: true, json: () => Promise.resolve(authAccounts) });
            }
            if (typeof url === 'string' && url.includes('/api/categories')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
            }
            if (typeof url === 'string' && url.includes('/api/settings')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ monthlyLimit: 7000 }) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
        }));

        render(<App />);

        await waitFor(() => screen.getByLabelText('Пароль'));

        fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'family-secret' } });
        fireEvent.click(screen.getByRole('button', { name: 'Войти' }));

        // Название приложения есть только на экране входа, поэтому признак
        // открывшегося приложения - его собственные данные (лента счетов).
        await waitFor(() => {
            expect(screen.getByTestId('accounts-row')).toBeInTheDocument();
        }, { timeout: 3000 });
        expect(screen.queryByLabelText('Пароль')).not.toBeInTheDocument();
        expect(screen.queryByText('Бюджет', { selector: 'h1' })).not.toBeInTheDocument();
    });

    it('returns to the login screen when a mid-session request comes back 401 (expired/cleared session)', async () => {
        let accountsCallCount = 0;
        vi.stubGlobal('fetch', vi.fn((url) => {
            const data = readApi(url, currentTransactions, currentAccounts);
            if (data !== undefined) return Promise.resolve({ ok: true, status: 200, json: async () => data });
            if (typeof url === 'string' && url.includes('/api/accounts')) {
                accountsCallCount += 1;
                // First call (initial load) succeeds; every call after that
                // simulates the session having expired in the meantime.
                if (accountsCallCount === 1) {
                    return Promise.resolve({ ok: true, json: () => Promise.resolve(authAccounts) });
                }
                return Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({ message: 'Не авторизован' }) });
            }
            if (typeof url === 'string' && url.includes('/api/categories')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
            }
            if (typeof url === 'string' && url.includes('/api/settings')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ monthlyLimit: 7000 }) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
        }));

        render(<App />);
        await waitForOverview();

        // Any authenticated-looking screen still needs a live session for
        // further calls - saving a new account here is what hits /api/accounts
        // again and discovers the session is gone.
        openMoreRow(/^Счета/);
        addAccountThroughSheet('Новый счёт');

        await waitFor(() => {
            expect(screen.getByLabelText('Пароль')).toBeInTheDocument();
        });
        // Данные уже были, значит сессия закончилась посреди работы.
        expect(screen.getByText('Сессия закончилась. Войдите снова, данные на месте.')).toBeInTheDocument();
        expect(screen.queryByText('Введите пароль, чтобы продолжить')).not.toBeInTheDocument();
    });

    it('does not claim the session expired after the user logged out on purpose', async () => {
        vi.stubGlobal('fetch', vi.fn((url) => {
            const data = readApi(url, currentTransactions, currentAccounts);
            if (data !== undefined) return Promise.resolve({ ok: true, status: 200, json: async () => data });
            if (typeof url === 'string' && url.includes('/api/logout')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
            }
            if (typeof url === 'string' && url.includes('/api/accounts')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve(authAccounts) });
            }
            if (typeof url === 'string' && url.includes('/api/settings')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ monthlyLimit: 7000 }) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
        }));

        render(<App />);
        await waitForOverview();
        goTo('Ещё');
        fireEvent.click(screen.getByRole('button', { name: 'Выйти' }));

        await screen.findByLabelText('Пароль');
        expect(screen.getByText('Введите пароль, чтобы продолжить')).toBeInTheDocument();
        expect(screen.queryByText(/Сессия закончилась/)).not.toBeInTheDocument();
    });

    it('goes back to the plain subtitle after signing in again', async () => {
        let authenticated = true;
        vi.stubGlobal('fetch', vi.fn((url) => {
            const data = readApi(url, currentTransactions, currentAccounts);
            if (data !== undefined) return Promise.resolve({ ok: true, status: 200, json: async () => data });
            if (typeof url === 'string' && url.includes('/api/login')) {
                authenticated = true;
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
            }
            if (typeof url === 'string' && url.includes('/api/logout')) {
                authenticated = false;
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
            }
            if (typeof url === 'string' && url.includes('/api/accounts')) {
                if (!authenticated) return Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) });
                return Promise.resolve({ ok: true, json: () => Promise.resolve(authAccounts) });
            }
            if (typeof url === 'string' && url.includes('/api/settings')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ monthlyLimit: 7000 }) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
        }));

        render(<App />);
        await waitForOverview();
        // Сессия пропала на сервере: следующий запрос к счетам отвечает 401.
        authenticated = false;
        openMoreRow(/^Счета/);
        addAccountThroughSheet('Новый счёт');
        await screen.findByText('Сессия закончилась. Войдите снова, данные на месте.');

        fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'family-secret' } });
        fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
        await waitForOverview();

        // Выходим сами: объяснение про истёкшую сессию не должно вернуться.
        goTo('Ещё');
        fireEvent.click(screen.getByRole('button', { name: 'Выйти' }));
        await screen.findByLabelText('Пароль');
        expect(screen.getByText('Введите пароль, чтобы продолжить')).toBeInTheDocument();
    });
});
