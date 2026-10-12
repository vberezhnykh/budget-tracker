import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import AddTransactionForm from '../AddTransactionForm';
import { SAVE_BUTTON_NAME } from '../../test/queries';

const categories = [
    { _id: '1', name: 'Продукты', type: 'expense', order: 1 },
    { _id: '2', name: 'Кафе', type: 'expense', order: 2 },
    { _id: '3', name: 'Зарплата', type: 'income', order: 1 },
];
const accounts = [
    { _id: 'card', name: 'Карта', type: 'card', icon: '💳', isDefault: true },
    { _id: 'cash', name: 'Наличные', type: 'cash', icon: '💵', isDefault: true },
];
const draft = {
    type: 'expense', amount: 3.5, category: 'Кафе', account: 'card', date: '2026-10-11',
    companyId: 'co-1', companyName: 'Starbucks', logoMode: 'domain', merchantDomain: 'starbucks.com', description: 'латте',
};

const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const QUICK_URL = '/api/quick-entry';

// Форма ходит через apiFetch и за подсказками (компании, комментарии), поэтому
// ответ на фразу подменяется только для своего адреса, остальным - пустой список.
const quickFetch = answer => vi.fn((url, options) => (url === QUICK_URL ? answer(url, options) : Promise.resolve(json([]))));
const quickCalls = apiFetch => apiFetch.mock.calls.filter(([url]) => url === QUICK_URL);
const phraseField = () => screen.getByLabelText('Опишите операцию');
const fillButton = () => screen.getByRole('button', { name: /^(Заполнить|Разбираю…)$/ });
const pressed = name => screen.getByRole('button', { name }).getAttribute('aria-pressed');

function renderForm(props = {}) {
    const onSubmit = vi.fn();
    const apiFetch = props.apiFetch ?? quickFetch(async () => json({ draft }));
    render(<AddTransactionForm quickEntry categories={categories} accounts={accounts} onClose={vi.fn()} onSubmit={onSubmit} {...props} apiFetch={apiFetch} />);
    return { onSubmit, apiFetch };
}

async function fillWith(phrase = 'кофе 3.50 старбакс вчера с карты') {
    fireEvent.change(phraseField(), { target: { value: phrase } });
    // ответ может прийти сразу после клика, поэтому клик внутри act
    await act(async () => { fireEvent.click(fillButton()); });
}

describe('QuickEntry in the transaction form', () => {
    it('is hidden without the quickEntry prop and in edit mode', () => {
        const { unmount } = render(<AddTransactionForm categories={categories} accounts={accounts} onClose={vi.fn()} onSubmit={vi.fn()} />);
        expect(screen.queryByLabelText('Опишите операцию')).not.toBeInTheDocument();
        unmount();
        const editData = { id: 'tx', __v: 0, amount: 100, category: 'Продукты', type: 'expense', account: 'cash' };
        render(<AddTransactionForm quickEntry initialData={editData} categories={categories} accounts={accounts} apiFetch={quickFetch(async () => json({}))} onClose={vi.fn()} onSubmit={vi.fn()} onDelete={vi.fn()} />);
        expect(screen.queryByLabelText('Опишите операцию')).not.toBeInTheDocument();
    });

    it('shows the idle row above the form with a disabled button until the phrase has two characters', () => {
        renderForm();
        expect(phraseField()).toHaveAttribute('placeholder', 'кофе 3.50 Старбакс с карты');
        expect(phraseField()).toHaveAttribute('enterkeyhint', 'go');
        expect(screen.getByText('Сумма, на что, где и с какого счета. Можно продиктовать с клавиатуры.')).toBeInTheDocument();
        expect(fillButton()).toBeDisabled();
        fireEvent.change(phraseField(), { target: { value: ' к ' } });
        expect(fillButton()).toBeDisabled();
        fireEvent.change(phraseField(), { target: { value: 'кофе' } });
        expect(fillButton()).toBeEnabled();
        // строка стоит вне <form>
        expect(phraseField().closest('form')).toBeNull();
    });

    it('fills the fields from the draft and saves exactly what is shown', async () => {
        const { onSubmit, apiFetch } = renderForm();
        await fillWith();

        expect(await screen.findByText('Заполнено по фразе. Проверьте поля.')).toBeInTheDocument();
        expect(quickCalls(apiFetch)).toHaveLength(1);
        const [url, options] = quickCalls(apiFetch)[0];
        expect(url).toBe(QUICK_URL);
        expect(options.method).toBe('POST');
        expect(options.headers).toEqual({ 'Content-Type': 'application/json' });
        expect(JSON.parse(options.body)).toEqual({ text: 'кофе 3.50 старбакс вчера с карты', today: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });

        expect(screen.getByPlaceholderText('0')).toHaveValue('3,5');
        expect(pressed('Кафе')).toBe('true');
        expect(pressed('Карта')).toBe('true');
        expect(screen.getByLabelText('Комментарий')).toHaveValue('латте');
        expect(screen.getByDisplayValue('Starbucks')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: SAVE_BUTTON_NAME }));
        await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
        expect(onSubmit.mock.calls[0][0]).toMatchObject({
            type: 'expense', amount: 3.5, category: 'Кафе', account: 'card', date: '2026-10-11', description: 'латте',
            companyId: 'co-1', companyName: 'Starbucks', logoMode: 'domain', merchantDomain: 'starbucks.com',
        });
        // сохранение операции - дело onSubmit, а на сервер по сети ушёл один разбор фразы
        expect(apiFetch.mock.calls.filter(([, request]) => request?.method === 'POST').map(([requestUrl]) => requestUrl)).toEqual([QUICK_URL]);
    });

    it('dims the form and locks the phrase while the draft is loading', async () => {
        let resolve;
        const apiFetch = quickFetch(() => new Promise(r => { resolve = r; }));
        renderForm({ apiFetch });
        await fillWith('кофе 3.50');

        const button = screen.getByRole('button', { name: 'Разбираю…' });
        expect(button).toHaveAttribute('aria-busy', 'true');
        expect(phraseField()).toHaveAttribute('readonly');
        expect(screen.getByText('Обычно это занимает секунду-две.')).toBeInTheDocument();
        const form = screen.getByPlaceholderText('0').closest('form');
        expect(form).toHaveAttribute('aria-busy', 'true');
        expect(form).toHaveStyle({ opacity: '0.45', pointerEvents: 'none' });

        // повторное нажатие во время запроса второй запрос не шлёт
        fireEvent.click(button);
        expect(quickCalls(apiFetch)).toHaveLength(1);

        resolve(json({ draft }));
        expect(await screen.findByText('Заполнено по фразе. Проверьте поля.')).toBeInTheDocument();
        expect(form).not.toHaveAttribute('aria-busy');
        expect(form).not.toHaveStyle({ opacity: '0.45' });
        expect(phraseField()).not.toHaveAttribute('readonly');
    });

    it('shows the server message and leaves the form editable on an error', async () => {
        const apiFetch = quickFetch(async () => json({ code: 'QUICK_ENTRY_UNPARSED', message: 'Не получилось разобрать фразу. Попробуйте иначе.' }, 422));
        const { onSubmit } = renderForm({ apiFetch });
        await fillWith('что-то купил');

        expect(await screen.findByRole('alert')).toHaveTextContent('Не получилось разобрать фразу. Попробуйте иначе.');
        expect(screen.queryByRole('button', { name: 'Вернуть как было' })).not.toBeInTheDocument();
        fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '12' } });
        fireEvent.click(screen.getByRole('button', { name: 'Кафе' }));
        fireEvent.click(screen.getByRole('button', { name: 'Карта' }));
        fireEvent.click(screen.getByRole('button', { name: SAVE_BUTTON_NAME }));
        await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
        expect(onSubmit.mock.calls[0][0]).toMatchObject({ amount: 12, category: 'Кафе', account: 'card' });
    });

    it('falls back to the default unparsed text and to a network message', async () => {
        const first = renderForm({ apiFetch: quickFetch(async () => json({}, 422)) });
        await fillWith('что-то купил');
        expect(await screen.findByRole('alert')).toHaveTextContent('Не получилось разобрать фразу. Добавьте сумму и на что потрачено или заполните поля вручную.');
        expect(first.onSubmit).not.toHaveBeenCalled();
    });

    it('reports a network failure', async () => {
        renderForm({ apiFetch: quickFetch(async () => { throw new TypeError('Failed to fetch'); }) });
        await fillWith('кофе 3');
        expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось связаться с сервером. Заполните поля вручную.');
        expect(fillButton()).toBeEnabled();
    });

    it('«Вернуть как было» restores the form to its state before the fill', async () => {
        renderForm();
        fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '99' } });
        fireEvent.click(screen.getByRole('button', { name: 'Продукты' }));
        await fillWith();
        await screen.findByText('Заполнено по фразе. Проверьте поля.');
        expect(screen.getByPlaceholderText('0')).toHaveValue('3,5');

        fireEvent.click(screen.getByRole('button', { name: 'Вернуть как было' }));
        expect(screen.getByPlaceholderText('0')).toHaveValue('99');
        expect(pressed('Продукты')).toBe('true');
        expect(pressed('Кафе')).toBe('false');
        expect(screen.getByLabelText('Комментарий')).toHaveValue('');
        expect(screen.queryByDisplayValue('Starbucks')).not.toBeInTheDocument();
        expect(screen.queryByText('Заполнено по фразе. Проверьте поля.')).not.toBeInTheDocument();
        expect(phraseField()).toHaveValue('кофе 3.50 старбакс вчера с карты');
    });

    it('editing the phrase after a fill resets the status line but keeps the values', async () => {
        renderForm();
        await fillWith();
        await screen.findByText('Заполнено по фразе. Проверьте поля.');
        fireEvent.change(phraseField(), { target: { value: 'кофе 4' } });
        expect(screen.queryByText('Заполнено по фразе. Проверьте поля.')).not.toBeInTheDocument();
        expect(screen.getByText('Сумма, на что, где и с какого счета. Можно продиктовать с клавиатуры.')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('0')).toHaveValue('3,5');
    });

    it('Enter in the phrase field asks for the draft and never submits the form', async () => {
        const { onSubmit, apiFetch } = renderForm();
        fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '5' } });
        fireEvent.click(screen.getByRole('button', { name: 'Кафе' }));
        fireEvent.click(screen.getByRole('button', { name: 'Карта' }));
        fireEvent.change(phraseField(), { target: { value: 'кофе 3.50' } });
        fireEvent.keyDown(phraseField(), { key: 'Enter' });

        await screen.findByText('Заполнено по фразе. Проверьте поля.');
        expect(quickCalls(apiFetch)).toHaveLength(1);
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it('Enter with a too short phrase does nothing', () => {
        const { apiFetch } = renderForm();
        fireEvent.change(phraseField(), { target: { value: 'к' } });
        fireEvent.keyDown(phraseField(), { key: 'Enter' });
        expect(quickCalls(apiFetch)).toHaveLength(0);
    });

    it('asks to choose an account when the phrase did not name one', async () => {
        const { onSubmit } = renderForm({ apiFetch: quickFetch(async () => json({ draft: { type: 'expense', amount: 12, category: 'Кафе' } })) });
        expect(screen.queryByText(/выберите счет/)).not.toBeInTheDocument();
        await fillWith('такси 12 до аэропорта');

        expect(await screen.findByText('Заполнено по фразе. Проверьте поля. Счет не назван, выберите его.')).toBeInTheDocument();
        expect(screen.getByText(/· выберите счет/)).toBeInTheDocument();
        // сохранение без счёта по-прежнему закрыто
        expect(screen.getByRole('button', { name: SAVE_BUTTON_NAME })).toBeDisabled();

        fireEvent.click(screen.getByRole('button', { name: 'Наличные' }));
        expect(screen.queryByText(/выберите счет/)).not.toBeInTheDocument();
        expect(screen.getByText('Заполнено по фразе. Проверьте поля.')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: SAVE_BUTTON_NAME }));
        await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
        expect(onSubmit.mock.calls[0][0]).toMatchObject({ amount: 12, category: 'Кафе', account: 'cash' });
    });

    it('does not ask for an account when the form already has one', async () => {
        renderForm({ presetAccountId: 'cash', apiFetch: quickFetch(async () => json({ draft: { type: 'expense', amount: 12 } })) });
        await fillWith('такси 12');
        expect(await screen.findByText('Заполнено по фразе. Проверьте поля.')).toBeInTheDocument();
        expect(screen.queryByText(/выберите счет/)).not.toBeInTheDocument();
    });

    it('fills a transfer with both accounts', async () => {
        const { onSubmit } = renderForm({ apiFetch: quickFetch(async () => json({ draft: { type: 'transfer', amount: 50, account: 'cash', toAccount: 'card' } })) });
        await fillWith('перевел 50 с налички на карту');
        await screen.findByText('Заполнено по фразе. Проверьте поля.');
        const group = label => within(screen.getByRole('group', { name: label })).getAllByRole('button').filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.textContent);
        expect(group('Откуда')).toEqual(['Наличные']);
        expect(group('Куда')).toEqual(['Карта']);
        fireEvent.click(screen.getByRole('button', { name: 'Сохранить перевод' }));
        await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
        expect(onSubmit.mock.calls[0][0]).toMatchObject({ type: 'transfer', amount: 50, account: 'cash', toAccount: 'card' });
    });

    it('ignores a response that arrives after the form is closed', async () => {
        let resolve;
        const apiFetch = quickFetch(() => new Promise(r => { resolve = r; }));
        const { unmount } = render(<AddTransactionForm quickEntry categories={categories} accounts={accounts} onClose={vi.fn()} onSubmit={vi.fn()} apiFetch={apiFetch} />);
        await fillWith('кофе 3.50');
        const { signal } = quickCalls(apiFetch)[0][1];
        unmount();
        expect(signal.aborted).toBe(true);
        resolve(json({ draft }));
        await Promise.resolve();
    });
});
