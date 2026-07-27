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

// Derives a short fingerprint of APP_PASSWORD to bind a token to the
// password that was active when the token was issued.
//
// This is a one-way digest, not the password itself or any reversible
// encoding of it: sha256 is a cryptographic hash, and only the first 16 hex
// characters (64 of the 256 bits) are kept. Even setting aside how
// computationally infeasible reversing sha256 already is, truncating to 64
// bits means there is no way to recover the original password from this
// value - only to check whether a *known* candidate password produces the
// same fingerprint. Its sole purpose is "does the current APP_PASSWORD match
// the one this token was issued for", never to reproduce the password.
function passwordFingerprint(appPassword) {
    return crypto.createHash('sha256').update(String(appPassword)).digest('hex').slice(0, 16);
}

// Creates a signed token: base64url(JSON payload with an expiry and a
// password fingerprint) + '.' + hex HMAC-SHA256 signature of that payload,
// keyed by SESSION_SECRET.
//
// The password fingerprint binds the token to the APP_PASSWORD that was
// active at issue time (see verifyToken). This is a cheap containment
// measure, not a real session store: there is no per-session revocation, so
// an individual session cannot be logged out early. What it does buy is that
// changing APP_PASSWORD immediately invalidates every outstanding token
// (their embedded fingerprint no longer matches), without needing any
// server-side session state. If a full "log everyone out now" is ever
// needed regardless of password, rotating SESSION_SECRET remains the lever
// for that - it invalidates every token's signature outright.
function createToken(secret, appPassword, ttlMs = TOKEN_TTL_MS) {
    const payload = JSON.stringify({
        exp: Date.now() + ttlMs,
        pwf: passwordFingerprint(appPassword)
    });
    const payloadB64 = Buffer.from(payload, 'utf8').toString('base64url');
    const signature = hmac(secret, payloadB64);
    return `${payloadB64}.${signature}`;
}

// Verifies a token's signature (constant-time) and rejects it if it is
// malformed, tampered with, expired, or was issued under a since-changed
// APP_PASSWORD.
function verifyToken(token, secret, appPassword) {
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

    if (typeof payload.pwf !== 'string' || payload.pwf !== passwordFingerprint(appPassword)) return false;

    return true;
}

// Minimum acceptable lengths for the two secrets. A one-character password
// or a short placeholder secret is functionally the same as having none -
// it fails to any real guessing attempt - so both are treated as "not
// configured" rather than silently accepted.
//
// The two thresholds differ because the two values are different kinds of
// secret. APP_PASSWORD is chosen and memorised by a human (one of the two
// family members using this app), and is additionally backstopped by the
// login rate limiter below (LOGIN_MAX_ATTEMPTS per LOGIN_WINDOW_MS), so 8 is
// a floor that's still memorisable while keeping trivially-guessable values
// out - it is not the only defense against brute-forcing it. SESSION_SECRET
// is never typed or memorised by anyone; it's machine-generated (see the
// `crypto.randomBytes(32).toString('hex')` recipe in .env.example, which
// yields 64 hex characters) and it's the HMAC key that authenticates every
// session cookie, so it stays at 32: there's no usability cost to requiring
// the full generated length, and it protects every session, not one login
// attempt at a time.
const MIN_APP_PASSWORD_LENGTH = 8;
const MIN_SESSION_SECRET_LENGTH = 32;

// A value counts as too weak if it's shorter than the minimum, or if it's
// whitespace-only (which would otherwise slip past a naive length check -
// e.g. a SESSION_SECRET that's a dozen spaces from a malformed .env line).
function isTooWeak(value, minLength) {
    if (value.trim().length === 0) return true;
    return value.length < minLength;
}

// Reads the two required env vars fresh each time (rather than caching at
// module load) so tests can mutate process.env between calls.
//
// A var is "missing" when it's genuinely absent/empty, and separately
// "weak" when it's present but fails the strength check above. Both count
// against isConfigured identically (fail closed either way), but are
// reported separately so the startup log and any future diagnostics can say
// exactly what's wrong - "not set" vs "set but too short" are different
// fixes for whoever is reading the log.
function getAuthConfig() {
    const appPassword = process.env.APP_PASSWORD || '';
    const sessionSecret = process.env.SESSION_SECRET || '';
    const missing = [];
    const weak = [];

    if (!appPassword) {
        missing.push('APP_PASSWORD');
    } else if (isTooWeak(appPassword, MIN_APP_PASSWORD_LENGTH)) {
        weak.push('APP_PASSWORD');
    }

    if (!sessionSecret) {
        missing.push('SESSION_SECRET');
    } else if (isTooWeak(sessionSecret, MIN_SESSION_SECRET_LENGTH)) {
        weak.push('SESSION_SECRET');
    }

    return {
        appPassword,
        sessionSecret,
        isConfigured: missing.length === 0 && weak.length === 0,
        missing,
        weak
    };
}

// Builds the JSON body for GET /api/health. Pulled out of the route closure
// so it can be unit tested directly without spinning up Express.
//
// /api/health is one of the two routes excluded from auth entirely (see
// createAuthMiddleware below), so this payload is reachable by anyone,
// unauthenticated. `missing` and `weak` (the specific env var names that are
// absent vs. present-but-too-short) were trimmed down to a single
// `configured` boolean on the theory that an unauthenticated endpoint
// shouldn't enumerate internal configuration. That trim is being reversed:
// this is the second time it has left a live deployment undiagnosable from
// outside while it was down (the first time, tightening
// MIN_APP_PASSWORD_LENGTH to 12 in production took the app down with no way
// to tell, from outside, whether APP_PASSWORD or SESSION_SECRET was the
// problem, or whether it was missing vs. just too weak). The asymmetry that
// justified the trim doesn't actually hold: an unauthenticated caller
// learning that APP_PASSWORD is unset or too short gains nothing actionable
// - the API is exactly as closed to them either way, since every /api/*
// route still fails closed on top of this - while the operator loses the
// only way to diagnose a down deployment remotely (the startup log line from
// logStartupConfigStatus is only reachable if you already have shell/log
// access, which is precisely what's unavailable mid-incident from a phone).
// `missing`/`weak` name variables only, never values, so nothing here is a
// secret: see getAuthConfig, which already computes both lists.
function buildHealthPayload() {
    const { isConfigured, missing, weak } = getAuthConfig();
    return {
        status: 'ok',
        configured: isConfigured,
        missing,
        weak
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

// Loopback addresses only - the literal forms Node/Express can hand back as
// req.ip (the ::ffff:-prefixed form shows up when a IPv4 loopback connection
// is reported through Node's IPv6 socket API).
function isLoopbackIp(ip) {
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

// Express middleware factory. Mounted once, before any route definitions, so
// it can't be bypassed by route ordering. Every /api/* request must pass
// through it except the two explicit exceptions below.
//
// Fail-closed behavior when APP_PASSWORD/SESSION_SECRET are missing or too
// weak (see getAuthConfig): every /api/* request (other than the two
// exclusions) gets a 503, in every environment, regardless of NODE_ENV.
//
// The only way through an unconfigured server is the explicit local-dev
// escape hatch: `authDisabled` must be true (i.e. the operator set
// AUTH_DISABLED=true) *and* the request must come from a loopback address
// (127.0.0.1 / ::1 / ::ffff:127.0.0.1). Both conditions are required - an
// operator setting AUTH_DISABLED=true on a deployment that is reachable from
// outside their own machine still gets a 503 for every non-loopback caller,
// because req.ip only reflects the real remote peer once Express's
// `trust proxy` setting is configured (done once in index.js) rather than
// naively trusting a client-suppliable header.
//
// Deliberately NOT keyed off NODE_ENV: "not production" used to imply
// fail-open, which meant an unset/misspelled NODE_ENV plus unset auth vars
// served the whole API unauthenticated to anyone, from anywhere. NODE_ENV is
// only used elsewhere (cookieOptions) for the cookie's `secure` flag, which
// is an independent decision from whether the bypass is allowed at all.
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
function createAuthMiddleware(authDisabled) {
    return function authMiddleware(req, res, next) {
        const path = req.path.toLowerCase();
        if (!path.startsWith('/api/')) return next();
        if (path === '/api/login' || path === '/api/health') return next();

        const { sessionSecret, appPassword, isConfigured } = getAuthConfig();
        if (!isConfigured) {
            if (authDisabled === true && isLoopbackIp(req.ip)) {
                return next();
            }
            return res.status(503).json({ message: 'Сервер не настроен: отсутствуют переменные окружения APP_PASSWORD/SESSION_SECRET.' });
        }

        const token = req.cookies ? req.cookies[COOKIE_NAME] : undefined;
        if (!verifyToken(token, sessionSecret, appPassword)) {
            return res.status(401).json({ message: 'Не авторизован' });
        }

        return next();
    };
}

// Logged once at startup. Always loud when misconfigured: with the fail-open
// dev bypass gone (see createAuthMiddleware), an incomplete config now means
// 503 everywhere by default, in every environment, so there is no "lighter"
// case to soften the message for. The one thing worth calling out separately
// is whether AUTH_DISABLED is set, since that's the only way an unconfigured
// server ever serves a request at all (and only from loopback).
function logStartupConfigStatus(isProduction, authDisabled) {
    const { isConfigured, missing, weak } = getAuthConfig();

    if (isConfigured) {
        if (authDisabled === true) {
            console.warn('WARNING: AUTH_DISABLED=true is set even though APP_PASSWORD/SESSION_SECRET are both configured, so it has no effect right now. Remove it unless you specifically need the loopback-only bypass for local development - it must never be set on a deployment reachable from outside your own machine.');
        }
        return;
    }

    console.error('='.repeat(70));
    if (missing.length > 0) {
        console.error(`FATAL CONFIG ERROR: missing required env var(s): ${missing.join(', ')}`);
    }
    if (weak.length > 0) {
        // Deliberately never logs the value or any fragment of it - only
        // the variable name, so a look at logs can never leak the secret.
        console.error(`FATAL CONFIG ERROR: env var(s) present but too weak to be accepted: ${weak.join(', ')} (APP_PASSWORD needs >= ${MIN_APP_PASSWORD_LENGTH} chars, SESSION_SECRET needs >= ${MIN_SESSION_SECRET_LENGTH} chars, and neither may be whitespace-only).`);
    }
    if (authDisabled === true) {
        console.error('AUTH_DISABLED=true is set: requests from this machine only (127.0.0.1/::1) will bypass authentication until the above is fixed. Every other caller still gets 503. Remove AUTH_DISABLED once real values are set, and never set it on a deployment reachable from outside your own machine.');
    } else {
        console.error('The API will respond 503 to every /api/* request until the above is fixed.');
    }
    console.error('='.repeat(70));
}

// ---- Login rate limiting ----
//
// POST /api/login guards the single shared password for the whole app, so
// it needs its own throttle independent of the session/auth checks above -
// without one, a remote client could brute-force the password at whatever
// rate the network allows.
//
// This is a small in-memory limiter, which is appropriate here: the app runs
// as a single Node process for two users, not a distributed fleet, so there
// is no multi-instance state to reconcile and no case for pulling in a
// dependency (e.g. Redis-backed limiting) to solve a single-process problem.
//
// Failures are tracked per client IP in a fixed window: the first failure
// for an IP starts a window; every failure within that window increments
// its counter; once the counter reaches LOGIN_MAX_ATTEMPTS, the IP is
// locked out until the window elapses. A successful login clears the IP's
// entry immediately, so a legitimate user who mistyped a few times isn't
// penalized after getting in.
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

// Upper bound on how many distinct IPs are tracked at once. Failed logins
// can come from spoofed or rotating source IPs (an attacker doesn't need a
// real return address to send a POST), so without a cap this map could grow
// without bound. When full, the single oldest-inserted entry is evicted to
// make room - expired entries are swept first, so eviction of a still-active
// entry only happens under sustained abuse from more distinct IPs than the
// cap within a single window.
const LOGIN_RATE_LIMIT_MAX_ENTRIES = 1000;

const loginAttempts = new Map(); // ip -> { count, resetAt }

function pruneExpiredLoginAttempts(now) {
    for (const [ip, entry] of loginAttempts) {
        if (entry.resetAt <= now) loginAttempts.delete(ip);
    }
}

// True if this IP is currently locked out (has reached the failure
// threshold within its current window). Does not itself record anything.
function isLoginRateLimited(ip, now = Date.now()) {
    const entry = loginAttempts.get(ip);
    if (!entry) return false;
    if (entry.resetAt <= now) {
        loginAttempts.delete(ip);
        return false;
    }
    return entry.count >= LOGIN_MAX_ATTEMPTS;
}

// Records a failed login attempt for this IP, starting a new window if none
// is active (or the previous one expired). Returns the failure count so far
// in the current window.
function recordLoginFailure(ip, now = Date.now()) {
    let entry = loginAttempts.get(ip);
    if (!entry || entry.resetAt <= now) {
        pruneExpiredLoginAttempts(now);
        if (!loginAttempts.has(ip) && loginAttempts.size >= LOGIN_RATE_LIMIT_MAX_ENTRIES) {
            const oldestKey = loginAttempts.keys().next().value;
            if (oldestKey !== undefined) loginAttempts.delete(oldestKey);
        }
        entry = { count: 0, resetAt: now + LOGIN_WINDOW_MS };
        loginAttempts.set(ip, entry);
    }
    entry.count += 1;
    return entry.count;
}

// Clears this IP's record entirely - called on a successful login so past
// failed attempts don't count against a legitimate user going forward.
function recordLoginSuccess(ip) {
    loginAttempts.delete(ip);
}

// Test-only escape hatch: the map above is module-level state (deliberately
// - it needs to persist across requests within the running process), so
// tests need a way to reset it between cases instead of leaking counts.
function resetLoginRateLimiter() {
    loginAttempts.clear();
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
    logStartupConfigStatus,
    isLoginRateLimited,
    recordLoginFailure,
    recordLoginSuccess,
    resetLoginRateLimiter,
    LOGIN_MAX_ATTEMPTS,
    LOGIN_WINDOW_MS
};
