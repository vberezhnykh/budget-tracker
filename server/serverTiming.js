// Заголовок Server-Timing: сколько сервер потратил на запрос и из чего это
// сложилось (база, расчёт). Нужен, чтобы замер скорости на телефоне без
// консоли разработчика показывал не только «запрос шёл 800 мс», но и где эти
// миллисекунды ушли: на сервере или в сети. Браузер сам отдаёт значения
// странице через PerformanceResourceTiming.serverTiming.
//
// Заголовок содержит только имена этапов и длительности - никаких данных
// запроса и ответа, поэтому утечь через него нечему.
//
// Отдельной зависимости вроде on-headers нет, а лишний пакет ради одной
// обёртки не нужен: writeHead вызывается и явно, и неявно из res.json/res.end,
// так что обёртка над ним срабатывает ровно перед отправкой заголовков.

const { performance } = require('node:perf_hooks');

const HEADER = 'Server-Timing';

const round = (ms) => (Math.round(ms * 10) / 10).toFixed(1);

function record(res, name, ms) {
    const entries = res.locals?.serverTiming;
    // Без middleware (например, роутер в изолированном тесте) этап просто не
    // записывается: замер не должен ломать обработчик.
    if (!entries) return;
    entries.set(name, (entries.get(name) || 0) + ms);
}

// Несколько замеров одного этапа (два чтения базы подряд) складываются в одну
// запись: в заголовке две записи с одним именем браузер показал бы как две
// отдельные строки, а читать нужно общее время этапа.
//
// cacheState (необязательный) - как ответ связан с кэшем операций в памяти
// (hit / miss / stale, см. ledgerCache.js): запись без длительности, только с
// описанием, стоит перед total.
function formatServerTiming(entries, totalMs, cacheState = null) {
    const parts = [...entries].map(([name, ms]) => `${name};dur=${round(ms)}`);
    if (cacheState) parts.push(`cache;desc=${cacheState}`);
    parts.push(`total;dur=${round(totalMs)}`);
    return parts.join(', ');
}

// onFinish (необязательный) получает итог запроса, когда ответ ушёл: так же
// замеренный total, что и в заголовке, и те же этапы. Нужен для записи замеров
// в базу (server/perfLog.js); сам заголовок от него не зависит.
function serverTiming({ onFinish } = {}) {
    return (req, res, next) => {
        const start = performance.now();
        const startedAt = Date.now();
        const startUptime = process.uptime();
        res.locals.serverTiming = new Map();
        // total берётся в момент отправки заголовков, а не на 'finish': это то
        // самое число, которое браузер увидит в Server-Timing, и вычитать его
        // из длительности запроса на телефоне нужно именно в таком виде.
        let totalMs = null;

        const writeHead = res.writeHead;
        res.writeHead = function patchedWriteHead(...args) {
            // Обёртка нужна один раз: дальше (повторный writeHead) заголовки
            // уже ушли, и setHeader бросил бы исключение.
            res.writeHead = writeHead;
            if (!res.headersSent) {
                totalMs = performance.now() - start;
                const value = formatServerTiming(res.locals.serverTiming, totalMs, res.locals.cacheState);
                const existing = res.getHeader(HEADER);
                res.setHeader(HEADER, existing ? `${existing}, ${value}` : value);
            }
            return writeHead.apply(this, args);
        };
        if (onFinish) {
            res.on('finish', () => {
                // Запись замера не должна влиять на ответ, который уже ушёл.
                try {
                    onFinish({
                        method: req.method,
                        url: req.originalUrl,
                        status: res.statusCode,
                        startedAt,
                        uptime: startUptime,
                        totalMs: totalMs ?? performance.now() - start,
                        entries: res.locals.serverTiming,
                        cache: res.locals.cacheState,
                        contentLength: res.getHeader('Content-Length')
                    });
                } catch {
                    // Диагностика необязательна: без неё приложение работает как раньше.
                }
            });
        }
        next();
    };
}

// Кэш операций в памяти: hit - данные уже были, stale - отданы устаревшие с
// обновлением в фоне, miss - пришлось читать базу. Состояние 'off' (кэш
// выключен) не пишется: сравнивать не с чем.
const CACHE_STATES = new Set(['hit', 'miss', 'stale']);

function setCacheState(res, state) {
    if (res.locals && CACHE_STATES.has(state)) res.locals.cacheState = state;
}

// Асинхронный этап (чтение базы): замеряется и тогда, когда промис отклонён,
// чтобы медленный упавший запрос тоже был виден в заголовке ответа 500.
async function timed(res, name, promise) {
    const start = performance.now();
    try {
        return await promise;
    } finally {
        record(res, name, performance.now() - start);
    }
}

// Синхронный этап (расчёт итогов из уже прочитанных данных).
function timedSync(res, name, fn) {
    const start = performance.now();
    try {
        return fn();
    } finally {
        record(res, name, performance.now() - start);
    }
}

module.exports = { serverTiming, timed, timedSync, formatServerTiming, setCacheState };
