import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AddTransactionForm from './AddTransactionForm';

const categories = [{ _id: 'beauty', name: 'Красота', type: 'expense' }, { _id: 'services', name: 'Услуги', type: 'expense' }];
const accounts = [{ _id: 'card', name: 'Карта', type: 'card' }, { _id: 'cash', name: 'Наличные', type: 'cash' }];
const transaction = overrides => ({ type: 'expense', description: 'Chop Chop', category: 'Красота', account: 'cash', amount: 34, ...overrides });

function renderForm({ transactions = [], initialData = null } = {}) {
  const onSubmit = vi.fn().mockReturnValue(false);
  const apiFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ merchants: [] }) });
  render(<AddTransactionForm type="expense" initialData={initialData} categories={categories} accounts={accounts} presetAccountId="card" transactions={transactions} apiFetch={apiFetch} onClose={vi.fn()} onSubmit={onSubmit} />);
  if (!initialData) {
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '34' } });
    fireEvent.click(screen.getByRole('button', { name: 'Красота', exact: true }));
  }
  return { onSubmit };
}

const typeDescription = value => fireEvent.change(screen.getByPlaceholderText('Комментарий...'), { target: { value } });
const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Сохранить', exact: true }));
async function loadPreview(pathname) {
  const preview = screen.getByRole('region', { name: 'Иконка операции' });
  await waitFor(() => {
    expect(preview.querySelector('img')).not.toBeNull();
    expect(new URL(preview.querySelector('img').src).pathname).toBe(pathname);
  });
  fireEvent.load(preview.querySelector('img'));
  return preview;
}

beforeEach(() => vi.stubEnv('VITE_LOGO_DEV_PUBLISHABLE_KEY', 'pk_test_logo_history'));
afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

describe('logo choice reused from transaction history', () => {
  it('reuses the newest valid explicit choice for a typed name across accounts and categories', async () => {
    const { onSubmit } = renderForm({ transactions: [
      transaction({ id: 'new-auto', date: '2026-09-09', logoMode: 'auto' }),
      transaction({ id: 'old-domain', date: '2026-09-01', logoMode: 'domain', merchantDomain: 'oldbarber.com' }),
      transaction({ id: 'latest-invalid', date: '2026-09-10', logoMode: 'domain', merchantDomain: 'localhost' }),
      transaction({ id: 'chosen-domain', date: '2026-09-06', category: 'Услуги', logoMode: 'domain', merchantDomain: 'chopchop.com' }),
    ] });
    typeDescription('  CHOP   CHOP  ');
    const preview = await loadPreview('/chopchop.com');
    expect(preview).toHaveTextContent('Из истории: chopchop.com');
    expect(onSubmit).not.toHaveBeenCalled();

    submit();
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ account: 'card', category: 'Красота', logoMode: 'domain', merchantDomain: 'chopchop.com' }));
  });

  it('reuses a saved category override when a description suggestion is selected', () => {
    const { onSubmit } = renderForm({ transactions: [
      transaction({ id: 'domain', date: '2026-09-01', logoMode: 'domain', merchantDomain: 'chopchop.com' }),
      transaction({ id: 'category', date: '2026-09-07', logoMode: 'category', merchantDomain: '' }),
      transaction({ id: 'auto', date: '2026-09-09', logoMode: 'auto' }),
    ] });
    fireEvent.click(screen.getByRole('button', { name: 'Chop Chop', exact: true }));
    expect(screen.getByPlaceholderText('Комментарий...')).toHaveValue('Chop Chop');
    expect(screen.getByRole('region', { name: 'Иконка операции' }).querySelector('img')).toBeNull();

    submit();
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ description: 'Chop Chop', logoMode: 'category', merchantDomain: '' }));
  });

  it('drops an inherited domain when the description changes to an unmatched merchant', async () => {
    const { onSubmit } = renderForm({ transactions: [transaction({ date: '2026-09-07', logoMode: 'domain', merchantDomain: 'chopchop.com' })] });
    typeDescription('Chop Chop');
    await loadPreview('/chopchop.com');
    typeDescription('Unlisted Shop');
    const preview = await loadPreview('/name/unlisted%20shop');
    expect(preview).not.toHaveTextContent('Из истории');
    expect(preview).toHaveTextContent('Автоподбор');

    submit();
    const saved = onSubmit.mock.calls[0][0];
    expect(saved.logoMode || 'auto').toBe('auto');
    expect(saved.merchantDomain || '').toBe('');
  });

  it('keeps an explicit picker override when the description matches other saved history', async () => {
    const { onSubmit } = renderForm({ transactions: [
      transaction({ date: '2026-09-07', logoMode: 'domain', merchantDomain: 'chopchop.com' }),
      transaction({ date: '2026-09-08', description: 'Another Barber', logoMode: 'category' }),
    ] });
    typeDescription('Chop Chop');
    await loadPreview('/chopchop.com');
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать иконку' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Или укажите сайт компании' }), { target: { value: 'mybarber.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Применить' }));
    typeDescription('Another Barber');
    const preview = await loadPreview('/mybarber.com');
    expect(preview).toHaveTextContent('Выбрано: mybarber.com');
    expect(preview).not.toHaveTextContent('Из истории');

    submit();
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ description: 'Another Barber', logoMode: 'domain', merchantDomain: 'mybarber.com' }));
  });

  it('keeps an edited transaction’s own selection regardless of newer matching history', async () => {
    const initialData = transaction({ id: 'editing', date: '2026-09-01', logoMode: 'domain', merchantDomain: 'originalbarber.com' });
    const { onSubmit } = renderForm({ initialData, transactions: [
      transaction({ id: 'newer', date: '2026-09-09', logoMode: 'domain', merchantDomain: 'chopchop.com' }),
    ] });
    const preview = await loadPreview('/originalbarber.com');
    expect(preview).toHaveTextContent('Выбрано: originalbarber.com');
    expect(preview).not.toHaveTextContent('Из истории');

    submit();
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ id: 'editing', logoMode: 'domain', merchantDomain: 'originalbarber.com' }));
  });
});
