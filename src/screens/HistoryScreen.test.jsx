import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import HistoryScreen from './HistoryScreen';

const groups = {
    '2026-01-05': {
        dailySum: -5,
        items: [
            {
                id: 'cash-1',
                title: 'Coffee',
                description: 'Coffee',
                type: 'expense',
                account: 'cash',
                category: 'Food',
                visualAmount: -5,
                excludeFromStats: false
            }
        ]
    },
    '2026-01-01': {
        dailySum: 5000,
        items: [
            {
                id: 'card-1',
                title: 'Salary',
                description: '',
                type: 'income',
                account: 'card',
                category: 'Job',
                visualAmount: 5000,
                excludeFromStats: false
            }
        ]
    }
};

// Результат usePagedHistory в том виде, в каком его отдаёт App.
const makeHistory = (overrides = {}) => ({
    transactions: groups,
    count: 2,
    nextCursor: null,
    previousCursor: null,
    loading: false,
    error: '',
    direction: 'older',
    key: 'history',
    loadMore: () => { },
    loadNewer: () => { },
    ...overrides
});

const baseProps = {
    history: makeHistory(),
    searchQuery: '',
    setSearchQuery: () => { },
    initialMonth: '2026-01',
    positionKey: '2026-01',
    onSelectMonth: () => { },
    accounts: [
        { _id: 'card', name: 'Карта', type: 'card', icon: '💳' },
        { _id: 'cash', name: 'Наличные', type: 'cash', icon: '💵' }
    ],
    categories: [],
    historyAccount: null,
    setHistoryAccount: () => { },
    historyCategory: null,
    setHistoryCategory: () => { },
    historyType: null,
    setHistoryType: () => { },
    exportToCSV: () => { },
    isExporting: false,
    openEditModal: () => { },
    getAccountDisplay: (id) => (id === 'card' ? 'Карта' : 'Наличные'),
    formatDate: (d) => d
};

const renderScreen = (props = {}) => render(<HistoryScreen {...baseProps} {...props} />);

describe('HistoryScreen', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('restores the list position when the tab is opened again, but resets for a new dashboard month', () => {
        // Экран размонтируется при уходе на другую вкладку, поэтому положение
        // хранит App (positionRef), а не сам экран.
        const positionRef = { current: { key: null, top: 0, pending: true } };
        const first = renderScreen({ positionRef, positionKey: '2026-01' });
        const scroll = screen.getByTestId('history-scroll');
        scroll.scrollTop = 450;
        fireEvent.scroll(scroll);
        first.unmount();

        const second = renderScreen({ positionRef, positionKey: '2026-01' });
        expect(screen.getByTestId('history-scroll').scrollTop).toBe(450);
        second.unmount();

        renderScreen({ positionRef, positionKey: '2026-02' });
        expect(screen.getByTestId('history-scroll').scrollTop).toBe(0);
    });

    it('titles the screen «История» and shows the result count while searching', () => {
        const { rerender } = renderScreen();
        expect(screen.getByRole('heading', { level: 1, name: 'История' })).toBeInTheDocument();

        rerender(<HistoryScreen {...baseProps} searchQuery="cof" history={makeHistory({ count: 7 })} />);
        expect(screen.getByRole('heading', { level: 1, name: 'Результаты поиска (7)' })).toBeInTheDocument();
    });

    it('renders transaction rows from the passed-in data', () => {
        renderScreen();
        expect(screen.getByText('Coffee')).toBeInTheDocument();
        expect(screen.getByText('Salary')).toBeInTheDocument();
    });

    it('keeps the list in its own scroll container, outside the header with search and filters', () => {
        renderScreen();
        const scroll = screen.getByTestId('history-scroll');

        expect(scroll.style.overflowY).toBe('auto');
        expect(scroll).toContainElement(screen.getByText('Coffee'));
        expect(scroll).not.toContainElement(screen.getByPlaceholderText('Поиск по названию или сумме...'));
        expect(scroll).not.toContainElement(screen.getByRole('heading', { level: 1 }));
    });

    it('passes typing in the search field up and clears it with the clear button', () => {
        const setSearchQuery = vi.fn();
        const { rerender } = renderScreen({ setSearchQuery });
        expect(screen.queryByRole('button', { name: 'Очистить поиск' })).not.toBeInTheDocument();

        fireEvent.change(screen.getByPlaceholderText('Поиск по названию или сумме...'), { target: { value: 'кофе' } });
        expect(setSearchQuery).toHaveBeenCalledWith('кофе');

        rerender(<HistoryScreen {...baseProps} setSearchQuery={setSearchQuery} searchQuery="кофе" />);
        fireEvent.click(screen.getByRole('button', { name: 'Очистить поиск' }));
        expect(setSearchQuery).toHaveBeenLastCalledWith('');
    });

    it('shows the empty-search text when nothing is found', () => {
        renderScreen({ searchQuery: 'zzz', history: makeHistory({ transactions: {}, count: 0 }) });
        expect(screen.getByText('Ничего не найдено')).toBeInTheDocument();
    });

    it('exports through the header button and shows the busy state while exporting', () => {
        const exportToCSV = vi.fn();
        const { rerender } = renderScreen({ exportToCSV });

        fireEvent.click(screen.getByRole('button', { name: /Экспорт/ }));
        expect(exportToCSV).toHaveBeenCalledTimes(1);

        rerender(<HistoryScreen {...baseProps} exportToCSV={exportToCSV} isExporting />);
        const busy = screen.getByRole('button', { name: /Экспорт…/ });
        expect(busy).toBeDisabled();
    });

    describe('account filter', () => {
        it('lists «Все счета» and one chip per account by name, with «Все счета» selected by default', () => {
            renderScreen();
            const group = within(screen.getByRole('group', { name: 'Фильтр по счёту' }));

            expect(group.getAllByRole('button').map(button => button.textContent)).toEqual(['Все счета', 'Карта', 'Наличные']);
            expect(group.getByRole('button', { name: 'Все счета' })).toHaveAttribute('aria-pressed', 'true');
            expect(group.getByRole('button', { name: 'Карта' })).toHaveAttribute('aria-pressed', 'false');
        });

        it('selects a single account by id and resets with «Все счета»', () => {
            const setHistoryAccount = vi.fn();
            const { rerender } = renderScreen({ setHistoryAccount });
            const group = () => within(screen.getByRole('group', { name: 'Фильтр по счёту' }));

            fireEvent.click(group().getByRole('button', { name: 'Наличные' }));
            expect(setHistoryAccount).toHaveBeenLastCalledWith('cash');

            rerender(<HistoryScreen {...baseProps} setHistoryAccount={setHistoryAccount} historyAccount="cash" />);
            expect(group().getByRole('button', { name: 'Наличные' })).toHaveAttribute('aria-pressed', 'true');
            expect(group().getByRole('button', { name: 'Все счета' })).toHaveAttribute('aria-pressed', 'false');

            fireEvent.click(group().getByRole('button', { name: 'Все счета' }));
            expect(setHistoryAccount).toHaveBeenLastCalledWith(null);
        });
    });

    describe('category and type filters', () => {
        const categories = [
            { _id: 'c1', name: 'Food', type: 'expense' },
            { _id: 'c2', name: 'Job', type: 'income' }
        ];

        it('shows every category chip without a type filter and only the matching ones with it', () => {
            const { rerender } = renderScreen({ categories });
            const row = () => within(screen.getByRole('group', { name: 'Фильтр по категории' }));
            expect(row().getAllByRole('button').map(button => button.textContent)).toEqual(['Food', 'Job']);

            rerender(<HistoryScreen {...baseProps} categories={categories} historyType="income" />);
            expect(row().getAllByRole('button').map(button => button.textContent)).toEqual(['Job']);
        });

        it('toggles a category chip on and off', () => {
            const setHistoryCategory = vi.fn();
            const { rerender } = renderScreen({ categories, setHistoryCategory });
            const row = () => within(screen.getByRole('group', { name: 'Фильтр по категории' }));

            fireEvent.click(row().getByRole('button', { name: 'Food' }));
            expect(setHistoryCategory).toHaveBeenLastCalledWith('Food');

            rerender(<HistoryScreen {...baseProps} categories={categories} setHistoryCategory={setHistoryCategory} historyCategory="Food" />);
            expect(row().getByRole('button', { name: 'Food' })).toHaveAttribute('aria-pressed', 'true');
            fireEvent.click(row().getByRole('button', { name: 'Food' }));
            expect(setHistoryCategory).toHaveBeenLastCalledWith(null);
        });

        it('shows a plaque for the active type and category, each with its own reset', () => {
            const setHistoryType = vi.fn();
            const setHistoryCategory = vi.fn();
            renderScreen({ categories, historyType: 'income', historyCategory: 'Job', setHistoryType, setHistoryCategory });

            expect(screen.getByText('Доходы')).toBeInTheDocument();
            const [resetType, resetCategory] = screen.getAllByRole('button', { name: /Сбросить/ });
            fireEvent.click(resetType);
            expect(setHistoryType).toHaveBeenCalledWith(null);
            fireEvent.click(resetCategory);
            expect(setHistoryCategory).toHaveBeenCalledWith(null);
        });

        it('shows no plaques and no «Счет:» plaque when nothing is filtered or an account is chosen', () => {
            const { rerender } = renderScreen({ categories });
            expect(screen.queryByRole('button', { name: /Сбросить/ })).not.toBeInTheDocument();

            rerender(<HistoryScreen {...baseProps} categories={categories} historyAccount="cash" />);
            expect(screen.queryByText(/Счет:/)).not.toBeInTheDocument();
        });
    });

    describe('paging', () => {
        it('offers «Загрузить еще» only while an older page exists and calls loadMore', () => {
            const loadMore = vi.fn();
            const { rerender } = renderScreen({ history: makeHistory({ nextCursor: 'next', loadMore }) });

            fireEvent.click(screen.getByRole('button', { name: 'Загрузить еще' }));
            expect(loadMore).toHaveBeenCalledTimes(1);

            rerender(<HistoryScreen {...baseProps} history={makeHistory({ nextCursor: null, loadMore })} />);
            expect(screen.queryByRole('button', { name: 'Загрузить еще' })).not.toBeInTheDocument();
        });

        it('offers «Загрузить более новые» when a newer page exists and calls loadNewer', () => {
            const loadNewer = vi.fn();
            renderScreen({ history: makeHistory({ previousCursor: 'prev', loadNewer }) });

            fireEvent.click(screen.getByRole('button', { name: 'Загрузить более новые' }));
            expect(loadNewer).toHaveBeenCalledTimes(1);
        });

        it('keeps the rows on screen and offers a retry when a later page fails', () => {
            const loadMore = vi.fn();
            renderScreen({ history: makeHistory({ nextCursor: 'next', error: 'Не удалось загрузить операции. Повторите попытку.', loadMore }) });

            expect(screen.getByText('Coffee')).toBeInTheDocument();
            expect(screen.getByRole('alert')).toHaveTextContent('Не удалось загрузить операции');
            fireEvent.click(screen.getByRole('button', { name: 'Повторить загрузку' }));
            expect(loadMore).toHaveBeenCalledTimes(1);
        });

        it('shows a loading skeleton while the first page is loading', () => {
            renderScreen({ history: makeHistory({ transactions: {}, count: 0, loading: true }) });
            expect(screen.getByRole('status', { name: 'Загрузка операций…' })).toBeInTheDocument();
        });

        it('loads the next page when the sentinel below the list scrolls into view', () => {
            let notify;
            const observe = vi.fn();
            const disconnect = vi.fn();
            vi.stubGlobal('IntersectionObserver', class {
                constructor(callback, options) { notify = callback; this.options = options; }
                observe(...args) { observe(...args); }
                disconnect() { disconnect(); }
            });
            const loadMore = vi.fn();
            const { unmount } = renderScreen({ history: makeHistory({ nextCursor: 'next', loadMore }) });

            expect(observe).toHaveBeenCalledTimes(1);
            notify([{ isIntersecting: false }]);
            expect(loadMore).not.toHaveBeenCalled();
            notify([{ isIntersecting: true }]);
            expect(loadMore).toHaveBeenCalledTimes(1);

            unmount();
            expect(disconnect).toHaveBeenCalled();
            vi.unstubAllGlobals();
        });
    });

    describe('month selection', () => {
        const twoMonths = {
            '2026-02-03': { dailySum: -1, items: [{ id: 'feb-1', title: 'Feb row', description: 'Feb row', type: 'expense', account: 'card', category: 'Food', visualAmount: -1, excludeFromStats: false }] },
            '2026-01-05': groups['2026-01-05']
        };

        it('scrolls to a month that is already loaded instead of asking for a new query', () => {
            const onSelectMonth = vi.fn();
            renderScreen({ history: makeHistory({ transactions: twoMonths }), initialMonth: '2026-02', positionKey: '2026-02', onSelectMonth });
            const scroll = screen.getByTestId('history-scroll');
            const january = scroll.querySelector('[data-history-month="2026-01"]');
            // jsdom не раскладывает элементы: подставляем смещение секции января
            // относительно контейнера, чтобы по scrollTop было видно прокрутку.
            vi.spyOn(january, 'getBoundingClientRect').mockReturnValue({ top: 320 });
            vi.spyOn(scroll, 'getBoundingClientRect').mockReturnValue({ top: 100 });

            fireEvent.click(within(january).getByRole('button', { name: /^Месяц истории:/ }));
            fireEvent.click(screen.getByRole('button', { name: 'Январь', exact: true }));

            expect(scroll.scrollTop).toBe(220);
            expect(onSelectMonth).not.toHaveBeenCalled();
        });

        it('asks App to load a month that is not in the list yet', () => {
            const onSelectMonth = vi.fn();
            renderScreen({ history: makeHistory({ transactions: twoMonths }), initialMonth: '2026-02', positionKey: '2026-02', onSelectMonth });
            const february = screen.getByTestId('history-scroll').querySelector('[data-history-month="2026-02"]');

            fireEvent.click(within(february).getByRole('button', { name: /^Месяц истории:/ }));
            fireEvent.click(screen.getByRole('button', { name: 'Декабрь', exact: true }));

            expect(onSelectMonth).toHaveBeenCalledWith('2025-12');
        });
    });

    // The category chip inside a row used to be a click-only <span> nested
    // inside the row's role="button" element - unreachable by keyboard and
    // invalid nesting regardless. It's a separately focusable control that is
    // NOT a descendant of the row's own button (a full-row overlay <button>),
    // so it must be reachable and activatable entirely on its own.
    it('exposes each row category as its own focusable, keyboard-activatable control', () => {
        const setHistoryCategory = vi.fn();
        renderScreen({ setHistoryCategory });

        const categoryChip = screen.getByRole('button', { name: 'Food' });
        categoryChip.focus();
        expect(categoryChip).toHaveFocus();

        fireEvent.keyDown(categoryChip, { key: 'Enter' });
        expect(setHistoryCategory).toHaveBeenCalledWith('Food');
    });

    it('activates a row category with Space too, without also opening the edit modal', () => {
        const setHistoryCategory = vi.fn();
        const openEditModal = vi.fn();
        renderScreen({ setHistoryCategory, openEditModal });

        const categoryChip = screen.getByRole('button', { name: 'Job' });
        fireEvent.keyDown(categoryChip, { key: ' ' });

        expect(setHistoryCategory).toHaveBeenCalledWith('Job');
        expect(openEditModal).not.toHaveBeenCalled();
    });

    it('still opens the edit modal by clicking anywhere else on an editable row', () => {
        const openEditModal = vi.fn();
        renderScreen({ openEditModal });

        fireEvent.click(screen.getByRole('button', { name: /Coffee/ }));

        expect(openEditModal).toHaveBeenCalledWith(expect.objectContaining({ id: 'cash-1' }));
    });

    // openEditModal() deliberately no-ops for seeded 'initial' transactions -
    // a focusable, clickable control that does nothing is worse than not
    // exposing one at all, so those rows must render no row-level button,
    // tabIndex, or click/keyboard handler.
    it('omits the row button entirely for a seeded "initial" transaction, since openEditModal no-ops for it', () => {
        const openEditModal = vi.fn();
        const history = makeHistory({
            transactions: {
                '2026-01-01': {
                    dailySum: 0,
                    items: [
                        {
                            id: 'init-1',
                            title: 'Starting balance',
                            description: '',
                            type: 'initial',
                            account: 'card',
                            category: '',
                            visualAmount: 1000,
                            excludeFromStats: false
                        }
                    ]
                }
            }
        });
        renderScreen({ history, openEditModal });

        expect(screen.getByText('Starting balance')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Starting balance/ })).not.toBeInTheDocument();

        fireEvent.click(screen.getByText('Starting balance'));
        expect(openEditModal).not.toHaveBeenCalled();
    });

    it('names both ends of a transfer row, not just the source account', () => {
        const history = makeHistory({
            transactions: {
                '2026-01-03': {
                    dailySum: 0,
                    items: [
                        {
                            id: 'transfer-1',
                            title: 'Перевод',
                            description: '',
                            type: 'transfer',
                            account: 'cash',
                            toAccount: 'card',
                            category: 'Перевод',
                            visualAmount: 200,
                            excludeFromStats: false
                        }
                    ]
                }
            }
        });
        renderScreen({ history });

        expect(screen.getByText(
            (_, el) => el?.textContent.replace(/\s+/g, ' ') === 'Перевод · Наличные Карта',
            { selector: 'div' }
        )).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Наличные → Карта/ })).toBeInTheDocument();
    });

    it('lays the days out on the gray page background: no outer card, plain month bar', () => {
        renderScreen();

        const scroll = screen.getByTestId('history-scroll');
        expect(scroll.style.background).toBe('var(--color-bg)');
        expect(scroll.querySelector('.glass-panel')).toBeNull();

        const heading = screen.getByTestId('history-month-heading');
        expect(heading.style.background).toBe('var(--color-bg)');
        expect(heading.style.position).toBe('sticky');
        expect(heading.style.borderBottom).toBe('');

        const days = scroll.querySelectorAll('[data-history-date]');
        expect(days).toHaveLength(2);
        expect(days[0].children[1].style.background).toBe('var(--color-surface)');
    });

    it('hides the category in every row subtitle while the list is filtered by it', () => {
        renderScreen({ historyCategory: 'Food' });
        const scroll = screen.getByTestId('history-scroll');
        const coffee = scroll.querySelector('[data-history-item="cash-1"] [data-testid="transaction-subtitle"]');
        expect(coffee).toHaveTextContent('Наличные');
        expect(coffee).not.toHaveTextContent('Food');
        const salary = scroll.querySelector('[data-history-item="card-1"] [data-testid="transaction-subtitle"]');
        expect(salary).toHaveTextContent('Job · Карта');
    });
});
