import { render, screen, fireEvent, within, act } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
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

// Результат useHistoryList в том виде, в каком его отдаёт App.
const makeHistory = (overrides = {}) => ({
    transactions: groups,
    count: 2,
    loading: false,
    refreshing: false,
    error: '',
    dataKey: 'history',
    retry: () => { },
    reset: () => { },
    ...overrides
});

// Длинная лента: по одной операции в день, дни подряд вниз от 2026-03-31
// (март, февраль, январь... 2025 года), чтобы окно было меньше списка.
const longList = (n = 300, perDay = 1) => {
    const result = {};
    for (let i = 0; i < n; i += 1) {
        const date = new Date(Date.UTC(2026, 2, 31) - i * 86400000).toISOString().slice(0, 10);
        result[date] = { dailySum: -perDay, items: Array.from({ length: perDay }, (_, k) => ({ id: `row-${String(i).padStart(3, '0')}${perDay > 1 ? `-${k}` : ''}`, title: `Row ${i}`, description: `Row ${i}`, type: 'expense', account: 'card', category: 'Food', visualAmount: -1, excludeFromStats: false })) };
    }
    return result;
};
const rowIds = () => [...document.querySelectorAll('[data-history-item]')].map(element => element.getAttribute('data-history-item'));

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

    it('keeps the title «История» while searching: the count lives in the summary line', () => {
        const { rerender } = renderScreen();
        expect(screen.getByRole('heading', { level: 1, name: 'История' })).toBeInTheDocument();

        rerender(<HistoryScreen {...baseProps} searchQuery="cof" history={makeHistory({ count: 7 })} />);
        expect(screen.getByRole('heading', { level: 1, name: 'История' })).toBeInTheDocument();
        expect(screen.getByText(/Найдено 7 операций/)).toBeInTheDocument();
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
        expect(scroll).not.toContainElement(screen.getByPlaceholderText('Компания, комментарий или сумма'));
        expect(scroll).not.toContainElement(screen.getByRole('heading', { level: 1 }));
    });

    it('passes typing in the search field up and clears it with the clear button', () => {
        const setSearchQuery = vi.fn();
        const { rerender } = renderScreen({ setSearchQuery });
        expect(screen.queryByRole('button', { name: 'Очистить поиск' })).not.toBeInTheDocument();

        fireEvent.change(screen.getByPlaceholderText('Компания, комментарий или сумма'), { target: { value: 'кофе' } });
        expect(setSearchQuery).toHaveBeenCalledWith('кофе');

        rerender(<HistoryScreen {...baseProps} setSearchQuery={setSearchQuery} searchQuery="кофе" />);
        fireEvent.click(screen.getByRole('button', { name: 'Очистить поиск' }));
        expect(setSearchQuery).toHaveBeenLastCalledWith('');
    });

    describe('empty search', () => {
        const empty = { history: makeHistory({ transactions: {}, count: 0 }), searchQuery: 'zzz' };

        it('shows a centered «Ничего не нашлось» without actions when no filter is active', () => {
            renderScreen(empty);
            expect(screen.getByText('Ничего не нашлось')).toBeInTheDocument();
            expect(screen.getByText('По запросу «zzz» операций нет.')).toBeInTheDocument();
            expect(screen.queryByText('Ничего не найдено')).not.toBeInTheDocument();
            expect(screen.queryByRole('button', { name: /Искать/ })).not.toBeInTheDocument();
        });

        it('describes the active filters and hints at them', () => {
            renderScreen({ ...empty, historyAccount: 'card', historyCategory: 'Еда', historyType: 'expense' });
            expect(screen.getByText('По запросу «zzz» на счёте Карта в категории «Еда» среди расходов операций нет. Возможно, мешает фильтр.')).toBeInTheDocument();
        });

        it('offers one action per active filter and each clears only its own filter', () => {
            const setHistoryAccount = vi.fn();
            const setHistoryCategory = vi.fn();
            const setHistoryType = vi.fn();
            renderScreen({ ...empty, historyAccount: 'card', historyCategory: 'Еда', historyType: 'income', setHistoryAccount, setHistoryCategory, setHistoryType });

            fireEvent.click(screen.getByRole('button', { name: 'Искать по всем счетам' }));
            expect(setHistoryAccount).toHaveBeenLastCalledWith(null);
            fireEvent.click(screen.getByRole('button', { name: 'Искать во всех категориях' }));
            expect(setHistoryCategory).toHaveBeenLastCalledWith(null);
            fireEvent.click(screen.getByRole('button', { name: 'Искать среди всех операций' }));
            expect(setHistoryType).toHaveBeenLastCalledWith(null);
            expect(setHistoryAccount).toHaveBeenCalledTimes(1);
            expect(setHistoryCategory).toHaveBeenCalledTimes(1);
            expect(setHistoryType).toHaveBeenCalledTimes(1);
        });

        it('shows only the actions of the filters that are on', () => {
            renderScreen({ ...empty, historyType: 'income' });
            expect(screen.getAllByRole('button', { name: /^Искать/ }).map(button => button.textContent)).toEqual(['Искать среди всех операций']);
        });

        it('does not show the empty state while loading or after an error', () => {
            const { rerender } = renderScreen({ ...empty, history: makeHistory({ transactions: {}, loading: true }) });
            expect(screen.queryByText('Ничего не нашлось')).not.toBeInTheDocument();
            rerender(<HistoryScreen {...baseProps} {...empty} history={makeHistory({ transactions: {}, error: 'Сбой' })} />);
            expect(screen.queryByText('Ничего не нашлось')).not.toBeInTheDocument();
        });
    });

    describe('refresh after a write', () => {
        it('keeps the previous rows with a small status instead of the skeleton', () => {
            renderScreen({ history: makeHistory({ refreshing: true }) });
            expect(screen.getByRole('status')).toHaveTextContent('Обновление…');
            expect(screen.queryByRole('status', { name: 'Загрузка операций…' })).not.toBeInTheDocument();
            expect(screen.getAllByRole('button', { name: /,/ }).length).toBeGreaterThan(0);
        });

        it('still shows the skeleton for a plain load', () => {
            renderScreen({ history: makeHistory({ transactions: {}, loading: true }) });
            expect(screen.getByRole('status', { name: 'Загрузка операций…' })).toBeInTheDocument();
        });
    });

    describe('empty month', () => {
        const emptyMonth = { history: makeHistory({ transactions: {}, count: 0 }) };

        it('shows a quiet line without a reset button when no filter is active', () => {
            renderScreen(emptyMonth);
            expect(screen.getByText('В этом месяце нет операций')).toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'Сбросить фильтры' })).not.toBeInTheDocument();
        });

        it('resets account, category and type with «Сбросить фильтры»', () => {
            const setHistoryAccount = vi.fn();
            const setHistoryCategory = vi.fn();
            const setHistoryType = vi.fn();
            renderScreen({ ...emptyMonth, historyAccount: 'card', historyType: 'expense', setHistoryAccount, setHistoryCategory, setHistoryType });

            fireEvent.click(screen.getByRole('button', { name: 'Сбросить фильтры' }));
            expect(setHistoryAccount).toHaveBeenCalledWith(null);
            expect(setHistoryCategory).toHaveBeenCalledWith(null);
            expect(setHistoryType).toHaveBeenCalledWith(null);
        });
    });

    it('subtracts the sync status strip from the screen height', () => {
        const { container } = renderScreen();
        expect(container.firstChild.getAttribute('style')).toContain('var(--status-strip-height, 0px)');
    });

    it('disables export only when the list is completely empty', () => {
        const { rerender } = renderScreen();
        expect(screen.getByRole('button', { name: 'Выгрузить в CSV' })).toBeEnabled();

        rerender(<HistoryScreen {...baseProps} history={makeHistory({ transactions: {}, count: 0 })} />);
        expect(screen.getByRole('button', { name: 'Выгрузить в CSV' })).toBeDisabled();

        rerender(<HistoryScreen {...baseProps} history={makeHistory({ transactions: {}, count: 0, loading: true })} />);
        expect(screen.getByRole('button', { name: 'Выгрузить в CSV' })).toBeEnabled();
    });

    it('exports through the icon button in the header and marks it busy while exporting', () => {
        const exportToCSV = vi.fn();
        const { rerender } = renderScreen({ exportToCSV });

        const button = screen.getByRole('button', { name: 'Выгрузить в CSV' });
        expect(button).toHaveAttribute('aria-busy', 'false');
        expect(button.style.minWidth).toBe('44px');
        fireEvent.click(button);
        expect(exportToCSV).toHaveBeenCalledTimes(1);

        rerender(<HistoryScreen {...baseProps} exportToCSV={exportToCSV} isExporting />);
        const busy = screen.getByRole('button', { name: 'Выгрузить в CSV' });
        expect(busy).toBeDisabled();
        expect(busy).toHaveAttribute('aria-busy', 'true');
    });

    describe('filter row', () => {
        const categories = [
            { _id: 'c1', name: 'Food', type: 'expense' },
            { _id: 'c2', name: 'Job', type: 'income' },
            { _id: 'c3', name: 'Другое', type: 'expense' },
            { _id: 'c4', name: 'Другое', type: 'income' }
        ];
        const row = () => within(screen.getByRole('group', { name: 'Фильтры' }));

        it('shows three inactive pills and no chip rows or plaques', () => {
            renderScreen({ categories });
            expect(row().getAllByRole('button').map(button => button.textContent)).toEqual(['Категория', 'Все счета', 'Любой тип']);
            expect(screen.queryByRole('group', { name: 'Фильтр по счёту' })).not.toBeInTheDocument();
            expect(screen.queryByRole('group', { name: 'Фильтр по категории' })).not.toBeInTheDocument();
            expect(screen.queryByText('Тип:')).not.toBeInTheDocument();
            expect(screen.queryByRole('button', { name: /Снять фильтр/ })).not.toBeInTheDocument();
        });

        it('shows the chosen values on active pills, each with its own clear button', () => {
            const setHistoryAccount = vi.fn();
            const setHistoryCategory = vi.fn();
            const setHistoryType = vi.fn();
            renderScreen({ categories, historyAccount: 'cash', historyCategory: 'Job', historyType: 'income', setHistoryAccount, setHistoryCategory, setHistoryType });

            expect(row().getByRole('button', { name: 'Категория: Job' })).toHaveTextContent('Job');
            expect(row().getByRole('button', { name: 'Счёт: Наличные' })).toHaveTextContent('Наличные');
            expect(row().getByRole('button', { name: 'Тип: Доходы' })).toHaveTextContent('Доходы');

            fireEvent.click(row().getByRole('button', { name: 'Снять фильтр «Job»' }));
            expect(setHistoryCategory).toHaveBeenLastCalledWith(null);
            fireEvent.click(row().getByRole('button', { name: 'Снять фильтр «Наличные»' }));
            expect(setHistoryAccount).toHaveBeenLastCalledWith(null);
            fireEvent.click(row().getByRole('button', { name: 'Снять фильтр «Доходы»' }));
            expect(setHistoryType).toHaveBeenLastCalledWith(null);
        });

        it('does not nest the clear button inside the label button', () => {
            renderScreen({ categories, historyCategory: 'Food' });
            const clear = row().getByRole('button', { name: 'Снять фильтр «Food»' });
            expect(clear.closest('button')).toBe(clear);
            expect(clear.parentElement.closest('button')).toBeNull();
        });

        it('opens the sheet from an active pill label without clearing the filter', () => {
            const setHistoryCategory = vi.fn();
            renderScreen({ categories, historyCategory: 'Food', setHistoryCategory });
            fireEvent.click(row().getByRole('button', { name: 'Категория: Food' }));
            expect(screen.getByRole('dialog', { name: 'Категория' })).toBeInTheDocument();
            expect(setHistoryCategory).not.toHaveBeenCalled();
        });
    });

    describe('account sheet', () => {
        const open = props => {
            const result = renderScreen(props);
            fireEvent.click(screen.getByRole('button', { name: 'Все счета' }));
            return result;
        };
        const radios = () => within(screen.getByRole('radiogroup', { name: 'Счёт' })).getAllByRole('radio');

        it('lists «Все счета» and one row per account, with «Все счета» checked by default', () => {
            open();
            expect(screen.getByRole('dialog', { name: 'Счёт' })).toBeInTheDocument();
            expect(radios().map(radio => radio.textContent)).toEqual(['Все счета', 'Карта', 'Наличные']);
            expect(radios()[0]).toHaveAttribute('aria-checked', 'true');
            expect(radios()[1]).toHaveAttribute('aria-checked', 'false');
        });

        it('applies a single account by id and closes the sheet', () => {
            const setHistoryAccount = vi.fn();
            open({ setHistoryAccount });
            fireEvent.click(radios()[2]);
            expect(setHistoryAccount).toHaveBeenLastCalledWith('cash');
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        });

        it('marks the chosen account and resets with the first row', () => {
            const setHistoryAccount = vi.fn();
            renderScreen({ historyAccount: 'cash', setHistoryAccount });
            fireEvent.click(screen.getByRole('button', { name: 'Счёт: Наличные' }));
            expect(radios()[2]).toHaveAttribute('aria-checked', 'true');
            expect(radios()[0]).toHaveAttribute('aria-checked', 'false');

            fireEvent.click(radios()[0]);
            expect(setHistoryAccount).toHaveBeenLastCalledWith(null);
        });

        it('closes with the close button and with Escape without changing the filter', () => {
            const setHistoryAccount = vi.fn();
            open({ setHistoryAccount });
            fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

            fireEvent.click(screen.getByRole('button', { name: 'Все счета' }));
            fireEvent.keyDown(document, { key: 'Escape' });
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
            expect(setHistoryAccount).not.toHaveBeenCalled();
        });
    });

    describe('category and type sheets', () => {
        const categories = [
            { _id: 'c1', name: 'Food', type: 'expense' },
            { _id: 'c2', name: 'Job', type: 'income' },
            { _id: 'c3', name: 'Другое', type: 'expense' },
            { _id: 'c4', name: 'Другое', type: 'income' }
        ];
        const radios = name => within(screen.getByRole('radiogroup', { name })).getAllByRole('radio');

        it('offers every category once without a type and only the matching ones with it', () => {
            const { rerender } = renderScreen({ categories });
            fireEvent.click(screen.getByRole('button', { name: 'Категория' }));
            expect(radios('Категория').map(radio => radio.textContent)).toEqual(['Все категории', 'Food', 'Job', 'Другое']);
            fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));

            rerender(<HistoryScreen {...baseProps} categories={categories} historyType="income" />);
            fireEvent.click(screen.getByRole('button', { name: 'Категория' }));
            expect(radios('Категория').map(radio => radio.textContent)).toEqual(['Все категории', 'Job', 'Другое']);
        });

        it('applies a category by name, marks it, and resets with «Все категории»', () => {
            const setHistoryCategory = vi.fn();
            const { rerender } = renderScreen({ categories, setHistoryCategory });
            fireEvent.click(screen.getByRole('button', { name: 'Категория' }));
            fireEvent.click(radios('Категория')[1]);
            expect(setHistoryCategory).toHaveBeenLastCalledWith('Food');
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

            rerender(<HistoryScreen {...baseProps} categories={categories} setHistoryCategory={setHistoryCategory} historyCategory="Food" />);
            fireEvent.click(screen.getByRole('button', { name: 'Категория: Food' }));
            expect(radios('Категория')[1]).toHaveAttribute('aria-checked', 'true');
            expect(radios('Категория')[0]).toHaveAttribute('aria-checked', 'false');
            fireEvent.click(radios('Категория')[0]);
            expect(setHistoryCategory).toHaveBeenLastCalledWith(null);
        });

        it('offers expenses and income for the type', () => {
            const setHistoryType = vi.fn();
            renderScreen({ categories, setHistoryType });
            fireEvent.click(screen.getByRole('button', { name: 'Любой тип' }));
            expect(screen.getByRole('dialog', { name: 'Тип операции' })).toBeInTheDocument();
            expect(radios('Тип операции').map(radio => radio.textContent)).toEqual(['Любой тип', 'Расходы', 'Доходы']);
            fireEvent.click(radios('Тип операции')[2]);
            expect(setHistoryType).toHaveBeenLastCalledWith('income');
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        });

        it('drops a chosen category of the other type when the type is picked', () => {
            const setHistoryType = vi.fn();
            const setHistoryCategory = vi.fn();
            renderScreen({ categories, historyCategory: 'Food', setHistoryType, setHistoryCategory });
            fireEvent.click(screen.getByRole('button', { name: 'Любой тип' }));
            fireEvent.click(radios('Тип операции')[2]);
            expect(setHistoryCategory).toHaveBeenLastCalledWith(null);
            expect(setHistoryType).toHaveBeenLastCalledWith('income');
        });

        it('keeps a chosen category of the same type', () => {
            const setHistoryCategory = vi.fn();
            renderScreen({ categories, historyCategory: 'Food', setHistoryCategory, setHistoryType: vi.fn() });
            fireEvent.click(screen.getByRole('button', { name: 'Любой тип' }));
            fireEvent.click(radios('Тип операции')[1]);
            expect(setHistoryCategory).not.toHaveBeenCalled();
        });
    });

    describe('summary line', () => {
        const filtered = { historyCategory: 'Food', history: makeHistory({ count: 14 }) };

        it('is hidden with no filter and no search', () => {
            renderScreen();
            expect(screen.queryByText(/Найдено/)).not.toBeInTheDocument();
            expect(screen.queryByText(/Итого/)).not.toBeInTheDocument();
        });

        it('shows the found count with a plural and the signed total once a filter is on', () => {
            renderScreen(filtered);
            expect(screen.getByText('Найдено 14 операций')).toBeInTheDocument();
            // -5 расход и +5000 доход из двух дней
            expect(screen.getByText(/^Итого/)).toHaveTextContent('Итого +€4.995,00');
            expect(screen.getByText('+€4.995,00').tagName).toBe('STRONG');
        });

        it('declines the count word and shows a minus for a negative total', () => {
            const expenses = { '2026-01-05': { dailySum: -612.4, items: groups['2026-01-05'].items } };
            const { rerender } = renderScreen({ historyType: 'expense', history: makeHistory({ transactions: expenses, count: 1 }) });
            expect(screen.getByText('Найдено 1 операция')).toBeInTheDocument();
            expect(screen.getByText(/^Итого/)).toHaveTextContent('Итого −€612,40');

            rerender(<HistoryScreen {...baseProps} historyType="expense" history={makeHistory({ transactions: expenses, count: 3 })} />);
            expect(screen.getByText('Найдено 3 операции')).toBeInTheDocument();
        });

        it('shows up for a search without filters too', () => {
            renderScreen({ searchQuery: 'cof', history: makeHistory({ count: 2 }) });
            expect(screen.getByText('Найдено 2 операции')).toBeInTheDocument();
        });

        it('is hidden while nothing is loaded', () => {
            renderScreen({ historyCategory: 'Food', history: makeHistory({ transactions: {}, count: 0, loading: true }) });
            expect(screen.queryByText(/Найдено/)).not.toBeInTheDocument();
        });
    });

    describe('window over the whole list', () => {
        const observer = () => {
            const instances = [];
            vi.stubGlobal('IntersectionObserver', class {
                constructor(callback) { this.callback = callback; instances.push(this); }
                observe() { }
                disconnect() { this.gone = true; }
            });
            return instances;
        };
        afterEach(() => vi.unstubAllGlobals());

        it('renders only a window of ~60 rows starting at the anchor month', () => {
            const history = makeHistory({ transactions: longList(), count: 300 });
            renderScreen({ history, initialMonth: '2026-02', positionKey: '2026-02' });
            const ids = rowIds();
            expect(ids.length).toBeGreaterThanOrEqual(60);
            expect(ids.length).toBeLessThan(100);
            // 28 февральских дней идут первыми, март выше окна.
            expect(document.querySelector('[data-history-month="2026-03"]')).toBeNull();
            expect(document.querySelector('[data-history-month="2026-02"]')).not.toBeNull();
            expect(ids[0]).toBe('row-031');
        });

        it('draws older days when the sentinel below the list scrolls into view', () => {
            const instances = observer();
            const history = makeHistory({ transactions: longList(), count: 300 });
            renderScreen({ history, initialMonth: '2026-03', positionKey: '2026-03' });
            const before = rowIds().length;
            const active = () => instances.filter(instance => !instance.gone).at(-1);
            act(() => active().callback([{ isIntersecting: false }]));
            expect(rowIds()).toHaveLength(before);
            act(() => active().callback([{ isIntersecting: true }]));
            expect(rowIds().length).toBeGreaterThanOrEqual(before + 60);
            // Новый наблюдатель на каждый сдвиг окна; в конце списка сторож не нужен.
            for (let i = 0; i < 10; i += 1) act(() => active()?.callback([{ isIntersecting: true }]));
            expect(rowIds()).toHaveLength(300);
            expect(instances.every(instance => instance.gone)).toBe(true);
        });

        it('never asks for more data: no load buttons and no retry without an error', () => {
            renderScreen({ history: makeHistory({ transactions: longList(), count: 300 }), initialMonth: '2026-03' });
            expect(screen.queryByRole('button', { name: 'Загрузить еще' })).not.toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'Загрузить более новые' })).not.toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'Повторить загрузку' })).not.toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'Показать более новые' })).not.toBeInTheDocument();
        });

        it('opens newer days with a button when the window starts at an older month, keeping the screen position', () => {
            const history = makeHistory({ transactions: longList(), count: 300 });
            renderScreen({ history, initialMonth: '2026-02', positionKey: '2026-02' });
            const scroll = screen.getByTestId('history-scroll');
            // Строка row-031 стоит на экране 40px от верха; после дорисовки новых
            // дней сверху она окажется на 1240px ниже, и прокрутка должна это скомпенсировать.
            vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () {
                const id = this.getAttribute?.('data-history-item');
                const pushed = document.querySelector('[data-history-item="row-000"]') ? 1240 : 0;
                const top = id === 'row-031' ? 40 + pushed : 0;
                return { top, bottom: top + 10, left: 0, right: 0, width: 0, height: 10 };
            });
            const before = rowIds().length;
            fireEvent.click(screen.getByRole('button', { name: 'Показать более новые' }));
            expect(rowIds().length).toBeGreaterThanOrEqual(before + 28);
            expect(rowIds()).toContain('row-000');
            expect(scroll.scrollTop).toBe(1240);
            expect(screen.queryByRole('button', { name: 'Показать более новые' })).not.toBeInTheDocument();
        });

        it('opens newer days when scrolling up near the top of the list', () => {
            const history = makeHistory({ transactions: longList(), count: 300 });
            renderScreen({ history, initialMonth: '2026-01', positionKey: '2026-01' });
            const scroll = screen.getByTestId('history-scroll');
            scroll.scrollTop = 800;
            fireEvent.scroll(scroll);
            const before = rowIds().length;
            scroll.scrollTop = 20;
            fireEvent.scroll(scroll);
            expect(rowIds().length).toBeGreaterThan(before);
        });

        it('shows a retry for a failed refresh while keeping the rows', () => {
            const retry = vi.fn();
            renderScreen({ history: makeHistory({ error: 'Не удалось загрузить операции. Повторите попытку.', retry }) });
            expect(screen.getByText('Coffee')).toBeInTheDocument();
            expect(screen.getByRole('alert')).toHaveTextContent('Не удалось загрузить операции');
            fireEvent.click(screen.getByRole('button', { name: 'Повторить загрузку' }));
            expect(retry).toHaveBeenCalledTimes(1);
        });

        it('shows a loading skeleton only while loading with no data', () => {
            renderScreen({ history: makeHistory({ transactions: {}, count: 0, loading: true }) });
            expect(screen.getByRole('status', { name: 'Загрузка операций…' })).toBeInTheDocument();
        });

        it('starts a search at the top with no month anchor', () => {
            renderScreen({ history: makeHistory({ transactions: longList(), count: 300, dataKey: 'search' }), searchQuery: 'row', initialMonth: '2026-01' });
            expect(rowIds()[0]).toBe('row-000');
            expect(screen.queryByRole('button', { name: 'Показать более новые' })).not.toBeInTheDocument();
        });

        it('re-anchors the window to a new month without any request and scrolls there', () => {
            const history = makeHistory({ transactions: longList(), count: 300 });
            const { rerender } = renderScreen({ history, initialMonth: '2026-03', positionKey: '2026-03' });
            expect(rowIds()[0]).toBe('row-000');
            rerender(<HistoryScreen {...baseProps} history={history} initialMonth="2025-10" positionKey="2026-03" />);
            expect(rowIds()[0]).toBe('row-151');
            expect(document.querySelector('[data-history-month="2026-03"]')).toBeNull();
            expect(screen.getByTestId('history-scroll').scrollTop).toBe(0);
        });

        it('keeps the window and the scroll position when the data is refreshed in the background', () => {
            const instances = observer();
            const history = makeHistory({ transactions: longList(), count: 300 });
            const { rerender } = renderScreen({ history, initialMonth: '2026-03', positionKey: '2026-03' });
            act(() => instances.filter(instance => !instance.gone).at(-1).callback([{ isIntersecting: true }]));
            const scroll = screen.getByTestId('history-scroll');
            scroll.scrollTop = 700;
            fireEvent.scroll(scroll);
            const ids = rowIds();
            // Обновление: новый объект списка с той же лентой и одной новой строкой в окне.
            const refreshed = longList();
            refreshed['2026-03-31'] = { ...refreshed['2026-03-31'], items: [...refreshed['2026-03-31'].items, { ...refreshed['2026-03-31'].items[0], id: 'row-new' }] };
            rerender(<HistoryScreen {...baseProps} history={{ ...history, transactions: refreshed, refreshing: true }} initialMonth="2026-03" positionKey="2026-03" />);
            expect(scroll.scrollTop).toBe(700);
            expect(rowIds()).toHaveLength(ids.length + 1);
            expect(rowIds()).toContain('row-new');
            expect(screen.getByRole('status')).toHaveTextContent('Обновление…');
        });

        it('restores the same window and position when the tab is opened again', () => {
            const instances = observer();
            const positionRef = { current: { key: null, top: 0, pending: true } };
            const history = makeHistory({ transactions: longList(), count: 300 });
            const first = renderScreen({ history, positionRef, initialMonth: '2026-03', positionKey: '2026-03' });
            act(() => instances.filter(instance => !instance.gone).at(-1).callback([{ isIntersecting: true }]));
            const ids = rowIds();
            const scroll = screen.getByTestId('history-scroll');
            scroll.scrollTop = 900;
            fireEvent.scroll(scroll);
            first.unmount();
            renderScreen({ history, positionRef, initialMonth: '2026-03', positionKey: '2026-03' });
            expect(rowIds()).toEqual(ids);
            expect(screen.getByTestId('history-scroll').scrollTop).toBe(900);
        });
    });

    describe('month selection', () => {
        const twoMonths = {
            '2026-02-03': { dailySum: -1, items: [{ id: 'feb-1', title: 'Feb row', description: 'Feb row', type: 'expense', account: 'card', category: 'Food', visualAmount: -1, excludeFromStats: false }] },
            '2026-01-05': groups['2026-01-05']
        };

        it('scrolls to a month that is already shown instead of asking App', () => {
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

        it('hands a month outside the window to App, which re-anchors the window locally', () => {
            const onSelectMonth = vi.fn();
            renderScreen({ history: makeHistory({ transactions: twoMonths }), initialMonth: '2026-02', positionKey: '2026-02', onSelectMonth });
            const february = screen.getByTestId('history-scroll').querySelector('[data-history-month="2026-02"]');

            fireEvent.click(within(february).getByRole('button', { name: /^Месяц истории:/ }));
            fireEvent.click(screen.getByRole('button', { name: 'Декабрь', exact: true }));

            expect(onSelectMonth).toHaveBeenCalledWith('2025-12');
        });

        it('rebuilds the top month from its first day when newer days were opened only partly above', () => {
            const onSelectMonth = vi.fn();
            const history = makeHistory({ transactions: longList(300, 2), count: 600 });
            renderScreen({ history, initialMonth: '2026-02', positionKey: '2026-02', onSelectMonth });
            // 60 строк = 30 дней вверх от 28 февраля: март показан не с 31-го числа.
            fireEvent.click(screen.getByRole('button', { name: 'Показать более новые' }));
            expect(rowIds()).not.toContain('row-000-0');
            expect(rowIds()).toContain('row-001-0');
            const march = screen.getByTestId('history-scroll').querySelector('[data-history-month="2026-03"]');
            fireEvent.click(within(march).getByRole('button', { name: /^Месяц истории:/ }));
            fireEvent.click(screen.getByRole('button', { name: 'Март', exact: true }));
            expect(onSelectMonth).toHaveBeenCalledWith('2026-03');
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
    describe('rows the list is told to animate', () => {
        beforeEach(() => { Element.prototype.animate = vi.fn(() => ({ cancel: vi.fn() })); });
        afterEach(() => { delete Element.prototype.animate; });

        it('collapses and locks the rows from leavingIds, and tints the ones from freshIds', () => {
            renderScreen({ history: makeHistory({ freshIds: new Set(['card-1']), leavingIds: new Set(['cash-1']) }) });
            const scroll = screen.getByTestId('history-scroll');

            const leaving = scroll.querySelector('[data-history-item="cash-1"]');
            expect(leaving).toHaveAttribute('inert');
            expect(leaving).toHaveStyle({ height: '0px', overflow: 'hidden' });
            // Единственная строка дня уходит - сворачивается день целиком.
            expect(scroll.querySelector('[data-history-date="2026-01-05"]')).toHaveAttribute('inert');
            expect(scroll.querySelector('[data-history-item="card-1"]').parentElement).toHaveClass('tx-fresh');
        });

        it('behaves as before when the list reports no fresh or leaving rows', () => {
            renderScreen({ history: makeHistory({ freshIds: new Set(), leavingIds: new Set() }) });
            const scroll = screen.getByTestId('history-scroll');

            expect(scroll.querySelector('[inert]')).toBeNull();
            expect(scroll.querySelector('.tx-fresh')).toBeNull();
            expect(Element.prototype.animate).not.toHaveBeenCalled();
        });
    });
});
