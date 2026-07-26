// Shared-password authentication for the family budget tracker.
//
// This app has exactly one login (a shared password for two people), so a
// full user-account system is not warranted. Instead:
//   - POST /api/login checks the submitted password against APP_PASSWORD and,
//     on success, sets an httpOnly cookie carrying a signed, expiring token.
//   - Every other /api/* route (except /api/login and /api/health) requires
//     that cookie to be present and valid.
//
// The pure pieces (token sign/verify, password check, config detection) live
// here rather than inside route closures so they can be unit tested directly.

const crypto = require('crypto');

const COOKIE_NAME = 'session';
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Constant-time string comparison. Both inputs are hashed with sha256 first
// so the buffers handed to timingSafeEqual are always the same length
// (32 bytes) regardless of the length of the original strings - this is the
// only way to keep the comparison itself constant-time while still allowing
// arbitrary-length, attacker-controlled input on one side.
function safeStringsEqual(a, b) {
    const hashA = crypto.createHash('sha256').update(String(a)).digest();
    const hashB = crypto.createHash('sha256').update(String(b)).digest();
    return crypto.timingSafeEqual(hashA, hashB);
}

// Compares a submitted password against the configured shared password.
function checkPassword(candidate, expected) {
    if (typeof candidate !== 'string' || !candidate) return false;
    if (typeof expected !== 'string' || !expected) return false;
    return safeStringsEqual(candidate, expected);
}

function hmac(secret, value) {
    return crypto.createHmac('sha256', secret).update(value).digest('hex');
}

// Creates a signed token: base64url(JSON payload with an expiry) + '.' +
// hex HMAC-SHA256 signature of that payload, keyed by SESSION_SECRET.
function createToken(secret, ttlMs = TOKEN_TTL_MS) {
    const payload = JSON.stringify({ exp: Date.now() + ttlMs });
    const payloadB64 = Buffer.from(payload, 'utf8').toString('base64url');
    const signature = hmac(secret, payloadB64);
    return `${payloadB64}.${signature}`;
}

// Verifies a token's signature (constant-time) and rejects it if it is
// malformed, tampered with, or expired.
function verifyToken(token, secret) {
    if (typeof token !== 'string' || !token) return false;

    const separatorIndex = token.indexOf('.');
    if (separatorIndex === -1) return false;

    const payloadB64 = token.slice(0, separatorIndex);
    const signature = token.slice(separatorIndex + 1);
    if (!payloadB64 || !signature) return false;

    const expectedSignature = hmac(secret, payloadB64);
    if (!safeStringsEqual(signature, expectedSignature)) return false;

    let payload;
    try {
        payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    } catch (err) {
        return false;
    }

    if (!payload || typeof payload.exp !== 'number') return false;
    if (Date.now() > payload.exp) return false;

    return true;
}

// Reads the two required env vars fresh each time (rather than caching at
// module load) so tests can mutate process.env between calls.
function getAuthConfig() {
    const appPassword = process.env.APP_PASSWORD || '';
    const sessionSecret = process.env.SESSION_SECRET || '';
    const missing = [];
    if (!appPassword) missing.push('APP_PASSWORD');
    if (!sessionSecret) missing.push('SESSION_SECRET');

    return {
        appPassword,
        sessionSecret,
        isConfigured: missing.length === 0,
        missing
    };
}

// Builds the JSON body for GET /api/health. Pulled out of the route closure
// so it can be unit tested directly without spinning up Express.
//
// /api/health is one of the two routes excluded from auth entirely (see
// createAuthMiddleware below), so this payload is reachable by anyone,
// unauthenticated. Reporting *which* env var is unset is a deliberate,
// temporary-ish tradeoff: it grants no access and reveals no secret, and
// it's the only way to debug a host's configuration when we can't read its
// runtime logs. Only ever surface variable NAMES here - never values,
// lengths, or any prefix/suffix of a value.
function buildHealthPayload() {
    const { isConfigured, missing } = getAuthConfig();
    return {
        status: 'ok',
        configured: isConfigured,
        missing
    };
}

// Cookie options shared by the login (set) and logout (clear) handlers, so
// the two can never drift apart (a cookie cleared with different flags than
// it was set with won't actually be removed by the browser).
function cookieOptions(isProduction, maxAge) {
    const options = {
        httpOnly: true,
        sameSite: 'lax',
        secure: isProduction,
        path: '/'
    };
    if (maxAge !== undefined) options.maxAge = maxAge;
    return options;
}

// Express middleware factory. Mounted once, before any route definitions, so
// it can't be bypassed by route ordering. Every /api/* request must pass
// through it except the two explicit exceptions below.
//
// Fail-closed behavior when APP_PASSWORD/SESSION_SECRET are missing:
//   - production: 503 on every /api/* request (login included - the login
//     route itself performs the same config check for that one path, since
//     it's excluded from this middleware).
//   - development: request is allowed through, so local work without a
//     configured .env isn't blocked. A warning is logged once at startup,
//     not per-request.
//
// The path is lowercased before either the prefix check or the exclusion
// checks below. Express's routing is case-insensitive by default (`case
// sensitive routing` is off unless explicitly enabled), so a route like
// `/api/transactions` also matches `GET /API/transactions`. Without
// lowercasing here, that request would fail the case-sensitive
// `startsWith('/api/')` test, fall through to `next()`, and reach the route
// with no auth check at all - a full authentication bypass. Do not swap this
// back to a case-sensitive comparison, and do not "fix" it by enabling
// Express's case sensitive routing instead - that changes routing behavior
// app-wide and hasn't been verified safe; the lowercasing here is a
// middleware-local fix that only affects this check.
function createAuthMiddleware(isProduction) {
    return function authMiddleware(req, res, next) {
        const path = req.path.toLowerCase();
        if (!path.startsWith('/api/')) return next();
        if (path === '/api/login' || path === '/api/health') return next();

        const { sessionSecret, isConfigured } = getAuthConfig();
        if (!isConfigured) {
            if (isProduction) {
                return res.status(503).json({ message: 'Сервер не настроен: отсутствуют переменные окружения APP_PASSWORD/SESSION_SECRET.' });
            }
            return next();
        }

        const token = req.cookies ? req.cookies[COOKIE_NAME] : undefined;
        if (!verifyToken(token, sessionSecret)) {
            return res.status(401).json({ message: 'Не авторизован' });
        }

        return next();
    };
}

// Logged once at startup - loud in production (this is a misconfiguration
// that must be fixed), a lighter heads-up in development.
function logStartupConfigStatus(isProduction) {
    const { isConfigured, missing } = getAuthConfig();
    if (isConfigured) return;

    if (isProduction) {
        console.error('='.repeat(70));
        console.error(`FATAL CONFIG ERROR: missing required env var(s): ${missing.join(', ')}`);
        console.error('The API will respond 503 to every /api/* request until these are set.');
        console.error('='.repeat(70));
    } else {
        console.warn(`WARNING: ${missing.join(', ')} not set - auth is DISABLED in development. Set them in server/.env to test the login flow locally.`);
    }
}

module.exports = {
    COOKIE_NAME,
    TOKEN_TTL_MS,
    checkPassword,
    createToken,
    verifyToken,
    getAuthConfig,
    buildHealthPayload,
    cookieOptions,
    createAuthMiddleware,
    logStartupConfigStatus
};
