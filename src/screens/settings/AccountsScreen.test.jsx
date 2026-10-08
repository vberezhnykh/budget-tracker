import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { formatMoney } from '../../utils/money';

// jsdom не даёт раскладки, на которую опираются сенсоры dnd-kit, поэтому
// настоящее перетаскивание не воспроизвести (см. тесты handleAccountDragEnd
// в App.test.jsx). Вместо этого перехватываем свойства каждого DndContext и
// вызываем его onDragEnd так, как это сделал бы сенсор.
const dndContexts = [];
vi.mock('@dnd-kit/core', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        DndContext: (props) => {
            dndContexts.push(props);
            return <actual.DndContext {...props} />;
        },
    };
});

import AccountsScreen from './AccountsScreen';

const accounts = [
    { _id: 'card', name: 'Основная', type: 'card', icon: 'credit-card' },
    { _id: 'cash', name: 'Кошелёк', type: 'cash', icon: 'banknote' },
    { _id: 'deposit', name: 'Залог', type: 'card', icon: 'lock-keyhole', excludeFromTotal: true },
];
const balances = { total: 150, byAccount: { card: 100, cash: 50, deposit: 3000 } };

function renderScreen(overrides = {}) {
    const props = {
        accounts,
        balances,
        onBack: vi.fn(),
        onAdd: vi.fn(),
        onEdit: vi.fn(),
        onDragEnd: vi.fn(),
        ...overrides,
    };
    render(<AccountsScreen {...props} />);
    return props;
}

// Последний отрисованный набор контекстов: по одному на секцию.
const latestContexts = (count) => dndContexts.slice(-count);

describe('AccountsScreen', () => {
    beforeEach(() => {
        dndContexts.length = 0;
    });

    it('titles the screen «Счета» with a back button labelled «Ещё»', () => {
        const { onBack } = renderScreen();

        expect(screen.getByRole('heading', { level: 1, name: 'Счета' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /Ещё/ }));
        expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('adds an account from the «+» button', () => {
        const { onAdd } = renderScreen();

        fireEvent.click(screen.getByRole('button', { name: 'Добавить счёт' }));

        expect(onAdd).toHaveBeenCalledTimes(1);
    });

    it('splits accounts into «В общем капитале» and «Не в общем капитале» with their sums', () => {
        renderScreen();

        const counted = screen.getByRole('heading', { name: 'В общем капитале' }).closest('section');
        const frozen = screen.getByRole('heading', { name: 'Не в общем капитале' }).closest('section');

        expect(within(counted).getByText(formatMoney(150))).toBeInTheDocument();
        expect(within(counted).getByRole('button', { name: /^Основная/ })).toBeInTheDocument();
        expect(within(counted).getByRole('button', { name: /^Кошелёк/ })).toBeInTheDocument();
        expect(within(counted).queryByRole('button', { name: /^Залог/ })).not.toBeInTheDocument();

        // Сумма секции и баланс единственного счёта совпадают: два вхождения.
        expect(within(frozen).getAllByText(formatMoney(3000))).toHaveLength(2);
        expect(within(frozen).getByRole('button', { name: /^Залог/ })).toBeInTheDocument();
    });

    it('keeps the incoming order inside a section', () => {
        renderScreen();

        const handles = screen.getAllByRole('button', { name: /^Переместить:/ });

        expect(handles.map(handle => handle.getAttribute('aria-label'))).toEqual([
            'Переместить: Основная',
            'Переместить: Кошелёк',
            'Переместить: Залог',
        ]);
    });

    it('hides the second section when no account is excluded', () => {
        renderScreen({ accounts: accounts.slice(0, 2) });

        expect(screen.queryByRole('heading', { name: 'Не в общем капитале' })).not.toBeInTheDocument();
    });

    it('shows the type, the frozen mark and the balance in a row', () => {
        renderScreen();

        const cash = screen.getByRole('button', { name: /^Кошелёк/ });
        expect(within(cash).getByText('Наличные')).toBeInTheDocument();
        expect(within(cash).getByText(formatMoney(50))).toBeInTheDocument();

        const deposit = screen.getByRole('button', { name: /^Залог/ });
        expect(within(deposit).getByText('Карта · заморожен')).toBeInTheDocument();
    });

    it('tints the icon tile with the account theme', () => {
        renderScreen();

        const row = screen.getByRole('button', { name: /^Основная/ });

        expect(row.querySelector('[data-account-theme]')).not.toBeNull();
    });

    it('opens the edit sheet with the account when the row is pressed', () => {
        const { onEdit } = renderScreen();

        fireEvent.click(screen.getByRole('button', { name: /^Кошелёк/ }));

        expect(onEdit).toHaveBeenCalledWith(accounts[1]);
    });

    it('gives each drag handle an accessible name and keeps it separate from the row button', () => {
        const { onEdit } = renderScreen();

        const handle = screen.getByRole('button', { name: 'Переместить: Основная' });
        fireEvent.click(handle);

        expect(onEdit).not.toHaveBeenCalled();
        expect(handle).toHaveAttribute('aria-roledescription');
        expect(handle).toHaveAttribute('tabindex', '0');
    });

    it('explains the order in a note under the lists', () => {
        renderScreen();

        expect(screen.getByText(/В таком же порядке счета стоят на Обзоре/)).toBeInTheDocument();
    });

    it('passes a reorder inside a section straight to onDragEnd', () => {
        const { onDragEnd } = renderScreen();
        const [counted, frozen] = latestContexts(2);
        const event = { active: { id: 'card' }, over: { id: 'cash' } };

        counted.onDragEnd(event);

        expect(onDragEnd).toHaveBeenCalledWith(event);

        const frozenEvent = { active: { id: 'deposit' }, over: { id: 'deposit' } };
        frozen.onDragEnd(frozenEvent);
        expect(onDragEnd).toHaveBeenCalledWith(frozenEvent);
    });

    it('ignores a drop outside the section of the dragged account', () => {
        const { onDragEnd } = renderScreen();
        const [counted, frozen] = latestContexts(2);

        counted.onDragEnd({ active: { id: 'card' }, over: { id: 'deposit' } });
        frozen.onDragEnd({ active: { id: 'deposit' }, over: { id: 'card' } });
        counted.onDragEnd({ active: { id: 'card' }, over: null });

        expect(onDragEnd).not.toHaveBeenCalled();
    });

    it('registers a keyboard sensor next to the pointer sensor with the 8px distance', () => {
        renderScreen();
        const sensors = latestContexts(2)[0].sensors;

        expect(sensors).toHaveLength(2);
        expect(sensors[0].options).toEqual({ activationConstraint: { distance: 8 } });
        expect(sensors[1].options.coordinateGetter).toBeTypeOf('function');
    });
});
