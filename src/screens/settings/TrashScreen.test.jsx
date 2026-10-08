import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import TrashScreen from './TrashScreen';

const single = (overrides = {}) => ({
    id: 'g1',
    count: 1,
    deletedAt: '2020-03-05T09:30:00.000Z',
    transactions: [{ _id: 't1', type: 'expense', title: 'Обед', companyName: 'Lidl', category: 'Продукты', amount: 24.9 }],
    ...overrides,
});

const split = () => ({
    id: 'g2',
    count: 3,
    deletedAt: '2020-03-05T09:30:00.000Z',
    transactions: [
        { _id: 'a', type: 'expense', title: 'Чек', companyName: 'Lidl', category: 'Продукты', amount: 10 },
        { _id: 'b', type: 'expense', title: 'Чек', companyName: 'Lidl', category: 'Дом', amount: 5 },
        { _id: 'c', type: 'expense', title: 'Чек', companyName: 'Lidl', category: 'Продукты', amount: 2.5 },
    ],
});

const renderTrash = (props = {}) => render(
    <TrashScreen
        groups={[single()]}
        loading={false}
        error=""
        onBack={() => { }}
        onRetry={() => { }}
        onRestore={vi.fn().mockResolvedValue({ ok: true })}
        onPurge={vi.fn().mockResolvedValue({ ok: true })}
        {...props}
    />
);

afterEach(() => vi.restoreAllMocks());

describe('TrashScreen', () => {
    it('shows the header, back label and intro', () => {
        const onBack = vi.fn();
        renderTrash({ onBack });

        expect(screen.getByRole('heading', { level: 1, name: 'Корзина' })).toBeInTheDocument();
        expect(screen.getByText(/Операции лежат здесь, пока вы не удалите их навсегда/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /Ещё/ }));
        expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('renders a group with title, categories, deletion time and amount', () => {
        renderTrash();

        const card = screen.getByRole('article', { name: 'Lidl' });
        expect(within(card).getByText('Lidl')).toBeInTheDocument();
        expect(within(card).getByText(/Продукты · удалено/)).toBeInTheDocument();
        expect(within(card).getByText('€24,90')).toBeInTheDocument();
    });

    it('says «сегодня» for groups deleted today', () => {
        renderTrash({ groups: [single({ deletedAt: new Date().toISOString() })] });
        expect(screen.getByText(/удалено сегодня в \d{2}:\d{2}/)).toBeInTheDocument();
    });

    it('falls back to title and category when there is no company', () => {
        renderTrash({
            groups: [single({ transactions: [{ _id: 't', type: 'expense', title: 'Кофе', category: 'Кафе', amount: 3 }] })],
        });
        expect(screen.getByText('Кофе')).toBeInTheDocument();
    });

    it('shows a split group under its company with a parts count', () => {
        renderTrash({ groups: [split()] });

        const card = screen.getByRole('article', { name: 'Lidl' });
        expect(within(card).getByText(/Продукты, Дом · 3 части · удалено/)).toBeInTheDocument();
        expect(within(card).getByText('€17,50')).toBeInTheDocument();
    });

    it('titles a split group without a company «Группа операций (N)»', () => {
        const group = split();
        group.transactions.forEach(item => { delete item.companyName; });
        renderTrash({ groups: [group] });

        expect(screen.getByText('Группа операций (3)')).toBeInTheDocument();
    });

    it('labels a transfer simply «Перевод»', () => {
        renderTrash({
            groups: [single({ transactions: [{ _id: 't', type: 'transfer', title: 'Между счетами', amount: 100, account: 'a1', toAccount: 'a2' }] })],
        });
        expect(screen.getByText(/Перевод · удалено/)).toBeInTheDocument();
    });

    it('labels a transfer «A → B» when App supplied both account names', () => {
        renderTrash({
            groups: [single({ transactions: [{ _id: 't', type: 'transfer', title: 'Между счетами', amount: 100, account: 'a1', toAccount: 'a2', accountName: 'Карта', toAccountName: 'Наличные' }] })],
        });
        expect(screen.getByText(/Карта → Наличные · удалено/)).toBeInTheDocument();
        expect(screen.queryByText(/Перевод · удалено/)).not.toBeInTheDocument();
    });

    it('falls back to «Перевод» when only one account name is known', () => {
        renderTrash({
            groups: [single({ transactions: [{ _id: 't', type: 'transfer', title: 'Между счетами', amount: 100, account: 'a1', toAccount: 'gone', accountName: 'Карта' }] })],
        });
        expect(screen.getByText(/Перевод · удалено/)).toBeInTheDocument();
    });

    it('restores a group and shows the pending label', async () => {
        let resolve;
        const onRestore = vi.fn(() => new Promise(r => { resolve = r; }));
        renderTrash({ onRestore });

        fireEvent.click(screen.getByRole('button', { name: 'Восстановить' }));

        expect(onRestore).toHaveBeenCalledWith('g1');
        expect(screen.getByRole('button', { name: 'Восстановление…' })).toBeDisabled();
        expect(screen.getByRole('button', { name: /Удалить навсегда: Lidl/ })).toBeDisabled();

        resolve({ ok: true });
        await waitFor(() => expect(screen.getByRole('button', { name: 'Восстановить' })).toBeEnabled());
    });

    it('asks for purge confirmation inline and never uses window.confirm', () => {
        const confirm = vi.spyOn(window, 'confirm');
        const onPurge = vi.fn().mockResolvedValue({ ok: true });
        renderTrash({ onPurge });

        fireEvent.click(screen.getByRole('button', { name: /Удалить навсегда: Lidl/ }));

        expect(screen.getByText('Удалить навсегда? Вернуть будет нельзя.')).toBeInTheDocument();
        expect(onPurge).not.toHaveBeenCalled();
        expect(confirm).not.toHaveBeenCalled();
        expect(screen.queryByRole('button', { name: 'Восстановить' })).not.toBeInTheDocument();
    });

    it('purges after confirmation', async () => {
        const onPurge = vi.fn().mockResolvedValue({ ok: true });
        renderTrash({ onPurge });

        fireEvent.click(screen.getByRole('button', { name: /Удалить навсегда: Lidl/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));

        expect(onPurge).toHaveBeenCalledWith('g1');
        await waitFor(() => expect(screen.queryByText(/Вернуть будет нельзя/)).not.toBeInTheDocument());
    });

    it('cancels the confirmation without purging', () => {
        const onPurge = vi.fn();
        renderTrash({ onPurge });

        fireEvent.click(screen.getByRole('button', { name: /Удалить навсегда: Lidl/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));

        expect(onPurge).not.toHaveBeenCalled();
        expect(screen.queryByText(/Вернуть будет нельзя/)).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Восстановить' })).toBeInTheDocument();
    });

    it('words the confirmation for a split group', () => {
        renderTrash({ groups: [split()] });

        fireEvent.click(screen.getByRole('button', { name: /Удалить навсегда: Lidl/ }));
        expect(screen.getByText('Удалить навсегда все части (3)? Вернуть их будет нельзя.')).toBeInTheDocument();
    });

    it('keeps only one card in confirm mode', () => {
        renderTrash({ groups: [single(), single({ id: 'g3', transactions: [{ _id: 'x', type: 'expense', title: 'Такси', category: 'Такси', amount: 8 }] })] });

        fireEvent.click(screen.getByRole('button', { name: /Удалить навсегда: Lidl/ }));
        fireEvent.click(screen.getByRole('button', { name: /Удалить навсегда: Такси/ }));

        expect(screen.getAllByText('Удалить навсегда? Вернуть будет нельзя.')).toHaveLength(1);
        expect(screen.getByRole('button', { name: /Удалить навсегда: Lidl/ })).toBeInTheDocument();
    });

    it('shows the pending label while purging and disables other actions', async () => {
        let resolve;
        const onPurge = vi.fn(() => new Promise(r => { resolve = r; }));
        renderTrash({ onPurge });

        fireEvent.click(screen.getByRole('button', { name: /Удалить навсегда: Lidl/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));

        expect(screen.getByRole('button', { name: 'Удаление…' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Отмена' })).toBeDisabled();

        resolve({ ok: true });
        await waitFor(() => expect(screen.queryByText('Удаление…')).not.toBeInTheDocument());
    });

    it('shows an action error and keeps the confirmation for a retry', async () => {
        const onPurge = vi.fn().mockResolvedValue({ ok: false, error: 'Сервер недоступен' });
        renderTrash({ onPurge });

        fireEvent.click(screen.getByRole('button', { name: /Удалить навсегда: Lidl/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Сервер недоступен');
        expect(screen.getByRole('button', { name: 'Удалить' })).toBeEnabled();
    });

    it('uses a default message when the action fails without text', async () => {
        const onRestore = vi.fn().mockResolvedValue({ ok: false });
        renderTrash({ onRestore });

        fireEvent.click(screen.getByRole('button', { name: 'Восстановить' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось выполнить действие.');
    });

    it('shows a load error with a retry action', () => {
        const onRetry = vi.fn();
        renderTrash({ groups: [], error: 'Не удалось загрузить корзину', onRetry });

        expect(screen.getByRole('alert')).toHaveTextContent('Не удалось загрузить корзину');
        fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
        expect(onRetry).toHaveBeenCalledTimes(1);
        expect(screen.queryByText('Корзина пуста')).not.toBeInTheDocument();
    });

    it('shows a skeleton while loading', () => {
        renderTrash({ loading: true, groups: [] });

        expect(screen.getByRole('status', { name: 'Загрузка корзины…' })).toBeInTheDocument();
        expect(screen.queryByText('Корзина пуста')).not.toBeInTheDocument();
    });

    it('shows the empty state', () => {
        renderTrash({ groups: [] });

        expect(screen.getByText('Корзина пуста')).toBeInTheDocument();
        expect(screen.getByText(/Сюда попадают удалённые операции/)).toBeInTheDocument();
    });
});
