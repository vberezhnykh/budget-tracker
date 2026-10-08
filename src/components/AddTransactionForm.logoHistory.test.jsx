import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AddTransactionForm from './AddTransactionForm';
import { SAVE_BUTTON_NAME } from '../test/queries';

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
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '34' } });
    fireEvent.click(screen.getByRole('button', { name: 'Красота', exact: true }));
  }
  return { onSubmit, apiFetch };
}

const typeCompany = value => fireEvent.change(screen.getByPlaceholderText('Название магазина или сервиса'), { target: { value } });
const typeDescription = value => fireEvent.change(screen.getByPlaceholderText('Необязательно'), { target: { value } });
const iconButton = () => screen.getByRole('button', { name: 'Выбрать иконку' });
const logoStatus = () => screen.getByRole('status');
const submit = () => fireEvent.click(screen.getByRole('button', { name: SAVE_BUTTON_NAME }));
async function loadPreview(pathname) {
  const preview = iconButton();
  await waitFor(() => {
    expect(preview.querySelector('img')).not.toBeNull();
    expect(new URL(preview.querySelector('img').src).pathname).toBe(pathname);
  });
  fireEvent.load(preview.querySelector('img'));
  return logoStatus();
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
    expect(preview).toHaveTextContent('Логотип: chopchop.com');
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
    expect(screen.getByPlaceholderText('Необязательно')).toHaveValue('');
    expect(iconButton().querySelector('img')).toBeNull();
    expect(logoStatus()).toHaveTextContent('Иконка категории');

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
    expect(preview).toHaveTextContent('Логотип подобран по названию');

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
    expect(preview).toHaveTextContent('Логотип: mybarber.com · запомним для «Chop Chop»');
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
    expect(preview).toHaveTextContent('Логотип: originalbarber.com');
    expect(preview).not.toHaveTextContent('Из истории');

    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '35' } });
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
    expect(document.querySelector('.company-field img')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Выбрать иконку' })).not.toBeInTheDocument();
    expect(logoStatus()).toHaveTextContent('Укажите компанию, чтобы подобрать логотип');
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
    expect(screen.getByPlaceholderText('Необязательно')).toHaveValue('Стрижка');
    expect(screen.getByRole('button', { name: SAVE_BUTTON_NAME })).toBeEnabled();
  });
});

describe('company field logo status and actions', () => {
  const saved = { _id: 'saved-company', __v: 0, name: 'Chop Chop', logoMode: 'domain', merchantDomain: 'chopchop.com' };
  function renderWithRegistry(companies) {
    const onSubmit = vi.fn().mockReturnValue(false);
    const apiFetch = vi.fn().mockImplementation(async (url, options = {}) => {
      if (options.method === 'PUT') return { ok: true, json: async () => ({ _id: 'saved-company', ...JSON.parse(options.body), __v: 1 }) };
      if (url === '/api/companies') return { ok: true, json: async () => companies };
      return { ok: true, json: async () => ({ merchants: [] }) };
    });
    render(<AddTransactionForm type="expense" categories={categories} accounts={accounts} presetAccountId="card" apiFetch={apiFetch} onClose={vi.fn()} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '34' } });
    fireEvent.click(screen.getByRole('button', { name: 'Красота', exact: true }));
    return { onSubmit, apiFetch };
  }
  const pickSuggestion = async name => {
    fireEvent.focus(screen.getByPlaceholderText('Название магазина или сервиса'));
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(name) }));
  };

  it('shows the category icon in the empty company field and prompts for a company', async () => {
    renderWithRegistry([]);
    await act(async () => {});
    expect(document.querySelector('.company-field [data-transaction-icon]')).not.toBeNull();
    expect(logoStatus()).toHaveTextContent('Укажите компанию, чтобы подобрать логотип');
    expect(screen.queryByRole('button', { name: 'Выбрать иконку' })).not.toBeInTheDocument();
  });

  it('switches to the category icon in one tap and remembers it for the company on save', async () => {
    const { onSubmit, apiFetch } = renderWithRegistry([saved]);
    await pickSuggestion('Chop Chop');
    await loadPreview('/chopchop.com');
    expect(logoStatus()).toHaveTextContent('Логотип: chopchop.com');
    expect(logoStatus()).not.toHaveTextContent('запомним');

    fireEvent.click(screen.getByRole('button', { name: 'Иконка категории', exact: true }));
    expect(iconButton().querySelector('img')).toBeNull();
    expect(logoStatus()).toHaveTextContent('Иконка категории · запомним для «Chop Chop»');
    expect(screen.getByRole('button', { name: 'Подобрать логотип' })).toBeInTheDocument();

    submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'saved-company', logoMode: 'category', merchantDomain: '' })));
    const update = apiFetch.mock.calls.find(([, options]) => options?.method === 'PUT');
    expect(JSON.parse(update[1].body)).toEqual({ name: 'Chop Chop', logoMode: 'category', merchantDomain: '', __v: 0 });
  });

  it('returns from the category icon to automatic matching', async () => {
    renderWithRegistry([{ ...saved, logoMode: 'category', merchantDomain: undefined }]);
    await pickSuggestion('Chop Chop');
    expect(logoStatus()).toHaveTextContent('Иконка категории');
    fireEvent.click(screen.getByRole('button', { name: 'Подобрать логотип' }));
    await loadPreview('/name/chop%20chop');
    expect(logoStatus()).toHaveTextContent('Логотип подобран по названию · запомним для «Chop Chop»');
  });

  it('reports a missing logo and offers to search for one', async () => {
    renderWithRegistry([]);
    typeCompany('Unknown Shop');
    const icon = iconButton();
    await waitFor(() => expect(icon.querySelector('img')).not.toBeNull());
    expect(logoStatus()).toHaveTextContent('Загружаем логотип…');
    fireEvent.error(icon.querySelector('img'));
    expect(logoStatus()).toHaveTextContent('Логотип не найден — показана иконка категории');
    fireEvent.click(screen.getByRole('button', { name: 'Найти логотип' }));
    expect(screen.getByRole('searchbox', { name: 'Найти компанию' })).toBeInTheDocument();
    expect(icon).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(icon);
    expect(screen.queryByRole('searchbox')).toBeNull();
  });
});

describe('usual category of a company', () => {
  const cafe = { _id: 'mc', __v: 0, name: 'McDonalds', logoMode: 'category', category: 'Кафе и доставка' };
  const services = { _id: 'sv', __v: 0, name: 'Servis Pro', logoMode: 'category', category: 'Услуги' };
  const stranger = { _id: 'xx', __v: 0, name: 'Mystery', logoMode: 'category', category: 'Несуществующая' };
  const allCategories = [...categories, { _id: 'cafe', name: 'Кафе и доставка', type: 'expense' }];
  function renderForCategories({ companies, select = '' } = {}) {
    const apiFetch = vi.fn().mockImplementation(async url => ({ ok: true, json: async () => (url === '/api/companies' ? companies : { merchants: [] }) }));
    render(<AddTransactionForm type="expense" categories={allCategories} accounts={accounts} presetAccountId="card" apiFetch={apiFetch} onClose={vi.fn()} onSubmit={vi.fn()} />);
    if (select) fireEvent.click(screen.getByRole('button', { name: select, exact: true }));
  }
  const pick = async (name, typed = '') => {
    if (typed) typeCompany(typed);
    fireEvent.focus(screen.getByPlaceholderText('Название магазина или сервиса'));
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(name) }));
  };
  const pressed = name => screen.getByRole('button', { name, exact: true }).getAttribute('aria-pressed') === 'true';

  it('fills an empty category from the chosen company', async () => {
    renderForCategories({ companies: [cafe] });
    await pick('McDonalds');
    expect(pressed('Кафе и доставка')).toBe(true);
    expect(screen.queryByRole('button', { name: /Обычно/ })).toBeNull();
  });

  it('fills the category when a saved company name is typed exactly', async () => {
    renderForCategories({ companies: [cafe] });
    await act(async () => {});
    typeCompany('mcdonalds');
    expect(pressed('Кафе и доставка')).toBe(true);
  });

  it('keeps a manually chosen category and offers the usual one in a tap', async () => {
    renderForCategories({ companies: [cafe], select: 'Красота' });
    await pick('McDonalds');
    expect(pressed('Красота')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Обычно: Кафе и доставка' }));
    expect(pressed('Кафе и доставка')).toBe(true);
    expect(pressed('Красота')).toBe(false);
    expect(screen.queryByRole('button', { name: /Обычно/ })).toBeNull();
  });

  it('replaces an auto-filled category when another company is chosen', async () => {
    renderForCategories({ companies: [cafe, services] });
    await pick('McDonalds');
    await pick('Servis Pro', 'Servis');
    expect(pressed('Услуги')).toBe(true);
    expect(screen.queryByRole('button', { name: /Обычно/ })).toBeNull();
  });

  it('stops replacing the category once the user picks one manually', async () => {
    renderForCategories({ companies: [cafe, services] });
    await pick('McDonalds');
    fireEvent.click(screen.getByRole('button', { name: 'Красота', exact: true }));
    await pick('Servis Pro', 'Servis');
    expect(pressed('Красота')).toBe(true);
    expect(screen.getByRole('button', { name: 'Обычно: Услуги' })).toBeInTheDocument();
  });

  it('keeps the category when the company is cleared and ignores unknown categories', async () => {
    renderForCategories({ companies: [cafe, stranger] });
    await pick('McDonalds');
    fireEvent.click(screen.getByRole('button', { name: 'Убрать компанию' }));
    expect(pressed('Кафе и доставка')).toBe(true);
    await pick('Mystery', 'Myst');
    expect(pressed('Кафе и доставка')).toBe(true);
    expect(screen.queryByRole('button', { name: /Обычно/ })).toBeNull();
  });
});
