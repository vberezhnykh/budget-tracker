import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PlannedPaymentsView from './PlannedPaymentsView';

const accounts = [{ _id: 'card', name: 'Карта', type: 'card' }];
const categories = [{ _id: 'food', name: 'Еда', type: 'expense' }];

function renderView(overrides = {}) {
  const props = {
    plannedPayments: [],
    accounts,
    categories,
    transactions: [],
    onCreate: vi.fn().mockResolvedValue({ ok: true }),
    onUpdate: vi.fn().mockResolvedValue({ ok: true }),
    onPay: vi.fn().mockResolvedValue({ ok: true }),
    onOpenTrash: vi.fn(),
    ...overrides,
  };
  render(<PlannedPaymentsView {...props} />);
  return props;
}

describe('PlannedPaymentsView', () => {
  beforeEach(() => vi.useRealTimers());

  it('keeps a failed create form filled and blocks duplicate submission while pending', async () => {
    let resolveCreate;
    const onCreate = vi.fn(() => new Promise(resolve => { resolveCreate = resolve; }));
    renderView({ onCreate });

    fireEvent.click(screen.getByRole('button', { name: '+ Добавить' }));
    const dialog = screen.getByRole('dialog', { name: 'Добавить предстоящий платёж' });
    fireEvent.change(within(dialog).getByPlaceholderText('Например, аренда'), { target: { value: 'Электричество' } });
    fireEvent.change(within(dialog).getByLabelText('Плановая сумма, €'), { target: { value: '75' } });
    const save = within(dialog).getByRole('button', { name: 'Сохранить' });
    fireEvent.click(save);
    fireEvent.click(save);

    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole('button', { name: 'Сохранение...' })).toBeDisabled();

    resolveCreate({ ok: false, error: 'Платёж с таким названием уже есть' });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Платёж с таким названием уже есть');
    expect(within(dialog).getByPlaceholderText('Например, аренда')).toHaveValue('Электричество');
  });

  it('links a payment to an explicitly selected existing expense', async () => {
    const payment = { _id: 'plan', __v: 3, title: 'Интернет', amount: 30, dueDate: '2026-09-20', account: 'card', category: 'Еда', status: 'pending' };
    const expense = { id: 'tx-1', title: 'Провайдер', amount: 32, date: '2026-09-18', account: 'card', category: 'Еда', type: 'expense' };
    const onPay = vi.fn().mockResolvedValue({ ok: true });
    renderView({ plannedPayments: [payment], transactions: [expense], onPay });

    fireEvent.click(screen.getByRole('button', { name: 'Оплатить' }));
    const dialog = screen.getByRole('dialog', { name: 'Оплатить: Интернет' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Уже учтён' }));
    fireEvent.change(within(dialog).getByLabelText('Уже учтённый расход'), { target: { value: 'tx-1' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Связать с расходом' }));

    await waitFor(() => expect(onPay).toHaveBeenCalledWith(payment, { transactionId: 'tx-1' }));
    expect(screen.queryByRole('dialog', { name: 'Оплатить: Интернет' })).not.toBeInTheDocument();
  });

  it('shows planned and actual payment amounts separately when they differ', () => {
    renderView({
      plannedPayments: [{
        _id: 'paid', title: 'Связь', amount: 30, dueDate: '2026-09-20', account: 'card', category: 'Еда', status: 'paid',
        transactionSummary: { amount: 35, date: '2026-09-19', account: 'card', category: 'Еда' },
      }],
    });

    fireEvent.click(screen.getByRole('button', { name: /Завершённые/ }));
    expect(screen.getByText(/План €30,00 · факт €35,00/)).toBeInTheDocument();
  });

  it('keeps removed categories and legacy accounts visible in the edit form', () => {
    renderView({
      plannedPayments: [{ _id: 'legacy', __v: 0, title: 'Старый план', amount: 10, dueDate: '2026-09-20', account: 'cash', category: 'Удалённая категория', status: 'pending' }],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Изменить' }));
    const dialog = screen.getByRole('dialog', { name: 'Изменить предстоящий платёж' });
    expect(within(dialog).getByRole('option', { name: 'Наличные (нет в списке)' })).toBeInTheDocument();
    expect(within(dialog).getByRole('option', { name: 'Удалённая категория (удалена)' })).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Счёт платежа')).toHaveValue('cash');
    expect(within(dialog).getByLabelText('Категория платежа')).toHaveValue('Удалённая категория');
  });
});
