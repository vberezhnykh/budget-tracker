import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BankingSheet from './BankingSheet';
import App from '../App';

const accounts = [{ _id: 'card', name: 'Карта', type: 'card', icon: '💳' }, { _id: 'cash', name: 'Наличные', type: 'cash' }, { _id: 'other', name: 'Второй банк', type: 'card' }];
const categories = [{ _id: 'food', name: 'Продукты', type: 'expense' }, { _id: 'salary', name: 'Зарплата', type: 'income' }];
const proposal = { id: 'entry', version: 2, candidateToken: 'a'.repeat(64), bankAccountId: 'bank-account', accountId: 'card', amount: '12.34', currency: 'EUR', direction: 'expense', date: '2026-09-07', description: 'Coffee shop', reason: 'new', candidates: [] };
const candidate = { transactionId: 'manual', version: 3, amount: 12.34, date: '2026-09-07', title: 'Ручная покупка', category: 'Продукты', deleted: false, groupCount: 1 };
const bankData = { configured: true, syncIntervalHours: 6, scheduleLabel: '08:00, 14:00, 20:00', timeZone: 'Europe/Bucharest', pendingReviewCount: 1, connections: [] };
const connection = { id: 'connection', bank: 'boc', name: 'Bank of Cyprus', status: 'connected', lastSuccessfulSyncAt: '2026-09-07T05:00:00Z', nextSyncAt: '2026-09-07T11:00:00Z', accounts: [] };

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-07T07:00:00Z'));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

function renderSheet(overrides = {}) {
  const props = {
    data: bankData, review: { items: [proposal], total: 1 }, accounts, categories,
    onClose: vi.fn(), onRetry: vi.fn(), onConnect: vi.fn().mockResolvedValue({ ok: true }),
    onMapAccount: vi.fn().mockResolvedValue({ ok: true }), onSync: vi.fn().mockResolvedValue({ ok: true }),
    onDisconnect: vi.fn().mockResolvedValue({ ok: true }), onResolve: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  };
  const view = render(<BankingSheet {...props} />);
  return { ...view, props };
}

describe('BankingSheet proposals', () => {
  it('requires confirmation even without possible duplicates and edits category and description before adding', async () => {
    const { props } = renderSheet();
    expect(screen.getByText(/Ни одна операция не попадёт в бюджет/)).toBeInTheDocument();
    expect(screen.getByText(/08:00, 14:00, 20:00/)).toHaveTextContent('Europe/Bucharest');
    expect(props.onResolve).not.toHaveBeenCalled();
    const category = screen.getByLabelText('Категория: Coffee shop');
    expect(category).toHaveValue('Без категории');
    expect(within(category).queryByRole('option', { name: 'Зарплата' })).not.toBeInTheDocument();
    fireEvent.change(category, { target: { value: 'Продукты' } });
    expect(screen.getByLabelText('Описание: Coffee shop')).toHaveAttribute('maxlength', '1000');
    fireEvent.change(screen.getByLabelText('Описание: Coffee shop'), { target: { value: 'Кофе после встречи' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить в бюджет' }));
    await waitFor(() => expect(props.onResolve).toHaveBeenCalledWith('entry', { version: 2, action: 'import', category: 'Продукты', description: 'Кофе после встречи', candidateToken: proposal.candidateToken }));
  });

  it('does not select or merge similar manual records until the user names a candidate', async () => {
    const { props } = renderSheet({ review: { items: [{ ...proposal, candidates: [candidate, { ...candidate, transactionId: 'manual-2', version: 8, title: 'Другая покупка' }] }], total: 1 } });
    expect(props.onResolve).not.toHaveBeenCalled();
    expect(screen.getByText(/При сопоставлении категория и описание ручной записи сохраняются/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Это эта операция: Другая покупка' }));
    await waitFor(() => expect(props.onResolve).toHaveBeenCalledExactlyOnceWith('entry', { version: 2, action: 'match', transactionId: 'manual-2', transactionVersion: 8 }));
  });

  it('lets the user add a similar purchase separately or reject the bank proposal', async () => {
    const { props } = renderSheet({ review: { items: [{ ...proposal, candidates: [candidate] }], total: 1 } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить отдельно' }));
    await waitFor(() => expect(props.onResolve).toHaveBeenCalledWith('entry', { version: 2, action: 'import', category: 'Без категории', description: 'Coffee shop', candidateToken: proposal.candidateToken }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Отклонить' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Отклонить' }));
    await waitFor(() => expect(props.onResolve).toHaveBeenLastCalledWith('entry', { version: 2, action: 'ignore' }));
  });

  it.each([
    ['expense', 'Счёт получателя', 'toAccountId'],
    ['income', 'Счёт отправителя', 'fromAccountId'],
  ])('requires an explicit other account for a %s transfer', async (direction, label, field) => {
    const { props } = renderSheet({ review: { items: [{ ...proposal, direction, reason: 'own_transfer' }], total: 1 } });
    fireEvent.click(screen.getByText('Это перевод между своими счетами'));
    const select = screen.getByLabelText(label);
    expect(within(select).queryByRole('option', { name: 'Карта' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Добавить перевод' })).toBeDisabled();
    fireEvent.change(select, { target: { value: 'cash' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить перевод' }));
    await waitFor(() => expect(props.onResolve).toHaveBeenCalledWith('entry', { version: 2, action: 'transfer', description: 'Coffee shop', candidateToken: proposal.candidateToken, [field]: 'cash' }));
  });

  it('keeps foreign currency out of the EUR ledger while allowing rejection', async () => {
    const { props } = renderSheet({ review: { items: [{ ...proposal, amount: '1.123456789', currency: 'USD', candidates: [candidate] }], total: 1 } });
    expect(screen.getByText('−1,123456789 USD')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Добавить отдельно' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Это эта операция:/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Отклонить' }));
    await waitFor(() => expect(props.onResolve).toHaveBeenCalledWith('entry', { version: 2, action: 'ignore' }));
  });

  it('does not match a deleted candidate or import before account mapping', () => {
    const { props } = renderSheet({ review: { items: [{ ...proposal, accountId: null, candidates: [{ ...candidate, deleted: true, groupCount: 2 }] }], total: 1 } });
    expect(screen.getByText(/В корзине/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Это эта операция:/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Добавить отдельно' })).toBeDisabled();
    expect(props.onResolve).not.toHaveBeenCalled();
  });

  it('prevents duplicate decisions and keeps edits when a stale version is rejected', async () => {
    let finish;
    const onResolve = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    renderSheet({ onResolve });
    fireEvent.change(screen.getByLabelText('Описание: Coffee shop'), { target: { value: 'Моё описание' } });
    const approve = screen.getByRole('button', { name: 'Добавить в бюджет' });
    fireEvent.click(approve);
    fireEvent.click(approve);
    expect(onResolve).toHaveBeenCalledTimes(1);
    expect(approve).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Закрыть банки' })).toBeDisabled();
    await act(async () => finish({ ok: false, error: 'Предложение уже изменено. Обновите данные.' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Предложение уже изменено');
    expect(screen.getByLabelText('Описание: Coffee shop')).toHaveValue('Моё описание');
    expect(approve).toBeEnabled();
  });

  it('renders provider strings as text and handles a thrown request error', async () => {
    renderSheet({ review: { items: [{ ...proposal, description: '<img src=x onerror=alert(1)>' }], total: 1 }, onResolve: vi.fn().mockRejectedValue(new Error('private upstream detail')) });
    expect(screen.getByText('<img src=x onerror=alert(1)>', { selector: 'strong' })).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Отклонить' }));
    expect(await screen.findByRole('alert')).not.toHaveTextContent('private upstream detail');
  });
});

describe('BankingSheet connections', () => {
  it('passes the chosen bank and first-import date only after clicking connect', async () => {
    const { props } = renderSheet();
    fireEvent.change(screen.getByLabelText('Загрузить операции начиная с'), { target: { value: '2026-09-01' } });
    expect(props.onConnect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Подключить Revolut' }));
    await waitFor(() => expect(props.onConnect).toHaveBeenCalledExactlyOnceWith({ bank: 'revolut', importFrom: '2026-09-01' }));
  });

  it('shows balances separately by currency, server sync times, and respects the next-sync gate', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-07T07:00:00Z'));
    const { props, rerender } = renderSheet({ data: { ...bankData, connections: [{ ...connection, accounts: [{ id: 'ba', name: 'Общий счёт', accountId: 'card', currency: 'XXX', balances: [{ amount: '100.01', currency: 'EUR', type: 'BOOK', asOf: '2026-09-07T05:00:00Z' }, { amount: '50.123', currency: 'USD', type: 'BOOK', asOf: '2026-09-07T05:00:00Z' }] }] }] } });
    expect(screen.getByText('100,01 EUR')).toBeInTheDocument();
    expect(screen.getByText('50,123 USD')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Обновить после/ })).toBeDisabled();
    expect(props.onSync).not.toHaveBeenCalled();
    rerender(<BankingSheet {...props} data={{ ...bankData, connections: [{ ...connection, nextSyncAt: '2026-09-07T06:00:00Z' }] }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Обновить сейчас' }));
    await waitFor(() => expect(props.onSync).toHaveBeenCalledExactlyOnceWith('connection'));
  });

  it('requires an explicit existing card mapping and does not preselect or remap saved accounts', async () => {
    const { props } = renderSheet({ data: { ...bankData, connections: [{ ...connection, accounts: [{ id: 'unmapped', name: 'EUR account', currency: 'EUR' }, { id: 'mapped', name: 'Сохранённый', accountId: 'card', currency: 'EUR' }] }] } });
    const select = screen.getByLabelText('Счёт в приложении: EUR account');
    expect(select).toHaveValue('');
    expect(within(select).queryByRole('option', { name: 'Наличные' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Счёт в приложении: Сохранённый')).not.toBeInTheDocument();
    fireEvent.change(select, { target: { value: 'card' } });
    fireEvent.click(screen.getByRole('button', { name: 'Связать счёт' }));
    await waitFor(() => expect(props.onMapAccount).toHaveBeenCalledExactlyOnceWith('unmapped', 'card'));
  });

  it('labels an undated bank balance with the time it was received instead of inventing a bank timestamp', () => {
    renderSheet({ data: { ...bankData, connections: [{ ...connection, accounts: [{ id: 'ba', name: 'Счёт', accountId: 'card', balancesUpdatedAt: '2026-09-07T11:00:00Z', balances: [{ amount: '51.20', currency: 'EUR', type: 'ITAV', asOf: null }] }] }] } });
    expect(screen.getByText(/Доступно сейчас · Получен/)).toHaveTextContent('14:00');
    expect(screen.queryByText(/ITAV/)).not.toBeInTheDocument();
  });

  it('offers reconnect for expired consent and disconnect for an active connection', async () => {
    const { props, rerender } = renderSheet({ data: { ...bankData, connections: [{ ...connection, status: 'expired' }] } });
    expect(screen.getByRole('button', { name: /^Обновить после/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Подключить заново' }));
    await waitFor(() => expect(props.onConnect).toHaveBeenCalledWith(expect.objectContaining({ bank: 'boc' })));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Отключить банк' })).toBeEnabled());
    rerender(<BankingSheet {...props} data={{ ...bankData, connections: [connection] }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Отключить банк' }));
    await waitFor(() => expect(props.onDisconnect).toHaveBeenCalledExactlyOnceWith('connection'));
  });

  it('shows unconfigured and retry states without offering unusable connect controls', () => {
    const { props } = renderSheet({ data: { ...bankData, configured: false }, error: 'Нет связи' });
    expect(screen.queryByRole('button', { name: 'Подключить Revolut' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить загрузку' }));
    expect(props.onRetry).toHaveBeenCalledOnce();
  });

  it('refreshes only the displayed list while the bank is already syncing', () => {
    const { props } = renderSheet({ data: { ...bankData, connections: [{ ...connection, syncing: true, lastSuccessfulSyncAt: null }] } });
    expect(screen.getByText('Получаем данные из банка…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Обновить после/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Отключить банк' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Обновить список предложений' }));
    expect(props.onRetry).toHaveBeenCalledOnce();
    expect(props.onSync).not.toHaveBeenCalled();
  });

  it('limits the initial date to the last 90 calendar days, including the first day', async () => {
    const { props } = renderSheet();
    const input = screen.getByLabelText('Загрузить операции начиная с');
    expect(input).toHaveAttribute('min', '2026-06-09');
    expect(input).toHaveAttribute('max', '2026-09-07');
    fireEvent.change(input, { target: { value: '2026-06-08' } });
    expect(screen.getByRole('button', { name: 'Подключить Revolut' })).toBeDisabled();
    fireEvent.change(input, { target: { value: '2026-06-09' } });
    fireEvent.click(screen.getByRole('button', { name: 'Подключить Revolut' }));
    await waitFor(() => expect(props.onConnect).toHaveBeenCalledWith({ bank: 'revolut', importFrom: '2026-06-09' }));
  });

  it.each([
    ['own_transfer', /Возможно, это перевод между своими счетами/],
    ['possible_transfer', /Возможно, это перевод между своими счетами/],
    ['missing_reference', /Банк не передал постоянный идентификатор/],
  ])('explains the %s review reason without making a decision', (reason, text) => {
    const { props } = renderSheet({ review: { items: [{ ...proposal, reason }], total: 1 } });
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(props.onResolve).not.toHaveBeenCalled();
  });
});

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function appFetch(override = () => undefined) {
  const fetchMock = vi.fn(async (url, options) => {
    const custom = override(url, options);
    if (custom !== undefined) return custom;
    if (url === '/api/accounts') return response(accounts);
    if (url === '/api/categories') return response(categories);
    // These integration scenarios exercise an explicitly enabled bank module.
    // Disabled/missing feature flags are covered in App.bankingFeature.test.jsx.
    if (url === '/api/settings') return response({ monthlyLimit: 7000, features: { banking: true } });
    if (url === '/api/planned-payments' || url === '/api/transactions') return response([]);
    if (url === '/api/banking') return response(bankData);
    if (url === '/api/banking/review') return response({ items: [proposal], total: 1 });
    throw new Error(`Unexpected mock URL ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function openBankSheetInApp() {
  await screen.findByText('BudgetTracker');
  fireEvent.click(screen.getByTitle('Настройки'));
  fireEvent.click(await screen.findByRole('button', { name: /^Банки/ }));
  await screen.findByRole('heading', { name: 'Предложения из банков (1)' });
}

async function submitManualExpense() {
  await screen.findByText('BudgetTracker');
  fireEvent.click(screen.getByRole('button', { name: 'Добавить расход' }));
  fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '12.34' } });
  fireEvent.click(screen.getByText('Продукты'));
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Новый расход' })).getByRole('button', { name: 'Карта', exact: true }));
  fireEvent.click(screen.getByText('Сохранить'));
}

describe('App banking integration', () => {
  it('polls only server status and proposals every 15 seconds after the callback, then stops when closed', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    window.history.replaceState(null, '', '/?banking=connected');
    let ready = false;
    const fetchMock = appFetch(url => {
      if (url === '/api/banking') return response({ ...bankData, connections: [{ ...connection, syncing: !ready, lastSuccessfulSyncAt: ready ? connection.lastSuccessfulSyncAt : null }] });
      if (url === '/api/banking/review') return response(ready ? { items: [proposal], total: 1 } : { items: [], total: 0 });
    });
    render(<App />);
    await screen.findByRole('heading', { name: 'Предложения из банков (0)' });
    expect(screen.getByText('Получаем данные из банка…')).toBeInTheDocument();
    ready = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(screen.getByRole('heading', { name: 'Предложения из банков (1)' })).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/banking')).toHaveLength(2);
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/banking/review')).toHaveLength(2);
    expect(fetchMock.mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть банки' }));
    const before = fetchMock.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(45_000); });
    expect(fetchMock).toHaveBeenCalledTimes(before);
  });

  it('does not overlap a slow status read or keep polling after a 401', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    window.history.replaceState(null, '', '/?banking=connected');
    let finish;
    let bankGets = 0;
    const fetchMock = appFetch(url => {
      if (url === '/api/banking' && ++bankGets === 1) return new Promise(resolve => { finish = resolve; });
      if (url === '/api/banking') return response({}, 401);
    });
    render(<App />);
    await screen.findByRole('dialog', { name: 'Банки' });
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    await act(async () => { await vi.advanceTimersByTimeAsync(45_000); });
    expect(bankGets).toBe(1);
    await act(async () => finish(response(bankData)));
    await screen.findByRole('heading', { name: 'Предложения из банков (1)' });
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(screen.getByRole('button', { name: 'Войти' })).toBeInTheDocument();
    const before = fetchMock.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(45_000); });
    expect(fetchMock).toHaveBeenCalledTimes(before);
  });

  it('opens one bank sheet from settings and keeps proposals out of the budget', async () => {
    const fetchMock = appFetch();
    render(<App />);
    await openBankSheetInApp();
    expect(screen.queryByRole('dialog', { name: 'Настройки' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByTestId('balance-carousel')).toHaveTextContent('0,00');
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0);
  });

  it('consumes the callback flag once, opens banks after login check, and preserves unrelated URL parameters', async () => {
    window.history.replaceState(null, '', '/?banking=connected&view=budget#anchor');
    appFetch();
    render(<App />);
    expect(await screen.findByRole('dialog', { name: 'Банки' })).toBeInTheDocument();
    expect(window.location.search).toBe('?view=budget');
    expect(window.location.hash).toBe('#anchor');
    expect(screen.getByRole('alert')).toHaveTextContent('Банк подключён');
  });

  it('removes an approved proposal even when refreshing the bank queue fails', async () => {
    let resolved = false;
    const fetchMock = appFetch((url, options) => {
      if (url === '/api/banking/review/entry/resolve' && options?.method === 'POST') {
        resolved = true;
        return response({ resolved: true });
      }
      if (url === '/api/banking/review' && resolved) return response({ message: 'Обновление временно недоступно' }, 503);
    });
    render(<App />);
    await openBankSheetInApp();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить в бюджет' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Добавить в бюджет' })).not.toBeInTheDocument());
    expect(await screen.findByRole('alert')).toHaveTextContent('Обновление временно недоступно');
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/banking/review/entry/resolve')).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/transactions')).toHaveLength(2);
  });

  it('refreshes a conflicting proposal without automatically retrying the resolution', async () => {
    let conflicted = false;
    const fetchMock = appFetch((url, options) => {
      if (url.endsWith('/resolve') && options?.method === 'POST') { conflicted = true; return response({ message: 'Запись уже изменена' }, 409); }
      if (url === '/api/banking/review' && conflicted) return response({ items: [{ ...proposal, version: 3, description: 'Обновлённое предложение' }], total: 1 });
    });
    render(<App />);
    await openBankSheetInApp();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить в бюджет' }));
    expect(await screen.findByText('Обновлённое предложение', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Запись уже изменена');
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/resolve'))).toHaveLength(1);
  });

  it('does not restore a private bank response after the app session expires', async () => {
    let finishBanking;
    let bankingGets = 0;
    appFetch(url => {
      if (url === '/api/banking' && ++bankingGets === 1) return new Promise(resolve => { finishBanking = resolve; });
      if (url === '/api/banking') return response({}, 401);
    });
    render(<App />);
    await screen.findByText('BudgetTracker');
    fireEvent.click(screen.getByTitle('Настройки'));
    await waitFor(() => expect(finishBanking).toBeTypeOf('function'));
    fireEvent.click(screen.getByRole('button', { name: /^Банки/ }));
    expect(await screen.findByRole('button', { name: 'Войти' })).toBeInTheDocument();
    await act(async () => finishBanking(response({ ...bankData, connections: [{ ...connection, name: 'PRIVATE BANK NAME' }] })));
    expect(screen.queryByText('PRIVATE BANK NAME')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Банки' })).not.toBeInTheDocument();
  });

  it.each([
    [[true], { bankMatchEntryId: 'entry', bankTransactionVersion: 4 }],
    [[false, true], { bankDuplicateAction: 'separate' }],
    [[false, false], null],
  ])('requires an explicit decision when a manual expense resembles an approved bank entry: case %#', async (answers, expected) => {
    const confirm = vi.spyOn(window, 'confirm');
    answers.forEach(answer => confirm.mockReturnValueOnce(answer));
    let posts = 0;
    const fetchMock = appFetch((url, options) => {
      if (url === '/api/transactions' && options?.method === 'POST') {
        posts++;
        return posts === 1 ? response({ code: 'BANK_DUPLICATE', candidates: [{ entryId: 'entry', transactionId: 'bank-tx', version: 4, title: 'Coffee shop', amount: '12.34', date: '2026-09-07' }] }, 409) : response({ _id: 'saved' }, 201);
      }
    });
    render(<App />);
    await submitManualExpense();
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(answers.length));
    if (expected) {
      await waitFor(() => expect(posts).toBe(2));
      const sent = JSON.parse(fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST')[1][1].body);
      expect(sent).toMatchObject({ ...expected, amount: 12.34, category: 'Продукты', account: 'card' });
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Новый расход' })).not.toBeInTheDocument());
    } else {
      expect(posts).toBe(1);
      expect(screen.getByRole('dialog', { name: 'Новый расход' })).toBeInTheDocument();
    }
  });

  it('sends one explicit duplicate decision for the total of a split expense, preserving both parts', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const payloads = [];
    appFetch((url, options) => {
      if (url === '/api/categories') return response([...categories, { _id: 'transport', name: 'Транспорт', type: 'expense' }]);
      if (url === '/api/transactions' && options?.method === 'POST') {
        payloads.push(JSON.parse(options.body));
        return payloads.length === 1
          ? response({ code: 'BANK_DUPLICATE', candidates: [{ entryId: 'entry', version: 4, title: 'Одна покупка', amount: '30', date: '2026-09-07' }] }, 409)
          : response({ saved: true }, 201);
      }
    });
    render(<App />);
    await screen.findByText('BudgetTracker');
    fireEvent.click(screen.getByRole('button', { name: 'Добавить расход' }));
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '30' } });
    fireEvent.click(screen.getByText('Разделить на несколько категорий'));
    const amounts = screen.getAllByPlaceholderText('Сумма');
    fireEvent.change(amounts[0], { target: { value: '10' } });
    fireEvent.change(amounts[1], { target: { value: '20' } });
    fireEvent.click(screen.getAllByText('Продукты')[0]);
    fireEvent.click(screen.getAllByText('Транспорт')[1]);
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Новый расход' })).getByRole('button', { name: 'Карта', exact: true }));
    fireEvent.click(screen.getByText('Сохранить'));
    await waitFor(() => expect(payloads).toHaveLength(2));
    expect(payloads[1]).toHaveLength(2);
    expect(payloads[1][0]).toEqual({ ...payloads[0][0], bankMatchEntryId: 'entry', bankTransactionVersion: 4 });
    expect(payloads[1][1]).toEqual(payloads[0][1]);
    expect(payloads[1][0].splitId).toBe(payloads[1][1].splitId);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Новый расход' })).not.toBeInTheDocument());
  });
});
