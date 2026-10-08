import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import AccountEditSheet from './AccountEditSheet';

const existing = { _id: 'deposit', name: 'Залог', type: 'card', icon: '🏠', excludeFromTotal: true };

function renderSheet(account = null, overrides = {}) {
    const props = {
        account,
        onClose: vi.fn(),
        onSave: vi.fn().mockResolvedValue(true),
        onDelete: vi.fn().mockResolvedValue(true),
        ...overrides,
    };
    render(<AccountEditSheet {...props} />);
    return props;
}

const nameField = () => screen.getByLabelText('Название');
// Подписи значков совпадают с названиями типов («Карта», «Наличные»), поэтому
// кнопки ищутся внутри своей группы.
const typeGroup = () => screen.getByRole('group', { name: 'Тип счёта' });
const iconGroup = () => screen.getByRole('group', { name: 'Значок' });
const saveButton = () => screen.getByRole('button', { name: /^Сохранени|^Сохранить$/ });

describe('AccountEditSheet', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('new account', () => {
        it('titles the sheet «Новый счёт», focuses the name and offers a type switch', () => {
            renderSheet();

            expect(screen.getByRole('dialog', { name: 'Новый счёт' })).toBeInTheDocument();
            expect(screen.getByRole('heading', { name: 'Новый счёт' })).toBeInTheDocument();
            expect(nameField()).toHaveFocus();
            expect(within(typeGroup()).getByRole('button', { name: 'Карта', pressed: true })).toBeInTheDocument();
            expect(within(typeGroup()).getByRole('button', { name: 'Наличные', pressed: false })).toBeInTheDocument();
            expect(screen.queryByText('задаётся при создании')).not.toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'Удалить счёт' })).not.toBeInTheDocument();
        });

        it('keeps «Сохранить» disabled while the name is blank', () => {
            renderSheet();

            expect(saveButton()).toBeDisabled();
            fireEvent.change(nameField(), { target: { value: '   ' } });
            expect(saveButton()).toBeDisabled();
            fireEvent.change(nameField(), { target: { value: 'Revolut' } });
            expect(saveButton()).toBeEnabled();
        });

        it('saves the defaults: card, credit-card icon, counted in the total', async () => {
            const props = renderSheet();

            fireEvent.change(nameField(), { target: { value: 'Revolut' } });
            fireEvent.click(saveButton());

            await waitFor(() => {
                expect(props.onSave).toHaveBeenCalledWith({
                    name: 'Revolut',
                    type: 'card',
                    icon: 'credit-card',
                    excludeFromTotal: false,
                    editingAccountId: null,
                });
            });
        });

        it('switches the default icon with the type and saves the chosen type', async () => {
            const props = renderSheet();

            fireEvent.click(within(typeGroup()).getByRole('button', { name: 'Наличные' }));
            expect(within(typeGroup()).getByRole('button', { name: 'Наличные', pressed: true })).toBeInTheDocument();
            expect(within(iconGroup()).getByRole('button', { name: 'Наличные' })).toHaveAttribute('aria-pressed', 'true');
            fireEvent.change(nameField(), { target: { value: 'Копилка дома' } });
            fireEvent.click(saveButton());

            await waitFor(() => {
                expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({ type: 'cash', icon: 'banknote' }));
            });
        });
    });

    describe('icon grid and switch', () => {
        it('marks the selected icon with aria-pressed and does not submit on selection', async () => {
            const props = renderSheet();
            const group = iconGroup();

            expect(group.querySelectorAll('button')).toHaveLength(10);
            expect(within(group).getByRole('button', { name: 'Карта', pressed: true })).toBeInTheDocument();

            fireEvent.click(within(group).getByRole('button', { name: 'Копилка' }));

            expect(within(group).getByRole('button', { name: 'Копилка' })).toHaveAttribute('aria-pressed', 'true');
            expect(within(group).getByRole('button', { name: 'Карта', pressed: false })).toBeInTheDocument();
            expect(props.onSave).not.toHaveBeenCalled();

            fireEvent.change(nameField(), { target: { value: 'На отпуск' } });
            fireEvent.click(saveButton());
            await waitFor(() => expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({ icon: 'piggy-bank' })));
        });

        it('toggles «Не учитывать в общем капитале» and describes it', async () => {
            const props = renderSheet();
            const toggle = screen.getByRole('switch', { name: 'Не учитывать в общем капитале' });

            expect(toggle).toHaveAttribute('aria-checked', 'false');
            expect(screen.getByText('Для залогов и вкладов: баланс виден, но в итог не входит')).toBeInTheDocument();

            fireEvent.click(toggle);
            expect(toggle).toHaveAttribute('aria-checked', 'true');

            fireEvent.change(nameField(), { target: { value: 'Вклад' } });
            fireEvent.click(saveButton());
            await waitFor(() => expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({ excludeFromTotal: true })));
        });
    });

    describe('saving', () => {
        it('closes the sheet only after onSave resolves true', async () => {
            let resolveSave;
            const onSave = vi.fn(() => new Promise(resolve => { resolveSave = resolve; }));
            const props = renderSheet(null, { onSave });

            fireEvent.change(nameField(), { target: { value: 'Новый' } });
            fireEvent.click(saveButton());

            const pending = await screen.findByRole('button', { name: 'Сохранение…' });
            expect(pending).toBeDisabled();
            expect(props.onClose).not.toHaveBeenCalled();

            resolveSave(true);
            await waitFor(() => expect(props.onClose).toHaveBeenCalledTimes(1));
        });

        it('stays open with the entered values when onSave resolves false', async () => {
            const props = renderSheet(null, { onSave: vi.fn().mockResolvedValue(false) });

            fireEvent.change(nameField(), { target: { value: 'Плохой' } });
            fireEvent.click(saveButton());

            await waitFor(() => expect(props.onSave).toHaveBeenCalled());
            await waitFor(() => expect(saveButton()).toBeEnabled());
            expect(props.onClose).not.toHaveBeenCalled();
            expect(nameField()).toHaveValue('Плохой');
        });

        it('sends a single request while the first one is pending', async () => {
            const onSave = vi.fn(() => new Promise(() => { }));
            renderSheet(null, { onSave });

            fireEvent.change(nameField(), { target: { value: 'Новый' } });
            fireEvent.submit(nameField().closest('form'));
            fireEvent.submit(nameField().closest('form'));

            expect(onSave).toHaveBeenCalledTimes(1);
        });

        it('closes from the ✕ button', () => {
            const props = renderSheet();

            fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));

            expect(props.onClose).toHaveBeenCalledTimes(1);
        });
    });

    describe('existing account', () => {
        it('titles the sheet «Счёт», fills the form and shows the type as a read-only row', () => {
            renderSheet(existing);

            expect(screen.getByRole('dialog', { name: 'Счёт' })).toBeInTheDocument();
            expect(nameField()).toHaveValue('Залог');
            expect(screen.getByText('задаётся при создании')).toBeInTheDocument();
            expect(screen.queryByRole('group', { name: 'Тип счёта' })).not.toBeInTheDocument();
            expect(screen.getByRole('switch', { name: 'Не учитывать в общем капитале' })).toHaveAttribute('aria-checked', 'true');
        });

        it('normalizes the legacy emoji icon and saves with the account id', async () => {
            const props = renderSheet(existing);

            expect(within(iconGroup()).getByRole('button', { name: 'Дом' })).toHaveAttribute('aria-pressed', 'true');
            fireEvent.click(saveButton());

            await waitFor(() => {
                expect(props.onSave).toHaveBeenCalledWith({
                    name: 'Залог',
                    type: 'card',
                    icon: 'house',
                    excludeFromTotal: true,
                    editingAccountId: 'deposit',
                });
            });
        });

        describe('deleting', () => {
            it('asks inline before deleting and does not use window.confirm', () => {
                const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
                const props = renderSheet(existing);

                fireEvent.click(screen.getByRole('button', { name: 'Удалить счёт' }));

                expect(screen.getByRole('alert')).toHaveTextContent('Удалить счёт «Залог»?');
                expect(screen.queryByRole('button', { name: 'Удалить счёт' })).not.toBeInTheDocument();
                expect(props.onDelete).not.toHaveBeenCalled();
                expect(confirm).not.toHaveBeenCalled();
            });

            it('deletes after the confirmation and closes when onDelete resolves true', async () => {
                const confirm = vi.spyOn(window, 'confirm');
                const props = renderSheet(existing);

                fireEvent.click(screen.getByRole('button', { name: 'Удалить счёт' }));
                fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));

                await waitFor(() => expect(props.onDelete).toHaveBeenCalledWith(existing));
                await waitFor(() => expect(props.onClose).toHaveBeenCalledTimes(1));
                expect(confirm).not.toHaveBeenCalled();
            });

            it('keeps the sheet open when onDelete resolves false', async () => {
                const props = renderSheet(existing, { onDelete: vi.fn().mockResolvedValue(false) });

                fireEvent.click(screen.getByRole('button', { name: 'Удалить счёт' }));
                fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));

                await waitFor(() => expect(props.onDelete).toHaveBeenCalled());
                await waitFor(() => expect(screen.getByRole('button', { name: 'Удалить' })).toBeEnabled());
                expect(props.onClose).not.toHaveBeenCalled();
            });

            it('«Отмена» returns to the «Удалить счёт» button without deleting', () => {
                const props = renderSheet(existing);

                fireEvent.click(screen.getByRole('button', { name: 'Удалить счёт' }));
                fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));

                expect(screen.queryByRole('alert')).not.toBeInTheDocument();
                expect(screen.getByRole('button', { name: 'Удалить счёт' })).toBeInTheDocument();
                expect(props.onDelete).not.toHaveBeenCalled();
                expect(props.onClose).not.toHaveBeenCalled();
            });
        });
    });
});
