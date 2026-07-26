import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import TransactionsDrawer from './TransactionsDrawer';

const baseProps = {
    title: 'Список операций',
    searchQuery: '',
    setSearchQuery: () => { },
    searchResults: { count: 0, transactions: {} },
    monthlyData: {
        transactions: {
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
        }
    },
    categories: [],
    selectedCategory: null,
    selectedType: null,
    selectedAccount: null,
    accounts: [
        { _id: 'card', name: 'Карта', type: 'card', icon: '💳' },
        { _id: 'cash', name: 'Наличные', type: 'cash', icon: '💵' }
    ],
    toggleCategoryFilter: () => { },
    setSelectedAccount: () => { },
    setSelectedType: () => { },
    setSelectedCategory: () => { },
    exportToCSV: () => { },
    openEditModal: () => { },
    getAccountDisplay: (id) => (id === 'card' ? '💳 Карта' : '💵 Наличные'),
    formatDate: (d) => d,
    getAccountFilterLabel: (filter) => (filter === 'type:card' ? 'Все карты' : filter === 'type:cash' ? 'Все наличные' : filter)
};

// A thin controlled-component wrapper mirroring how App.jsx owns the
// expanded/collapsed state, so tapping the handle can be observed to
// actually flip the prop across a re-render.
function Wrapper({ initialExpanded = false, ...props }) {
    const [expanded, setExpanded] = useState(initialExpanded);
    return <TransactionsDrawer expanded={expanded} setExpanded={setExpanded} {...baseProps} {...props} />;
}

describe('TransactionsDrawer Component', () => {
    it('is collapsed by default and the handle exposes aria-expanded="false"', () => {
        render(<Wrapper />);
        const handle = screen.getByRole('button', { name: 'Открыть список операций' });
        expect(handle).toHaveAttribute('aria-expanded', 'false');
    });

    it('expands on tapping the handle, and collapses again on a second tap', () => {
        render(<Wrapper />);

        const handle = screen.getByRole('button', { name: 'Открыть список операций' });
        fireEvent.pointerDown(handle, { pointerId: 1, clientY: 200 });
        fireEvent.pointerUp(handle, { pointerId: 1, clientY: 200 });

        const expandedHandle = screen.getByRole('button', { name: 'Закрыть список операций' });
        expect(expandedHandle).toHaveAttribute('aria-expanded', 'true');

        fireEvent.pointerDown(expandedHandle, { pointerId: 2, clientY: 200 });
        fireEvent.pointerUp(expandedHandle, { pointerId: 2, clientY: 200 });

        const collapsedHandle = screen.getByRole('button', { name: 'Открыть список операций' });
        expect(collapsedHandle).toHaveAttribute('aria-expanded', 'false');
    });

    it('renders the contextual title plain when no account filter is selected', () => {
        render(<Wrapper title="Список операций" />);
        expect(screen.getByText('Список операций')).toBeInTheDocument();
    });

    it('renders the contextual title quoted with the account label when one is selected', () => {
        render(<Wrapper title="Список операций «Наличные»" selectedAccount="cash" />);
        expect(screen.getByText('Список операций «Наличные»')).toBeInTheDocument();
    });

    it('renders transaction rows from the passed-in data', () => {
        render(<Wrapper />);
        expect(screen.getByText('Coffee')).toBeInTheDocument();
        expect(screen.getByText('Salary')).toBeInTheDocument();
    });

    it('collapses an expanded drawer when the backdrop is tapped', () => {
        render(<Wrapper initialExpanded={true} />);

        expect(screen.getByRole('button', { name: 'Закрыть список операций' })).toHaveAttribute('aria-expanded', 'true');

        const backdrop = screen.getByTestId('drawer-backdrop');
        fireEvent.click(backdrop);

        expect(screen.getByRole('button', { name: 'Открыть список операций' })).toHaveAttribute('aria-expanded', 'false');
    });
});
