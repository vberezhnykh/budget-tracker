import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import LimitSheet from './LimitSheet';

const series = [
  { month: '2026-04', label: 'апр', expense: 1000 },
  { month: '2026-05', label: 'май', expense: 2000 },
  { month: '2026-06', label: 'июн', expense: 3000 },
  { month: '2026-07', label: 'июл', expense: 4000 },
  { month: '2026-08', label: 'авг', expense: 5000 },
  { month: '2026-09', label: 'сен', expense: 6000 },
  { month: '2026-10', label: 'окт', expense: 9999 },
];

const renderSheet = (props = {}) => {
  const handlers = { onClose: vi.fn(), onSave: vi.fn().mockResolvedValue(true) };
  const { onClose, onSave, ...rest } = { ...handlers, ...props };
  render(
    <LimitSheet monthlyLimit={3000} series={series} currentMonth="2026-10" onClose={onClose} onSave={onSave} {...rest} />
  );
  return { onClose, onSave };
};

const amountInput = () => screen.getByLabelText('Сумма лимита в евро');
const type = async (user, value) => {
  await user.clear(amountInput());
  if (value) await user.type(amountInput(), value);
};

describe('LimitSheet', () => {
  it('prefills the current limit and closes with the close button', () => {
    const { onClose } = renderSheet();

    expect(screen.getByRole('dialog', { name: 'Лимит трат в месяц' })).toBeInTheDocument();
    expect(amountInput()).toHaveValue(3000);
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('offers presets around the rounded limit and marks the matching one', () => {
    renderSheet({ monthlyLimit: 3120 });

    expect(screen.getByRole('button', { name: '€2.500' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: '€3.000' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: '€3.500' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('skips non-positive presets', () => {
    renderSheet({ monthlyLimit: 300 });

    expect(screen.queryByRole('button', { name: '€0' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '€500' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '€1.000' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^€/ })).toHaveLength(2);
  });

  it('puts a preset into the field and presses it', () => {
    renderSheet();

    fireEvent.click(screen.getByRole('button', { name: '€3.500' }));

    expect(amountInput()).toHaveValue(3500);
    expect(screen.getByRole('button', { name: '€3.500' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '€3.000' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('describes the last 6 closed months and recomputes while typing', async () => {
    const user = userEvent.setup();
    renderSheet();

    // Закрытые месяцы: 1000..6000, медиана 3500; текущий месяц не считается.
    expect(screen.getByText(/Обычно уходит €3\.500 в месяц\./)).toBeInTheDocument();
    expect(screen.getByText(/С лимитом €3\.000 превышение было бы в 3 месяцах из 6\./)).toBeInTheDocument();
    expect(screen.queryByText('окт')).not.toBeInTheDocument();

    await type(user, '5500');
    expect(screen.getByText(/С лимитом €5\.500 превышение было бы в 1 месяце из 6\./)).toBeInTheDocument();

    await type(user, '7000');
    expect(screen.getByText(/С лимитом €7\.000 превышение было бы в 0 месяцах из 6\./)).toBeInTheDocument();
  });

  it('colours bars above the limit and draws the limit line', async () => {
    const user = userEvent.setup();
    renderSheet();
    const chart = screen.getByTestId('limit-chart');

    expect(chart.querySelectorAll('[data-over="true"]')).toHaveLength(3);
    expect(screen.getByTestId('limit-line')).toBeInTheDocument();

    await type(user, '10000');
    expect(chart.querySelectorAll('[data-over="true"]')).toHaveLength(0);
  });

  it('hides the history card when there are no closed months', () => {
    renderSheet({ series: [{ month: '2026-10', label: 'окт', expense: 100 }] });

    expect(screen.queryByText('За последние 6 месяцев')).not.toBeInTheDocument();
    expect(screen.queryByText(/Обычно уходит/)).not.toBeInTheDocument();
  });

  it('shows the shared-limit note', () => {
    renderSheet();

    expect(screen.getByText('Лимит один на все месяцы и общий для всех устройств.')).toBeInTheDocument();
  });

  it.each(['', '0', '-5'])('shows a hint and disables saving for %j', async (value) => {
    const user = userEvent.setup();
    renderSheet();

    await type(user, value);

    expect(screen.getByText('Введите положительное число')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
  });

  it('disables saving while the value is unchanged', () => {
    renderSheet();

    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
    expect(screen.queryByText('Введите положительное число')).not.toBeInTheDocument();
  });

  it('saves a valid new value and closes only on true', async () => {
    const user = userEvent.setup();
    const { onSave, onClose } = renderSheet();
    await type(user, '4200');

    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(onSave).toHaveBeenCalledWith(4200);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('stays open with the value when onSave resolves false', async () => {
    const user = userEvent.setup();
    const { onSave, onClose } = renderSheet({ onSave: vi.fn().mockResolvedValue(false) });
    await type(user, '4200');

    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onClose).not.toHaveBeenCalled();
    expect(amountInput()).toHaveValue(4200);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Сохранить' })).toBeEnabled());
  });
});
