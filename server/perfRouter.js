const express = require('express');
const { getPerfLog, normalizePath } = require('./perfLog');
const { buildPerfReport, DEFAULT_TIME_ZONE } = require('./perfReport');

// Замеры скорости: приём пакетов с телефона и отчёт. Роутер монтируется в
// app.js после проверки входа, как остальные /api-роуты.

const CLIENT_MAX_BYTES = 32 * 1024;
const CLIENT_MAX_REQUESTS = 100;
const REPORT_DEFAULT_HOURS = 24;
const REPORT_MAX_HOURS = 336;
// Потолок документов в отчёте: две недели записей на каждый запрос - десятки
// тысяч, и тащить их все в память бесплатного тарифа незачем.
const REPORT_MAX_SAMPLES = 50_000;

// Пределы для чисел: не «правдоподобные», а «заведомо не мусор». Неделя в
// миллисекундах для времён, гигабайт для размеров.
const MAX_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_BYTES = 1_000_000_000;
const MAX_RAW_PATH_LENGTH = 300;
const PAGE_ID = /^[A-Za-z0-9_-]{8,64}$/;

const isPlainObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const hasOnlyKeys = (value, allowed) => Object.keys(value).every(key => allowed.includes(key));
const isNumberIn = (value, max) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max;
// Необязательное число: отсутствует, undefined или null (клиент не смог его
// прочитать) - то же, что нет поля.
const isOptionalNumber = (value, max) => value === undefined || value === null || isNumberIn(value, max);

const ENTRY_FIELDS = ['path', 'startTime', 'duration', 'transferSize', 'serverTotal', 'serverDb', 'serverCalc'];
const PAGE_FIELDS = ['responseStart', 'fromCache', 'viaWorker'];
const STARTUP_FIELDS = ['event', 'pageId', 'sentAt', 'page', 'dataReadyAt', 'standalone', 'requests'];
const REQUESTS_FIELDS = ['event', 'pageId', 'sentAt', 'requests'];

function parseEntry(entry) {
    if (!isPlainObject(entry) || !hasOnlyKeys(entry, ENTRY_FIELDS)) return null;
    if (typeof entry.path !== 'string' || entry.path.length > MAX_RAW_PATH_LENGTH || !entry.path.startsWith('/api/')) return null;
    // Путь нормализуется ещё раз здесь: на клиенте он без query, но сервер
    // этому не доверяет, и id в пути не должен попасть в записи.
    const path = normalizePath(entry.path);
    if (!path || !path.startsWith('/api/')) return null;
    if (!isNumberIn(entry.startTime, MAX_MS) || !isNumberIn(entry.duration, MAX_MS)) return null;
    if (!isOptionalNumber(entry.transferSize, MAX_BYTES)) return null;
    for (const field of ['serverTotal', 'serverDb', 'serverCalc']) {
        if (!isOptionalNumber(entry[field], MAX_MS)) return null;
    }

    const parsed = { path, startTime: entry.startTime, duration: entry.duration };
    for (const field of ['transferSize', 'serverTotal', 'serverDb', 'serverCalc']) {
        if (typeof entry[field] === 'number') parsed[field] = entry[field];
    }
    return parsed;
}

function parsePage(page) {
    if (page === null || page === undefined) return { value: undefined };
    if (!isPlainObject(page) || !hasOnlyKeys(page, PAGE_FIELDS)) return null;
    if (!isOptionalNumber(page.responseStart, MAX_MS)) return null;
    for (const field of ['fromCache', 'viaWorker']) {
        if (typeof page[field] !== 'boolean') return null;
    }
    const value = { fromCache: page.fromCache, viaWorker: page.viaWorker };
    if (typeof page.responseStart === 'number') value.responseStart = page.responseStart;
    return { value };
}

// Разбирает тело POST /api/perf/client и возвращает документ для записи либо
// null, если тело не соответствует контракту. Лишние поля - отказ, а не
// молчаливое отбрасывание: клиент и сервер выкатываются вместе, и расхождение
// должно быть видно.
function parseClientPayload(body, at = new Date()) {
    if (!isPlainObject(body)) return null;
    const isStartup = body.event === 'startup';
    if (!isStartup && body.event !== 'requests') return null;
    if (!hasOnlyKeys(body, isStartup ? STARTUP_FIELDS : REQUESTS_FIELDS)) return null;
    if (typeof body.pageId !== 'string' || !PAGE_ID.test(body.pageId)) return null;
    if (!isNumberIn(body.sentAt, MAX_MS)) return null;
    if (!Array.isArray(body.requests) || body.requests.length > CLIENT_MAX_REQUESTS) return null;
    if (!isStartup && body.requests.length === 0) return null;

    const requests = [];
    for (const entry of body.requests) {
        const parsed = parseEntry(entry);
        if (!parsed) return null;
        requests.push(parsed);
    }

    const doc = { kind: 'client', at, event: body.event, pageId: body.pageId, sentAt: body.sentAt, requests };
    if (isStartup) {
        const page = parsePage(body.page);
        if (!page) return null;
        if (!isNumberIn(body.dataReadyAt, MAX_MS) || typeof body.standalone !== 'boolean') return null;
        if (page.value) doc.page = page.value;
        doc.dataReadyAt = body.dataReadyAt;
        doc.standalone = body.standalone;
    }
    return doc;
}

// ?hours=: по умолчанию сутки, больше двух недель (срок хранения) не бывает.
// Не число и не положительное - null.
function parseHours(raw) {
    if (raw === undefined) return REPORT_DEFAULT_HOURS;
    if (typeof raw !== 'string' || raw.trim() === '') return null;
    const hours = Number(raw);
    if (!Number.isFinite(hours) || hours <= 0) return null;
    return Math.min(hours, REPORT_MAX_HOURS);
}

function createPerfRouter({
    perfLog = null,
    getModel = () => require('./models/PerfSample'),
    now = () => new Date(),
    timeZone = DEFAULT_TIME_ZONE
} = {}) {
    const router = express.Router();

    router.post('/client', async (req, res) => {
        // Свой лимит размера, как у /client-errors: express.json принимает до
        // 1 МБ ради остальных роутов.
        let bodyBytes;
        try {
            bodyBytes = Buffer.byteLength(JSON.stringify(req.body ?? null), 'utf8');
        } catch {
            bodyBytes = CLIENT_MAX_BYTES + 1;
        }
        if (bodyBytes > CLIENT_MAX_BYTES) {
            return res.status(413).json({ ok: false, message: 'Замеры слишком большие.' });
        }

        const doc = parseClientPayload(req.body, now());
        if (!doc) return res.status(400).json({ ok: false, message: 'Недопустимый формат замеров.' });

        // Запись необязательна: при выключенном PERF_LOG или недоступной базе
        // ответ всё равно 202 - телефону незачем повторять отправку.
        await (perfLog || getPerfLog()).writeNow(doc);
        return res.status(202).json({ ok: true });
    });

    router.get('/report', async (req, res) => {
        const hours = parseHours(req.query.hours);
        if (hours === null) {
            return res.status(400).json({ message: 'hours должен быть положительным числом.' });
        }
        try {
            const end = now();
            const since = new Date(end.getTime() - hours * 3600 * 1000);
            const samples = await getModel()
                .find({ at: { $gte: since, $lte: end } })
                .sort({ at: 1 })
                .limit(REPORT_MAX_SAMPLES)
                .lean();
            const text = buildPerfReport(samples, { now: end, hours, timeZone });
            res.set('Cache-Control', 'no-store');
            res.type('text/plain; charset=utf-8');
            return res.send(samples.length >= REPORT_MAX_SAMPLES
                ? `${text}\nВнимание: показаны первые ${REPORT_MAX_SAMPLES} записей периода, остальные не вошли.\n`
                : text);
        } catch (err) {
            return res.status(500).json({ message: err.message });
        }
    });

    return router;
}

module.exports = {
    CLIENT_MAX_BYTES,
    CLIENT_MAX_REQUESTS,
    REPORT_DEFAULT_HOURS,
    REPORT_MAX_HOURS,
    createPerfRouter,
    parseClientPayload,
    parseHours
};
