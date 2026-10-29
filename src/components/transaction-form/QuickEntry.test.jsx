import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import AddTransactionForm from '../AddTransactionForm';
import { prepareReceiptImage } from './receiptImage';
import { SAVE_BUTTON_NAME } from '../../test/queries';

// Настоящего canvas в jsdom нет: подготовку фото подменяем, остальное настоящее
vi.mock('./receiptImage', async (importOriginal) => ({ ...(await importOriginal()), prepareReceiptImage: vi.fn() }));

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
const IDLE_HINT = 'Напишите, что купили, или сфотографируйте чек. Слова к фото тоже учитываются: «с Revolut».';

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
    const view = render(<AddTransactionForm quickEntry categories={categories} accounts={accounts} onClose={vi.fn()} onSubmit={onSubmit} {...props} apiFetch={apiFetch} />);
    return { onSubmit, apiFetch, unmount: view.unmount };
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
        expect(phraseField()).toHaveAttribute('placeholder', 'кофе 3.50 с карты');
        expect(phraseField()).toHaveAttribute('enterkeyhint', 'go');
        expect(screen.getByText(IDLE_HINT)).toBeInTheDocument();
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
        expect(screen.getByText(IDLE_HINT)).toBeInTheDocument();
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
        expect(screen.queryByText(/выберите счёт/)).not.toBeInTheDocument();
        await fillWith('такси 12 до аэропорта');

        expect(await screen.findByText('Заполнено по фразе. Проверьте поля. Счёт не назван, выберите его.')).toBeInTheDocument();
        expect(screen.getByText(/· выберите счёт/)).toBeInTheDocument();
        // сохранение без счёта по-прежнему закрыто
        expect(screen.getByRole('button', { name: SAVE_BUTTON_NAME })).toBeDisabled();

        fireEvent.click(screen.getByRole('button', { name: 'Наличные' }));
        expect(screen.queryByText(/выберите счёт/)).not.toBeInTheDocument();
        expect(screen.getByText('Заполнено по фразе. Проверьте поля.')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: SAVE_BUTTON_NAME }));
        await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
        expect(onSubmit.mock.calls[0][0]).toMatchObject({ amount: 12, category: 'Кафе', account: 'cash' });
    });

    it('does not ask for an account when the form already has one', async () => {
        renderForm({ presetAccountId: 'cash', apiFetch: quickFetch(async () => json({ draft: { type: 'expense', amount: 12 } })) });
        await fillWith('такси 12');
        expect(await screen.findByText('Заполнено по фразе. Проверьте поля.')).toBeInTheDocument();
        expect(screen.queryByText(/выберите счёт/)).not.toBeInTheDocument();
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

// ---- Фото чека ----

const RECEIPT_URL = '/api/quick-entry/receipt';
const categories2 = [...categories, { _id: '4', name: 'Дом', type: 'expense', order: 3 }];
const splitDraft = {
    type: 'expense', amount: 40.5, account: 'card', date: '2026-10-11',
    companyId: 'co-2', companyName: 'Lidl', logoMode: 'category',
    splits: [{ category: 'Продукты', amount: 32.4 }, { category: 'Дом', amount: 8.1 }],
};

const receiptFetch = answer => vi.fn((url, options) => (url === RECEIPT_URL ? answer(url, options) : Promise.resolve(json([]))));
const receiptCalls = apiFetch => apiFetch.mock.calls.filter(([url]) => url === RECEIPT_URL);
const fileInput = () => document.querySelector('input[type="file"]');
const receiptFile = () => new File(['x'], 'receipt.jpg', { type: 'image/jpeg' });
const camera = () => screen.getByRole('button', { name: 'Сфотографировать чек' });
const thumb = () => screen.getByRole('button', { name: 'Открыть фото чека' });
const receiptButton = () => screen.getByRole('button', { name: /^(Заполнить|Читаю чек…)$/ });

async function chooseFile(file = receiptFile()) {
    await act(async () => { fireEvent.change(fileInput(), { target: { files: [file] } }); });
}

describe('Receipt photo in the transaction form', () => {
    const preparedBlob = new Blob(['jpeg'], { type: 'image/jpeg' });

    beforeEach(() => {
        prepareReceiptImage.mockReset();
        prepareReceiptImage.mockResolvedValue(preparedBlob);
        let counter = 0;
        URL.createObjectURL = vi.fn(() => `blob:receipt-${++counter}`);
        URL.revokeObjectURL = vi.fn();
    });
    afterEach(() => {
        delete URL.createObjectURL;
        delete URL.revokeObjectURL;
    });

    function renderReceipt(answer = async () => json({ draft: splitDraft }), props = {}) {
        return renderForm({ categories: categories2, apiFetch: receiptFetch(answer), ...props });
    }

    it('shows a camera button that opens an image picker without capture', () => {
        renderReceipt();
        expect(camera()).toBeEnabled();
        expect(thumb).toThrow();
        expect(fileInput()).toHaveAttribute('accept', 'image/*');
        expect(fileInput()).not.toHaveAttribute('capture');
        const pick = vi.spyOn(fileInput(), 'click');
        fireEvent.click(camera());
        expect(pick).toHaveBeenCalledTimes(1);
    });

    it('reads the photo at once with the typed text as a note, then fills the form', async () => {
        let resolve;
        const { apiFetch } = renderReceipt(() => new Promise(r => { resolve = r; }));
        fireEvent.change(phraseField(), { target: { value: 'с Revolut' } });
        const file = receiptFile();
        await chooseFile(file);

        expect(prepareReceiptImage).toHaveBeenCalledWith(file);
        expect(receiptCalls(apiFetch)).toHaveLength(1);
        expect(quickCalls(apiFetch)).toHaveLength(0);
        const [url, options] = receiptCalls(apiFetch)[0];
        expect(url).toBe(RECEIPT_URL);
        expect(options.method).toBe('POST');
        expect(options.body).toBe(preparedBlob);
        expect(options.headers).toEqual({
            'Content-Type': 'image/jpeg',
            'X-Quick-Entry-Today': expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
            'X-Quick-Entry-Text': encodeURIComponent('с Revolut'),
        });

        // чтение идёт: миниатюра вместо камеры, строка заблокирована, форма приглушена
        expect(screen.queryByRole('button', { name: 'Сфотографировать чек' })).not.toBeInTheDocument();
        expect(thumb().querySelector('img')).toHaveAttribute('src', 'blob:receipt-1');
        expect(receiptButton()).toHaveTextContent('Читаю чек…');
        expect(receiptButton()).toHaveAttribute('aria-busy', 'true');
        expect(phraseField()).toHaveAttribute('readonly');
        expect(phraseField()).toHaveAttribute('placeholder', 'Уточнение к чеку');
        expect(screen.getByText('Чек читается дольше фразы, обычно 3–5 секунд.')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('0').closest('form')).toHaveStyle({ opacity: '0.45' });

        resolve(json({ draft: { ...draft, companyId: 'co-1' } }));
        expect(await screen.findByText('Заполнено по чеку. Проверьте поля.')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('0')).toHaveValue('3,5');
        expect(pressed('Кафе')).toBe('true');
        expect(screen.getByPlaceholderText('0').closest('form')).not.toHaveStyle({ opacity: '0.45' });
        expect(phraseField()).not.toHaveAttribute('readonly');
    });

    it('sends no note header without text and drops a one-character note', async () => {
        const { apiFetch } = renderReceipt();
        await chooseFile();
        expect(receiptCalls(apiFetch)[0][1].headers).not.toHaveProperty('X-Quick-Entry-Text');
        fireEvent.change(phraseField(), { target: { value: ' к ' } });
        await act(async () => { fireEvent.click(receiptButton()); });
        expect(receiptCalls(apiFetch)[1][1].headers).not.toHaveProperty('X-Quick-Entry-Text');
    });

    it('«Заполнить» re-reads the same photo with the new text', async () => {
        const { apiFetch } = renderReceipt();
        await chooseFile();
        await screen.findByText(/сумма разделена/);
        expect(prepareReceiptImage).toHaveBeenCalledTimes(1);

        fireEvent.change(phraseField(), { target: { value: 'с Revolut' } });
        expect(receiptButton()).toBeEnabled();
        await act(async () => { fireEvent.click(receiptButton()); });

        expect(prepareReceiptImage).toHaveBeenCalledTimes(1);
        expect(receiptCalls(apiFetch)).toHaveLength(2);
        expect(receiptCalls(apiFetch)[1][1].body).toBe(preparedBlob);
        expect(receiptCalls(apiFetch)[1][1].headers['X-Quick-Entry-Text']).toBe(encodeURIComponent('с Revolut'));
        expect(quickCalls(apiFetch)).toHaveLength(0);
    });

    it('«Заполнить» with a photo works without any text', async () => {
        renderReceipt();
        await chooseFile();
        await screen.findByText(/сумма разделена/);
        expect(phraseField()).toHaveValue('');
        expect(receiptButton()).toBeEnabled();
    });

    it('puts a split receipt into split mode and saves the parts with the company on each', async () => {
        const { onSubmit, apiFetch } = renderReceipt();
        await chooseFile();

        expect(await screen.findByText('В чеке товары разных категорий, сумма разделена. Проверьте части.')).toBeInTheDocument();
        expect(screen.getByText('Общая сумма')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('0')).toHaveValue('40,5');
        expect(pressed('Продукты')).toBe('true');
        expect(pressed('Дом')).toBe('true');
        expect(screen.getAllByPlaceholderText('Сумма').map(field => field.value)).toEqual(['32.40', '8.10']);
        expect(screen.getByDisplayValue('Lidl')).toBeInTheDocument();
        expect(screen.getByText('Осталось распределить:').nextSibling).toHaveTextContent('€0');
        // строка с камерой остаётся на месте и в разделении
        expect(phraseField()).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: SAVE_BUTTON_NAME }));
        await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
        const parts = onSubmit.mock.calls[0][0];
        expect(parts).toHaveLength(2);
        expect(parts).toEqual([
            expect.objectContaining({ category: 'Продукты', amount: 32.4, companyId: 'co-2', companyName: 'Lidl', account: 'card', date: '2026-10-11', type: 'expense' }),
            expect.objectContaining({ category: 'Дом', amount: 8.1, companyId: 'co-2', companyName: 'Lidl', account: 'card', date: '2026-10-11', type: 'expense' }),
        ]);
        expect(parts[0].splitId).toBe(parts[1].splitId);
        expect(apiFetch.mock.calls.filter(([, request]) => request?.method === 'POST').map(([requestUrl]) => requestUrl)).toEqual([RECEIPT_URL]);
    });

    it('«Вернуть как было» restores the non-split form after a split receipt', async () => {
        renderReceipt();
        fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '99' } });
        fireEvent.click(screen.getByRole('button', { name: 'Кафе' }));
        await chooseFile();
        await screen.findByText(/сумма разделена/);
        expect(screen.getByText('Общая сумма')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Вернуть как было' }));
        expect(screen.queryByText('Общая сумма')).not.toBeInTheDocument();
        expect(screen.queryByPlaceholderText('Сумма')).not.toBeInTheDocument();
        expect(screen.getByPlaceholderText('0')).toHaveValue('99');
        expect(pressed('Кафе')).toBe('true');
        expect(screen.queryByDisplayValue('Lidl')).not.toBeInTheDocument();
        expect(screen.getByRole('group', { name: 'Тип операции' })).toBeInTheDocument();
        // фото остаётся прикреплённым
        expect(thumb()).toBeInTheDocument();
    });

    it('«Вернуть как было» brings back the split mode the form was in', async () => {
        renderReceipt(async () => json({ draft }));
        fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '10' } });
        fireEvent.click(screen.getByRole('button', { name: 'Разделить' }));
        fireEvent.click(screen.getAllByRole('button', { name: 'Продукты' })[0]);
        fireEvent.change(screen.getAllByPlaceholderText('Сумма')[0], { target: { value: '6' } });
        expect(screen.getByText('Общая сумма')).toBeInTheDocument();

        await chooseFile();
        await screen.findByText('Заполнено по чеку. Проверьте поля.');
        // обычный чек выключает разделение
        expect(screen.queryByText('Общая сумма')).not.toBeInTheDocument();
        expect(screen.getByPlaceholderText('0')).toHaveValue('3,5');

        fireEvent.click(screen.getByRole('button', { name: 'Вернуть как было' }));
        expect(screen.getByText('Общая сумма')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('0')).toHaveValue('10');
        expect(pressed('Продукты')).toBe('true');
        expect(screen.getAllByPlaceholderText('Сумма')[0]).toHaveValue(6);
    });

    it('adds the account sentence to a receipt fill when the account is missing', async () => {
        renderReceipt(async () => json({ draft: { type: 'expense', amount: 12, category: 'Кафе' } }));
        await chooseFile();
        expect(await screen.findByText('Заполнено по чеку. Проверьте поля. Счёт не назван, выберите его.')).toBeInTheDocument();
    });

    it('shows the server message with «Другое фото» that reopens the picker', async () => {
        const message = 'Не удалось прочитать чек. Сфотографируйте его целиком, ровно и при хорошем свете или заполните поля вручную.';
        renderReceipt(async () => json({ code: 'QUICK_ENTRY_UNPARSED', message }, 422));
        await chooseFile();

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent(message);
        expect(screen.queryByRole('button', { name: 'Вернуть как было' })).not.toBeInTheDocument();
        const pick = vi.spyOn(fileInput(), 'click');
        fireEvent.click(within(alert).getByRole('button', { name: 'Другое фото' }));
        expect(pick).toHaveBeenCalledTimes(1);
        // фото остаётся, форму можно заполнить руками
        expect(thumb()).toBeInTheDocument();
        expect(receiptButton()).toBeEnabled();
    });

    it('falls back to the receipt message and to a network message', async () => {
        const first = renderReceipt(async () => json({}, 422));
        await chooseFile();
        expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось прочитать чек. Сфотографируйте его целиком, ровно и при хорошем свете или заполните поля вручную.');
        first.apiFetch.mockImplementation(async () => { throw new TypeError('Failed to fetch'); });
        await act(async () => { fireEvent.click(receiptButton()); });
        expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось связаться с сервером. Заполните поля вручную.');
        expect(within(screen.getByRole('alert')).getByRole('button', { name: 'Другое фото' })).toBeInTheDocument();
    });

    it('shows the image error without sending a request', async () => {
        prepareReceiptImage.mockRejectedValue(new Error('Это не похоже на фото.'));
        const { apiFetch } = renderReceipt();
        await chooseFile(new File(['x'], 'notes.pdf', { type: 'application/pdf' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Это не похоже на фото.');
        expect(within(screen.getByRole('alert')).getByRole('button', { name: 'Другое фото' })).toBeInTheDocument();
        expect(receiptCalls(apiFetch)).toHaveLength(0);
        // фото не прикреплено, камера на месте, форма не приглушена
        expect(camera()).toBeEnabled();
        expect(phraseField()).not.toHaveAttribute('readonly');
        expect(screen.getByPlaceholderText('0').closest('form')).not.toHaveStyle({ opacity: '0.45' });
    });

    it('keeps the phrase flow on the phrase route and shows the row in split mode', async () => {
        const { apiFetch } = renderForm({ categories: categories2 });
        fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '10' } });
        fireEvent.click(screen.getByRole('button', { name: 'Разделить' }));
        expect(screen.getByText('Общая сумма')).toBeInTheDocument();
        expect(phraseField()).toBeInTheDocument();
        expect(camera()).toBeInTheDocument();

        await fillWith();
        await screen.findByText('Заполнено по фразе. Проверьте поля.');
        expect(quickCalls(apiFetch)).toHaveLength(1);
        expect(receiptCalls(apiFetch)).toHaveLength(0);
        // фраза без частей выводит из разделения
        expect(screen.queryByText('Общая сумма')).not.toBeInTheDocument();
        expect(pressed('Кафе')).toBe('true');
    });

    it('releases the object URL when the photo is replaced, removed or the form is closed', async () => {
        const { unmount } = renderReceipt();
        await chooseFile();
        await screen.findByText(/сумма разделена/);
        expect(URL.revokeObjectURL).not.toHaveBeenCalled();

        await chooseFile();
        await waitFor(() => expect(thumb().querySelector('img')).toHaveAttribute('src', 'blob:receipt-2'));
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:receipt-1');

        unmount();
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:receipt-2');
    });

    it('ignores a response that arrives after the form is closed', async () => {
        let resolve;
        const apiFetch = receiptFetch(() => new Promise(r => { resolve = r; }));
        const { unmount } = render(<AddTransactionForm quickEntry categories={categories2} accounts={accounts} onClose={vi.fn()} onSubmit={vi.fn()} apiFetch={apiFetch} />);
        await chooseFile();
        const { signal } = receiptCalls(apiFetch)[0][1];
        unmount();
        expect(signal.aborted).toBe(true);
        resolve(json({ draft: splitDraft }));
        await Promise.resolve();
    });

    describe('preview', () => {
        const previewDialog = () => screen.getByRole('dialog', { name: 'Фото чека' });

        async function openPreview(props) {
            const view = renderReceipt(undefined, props);
            await chooseFile();
            await screen.findByText(/сумма разделена/);
            fireEvent.click(thumb());
            return view;
        }

        it('opens above the sheet with the photo, the caption and the actions', async () => {
            await openPreview();
            const dialog = previewDialog();
            expect(dialog.parentElement).toBe(document.body);
            expect(dialog).toHaveStyle({ position: 'fixed' });
            expect(Number(dialog.style.zIndex)).toBeGreaterThan(1000);
            expect(within(dialog).getByText('Фото чека')).toBeInTheDocument();
            expect(within(dialog).getByRole('img')).toHaveAttribute('src', 'blob:receipt-1');
            expect(within(dialog).getByText('Фото нужно, чтобы сверить поля. Оно не сохраняется ни в операции, ни на сервере.')).toBeInTheDocument();
            expect(within(dialog).getByRole('button', { name: 'Другое фото' })).toBeInTheDocument();
            expect(within(dialog).getByRole('button', { name: 'Убрать фото' })).toBeInTheDocument();
            expect(within(dialog).getByRole('button', { name: 'Закрыть' })).toHaveFocus();
        });

        it('closes with Escape without closing the sheet and gives the focus back to the thumbnail', async () => {
            const onClose = vi.fn();
            await openPreview({ onClose });
            fireEvent.keyDown(document.activeElement, { key: 'Escape' });

            expect(screen.queryByRole('dialog', { name: 'Фото чека' })).not.toBeInTheDocument();
            expect(onClose).not.toHaveBeenCalled();
            expect(thumb()).toHaveFocus();

            // дальше Escape снова закрывает лист
            fireEvent.keyDown(document.body, { key: 'Escape' });
            expect(onClose).toHaveBeenCalledTimes(1);
        });

        it('closes with the close button', async () => {
            const onClose = vi.fn();
            await openPreview({ onClose });
            fireEvent.click(within(previewDialog()).getByRole('button', { name: 'Закрыть' }));
            expect(screen.queryByRole('dialog', { name: 'Фото чека' })).not.toBeInTheDocument();
            expect(onClose).not.toHaveBeenCalled();
            expect(thumb()).toHaveFocus();
        });

        it('keeps Tab inside the preview', async () => {
            await openPreview();
            const dialog = previewDialog();
            const remove = within(dialog).getByRole('button', { name: 'Убрать фото' });
            remove.focus();
            fireEvent.keyDown(remove, { key: 'Tab' });
            expect(within(dialog).getByRole('button', { name: 'Закрыть' })).toHaveFocus();
            fireEvent.keyDown(document.activeElement, { key: 'Tab', shiftKey: true });
            expect(remove).toHaveFocus();
        });

        it('«Убрать фото» detaches the photo, keeps the values and returns the camera', async () => {
            await openPreview();
            fireEvent.click(within(previewDialog()).getByRole('button', { name: 'Убрать фото' }));

            expect(screen.queryByRole('dialog', { name: 'Фото чека' })).not.toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'Открыть фото чека' })).not.toBeInTheDocument();
            expect(camera()).toHaveFocus();
            expect(phraseField()).toHaveAttribute('placeholder', 'кофе 3.50 с карты');
            expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:receipt-1');
            // значения формы остались
            expect(screen.getByText('Общая сумма')).toBeInTheDocument();
            expect(screen.getByPlaceholderText('0')).toHaveValue('40,5');
            expect(screen.getAllByPlaceholderText('Сумма').map(field => field.value)).toEqual(['32.40', '8.10']);
            // без фото «Заполнить» снова требует фразу
            expect(screen.getByRole('button', { name: 'Заполнить' })).toBeDisabled();
        });

        it('«Другое фото» closes the preview and opens the picker', async () => {
            await openPreview();
            const pick = vi.spyOn(fileInput(), 'click');
            fireEvent.click(within(previewDialog()).getByRole('button', { name: 'Другое фото' }));
            expect(pick).toHaveBeenCalledTimes(1);
            expect(screen.queryByRole('dialog', { name: 'Фото чека' })).not.toBeInTheDocument();
            expect(thumb()).toBeInTheDocument();
        });
    });
});
