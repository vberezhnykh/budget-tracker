import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    installUnhandledRejectionReporter,
    reportClientError,
    resetClientErrorReporterForTests,
} from './clientErrorReporter';

describe('clientErrorReporter', () => {
    afterEach(() => resetClientErrorReporterForTests());

    it('sends only the fixed allowlisted payload and deduplicates each code', () => {
        const fetchImpl = vi.fn().mockResolvedValue({ ok: true });

        reportClientError('react_render', fetchImpl);
        reportClientError('react_render', fetchImpl);
        reportClientError('not_allowed', fetchImpl);

        expect(fetchImpl).toHaveBeenCalledTimes(1);
        const [url, options] = fetchImpl.mock.calls[0];
        expect(url).toBe('/api/client-errors');
        expect(JSON.parse(options.body)).toEqual({ code: 'react_render', area: 'app' });
        expect(options).not.toHaveProperty('credentials');
        expect(options.keepalive).toBe(true);
    });

    it('reports an unhandled rejection without reading its reason', () => {
        const listeners = {};
        const target = {
            addEventListener: vi.fn((name, listener) => { listeners[name] = listener; }),
            removeEventListener: vi.fn(),
        };
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true });
        const uninstall = installUnhandledRejectionReporter(target);

        listeners.unhandledrejection({ reason: new Error('private details') });

        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ code: 'unhandled_rejection', area: 'app' });
        uninstall();
        expect(target.removeEventListener).toHaveBeenCalledWith('unhandledrejection', listeners.unhandledrejection);
        fetchMock.mockRestore();
    });
});
