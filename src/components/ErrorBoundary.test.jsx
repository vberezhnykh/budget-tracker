import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import ErrorBoundary from './ErrorBoundary';

function Bomb() {
    throw new Error('boom');
}

describe('ErrorBoundary Component', () => {
    beforeEach(() => {
        // React (and this component's own componentDidCatch) log the caught
        // error to the console - expected here, so silence it rather than
        // letting the test suite print a scary-looking error for a passing test.
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        console.error.mockRestore();
    });

    it('renders children normally when nothing throws', () => {
        render(
            <ErrorBoundary>
                <div>All good</div>
            </ErrorBoundary>
        );

        expect(screen.getByText('All good')).toBeInTheDocument();
    });

    it('renders the Russian fallback instead of propagating when a child throws', () => {
        render(
            <ErrorBoundary>
                <Bomb />
            </ErrorBoundary>
        );

        expect(screen.getByText('Что-то пошло не так')).toBeInTheDocument();
        expect(screen.queryByText('All good')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Перезагрузить' })).toBeInTheDocument();
    });

    it('logs the error and component stack via console.error', () => {
        render(
            <ErrorBoundary>
                <Bomb />
            </ErrorBoundary>
        );

        expect(console.error).toHaveBeenCalled();
    });

    it('reloads the page when the reload button is clicked', () => {
        const reloadSpy = vi.fn();
        const originalLocation = window.location;
        Object.defineProperty(window, 'location', {
            configurable: true,
            value: { ...originalLocation, reload: reloadSpy },
        });

        render(
            <ErrorBoundary>
                <Bomb />
            </ErrorBoundary>
        );

        screen.getByRole('button', { name: 'Перезагрузить' }).click();
        expect(reloadSpy).toHaveBeenCalledTimes(1);

        Object.defineProperty(window, 'location', {
            configurable: true,
            value: originalLocation,
        });
    });
});
