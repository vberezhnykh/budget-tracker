// Замеры скорости на телефоне: что браузер сам записал про загрузку страницы
// и запросы к нашему API (Navigation/Resource Timing) уходит на сервер, где
// складывается в базу замеров и потом читается отчётом /api/perf/report.
// Владелец проверяет приложение на iPhone с иконки на домашнем экране, где нет
// консоли разработчика, поэтому смотреть цифры на самом телефоне негде.
//
// Ничего не хранится на устройстве: ни localStorage, ни IndexedDB, ни кеша.
// Отметка «данные готовы» и список уже отправленных записей живут в памяти
// страницы. В отправку идут только времена, размеры и флаги плюс путь запроса
// без строки запроса: в query бывает текст поиска, его не берём.
//
// Отправка необязательна и не должна ничего ломать: все обращения к
// Performance API и сети в try/catch, а промис fetch глотает ошибку сам -
// иначе глобальный репортер необработанных отказов (clientErrorReporter.js)
// принял бы сбой замера за сбой приложения.

import { scheduleIdle } from './prefetch';

// Запросы, начавшиеся до готовности данных и сразу после (с запасом), - это
// «запросы запуска»; всё остальное уходит позже пакетами.
const MS_AFTER_DATA_READY = 500;
const FLUSH_AT_COUNT = 30;
// Сервер принимает не больше 100 записей в пакете (server/perfRouter.js).
const MAX_ENTRIES = 100;
const MAX_CHUNKS_ON_HIDE = 3;
const PERF_URL = '/api/perf/client';
// Запросы к самим замерам в отчёт не попадают.
const PERF_PATH_PREFIX = '/api/perf/';
// Пределы, которые сервер считает «не мусором»: запись вне них отвергла бы
// весь пакет, поэтому такая запись пропускается здесь.
const MAX_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_BYTES = 1_000_000_000;
const MAX_PATH_LENGTH = 300;

const round1 = value => Math.round(value * 10) / 10;

// Число в пределах [0, max] с одним знаком после запятой, иначе undefined.
const bounded = (value, max) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max
    ? round1(value)
    : undefined);

function makePageId() {
    try {
        const id = globalThis.crypto?.randomUUID?.();
        if (id) return id;
    } catch {
        // Небезопасный контекст: randomUUID недоступен, берём запасной вариант.
    }
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

function detectStandalone() {
    try {
        return globalThis.matchMedia?.('(display-mode: standalone)')?.matches === true
            || globalThis.navigator?.standalone === true;
    } catch {
        return false;
    }
}

function readPage(perf) {
    try {
        const entry = perf?.getEntriesByType?.('navigation')?.[0];
        if (!entry) return null;
        return {
            responseStart: bounded(entry.responseStart, MAX_MS),
            // transferSize === 0 - страница не пришла по сети, её отдал кеш;
            // workerStart > 0 - запрос прошёл через service worker.
            fromCache: entry.transferSize === 0,
            viaWorker: entry.workerStart > 0,
        };
    } catch {
        return null;
    }
}

// Время сервера из Server-Timing ответа (старый Safari serverTiming не
// отдаёт - тогда полей просто нет).
function readServerTiming(entry) {
    const result = {};
    if (!Array.isArray(entry.serverTiming)) return result;
    const find = name => entry.serverTiming.find(item => item && item.name === name)?.duration;
    const total = bounded(find('total'), MAX_MS);
    const db = bounded(find('db'), MAX_MS);
    const calc = bounded(find('calc'), MAX_MS);
    if (total !== undefined) result.serverTotal = total;
    if (db !== undefined) result.serverDb = db;
    if (calc !== undefined) result.serverCalc = calc;
    return result;
}

// Запросы к нашему API того же origin из буфера Resource Timing. index -
// позиция записи в буфере: по ней помним, что уже отправлено (записи в
// буфер только добавляются, позиции не меняются).
function readApiRequests(perf, origin) {
    let entries;
    try {
        entries = perf?.getEntriesByType?.('resource');
    } catch {
        return [];
    }
    const result = [];
    (entries || []).forEach((entry, index) => {
        try {
            const url = new URL(entry.name, origin);
            if ((origin && url.origin !== origin) || !url.pathname.startsWith('/api/')
                || url.pathname.startsWith(PERF_PATH_PREFIX) || url.pathname.length > MAX_PATH_LENGTH) {
                return;
            }
            const startTime = bounded(entry.startTime, MAX_MS);
            const duration = bounded(entry.duration, MAX_MS);
            if (startTime === undefined || duration === undefined) return;
            const request = { path: url.pathname, startTime, duration, ...readServerTiming(entry) };
            const transferSize = bounded(entry.transferSize, MAX_BYTES);
            if (transferSize !== undefined) request.transferSize = transferSize;
            result.push({ index, request });
        } catch {
            // Запись с непонятным адресом пропускается.
        }
    });
    return result;
}

// Пакет «запуск приложения»: страница, момент готовности данных и запросы,
// начавшиеся до него (с запасом). Попавшие в пакет записи помечаются как
// отправленные в reported.
export function buildStartupPayload({ perf, origin, pageId, dataReadyAt, standalone, reported }) {
    if (!Number.isFinite(dataReadyAt)) return null;
    const cutoff = dataReadyAt + MS_AFTER_DATA_READY;
    const chosen = readApiRequests(perf, origin)
        .filter(item => !reported.has(item.index) && item.request.startTime <= cutoff)
        .sort((a, b) => a.request.startTime - b.request.startTime)
        .slice(0, MAX_ENTRIES);
    chosen.forEach(item => reported.add(item.index));

    const page = readPage(perf);
    const payload = {
        event: 'startup',
        pageId,
        sentAt: bounded(perf?.now?.(), MAX_MS) ?? 0,
        dataReadyAt: bounded(dataReadyAt, MAX_MS) ?? 0,
        standalone: Boolean(standalone),
        requests: chosen.map(item => item.request),
    };
    if (page) payload.page = page;
    return payload;
}

// Пакет «запросы»: всё, что ещё не отправлено (не больше 100 записей).
// Пустой пакет - null: отправлять нечего.
export function buildRequestsPayload({ perf, origin, pageId, reported }) {
    const chosen = readApiRequests(perf, origin)
        .filter(item => !reported.has(item.index))
        .slice(0, MAX_ENTRIES);
    if (chosen.length === 0) return null;
    chosen.forEach(item => reported.add(item.index));
    return {
        event: 'requests',
        pageId,
        sentAt: bounded(perf?.now?.(), MAX_MS) ?? 0,
        requests: chosen.map(item => item.request),
    };
}

// Все зависимости, которые могут отсутствовать или мешать в тесте, подменяются
// параметрами; по умолчанию они разрешаются в момент использования, а не при
// создании, чтобы подмена глобальных объектов в тесте работала.
export function createLoadReporter({
    perf,
    fetchImpl,
    sendBeacon,
    origin,
    standalone,
    pageId = makePageId(),
    schedule = scheduleIdle,
    doc,
    ObserverClass,
    // Только в собранном приложении: в разработке и в тестах отправка нужна
    // лишь тому, кто её явно включил.
    enabled = import.meta.env.PROD === true,
} = {}) {
    const getPerf = () => perf ?? (typeof performance !== 'undefined' ? performance : null);
    const getOrigin = () => origin ?? (typeof location !== 'undefined' ? location.origin : undefined);
    const getDoc = () => doc ?? (typeof document !== 'undefined' ? document : null);

    const reported = new Set();
    let dataReadyAt = null;
    let startupSent = false;
    let installed = false;

    function transmit(payload, { beacon = false } = {}) {
        let body;
        try {
            body = JSON.stringify(payload);
        } catch {
            return;
        }
        if (beacon) {
            try {
                const send = sendBeacon ?? globalThis.navigator?.sendBeacon?.bind(globalThis.navigator);
                if (typeof send === 'function'
                    && send(PERF_URL, new Blob([body], { type: 'application/json' }))) {
                    return;
                }
            } catch {
                // Не получилось через sendBeacon - пробуем fetch.
            }
        }
        try {
            const doFetch = fetchImpl ?? globalThis.fetch;
            // Ответ не нужен; catch - чтобы отказ не стал необработанным.
            Promise.resolve(doFetch(PERF_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body,
                keepalive: true,
            })).catch(() => {});
        } catch {
            // Замер не должен вызывать ошибку приложения.
        }
    }

    function reportStartup({ beacon = false } = {}) {
        if (!enabled || startupSent || dataReadyAt === null) return;
        startupSent = true;
        try {
            const payload = buildStartupPayload({
                perf: getPerf(),
                origin: getOrigin(),
                pageId,
                dataReadyAt,
                standalone: typeof standalone === 'function' ? standalone() : (standalone ?? detectStandalone()),
                reported,
            });
            if (payload) transmit(payload, { beacon });
        } catch {
            // см. выше
        }
    }

    function flushRequests({ beacon = false, maxChunks = 1 } = {}) {
        if (!enabled) return;
        try {
            for (let chunk = 0; chunk < maxChunks; chunk += 1) {
                const payload = buildRequestsPayload({ perf: getPerf(), origin: getOrigin(), pageId, reported });
                if (!payload) return;
                transmit(payload, { beacon });
            }
        } catch {
            // см. выше
        }
    }

    function unreportedCount() {
        return readApiRequests(getPerf(), getOrigin()).filter(item => !reported.has(item.index)).length;
    }

    // Запоминается только первая отметка: «первые данные» - это момент, когда
    // на экране появился первый снимок. Отправка запуска откладывается на
    // простой, чтобы не конкурировать с отрисовкой.
    function markDataReady() {
        if (dataReadyAt !== null) return;
        const now = getPerf()?.now?.();
        if (!Number.isFinite(now)) return;
        dataReadyAt = now;
        if (enabled) schedule(() => reportStartup());
    }

    // Буфер Resource Timing по умолчанию хранит 250 записей, а приложение за
    // долгий сеанс делает больше запросов: без запаса самые первые, то есть
    // стартовые, записи вытеснились бы раньше, чем их успели бы отправить.
    function install() {
        try {
            getPerf()?.setResourceTimingBufferSize?.(1000);
        } catch {
            // Замер необязателен: без него приложение работает как раньше.
        }
        if (!enabled || installed) return () => {};
        installed = true;

        const cleanups = [];
        try {
            const target = getDoc();
            if (target?.addEventListener) {
                // Страница уходит в фон - последний шанс отправить остаток:
                // sendBeacon переживает выгрузку страницы.
                const onVisibility = () => {
                    if (target.visibilityState !== 'hidden') return;
                    reportStartup({ beacon: true });
                    flushRequests({ beacon: true, maxChunks: MAX_CHUNKS_ON_HIDE });
                };
                target.addEventListener('visibilitychange', onVisibility);
                cleanups.push(() => target.removeEventListener('visibilitychange', onVisibility));
            }
        } catch {
            // Без слушателя остаются отправка запуска и порог по числу записей.
        }
        try {
            const Observer = ObserverClass ?? globalThis.PerformanceObserver;
            if (Observer) {
                // Порог по числу: пакет уходит, когда накопилось ~30 запросов, а
                // не только при сворачивании. До отправки запуска пакеты не
                // уходят - стартовые запросы должны попасть в запуск.
                const observer = new Observer(() => {
                    if (startupSent && unreportedCount() >= FLUSH_AT_COUNT) flushRequests();
                });
                observer.observe({ entryTypes: ['resource'] });
                cleanups.push(() => observer.disconnect());
            }
        } catch {
            // Старый браузер: остаётся отправка при сворачивании.
        }
        return () => {
            cleanups.forEach(fn => fn());
            installed = false;
        };
    }

    return { install, markDataReady, reportStartup, flushRequests, unreportedCount };
}

let reporter = null;
const getReporter = () => {
    if (!reporter) reporter = createLoadReporter();
    return reporter;
};

export function initLoadTiming() {
    getReporter().install();
}

export function markDataReady() {
    getReporter().markDataReady();
}

export function resetLoadTimingForTests() {
    reporter = null;
}
