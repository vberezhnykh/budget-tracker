import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import TransactionList from './TransactionList';
import { getPeriodData, transformTransactions } from '../utils/finance';

const day = '2026-09-12';
const expense = { _id: 'one', amount: 12, type: 'expense', account: 'card', category: 'Продукты', date: day };

function renderTransactions(rows) {
    const openEditModal = vi.fn();
    const toggleCategoryFilter = vi.fn();
    const groups = getPeriodData(transformTransactions(rows), '2026-09').transactions;
    const result = render(<TransactionList
        groups={groups}
        openEditModal={openEditModal}
        toggleCategoryFilter={toggleCategoryFilter}
        getAccountDisplay={() => 'Мой счёт'}
        formatDate={() => 'Сегодня'}
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
        const rowButton = screen.getByRole('button', { name: 'Wolt, Ужин для гостей, Мой счёт, Продукты, €12.00' });
        fireEvent.click(rowButton);
        expect(openEditModal).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'company-1', companyName: 'Wolt', description: 'Ужин для гостей' }));
        fireEvent.click(screen.getByRole('button', { name: 'Продукты' }));
        expect(toggleCategoryFilter).toHaveBeenCalledWith('Продукты');
        expect(openEditModal).toHaveBeenCalledTimes(1);
    });

    it('shows a category and optional comment without guessing a company from a modern comment', () => {
        const { container } = renderTransactions([{ ...expense, companyName: '', description: 'Wolt для друзей' }]);
        expect(screen.getByRole('button', { name: 'Продукты, Wolt для друзей, Мой счёт, Продукты, €12.00' })).toBeInTheDocument();
        expect(screen.getByText('Wolt для друзей')).toBeInTheDocument();
        expect(container.querySelector('img')).toBeNull();
        expect(container.querySelector('[data-transaction-icon="groceries"]')).toBeInTheDocument();
    });

    it('preserves the legacy description as its title and merchant source', () => {
        const { container } = renderTransactions([{ ...expense, description: 'Zara', title: 'Wolt' }]);
        expect(screen.getByRole('button', { name: 'Zara, Мой счёт, Продукты, €12.00' })).toBeInTheDocument();
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
