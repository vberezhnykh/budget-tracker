import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TransactionList from './TransactionList';
import { transformTransactions } from '../utils/finance';
// Группы по дням экран получает с сервера готовыми - берём их оттуда же.
import { computePeriodData } from '../../server/periodStats.js';

const day = '2026-09-12';
const ACCOUNT_NAMES = { card: 'Карта', cash: 'Наличные' };
const expense = { _id: 'one', amount: 12, type: 'expense', account: 'card', category: 'Продукты', date: day };

function renderTransactions(rows, props = {}) {
    const openEditModal = vi.fn();
    const toggleCategoryFilter = vi.fn();
    const groups = computePeriodData(transformTransactions(rows), '2026-09').transactions;
    const result = render(<TransactionList
        groups={groups}
        openEditModal={openEditModal}
        toggleCategoryFilter={toggleCategoryFilter}
        getAccountDisplay={id => ACCOUNT_NAMES[id] || 'Мой счёт'}
        formatDate={date => `день ${date}`}
        {...props}
    />);
    return { ...result, openEditModal, toggleCategoryFilter };
}

beforeEach(() => vi.stubEnv('VITE_LOGO_DEV_PUBLISHABLE_KEY', 'pk_test_history'));
afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

describe('company snapshots in transaction history', () => {
    it('shows the company first, the comment separately, and keeps editing and category filtering independent', () => {
        const { container, openEditModal, toggleCategoryFilter } = renderTransactions([
            { ...expense, companyId: 'company-1', companyName: 'Wolt', description: 'Ужин для гостей' },
        ]);
        expect(screen.getByText('Wolt')).toBeInTheDocument();
        expect(screen.getByText('Ужин для гостей')).toBeInTheDocument();
        expect(new URL(container.querySelector('img').src).pathname).toBe('/wolt.com');
        const rowButton = screen.getByRole('button', { name: 'Wolt, Ужин для гостей, Карта, Продукты, \u2212€12,00' });
        fireEvent.click(rowButton);
        expect(openEditModal).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'company-1', companyName: 'Wolt', description: 'Ужин для гостей' }));
        fireEvent.click(screen.getByRole('button', { name: 'Продукты' }));
        expect(toggleCategoryFilter).toHaveBeenCalledWith('Продукты');
        expect(openEditModal).toHaveBeenCalledTimes(1);
    });

    it('shows a category and optional comment without guessing a company from a modern comment', () => {
        const { container } = renderTransactions([{ ...expense, companyName: '', description: 'Wolt для друзей' }]);
        expect(screen.getByRole('button', { name: 'Продукты, Wolt для друзей, Карта, Продукты, \u2212€12,00' })).toBeInTheDocument();
        expect(screen.getByText('Wolt для друзей')).toBeInTheDocument();
        expect(container.querySelector('img')).toBeNull();
        expect(container.querySelector('[data-transaction-icon="groceries"]')).toBeInTheDocument();
    });

    it('preserves the legacy description as its title and merchant source', () => {
        const { container } = renderTransactions([{ ...expense, description: 'Zara', title: 'Wolt' }]);
        expect(screen.getByRole('button', { name: 'Zara, Карта, Продукты, \u2212€12,00' })).toBeInTheDocument();
        expect(screen.queryByText('Wolt')).not.toBeInTheDocument();
        expect(screen.getAllByText('Zara')).toHaveLength(1);
        expect(new URL(container.querySelector('img').src).pathname).toBe('/zara.com');
    });

    it('shows a shared split company and exact common comment with a split fallback', () => {
        const common = { ...expense, splitId: 'split-1', companyName: 'Wolt', description: 'Ужин (для гостей)', logoMode: 'domain', merchantDomain: 'wolt.com' };
        const { container } = renderTransactions([common, { ...common, _id: 'two', category: 'Подарки' }]);
        expect(screen.getByText('Wolt (Разделено)')).toBeInTheDocument();
        expect(screen.getAllByText('Ужин (для гостей)')).toHaveLength(1);
        expect(container.querySelector('[data-transaction-icon="split_group"]')).toBeInTheDocument();
        expect(new URL(container.querySelector('img').src).pathname).toBe('/wolt.com');
    });

    it('keeps each part’s company and comment visible when a split has diverged', () => {
        const common = { ...expense, splitId: 'split-1', companyName: 'Wolt', description: 'Ужин' };
        const { container } = renderTransactions([
            common,
            { ...common, _id: 'two', category: 'Подарки', companyName: 'Zara', description: 'Подарок' },
        ]);
        expect(screen.getByText('Операция (Разделено)')).toBeInTheDocument();
        for (const label of ['Wolt', 'Zara', 'Ужин', 'Подарок']) expect(screen.getByText(label)).toBeInTheDocument();
        expect(container.querySelector('img')).toBeNull();
    });

    it('keeps the legacy part title when only one part of an old split has a separate company', () => {
        const common = { ...expense, splitId: 'split-1', description: 'Wolt (Продукты)' };
        renderTransactions([
            common,
            { ...common, _id: 'two', category: 'Подарки', companyName: 'Zara', description: 'Подарок' },
        ]);
        expect(screen.getByText('Wolt (Продукты)')).toBeInTheDocument();
        expect(screen.getByText('Zara')).toBeInTheDocument();
    });
});

describe('category link without a filter', () => {
    it('shows the category as plain text when no toggle handler is given', () => {
        const groups = computePeriodData(transformTransactions([expense]), '2026-09').transactions;
        render(<TransactionList
            groups={groups}
            openEditModal={vi.fn()}
            getAccountDisplay={() => 'Мой счёт'}
            formatDate={() => 'Сегодня'}
        />);

        // Название строки и подпись с категорией - два разных элемента.
        expect(screen.getAllByText('Продукты')).toHaveLength(2);
        expect(screen.queryByRole('button', { name: 'Продукты' })).not.toBeInTheDocument();
    });
});


const MINUS = '\u2212';
const row = (container, id) => container.querySelector(`[data-history-item="${id}"]`);
const subtitleOf = (container, id) => row(container, id).querySelector('[data-testid="transaction-subtitle"]');
// Блок суммы - последний ребёнок строки
const amountOf = (container, id) => row(container, id).lastElementChild;
const normalize = el => el.textContent.replace(/\s+/g, ' ').trim();

describe('row subtitle', () => {
    it('joins category, account and comment with « · »', () => {
        const { container } = renderTransactions([{ ...expense, account: 'card', companyName: 'Wolt', description: 'Ужин' }]);
        expect(normalize(subtitleOf(container, 'one'))).toBe('Продукты · Карта · Ужин');
    });

    it('leaves out the empty parts', () => {
        const { container } = renderTransactions([{ ...expense, account: 'cash', companyName: '', description: '' }]);
        expect(normalize(subtitleOf(container, 'one'))).toBe('Продукты · Наличные');
    });

    it('omits the category when the list is already filtered by it, but keeps it for others', () => {
        const rows = [
            { ...expense, account: 'card', companyName: 'Wolt', description: 'Ужин' },
            { ...expense, _id: 'two', category: 'Транспорт', account: 'cash', companyName: 'Bolt', description: '' },
        ];
        const { container } = renderTransactions(rows, { selectedCategory: 'Продукты' });
        expect(normalize(subtitleOf(container, 'one'))).toBe('Карта · Ужин');
        expect(normalize(subtitleOf(container, 'two'))).toBe('Транспорт · Наличные');
    });

    it('names both ends of a transfer with an arrow', () => {
        const { container } = renderTransactions([{ _id: 'tr', amount: 200, type: 'transfer', account: 'cash', toAccount: 'card', category: 'Перевод', date: day }]);
        const subtitle = subtitleOf(container, 'tr');
        expect(normalize(subtitle)).toBe('Перевод · Наличные Карта');
        expect(subtitle.querySelector('svg')).not.toBeNull();
        expect(screen.getByRole('button', { name: /Наличные → Карта/ })).toBeInTheDocument();
    });

    it('wraps to at most two lines instead of growing the row', () => {
        const { container } = renderTransactions([expense]);
        expect(subtitleOf(container, 'one').style.webkitLineClamp).toBe('2');
    });
});

describe('category filter link', () => {
    it('has no underline at rest and toggles by click, Enter and Space without opening the row', () => {
        const { openEditModal, toggleCategoryFilter } = renderTransactions([expense]);
        const link = screen.getByRole('button', { name: 'Продукты' });
        expect(link.style.textDecoration).toBe('');
        expect(link).toHaveClass('tx-category-link');
        expect(link).toHaveAttribute('tabindex', '0');
        fireEvent.keyDown(link, { key: 'Enter' });
        fireEvent.keyDown(link, { key: ' ' });
        fireEvent.click(link);
        expect(toggleCategoryFilter).toHaveBeenCalledTimes(3);
        expect(toggleCategoryFilter).toHaveBeenCalledWith('Продукты');
        expect(openEditModal).not.toHaveBeenCalled();
    });
});

describe('amount signs and colors by type', () => {
    const rows = [
        { ...expense, _id: 'exp', amount: 24.9 },
        { _id: 'inc', amount: 3900, type: 'income', account: 'card', category: 'Зарплата', date: day },
        { _id: 'tr', amount: 200, type: 'transfer', account: 'cash', toAccount: 'card', category: 'Перевод', date: day },
        { _id: 'ini', amount: 1846.2, type: 'initial', account: 'card', category: 'Начальный остаток', date: day },
    ];

    it('shows an expense with a real minus in the main color', () => {
        const { container } = renderTransactions(rows);
        expect(amountOf(container, 'exp')).toHaveTextContent(`${MINUS}€24,90`);
        expect(amountOf(container, 'exp').style.color).toBe('var(--color-text-main)');
        expect(amountOf(container, 'exp').style.whiteSpace).toBe('nowrap');
    });

    it('shows an income with a plus in the positive color', () => {
        const { container } = renderTransactions(rows);
        expect(amountOf(container, 'inc')).toHaveTextContent('+€3.900,00');
        expect(amountOf(container, 'inc').style.color).toBe('var(--color-positive)');
    });

    it('shows transfers and initial balances without a sign in the main color', () => {
        const { container } = renderTransactions(rows);
        expect(amountOf(container, 'tr')).toHaveTextContent(/^€200,00$/);
        expect(amountOf(container, 'tr').style.color).toBe('var(--color-text-main)');
        expect(amountOf(container, 'ini')).toHaveTextContent(/^€1\.846,20$/);
        expect(amountOf(container, 'ini').style.color).toBe('var(--color-text-main)');
    });

    it('repeats the visible amount, with its sign, in the row button name', () => {
        renderTransactions(rows);
        expect(screen.getByRole('button', { name: 'Продукты, Карта, Продукты, \u2212€24,90' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Зарплата, Карта, Зарплата, +€3.900,00' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Перевод, Наличные → Карта, Перевод, €200,00' })).toBeInTheDocument();
    });

    it('gives initial balances no edit button', () => {
        const { container } = renderTransactions(rows);
        expect(row(container, 'ini').querySelector('button')).toBeNull();
        expect(row(container, 'exp').querySelector('button')).not.toBeNull();
    });
});

describe('day header and card', () => {
    const rows = [
        { ...expense, _id: 'a', amount: 24.9, date: '2026-09-12' },
        { _id: 'b', amount: 3900, type: 'income', account: 'card', category: 'Зарплата', date: '2026-09-11' },
        { _id: 'c', amount: 200, type: 'transfer', account: 'cash', toAccount: 'card', category: 'Перевод', date: '2026-09-10' },
    ];
    const dayOf = (container, date) => container.querySelector(`[data-history-date="${date}"]`);

    it('puts the label and the day total above a white card with the day rows, newest day first', () => {
        const { container } = renderTransactions(rows);
        const days = [...container.querySelectorAll('[data-history-date]')].map(d => d.dataset.historyDate);
        expect(days).toEqual(['2026-09-12', '2026-09-11', '2026-09-10']);

        const day = dayOf(container, '2026-09-12');
        const [header, card] = day.children;
        expect(header).toHaveTextContent('день 2026-09-12');
        expect(header.lastElementChild).toHaveTextContent(`${MINUS}€24,90`);
        expect(header.lastElementChild.style.color).toBe('var(--color-text-muted)');
        expect(card.style.background).toBe('var(--color-surface)');
        expect(card.style.borderRadius).toBe('var(--radius-lg)');
        expect(card).toContainElement(row(container, 'a'));
        expect(header).not.toContainElement(row(container, 'a'));
    });

    it('colors a positive day total green and signs it', () => {
        const { container } = renderTransactions(rows);
        const total = dayOf(container, '2026-09-11').firstElementChild.lastElementChild;
        expect(total).toHaveTextContent('+€3.900,00');
        expect(total.style.color).toBe('var(--color-positive)');
    });

    it('hides a zero day total', () => {
        const { container } = renderTransactions(rows);
        const header = dayOf(container, '2026-09-10').firstElementChild;
        expect(header.children).toHaveLength(1);
        expect(header).not.toHaveTextContent('€');
    });

    it('separates rows of a day with a divider except before the first', () => {
        const { container } = renderTransactions([
            { ...expense, _id: 'a' },
            { ...expense, _id: 'b', companyName: '' },
        ]);
        const [first, second] = container.querySelectorAll('[data-history-item]');
        expect(first.style.borderTop).not.toContain('var(--color-border-subtle)');
        expect(second.style.borderTop).toContain('var(--color-border-subtle)');
    });
});

describe('excluded from statistics', () => {
    it('dims the row and marks it with the eye icon', () => {
        const { container } = renderTransactions([{ ...expense, excludeFromStats: true }]);
        expect(row(container, 'one').style.opacity).toBe('0.5');
        expect(screen.getByRole('img', { name: 'Исключено из статистики' })).toBeInTheDocument();
    });
});

describe('split group', () => {
    const common = { ...expense, splitId: 'split-1', companyName: 'Wolt', description: 'Ужин' };
    const rows = [
        { ...common, _id: 'p1', amount: 30, category: 'Продукты' },
        { ...common, _id: 'p2', amount: 20.5, category: 'Подарки' },
    ];

    it('shows the group total with a minus on the parent row', () => {
        const { container } = renderTransactions(rows);
        expect(amountOf(container, 'split-1')).toHaveTextContent(`${MINUS}€50,50`);
        expect(screen.getByText('Wolt (Разделено)')).toBeInTheDocument();
    });

    it('nests the parts under the title with a left border and unsigned amounts', () => {
        const { container } = renderTransactions(rows);
        const parts = screen.getAllByRole('button', { name: /^Wolt \(Разделено\): / });
        expect(parts).toHaveLength(2);
        const partRow = parts[0].parentElement;
        expect(partRow.style.borderLeft).toBe('2px solid var(--color-border-strong)');
        expect(partRow.parentElement.style.paddingLeft).toBe('calc(40px + var(--space-3))');
        expect(partRow.lastElementChild).toHaveTextContent(/^€30,00$/);
        expect(parts[1].parentElement.lastElementChild).toHaveTextContent(/^€20,50$/);
        expect(container.querySelectorAll('[data-history-item]')).toHaveLength(1);
    });

    it('opens the edit of the very part that was pressed', () => {
        const { openEditModal } = renderTransactions(rows);
        fireEvent.click(screen.getByRole('button', { name: /^Wolt \(Разделено\): .*Подарки/ }));
        expect(openEditModal).toHaveBeenCalledTimes(1);
        expect(openEditModal).toHaveBeenCalledWith(expect.objectContaining({ id: 'p2', category: 'Подарки' }));
    });

    it('highlights the part category that the list is filtered by', () => {
        renderTransactions(rows, { selectedCategory: 'Подарки' });
        expect(screen.getByRole('button', { name: 'Подарки' }).style.color).toBe('var(--color-primary)');
        expect(screen.getByRole('button', { name: 'Продукты' }).style.color).toBe('inherit');
    });

    it('has no edit button on the parent row itself', () => {
        const { container } = renderTransactions(rows);
        expect(row(container, 'split-1').firstElementChild.querySelector('button')).toBeNull();
    });
});

describe('empty list', () => {
    it('shows the text with the optional icon and action', () => {
        renderTransactions([], {
            emptyText: 'Пусто',
            emptyIcon: <svg data-testid="empty-icon" />,
            emptyAction: <button type="button">Сбросить</button>,
        });
        expect(screen.getByText('Пусто')).toBeInTheDocument();
        expect(screen.getByTestId('empty-icon')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Сбросить' })).toBeInTheDocument();
    });

    it('falls back to «Нет операций»', () => {
        renderTransactions([]);
        expect(screen.getByText('Нет операций')).toBeInTheDocument();
    });
});

// Свежие строки «Последних операций»: появляются с анимацией один раз, при
// монтировании, и не повторяют её, когда настоящий список подменяет строку.
describe('fresh rows', () => {
    const rows = [
        expense,
        { _id: 'two', amount: 5, type: 'expense', account: 'card', category: 'Кафе', date: day },
    ];
    const groupsOf = list => computePeriodData(transformTransactions(list), '2026-09').transactions;
    const listProps = {
        openEditModal: () => { },
        getAccountDisplay: id => ACCOUNT_NAMES[id] || 'Мой счёт',
        formatDate: date => `день ${date}`,
    };
    const rowEl = (container, id) => container.querySelector(`[data-history-item="${id}"]`);

    let animate;
    let animation;
    beforeEach(() => {
        animation = { cancel: vi.fn() };
        animate = vi.fn(() => animation);
        Element.prototype.animate = animate;
    });
    afterEach(() => {
        delete Element.prototype.animate;
        vi.unstubAllGlobals();
    });

    it('wraps only the fresh row for the tint and grows it from zero height', () => {
        const { container } = render(<TransactionList {...listProps} groups={groupsOf(rows)} freshIds={new Set(['two'])} />);

        expect(rowEl(container, 'two').parentElement).toHaveClass('tx-fresh');
        expect(rowEl(container, 'one').parentElement).not.toHaveClass('tx-fresh');
        expect(animate).toHaveBeenCalledTimes(1);
        const [keyframes, options] = animate.mock.calls[0];
        expect(animate.mock.contexts[0]).toBe(rowEl(container, 'two'));
        expect(keyframes[0]).toMatchObject({ height: '0px', paddingTop: '0px', paddingBottom: '0px', opacity: 0 });
        expect(keyframes[1]).toMatchObject({ opacity: 1 });
        expect(options).toMatchObject({ duration: 240, easing: 'cubic-bezier(.2,.8,.2,1)' });
    });

    it('clips the day card to its rounded corners while it holds a fresh row', () => {
        const { container } = render(<TransactionList {...listProps} groups={groupsOf(rows)} freshIds={new Set(['two'])} />);

        expect(container.querySelector('[data-history-date]').lastElementChild).toHaveStyle({ overflow: 'hidden' });
    });

    it('swaps in the server row without a second animation or a visible change', () => {
        const groups = groupsOf(rows);
        const { container, rerender } = render(<TransactionList {...listProps} groups={groups} freshIds={new Set(['two'])} />);
        const before = rowEl(container, 'two');
        const html = before.innerHTML;

        // Пришёл настоящий список: те же строки, но свежих больше нет.
        rerender(<TransactionList {...listProps} groups={groupsOf(rows.map(row => ({ ...row })))} freshIds={new Set()} />);

        expect(rowEl(container, 'two')).toBe(before);
        expect(before.innerHTML).toBe(html);
        // Подсветка доигрывает, а рост не повторяется.
        expect(before.parentElement).toHaveClass('tx-fresh');
        expect(container.querySelector('[data-history-date]').lastElementChild).toHaveStyle({ overflow: 'hidden' });
        expect(animate).toHaveBeenCalledTimes(1);
        expect(animation.cancel).not.toHaveBeenCalled();
    });

    it('does not animate rows that were already there when a later row arrives', () => {
        const { container, rerender } = render(<TransactionList {...listProps} groups={groupsOf([expense])} freshIds={new Set()} />);
        expect(animate).not.toHaveBeenCalled();

        rerender(<TransactionList {...listProps} groups={groupsOf(rows)} freshIds={new Set(['two'])} />);

        expect(animate).toHaveBeenCalledTimes(1);
        expect(rowEl(container, 'one').parentElement).not.toHaveClass('tx-fresh');
    });

    it('animates a fresh split purchase as a whole', () => {
        const parts = [
            { _id: 'p1', amount: 10, type: 'expense', account: 'card', category: 'Еда', date: day, splitId: 'split_1', description: 'Магазин' },
            { _id: 'p2', amount: 4, type: 'expense', account: 'card', category: 'Дом', date: day, splitId: 'split_1', description: 'Магазин' },
        ];
        const { container } = render(<TransactionList {...listProps} groups={groupsOf(parts)} freshIds={new Set(['split_1'])} />);

        // Строка-шапка и части внутри одной обёртки; анимируется одна.
        const head = rowEl(container, 'split_1');
        expect(head.closest('.tx-fresh')).not.toBeNull();
        expect(animate).toHaveBeenCalledTimes(1);
        expect(screen.getByText(/Разделено/)).toBeInTheDocument();
    });

    it('skips the growth for reduced motion but keeps the tint', () => {
        vi.stubGlobal('matchMedia', query => ({ matches: query.includes('prefers-reduced-motion'), media: query }));

        const { container } = render(<TransactionList {...listProps} groups={groupsOf(rows)} freshIds={new Set(['two'])} />);

        expect(animate).not.toHaveBeenCalled();
        expect(rowEl(container, 'two').parentElement).toHaveClass('tx-fresh');
    });

    it('behaves exactly as before without freshIds (history)', () => {
        const { container } = render(<TransactionList {...listProps} groups={groupsOf(rows)} />);

        expect(container.querySelector('.tx-fresh')).toBeNull();
        expect(animate).not.toHaveBeenCalled();
        expect(rowEl(container, 'one').parentElement).toBe(container.querySelector('[data-history-date]').lastElementChild);
        expect(container.querySelector('[data-history-date]').lastElementChild).not.toHaveStyle({ overflow: 'hidden' });
    });
});

// Удалённые строки: остаются в списке, плавно сворачиваются и остаются
// свёрнутыми и недоступными; при отмене удаления растут обратно с подсветкой.
describe('leaving rows', () => {
    const rows = [
        expense,
        { _id: 'two', amount: 5, type: 'expense', account: 'card', category: 'Кафе', date: day },
    ];
    const otherDay = { _id: 'three', amount: 8, type: 'expense', account: 'card', category: 'Еда', date: '2026-09-11' };
    const groupsOf = list => computePeriodData(transformTransactions(list), '2026-09').transactions;
    const listProps = {
        openEditModal: () => { },
        toggleCategoryFilter: () => { },
        getAccountDisplay: id => ACCOUNT_NAMES[id] || 'Мой счёт',
        formatDate: date => `день ${date}`,
    };
    const rowEl = (container, id) => container.querySelector(`[data-history-item="${id}"]`);
    const dayEl = (container, date) => container.querySelector(`[data-history-date="${date}"]`);
    const view = (groups, leaving) => <TransactionList {...listProps} groups={groups} leavingIds={new Set(leaving)} />;
    const COLLAPSED = { height: '0px', overflow: 'hidden', opacity: '0' };

    let animations;
    beforeEach(() => {
        animations = [];
        Element.prototype.animate = vi.fn(function animate(keyframes, options) {
            const animation = { cancel: vi.fn(), keyframes, options, target: this };
            animations.push(animation);
            return animation;
        });
    });
    afterEach(() => {
        delete Element.prototype.animate;
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });
    const finish = animation => act(() => animation.onfinish());
    // В jsdom нет раскладки: зазор списка между днями (16px) подставляем сами.
    const withListGap = () => {
        const real = window.getComputedStyle.bind(window);
        vi.spyOn(window, 'getComputedStyle').mockImplementation((element, ...rest) => new Proxy(real(element, ...rest), {
            get: (style, name) => (name === 'rowGap' ? '16px' : typeof style[name] === 'function' ? style[name].bind(style) : style[name]),
        }));
    };

    it('wraps nothing and animates nothing while no row is leaving', () => {
        const { container } = render(view(groupsOf(rows), []));

        expect(Element.prototype.animate).not.toHaveBeenCalled();
        expect(container.querySelector('.tx-fresh')).toBeNull();
        expect(rowEl(container, 'one')).not.toHaveAttribute('inert');
        expect(rowEl(container, 'one')).not.toHaveAttribute('aria-hidden');
    });

    it('collapses a leaving row to zero height over 240 ms and keeps it there', () => {
        const groups = groupsOf(rows);
        const { container, rerender } = render(view(groups, []));

        rerender(view(groups, ['two']));

        expect(animations).toHaveLength(1);
        const [{ keyframes, options, target }] = animations;
        expect(target).toBe(rowEl(container, 'two'));
        expect(keyframes[0]).toMatchObject({ opacity: 1 });
        expect(keyframes[1]).toMatchObject({ height: '0px', paddingTop: '0px', paddingBottom: '0px', opacity: 0 });
        expect(options).toMatchObject({ duration: 240, easing: 'ease-in', fill: 'forwards' });
        // Соседняя строка не двигалась.
        expect(rowEl(container, 'one')).not.toHaveAttribute('inert');

        // Дошла до конца - свёрнута стилем и остаётся такой после перерисовок.
        finish(animations[0]);
        expect(rowEl(container, 'two')).toHaveStyle(COLLAPSED);
        rerender(view(groupsOf(rows), ['two']));
        expect(rowEl(container, 'two')).toHaveStyle(COLLAPSED);
        expect(animations).toHaveLength(1);
        expect(animations[0].cancel).not.toHaveBeenCalled();
    });

    it('takes a leaving row out of reach of the keyboard and screen readers at once', async () => {
        const groups = groupsOf(rows);
        const { container, rerender } = render(view(groups, []));
        const button = screen.getByRole('button', { name: /Кафе.*Карта.*€5,00/ });
        expect(button).not.toHaveAttribute('tabindex');

        rerender(view(groups, ['two']));

        const row = rowEl(container, 'two');
        expect(row).toHaveAttribute('inert');
        expect(row).toHaveAttribute('aria-hidden', 'true');
        expect(button).toHaveAttribute('tabindex', '-1');
        // Tab с начала страницы проходит мимо: остаётся только строка «one» (и её категория).
        const user = userEvent.setup();
        const reached = [];
        for (let i = 0; i < 6; i += 1) {
            await user.tab();
            reached.push(document.activeElement);
        }
        expect(reached).not.toContain(button);
        expect(reached.some(element => row.contains(element))).toBe(false);
    });

    it('collapses a split purchase as one block and takes its parts out of the tab order', () => {
        const parts = [
            { _id: 'p1', amount: 10, type: 'expense', account: 'card', category: 'Еда', date: day, splitId: 'split_1', description: 'Магазин' },
            { _id: 'p2', amount: 4, type: 'expense', account: 'card', category: 'Дом', date: day, splitId: 'split_1', description: 'Магазин' },
        ];
        const groups = groupsOf([...parts, { ...expense, _id: 'plain' }]);
        const { container, rerender } = render(view(groups, []));

        rerender(view(groups, ['split_1']));

        expect(animations).toHaveLength(1);
        const group = rowEl(container, 'split_1').closest('[inert]');
        expect(animations[0].target).toBe(group);
        expect(group).toHaveAttribute('inert');
        for (const button of within(group).getAllByRole('button', { hidden: true })) expect(button).toHaveAttribute('tabindex', '-1');
        expect(rowEl(container, 'plain')).not.toHaveAttribute('inert');
    });

    it('drops the divider above the first remaining row while the one over it leaves', () => {
        const groups = groupsOf(rows);
        const { container, rerender } = render(view(groups, []));
        const [first, second] = [...container.querySelectorAll('[data-history-item]')].map(element => element.dataset.historyItem);
        expect(rowEl(container, second).style.borderTop).toContain('var(--color-border-subtle)');

        rerender(view(groups, [first]));

        expect(rowEl(container, second).style.borderTop).not.toContain('var(--color-border-subtle)');
        // Уходящая строка сама ещё со своим верхом - его гасит анимация.
        expect(rowEl(container, first).style.borderTop).not.toContain('var(--color-border-subtle)');
    });

    it('collapses the whole day, header and card, when all its rows leave, without moving the rows one by one', () => {
        withListGap();
        const groups = groupsOf([...rows, otherDay]);
        const { container, rerender } = render(view(groups, []));

        rerender(view(groups, ['three']));

        expect(animations).toHaveLength(1);
        const dayBlock = dayEl(container, '2026-09-11');
        expect(animations[0].target).toBe(dayBlock);
        // Зазор между днями съедает отрицательный нижний отступ.
        expect(animations[0].keyframes[0]).toMatchObject({ marginBottom: '0px' });
        expect(animations[0].keyframes[1]).toMatchObject({ height: '0px', marginBottom: '-16px' });
        expect(dayBlock).toHaveAttribute('inert');
        expect(dayBlock).toHaveAttribute('aria-hidden', 'true');
        expect(dayEl(container, day)).not.toHaveAttribute('inert');

        finish(animations[0]);
        expect(dayBlock).toHaveStyle({ height: '0px', overflow: 'hidden', opacity: '0' });
        expect(dayBlock.style.marginBottom).toBe('calc(-1 * var(--space-4))');
    });

    it('does not collapse the day while another row of it stays', () => {
        const groups = groupsOf(rows);
        const { container, rerender } = render(view(groups, []));

        rerender(view(groups, ['two']));

        expect(animations.map(animation => animation.target)).toEqual([rowEl(container, 'two')]);
        expect(dayEl(container, day)).not.toHaveAttribute('inert');
    });

    it('shows the day sum it is given at once, whatever is still collapsing', () => {
        const groups = groupsOf(rows);
        const adjusted = { ...groups, [day]: { ...groups[day], dailySum: -12 } };
        const { container, rerender } = render(view(groups, []));
        expect(dayEl(container, day)).toHaveTextContent(`${MINUS}€17,00`);

        rerender(view(adjusted, ['two']));

        expect(dayEl(container, day)).toHaveTextContent(`${MINUS}€12,00`);
    });

    it('grows a restored row back from its collapsed state with a fresh tint', () => {
        const groups = groupsOf(rows);
        const { container, rerender } = render(view(groups, []));
        rerender(view(groups, ['two']));
        finish(animations[0]);
        expect(container.querySelector('.tx-fresh')).toBeNull();

        rerender(view(groups, []));

        // Сворачивание снято до измерения, выросла новая анимация от нуля.
        expect(animations[0].cancel).toHaveBeenCalledTimes(1);
        expect(animations).toHaveLength(2);
        expect(animations[1].target).toBe(rowEl(container, 'two'));
        expect(animations[1].keyframes[0]).toMatchObject({ height: '0px', opacity: 0 });
        expect(animations[1].keyframes[1]).toMatchObject({ opacity: 1 });
        expect(animations[1].options).toMatchObject({ duration: 240, easing: 'cubic-bezier(.2,.8,.2,1)' });
        const row = rowEl(container, 'two');
        expect(row).not.toHaveStyle(COLLAPSED);
        expect(row).not.toHaveAttribute('inert');
        expect(row).not.toHaveAttribute('aria-hidden');
        expect(row.parentElement).toHaveClass('tx-fresh');
        expect(row.parentElement.querySelector('.tx-fresh-glow')).not.toBeNull();
        expect(screen.getByRole('button', { name: /Кафе.*Карта.*€5,00/ })).not.toHaveAttribute('tabindex');
        // Остальное не тронуто.
        expect(rowEl(container, 'one').parentElement).not.toHaveClass('tx-fresh');
    });

    it('replays the tint (a new glow element) when a row is restored again', () => {
        const groups = groupsOf(rows);
        const { container, rerender } = render(view(groups, []));
        rerender(view(groups, ['two']));
        rerender(view(groups, []));
        const first = rowEl(container, 'two').parentElement.querySelector('.tx-fresh-glow');
        const row = rowEl(container, 'two');

        rerender(view(groups, ['two']));
        expect(row.parentElement.querySelector('.tx-fresh-glow')).toBeNull();
        rerender(view(groups, []));

        const second = row.parentElement.querySelector('.tx-fresh-glow');
        expect(second).not.toBeNull();
        expect(second).not.toBe(first);
        expect(rowEl(container, 'two')).toBe(row);
    });

    it('grows a restored row back even if it was still collapsing', () => {
        const groups = groupsOf(rows);
        const { container, rerender } = render(view(groups, []));
        rerender(view(groups, ['two']));

        rerender(view(groups, []));

        expect(animations[0].cancel).toHaveBeenCalledTimes(1);
        expect(animations[1].keyframes[0]).toMatchObject({ height: '0px' });
        expect(rowEl(container, 'two').parentElement).toHaveClass('tx-fresh');
    });

    it('grows the whole day back when its rows return', () => {
        withListGap();
        const groups = groupsOf([...rows, otherDay]);
        const { container, rerender } = render(view(groups, []));
        rerender(view(groups, ['three']));
        finish(animations[0]);

        rerender(view(groups, []));

        expect(animations).toHaveLength(2);
        expect(animations[1].target).toBe(dayEl(container, '2026-09-11'));
        expect(animations[1].keyframes[0]).toMatchObject({ height: '0px', marginBottom: '-16px' });
        expect(dayEl(container, '2026-09-11')).not.toHaveAttribute('inert');
        // Строка в нём светится, но не растёт отдельно.
        expect(rowEl(container, 'three').parentElement).toHaveClass('tx-fresh');
    });

    it('shows a row that is already leaving when the list is mounted collapsed, with no animation', () => {
        const { container } = render(view(groupsOf(rows), ['two']));

        expect(Element.prototype.animate).not.toHaveBeenCalled();
        expect(rowEl(container, 'two')).toHaveStyle(COLLAPSED);
        expect(rowEl(container, 'two')).toHaveAttribute('inert');
    });

    it('hides and shows rows instantly for reduced motion, keeping only the tint', () => {
        vi.stubGlobal('matchMedia', query => ({ matches: query.includes('prefers-reduced-motion'), media: query }));
        const groups = groupsOf(rows);
        const { container, rerender } = render(view(groups, []));

        rerender(view(groups, ['two']));
        expect(rowEl(container, 'two')).toHaveStyle(COLLAPSED);
        rerender(view(groups, []));

        expect(Element.prototype.animate).not.toHaveBeenCalled();
        expect(rowEl(container, 'two')).not.toHaveStyle(COLLAPSED);
        expect(rowEl(container, 'two').parentElement).toHaveClass('tx-fresh');
    });

    it('collapses instantly when the browser has no Web Animations', () => {
        delete Element.prototype.animate;
        const groups = groupsOf(rows);
        const { container, rerender } = render(view(groups, []));

        rerender(view(groups, ['two']));

        expect(rowEl(container, 'two')).toHaveStyle(COLLAPSED);
    });

    it('clips the day card to its corners once a row in it is leaving', () => {
        const groups = groupsOf(rows);
        const { container, rerender } = render(view(groups, []));
        expect(dayEl(container, day).lastElementChild).not.toHaveStyle({ overflow: 'hidden' });

        rerender(view(groups, ['two']));

        expect(dayEl(container, day).lastElementChild).toHaveStyle({ overflow: 'hidden' });
    });

    it('lets a row that is both fresh and leaving mount collapsed without growing', () => {
        const { container } = render(<TransactionList {...listProps} groups={groupsOf(rows)} freshIds={new Set(['two'])} leavingIds={new Set(['two'])} />);

        expect(Element.prototype.animate).not.toHaveBeenCalled();
        expect(rowEl(container, 'two')).toHaveStyle(COLLAPSED);
    });
});

// Поправленные строки: показывают новые данные, светятся той же подсветкой и
// плавно меняют высоту; переехавшая в другой день сворачивается призраком на
// старом месте и вырастает в новом.
describe('edited rows', () => {
    const rows = [
        expense,
        { _id: 'two', amount: 5, type: 'expense', account: 'card', category: 'Кафе', date: day },
    ];
    const otherDay = '2026-09-11';
    const groupsOf = list => computePeriodData(transformTransactions(list), '2026-09').transactions;
    const listProps = {
        openEditModal: () => { },
        toggleCategoryFilter: () => { },
        getAccountDisplay: id => ACCOUNT_NAMES[id] || 'Мой счёт',
        formatDate: date => `день ${date}`,
    };
    const rowEl = (container, id, date = day) => container.querySelector(`[data-history-date="${date}"] [data-history-item="${id}"]`);
    const dayEl = (container, date) => container.querySelector(`[data-history-date="${date}"]`);
    const view = (groups, { edited = [], fresh = [], leaving = [] } = {}) => (
        <TransactionList {...listProps} groups={groups} editedIds={new Map(edited)} freshIds={new Set(fresh)} leavingIds={new Set(leaving)} />
    );

    let animations;
    beforeEach(() => {
        animations = [];
        Element.prototype.animate = vi.fn(function animate(keyframes, options) {
            const animation = { cancel: vi.fn(), keyframes, options, target: this };
            animations.push(animation);
            return animation;
        });
    });
    afterEach(() => {
        delete Element.prototype.animate;
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    // В jsdom нет раскладки: высоты строки отдаём по очереди - сначала прежнюю
    // (читается при рендере), потом новую (после коммита).
    const heights = (...values) => {
        const queue = [...values];
        vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => ({ height: queue.length > 1 ? queue.shift() : queue[0], width: 0, top: 0, left: 0 }));
    };

    it('lights the row when its id shows up in editedIds, in place, and relights it for a new edit number', () => {
        const groups = groupsOf(rows);
        const { container, rerender } = render(view(groups));
        const one = rowEl(container, 'one');
        expect(one.parentElement.querySelector('.tx-fresh-glow')).toBeNull();

        rerender(view(groups, { edited: [['one', 1]] }));

        expect(rowEl(container, 'one')).toBe(one);
        expect(one.parentElement).toHaveClass('tx-fresh');
        const first = one.parentElement.querySelector('.tx-fresh-glow');
        expect(first).not.toBeNull();
        expect(rowEl(container, 'two').parentElement.querySelector('.tx-fresh-glow')).toBeNull();

        // Перерисовка с тем же номером подсветку не перезапускает.
        rerender(view(groupsOf(rows.map(row => ({ ...row }))), { edited: [['one', 1]] }));
        expect(one.parentElement.querySelector('.tx-fresh-glow')).toBe(first);

        // Новая правка той же строки - новый светящийся слой.
        rerender(view(groups, { edited: [['one', 2]] }));
        expect(rowEl(container, 'one')).toBe(one);
        const second = one.parentElement.querySelector('.tx-fresh-glow');
        expect(second).not.toBeNull();
        expect(second).not.toBe(first);
    });

    it('keeps the tint after the server list swaps the row in (the edit is dropped)', () => {
        const groups = groupsOf(rows);
        const { container, rerender } = render(view(groups));
        rerender(view(groups, { edited: [['one', 1]] }));
        const one = rowEl(container, 'one');

        rerender(view(groupsOf(rows.map(row => ({ ...row }))), { edited: [] }));

        expect(rowEl(container, 'one')).toBe(one);
        expect(one.parentElement).toHaveClass('tx-fresh');
        expect(animations).toHaveLength(0);
    });

    it('does not light a leaving row', () => {
        const groups = groupsOf(rows);
        const { container, rerender } = render(view(groups));

        rerender(view(groups, { edited: [['one', 1]], leaving: ['one'] }));

        expect(rowEl(container, 'one').parentElement.querySelector('.tx-fresh-glow')).toBeNull();
        expect(rowEl(container, 'one')).toHaveAttribute('inert');
    });

    it('clips the day card to its rounded corners once a row in it is edited', () => {
        const groups = groupsOf(rows);
        const { container, rerender } = render(view(groups));
        expect(dayEl(container, day).lastElementChild).not.toHaveStyle({ overflow: 'hidden' });

        rerender(view(groups, { edited: [['one', 1]] }));

        expect(dayEl(container, day).lastElementChild).toHaveStyle({ overflow: 'hidden' });
    });

    it('behaves as before without editedIds', () => {
        const { container } = render(<TransactionList {...listProps} groups={groupsOf(rows)} />);

        expect(container.querySelector('.tx-fresh')).toBeNull();
        expect(animations).toHaveLength(0);
        expect(dayEl(container, day).lastElementChild).not.toHaveStyle({ overflow: 'hidden' });
    });

    describe('a row that moved to another day', () => {
        const before = [...rows, { _id: 'three', amount: 8, type: 'expense', account: 'card', category: 'Еда', date: otherDay }];
        const withGhost = () => {
            const groups = groupsOf(before);
            const old = groups[day];
            const ghost = { ...old.items.find(item => item.id === 'one'), movedAway: true };
            const copy = { ...ghost, movedAway: undefined, date: otherDay };
            delete copy.movedAway;
            return {
                ...groups,
                [day]: { ...old, items: old.items.map(item => (item.id === 'one' ? ghost : item)), dailySum: old.dailySum + 12 },
                [otherDay]: { ...groups[otherDay], items: [copy, ...groups[otherDay].items] },
            };
        };

        it('collapses the ghost where it was and grows the copy in the new day with the tint', () => {
            const { container, rerender } = render(view(groupsOf(before), { fresh: [] }));
            expect(animations).toHaveLength(0);

            rerender(view(withGhost(), { fresh: ['one'] }));

            const ghost = rowEl(container, 'one', day);
            const copy = rowEl(container, 'one', otherDay);
            expect(ghost).toHaveAttribute('inert');
            expect(ghost).toHaveAttribute('aria-hidden', 'true');
            const collapse = animations.find(animation => animation.target === ghost);
            expect(collapse.options).toMatchObject({ duration: 240, easing: 'ease-in', fill: 'forwards' });
            expect(collapse.keyframes[1]).toMatchObject({ height: '0px', opacity: 0 });
            // Призрак не светится и не растет, копия - растет и светится.
            expect(ghost.parentElement.querySelector('.tx-fresh-glow')).toBeNull();
            expect(copy).not.toHaveAttribute('inert');
            const grow = animations.find(animation => animation.target === copy);
            expect(grow.keyframes[0]).toMatchObject({ height: '0px', opacity: 0 });
            expect(copy.parentElement).toHaveClass('tx-fresh');
            expect(copy.parentElement.querySelector('.tx-fresh-glow')).not.toBeNull();
            // Другая строка старого дня не двигалась.
            expect(rowEl(container, 'two', day)).not.toHaveAttribute('inert');
        });

        it('collapses the whole day when only ghosts are left in it', () => {
            const lone = groupsOf([expense]);
            const { container, rerender } = render(view(lone));
            const ghostOnly = { [day]: { ...lone[day], items: lone[day].items.map(item => ({ ...item, movedAway: true })), dailySum: 0 } };

            rerender(view(ghostOnly));

            expect(dayEl(container, day)).toHaveAttribute('inert');
            expect(animations.some(animation => animation.target === dayEl(container, day))).toBe(true);
        });
    });

    describe('parts of a split purchase', () => {
        const parts = [
            { _id: 'p1', amount: 10, type: 'expense', account: 'card', category: 'Еда', date: day, splitId: 'split_1', description: 'Магазин' },
            { _id: 'p2', amount: 4, type: 'expense', account: 'card', category: 'Дом', date: day, splitId: 'split_1', description: 'Магазин' },
        ];
        const partButtons = container => within(container).getAllByRole('button', { name: /Магазин \(Разделено\)/ });

        it('lights only the edited part, stretched to the card edges', () => {
            const groups = groupsOf(parts);
            const { container, rerender } = render(view(groups));
            expect(container.querySelector('.tx-part-glow')).toBeNull();

            rerender(view(groups, { edited: [['p2', 1]] }));

            const glows = container.querySelectorAll('.tx-part-glow');
            expect(glows).toHaveLength(1);
            expect(glows[0]).toHaveClass('tx-fresh-glow');
            const [first, second] = partButtons(container).map(button => button.parentElement);
            expect(second.contains(glows[0])).toBe(true);
            expect(first.querySelector('.tx-part-glow')).toBeNull();
            expect(second).toHaveStyle({ isolation: 'isolate', position: 'relative' });
            expect(dayEl(container, day).lastElementChild).toHaveStyle({ overflow: 'hidden' });
        });

        it('replays the part glow for a new edit number', () => {
            const groups = groupsOf(parts);
            const { container, rerender } = render(view(groups, { edited: [['p2', 1]] }));
            const first = container.querySelector('.tx-part-glow');

            rerender(view(groups, { edited: [['p2', 2]] }));

            expect(container.querySelector('.tx-part-glow')).not.toBe(first);
            expect(container.querySelectorAll('.tx-part-glow')).toHaveLength(1);
        });

        it('lets the part glow finish when the refetched list drops the edit', () => {
            const groups = groupsOf(parts);
            const { container, rerender } = render(view(groups, { edited: [['p2', 1]] }));
            const glow = container.querySelector('.tx-part-glow');

            rerender(view(groupsOf(parts.map(part => ({ ...part })))));

            expect(container.querySelector('.tx-part-glow')).toBe(glow);
        });
    });

    describe('row height', () => {
        it('animates the height change over 240 ms with overflow hidden only for the animation', () => {
            const groups = groupsOf(rows);
            const { container, rerender } = render(view(groups));
            const one = rowEl(container, 'one');
            expect(one).not.toHaveStyle({ overflow: 'hidden' });
            heights(50, 80);

            rerender(view(groups, { edited: [['one', 1]] }));

            const edit = animations.filter(animation => animation.target === one);
            expect(edit).toHaveLength(1);
            expect(edit[0].keyframes).toEqual([{ height: '50px', overflow: 'hidden' }, { height: '80px', overflow: 'hidden' }]);
            expect(edit[0].options).toEqual({ duration: 240, easing: 'cubic-bezier(.2,.8,.2,1)' });
            expect(one).not.toHaveStyle({ overflow: 'hidden' });
        });

        it('does not animate when the height did not change', () => {
            const groups = groupsOf(rows);
            const { rerender } = render(view(groups));
            heights(50, 50.3);

            rerender(view(groups, { edited: [['one', 1]] }));

            expect(animations).toHaveLength(0);
        });

        it('starts the next edit from where the previous one is and cancels it', () => {
            const groups = groupsOf(rows);
            const { rerender } = render(view(groups));
            heights(50, 80);
            rerender(view(groups, { edited: [['one', 1]] }));
            heights(65, 40);

            rerender(view(groups, { edited: [['one', 2]] }));

            expect(animations).toHaveLength(2);
            expect(animations[0].cancel).toHaveBeenCalledTimes(1);
            expect(animations[1].keyframes).toEqual([{ height: '65px', overflow: 'hidden' }, { height: '40px', overflow: 'hidden' }]);
        });

        it('lets the animation finish when the server list swaps the row in', () => {
            const groups = groupsOf(rows);
            const { rerender } = render(view(groups));
            heights(50, 80);
            rerender(view(groups, { edited: [['one', 1]] }));

            rerender(view(groupsOf(rows.map(row => ({ ...row }))), { edited: [] }));

            expect(animations).toHaveLength(1);
            expect(animations[0].cancel).not.toHaveBeenCalled();
        });

        it('cancels a running height animation when the row unmounts', () => {
            const groups = groupsOf(rows);
            const { rerender, unmount } = render(view(groups));
            heights(50, 80);
            rerender(view(groups, { edited: [['one', 1]] }));

            unmount();

            expect(animations[0].cancel).toHaveBeenCalled();
        });

        it('does not touch the height of a leaving row', () => {
            const groups = groupsOf(rows);
            const { rerender } = render(view(groups));
            heights(50, 80);

            rerender(view(groups, { edited: [['one', 1]], leaving: ['one'] }));

            // Одна анимация - сворачивание, а не смена высоты.
            expect(animations).toHaveLength(1);
            expect(animations[0].options).toMatchObject({ easing: 'ease-in' });
        });

        it('skips the height animation for reduced motion but keeps the tint', () => {
            vi.stubGlobal('matchMedia', query => ({ matches: query.includes('prefers-reduced-motion'), media: query }));
            const groups = groupsOf(rows);
            const { container, rerender } = render(view(groups));
            heights(50, 80);

            rerender(view(groups, { edited: [['one', 1]] }));

            expect(animations).toHaveLength(0);
            expect(rowEl(container, 'one').parentElement.querySelector('.tx-fresh-glow')).not.toBeNull();
        });

        it('skips the height animation while the row is still growing or collapsing', () => {
            const groups = groupsOf(rows);
            const { container, rerender } = render(view(groups));
            Object.defineProperty(rowEl(container, 'one'), 'getAnimations', { value: () => [{}], configurable: true });
            heights(50, 80);

            rerender(view(groups, { edited: [['one', 1]] }));

            expect(animations).toHaveLength(0);
        });
    });
});
