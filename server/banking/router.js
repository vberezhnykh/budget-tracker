const crypto = require('node:crypto');
const express = require('express');
const { isBankingEnabled } = require('./feature');

const NONCE_COOKIE = 'banking_auth_nonce';
const NONCE_TTL_MS = 10 * 60 * 1000;
const OBJECT_ID = /^[a-f\d]{24}$/i;
const NONCE = /^[A-Za-z0-9_-]{43}$/;
const MUTATIONS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const CALLBACK_ERROR_CODES = new Set(['BANKING_CALLBACK', 'INVALID_STATE', 'NO_ACCOUNTS', 'BUSY',
    'NOT_CONFIGURED', 'CONFIGURATION', 'INVALID_RESPONSE', 'NETWORK', 'AUTH_REQUIRED',
    'RATE_LIMITED', 'SESSION_EXPIRED', 'API_ERROR', 'ENCRYPTION', 'DECRYPTION']);

function fail(status, code, message) {
    throw Object.assign(new Error(message), { status, code });
}

function noStore(req, res, next) {
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');
    next();
}

function errorResponse(res, error) {
    // Only the service's explicit safe errors are suitable for a response.
    const safe = Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599
        && typeof error.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code)
        && typeof error.message === 'string' && error.message.length <= 400;
    return res.status(safe ? error.status : 500).json(safe
        ? { code: error.code, message: error.message }
        : { code: 'BANKING_ERROR', message: 'Не удалось выполнить банковскую операцию.' });
}

function wrap(handler) {
    return (req, res, next) => Promise.resolve().then(() => handler(req, res, next))
        .catch(error => { if (!res.headersSent && !res.destroyed) errorResponse(res, error); });
}

function canonicalOrigin(value) {
    try {
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
        return url.origin;
    } catch { return null; }
}

function requireSameOrigin(req, { optional = false } = {}) {
    const origin = req.get('origin');
    if (!origin && optional) return;
    const normalized = typeof origin === 'string' ? canonicalOrigin(origin) : null;
    // Origin is an origin, never a URL with a path or a list of origins.
    if (!normalized || normalized !== origin) fail(403, 'BANKING_ORIGIN', 'Недопустимый источник запроса.');

    const configured = canonicalOrigin(process.env.ENABLE_BANKING_REDIRECT_URL);
    if (configured && origin === configured) return;
    if (process.env.NODE_ENV !== 'production') {
        const host = req.get('host');
        const current = canonicalOrigin(`${req.protocol}://${host}`);
        if (current && current === origin && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(current).hostname)) return;
    }
    fail(403, 'BANKING_ORIGIN', 'Недопустимый источник запроса.');
}

function boundedBody(body, allowedKeys) {
    if (!body || typeof body !== 'object' || Array.isArray(body)
        || Object.getPrototypeOf(body) !== Object.prototype
        || Buffer.byteLength(JSON.stringify(body), 'utf8') > 4096) {
        fail(400, 'BANKING_INPUT', 'Некорректные данные запроса.');
    }
    function check(value, depth = 0, field = '') {
        if (depth > 3) return false;
        if (value === null || typeof value === 'boolean') return true;
        if (typeof value === 'number') return Number.isFinite(value) && Math.abs(value) < 1e12;
        if (typeof value === 'string') {
            const checked = field === 'description' ? value.replace(/[\r\n\t]/g, '') : value;
            return value.length <= 1000 && !/[\p{Cc}\p{Cf}]/u.test(checked);
        }
        if (Array.isArray(value)) return value.length <= 10 && value.every(item => check(item, depth + 1));
        if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return false;
        const keys = Object.keys(value);
        return keys.length <= 16 && keys.every(key => /^[a-zA-Z][a-zA-Z0-9_]{0,49}$/.test(key)
            && !['constructor', 'prototype', '__proto__'].includes(key) && check(value[key], depth + 1, key));
    }
    if (!check(body) || (allowedKeys && Object.keys(body).some(key => !allowedKeys.includes(key)))) {
        fail(400, 'BANKING_INPUT', 'Некорректные данные запроса.');
    }
    return body;
}

function validId(value) {
    if (typeof value !== 'string' || !OBJECT_ID.test(value)) fail(400, 'BANKING_INPUT', 'Некорректный идентификатор.');
    return value;
}

function validDate(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
        && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`))
        && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
}

function nonceOptions() {
    return { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/banking' };
}

function createBankingRouter({ service }) {
    const apiRouter = express.Router();
    const publicRouter = express.Router();
    apiRouter.use(noStore);
    publicRouter.use(noStore);
    const requireEnabled = (req, res, next) => {
        if (!isBankingEnabled()) return res.status(404).json({ code: 'BANKING_DISABLED', message: 'Банковская интеграция выключена.' });
        next();
    };
    apiRouter.use(requireEnabled);
    publicRouter.use(requireEnabled);
    apiRouter.use(wrap((req, res, next) => {
        if (MUTATIONS.has(req.method)) requireSameOrigin(req);
        next();
    }));

    apiRouter.get('/', wrap(async (req, res) => res.json(await service.status())));
    apiRouter.post('/connect', wrap(async (req, res) => {
        const body = boundedBody(req.body, ['bank', 'importFrom']);
        if (!['boc', 'revolut'].includes(body.bank) || !validDate(body.importFrom)) {
            fail(400, 'BANKING_INPUT', 'Укажите банк и дату начала импорта.');
        }
        const browserNonce = crypto.randomBytes(32).toString('base64url');
        res.cookie(NONCE_COOKIE, browserNonce, { ...nonceOptions(), maxAge: NONCE_TTL_MS });
        try {
            const result = await service.connect(body.bank, body.importFrom, browserNonce);
            res.json({ authorizationUrl: result.authorizationUrl });
        } catch (error) {
            res.clearCookie(NONCE_COOKIE, nonceOptions());
            throw error;
        }
    }));
    apiRouter.put('/accounts/:id/mapping', wrap(async (req, res) => {
        const body = boundedBody(req.body, ['accountId']);
        await service.mapAccount(validId(req.params.id), validId(body.accountId));
        res.json({ ok: true });
    }));
    apiRouter.post('/connections/:id/sync', wrap(async (req, res) => {
        boundedBody(req.body || {}, []);
        const result = await service.syncConnection(validId(req.params.id));
        res.json({ status: result.status, nextSyncAt: result.nextSyncAt });
    }));
    apiRouter.delete('/connections/:id', wrap(async (req, res) => {
        boundedBody(req.body || {}, []);
        await service.disconnect(validId(req.params.id));
        res.json({ ok: true });
    }));
    apiRouter.get('/review', wrap(async (req, res) => res.json(await service.listReview())));
    apiRouter.post('/review/:id/resolve', wrap(async (req, res) => {
        const body = boundedBody(req.body, ['version', 'action', 'transactionId', 'transactionVersion', 'category', 'description', 'toAccountId', 'fromAccountId', 'candidateToken']);
        if (!['match', 'import', 'ignore', 'transfer'].includes(body.action)
            || !Number.isSafeInteger(body.version) || body.version < 0
            || (body.transactionVersion !== undefined && (!Number.isSafeInteger(body.transactionVersion) || body.transactionVersion < 0))
            || (body.category !== undefined && (typeof body.category !== 'string' || body.category.length > 120))
            || (body.description !== undefined && typeof body.description !== 'string')
            || (body.candidateToken !== undefined && (typeof body.candidateToken !== 'string' || !/^[a-f\d]{64}$/i.test(body.candidateToken)))
            || (['import', 'transfer'].includes(body.action) && body.candidateToken === undefined)) {
            fail(400, 'BANKING_INPUT', 'Некорректное решение для операции.');
        }
        for (const key of ['transactionId', 'toAccountId', 'fromAccountId']) {
            if (body[key] !== undefined) validId(body[key]);
        }
        await service.resolveReview(validId(req.params.id), body);
        res.json({ ok: true });
    }));

    publicRouter.get('/callback.html', async (req, res, next) => {
        if (!['code', 'state', 'error'].some(key => Object.hasOwn(req.query, key))) return next();
        const browserNonce = req.cookies?.[NONCE_COOKIE];
        res.clearCookie(NONCE_COOKIE, nonceOptions());
        res.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
        let completed = false;
        try {
            const { code, state } = req.query;
            if (Object.hasOwn(req.query, 'error') || typeof code !== 'string' || !code || code.length > 2048
                || typeof state !== 'string' || !state || state.length > 256
                || typeof browserNonce !== 'string' || !NONCE.test(browserNonce)) {
                fail(400, 'BANKING_CALLBACK', 'Не удалось подтвердить подключение.');
            }
            await service.completeAuthorization({ code, state, browserNonce });
            completed = true;
        } catch (error) {
            // Keep callback failures diagnosable without codes, cookies, banking
            // data, provider response bodies, or arbitrary exception messages.
            console.warn('Banking authorization failed:', CALLBACK_ERROR_CODES.has(error?.code) ? error.code : 'BANKING_ERROR');
        }
        res.redirect(303, `/?banking=${completed ? 'connected' : 'error'}`);
    });

    publicRouter.post('/jobs/sync', wrap(async (req, res) => {
        requireSameOrigin(req, { optional: true });
        const secret = process.env.BANK_SYNC_CRON_SECRET;
        if (typeof secret !== 'string' || secret.length < 32 || secret.length > 512 || /\s/.test(secret)) {
            fail(503, 'BANKING_JOB_DISABLED', 'Плановый импорт не настроен.');
        }
        // Reject query-string credentials even if a valid header is supplied.
        if (Object.keys(req.query).length) fail(400, 'BANKING_INPUT', 'Параметры URL не поддерживаются.');
        const authorization = req.get('authorization') || '';
        const candidate = /^Bearer ([^\s]{1,512})$/.exec(authorization)?.[1] || '';
        const hash = value => crypto.createHash('sha256').update(value).digest();
        if (!crypto.timingSafeEqual(hash(candidate), hash(secret))) fail(401, 'BANKING_JOB_AUTH', 'Требуется авторизация.');
        boundedBody(req.body || {}, []);
        // The service owns background execution, safe error handling and Mongo
        // leases. 202 acknowledges the trigger, never completion of a bank read.
        service.kickDueSyncs();
        res.status(202).json({ status: 'scheduled' });
    }));

    return { apiRouter, publicRouter };
}

module.exports = { createBankingRouter };
