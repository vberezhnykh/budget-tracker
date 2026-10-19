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
function formatServerTiming(entries, totalMs) {
    const parts = [...entries].map(([name, ms]) => `${name};dur=${round(ms)}`);
    parts.push(`total;dur=${round(totalMs)}`);
    return parts.join(', ');
}

function serverTiming() {
    return (req, res, next) => {
        const start = performance.now();
        res.locals.serverTiming = new Map();

        const writeHead = res.writeHead;
        res.writeHead = function patchedWriteHead(...args) {
            // Обёртка нужна один раз: дальше (повторный writeHead) заголовки
            // уже ушли, и setHeader бросил бы исключение.
            res.writeHead = writeHead;
            if (!res.headersSent) {
                const value = formatServerTiming(res.locals.serverTiming, performance.now() - start);
                const existing = res.getHeader(HEADER);
                res.setHeader(HEADER, existing ? `${existing}, ${value}` : value);
            }
            return writeHead.apply(this, args);
        };
        next();
    };
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

module.exports = { serverTiming, timed, timedSync, formatServerTiming };
