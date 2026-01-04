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
});
