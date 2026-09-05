const crypto = require('crypto');
const express = require('express');

const CLIENT_ERROR_CODES = new Set(['react_render', 'unhandled_rejection']);
const CLIENT_ERROR_AREAS = new Set(['app']);
const CLIENT_ERROR_MAX_BYTES = 2 * 1024;
const CLIENT_ERROR_WINDOW_MS = 60 * 1000;
const CLIENT_ERROR_MAX_REQUESTS = 20;

function isMongoReady(mongoose) {
    return Boolean(mongoose?.connection?.readyState === 1);
}

function createRequestId(requestId) {
    if (typeof requestId === 'string' && /^[A-Za-z0-9._:-]{1,64}$/.test(requestId)) {
        return requestId;
    }
    return crypto.randomUUID();
}

function createClientErrorRateLimiter({ now = () => Date.now(), windowMs = CLIENT_ERROR_WINDOW_MS, maxRequests = CLIENT_ERROR_MAX_REQUESTS, maxEntries = 1000 } = {}) {
    const attempts = new Map();

    return function isAllowed(key) {
        const timestamp = now();
        const current = attempts.get(key);
        if (!current || timestamp - current.startedAt >= windowMs) {
            if (!current && attempts.size >= maxEntries) {
                attempts.delete(attempts.keys().next().value);
            }
            attempts.set(key, { startedAt: timestamp, count: 1 });
            return true;
        }
        if (current.count >= maxRequests) return false;
        current.count += 1;
        return true;
    };
}

function validClientErrorBody(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
    const keys = Object.keys(body).sort();
    if (keys.length !== 2 || keys[0] !== 'area' || keys[1] !== 'code') return false;
    return CLIENT_ERROR_CODES.has(body.code) && CLIENT_ERROR_AREAS.has(body.area);
}

function createOperationalRouter({
    mongoose,
    isReady = () => isMongoReady(mongoose),
    logger = console,
    now = () => new Date(),
    rateLimiter = createClientErrorRateLimiter()
} = {}) {
    const router = express.Router();

    router.get('/ready', (req, res) => {
        const ok = Boolean(isReady());
        res.status(ok ? 200 : 503).json({ ok });
    });

    router.post('/client-errors', (req, res) => {
        const requestId = createRequestId(req.get('x-request-id'));
        res.set('X-Request-Id', requestId);

        if (!rateLimiter(req.ip || req.socket?.remoteAddress || 'unknown')) {
            return res.status(429).json({ ok: false, message: 'Слишком много сообщений об ошибках.' });
        }

        // express.json runs before this router in app.js. Re-check the encoded
        // parsed body here so the endpoint has its own small payload contract
        // even though business routes accept up to 1 MB.
        let bodyBytes;
        try {
            bodyBytes = Buffer.byteLength(JSON.stringify(req.body ?? null), 'utf8');
        } catch {
            bodyBytes = CLIENT_ERROR_MAX_BYTES + 1;
        }
        if (bodyBytes > CLIENT_ERROR_MAX_BYTES) {
            return res.status(413).json({ ok: false, message: 'Сообщение об ошибке слишком большое.' });
        }

        if (!validClientErrorBody(req.body)) {
            return res.status(400).json({ ok: false, message: 'Недопустимый формат сообщения об ошибке.' });
        }

        logger.info(JSON.stringify({
            event: 'client_error',
            timestamp: now().toISOString(),
            requestId,
            code: req.body.code,
            area: req.body.area
        }));

        return res.status(202).json({ ok: true });
    });

    return router;
}

module.exports = {
    CLIENT_ERROR_CODES,
    CLIENT_ERROR_AREAS,
    CLIENT_ERROR_MAX_BYTES,
    CLIENT_ERROR_WINDOW_MS,
    CLIENT_ERROR_MAX_REQUESTS,
    createClientErrorRateLimiter,
    createOperationalRouter,
    createRequestId,
    isMongoReady,
    validClientErrorBody
};
