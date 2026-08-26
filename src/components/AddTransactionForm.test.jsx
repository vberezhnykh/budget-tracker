import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import AddTransactionForm from './AddTransactionForm';

const mockCategories = [
    { _id: '1', name: 'Продукты', type: 'expense', isDefault: true, order: 1 },
    { _id: '2', name: 'Еда вне дома', type: 'expense', isDefault: true, order: 2 },
    { _id: '3', name: 'Транспорт', type: 'expense', isDefault: true, order: 3 },
    { _id: '4', name: 'Развлечения', type: 'expense', isDefault: true, order: 4 },
    { _id: '5', name: 'Шопинг', type: 'expense', isDefault: true, order: 5 },
    { _id: '6', name: 'Красота', type: 'expense', isDefault: true, order: 6 },
    { _id: '7', name: 'Жилье', type: 'expense', isDefault: true, order: 7 },
    { _id: '8', name: 'Питомцы', type: 'expense', isDefault: true, order: 8 },
    { _id: '9', name: 'Услуги', type: 'expense', isDefault: true, order: 9 },
    { _id: '10', name: 'Отпуск', type: 'expense', isDefault: true, order: 10 },
    { _id: '11', name: 'Другое', type: 'expense', isDefault: true, order: 11 },
    { _id: '12', name: 'Зарплата', type: 'income', isDefault: true, order: 1 },
    { _id: '13', name: 'Фриланс', type: 'income', isDefault: true, order: 2 },
    { _id: '14', name: 'Подарок', type: 'income', isDefault: true, order: 3 },
    { _id: '15', name: 'Кэшбэк', type: 'income', isDefault: true, order: 4 },
    { _id: '16', name: 'Другое', type: 'income', isDefault: true, order: 5 },
];

const mockAccounts = [
    { _id: 'card', name: 'Карта', type: 'card', icon: '💳', isDefault: true },
    { _id: 'cash', name: 'Наличные', type: 'cash', icon: '💵', isDefault: true }
];

describe('AddTransactionForm Component', () => {
    const mockOnSubmit = vi.fn();
    const mockOnClose = vi.fn();
    const mockOnDelete = vi.fn();

    it('renders with correct title for income', () => {
        render(<AddTransactionForm type="income" categories={mockCategories} accounts={mockAccounts} onClose={mockOnClose} onSubmit={mockOnSubmit} />);
        expect(screen.getByText('Новый доход')).toBeInTheDocument();
    });

    it('renders with correct title for expense', () => {
        render(<AddTransactionForm type="expense" categories={mockCategories} accounts={mockAccounts} onClose={mockOnClose} onSubmit={mockOnSubmit} />);
        expect(screen.getByText('Новый расход')).toBeInTheDocument();
    });

    it('validates required fields before enabling save button', () => {
        render(<AddTransactionForm type="expense" categories={mockCategories} accounts={mockAccounts} onClose={mockOnClose} onSubmit={mockOnSubmit} />);
        const saveButton = screen.getByText('Сохранить');

        expect(saveButton).toBeDisabled();

        // Fill amount
        const amountInput = screen.getByPlaceholderText('0.00');
        fireEvent.change(amountInput, { target: { value: '100' } });
        expect(saveButton).toBeDisabled(); // Still need category and account

        // Select category
        const categoryButton = screen.getByText('Продукты');
        fireEvent.click(categoryButton);
        expect(saveButton).toBeDisabled(); // Still need an account - no preset was passed

        // Select account
        fireEvent.click(screen.getByText('💳 Карта'));

        expect(saveButton).not.toBeDisabled();
    });

    it('preselects the account from presetAccountId when one is passed', () => {
        render(<AddTransactionForm type="expense" categories={mockCategories} accounts={mockAccounts} presetAccountId="cash" onClose={mockOnClose} onSubmit={mockOnSubmit} />);

        // Amount + category alone are enough to save - the account came
        // preselected from presetAccountId, without clicking an account button.
        fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '30' } });
        fireEvent.click(screen.getByText('Продукты'));
        expect(screen.getByText('Сохранить')).not.toBeDisabled();

        fireEvent.click(screen.getByText('Сохранить'));

        expect(mockOnSubmit).toHaveBeenCalledWith(expect.objectContaining({ account: 'cash' }));
    });

    it('requires an explicit account choice when no presetAccountId is given', () => {
        render(<AddTransactionForm type="expense" categories={mockCategories} accounts={mockAccounts} onClose={mockOnClose} onSubmit={mockOnSubmit} />);

        fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '30' } });
        fireEvent.click(screen.getByText('Продукты'));

        // Neither account button is preselected...
        expect(screen.getByText('💳 Карта')).toHaveStyle({ borderColor: 'rgba(0,0,0,0.08)' });
        expect(screen.getByText('💵 Наличные')).toHaveStyle({ borderColor: 'rgba(0,0,0,0.08)' });
        // ...and saving is blocked until one is picked.
        expect(screen.getByText('Сохранить')).toBeDisabled();
    });

    it('enables the save button once an account is picked', () => {
        render(<AddTransactionForm type="expense" categories={mockCategories} accounts={mockAccounts} onClose={mockOnClose} onSubmit={mockOnSubmit} />);

        fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '30' } });
        fireEvent.click(screen.getByText('Продукты'));
        expect(screen.getByText('Сохранить')).toBeDisabled();

        fireEvent.click(screen.getByText('💳 Карта'));

        expect(screen.getByText('Сохранить')).not.toBeDisabled();
    });

    it('keeps an edited transaction on its own account, even if presetAccountId is passed', () => {
        const editData = { id: 'test-id', amount: 100, category: 'Food', type: 'expense', account: 'cash' };

        render(<AddTransactionForm initialData={editData} presetAccountId="card" categories={mockCategories} accounts={mockAccounts} onClose={mockOnClose} onSubmit={mockOnSubmit} />);

        // Saving without touching the account field must keep the
        // transaction's own account ('cash'), not the preset ('card').
        expect(screen.getByText('Сохранить')).not.toBeDisabled();
        fireEvent.click(screen.getByText('Сохранить'));

        expect(mockOnSubmit).toHaveBeenCalledWith(expect.objectContaining({ account: 'cash' }));
    });

    it('submits correct data for an expense', () => {
        render(<AddTransactionForm type="expense" categories={mockCategories} accounts={mockAccounts} onClose={mockOnClose} onSubmit={mockOnSubmit} />);

        fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '50.5' } });
        fireEvent.click(screen.getByText('Транспорт'));
        fireEvent.click(screen.getByText('💳 Карта'));

        fireEvent.click(screen.getByText('Сохранить'));

        expect(mockOnSubmit).toHaveBeenCalledWith(expect.objectContaining({
            amount: 50.5,
            category: 'Транспорт',
            type: 'expense',
            account: 'card'
        }));
        expect(mockOnClose).toHaveBeenCalled();
    });

    it('handles transfer type correctly', () => {
        render(<AddTransactionForm type="transfer" categories={mockCategories} accounts={mockAccounts} onClose={mockOnClose} onSubmit={mockOnSubmit} />);

        expect(screen.getByText('Перевод', { selector: 'h3' })).toBeInTheDocument();
        expect(screen.getByLabelText('Откуда')).toBeInTheDocument();
        expect(screen.getByLabelText('Куда')).toBeInTheDocument();

        fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '200' } });

        fireEvent.click(screen.getByText('Сохранить'));

        expect(mockOnSubmit).toHaveBeenCalledWith(expect.objectContaining({
            amount: 200,
            type: 'transfer',
            category: 'Перевод'
        }));
    });

    it('starts a transfer from the active account when presetAccountId is passed', () => {
        render(<AddTransactionForm type="transfer" categories={mockCategories} accounts={mockAccounts} presetAccountId="card" onClose={mockOnClose} onSubmit={mockOnSubmit} />);

        // "Откуда" is the account that was active on the balance carousel, so
        // the only thing left to choose is where the money goes - and "Куда"
        // must not land on the same account.
        expect(screen.getByLabelText('Откуда')).toHaveValue('card');
        expect(screen.getByLabelText('Куда')).toHaveValue('cash');

        fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '50' } });
        fireEvent.click(screen.getByText('Сохранить'));

        expect(mockOnSubmit).toHaveBeenCalledWith(expect.objectContaining({
            type: 'transfer',
            account: 'card',
            toAccount: 'cash'
        }));
    });

    it('falls back to the default account pairing for a transfer with no preset (Общий капитал)', () => {
        render(<AddTransactionForm type="transfer" categories={mockCategories} accounts={mockAccounts} onClose={mockOnClose} onSubmit={mockOnSubmit} />);

        expect(screen.getByLabelText('Откуда')).toHaveValue('cash');
        expect(screen.getByLabelText('Куда')).toHaveValue('card');
    });

    it('fills both transfer sides when switching to transfer from an account-less expense', () => {
        render(<AddTransactionForm type="expense" categories={mockCategories} accounts={mockAccounts} onClose={mockOnClose} onSubmit={mockOnSubmit} />);

        fireEvent.click(screen.getByText('Перевод'));

        const from = screen.getByLabelText('Откуда');
        const to = screen.getByLabelText('Куда');
        expect(from.value).toBeTruthy();
        expect(to.value).toBeTruthy();
        expect(from.value).not.toBe(to.value);
    });

    it('calls onClose when background is clicked', () => {
        const { container } = render(<AddTransactionForm categories={mockCategories} accounts={mockAccounts} onClose={mockOnClose} />);
        // The overlay is the first div
        fireEvent.click(container.firstChild);
        expect(mockOnClose).toHaveBeenCalled();
    });

    it('calls onDelete when delete button is clicked and confirmed', () => {
        window.confirm = vi.fn(() => true);
        const editData = { id: 'test-id', amount: 100, category: 'Food', type: 'expense', account: 'cash' };

        render(<AddTransactionForm initialData={editData} categories={mockCategories} accounts={mockAccounts} onDelete={mockOnDelete} onClose={mockOnClose} onSubmit={mockOnSubmit} />);

        const deleteButton = screen.getByText('🗑');
        fireEvent.click(deleteButton);

        expect(window.confirm).toHaveBeenCalled();
        expect(mockOnDelete).toHaveBeenCalledWith('test-id');
    });

    it('renders split transaction UI when toggled', async () => {
        render(<AddTransactionForm type="expense" categories={mockCategories} accounts={mockAccounts} onClose={mockOnClose} onSubmit={mockOnSubmit} />);

        // Enter amount to enable split toggle
        fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '100' } });

        // Toggle split
        const splitToggle = screen.getByText('Разделить на несколько категорий');
        fireEvent.click(splitToggle);

        expect(screen.getByText('Осталось распределить:')).toBeInTheDocument();
        expect(screen.getByText('Категория 1')).toBeInTheDocument();
        expect(screen.getByText('Категория 2')).toBeInTheDocument();
        expect(screen.getByText('+ Добавить категорию')).toBeInTheDocument();
    });

    it('validates splits sum and submits array of transactions', async () => {
        render(<AddTransactionForm type="expense" categories={mockCategories} accounts={mockAccounts} onClose={mockOnClose} onSubmit={mockOnSubmit} />);

        // Enter total amount
        fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '100' } });

        // Toggle split
        fireEvent.click(screen.getByText('Разделить на несколько категорий'));

        // Fill split 1
        const splitInputs = screen.getAllByPlaceholderText('Сумма');
        fireEvent.change(splitInputs[0], { target: { value: '40' } });
        const categories = screen.getAllByText('Продукты');
        fireEvent.click(categories[0]); // Select for first split

        // Fill split 2
        fireEvent.change(splitInputs[1], { target: { value: '60' } });
        const transportCategories = screen.getAllByText('Транспорт');
        fireEvent.click(transportCategories[1]); // Select for second split (index 1 because category list is rendered for each split)

        // Split mode still has its own "Списать с" account picker, and no
        // presetAccountId was passed here - an account must be picked before
        // saving is allowed.
        fireEvent.click(screen.getByText('💳 Карта'));

        // Submit
        fireEvent.click(screen.getByText('Сохранить'));

        expect(mockOnSubmit).toHaveBeenCalledWith(expect.arrayContaining([
            expect.objectContaining({ amount: 40, category: 'Продукты' }),
            expect.objectContaining({ amount: 60, category: 'Транспорт' })
        ]));
    });

    const mockTransactions = [
        { category: 'Продукты', type: 'expense', description: 'Wolt', date: '2026-01-01' },
        { category: 'Продукты', type: 'expense', description: 'Wolt', date: '2026-01-02' },
        { category: 'Продукты', type: 'expense', description: 'Lidl', date: '2026-01-03' },
        { category: 'Развлечения', type: 'expense', description: 'Кино', date: '2026-01-04' }
    ];

    it('suggests previous comments only for the selected category', () => {
        render(<AddTransactionForm type="expense" categories={mockCategories} accounts={mockAccounts} transactions={mockTransactions} onClose={mockOnClose} onSubmit={mockOnSubmit} />);

        // Ничего не выбрано - подсказывать нечего.
        expect(screen.queryByText('Wolt')).not.toBeInTheDocument();

        fireEvent.click(screen.getByText('Продукты'));
        expect(screen.getByText('Wolt')).toBeInTheDocument();
        expect(screen.getByText('Lidl')).toBeInTheDocument();
        expect(screen.queryByText('Кино')).not.toBeInTheDocument();

        // Комментарии из другой категории здесь не появляются.
        fireEvent.click(screen.getByText('Развлечения'));
        expect(screen.getByText('Кино')).toBeInTheDocument();
        expect(screen.queryByText('Wolt')).not.toBeInTheDocument();
    });

    it('fills the comment field from a suggestion', () => {
        render(<AddTransactionForm type="expense" categories={mockCategories} accounts={mockAccounts} transactions={mockTransactions} onClose={mockOnClose} onSubmit={mockOnSubmit} />);

        fireEvent.click(screen.getByText('Продукты'));
        fireEvent.click(screen.getByText('Wolt'));

        expect(screen.getByPlaceholderText('Комментарий...')).toHaveValue('Wolt');
        // Выбранная подсказка больше не предлагается, остальные остаются.
        expect(screen.queryByText('Lidl')).not.toBeInTheDocument();
    });

    it('narrows suggestions to what has been typed', () => {
        render(<AddTransactionForm type="expense" categories={mockCategories} accounts={mockAccounts} transactions={mockTransactions} onClose={mockOnClose} onSubmit={mockOnSubmit} />);

        fireEvent.click(screen.getByText('Продукты'));
        fireEvent.change(screen.getByPlaceholderText('Комментарий...'), { target: { value: 'li' } });

        expect(screen.getByText('Lidl')).toBeInTheDocument();
        expect(screen.queryByText('Wolt')).not.toBeInTheDocument();
    });
    describe('свёрнутый список категорий', () => {
        // 11 расходных категорий в моке: 8 частых в свёрнутом виде + хвост из 3.
        const recent = (days) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
        const usage = (category, count, type = 'expense') =>
            Array.from({ length: count }, (_, i) => ({ category, type, date: recent(i + 1) }));

        it('прячет хвост под "Ещё N" и раскрывает его по нажатию', () => {
            render(<AddTransactionForm type="expense" categories={mockCategories} accounts={mockAccounts} onClose={mockOnClose} onSubmit={mockOnSubmit} />);

            // Без истории верх - это первые восемь категорий в серверном порядке.
            expect(screen.getByText('Продукты')).toBeInTheDocument();
            expect(screen.queryByText('Отпуск')).not.toBeInTheDocument();

            fireEvent.click(screen.getByText('Ещё 3'));

            expect(screen.getByText('Отпуск')).toBeInTheDocument();
            expect(screen.getByText('Свернуть')).toBeInTheDocument();

            fireEvent.click(screen.getByText('Свернуть'));
            expect(screen.queryByText('Отпуск')).not.toBeInTheDocument();
        });

        it('поднимает часто используемую категорию из хвоста наверх', () => {
            // "Отпуск" - предпоследняя по серверному порядку, но самая частая.
            const transactions = [...usage('Отпуск', 3), ...usage('Продукты', 1)];

            render(<AddTransactionForm type="expense" categories={mockCategories} accounts={mockAccounts} transactions={transactions} onClose={mockOnClose} onSubmit={mockOnSubmit} />);

            expect(screen.getByText('Отпуск')).toBeInTheDocument();
        });

        it('не учитывает частоту из другого типа операций', () => {
            // Доходное "Другое" не должно тащить наверх одноимённый расход.
            const transactions = usage('Другое', 5, 'income');

            render(<AddTransactionForm type="expense" categories={mockCategories} accounts={mockAccounts} transactions={transactions} onClose={mockOnClose} onSubmit={mockOnSubmit} />);

            expect(screen.queryByText('Другое')).not.toBeInTheDocument();
        });

        it('показывает категорию редактируемой операции, даже если она редкая', () => {
            const editData = { id: 'test-id', amount: 100, category: 'Отпуск', type: 'expense', account: 'cash' };

            render(<AddTransactionForm initialData={editData} categories={mockCategories} accounts={mockAccounts} onClose={mockOnClose} onSubmit={mockOnSubmit} />);

            expect(screen.getByText('Отпуск')).toBeInTheDocument();
            // Остальной хвост при этом остаётся свёрнутым.
            expect(screen.getByText('Ещё 2')).toBeInTheDocument();
        });

        it('раскрывает список после создания новой категории', async () => {
            const onAddCategory = vi.fn().mockResolvedValue({ name: 'Кофе', type: 'expense' });

            render(<AddTransactionForm type="expense" categories={mockCategories} accounts={mockAccounts} onAddCategory={onAddCategory} onClose={mockOnClose} onSubmit={mockOnSubmit} />);

            fireEvent.click(screen.getByText('+ Новая'));
            fireEvent.change(screen.getByPlaceholderText('Название...'), { target: { value: 'Кофе' } });
            fireEvent.click(screen.getByText('✓'));

            await screen.findByText('Отпуск');
        });
    });
});
