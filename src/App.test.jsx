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
        return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(currentTransactions),
        });
    });
}

// jsdom doesn't implement scrollIntoView; the carousel guards the call, but
// tests need a spy to verify *which* slide it was asked to scroll to.
Element.prototype.scrollIntoView = vi.fn();

// jsdom never lays anything out, so offsetLeft/offsetWidth/clientWidth are
// always 0. Stub them on the carousel container and its slides so the
// nearest-centre calculation in App.jsx has real numbers to work with.
// A leading spacer (spacerWidth) plus one gap sits before slide 0 in the
// real layout, so every slide's offsetLeft is pushed right by that amount -
// mirror that here instead of assuming slide 0 starts at 0.
function stubCarouselGeometry(container, slideWidth = 300, gap = 12, spacerWidth = 20) {
    Object.defineProperty(container, 'clientWidth', { configurable: true, value: slideWidth });
    const slideEls = Array.from(container.querySelectorAll('[data-carousel-slide]'));
    const leadingInset = spacerWidth + gap;
    slideEls.forEach((el, i) => {
        Object.defineProperty(el, 'offsetLeft', { configurable: true, value: leadingInset + i * (slideWidth + gap) });
        Object.defineProperty(el, 'offsetWidth', { configurable: true, value: slideWidth });
    });
    return slideEls;
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

        await waitFor(() => {
            expect(screen.getByText('BudgetTracker')).toBeInTheDocument();
        }, { timeout: 3000 });

        expect(screen.getAllByText(/4\.000/)[0]).toBeInTheDocument();
    });

    it('changes the month from the Период chip', async () => {
        render(<App />);

        await waitFor(() => screen.getByText('BudgetTracker'));

        // The chip carries the current period, and is the only way to change
        // it - the old header arrow row is gone.
        expect(screen.getByRole('button', { name: 'Период: Январь 2026' })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /^Период:/ }));

        const dialog = screen.getByRole('dialog', { name: 'Выбор периода' });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Декабрь' }));

        await waitFor(() => {
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        });
        expect(screen.getByRole('button', { name: 'Период: Декабрь 2025' })).toBeInTheDocument();
    });

    it('offers only months between the start of history and the current month', async () => {
        render(<App />);

        await waitFor(() => screen.getByText('BudgetTracker'));
        fireEvent.click(screen.getByRole('button', { name: /^Период:/ }));

        // System time is mocked to 2026-01-15, so the selectable range is
        // 2025-11 .. 2026-01: no October 2025, and no February 2026.
        const dialog = screen.getByRole('dialog', { name: 'Выбор периода' });
        expect(within(dialog).getByRole('button', { name: 'Ноябрь' })).toBeInTheDocument();
        expect(within(dialog).getByRole('button', { name: 'Январь' })).toBeInTheDocument();
        expect(within(dialog).queryByRole('button', { name: 'Октябрь' })).not.toBeInTheDocument();
        expect(within(dialog).queryByRole('button', { name: 'Февраль' })).not.toBeInTheDocument();
    });

    it('switches between the stats and analytics tabs from the bottom tab bar', async () => {
        render(<App />);

        await waitFor(() => screen.getByText('BudgetTracker'));

        const tabBar = screen.getByRole('navigation', { name: 'Основная навигация' });
        const analyticsTab = within(tabBar).getByRole('button', { name: /Аналитика/ });
        const homeTab = within(tabBar).getByRole('button', { name: /Главная/ });

        fireEvent.click(analyticsTab);

        await waitFor(() => {
            expect(screen.getByText(/Аналитика трат/)).toBeInTheDocument();
        });
        // The period chip follows you across tabs rather than being owned by
        // the stats screen.
        expect(screen.getByRole('button', { name: /^Период:/ })).toBeInTheDocument();
        expect(analyticsTab).toHaveAttribute('aria-current', 'page');

        fireEvent.click(homeTab);

        await waitFor(() => {
            expect(screen.queryByText(/Аналитика трат/)).not.toBeInTheDocument();
        });
        expect(screen.getByRole('button', { name: /^Период:/ })).toBeInTheDocument();
    });

    it('opens and closes the add transaction modal', async () => {
        render(<App />);

        await waitFor(() => screen.getByText('BudgetTracker'));

        const incomeBtn = screen.getByRole('button', { name: /\+ Доход/i });
        fireEvent.click(incomeBtn);

        expect(screen.getByText(/Новый доход/)).toBeInTheDocument();

        const closeBtn = screen.getByText('×');
        fireEvent.click(closeBtn);

        await waitFor(() => {
            expect(screen.queryByText(/Новый доход/)).not.toBeInTheDocument();
        });
    });

    it('breaks the period expense down by category, and filters the list when one is tapped', async () => {
        render(<App />);
        await waitFor(() => screen.getByText('BudgetTracker'));

        // The stats panel names the categories that produced the expense
        // figure, so the breakdown is reachable without the Аналитика tab.
        const categoryButton = screen.getByRole('button', { name: /^Housing: €/ });
        expect(categoryButton).toHaveAttribute('aria-pressed', 'false');

        fireEvent.click(categoryButton);

        expect(screen.getByRole('button', { name: /^Housing: €/ })).toHaveAttribute('aria-pressed', 'true');
    });

    it('displays transaction description and account/category correctly', async () => {
        render(<App />);

        await waitFor(() => screen.getByText('BudgetTracker'));

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

        await waitFor(() => screen.getByText('BudgetTracker'));

        // Each editable row exposes a full-row button (see the accessible
        // stretched-overlay restructuring in TransactionsDrawer.jsx) rather
        // than the row div itself carrying the click handler, so it's found
        // by its accessible name instead of the inner text node.
        const rentTx = screen.getByRole('button', { name: /Monthly flat rent/ });
        fireEvent.click(rentTx);

        // Find delete button and click it
        const deleteBtn = await screen.findByText('🗑');
        const callsBeforeDelete = fetchMock.mock.calls.length;
        fireEvent.click(deleteBtn);

        expect(window.confirm).toHaveBeenCalled();
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

        // Open split sub-item via its full-row button (see the accessible
        // stretched-overlay restructuring in TransactionsDrawer.jsx) rather
        // than clicking its amount text directly.
        await waitFor(() => screen.getAllByText('€50.00'));
        fireEvent.click(screen.getByRole('button', { name: /Grouped \(Разделено\)/ }));

        // Wait for modal to open (find delete button)
        const deleteBtn = await screen.findByText('🗑');
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

    it('toggles between monthly and lifetime stats', async () => {
        render(<App />);

        await waitFor(() => screen.getByText('BudgetTracker'));

        // Default is monthly income (Salary = 5000)
        expect(screen.getByText(/\+€5\.000/)).toBeInTheDocument();

        // Switch to lifetime. "Всё время" has nothing further to pick, so it
        // applies and closes the sheet on the spot.
        fireEvent.click(screen.getByRole('button', { name: /^Период:/ }));
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Всё время' }));

        // Should show lifetime stats (same as monthly in this mock since all are in Jan 2026)
        expect(screen.getByText(/\+€5\.000/)).toBeInTheDocument();

        // Progress bar (Limit) should be gone
        expect(screen.queryByText(/Лимит €/)).not.toBeInTheDocument();
    });

    it('lists the whole year and the whole history in the drawer, not only the selected month', async () => {
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
        await waitFor(() => screen.getByText('BudgetTracker'));

        // Month view (January 2026): December's operation is out of range.
        expect(screen.queryByText('Подарки')).not.toBeInTheDocument();

        // "Всё время": every operation, whatever month it falls in.
        fireEvent.click(screen.getByRole('button', { name: /^Период:/ }));
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Всё время' }));
        expect(screen.getByText('Подарки')).toBeInTheDocument();
        expect(screen.getByText('Salary')).toBeInTheDocument();

        // "Год" 2025: that year in full, and nothing from 2026.
        fireEvent.click(screen.getByRole('button', { name: /^Период:/ }));
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Год' }));
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '2025 год' }));
        expect(screen.getByText('Подарки')).toBeInTheDocument();
        expect(screen.queryByText('Salary')).not.toBeInTheDocument();
    });

    it('filters transactions by search query', async () => {
        render(<App />);

        await waitFor(() => screen.getByText('BudgetTracker'));

        // Initially shows both (Salary and Rent) in January view (since we mocked time)
        expect(screen.getByText('Salary')).toBeInTheDocument();
        expect(screen.getByText('Monthly flat rent')).toBeInTheDocument();

        // Type "Rent" in search
        const searchInput = screen.getByPlaceholderText(/Поиск/);
        fireEvent.change(searchInput, { target: { value: 'Rent' } });

        // Should only show Rent
        await waitFor(() => {
            expect(screen.queryByText('Salary')).not.toBeInTheDocument();
            expect(screen.getByText('Monthly flat rent')).toBeInTheDocument();
            expect(screen.getByText(/Результаты поиска \(1\)/)).toBeInTheDocument();
        });

        // Clear search
        const clearBtn = screen.getByText('×');
        fireEvent.click(clearBtn);

        // Should show both again
        await waitFor(() => {
            expect(screen.getByText('Salary')).toBeInTheDocument();
            expect(screen.getByText('Monthly flat rent')).toBeInTheDocument();
            expect(screen.getByText('История')).toBeInTheDocument();
        });
    });
    it('filters transactions by account when clicking account cards', async () => {
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

        await waitFor(() => screen.getByText('Coffee'));
        expect(screen.getAllByText('Salary').length).toBeGreaterThan(0);

        // The header is a carousel of slides: total capital, then one slide
        // per account (the type:card/type:cash group slides were dropped -
        // that split now lives in the stats block instead). Clicking a
        // slide applies its filter directly (no chevrons/expand step).
        const cardFilterBtn = screen.getByText('Карта').closest('div');
        fireEvent.click(cardFilterBtn);

        // Should show Salary (card) but NOT Coffee (cash)
        await waitFor(() => {
            expect(screen.queryAllByText('Salary').length).toBeGreaterThan(0);
            expect(screen.queryByText('Coffee')).not.toBeInTheDocument();
        });

        // Click on the "Наличные" account slide.
        const cashFilterBtn = screen.getByText('Наличные').closest('div');
        fireEvent.click(cashFilterBtn);

        // Should show Coffee (cash) but NOT Salary (card)
        await waitFor(() => {
            expect(screen.getByText('Coffee')).toBeInTheDocument();
            expect(screen.queryByText('Salary')).not.toBeInTheDocument();
        });
    });

    it('selects the slide nearest the scroll position once scrolling settles', async () => {
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
        await waitFor(() => screen.getByText('Coffee'));

        // Slide order: total(0), "Карта" account(1), "Наличные" account(2).
        // Slide 1 is the per-account "Карта" slide - deliberately NOT the
        // last slide, since the old buggy arithmetic (slideWidth computed
        // from the hidden <style> tag) clamped every real swipe to the LAST
        // slide regardless of where the user stopped.
        const container = screen.getByTestId('balance-carousel');
        const slideEls = stubCarouselGeometry(container);
        expect(slideEls.length).toBe(3);

        const targetIndex = 1;
        const slideWidth = 300;
        const gap = 12;
        const spacerWidth = 20;
        // Same leading inset stubCarouselGeometry applied to every slide's
        // offsetLeft, so this scroll position still lands on slide 3 ("Карта").
        container.scrollLeft = spacerWidth + gap + targetIndex * (slideWidth + gap);

        // The filter is only committed once scroll events stop arriving for
        // ~120ms (settle-debounce) - fake the timers driving that.
        vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
        vi.setSystemTime(new Date('2026-01-15'));

        fireEvent.scroll(container);
        act(() => {
            vi.advanceTimersByTime(200);
        });

        // Switch back to real timers before using waitFor/further queries -
        // testing-library's polling can't see vitest's faked setTimeout here,
        // and the settle-debounce has already fired inside the act() above.
        vi.useRealTimers();

        // Selecting slide 3 ("Карта") must filter by the card account, not by
        // whatever the last slide happens to be.
        expect(screen.queryByText('Coffee')).not.toBeInTheDocument();
        expect(screen.getAllByText('Salary').length).toBeGreaterThan(0);
        const chip = screen.getByText(/Счет:/).closest('div');
        expect(chip).toHaveTextContent('Карта');
    });

    it('navigates the carousel via the dot indicators', async () => {
        render(<App />);
        await waitFor(() => screen.getByText('BudgetTracker'));

        const cardDot = screen.getByRole('button', { name: 'Показать Карта' });
        fireEvent.click(cardDot);

        await waitFor(() => {
            const chip = screen.getByText(/Счет:/).closest('div');
            expect(chip).toHaveTextContent('Карта');
        });
        expect(cardDot).toHaveAttribute('aria-current', 'true');
    });

    it('returns the carousel to the total-capital slide when the filter is reset', async () => {
        render(<App />);
        await waitFor(() => screen.getByText('BudgetTracker'));

        const cardSlide = screen.getByText('Карта').closest('[data-carousel-slide]');
        fireEvent.click(cardSlide);
        await waitFor(() => {
            expect(screen.getByText(/Счет:/)).toBeInTheDocument();
        });

        Element.prototype.scrollIntoView.mockClear();

        const resetBtn = screen.getByText('Сбросить ×');
        fireEvent.click(resetBtn);

        await waitFor(() => {
            expect(screen.queryByText(/Счет:/)).not.toBeInTheDocument();
        });

        const totalSlide = screen.getByText('Общий капитал').closest('[data-carousel-slide]');
        expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
        const lastCallTarget = Element.prototype.scrollIntoView.mock.contexts.at(-1);
        expect(lastCallTarget).toBe(totalSlide);
    });

    it('clears the selection when the currently selected account is deleted', async () => {
        currentAccounts = [
            { _id: 'card', name: 'Карта', type: 'card', icon: '💳', isDefault: true },
            { _id: 'cash', name: 'Наличные', type: 'cash', icon: '💵', isDefault: true },
            { _id: 'wallet', name: 'Кошелёк', type: 'cash', icon: '👛', isDefault: false }
        ];
        window.confirm = vi.fn(() => true);

        render(<App />);
        await waitFor(() => screen.getByText('Кошелёк'));

        // Select the account we're about to delete.
        const walletSlide = screen.getByText('Кошелёк').closest('[data-carousel-slide]');
        fireEvent.click(walletSlide);
        await waitFor(() => {
            const chip = screen.getByText(/Счет:/).closest('div');
            expect(chip).toHaveTextContent('Кошелёк');
        });

        // Delete it via the accounts settings panel.
        fireEvent.click(screen.getByTitle('Настройки'));
        const deleteButtons = await screen.findAllByRole('button', { name: 'Удалить' });
        fireEvent.click(deleteButtons[deleteButtons.length - 1]);

        expect(window.confirm).toHaveBeenCalled();

        // The filter pointed at an id that no longer exists - it must be reset.
        await waitFor(() => {
            expect(screen.queryByText(/Счет:/)).not.toBeInTheDocument();
        });
        expect(screen.getByRole('button', { name: 'Показать Общий капитал' })).toHaveAttribute('aria-current', 'true');
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
        await screen.findByLabelText(/Общий капитал: /);

        // 5000 - 1500: залог в капитал не входит, но и не исчезает - он
        // назван отдельной строкой на том же слайде.
        expect(screen.getByLabelText(/Общий капитал: €3\.500,00/)).toBeInTheDocument();
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
        await screen.findByTitle('Настройки');

        // Ставим фильтр на категорию, которую сейчас удалим - через разбивку
        // расхода в панели статистики.
        fireEvent.click(await screen.findByRole('button', { name: /^Подписки: €/ }));
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /^Подписки: €/ })).toHaveAttribute('aria-pressed', 'true');
        });

        fireEvent.click(screen.getByTitle('Настройки'));
        fireEvent.click(await screen.findByLabelText('Удалить категорию: Подписки'));

        expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('операций: 1'));
        await waitFor(() => {
            expect(fetchMock).toHaveBeenCalledWith('/api/categories/c2', expect.objectContaining({ method: 'DELETE' }));
        });
        // Фильтр указывал на исчезнувшую категорию - его нужно снять.
        await waitFor(() => {
            expect(screen.queryByRole('button', { name: /^Подписки: €/ })).toHaveAttribute('aria-pressed', 'false');
        });
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
        await screen.findByTitle('Настройки');

        // Фильтр стоит на категории, которую сейчас переименуем.
        fireEvent.click(await screen.findByRole('button', { name: /^Подписки: €/ }));
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /^Подписки: €/ })).toHaveAttribute('aria-pressed', 'true');
        });

        fireEvent.click(screen.getByTitle('Настройки'));
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
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /^Сервисы: €/ })).toHaveAttribute('aria-pressed', 'true');
        });
        expect(screen.queryByRole('button', { name: /^Подписки: €/ })).not.toBeInTheDocument();
    });

    // Finding 3: a non-ok response (or one whose body isn't actually an
    // array - e.g. the 503 an unconfigured server returns, `{ message }`
    // instead of a list) used to get assigned straight into state, and the
    // later `.map(...)` over it threw, tripping the error boundary. It must
    // instead surface the server's own message via the notice banner and
    // leave state alone, rather than crashing or staying silently blank.
    it('shows the server message via the notice banner instead of crashing when /api/accounts responds with a non-array body', async () => {
        vi.stubGlobal('fetch', vi.fn((url) => {
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

        // Must not crash into the error boundary's generic screen, and must
        // show the server's own message rather than staying blank.
        await waitFor(() => {
            expect(screen.getByText(/Сервер не настроен/)).toBeInTheDocument();
        });
        expect(screen.getByText('BudgetTracker')).toBeInTheDocument();

        vi.unstubAllGlobals();
    });

    // Finding 4: the server now rejects saving a non-finite/non-positive
    // monthlyLimit, but a stale value could still be sitting in the settings
    // document from before that validation existed. fetchSettings' own guard
    // (typeof === 'number' && !isNaN) lets a legitimate-looking 0 through, so
    // the render-side guard is what actually has to catch it here.
    it('drops the limit ring instead of rendering NaN%/Infinity% when the stored monthly limit is not usable', async () => {
        vi.stubGlobal('fetch', vi.fn((url) => {
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
        await waitFor(() => screen.getByText('BudgetTracker'));

        expect(screen.queryByText(/NaN%/)).not.toBeInTheDocument();
        expect(screen.queryByText(/Infinity%/)).not.toBeInTheDocument();
        // An unusable limit has nothing to show a ring against, so the panel
        // falls back to the plain expense figure - and says nothing about a
        // percentage of a limit that isn't there.
        expect(screen.queryByText(/% от €/)).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^Расход: €/ })).toBeInTheDocument();

        vi.unstubAllGlobals();
    });

    // Finding 1: logout must only switch the UI to the logged-out state once
    // the server has actually confirmed the session cookie is cleared. This
    // is nested here (rather than a sibling describe) so it inherits the
    // shared beforeEach that renders the ordinary authenticated app and
    // stubs `fetch` with fetchMock - the "Настройки" panel and its
    // "Выйти" button need that same authenticated state to be reachable.
    describe('Logout', () => {
        it('keeps the authenticated state and reports the failure via the notice banner when /api/logout fails', async () => {
            render(<App />);
            await waitFor(() => screen.getByText('BudgetTracker'));

            const baseMock = fetchMock;
            vi.stubGlobal('fetch', vi.fn((url, options) => {
                if (typeof url === 'string' && url.includes('/api/logout')) {
                    return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ message: 'boom' }) });
                }
                return baseMock(url, options);
            }));

            fireEvent.click(screen.getByTitle('Настройки'));
            fireEvent.click(screen.getByRole('button', { name: 'Выйти' }));

            await waitFor(() => {
                expect(screen.getByRole('alert')).toBeInTheDocument();
            });
            // Still authenticated: the main UI is showing, not the login screen -
            // a stale cookie left over from a failed logout must not look like a
            // successful one.
            expect(screen.getByTestId('balance-carousel')).toBeInTheDocument();
            expect(screen.queryByLabelText('Пароль')).not.toBeInTheDocument();
        });

        it('drops to the login screen once /api/logout actually confirms success', async () => {
            render(<App />);
            await waitFor(() => screen.getByText('BudgetTracker'));

            fireEvent.click(screen.getByTitle('Настройки'));
            fireEvent.click(screen.getByRole('button', { name: 'Выйти' }));

            await waitFor(() => {
                expect(screen.getByLabelText('Пароль')).toBeInTheDocument();
            });
        });

        it('reports a network failure via the notice banner and stays authenticated', async () => {
            render(<App />);
            await waitFor(() => screen.getByText('BudgetTracker'));

            const baseMock = fetchMock;
            vi.stubGlobal('fetch', vi.fn((url, options) => {
                if (typeof url === 'string' && url.includes('/api/logout')) {
                    return Promise.reject(new Error('network down'));
                }
                return baseMock(url, options);
            }));
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            fireEvent.click(screen.getByTitle('Настройки'));
            fireEvent.click(screen.getByRole('button', { name: 'Выйти' }));

            await waitFor(() => {
                expect(screen.getByRole('alert')).toBeInTheDocument();
            });
            expect(screen.getByTestId('balance-carousel')).toBeInTheDocument();

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

        await handleAccountDragEnd(
            { active: { id: 'a' }, over: { id: 'c' } },
            { accounts: baseAccounts, setAccounts, apiFetch }
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

    it('shows the login screen when the initial accounts fetch comes back 401', async () => {
        vi.stubGlobal('fetch', vi.fn((url) => {
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
        expect(screen.queryByTestId('balance-carousel')).not.toBeInTheDocument();
    });

    it('reveals the app after a successful login', async () => {
        let authenticated = false;
        vi.stubGlobal('fetch', vi.fn((url) => {
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
            return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
        }));

        render(<App />);
        await waitFor(() => screen.getByText('BudgetTracker'));

        // Any authenticated-looking screen still needs a live session for
        // further calls - saving a new account here is what hits /api/accounts
        // again and discovers the session is gone.
        fireEvent.click(screen.getByTitle('Настройки'));
        fireEvent.change(screen.getByPlaceholderText(/Имя счёта/), { target: { value: 'Новый счёт' } });
        fireEvent.click(screen.getByRole('button', { name: 'Добавить счёт' }));

        await waitFor(() => {
            expect(screen.getByLabelText('Пароль')).toBeInTheDocument();
        });
    });
});
