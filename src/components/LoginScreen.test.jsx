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

    it('does not submit when the password field is empty', () => {
        render(<LoginScreen onSuccess={() => { }} />);

        fireEvent.click(screen.getByRole('button', { name: 'Войти' }));

        expect(fetchMock).not.toHaveBeenCalled();
    });
});
