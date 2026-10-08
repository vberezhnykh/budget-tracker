import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import TransactionList from './TransactionList';
import { getPeriodData, transformTransactions } from '../utils/finance';

const day = '2026-09-12';
const ACCOUNT_NAMES = { card: 'Карта', cash: 'Наличные' };
const expense = { _id: 'one', amount: 12, type: 'expense', account: 'card', category: 'Продукты', date: day };

function renderTransactions(rows, props = {}) {
    const openEditModal = vi.fn();
    const toggleCategoryFilter = vi.fn();
    const groups = getPeriodData(transformTransactions(rows), '2026-09').transactions;
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
        const groups = getPeriodData(transformTransactions([expense]), '2026-09').transactions;
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
