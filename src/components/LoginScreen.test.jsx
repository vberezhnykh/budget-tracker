import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import LoginScreen from './LoginScreen';

describe('LoginScreen Component', () => {
    let fetchMock;

    beforeEach(() => {
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('renders a password field and submit button', () => {
        render(<LoginScreen onSuccess={() => { }} />);

        expect(screen.getByLabelText('Пароль')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Войти' })).toBeInTheDocument();
    });

    it('posts the password to /api/login and calls onSuccess on a 200', async () => {
        fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true }) });
        const onSuccess = vi.fn();

        render(<LoginScreen onSuccess={onSuccess} />);

        fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'family-secret' } });
        fireEvent.click(screen.getByRole('button', { name: 'Войти' }));

        await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));

        expect(fetchMock).toHaveBeenCalledWith('/api/login', expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ password: 'family-secret' })
        }));
    });

    it('shows the server error message and does not call onSuccess on a wrong password (401)', async () => {
        fetchMock.mockResolvedValue({
            ok: false,
            json: () => Promise.resolve({ message: 'Неверный пароль' })
        });
        const onSuccess = vi.fn();

        render(<LoginScreen onSuccess={onSuccess} />);

        fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'wrong' } });
        fireEvent.click(screen.getByRole('button', { name: 'Войти' }));

        await waitFor(() => {
            expect(screen.getByRole('alert')).toHaveTextContent('Неверный пароль');
        });
        expect(onSuccess).not.toHaveBeenCalled();
    });

    it('shows a connection error and does not call onSuccess when the request throws', async () => {
        fetchMock.mockRejectedValue(new Error('network down'));
        const onSuccess = vi.fn();

        render(<LoginScreen onSuccess={onSuccess} />);

        fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'anything' } });
        fireEvent.click(screen.getByRole('button', { name: 'Войти' }));

        await waitFor(() => {
            expect(screen.getByRole('alert')).toBeInTheDocument();
        });
        expect(onSuccess).not.toHaveBeenCalled();
    });

    it('shows the app name and the plain subtitle on a first visit', () => {
        render(<LoginScreen onSuccess={() => { }} />);

        expect(screen.getByRole('heading', { level: 1, name: 'Бюджет' })).toBeInTheDocument();
        expect(screen.getByText('Введите пароль, чтобы продолжить')).toBeInTheDocument();
    });

    it('reassures that the data is in place when the session expired mid-use', () => {
        render(<LoginScreen onSuccess={() => { }} sessionExpired />);

        expect(screen.getByText('Сессия закончилась. Войдите снова, данные на месте.')).toBeInTheDocument();
        expect(screen.queryByText('Введите пароль, чтобы продолжить')).not.toBeInTheDocument();
    });

    it('marks the field invalid with a red border and a described alert line only after an error', async () => {
        fetchMock.mockResolvedValue({ ok: false, json: () => Promise.resolve({ message: 'Неверный пароль' }) });
        render(<LoginScreen onSuccess={() => { }} />);

        const field = screen.getByLabelText('Пароль');
        expect(field).not.toHaveAttribute('aria-invalid');
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();

        fireEvent.change(field, { target: { value: 'wrong' } });
        fireEvent.click(screen.getByRole('button', { name: 'Войти' }));

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('Неверный пароль');
        expect(alert.querySelector('svg')).not.toBeNull();
        expect(field).toHaveAttribute('aria-invalid', 'true');
        expect(field).toHaveAccessibleDescription('Неверный пароль');
        expect(field.style.border).toBe('1.5px solid var(--color-danger)');
    });

    it('clears the error while the next attempt is submitting and says «Вход…»', async () => {
        let finish;
        fetchMock
            .mockResolvedValueOnce({ ok: false, json: () => Promise.resolve({ message: 'Неверный пароль' }) })
            .mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ ok: true, json: () => Promise.resolve({}) }); }));
        const onSuccess = vi.fn();
        render(<LoginScreen onSuccess={onSuccess} />);

        fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'wrong' } });
        fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
        await screen.findByRole('alert');

        fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
        expect(await screen.findByRole('button', { name: 'Вход…' })).toBeDisabled();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(screen.getByLabelText('Пароль')).not.toHaveAttribute('aria-invalid');

        finish();
        await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    });

    it('reports a connection failure as an alert line too', async () => {
        fetchMock.mockRejectedValue(new Error('network down'));
        vi.spyOn(console, 'error').mockImplementation(() => { });
        render(<LoginScreen onSuccess={() => { }} />);

        fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'anything' } });
        fireEvent.click(screen.getByRole('button', { name: 'Войти' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось подключиться к серверу');
        console.error.mockRestore();
    });

    it('does not submit when the password field is empty', () => {
        render(<LoginScreen onSuccess={() => { }} />);

        fireEvent.click(screen.getByRole('button', { name: 'Войти' }));

        expect(fetchMock).not.toHaveBeenCalled();
    });
});
