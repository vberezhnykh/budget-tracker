import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import App from './App';

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
global.fetch = vi.fn((url) => {
    if (typeof url === 'string' && url.includes('/api/accounts')) {
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

        // Account lists are collapsed by default now; expand the card group
        // via its chevron button before looking for the individual account.
        const cardExpandBtn = screen.getAllByRole('button', { name: 'Показать счета' })[0];
        fireEvent.click(cardExpandBtn);

        // Click on "Card" balance card
        const cardFilterBtn = screen.getByText('Карта').closest('div');
        fireEvent.click(cardFilterBtn);

        // Should show Salary (card) but NOT Coffee (cash)
        await waitFor(() => {
            expect(screen.queryAllByText('Salary').length).toBeGreaterThan(0);
            expect(screen.queryByText('Coffee')).not.toBeInTheDocument();
        });

        // Click on "Cash" balance card
        const cashFilterBtn = screen.getAllByText('Наличные')[0].closest('div');
        fireEvent.click(cashFilterBtn);

        // Should show Coffee (cash) but NOT Salary (card)
        await waitFor(() => {
            expect(screen.getByText('Coffee')).toBeInTheDocument();
            expect(screen.queryByText('Salary')).not.toBeInTheDocument();
        });
    });
});
