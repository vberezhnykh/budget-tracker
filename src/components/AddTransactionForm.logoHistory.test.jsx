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

// Компания выбирается на листе «Где»: он открывается строкой в форме, пока
// открыт, форма скрыта, а «Готово» возвращает в неё.
const whereSearch = () => screen.queryByRole('textbox', { name: 'Компания' });
const openWhere = () => {
  if (!whereSearch()) fireEvent.click(screen.getByRole('button', { name: /Магазин или сервис|Сменить/ }));
  return whereSearch();
};
const typeCompany = value => fireEvent.change(openWhere(), { target: { value } });
const done = () => fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
const typeDescription = value => fireEvent.change(screen.getByPlaceholderText('Необязательно'), { target: { value } });
// В «По сайту» ниже статуса может стоять скелетон поиска (тоже role="status"): статус логотипа первый
const logoStatus = () => screen.getAllByRole('status')[0];
const previewImage = () => screen.queryAllByRole('status')[0]?.parentElement.querySelector('img') ?? null;
const submit = () => fireEvent.click(screen.getByRole('button', { name: SAVE_BUTTON_NAME }));
// Превью логотипа на листе «Где»: ждём запрос картинки и отвечаем, что она загрузилась
async function loadPreview(pathname) {
  await waitFor(() => {
    expect(previewImage()).not.toBeNull();
    expect(new URL(previewImage().src).pathname).toBe(pathname);
  });
  fireEvent.load(previewImage());
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
    expect(whereSearch()).toHaveValue('Apple ');
    typeCompany('Apple Store');
    done();
    submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'created-company', companyName: 'Apple Store' })));
  });

  it('clears a linked company without changing the purchase comment', async () => {
    const { onSubmit } = renderForm({ initialData: transaction({ id: 'editing', companyId: 'saved-company', companyName: 'Chop Chop', description: 'Стрижка', logoMode: 'domain', merchantDomain: 'chopchop.com' }) });
    await act(async () => {});
    openWhere();
    fireEvent.click(screen.getByRole('button', { name: 'Без компании' }));
    expect(screen.getByRole('button', { name: /Магазин или сервис/ })).toBeInTheDocument();
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
    const preview = await loadPreview('/chopchop.com');
    expect(preview).toHaveTextContent('Логотип: chopchop.com');
    done();
    typeDescription('Стрижка и уход');
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
    openWhere();
    fireEvent.click(screen.getByRole('button', { name: /Chop Chop.*Обычно «Красота» · 2 операции/ }));
    expect(screen.getByRole('button', { name: /Chop Chop.*Сменить/ })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Необязательно')).toHaveValue('');
    openWhere();
    expect(previewImage()).toBeNull();
    expect(logoStatus()).toHaveTextContent('Значок категории «Красота»');
    done();

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

    done();
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
    fireEvent.click(screen.getByRole('button', { name: 'По сайту' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Сайт компании' }), { target: { value: 'mybarber.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Применить' }));
    const preview = await loadPreview('/mybarber.com');
    expect(preview).toHaveTextContent('Логотип: mybarber.com · запомним для «Chop Chop»');
    expect(preview).not.toHaveTextContent('Из истории');
    done();
    typeDescription('Another Barber');

    submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ companyName: 'Chop Chop', description: 'Another Barber', logoMode: 'domain', merchantDomain: 'mybarber.com' })));
  });

  it('keeps an edited transaction’s own selection regardless of newer matching history', async () => {
    const initialData = transaction({ id: 'editing', date: '2026-09-01', logoMode: 'domain', merchantDomain: 'originalbarber.com' });
    const { onSubmit, apiFetch } = renderForm({ initialData, transactions: [
      transaction({ id: 'newer', date: '2026-09-09', logoMode: 'domain', merchantDomain: 'chopchop.com' }),
    ] });
    await act(async () => {});

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
    openWhere();
    fireEvent.click(await screen.findByRole('button', { name: /Chop Chop.*Сохранённая компания/ }));
    // значок компании виден уже в строке «Где»
    await waitFor(() => expect(new URL(document.querySelector('img').src).pathname).toBe('/chopchop.com'));
    submit();
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'saved-company', companyName: 'Chop Chop', description: 'Стрижка', merchantDomain: 'chopchop.com' }));
    expect(apiFetch.mock.calls.filter(([url]) => url === '/api/companies')).toHaveLength(1);
    expect(apiFetch.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
  });

  it('keeps category mode when only a branded comment is entered for a new expense', async () => {
    const { onSubmit, apiFetch } = renderForm();
    await act(async () => {});
    typeDescription('Chop Chop');
    expect(screen.getByRole('button', { name: /Магазин или сервис/ }).querySelector('img')).toBeNull();
    submit();
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ companyName: '', description: 'Chop Chop', logoMode: 'category' }));
    expect(apiFetch.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
  });

  it('keeps the entered company and comment when registry creation fails, without submitting the expense', async () => {
    const { onSubmit } = renderForm({ createError: 'Компания сейчас не сохраняется' });
    typeCompany('Chop Chop');
    done();
    typeDescription('Стрижка');
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('Компания сейчас не сохраняется');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Chop Chop.*Сменить/ })).toBeInTheDocument();
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
    openWhere();
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(name) }));
  };

  it('offers no logo choice until a company is set', async () => {
    renderWithRegistry([]);
    await act(async () => {});
    expect(screen.getByRole('button', { name: /Магазин или сервис/ })).toBeInTheDocument();
    openWhere();
    expect(screen.queryByText('Значок в списке операций')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    typeCompany('Chop Chop');
    expect(screen.getByText('Значок в списке операций')).toBeInTheDocument();
  });

  it('switches to the category icon in one tap and remembers it for the company on save', async () => {
    const { onSubmit, apiFetch } = renderWithRegistry([saved]);
    await pickSuggestion('Chop Chop');
    openWhere();
    await loadPreview('/chopchop.com');
    expect(logoStatus()).toHaveTextContent('Логотип: chopchop.com');
    expect(logoStatus()).not.toHaveTextContent('запомним');

    fireEvent.click(screen.getByRole('button', { name: 'Категории', exact: true }));
    expect(previewImage()).toBeNull();
    expect(logoStatus()).toHaveTextContent('Значок категории «Красота» · запомним для «Chop Chop»');
    expect(screen.getByRole('button', { name: 'Категории', exact: true })).toHaveAttribute('aria-pressed', 'true');
    done();

    submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'saved-company', logoMode: 'category', merchantDomain: '' })));
    const update = apiFetch.mock.calls.find(([, options]) => options?.method === 'PUT');
    expect(JSON.parse(update[1].body)).toEqual({ name: 'Chop Chop', logoMode: 'category', merchantDomain: '', __v: 0 });
  });

  it('returns from the category icon to automatic matching', async () => {
    renderWithRegistry([{ ...saved, logoMode: 'category', merchantDomain: undefined }]);
    await pickSuggestion('Chop Chop');
    openWhere();
    expect(logoStatus()).toHaveTextContent('Значок категории «Красота»');
    fireEvent.click(screen.getByRole('button', { name: 'По названию' }));
    await loadPreview('/name/chop%20chop');
    expect(logoStatus()).toHaveTextContent('Логотип подобран по названию · запомним для «Chop Chop»');
  });

  it('reports a missing logo and keeps the website choice at hand', async () => {
    renderWithRegistry([]);
    typeCompany('Unknown Shop');
    await waitFor(() => expect(previewImage()).not.toBeNull());
    expect(logoStatus()).toHaveTextContent('Загружаем логотип…');
    fireEvent.error(previewImage());
    expect(logoStatus()).toHaveTextContent('Логотип не найден, показан значок категории');
    expect(screen.queryByRole('textbox', { name: 'Сайт компании' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'По сайту' }));
    expect(screen.getByRole('textbox', { name: 'Сайт компании' })).toBeInTheDocument();
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
    openWhere();
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(name) }));
  };
  const pressed = name => screen.getByRole('button', { name, exact: true }).getAttribute('aria-pressed') === 'true';

  it('fills an empty category from the chosen company', async () => {
    renderForCategories({ companies: [cafe] });
    await pick('McDonalds');
    expect(pressed('Кафе и доставка')).toBe(true);
    // категория совпала с обычной - строка «Где» так и говорит
    expect(screen.getByText('Чаще всего для «Кафе и доставка»')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Обычно:/ })).toBeNull();
  });

  it('fills the category when a saved company name is typed exactly', async () => {
    renderForCategories({ companies: [cafe] });
    await act(async () => {});
    typeCompany('mcdonalds');
    done();
    expect(pressed('Кафе и доставка')).toBe(true);
  });

  it('keeps a manually chosen category and only says which one is usual', async () => {
    renderForCategories({ companies: [cafe], select: 'Красота' });
    await pick('McDonalds');
    expect(pressed('Красота')).toBe(true);
    expect(pressed('Кафе и доставка')).toBe(false);
    expect(screen.getByText('Обычно «Кафе и доставка»')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Обычно:/ })).toBeNull();
  });

  it('replaces an auto-filled category when another company is chosen', async () => {
    renderForCategories({ companies: [cafe, services] });
    await pick('McDonalds');
    await pick('Servis Pro', 'Servis');
    expect(pressed('Услуги')).toBe(true);
    expect(screen.getByText('Чаще всего для «Услуги»')).toBeInTheDocument();
  });

  it('stops replacing the category once the user picks one manually', async () => {
    renderForCategories({ companies: [cafe, services] });
    await pick('McDonalds');
    fireEvent.click(screen.getByRole('button', { name: 'Красота', exact: true }));
    await pick('Servis Pro', 'Servis');
    expect(pressed('Красота')).toBe(true);
    expect(screen.getByText('Обычно «Услуги»')).toBeInTheDocument();
  });

  it('keeps the category when the company is cleared and ignores unknown categories', async () => {
    renderForCategories({ companies: [cafe, stranger] });
    await pick('McDonalds');
    openWhere();
    fireEvent.click(screen.getByRole('button', { name: 'Без компании' }));
    expect(pressed('Кафе и доставка')).toBe(true);
    await pick('Mystery', 'Myst');
    expect(pressed('Кафе и доставка')).toBe(true);
    expect(screen.queryByText(/Обычно/)).toBeNull();
  });
});
