import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AddTransactionForm from './AddTransactionForm';

const categories = [{ _id: 'beauty', name: 'Красота', type: 'expense' }, { _id: 'services', name: 'Услуги', type: 'expense' }];
const accounts = [{ _id: 'card', name: 'Карта', type: 'card' }, { _id: 'cash', name: 'Наличные', type: 'cash' }];
const transaction = overrides => ({ type: 'expense', description: 'Chop Chop', category: 'Красота', account: 'cash', amount: 34, ...overrides });

function renderForm({ transactions = [], initialData = null, companies = [], createError = null } = {}) {
  const onSubmit = vi.fn().mockReturnValue(false);
  const apiFetch = vi.fn().mockImplementation(async (url, options = {}) => {
    if (url === '/api/companies' && options.method === 'POST') {
      if (createError) return { ok: false, status: 503, json: async () => ({ message: createError }) };
      return { ok: true, json: async () => ({ _id: 'created-company', __v: 0, ...JSON.parse(options.body) }) };
    }
    if (url === '/api/companies') return { ok: true, json: async () => companies };
    return { ok: true, json: async () => ({ merchants: [] }) };
  });
  render(<AddTransactionForm type="expense" initialData={initialData} categories={categories} accounts={accounts} presetAccountId="card" transactions={transactions} apiFetch={apiFetch} onClose={vi.fn()} onSubmit={onSubmit} />);
  if (!initialData) {
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '34' } });
    fireEvent.click(screen.getByRole('button', { name: 'Красота', exact: true }));
  }
  return { onSubmit, apiFetch };
}

const typeCompany = value => fireEvent.change(screen.getByPlaceholderText('Название магазина или сервиса'), { target: { value } });
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

describe('separate company selection and transaction comments', () => {
  it('lets the user extend a saved company name without deleting spaces or retaining its id', async () => {
    const { onSubmit } = renderForm({ companies: [{ _id: 'saved-apple', name: 'Apple', logoMode: 'domain', merchantDomain: 'apple.com' }] });
    await act(async () => {});
    typeCompany('Apple');
    typeCompany('Apple ');
    expect(screen.getByPlaceholderText('Название магазина или сервиса')).toHaveValue('Apple ');
    typeCompany('Apple Store');
    submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'created-company', companyName: 'Apple Store' })));
  });

  it('clears a linked company without changing the purchase comment', async () => {
    const { onSubmit } = renderForm({ initialData: transaction({ id: 'editing', companyId: 'saved-company', companyName: 'Chop Chop', description: 'Стрижка', logoMode: 'domain', merchantDomain: 'chopchop.com' }) });
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Убрать компанию' }));
    submit();
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ companyId: '', companyName: '', description: 'Стрижка', logoMode: 'category', merchantDomain: '' }));
  });

  it('reuses the newest valid explicit choice for a typed name across accounts and categories', async () => {
    const { onSubmit, apiFetch } = renderForm({ transactions: [
      transaction({ id: 'new-auto', date: '2026-09-09', logoMode: 'auto' }),
      transaction({ id: 'old-domain', date: '2026-09-01', logoMode: 'domain', merchantDomain: 'oldbarber.com' }),
      transaction({ id: 'latest-invalid', date: '2026-09-10', logoMode: 'domain', merchantDomain: 'localhost' }),
      transaction({ id: 'chosen-domain', date: '2026-09-06', category: 'Услуги', logoMode: 'domain', merchantDomain: 'chopchop.com' }),
    ] });
    typeCompany('  CHOP   CHOP  ');
    typeDescription('Стрижка и уход');
    const preview = await loadPreview('/chopchop.com');
    expect(preview).toHaveTextContent('Выбрано: chopchop.com');
    expect(onSubmit).not.toHaveBeenCalled();

    submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'created-company', companyName: 'CHOP   CHOP', description: 'Стрижка и уход', account: 'card', category: 'Красота', logoMode: 'domain', merchantDomain: 'chopchop.com' })));
    const create = apiFetch.mock.calls.find(([, options]) => options?.method === 'POST');
    expect(JSON.parse(create[1].body)).toEqual({ name: 'CHOP   CHOP', logoMode: 'domain', merchantDomain: 'chopchop.com' });
  });

  it('reuses a historical category override from a company suggestion, leaving the comment separate', async () => {
    const { onSubmit } = renderForm({ transactions: [
      transaction({ id: 'domain', date: '2026-09-01', logoMode: 'domain', merchantDomain: 'chopchop.com' }),
      transaction({ id: 'category', date: '2026-09-07', logoMode: 'category', merchantDomain: '' }),
      transaction({ id: 'auto', date: '2026-09-09', logoMode: 'auto' }),
    ] });
    fireEvent.focus(screen.getByPlaceholderText('Название магазина или сервиса'));
    fireEvent.click(screen.getByRole('button', { name: /Chop Chop.*Из истории/ }));
    expect(screen.getByPlaceholderText('Название магазина или сервиса')).toHaveValue('Chop Chop');
    expect(screen.getByPlaceholderText('Комментарий...')).toHaveValue('');
    expect(screen.getByRole('region', { name: 'Иконка операции' }).querySelector('img')).toBeNull();

    submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ companyName: 'Chop Chop', description: '', logoMode: 'category', merchantDomain: '' })));
  });

  it('drops an inherited domain when the company changes to an unmatched merchant', async () => {
    const { onSubmit } = renderForm({ transactions: [transaction({ date: '2026-09-07', logoMode: 'domain', merchantDomain: 'chopchop.com' })] });
    typeCompany('Chop Chop');
    await loadPreview('/chopchop.com');
    typeCompany('Unlisted Shop');
    const preview = await loadPreview('/name/unlisted%20shop');
    expect(preview).not.toHaveTextContent('Из истории');
    expect(preview).toHaveTextContent('Автоподбор');

    submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const saved = onSubmit.mock.calls[0][0];
    expect(saved.logoMode || 'auto').toBe('auto');
    expect(saved.merchantDomain || '').toBe('');
  });

  it('keeps the company and explicit picker override when only the comment changes', async () => {
    const { onSubmit } = renderForm({ transactions: [
      transaction({ date: '2026-09-07', logoMode: 'domain', merchantDomain: 'chopchop.com' }),
      transaction({ date: '2026-09-08', description: 'Another Barber', logoMode: 'category' }),
    ] });
    typeCompany('Chop Chop');
    await loadPreview('/chopchop.com');
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать иконку' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Или укажите сайт компании' }), { target: { value: 'mybarber.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Применить' }));
    typeDescription('Another Barber');
    const preview = await loadPreview('/mybarber.com');
    expect(preview).toHaveTextContent('Выбрано: mybarber.com');
    expect(preview).not.toHaveTextContent('Из истории');

    submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ companyName: 'Chop Chop', description: 'Another Barber', logoMode: 'domain', merchantDomain: 'mybarber.com' })));
  });

  it('keeps an edited transaction’s own selection regardless of newer matching history', async () => {
    const initialData = transaction({ id: 'editing', date: '2026-09-01', logoMode: 'domain', merchantDomain: 'originalbarber.com' });
    const { onSubmit, apiFetch } = renderForm({ initialData, transactions: [
      transaction({ id: 'newer', date: '2026-09-09', logoMode: 'domain', merchantDomain: 'chopchop.com' }),
    ] });
    const preview = await loadPreview('/originalbarber.com');
    expect(preview).toHaveTextContent('Выбрано: originalbarber.com');
    expect(preview).not.toHaveTextContent('Из истории');

    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '35' } });
    submit();
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ id: 'editing', amount: 35, description: 'Chop Chop', logoMode: 'domain', merchantDomain: 'originalbarber.com' }));
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty('companyName');
    expect(apiFetch.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
  });

  it('selects a saved company by id without recreating it or changing a free comment', async () => {
    const { onSubmit, apiFetch } = renderForm({ companies: [
      { _id: 'saved-company', name: 'Chop Chop', logoMode: 'domain', merchantDomain: 'chopchop.com' },
    ] });
    typeDescription('Стрижка');
    fireEvent.focus(screen.getByPlaceholderText('Название магазина или сервиса'));
    fireEvent.click(await screen.findByRole('button', { name: /Chop Chop.*Сохранённая компания/ }));
    await loadPreview('/chopchop.com');
    submit();
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'saved-company', companyName: 'Chop Chop', description: 'Стрижка', merchantDomain: 'chopchop.com' }));
    expect(apiFetch.mock.calls.filter(([url]) => url === '/api/companies')).toHaveLength(1);
    expect(apiFetch.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
  });

  it('keeps category mode when only a branded comment is entered for a new expense', async () => {
    const { onSubmit, apiFetch } = renderForm();
    await act(async () => {});
    typeDescription('Chop Chop');
    expect(screen.getByRole('region', { name: 'Иконка операции' }).querySelector('img')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Выбрать иконку' })).not.toBeInTheDocument();
    submit();
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ companyName: '', description: 'Chop Chop', logoMode: 'category' }));
    expect(apiFetch.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
  });

  it('keeps the entered company and comment when registry creation fails, without submitting the expense', async () => {
    const { onSubmit } = renderForm({ createError: 'Компания сейчас не сохраняется' });
    typeCompany('Chop Chop');
    typeDescription('Стрижка');
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('Компания сейчас не сохраняется');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText('Название магазина или сервиса')).toHaveValue('Chop Chop');
    expect(screen.getByPlaceholderText('Комментарий...')).toHaveValue('Стрижка');
    expect(screen.getByRole('button', { name: 'Сохранить', exact: true })).toBeEnabled();
  });
});
