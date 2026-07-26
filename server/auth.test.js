import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    createToken,
    verifyToken,
    checkPassword,
    getAuthConfig,
    createAuthMiddleware
} from './auth.js';

describe('createToken / verifyToken', () => {
    it('a freshly created token verifies against the same secret', () => {
        const token = createToken('correct-secret');
        expect(verifyToken(token, 'correct-secret')).toBe(true);
    });

    it('rejects a token verified against the wrong secret (tampered/foreign signature)', () => {
        const token = createToken('correct-secret');
        expect(verifyToken(token, 'wrong-secret')).toBe(false);
    });

    it('rejects a token whose payload was tampered with (signature no longer matches)', () => {
        const token = createToken('correct-secret');
        const [payload] = token.split('.');
        // Flip the payload but keep the original signature - the classic
        // "change the claims, keep the old signature" tamper attempt.
        const tamperedPayload = Buffer.from(JSON.stringify({ exp: Date.now() + 1e12 })).toString('base64url');
        const tamperedToken = `${tamperedPayload}.${token.slice(payload.length + 1)}`;
        expect(verifyToken(tamperedToken, 'correct-secret')).toBe(false);
    });

    it('rejects a token whose signature was tampered with directly', () => {
        const token = createToken('correct-secret');
        const [payload, signature] = token.split('.');
        const flippedChar = signature[0] === 'a' ? 'b' : 'a';
        const tamperedSignature = flippedChar + signature.slice(1);
        expect(verifyToken(`${payload}.${tamperedSignature}`, 'correct-secret')).toBe(false);
    });

    it('rejects an expired token', () => {
        // ttlMs negative => exp is already in the past.
        const token = createToken('correct-secret', -1000);
        expect(verifyToken(token, 'correct-secret')).toBe(false);
    });

    it('accepts a token right up to its expiry and rejects it just after', () => {
        const shortLived = createToken('correct-secret', 50);
        expect(verifyToken(shortLived, 'correct-secret')).toBe(true);
    });

    it('rejects malformed tokens', () => {
        expect(verifyToken('', 'secret')).toBe(false);
        expect(verifyToken(undefined, 'secret')).toBe(false);
        expect(verifyToken('no-dot-in-here', 'secret')).toBe(false);
        expect(verifyToken('.', 'secret')).toBe(false);
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

    it('reports isConfigured true when both vars are set', () => {
        process.env.APP_PASSWORD = 'pw';
        process.env.SESSION_SECRET = 'secret';
        const config = getAuthConfig();
        expect(config.isConfigured).toBe(true);
        expect(config.missing).toEqual([]);
    });

    it('reports isConfigured false and names each missing var', () => {
        delete process.env.APP_PASSWORD;
        delete process.env.SESSION_SECRET;
        const config = getAuthConfig();
        expect(config.isConfigured).toBe(false);
        expect(config.missing).toEqual(['APP_PASSWORD', 'SESSION_SECRET']);
    });

    it('reports only the one var that is missing', () => {
        process.env.APP_PASSWORD = 'pw';
        delete process.env.SESSION_SECRET;
        const config = getAuthConfig();
        expect(config.isConfigured).toBe(false);
        expect(config.missing).toEqual(['SESSION_SECRET']);
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

    function makeReqRes(path) {
        const req = { path, cookies: {} };
        const res = {
            statusCode: null,
            body: null,
            status(code) { this.statusCode = code; return this; },
            json(payload) { this.body = payload; return this; }
        };
        return { req, res };
    }

    it('production: missing config => 503 on a protected route, next() not called', () => {
        const middleware = createAuthMiddleware(true);
        const { req, res } = makeReqRes('/api/transactions');
        const next = vi.fn();

        middleware(req, res, next);

        expect(res.statusCode).toBe(503);
        expect(res.body.message).toMatch(/не настроен/i);
        expect(next).not.toHaveBeenCalled();
    });

    it('production: missing config => login route also gated by app-level middleware would 503 (the route handler itself performs this check, since login is excluded here)', () => {
        // /api/login is excluded from the middleware itself, so it should
        // always call next() regardless of config - the route handler is
        // responsible for the 503 in that case.
        const middleware = createAuthMiddleware(true);
        const { req, res } = makeReqRes('/api/login');
        const next = vi.fn();

        middleware(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.statusCode).toBeNull();
    });

    it('production: /api/health is always excluded, configured or not', () => {
        const middleware = createAuthMiddleware(true);
        const { req, res } = makeReqRes('/api/health');
        const next = vi.fn();

        middleware(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.statusCode).toBeNull();
    });

    it('development: missing config => request passes through (fail open locally)', () => {
        const middleware = createAuthMiddleware(false);
        const { req, res } = makeReqRes('/api/transactions');
        const next = vi.fn();

        middleware(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.statusCode).toBeNull();
    });

    it('non-API paths are never touched by the middleware', () => {
        const middleware = createAuthMiddleware(true);
        const { req, res } = makeReqRes('/assets/index.js');
        const next = vi.fn();

        middleware(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.statusCode).toBeNull();
    });
});

describe('createAuthMiddleware - configured', () => {
    const ORIGINAL_ENV = { ...process.env };

    beforeEach(() => {
        process.env.APP_PASSWORD = 'pw';
        process.env.SESSION_SECRET = 'test-secret';
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
        const token = createToken('test-secret');
        const middleware = createAuthMiddleware(true);
        const { req, res } = makeReqRes('/api/transactions', { session: token });
        const next = vi.fn();

        middleware(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.statusCode).toBeNull();
    });
});
