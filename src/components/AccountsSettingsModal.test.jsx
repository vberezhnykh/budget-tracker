import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import AccountsSettingsModal from './AccountsSettingsModal';

const accounts = [
    { _id: 'card', name: 'Карта', type: 'card', icon: '💳', isDefault: true },
    { _id: 'cash', name: 'Наличные', type: 'cash', icon: '💵', isDefault: false }
];

function renderModal(overrides = {}) {
    const props = {
        accounts,
        monthlyLimit: 7000,
        onClose: vi.fn(),
        onSaveAccount: vi.fn().mockResolvedValue(true),
        onDeleteAccount: vi.fn(),
        onDragEnd: vi.fn(),
        onSaveSettings: vi.fn().mockResolvedValue(true),
        onLogout: vi.fn(),
        showNotice: vi.fn(),
        ...overrides
    };
    const view = render(<AccountsSettingsModal {...props} />);
    return { ...view, props };
}

describe('AccountsSettingsModal', () => {
    it('renders the heading, the account list and the "add" form', () => {
        renderModal();

        expect(screen.getByText('Управление счетами')).toBeInTheDocument();
        expect(screen.getByLabelText('Изменить порядок: Карта')).toBeInTheDocument();
        expect(screen.getByLabelText('Изменить порядок: Наличные')).toBeInTheDocument();
        expect(screen.getByText('Добавить новый счёт')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Добавить счёт' })).toBeInTheDocument();
    });

    it('submits a new account with the form values and resets the form when onSaveAccount succeeds', async () => {
        const { props } = renderModal();

        fireEvent.change(screen.getByPlaceholderText(/Имя счёта/), { target: { value: 'Новый счёт' } });
        fireEvent.click(screen.getByRole('button', { name: 'Добавить счёт' }));

        await waitFor(() => {
            expect(props.onSaveAccount).toHaveBeenCalledWith('Новый счёт', 'card', '💳', null);
        });
        await waitFor(() => {
            expect(screen.getByPlaceholderText(/Имя счёта/)).toHaveValue('');
        });
    });

    it('keeps the entered values in the form when onSaveAccount fails', async () => {
        const { props } = renderModal({ onSaveAccount: vi.fn().mockResolvedValue(false) });

        fireEvent.change(screen.getByPlaceholderText(/Имя счёта/), { target: { value: 'Плохой счёт' } });
        fireEvent.click(screen.getByRole('button', { name: 'Добавить счёт' }));

        await waitFor(() => expect(props.onSaveAccount).toHaveBeenCalled());
        expect(screen.getByPlaceholderText(/Имя счёта/)).toHaveValue('Плохой счёт');
    });

    it('populates the form for editing and switches back to "add" mode on cancel', () => {
        renderModal();

        const editButtons = screen.getAllByRole('button', { name: 'Изменить' });
        fireEvent.click(editButtons[0]);

        expect(screen.getByText('Редактировать счёт')).toBeInTheDocument();
        expect(screen.getByPlaceholderText(/Имя счёта/)).toHaveValue('Карта');
        expect(screen.getByRole('button', { name: 'Сохранить изменения' })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));

        expect(screen.getByText('Добавить новый счёт')).toBeInTheDocument();
        expect(screen.getByPlaceholderText(/Имя счёта/)).toHaveValue('');
    });

    it('calls onDeleteAccount with the id and name of the clicked row', () => {
        const { props } = renderModal();

        const deleteButtons = screen.getAllByRole('button', { name: 'Удалить' });
        fireEvent.click(deleteButtons[1]);

        expect(props.onDeleteAccount).toHaveBeenCalledWith('cash', 'Наличные');
    });

    it('calls onClose from the close (✕) button', () => {
        const { props } = renderModal();

        fireEvent.click(screen.getByText('✕'));

        expect(props.onClose).toHaveBeenCalledTimes(1);
    });

    it('calls onClose when the backdrop itself is clicked', () => {
        const { props, container } = renderModal();

        // The outermost rendered element is the backdrop - the card inside
        // it stops click propagation, so only a direct click on the
        // backdrop node itself (not a descendant) should reach onClose.
        fireEvent.click(container.firstChild);

        expect(props.onClose).toHaveBeenCalledTimes(1);
    });

    it('calls onLogout when "Выйти" is clicked', () => {
        const { props } = renderModal();

        fireEvent.click(screen.getByRole('button', { name: 'Выйти' }));

        expect(props.onLogout).toHaveBeenCalledTimes(1);
    });

    it('shows the current monthly limit and saves a new value', async () => {
        const { props } = renderModal({ monthlyLimit: 7000 });

        const limitInput = screen.getByRole('spinbutton');
        expect(limitInput).toHaveValue(7000);

        fireEvent.change(limitInput, { target: { value: '8500' } });
        fireEvent.click(screen.getByRole('button', { name: 'Сохранить лимит' }));

        await waitFor(() => {
            expect(props.onSaveSettings).toHaveBeenCalledWith(8500);
        });
    });

    it('rejects a negative limit locally, without calling onSaveSettings', () => {
        const { props } = renderModal();

        const limitInput = screen.getByRole('spinbutton');
        fireEvent.change(limitInput, { target: { value: '-5' } });
        fireEvent.click(screen.getByRole('button', { name: 'Сохранить лимит' }));

        expect(props.onSaveSettings).not.toHaveBeenCalled();
        expect(props.showNotice).toHaveBeenCalled();
    });
});
