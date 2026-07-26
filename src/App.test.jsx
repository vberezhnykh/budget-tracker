import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
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

// Setup fetch mock
global.fetch = vi.fn((url, options) => {
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
        return Promise.resolve({
            ok: true,
            json: () => Promise.resolve([]),
        });
    }
    return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(currentTransactions),
    });
});

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
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-01-15'));
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('renders content after loading', async () => {
        render(<App />);

        await waitFor(() => {
            expect(screen.getByText('BudgetTracker')).toBeInTheDocument();
        }, { timeout: 3000 });

        expect(screen.getAllByText(/4\.000/)[0]).toBeInTheDocument();
    });

    it('navigates between months', async () => {
        render(<App />);

        await waitFor(() => screen.getByText('BudgetTracker'));

        const prevButton = screen.getByText('←');
        fireEvent.click(prevButton);

        await waitFor(() => {
            expect(screen.getByText(/декабр/i)).toBeInTheDocument();
            expect(screen.getByText(/2025/)).toBeInTheDocument();
        });
    });

    it('toggles between monthly stats and analytics view', async () => {
        render(<App />);

        await waitFor(() => screen.getByText('BudgetTracker'));

        const analyticsBtn = screen.getByText(/Аналитика/);
        fireEvent.click(analyticsBtn);

        await waitFor(() => {
            expect(screen.getByText(/Аналитика трат/)).toBeInTheDocument();
        });

        const backBtn = screen.getByText(/Назад/);
        fireEvent.click(backBtn);

        await waitFor(() => {
            expect(screen.getByRole('button', { name: 'Месяц' })).toBeInTheDocument();
        });
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

    it('displays transaction description and account/category correctly', async () => {
        render(<App />);

        await waitFor(() => screen.getByText('BudgetTracker'));

        // Check for the transaction with description (Rent)
        expect(screen.getByText('Monthly flat rent')).toBeInTheDocument();

        // Subtitle text: "💳 Карта • Housing"
        const cardElements = screen.getAllByText(/Карта/);
        expect(cardElements.length).toBeGreaterThan(1);
        expect(screen.getByText(/Housing/)).toBeInTheDocument();

        // Check for the transaction without description (Salary)
        expect(screen.getByText('Salary')).toBeInTheDocument();
    });

    it('deletes a transaction correctly', async () => {
        window.confirm = vi.fn(() => true);
        render(<App />);

        await waitFor(() => screen.getByText('BudgetTracker'));

        // Find Rent transaction and click it
        const rentTx = screen.getByText('Monthly flat rent');
        fireEvent.click(rentTx);

        // Find delete button and click it
        const deleteBtn = await screen.findByText('🗑');
        fireEvent.click(deleteBtn);

        expect(window.confirm).toHaveBeenCalled();
        expect(global.fetch).toHaveBeenCalledWith(
            expect.stringContaining('/api/transactions/2'),
            expect.objectContaining({ method: 'DELETE' })
        );
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

        // Open split sub-item by clicking its amount (use index 1 because index 0 is the group total)
        await waitFor(() => screen.getAllByText('€50.00'));
        fireEvent.click(screen.getAllByText('€50.00')[1]);

        // Wait for modal to open (find delete button)
        const deleteBtn = await screen.findByText('🗑');
        fireEvent.click(deleteBtn);

        expect(global.fetch).toHaveBeenCalledWith(
            expect.stringContaining('splitId=group-123'),
            expect.objectContaining({ method: 'DELETE' })
        );
    });

    it('toggles between monthly and lifetime stats', async () => {
        render(<App />);

        await waitFor(() => screen.getByText('BudgetTracker'));

        // Default is monthly income (Salary = 5000)
        expect(screen.getByText(/\+€5\.000/)).toBeInTheDocument();

        // Switch to lifetime
        const lifetimeBtn = screen.getByText('Всё время');
        fireEvent.click(lifetimeBtn);

        // Should show lifetime stats (same as monthly in this mock since all are in Jan 2026)
        expect(screen.getByText(/\+€5\.000/)).toBeInTheDocument();

        // Progress bar (Limit) should be gone
        expect(screen.queryByText(/Лимит €/)).not.toBeInTheDocument();
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
        const cardFilterBtn = screen.getByText('КАРТА').closest('div');
        fireEvent.click(cardFilterBtn);

        // Should show Salary (card) but NOT Coffee (cash)
        await waitFor(() => {
            expect(screen.queryAllByText('Salary').length).toBeGreaterThan(0);
            expect(screen.queryByText('Coffee')).not.toBeInTheDocument();
        });

        // Click on the "Наличные" account slide.
        const cashFilterBtn = screen.getByText('НАЛИЧНЫЕ').closest('div');
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

        const cardSlide = screen.getByText('КАРТА').closest('[data-carousel-slide]');
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

        const totalSlide = screen.getByText('ОБЩИЙ КАПИТАЛ').closest('[data-carousel-slide]');
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
        await waitFor(() => screen.getByText('КОШЕЛЁК'));

        // Select the account we're about to delete.
        const walletSlide = screen.getByText('КОШЕЛЁК').closest('[data-carousel-slide]');
        fireEvent.click(walletSlide);
        await waitFor(() => {
            const chip = screen.getByText(/Счет:/).closest('div');
            expect(chip).toHaveTextContent('Кошелёк');
        });

        // Delete it via the accounts settings panel.
        fireEvent.click(screen.getByTitle('Управление счетами'));
        const deleteButtons = await screen.findAllByText('Удалить');
        fireEvent.click(deleteButtons[deleteButtons.length - 1]);

        expect(window.confirm).toHaveBeenCalled();

        // The filter pointed at an id that no longer exists - it must be reset.
        await waitFor(() => {
            expect(screen.queryByText(/Счет:/)).not.toBeInTheDocument();
        });
        expect(screen.getByRole('button', { name: 'Показать Общий капитал' })).toHaveAttribute('aria-current', 'true');
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
describe('handleAccountDragEnd', () => {
    const baseAccounts = [
        { _id: 'a', name: 'A', order: 0 },
        { _id: 'b', name: 'B', order: 1 },
        { _id: 'c', name: 'C', order: 2 }
    ];

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('updates state optimistically and PUTs only the changed accounts with their new order', async () => {
        const puts = [];
        vi.stubGlobal('fetch', vi.fn((url, options) => {
            if (options?.method === 'PUT') {
                puts.push({ url, body: JSON.parse(options.body) });
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
        }));
        const setAccounts = vi.fn();

        await handleAccountDragEnd(
            { active: { id: 'a' }, over: { id: 'c' } },
            { accounts: baseAccounts, setAccounts }
        );

        // Optimistic update: state was set once, synchronously, to the reordered list.
        expect(setAccounts).toHaveBeenCalledTimes(1);
        const optimistic = setAccounts.mock.calls[0][0];
        expect(optimistic.map(a => a._id)).toEqual(['b', 'c', 'a']);

        // All three accounts shifted by this particular move, so all three were PUT -
        // each with only an `order` body, to its own id.
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
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const setAccounts = vi.fn();

        await handleAccountDragEnd(
            { active: { id: 'a' }, over: { id: 'a' } },
            { accounts: baseAccounts, setAccounts }
        );

        expect(fetchMock).not.toHaveBeenCalled();
        expect(setAccounts).not.toHaveBeenCalled();
    });

    it('rolls back to the previous order and alerts when a PUT is rejected', async () => {
        window.alert = vi.fn();
        vi.stubGlobal('fetch', vi.fn((url, options) => {
            if (options?.method === 'PUT' && url.endsWith('/b')) {
                return Promise.resolve({ ok: false, json: () => Promise.resolve({ message: 'Save failed' }) });
            }
            if (options?.method === 'PUT') {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
        }));
        const setAccounts = vi.fn();

        await handleAccountDragEnd(
            { active: { id: 'a' }, over: { id: 'c' } },
            { accounts: baseAccounts, setAccounts }
        );

        // First call is the optimistic reorder, second (last) call rolls it back
        // to the exact array the handler was given.
        expect(setAccounts).toHaveBeenCalledTimes(2);
        expect(setAccounts.mock.calls[0][0].map(a => a._id)).toEqual(['b', 'c', 'a']);
        expect(setAccounts.mock.calls[1][0]).toBe(baseAccounts);
        expect(window.alert).toHaveBeenCalledWith('Save failed');
    });

    it('rolls back and logs when the request throws (network failure)', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network down'))));
        const setAccounts = vi.fn();

        await handleAccountDragEnd(
            { active: { id: 'a' }, over: { id: 'c' } },
            { accounts: baseAccounts, setAccounts }
        );

        expect(setAccounts).toHaveBeenCalledTimes(2);
        expect(setAccounts.mock.calls[1][0]).toBe(baseAccounts);
        expect(consoleSpy).toHaveBeenCalled();

        consoleSpy.mockRestore();
    });
});
