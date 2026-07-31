import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import TransactionsDrawer, { PEEK_HEIGHT } from './TransactionsDrawer';

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
        stubSheetHeight(sheet, 800); // travel = 800 - PEEK_HEIGHT

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
        stubSheetHeight(sheet, 800); // travel = 800 - PEEK_HEIGHT

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

    it('settles the collapsed sheet at translateY(offsetHeight - PEEK_HEIGHT), not window.innerHeight * 0.88 - PEEK_HEIGHT', () => {
        // This pins the measured-height formula in getTravel(). It previously
        // derived travel from window.innerHeight * 0.88, which disagrees with
        // the CSS resting transform on iOS Safari: the `88vh` in the resting
        // transform resolves against the large viewport (URL bar hidden),
        // while window.innerHeight reports the smaller visual viewport (URL
        // bar visible). commitExpanded() writes travel as an imperative
        // pixel transform, so it's directly observable here - but only when
        // the drag springs back to the SAME expanded state it started from.
        // If the drag instead flips `expanded`, the parent's setExpanded
        // triggers a real re-render, and React's own reconciliation
        // overwrites the just-written pixel transform with the component's
        // declarative `translateY(calc(88vh - 72px))` string (verified by
        // temporarily asserting the transform right after a flipping drag -
        // it comes back as that CSS string, not a pixel value, regardless of
        // which getTravel() formula produced it). A springing-back release
        // calls setExpanded with the unchanged boolean, so React bails out
        // of re-rendering and the imperative pixel transform survives -
        // making this the only place the formula itself is observable, and
        // it lines up with exactly the case the code comment above
        // getTravel() describes: the collapsed peek strip's resting height.
        render(<Wrapper />);

        const sheet = screen.getByTestId('transactions-drawer');
        const stubbedHeight = 800;
        stubSheetHeight(sheet, stubbedHeight);
        const expectedTravel = stubbedHeight - PEEK_HEIGHT; // 800 - 106 = 694

        const handle = screen.getByRole('button', { name: 'Открыть список операций' });

        const nowSpy = vi.spyOn(performance, 'now');
        nowSpy.mockReturnValueOnce(0); // startTime, captured on pointerDown
        fireEvent.pointerDown(handle, { pointerId: 1, clientY: 500 });
        // Move up 20px - short of the 25% (182px) commit-by-distance
        // threshold - so the drawer springs back to collapsed rather than
        // expanding, exactly like the "springs back" test above.
        fireEvent.pointerMove(handle, { pointerId: 1, clientY: 480 });
        nowSpy.mockReturnValueOnce(1000); // elapsed, captured on pointerUp
        fireEvent.pointerUp(handle, { pointerId: 1, clientY: 480 });

        expect(screen.getByRole('button', { name: 'Открыть список операций' })).toHaveAttribute('aria-expanded', 'false');
        expect(sheet.style.transform).toBe(`translateY(${expectedTravel}px)`);
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

    // Finding 5a: the category filter used to be a click-only <span> nested
    // inside the row's role="button" element - unreachable by keyboard and
    // invalid nesting regardless. It's now a separately focusable
    // role="button" span that is NOT a descendant of the row's own button
    // (a full-row overlay <button>), so it must be reachable and
    // activatable entirely on its own.
    it('exposes each category filter as its own focusable, keyboard-activatable control', () => {
        const toggleCategoryFilter = vi.fn();
        render(<Wrapper toggleCategoryFilter={toggleCategoryFilter} />);

        const categoryChip = screen.getByRole('button', { name: 'Food' });
        categoryChip.focus();
        expect(categoryChip).toHaveFocus();

        fireEvent.keyDown(categoryChip, { key: 'Enter' });
        expect(toggleCategoryFilter).toHaveBeenCalledWith('Food');
    });

    it('activates a category filter with Space too, without also opening the edit modal', () => {
        const toggleCategoryFilter = vi.fn();
        const openEditModal = vi.fn();
        render(<Wrapper toggleCategoryFilter={toggleCategoryFilter} openEditModal={openEditModal} />);

        const categoryChip = screen.getByRole('button', { name: 'Job' });
        fireEvent.keyDown(categoryChip, { key: ' ' });

        expect(toggleCategoryFilter).toHaveBeenCalledWith('Job');
        expect(openEditModal).not.toHaveBeenCalled();
    });

    it('still opens the edit modal by clicking anywhere else on an editable row', () => {
        const openEditModal = vi.fn();
        render(<Wrapper openEditModal={openEditModal} />);

        fireEvent.click(screen.getByRole('button', { name: /Coffee/ }));

        expect(openEditModal).toHaveBeenCalledWith(expect.objectContaining({ id: 'cash-1' }));
    });

    // Finding 5b: openEditModal() deliberately no-ops for seeded 'initial'
    // transactions - a focusable, clickable control that does nothing is
    // worse than not exposing one at all, so those rows must render no
    // row-level button, tabIndex, or click/keyboard handler.
    it('omits the row button entirely for a seeded "initial" transaction, since openEditModal no-ops for it', () => {
        const openEditModal = vi.fn();
        const initialMonthlyData = {
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
        };
        render(<Wrapper monthlyData={initialMonthlyData} openEditModal={openEditModal} />);

        expect(screen.getByText('Starting balance')).toBeInTheDocument();
        // No accessible button exists for this row at all - not merely a
        // non-functional one - since role="button"/tabIndex/handlers are
        // omitted outright.
        expect(screen.queryByRole('button', { name: /Starting balance/ })).not.toBeInTheDocument();

        fireEvent.click(screen.getByText('Starting balance'));
        expect(openEditModal).not.toHaveBeenCalled();
    });

    it('names both ends of a transfer row, not just the source account', () => {
        const transferMonthlyData = {
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
        };
        render(<Wrapper monthlyData={transferMonthlyData} />);

        expect(screen.getByText(
            (_, el) => el?.textContent === '💵 Наличные → 💳 Карта • Перевод',
            { selector: 'div' }
        )).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /💵 Наличные → 💳 Карта/ })).toBeInTheDocument();
    });
});
