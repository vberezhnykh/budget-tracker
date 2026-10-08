import { readApi } from '../server/test/readApi.mjs';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import App from './App';
import { computeAccountReorder, handleAccountDragEnd } from './utils/accountReorder';

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
const accountCard = name => screen.getByRole('button', { name: new RegExp(`^${name}: €`) });

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

// Настройки открываются из «Ещё» → «Счета, категории и лимит».
function openSettings() {
    fireEvent.click(screen.getByRole('button', { name: 'Ещё' }));
    fireEvent.click(screen.getByRole('button', { name: /Счета, категории и лимит/ }));
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

        offline = false;
        fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));

        await waitFor(() => expect(screen.getByTestId('accounts-row')).toBeInTheDocument());
        expect(screen.getByText(/^Обновлено \d{2}:\d{2}$/)).toBeInTheDocument();
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
            expect(screen.getByText(/Расходы по категориям/)).toBeInTheDocument();
        });
        // The period trigger follows you across tabs (it moves into the
        // «Сводка» heading) rather than being owned by the overview.
        expect(screen.getByRole('button', { name: /^Период:/ })).toHaveTextContent('Сводка за январь');
        expect(tab('Аналитика')).toHaveAttribute('aria-current', 'page');
        expect(tab('Обзор')).not.toHaveAttribute('aria-current');
        // Шапка со счетами принадлежит Обзору.
        expect(screen.queryByTestId('accounts-row')).not.toBeInTheDocument();

        fireEvent.click(tab('История'));
        expect(await screen.findByTestId('history-scroll')).toBeInTheDocument();
        expect(screen.queryByText(/Расходы по категориям/)).not.toBeInTheDocument();
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
        expect(await screen.findByText(/Расходы по категориям/)).toBeInTheDocument();
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

    it('keeps settings out of the overview header and opens them from «Ещё»', async () => {
        render(<App />);
        await waitForOverview();
        expect(screen.queryByTitle('Настройки')).not.toBeInTheDocument();

        openSettings();

        expect(screen.getByRole('dialog', { name: 'Настройки' })).toBeInTheDocument();
    });

    it('opens and closes the add transaction modal', async () => {
        render(<App />);

        await waitForOverview();

        // Быстрых кнопок «Доход / Расход / Перевод» на Обзоре больше нет: добавить
        // операцию можно «+» в нижней панели.
        expect(screen.queryByRole('button', { name: 'Добавить доход' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Добавить перевод' })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Добавить операцию' }));

        expect(screen.getByText(/Новый расход/)).toBeInTheDocument();

        const closeBtn = screen.getByRole('button', { name: 'Закрыть', exact: true });
        fireEvent.click(closeBtn);

        await waitFor(() => {
            expect(screen.queryByText(/Новый расход/)).not.toBeInTheDocument();
        });
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
        fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '25' } });
        fireEvent.click(screen.getByText('Продукты'));
        fireEvent.click(within(screen.getByRole('dialog', { name: 'Новый расход' })).getByRole('button', { name: 'Карта', exact: true }));
        fireEvent.click(screen.getByText('Сохранить'));

        expect(await screen.findByRole('alert')).toHaveTextContent('База временно недоступна');
        expect(screen.getByRole('dialog', { name: 'Новый расход' })).toBeInTheDocument();
        expect(screen.getByPlaceholderText('0.00')).toHaveValue(25);
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
        fireEvent.click(screen.getByText('Сохранить'));

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
        fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '25' } });
        fireEvent.click(screen.getByText('Продукты'));
        fireEvent.click(within(screen.getByRole('dialog', { name: 'Новый расход' })).getByRole('button', { name: 'Карта', exact: true }));
        fireEvent.click(screen.getByText('Сохранить'));

        expect(await screen.findByText('Не удалось обновить данные')).toBeInTheDocument();
        expect(screen.getByText(/Показана синхронизация:/)).toBeInTheDocument();
        expect(screen.getAllByText(/4\.000/)[0]).toBeInTheDocument();

        vi.setSystemTime(new Date('2026-01-15T13:30:00Z'));
        fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));

        await waitFor(() => expect(screen.queryByText('Не удалось обновить данные')).not.toBeInTheDocument());
        expect(screen.getByText(/^Обновлено /).textContent).not.toBe(firstSyncLabel);
        expect(fetchMock.mock.calls.filter(([url, options]) => url === '/api/transactions' && options?.method === 'POST')).toHaveLength(1);
        consoleSpy.mockRestore();
    });

    it('breaks the period expense down by category, and applies the tapped one as the summary filter', async () => {
        render(<App />);
        await waitForOverview();

        // Разбивка по категориям - на вкладке «Аналитика»; на главной её
        // больше нет, там теперь лимит и последние операции.
        await openAnalytics();
        const categoryButton = await screen.findByRole('button', { name: /^Housing: €/ });
        expect(categoryButton).toHaveAttribute('aria-pressed', 'false');

        fireEvent.click(categoryButton);

        expect(await screen.findByRole('button', { name: /^Housing: €/ })).toHaveAttribute('aria-pressed', 'true');
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
        await waitFor(() => screen.getAllByText('€50.00'));
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
        expect(await screen.findByText(/\+€5\.000/)).toBeInTheDocument();

        // Switch to lifetime. "Всё время" has nothing further to pick, so it
        // applies and closes the sheet on the spot.
        fireEvent.click(screen.getByRole('button', { name: /^Период:/ }));
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Всё время' }));

        // Should show lifetime stats (same as monthly in this mock since all are in Jan 2026)
        expect(await screen.findByText(/\+€5\.000/)).toBeInTheDocument();

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

    it('opens the accounts settings from «Настроить» in the accounts section', async () => {
        render(<App />);
        await waitForOverview();

        fireEvent.click(within(screen.getByRole('region', { name: 'Счета' })).getByRole('button', { name: 'Настроить' }));

        expect(screen.getByRole('dialog', { name: 'Настройки' })).toBeInTheDocument();
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
        window.confirm = vi.fn(() => true);

        render(<App />);
        await waitForOverview();

        // Select the account we're about to delete.
        fireEvent.click(accountCard('Кошелёк'));
        await waitFor(() => {
            expect(accountCard('Кошелёк')).toHaveAttribute('aria-pressed', 'true');
        });

        // Delete it via the accounts settings panel.
        openSettings();
        const deleteButtons = await screen.findAllByRole('button', { name: 'Удалить' });
        fireEvent.click(deleteButtons[deleteButtons.length - 1]);

        expect(window.confirm).toHaveBeenCalled();

        // The filter pointed at an id that no longer exists - it must be reset
        // and the selection taken back to «Все счета». Настройки
        // открыты поверх «Ещё», поэтому на Обзор возвращаемся, закрыв их.
        await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/accounts/wallet', expect.objectContaining({ method: 'DELETE' })));
        fireEvent.click(await screen.findByRole('button', { name: 'Закрыть настройки' }));
        goTo('Обзор');
        await waitFor(() => {
            expect(accountCard('Все счета')).toHaveAttribute('aria-pressed', 'true');
        });
        expect(screen.queryByRole('button', { name: /^Кошелёк: / })).not.toBeInTheDocument();
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

        window.confirm = vi.fn(() => true);

        render(<App />);
        await screen.findByRole('button', { name: 'Ещё' });

        // Ставим фильтр на категорию, которую сейчас удалим - через разбивку
        // расхода на вкладке «Аналитика» (фильтр сводки) и чипом в Истории
        // (отдельный фильтр списка): удаление должно снять оба.
        await openAnalytics();
        fireEvent.click(await screen.findByRole('button', { name: /^Подписки: €/ }));
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /^Подписки: €/ })).toHaveAttribute('aria-pressed', 'true');
        });
        await openHistory();
        fireEvent.click(within(screen.getByRole('group', { name: 'Фильтр по категории' })).getByRole('button', { name: 'Подписки' }));
        expect(await screen.findByText('Категория:')).toBeInTheDocument();

        openSettings();
        fireEvent.click(await screen.findByLabelText('Удалить категорию: Подписки'));

        expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('операций: 1'));
        await waitFor(() => {
            expect(fetchMock).toHaveBeenCalledWith('/api/categories/c2', expect.objectContaining({ method: 'DELETE' }));
        });
        // Фильтры указывали на исчезнувшую категорию - их нужно снять.
        fireEvent.click(await screen.findByRole('button', { name: 'Закрыть настройки' }));
        await openAnalytics();
        await waitFor(() => {
            expect(screen.queryByRole('button', { name: /^Подписки: €/ })).toHaveAttribute('aria-pressed', 'false');
        });
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

        // Фильтры стоят на категории, которую сейчас переименуем: в сводке
        // (разбивка на «Аналитике») и в Истории (чип) - у каждого своё
        // состояние, и переехать на новое имя должны оба.
        await openAnalytics();
        fireEvent.click(await screen.findByRole('button', { name: /^Подписки: €/ }));
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /^Подписки: €/ })).toHaveAttribute('aria-pressed', 'true');
        });
        await openHistory();
        fireEvent.click(within(screen.getByRole('group', { name: 'Фильтр по категории' })).getByRole('button', { name: 'Подписки' }));
        expect(await screen.findByText('Категория:')).toBeInTheDocument();

        openSettings();
        fireEvent.click(await screen.findByLabelText('Переименовать категорию: Подписки'));
        fireEvent.change(screen.getByLabelText('Название категории: Подписки'), { target: { value: 'Сервисы' } });
        fireEvent.click(screen.getByLabelText('Сохранить название категории: Подписки'));

        await waitFor(() => {
            expect(fetchMock).toHaveBeenCalledWith('/api/categories/c2', expect.objectContaining({
                method: 'PUT',
                body: JSON.stringify({ name: 'Сервисы' }),
            }));
        });
        // Список категорий перечитан - строка уже под новым именем.
        expect(await screen.findByLabelText('Переименовать категорию: Сервисы')).toBeInTheDocument();

        // История перечитана: разбивка расхода знает новое имя, а фильтр
        // переехал на него вместе с ней.
        fireEvent.click(await screen.findByRole('button', { name: 'Закрыть настройки' }));
        await openAnalytics();
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /^Сервисы: €/ })).toHaveAttribute('aria-pressed', 'true');
        });
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

        openSettings();
        fireEvent.change(screen.getByPlaceholderText(/Имя счёта/), { target: { value: 'Сохранённый счёт' } });
        fireEvent.click(screen.getByRole('button', { name: 'Добавить счёт' }));
        await waitFor(() => expect(accountGets).toBe(2));

        fireEvent.click(within(screen.getByRole('dialog', { name: 'Настройки' })).getByRole('button', { name: 'Выйти' }));
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
        // The login screen has its own "BudgetTracker" heading, so assert on
        // something that only exists in the authenticated main UI instead.
        expect(screen.queryByTestId('accounts-row')).not.toBeInTheDocument();
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

        await waitFor(() => {
            expect(screen.getByText('BudgetTracker')).toBeInTheDocument();
        }, { timeout: 3000 });
        expect(screen.queryByLabelText('Пароль')).not.toBeInTheDocument();
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
        openSettings();
        fireEvent.change(screen.getByPlaceholderText(/Имя счёта/), { target: { value: 'Новый счёт' } });
        fireEvent.click(screen.getByRole('button', { name: 'Добавить счёт' }));

        await waitFor(() => {
            expect(screen.getByLabelText('Пароль')).toBeInTheDocument();
        });
    });
});
