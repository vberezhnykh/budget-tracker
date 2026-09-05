const CLIENT_ERROR_URL = '/api/client-errors';
const ALLOWED_CODES = new Set(['react_render', 'unhandled_rejection']);
const reportedCodes = new Set();

// Reports only a fixed event code and area. Error objects, messages, stacks,
// URLs and application data never enter the payload. Each code is sent at
// most once per page lifetime to avoid a failing render/rejection loop from
// becoming its own traffic incident.
export function reportClientError(code, fetchImpl = fetch) {
    if (!ALLOWED_CODES.has(code) || reportedCodes.has(code)) return;
    reportedCodes.add(code);

    try {
        Promise.resolve(fetchImpl(CLIENT_ERROR_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, area: 'app' }),
            keepalive: true,
        })).catch(() => {});
    } catch {
        // Reporting must never trigger another application error.
    }
}

export function installUnhandledRejectionReporter(target = window) {
    const handleRejection = () => reportClientError('unhandled_rejection');
    target.addEventListener('unhandledrejection', handleRejection);
    return () => target.removeEventListener('unhandledrejection', handleRejection);
}

export function resetClientErrorReporterForTests() {
    reportedCodes.clear();
}
