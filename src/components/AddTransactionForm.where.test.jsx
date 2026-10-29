import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AddTransactionForm from './AddTransactionForm';
import { SAVE_BUTTON_NAME } from '../test/queries';

// Строка «Где» после категории, частые места под ней и лист «Где»: второй вид
// внутри листа формы.

const categories = [
  { _id: 'groceries', name: 'Продукты', type: 'expense' },
  { _id: 'cafe', name: 'Кафе и доставка', type: 'expense' },
  { _id: 'salary', name: 'Зарплата', type: 'income' },
];
const accounts = [{ _id: 'card', name: 'Карта', type: 'card' }, { _id: 'cash', name: 'Наличные', type: 'cash' }];

const lidl = { _id: 'lidl', __v: 0, name: 'Lidl', logoMode: 'domain', merchantDomain: 'lidl.com', category: 'Продукты', usage: { Продукты: 48 }, lastUsed: '2026-10-10' };
const alphamega = { _id: 'alpha', __v: 0, name: 'Alphamega', logoMode: 'category', category: 'Продукты', usage: { Продукты: 9 }, lastUsed: '2026-10-09' };
const bakery = { _id: 'bakery', __v: 0, name: 'Lipsi Bakery', logoMode: 'category', category: 'Кафе и доставка', usage: { 'Кафе и доставка': 3 }, lastUsed: '2026-10-08' };

function renderForm({ companies = [lidl, alphamega, bakery], history = [], props = {} } = {}) {
  const onSubmit = vi.fn().mockReturnValue(false);
  const onClose = vi.fn();
  const apiFetch = vi.fn().mockImplementation(async url => {
    if (url === '/api/companies') return { ok: true, json: async () => companies };
    if (url.startsWith('/api/companies/history')) return { ok: true, json: async () => history };
    return { ok: true, json: async () => ({ merchants: [] }) };
  });
  const view = render(<AddTransactionForm type="expense" categories={categories} accounts={accounts} presetAccountId="card" apiFetch={apiFetch} onClose={onClose} onSubmit={onSubmit} {...props} />);
  return { ...view, onSubmit, onClose, apiFetch };
}

const chooseCategory = name => fireEvent.click(screen.getByRole('button', { name, exact: true }));
const rowButton = () => screen.getByRole('button', { name: /Магазин или сервис|Сменить/ });
const search = () => screen.queryByRole('textbox', { name: 'Компания' });
const openWhere = () => { fireEvent.click(rowButton()); return search(); };
const places = category => screen.queryByRole('group', { name: `Частые места для категории «${category}»` });
const historyCalls = apiFetch => apiFetch.mock.calls.filter(([url]) => url.startsWith('/api/companies/history')).map(([url]) => decodeURIComponent(url));

beforeEach(() => vi.stubEnv('VITE_LOGO_DEV_PUBLISHABLE_KEY', 'pk_test_where'));
afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

describe('«Где» in the expense form', () => {
  it('sits right after the category block, before the account, date and comment', async () => {
    renderForm();
    await act(async () => {});
    const order = [
      screen.getByText('Категория'), screen.getByText('Где'), screen.getByText('Списать с'),
      screen.getByText('Дата'), screen.getByText('Комментарий'), screen.getByRole('button', { name: /Дополнительно/ }),
    ];
    order.slice(1).forEach((element, index) => {
      expect(order[index].compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
    expect(screen.queryByText(/Компания \(необязательно\)/)).toBeNull();
  });

  it('is expense only', async () => {
    renderForm();
    await act(async () => {});
    expect(screen.getByText('Где')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Доход' }));
    expect(screen.queryByText('Где')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Перевод' }));
    expect(screen.queryByText('Где')).toBeNull();
  });

  it('shows a placeholder row that opens the sheet with the search in focus', async () => {
    renderForm();
    await act(async () => {});
    expect(rowButton()).toHaveTextContent('Магазин или сервис');
    expect(rowButton()).not.toHaveTextContent('Сменить');
    expect(openWhere()).toHaveFocus();
  });

  it('shows the chosen company with a «Сменить» label and the usual category under the name', async () => {
    renderForm({ companies: [lidl] });
    await act(async () => {});
    chooseCategory('Кафе и доставка');
    openWhere();
    fireEvent.click(await screen.findByRole('button', { name: /Lidl/ }));
    // категория подставилась только в пустое поле: выбранная руками остаётся
    expect(rowButton()).toHaveTextContent('Lidl');
    expect(rowButton()).toHaveTextContent('Сменить');
    expect(rowButton()).toHaveTextContent('Обычно «Продукты»');
    chooseCategory('Продукты');
    expect(rowButton()).toHaveTextContent('Чаще всего для «Продукты»');
  });

  it('keeps no «Обычно» button under the company', async () => {
    renderForm({ companies: [lidl] });
    await act(async () => {});
    chooseCategory('Кафе и доставка');
    openWhere();
    fireEvent.click(await screen.findByRole('button', { name: /Lidl/ }));
    expect(screen.queryByRole('button', { name: /Обычно:/ })).toBeNull();
  });

  it('shows the load error on the row and retries the list', async () => {
    const failing = vi.fn().mockImplementation(async url => (url === '/api/companies' ? { ok: false, status: 503 } : { ok: true, json: async () => [] }));
    render(<AddTransactionForm type="expense" categories={categories} accounts={accounts} presetAccountId="card" apiFetch={failing} onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(await screen.findByText(/Список компаний недоступен\./)).toBeInTheDocument();
    failing.mockImplementation(async url => ({ ok: true, json: async () => (url === '/api/companies' ? [lidl] : []) }));
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(screen.queryByText(/Список компаний недоступен\./)).toBeNull());
  });
});

describe('frequent places under «Где»', () => {
  it('asks for the history of the chosen category as soon as it is chosen, not only on focus', async () => {
    const { apiFetch } = renderForm();
    await act(async () => {});
    expect(historyCalls(apiFetch)).toEqual([]);
    chooseCategory('Продукты');
    await waitFor(() => expect(historyCalls(apiFetch)).toEqual(['/api/companies/history?q=&category=Продукты']));
  });

  it('lists the companies used in the category, most used first, and nothing before a category is chosen', async () => {
    renderForm();
    await act(async () => {});
    expect(screen.queryByRole('group', { name: /Частые места/ })).toBeNull();
    chooseCategory('Продукты');
    const group = await screen.findByRole('group', { name: 'Частые места для категории «Продукты»' });
    expect(within(group).getAllByRole('button').map(button => button.textContent)).toEqual(['Lidl', 'Alphamega']);
    expect(within(group).getAllByRole('button').every(button => button.getAttribute('aria-pressed') === 'false')).toBe(true);
    chooseCategory('Кафе и доставка');
    expect(within(places('Кафе и доставка')).getAllByRole('button').map(button => button.textContent)).toEqual(['Lipsi Bakery']);
  });

  it('shows at most six places and hides the row when there are none', async () => {
    const many = Array.from({ length: 8 }, (_, index) => ({ _id: `c${index}`, __v: 0, name: `Shop ${index}`, logoMode: 'category', usage: { Продукты: 20 - index }, lastUsed: '2026-10-01' }));
    renderForm({ companies: many });
    await act(async () => {});
    chooseCategory('Продукты');
    expect(await screen.findByRole('group', { name: /Частые места/ })).toBeInTheDocument();
    expect(within(places('Продукты')).getAllByRole('button')).toHaveLength(6);
    chooseCategory('Кафе и доставка');
    expect(screen.queryByRole('group', { name: /Частые места/ })).toBeNull();
  });

  it('takes places from the history answer too', async () => {
    renderForm({ companies: [], history: [{ type: 'expense', companyName: 'Рынок', logoMode: 'category', category: 'Продукты', usage: { Продукты: 4 }, lastUsed: '2026-09-01' }] });
    await act(async () => {});
    chooseCategory('Продукты');
    expect(await within(await screen.findByRole('group', { name: /Частые места/ })).findByRole('button', { name: 'Рынок' })).toBeInTheDocument();
  });

  it('chooses a place in one tap: company, logo settings and a pressed state', async () => {
    const { onSubmit } = renderForm({ props: { transactions: [] } });
    onSubmit.mockResolvedValue(true);
    await act(async () => {});
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '12' } });
    chooseCategory('Продукты');
    const group = await screen.findByRole('group', { name: /Частые места/ });
    fireEvent.click(within(group).getByRole('button', { name: 'Lidl' }));
    expect(within(places('Продукты')).getByRole('button', { name: 'Lidl' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(places('Продукты')).getByRole('button', { name: 'Alphamega' })).toHaveAttribute('aria-pressed', 'false');
    expect(rowButton()).toHaveTextContent('Lidl');
    expect(rowButton()).toHaveTextContent('Чаще всего для «Продукты»');

    fireEvent.click(screen.getByRole('button', { name: SAVE_BUTTON_NAME }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'lidl', companyName: 'Lidl', logoMode: 'domain', merchantDomain: 'lidl.com', category: 'Продукты', amount: 12 })));
  });

  it('hides the places while splitting (there is no single category) but keeps the row', async () => {
    renderForm();
    await act(async () => {});
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '30' } });
    chooseCategory('Продукты');
    expect(await screen.findByRole('group', { name: /Частые места/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Разделить' }));
    expect(screen.queryByRole('group', { name: /Частые места/ })).toBeNull();
    expect(rowButton()).toHaveTextContent('Магазин или сервис');
  });
});

describe('the «Где» sheet', () => {
  it('replaces the form inside the same dialog and returns to it with everything intact', async () => {
    renderForm({ companies: [lidl] });
    await act(async () => {});
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '34' } });
    chooseCategory('Продукты');
    fireEvent.change(screen.getByPlaceholderText('Необязательно'), { target: { value: 'на неделю' } });

    openWhere();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: 'Где' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Где' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Сумма' })).toBeNull();
    // скрытая форма не получает фокус
    expect(document.querySelector('[inert]')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Назад: Расход' }));
    expect(screen.getByRole('dialog', { name: 'Новый расход' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('0')).toHaveValue('34');
    expect(screen.getByPlaceholderText('Необязательно')).toHaveValue('на неделю');
    expect(screen.getByRole('button', { name: 'Продукты', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(document.querySelector('[inert]')).toBeNull();
  });

  it('goes back on Escape and on the backdrop instead of closing the whole form', async () => {
    const { onClose } = renderForm();
    await act(async () => {});
    openWhere();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: 'Новый расход' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not open the keyboard when it is opened to change an existing company', async () => {
    renderForm({ companies: [lidl], props: { initialData: { id: 'x', __v: 0, type: 'expense', amount: 5, account: 'card', category: 'Продукты', companyId: 'lidl', companyName: 'Lidl', logoMode: 'domain', merchantDomain: 'lidl.com', date: '2026-10-10' } } });
    await act(async () => {});
    expect(openWhere()).not.toHaveFocus();
    expect(search()).toHaveValue('Lidl');
  });

  it('lists familiar companies with their usual category and the number of operations, marking the chosen one', async () => {
    renderForm({ companies: [lidl, alphamega, bakery] });
    await act(async () => {});
    chooseCategory('Продукты');
    openWhere();
    const list = await screen.findByRole('list', { name: 'Знакомые компании' });
    expect(within(list).getByRole('button', { name: /Lidl.*Обычно «Продукты» · 48 операций/ })).toBeInTheDocument();
    expect(within(list).getByRole('button', { name: /Alphamega.*9 операций/ })).toBeInTheDocument();
    expect(within(list).getByRole('button', { name: /Lipsi Bakery.*Обычно «Кафе и доставка» · 3 операции/ })).toBeInTheDocument();
    expect(within(list).queryByRole('img', { name: 'Выбрано' })).toBeNull();

    fireEvent.click(within(list).getByRole('button', { name: /Alphamega/ }));
    openWhere();
    expect(within(screen.getByRole('list', { name: 'Знакомые компании' })).getByRole('button', { name: /Alphamega.*Выбрано/ })).toBeInTheDocument();
  });

  it('falls back to the saved/history wording when there is no count', async () => {
    renderForm({ companies: [{ _id: 'plain', __v: 0, name: 'Plain Shop', logoMode: 'auto' }], history: [{ type: 'expense', companyName: 'Old Shop', logoMode: 'category', category: 'Продукты', date: '2026-01-01' }] });
    await act(async () => {});
    chooseCategory('Продукты');
    openWhere();
    expect(await screen.findByRole('button', { name: /Plain Shop.*Сохранённая компания/ })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Old Shop.*Обычно «Продукты» · 1 операция/ })).toBeInTheDocument();
  });

  it('filters by the typed text and offers a new company unless the name matches exactly', async () => {
    renderForm();
    await act(async () => {});
    openWhere();
    fireEvent.change(search(), { target: { value: 'Li' } });
    const list = screen.getByRole('list', { name: 'Знакомые компании' });
    expect(within(list).getAllByRole('button').map(button => button.textContent)).toEqual([
      expect.stringContaining('Lidl'), expect.stringContaining('Lipsi Bakery'), 'Новая компания «Li»',
    ]);

    fireEvent.change(search(), { target: { value: 'lidl' } });
    expect(screen.queryByRole('button', { name: /Новая компания/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Lidl.*Выбрано/ })).toBeInTheDocument();
  });

  it('keeps a new company name and goes back from the «Новая компания» row', async () => {
    renderForm();
    await act(async () => {});
    openWhere();
    fireEvent.change(search(), { target: { value: 'Кафе у моря' } });
    fireEvent.click(screen.getByRole('button', { name: 'Новая компания «Кафе у моря»' }));
    expect(search()).toBeNull();
    expect(rowButton()).toHaveTextContent('Кафе у моря');
  });

  it('shows at most six familiar companies', async () => {
    const many = Array.from({ length: 8 }, (_, index) => ({ _id: `c${index}`, __v: 0, name: `Shop ${index}`, logoMode: 'category' }));
    renderForm({ companies: many });
    await act(async () => {});
    openWhere();
    expect(within(screen.getByRole('list', { name: 'Знакомые компании' })).getAllByRole('button')).toHaveLength(6);
  });

  it('clears the typed name with the X and keeps the field focused', async () => {
    renderForm();
    await act(async () => {});
    openWhere();
    fireEvent.change(search(), { target: { value: 'Lidl' } });
    expect(screen.getByText('Значок в списке операций')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Очистить' }));
    expect(search()).toHaveValue('');
    expect(search()).toHaveFocus();
    expect(screen.queryByText('Значок в списке операций')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Очистить' })).toBeNull();
  });

  it('shows the three logo modes only with a company, and the category preview names the category', async () => {
    renderForm();
    await act(async () => {});
    chooseCategory('Продукты');
    openWhere();
    expect(screen.queryByRole('button', { name: 'По названию' })).toBeNull();
    fireEvent.change(search(), { target: { value: 'Unknown Shop' } });
    expect(screen.getByRole('button', { name: 'По названию' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Категории' }));
    expect(screen.getByRole('button', { name: 'Категории' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByRole('status')[0]).toHaveTextContent('Значок категории «Продукты» · запомним для «Unknown Shop»');
    fireEvent.click(screen.getByRole('button', { name: 'По сайту' }));
    expect(screen.getByRole('button', { name: 'По сайту' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('textbox', { name: 'Сайт компании' })).toBeInTheDocument();
  });

  it('removes the company with «Без компании» and returns to the form', async () => {
    renderForm({ companies: [lidl] });
    await act(async () => {});
    openWhere();
    fireEvent.change(search(), { target: { value: 'Lidl' } });
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    expect(rowButton()).toHaveTextContent('Lidl');
    openWhere();
    fireEvent.click(screen.getByRole('button', { name: 'Без компании' }));
    expect(search()).toBeNull();
    expect(rowButton()).toHaveTextContent('Магазин или сервис');
  });

  it('asks the history for the typed text and the category', async () => {
    const { apiFetch } = renderForm();
    await act(async () => {});
    chooseCategory('Продукты');
    openWhere();
    fireEvent.change(search(), { target: { value: 'Alph' } });
    await waitFor(() => expect(historyCalls(apiFetch)).toContain('/api/companies/history?q=Alph&category=Продукты'));
  });
});
