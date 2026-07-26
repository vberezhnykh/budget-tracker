import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
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

// jsdom never lays anything out, so the sheet's offsetHeight is always 0.
// Stub it to a realistic value so getTravel() (offsetHeight - PEEK_HEIGHT)
// returns a non-zero travel distance for the drag tests to exercise.
function stubSheetHeight(container, height = 800) {
    Object.defineProperty(container, 'offsetHeight', { configurable: true, value: height });
}

describe('TransactionsDrawer Component', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

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

    it('expands when dragged past the commit threshold', () => {
        render(<Wrapper />);

        const sheet = screen.getByTestId('transactions-drawer');
        stubSheetHeight(sheet, 800); // travel = 800 - 72 = 728

        const handle = screen.getByRole('button', { name: 'Открыть список операций' });

        const nowSpy = vi.spyOn(performance, 'now');
        nowSpy.mockReturnValueOnce(0); // startTime, captured on pointerDown
        fireEvent.pointerDown(handle, { pointerId: 1, clientY: 500 });
        // Move up 300px - well past the 25% (182px) commit threshold.
        fireEvent.pointerMove(handle, { pointerId: 1, clientY: 200 });
        nowSpy.mockReturnValueOnce(1000); // elapsed, captured on pointerUp
        fireEvent.pointerUp(handle, { pointerId: 1, clientY: 200 });

        expect(screen.getByRole('button', { name: 'Закрыть список операций' })).toHaveAttribute('aria-expanded', 'true');
    });

    it('springs back to the starting state on a small drag that clears the tap threshold but not the commit threshold', () => {
        render(<Wrapper />);

        const sheet = screen.getByTestId('transactions-drawer');
        stubSheetHeight(sheet, 800); // travel = 800 - 72 = 728

        const handle = screen.getByRole('button', { name: 'Открыть список операций' });

        const nowSpy = vi.spyOn(performance, 'now');
        nowSpy.mockReturnValueOnce(0); // startTime, captured on pointerDown
        fireEvent.pointerDown(handle, { pointerId: 1, clientY: 500 });
        // Move up 20px - clears TAP_MAX_MOVEMENT (8px), so this isn't a tap,
        // but is far short of the 25% (182px) commit-by-distance threshold.
        fireEvent.pointerMove(handle, { pointerId: 1, clientY: 480 });
        // A large elapsed time (1000ms) keeps velocity (20px / 1000ms = 0.02)
        // well under the 0.5 px/ms commit-by-velocity threshold too, so
        // real wall-clock jitter in the test can't accidentally commit it.
        nowSpy.mockReturnValueOnce(1000); // elapsed, captured on pointerUp
        fireEvent.pointerUp(handle, { pointerId: 1, clientY: 480 });

        expect(screen.getByRole('button', { name: 'Открыть список операций' })).toHaveAttribute('aria-expanded', 'false');
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
