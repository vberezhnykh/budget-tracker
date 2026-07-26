import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    createToken,
    verifyToken,
    checkPassword,
    getAuthConfig,
    buildHealthPayload,
    createAuthMiddleware,
    isLoginRateLimited,
    recordLoginFailure,
    recordLoginSuccess,
    resetLoginRateLimiter,
    LOGIN_MAX_ATTEMPTS
} from './auth.js';

// Fixture values that satisfy the strength requirements in getAuthConfig
// (APP_PASSWORD >= 12 chars, SESSION_SECRET >= 32 chars) - used whenever a
// test needs both vars to actually count as "configured".
const STRONG_APP_PASSWORD = 'x'.repeat(12);
const STRONG_SESSION_SECRET = 'y'.repeat(32);

describe('createToken / verifyToken', () => {
    it('a freshly created token verifies against the same secret and password', () => {
        const token = createToken('correct-secret', 'correct-password');
        expect(verifyToken(token, 'correct-secret', 'correct-password')).toBe(true);
    });

    it('rejects a token verified against the wrong secret (tampered/foreign signature)', () => {
        const token = createToken('correct-secret', 'correct-password');
        expect(verifyToken(token, 'wrong-secret', 'correct-password')).toBe(false);
    });

    it('rejects a token whose payload was tampered with (signature no longer matches)', () => {
        const token = createToken('correct-secret', 'correct-password');
        const [payload] = token.split('.');
        // Flip the payload but keep the original signature - the classic
        // "change the claims, keep the old signature" tamper attempt.
        const tamperedPayload = Buffer.from(JSON.stringify({ exp: Date.now() + 1e12, pwf: 'a'.repeat(16) })).toString('base64url');
        const tamperedToken = `${tamperedPayload}.${token.slice(payload.length + 1)}`;
        expect(verifyToken(tamperedToken, 'correct-secret', 'correct-password')).toBe(false);
    });

    it('rejects a token whose signature was tampered with directly', () => {
        const token = createToken('correct-secret', 'correct-password');
        const [payload, signature] = token.split('.');
        const flippedChar = signature[0] === 'a' ? 'b' : 'a';
        const tamperedSignature = flippedChar + signature.slice(1);
        expect(verifyToken(`${payload}.${tamperedSignature}`, 'correct-secret', 'correct-password')).toBe(false);
    });

    it('rejects an expired token', () => {
        // ttlMs negative => exp is already in the past.
        const token = createToken('correct-secret', 'correct-password', -1000);
        expect(verifyToken(token, 'correct-secret', 'correct-password')).toBe(false);
    });

    it('accepts a token right up to its expiry and rejects it just after', () => {
        const shortLived = createToken('correct-secret', 'correct-password', 50);
        expect(verifyToken(shortLived, 'correct-secret', 'correct-password')).toBe(true);
    });

    it('rejects malformed tokens', () => {
        expect(verifyToken('', 'secret', 'password')).toBe(false);
        expect(verifyToken(undefined, 'secret', 'password')).toBe(false);
        expect(verifyToken('no-dot-in-here', 'secret', 'password')).toBe(false);
        expect(verifyToken('.', 'secret', 'password')).toBe(false);
    });

    // Finding 4: tokens are bound to the APP_PASSWORD active at issue time,
    // so changing the password invalidates every outstanding session even
    // though there is no server-side session store to revoke them from.
    describe('password binding (finding 4)', () => {
        it('a token signed under one APP_PASSWORD fails verification after the password changes', () => {
            const token = createToken('correct-secret', 'old-password');
            expect(verifyToken(token, 'correct-secret', 'old-password')).toBe(true);
            expect(verifyToken(token, 'correct-secret', 'new-password')).toBe(false);
        });

        it('never embeds the password itself (or a substring of it) in the token', () => {
            const password = 'a-very-recognizable-password-string';
            const token = createToken('correct-secret', password);
            const [payloadB64] = token.split('.');
            const decoded = Buffer.from(payloadB64, 'base64url').toString('utf8');
            expect(decoded).not.toContain(password);
            // Not just the whole string - no meaningfully long substring of
            // it should appear in the decoded payload either.
            expect(decoded).not.toContain(password.slice(0, 10));
        });
    });
});

describe('checkPassword', () => {
    it('accepts a matching password', () => {
        expect(checkPassword('hunter2', 'hunter2')).toBe(true);
    });

    it('rejects a non-matching password', () => {
        expect(checkPassword('hunter2', 'hunter3')).toBe(false);
    });

    it('rejects empty/missing candidates without throwing', () => {
        expect(checkPassword('', 'hunter2')).toBe(false);
        expect(checkPassword(undefined, 'hunter2')).toBe(false);
    });

    it('handles candidate/expected of different lengths safely', () => {
        expect(checkPassword('short', 'a-much-longer-password-string')).toBe(false);
    });
});

describe('getAuthConfig', () => {
    const ORIGINAL_ENV = { ...process.env };

    afterEach(() => {
        process.env = { ...ORIGINAL_ENV };
    });

    it('reports isConfigured true when both vars are set and strong enough', () => {
        process.env.APP_PASSWORD = STRONG_APP_PASSWORD;
        process.env.SESSION_SECRET = STRONG_SESSION_SECRET;
        const config = getAuthConfig();
        expect(config.isConfigured).toBe(true);
        expect(config.missing).toEqual([]);
        expect(config.weak).toEqual([]);
    });

    it('reports isConfigured false and names each missing var', () => {
        delete process.env.APP_PASSWORD;
        delete process.env.SESSION_SECRET;
        const config = getAuthConfig();
        expect(config.isConfigured).toBe(false);
        expect(config.missing).toEqual(['APP_PASSWORD', 'SESSION_SECRET']);
    });

    it('reports only the one var that is missing', () => {
        process.env.APP_PASSWORD = STRONG_APP_PASSWORD;
        delete process.env.SESSION_SECRET;
        const config = getAuthConfig();
        expect(config.isConfigured).toBe(false);
        expect(config.missing).toEqual(['SESSION_SECRET']);
    });

    // Finding 3: a present-but-weak value must not count as configured.
    describe('strength validation', () => {
        it('treats an APP_PASSWORD shorter than 12 characters as unconfigured (weak, not missing)', () => {
            process.env.APP_PASSWORD = 'short-pw123'; // 11 chars
            process.env.SESSION_SECRET = STRONG_SESSION_SECRET;
            const config = getAuthConfig();
            expect(config.isConfigured).toBe(false);
            expect(config.missing).toEqual([]);
            expect(config.weak).toEqual(['APP_PASSWORD']);
        });

        it('treats a SESSION_SECRET shorter than 32 characters as unconfigured (weak, not missing)', () => {
            process.env.APP_PASSWORD = STRONG_APP_PASSWORD;
            process.env.SESSION_SECRET = 'y'.repeat(31);
            const config = getAuthConfig();
            expect(config.isConfigured).toBe(false);
            expect(config.missing).toEqual([]);
            expect(config.weak).toEqual(['SESSION_SECRET']);
        });

        it('treats a whitespace-only APP_PASSWORD as weak even if it is long enough', () => {
            process.env.APP_PASSWORD = ' '.repeat(20);
            process.env.SESSION_SECRET = STRONG_SESSION_SECRET;
            const config = getAuthConfig();
            expect(config.isConfigured).toBe(false);
            expect(config.weak).toEqual(['APP_PASSWORD']);
        });

        it('accepts a password/secret exactly at the minimum length', () => {
            process.env.APP_PASSWORD = 'x'.repeat(12);
            process.env.SESSION_SECRET = 'y'.repeat(32);
            const config = getAuthConfig();
            expect(config.isConfigured).toBe(true);
        });
    });
});

describe('buildHealthPayload', () => {
    const ORIGINAL_ENV = { ...process.env };

    afterEach(() => {
        process.env = { ...ORIGINAL_ENV };
    });

    it('reports configured: true when both vars are set', () => {
        process.env.APP_PASSWORD = STRONG_APP_PASSWORD;
        process.env.SESSION_SECRET = STRONG_SESSION_SECRET;
        const payload = buildHealthPayload();
        expect(payload.status).toBe('ok');
        expect(payload.configured).toBe(true);
    });

    it('reports configured: false when neither var is set', () => {
        delete process.env.APP_PASSWORD;
        delete process.env.SESSION_SECRET;
        const payload = buildHealthPayload();
        expect(payload.configured).toBe(false);
    });

    it('reports configured: false when only SESSION_SECRET is set', () => {
        delete process.env.APP_PASSWORD;
        process.env.SESSION_SECRET = STRONG_SESSION_SECRET;
        const payload = buildHealthPayload();
        expect(payload.configured).toBe(false);
    });

    it('reports configured: false when only APP_PASSWORD is set', () => {
        process.env.APP_PASSWORD = STRONG_APP_PASSWORD;
        delete process.env.SESSION_SECRET;
        const payload = buildHealthPayload();
        expect(payload.configured).toBe(false);
    });

    it('never includes the actual values, only variable names', () => {
        process.env.APP_PASSWORD = 'super-secret-password';
        process.env.SESSION_SECRET = 'super-secret-key';
        const payload = buildHealthPayload();
        const serialized = JSON.stringify(payload);
        expect(serialized).not.toContain('super-secret-password');
        expect(serialized).not.toContain('super-secret-key');
    });
});

describe('createAuthMiddleware - fails closed', () => {
    const ORIGINAL_ENV = { ...process.env };

    beforeEach(() => {
        delete process.env.APP_PASSWORD;
        delete process.env.SESSION_SECRET;
    });

    afterEach(() => {
        process.env = { ...ORIGINAL_ENV };
    });

    function makeReqRes(path, ip) {
        const req = { path, cookies: {}, ip };
        const res = {
            statusCode: null,
            body: null,
            status(code) { this.statusCode = code; return this; },
            json(payload) { this.body = payload; return this; }
        };
        return { req, res };
    }

    it('missing config, AUTH_DISABLED unset => 503 on a protected route, next() not called', () => {
        const middleware = createAuthMiddleware(false);
        const { req, res } = makeReqRes('/api/transactions', '203.0.113.7');

        const next = vi.fn();

        middleware(req, res, next);

        expect(res.statusCode).toBe(503);
        expect(res.body.message).toMatch(/не настроен/i);
        expect(next).not.toHaveBeenCalled();
    });

    it('missing config => login route excluded from this middleware regardless of the bypass flag (the route handler itself performs the 503 check)', () => {
        const middleware = createAuthMiddleware(false);
        const { req, res } = makeReqRes('/api/login');
        const next = vi.fn();

        middleware(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.statusCode).toBeNull();
    });

    it('/api/health is always excluded, configured or not', () => {
        const middleware = createAuthMiddleware(false);
        const { req, res } = makeReqRes('/api/health');
        const next = vi.fn();

        middleware(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.statusCode).toBeNull();
    });

    it('non-API paths are never touched by the middleware', () => {
        const middleware = createAuthMiddleware(false);
        const { req, res } = makeReqRes('/assets/index.js');
        const next = vi.fn();

        middleware(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.statusCode).toBeNull();
    });

    // Finding 1: the old behavior treated "NODE_ENV !== 'production'" as
    // implicit permission to fail open. That's gone - the only way through
    // an unconfigured server now is the explicit AUTH_DISABLED=true flag,
    // and only from a loopback address.
    describe('AUTH_DISABLED bypass (finding 1)', () => {
        it('bypass refused when AUTH_DISABLED is unset (false/undefined), even from a loopback IP - regardless of what NODE_ENV would have been', () => {
            for (const authDisabled of [false, undefined]) {
                for (const ip of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
                    const middleware = createAuthMiddleware(authDisabled);
                    const { req, res } = makeReqRes('/api/transactions', ip);
                    const next = vi.fn();

                    middleware(req, res, next);

                    expect(res.statusCode).toBe(503);
                    expect(next).not.toHaveBeenCalled();
                }
            }
        });

        it('bypass allowed when AUTH_DISABLED=true and the request is from a loopback address', () => {
            for (const ip of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
                const middleware = createAuthMiddleware(true);
                const { req, res } = makeReqRes('/api/transactions', ip);
                const next = vi.fn();

                middleware(req, res, next);

                expect(next).toHaveBeenCalledTimes(1);
                expect(res.statusCode).toBeNull();
            }
        });

        it('bypass refused for a non-loopback IP even when AUTH_DISABLED=true - a remotely reachable deployment must never be able to opt into open access', () => {
            const middleware = createAuthMiddleware(true);
            const { req, res } = makeReqRes('/api/transactions', '203.0.113.7');
            const next = vi.fn();

            middleware(req, res, next);

            expect(res.statusCode).toBe(503);
            expect(next).not.toHaveBeenCalled();
        });

        it('bypass refused when AUTH_DISABLED=true but req.ip is missing/unknown', () => {
            const middleware = createAuthMiddleware(true);
            const { req, res } = makeReqRes('/api/transactions', undefined);
            const next = vi.fn();

            middleware(req, res, next);

            expect(res.statusCode).toBe(503);
            expect(next).not.toHaveBeenCalled();
        });
    });
});

describe('createAuthMiddleware - configured', () => {
    const ORIGINAL_ENV = { ...process.env };

    beforeEach(() => {
        process.env.APP_PASSWORD = STRONG_APP_PASSWORD;
        process.env.SESSION_SECRET = STRONG_SESSION_SECRET;
    });

    afterEach(() => {
        process.env = { ...ORIGINAL_ENV };
    });

    function makeReqRes(path, cookies = {}) {
        const req = { path, cookies };
        const res = {
            statusCode: null,
            body: null,
            status(code) { this.statusCode = code; return this; },
            json(payload) { this.body = payload; return this; }
        };
        return { req, res };
    }

    it('rejects a request with no session cookie', () => {
        const middleware = createAuthMiddleware(true);
        const { req, res } = makeReqRes('/api/transactions');
        const next = vi.fn();

        middleware(req, res, next);

        expect(res.statusCode).toBe(401);
        expect(next).not.toHaveBeenCalled();
    });

    it('rejects a request with an invalid session cookie', () => {
        const middleware = createAuthMiddleware(true);
        const { req, res } = makeReqRes('/api/transactions', { session: 'garbage.value' });
        const next = vi.fn();

        middleware(req, res, next);

        expect(res.statusCode).toBe(401);
        expect(next).not.toHaveBeenCalled();
    });

    it('allows a request with a valid session cookie', () => {
        const token = createToken(STRONG_SESSION_SECRET, STRONG_APP_PASSWORD);
        const middleware = createAuthMiddleware(true);
        const { req, res } = makeReqRes('/api/transactions', { session: token });
        const next = vi.fn();

        middleware(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.statusCode).toBeNull();
    });

    // Express's routing is case-insensitive by default (case sensitive
    // routing is off unless explicitly enabled), so a route registered as
    // '/api/transactions' also serves 'GET /API/transactions'. The
    // middleware must recognize any casing of the '/api/' prefix and gate
    // it exactly like the lowercase path - otherwise varying the request
    // casing bypasses auth entirely, since the request would fail the
    // prefix check, fall through to next(), and reach the route unchecked.
    it('rejects an uppercase-prefixed path (/API/transactions) with no session cookie, same as lowercase', () => {
        const middleware = createAuthMiddleware(true);
        const { req, res } = makeReqRes('/API/transactions');
        const next = vi.fn();

        middleware(req, res, next);

        expect(res.statusCode).toBe(401);
        expect(next).not.toHaveBeenCalled();
    });

    it('rejects a mixed-case path (/Api/Transactions) with no session cookie, same as lowercase', () => {
        const middleware = createAuthMiddleware(true);
        const { req, res } = makeReqRes('/Api/Transactions');
        const next = vi.fn();

        middleware(req, res, next);

        expect(res.statusCode).toBe(401);
        expect(next).not.toHaveBeenCalled();
    });

    it('rejects an uppercase-prefixed path even with a valid session cookie is not required for the bypass - a missing/invalid cookie alone still 401s', () => {
        const middleware = createAuthMiddleware(true);
        const { req, res } = makeReqRes('/API/transactions', { session: 'garbage.value' });
        const next = vi.fn();

        middleware(req, res, next);

        expect(res.statusCode).toBe(401);
        expect(next).not.toHaveBeenCalled();
    });

    it('allows an uppercase-prefixed path (/API/transactions) with a valid session cookie', () => {
        const token = createToken(STRONG_SESSION_SECRET, STRONG_APP_PASSWORD);
        const middleware = createAuthMiddleware(true);
        const { req, res } = makeReqRes('/API/transactions', { session: token });
        const next = vi.fn();

        middleware(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.statusCode).toBeNull();
    });

    it('/API/HEALTH is still excluded regardless of casing (case-insensitive routing means this spelling reaches the route)', () => {
        const middleware = createAuthMiddleware(true);
        const { req, res } = makeReqRes('/API/HEALTH');
        const next = vi.fn();

        middleware(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.statusCode).toBeNull();
    });

    it('/API/LOGIN is still excluded regardless of casing (case-insensitive routing means this spelling reaches the route)', () => {
        const middleware = createAuthMiddleware(true);
        const { req, res } = makeReqRes('/API/LOGIN');
        const next = vi.fn();

        middleware(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.statusCode).toBeNull();
    });

    // Finding 4: changing APP_PASSWORD must invalidate every outstanding
    // session, since there's no server-side session store to revoke tokens
    // from individually.
    it('a session cookie signed under the old APP_PASSWORD is rejected once APP_PASSWORD changes', () => {
        const token = createToken(STRONG_SESSION_SECRET, STRONG_APP_PASSWORD);
        const middleware = createAuthMiddleware(true);

        // Confirm it's valid before the change, then rotate the password.
        const before = makeReqRes('/api/transactions', { session: token });
        middleware(before.req, before.res, vi.fn());
        expect(before.res.statusCode).toBeNull();

        process.env.APP_PASSWORD = 'a-completely-different-password';
        const after = makeReqRes('/api/transactions', { session: token });
        const next = vi.fn();
        middleware(after.req, after.res, next);

        expect(after.res.statusCode).toBe(401);
        expect(next).not.toHaveBeenCalled();
    });
});

// Finding 2: POST /api/login has no throttling on its own, so the limiter
// lives in server/auth.js as pure, exported, directly testable functions
// rather than logic buried in the route closure.
describe('login rate limiter (finding 2)', () => {
    beforeEach(() => {
        resetLoginRateLimiter();
    });

    afterEach(() => {
        resetLoginRateLimiter();
    });

    it('is not locked out before any failures are recorded', () => {
        expect(isLoginRateLimited('198.51.100.1')).toBe(false);
    });

    it('locks out after reaching the failure threshold within the window', () => {
        const ip = '198.51.100.2';
        for (let i = 0; i < LOGIN_MAX_ATTEMPTS - 1; i++) {
            recordLoginFailure(ip);
            expect(isLoginRateLimited(ip)).toBe(false);
        }
        recordLoginFailure(ip); // this is the LOGIN_MAX_ATTEMPTS-th failure
        expect(isLoginRateLimited(ip)).toBe(true);
    });

    it('tracks each IP independently', () => {
        const ipA = '198.51.100.3';
        const ipB = '198.51.100.4';
        for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i++) recordLoginFailure(ipA);
        expect(isLoginRateLimited(ipA)).toBe(true);
        expect(isLoginRateLimited(ipB)).toBe(false);
    });

    it('a successful login resets that IP\'s counter immediately', () => {
        const ip = '198.51.100.5';
        for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i++) recordLoginFailure(ip);
        expect(isLoginRateLimited(ip)).toBe(true);

        recordLoginSuccess(ip);
        expect(isLoginRateLimited(ip)).toBe(false);

        // And the failure count actually starts over, not just "unlocked" -
        // it takes a full new run of failures to lock out again.
        for (let i = 0; i < LOGIN_MAX_ATTEMPTS - 1; i++) recordLoginFailure(ip);
        expect(isLoginRateLimited(ip)).toBe(false);
    });

    it('lockout expires once the window has elapsed', () => {
        const ip = '198.51.100.6';
        const start = Date.now();
        for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i++) recordLoginFailure(ip, start);
        expect(isLoginRateLimited(ip, start)).toBe(true);

        const wellAfterWindow = start + 16 * 60 * 1000; // window is 15 minutes
        expect(isLoginRateLimited(ip, wellAfterWindow)).toBe(false);
    });
});
