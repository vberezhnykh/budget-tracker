import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import AddTransactionForm from './AddTransactionForm';

describe('AddTransactionForm Component', () => {
    const mockOnSubmit = vi.fn();
    const mockOnClose = vi.fn();
    const mockOnDelete = vi.fn();

    it('renders with correct title for income', () => {
        render(<AddTransactionForm type="income" onClose={mockOnClose} onSubmit={mockOnSubmit} />);
        expect(screen.getByText('Новый доход')).toBeInTheDocument();
    });

    it('renders with correct title for expense', () => {
        render(<AddTransactionForm type="expense" onClose={mockOnClose} onSubmit={mockOnSubmit} />);
        expect(screen.getByText('Новый расход')).toBeInTheDocument();
    });

    it('validates required fields before enabling save button', () => {
        render(<AddTransactionForm type="expense" onClose={mockOnClose} onSubmit={mockOnSubmit} />);
        const saveButton = screen.getByText('Сохранить');

        expect(saveButton).toBeDisabled();

        // Fill amount
        const amountInput = screen.getByPlaceholderText('0.00');
        fireEvent.change(amountInput, { target: { value: '100' } });
        expect(saveButton).toBeDisabled(); // Still need category

        // Select category
        const categoryButton = screen.getByText('Продукты');
        fireEvent.click(categoryButton);

        expect(saveButton).not.toBeDisabled();
    });

    it('submits correct data for an expense', () => {
        render(<AddTransactionForm type="expense" onClose={mockOnClose} onSubmit={mockOnSubmit} />);

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
        render(<AddTransactionForm type="transfer" onClose={mockOnClose} onSubmit={mockOnSubmit} />);

        expect(screen.getByText(/Обмен \/ Перевод/i)).toBeInTheDocument();
        expect(screen.getByText('ОТКУДА')).toBeInTheDocument();
        expect(screen.getByText('КУДА')).toBeInTheDocument();

        fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '200' } });

        fireEvent.click(screen.getByText('Сохранить'));

        expect(mockOnSubmit).toHaveBeenCalledWith(expect.objectContaining({
            amount: 200,
            type: 'transfer',
            category: 'Обмен'
        }));
    });

    it('calls onClose when background is clicked', () => {
        const { container } = render(<AddTransactionForm onClose={mockOnClose} />);
        // The overlay is the first div
        fireEvent.click(container.firstChild);
        expect(mockOnClose).toHaveBeenCalled();
    });

    it('calls onDelete when delete button is clicked and confirmed', () => {
        window.confirm = vi.fn(() => true);
        const editData = { id: 'test-id', amount: 100, category: 'Food', type: 'expense', account: 'cash' };

        render(<AddTransactionForm initialData={editData} onDelete={mockOnDelete} onClose={mockOnClose} onSubmit={mockOnSubmit} />);

        const deleteButton = screen.getByText('🗑');
        fireEvent.click(deleteButton);

        expect(window.confirm).toHaveBeenCalled();
        expect(mockOnDelete).toHaveBeenCalledWith('test-id');
    });

    it('renders split transaction UI when toggled', async () => {
        render(<AddTransactionForm type="expense" onClose={mockOnClose} onSubmit={mockOnSubmit} />);

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
        render(<AddTransactionForm type="expense" onClose={mockOnClose} onSubmit={mockOnSubmit} />);

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

        // Submit
        fireEvent.click(screen.getByText('Сохранить'));

        expect(mockOnSubmit).toHaveBeenCalledWith(expect.arrayContaining([
            expect.objectContaining({ amount: 40, category: 'Продукты' }),
            expect.objectContaining({ amount: 60, category: 'Транспорт' })
        ]));
    });
});
