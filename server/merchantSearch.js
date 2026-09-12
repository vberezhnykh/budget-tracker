const express = require('express');
const { createClientErrorRateLimiter } = require('./operational');
const { normalizeMerchantDomain } = require('./merchantDomain');

const SEARCH_ENDPOINT = 'https://api.logo.dev/search';
const SEARCH_TIMEOUT_MS = 5000;
const SEARCH_MAX_BYTES = 64 * 1024;
const SEARCH_RATE_WINDOW_MS = 60 * 1000;

function normalizeSearchQuery(value) {
    if (typeof value !== 'string' || value.length > 500) return null;
    const query = value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
    if (query.length < 2 || query.length > 120 || /\p{Cc}/u.test(query)) return null;
    return query;
}

function sanitizeMerchants(data) {
    if (!Array.isArray(data)) throw new Error('Invalid search result');
    const merchants = [];
    const domains = new Set();
    for (const item of data.slice(0, 100)) {
        const name = typeof item?.name === 'string' ? item.name.replace(/\s+/gu, ' ').trim() : '';
        const domain = normalizeMerchantDomain(item?.domain);
        if (!name || name.length > 120 || /\p{Cc}/u.test(name) || !domain || domains.has(domain)) continue;
        domains.add(domain);
        // Never expose logo_url: it may contain a service credential. The
        // browser constructs its own img.logo.dev URL with the public key.
        merchants.push({ name, domain });
        if (merchants.length === 10) break;
    }
    return merchants;
}

async function readSearchBody(response) {
    if (!response.body) throw new Error('Empty search response');
    const reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > SEARCH_MAX_BYTES) {
                await reader.cancel();
                throw new Error('Search response too large');
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function createMerchantSearchRouter({
    fetchImpl = global.fetch,
    getSecretKey = () => process.env.LOGO_DEV_SECRET_KEY,
    rateLimiter = createClientErrorRateLimiter({ windowMs: SEARCH_RATE_WINDOW_MS, maxRequests: 30 }),
    timeoutMs = SEARCH_TIMEOUT_MS
} = {}) {
    const router = express.Router();

    router.get('/search', async (req, res) => {
        res.set('Cache-Control', 'no-store');
        const query = normalizeSearchQuery(req.query.q);
        if (!query) {
            return res.status(400).json({ code: 'MERCHANT_SEARCH_QUERY_INVALID', message: 'Введите название компании: от 2 до 120 символов.' });
        }
        const secretKey = getSecretKey();
        if (typeof secretKey !== 'string' || !/^sk_[A-Za-z0-9_-]{10,200}$/.test(secretKey)) {
            return res.status(503).json({ code: 'MERCHANT_SEARCH_UNAVAILABLE', message: 'Каталог компаний пока не подключён.' });
        }
        if (!rateLimiter(req.ip || req.socket?.remoteAddress || 'unknown')) {
            return res.set('Retry-After', '60').status(429).json({ code: 'MERCHANT_SEARCH_RATE_LIMITED', message: 'Слишком много запросов. Попробуйте через минуту.' });
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const url = new URL(SEARCH_ENDPOINT);
            // Only the company query is sent, never transaction details,
            // amounts, account information or application credentials.
            url.searchParams.set('q', query);
            url.searchParams.set('strategy', 'match');
            const response = await fetchImpl(url.toString(), {
                method: 'GET',
                headers: { Authorization: `Bearer ${secretKey}`, Accept: 'application/json' },
                redirect: 'error',
                signal: controller.signal
            });
            if (!response.ok) {
                // Discard service error bodies and headers: they can contain
                // private request details, and do not belong in client errors.
                await response.body?.cancel();
                if (response.status === 429) {
                    return res.set('Retry-After', '60').status(429).json({ code: 'MERCHANT_SEARCH_RATE_LIMITED', message: 'Каталог временно ограничил поиск. Попробуйте через минуту.' });
                }
                throw new Error('Search service unavailable');
            }
            const merchants = sanitizeMerchants(await readSearchBody(response));
            return res.json({ merchants });
        } catch {
            const timedOut = controller.signal.aborted;
            return res.status(timedOut ? 504 : 502).json({
                code: timedOut ? 'MERCHANT_SEARCH_TIMEOUT' : 'MERCHANT_SEARCH_FAILED',
                message: 'Не удалось загрузить каталог компаний. Попробуйте позже.'
            });
        } finally {
            clearTimeout(timeout);
        }
    });

    return router;
}

module.exports = { createMerchantSearchRouter, normalizeSearchQuery, sanitizeMerchants };
