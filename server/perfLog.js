// Запись замеров скорости в базу (коллекция PerfSample) и приведение путей к
// виду, в котором их безопасно хранить.
//
// Главное требование: запись не должна ни замедлить ответ, ни сломать его.
// Поэтому замеры сначала копятся в памяти и уходят в базу пачкой раз в
// несколько секунд, а любая ошибка записи только попадает (редко) в лог.
// Бесплатная Koyeb засыпает без трафика, и таймер, который держал бы процесс
// живым или будил базу без запросов, нам не нужен: таймер взводится только
// пока в буфере что-то есть и не мешает завершению процесса (unref).
//
// В замеры не попадает ничего, кроме путей, времен, размеров и флагов:
// строка запроса отбрасывается, а непохожие на название маршрута сегменты
// пути заменяются на :id (см. normalizePath).

const FLUSH_INTERVAL_MS = 10_000;
const BATCH_SIZE = 50;
// Потолок буфера, пока база недоступна: диагностика не стоит памяти процесса
// на бесплатном тарифе.
const MAX_BUFFERED = 500;
const WARN_INTERVAL_MS = 5 * 60 * 1000;
// Сколько раз подряд пачка может не записаться, прежде чем её выбросят: иначе
// одна «ядовитая» запись блокировала бы все следующие.
const MAX_FAILED_FLUSHES = 3;

const MAX_PATH_SEGMENTS = 8;
const MAX_PATH_LENGTH = 200;

const OBJECT_ID = /^[0-9a-f]{24}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DIGITS = /^\d+$/;
const LONG_HEX = /^[0-9a-f]{16,}$/;
// Длинный токен с цифрой: подпись, хеш, ключ. Названия маршрутов вроде
// planned-payments цифр не содержат.
const LONG_TOKEN = /^(?=.*\d)[a-z0-9_-]{20,}$/;
const SAFE_SEGMENT = /^[a-z0-9._~:-]+$/;

function normalizeSegment(segment) {
    const lower = segment.toLowerCase();
    if (!SAFE_SEGMENT.test(lower)) return ':id';
    if (OBJECT_ID.test(lower) || UUID.test(lower) || DIGITS.test(lower)
        || LONG_HEX.test(lower) || LONG_TOKEN.test(lower)) {
        return ':id';
    }
    return lower;
}

// '/api/Transactions/65f0c0ffee0123456789abcd?search=текст' -> '/api/transactions/:id'.
// Query и фрагмент отбрасываются до разбора: в query бывает текст поиска.
// Всё, что не похоже на латинское название маршрута (кириллица, проценты), тоже
// становится :id - название маршрута в путь попасть не может, а введённый
// текст мог бы. Не строка - null.
function normalizePath(raw) {
    if (typeof raw !== 'string') return null;
    const pathname = raw.split(/[?#]/, 1)[0];
    const segments = pathname.split('/').filter(Boolean).slice(0, MAX_PATH_SEGMENTS).map(normalizeSegment);
    return `/${segments.join('/')}`.slice(0, MAX_PATH_LENGTH);
}

// Эти пути не пишутся: /api/health и /api/ready дергает самопинг и
// оркестратор (раз в 14 минут - не нагрузка и не пользователь), version и login
// доступны без входа, и писать в базу по запросу любого прохожего нельзя, а
// сами perf-роуты замерять незачем.
const SKIPPED_PATHS = new Set(['/api/health', '/api/ready', '/api/version', '/api/login']);

function isSkippedPath(path) {
    return SKIPPED_PATHS.has(path) || path === '/api/perf' || path.startsWith('/api/perf/');
}

// Ответы гейта на запросы без входа и по лимиту: такой запрос может прислать
// кто угодно, и в базу он попасть не должен.
const SKIPPED_STATUSES = new Set([401, 429]);

const round1 = value => Math.round(value * 10) / 10;

function isPerfLogEnabled(env = process.env) {
    return String(env.PERF_LOG || '').trim().toLowerCase() !== 'off';
}

function createPerfLog({
    getModel = () => require('./models/PerfSample'),
    isConnected = () => require('mongoose').connection.readyState === 1,
    isEnabled = () => isPerfLogEnabled(),
    now = () => Date.now(),
    logger = console,
    flushIntervalMs = FLUSH_INTERVAL_MS,
    batchSize = BATCH_SIZE,
    maxBuffered = MAX_BUFFERED,
    warnIntervalMs = WARN_INTERVAL_MS
} = {}) {
    let buffer = [];
    let timer = null;
    let inFlight = null;
    let failedFlushes = 0;
    let lastWarnAt = null;
    let dropped = 0;

    // Сообщение об ошибке записи - не чаще раза в несколько минут: при
    // недоступной базе оно иначе повторялось бы каждые десять секунд. В лог
    // идёт только текст ошибки драйвера, без самих записей.
    function warn(error) {
        const time = now();
        if (lastWarnAt !== null && time - lastWarnAt < warnIntervalMs) return;
        lastWarnAt = time;
        try {
            logger.warn('Не удалось записать замеры скорости:', error?.message || error);
        } catch {
            // Лог не должен ломать приложение.
        }
    }

    function clearTimer() {
        if (timer) clearTimeout(timer);
        timer = null;
    }

    function schedule() {
        if (timer || buffer.length === 0) return;
        timer = setTimeout(() => {
            timer = null;
            flush();
        }, flushIntervalMs);
        timer.unref?.();
    }

    function trim() {
        if (buffer.length <= maxBuffered) return;
        // Свежие замеры ценнее старых: выбрасываются самые давние.
        const excess = buffer.length - maxBuffered;
        buffer.splice(0, excess);
        dropped += excess;
    }

    async function doFlush() {
        clearTimer();
        if (!isEnabled()) {
            buffer = [];
            return;
        }
        if (buffer.length === 0) return;
        if (!isConnected()) {
            // Базы нет (старт, обрыв): копим дальше, потолок держит trim().
            schedule();
            return;
        }
        const batch = buffer;
        buffer = [];
        try {
            await getModel().insertMany(batch, { ordered: false });
            failedFlushes = 0;
        } catch (error) {
            warn(error);
            failedFlushes += 1;
            if (failedFlushes < MAX_FAILED_FLUSHES) {
                buffer = batch.concat(buffer);
                trim();
            } else {
                failedFlushes = 0;
                dropped += batch.length;
            }
        }
        schedule();
    }

    function flush() {
        if (!inFlight) {
            inFlight = doFlush().catch(warn).finally(() => { inFlight = null; });
        }
        return inFlight;
    }

    return {
        isEnabled: () => Boolean(isEnabled()),

        add(sample) {
            try {
                if (!isEnabled()) return;
                buffer.push(sample);
                trim();
                if (buffer.length >= batchSize && isConnected()) flush();
                else schedule();
            } catch (error) {
                warn(error);
            }
        },

        // Прямая запись одного замера (отчёт с телефона приходит редко, и
        // ответ на него должен честно сказать, что записано). Никогда не
        // бросает: false - не записано (выключено, нет базы, ошибка).
        async writeNow(sample) {
            try {
                if (!isEnabled() || !isConnected()) return false;
                await getModel().insertMany([sample], { ordered: false });
                return true;
            } catch (error) {
                warn(error);
                return false;
            }
        },

        flush,

        // Остановка: таймер снимается, остаток уходит в базу, если она ещё
        // подключена. Вызывается из shutdown() до отключения от MongoDB.
        async stop() {
            clearTimer();
            await flush();
            if (buffer.length > 0 && isConnected()) await flush();
            clearTimer();
        },

        size: () => buffer.length,
        droppedCount: () => dropped
    };
}

let shared = null;

function getPerfLog() {
    if (!shared) shared = createPerfLog();
    return shared;
}

// Превращает итог запроса из serverTiming() в запись и отдаёт её буферу.
function createServerSampleRecorder({ perfLog = null } = {}) {
    return function recordServerSample(info) {
        const log = perfLog || getPerfLog();
        if (!log.isEnabled()) return;
        const path = normalizePath(info.url);
        if (!path || isSkippedPath(path) || SKIPPED_STATUSES.has(info.status)) return;

        const sample = {
            kind: 'server',
            at: new Date(info.startedAt),
            method: String(info.method || '').toUpperCase().slice(0, 10),
            path,
            status: info.status,
            totalMs: round1(info.totalMs),
            uptime: round1(info.uptime)
        };
        const db = info.entries?.get('db');
        const calc = info.entries?.get('calc');
        if (Number.isFinite(db)) sample.dbMs = round1(db);
        if (Number.isFinite(calc)) sample.calcMs = round1(calc);
        // Content-Length бывает не у каждого ответа (потоковые его не имеют):
        // нет заголовка - нет и поля.
        const bytes = Number(info.contentLength);
        if (info.contentLength !== undefined && Number.isFinite(bytes) && bytes >= 0) sample.bytes = bytes;
        log.add(sample);
    };
}

module.exports = {
    FLUSH_INTERVAL_MS,
    BATCH_SIZE,
    MAX_BUFFERED,
    MAX_PATH_LENGTH,
    createPerfLog,
    createServerSampleRecorder,
    getPerfLog,
    isPerfLogEnabled,
    isSkippedPath,
    normalizePath
};
