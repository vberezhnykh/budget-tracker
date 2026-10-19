// Замер скорости загрузки для экрана «Ещё»: владелец проверяет приложение на
// iPhone с иконки на домашнем экране, где нет консоли разработчика, поэтому
// цифры должны быть видны внутри самого приложения.
//
// Ничего не хранится: отметка «данные готовы» живёт в переменной модуля, а
// остальное браузер уже записал сам (Navigation/Resource Timing) - здесь он
// только читается при открытии экрана. Это не финансовые данные, а времена, но
// на устройство они всё равно не пишутся: ни localStorage, ни кеша.
//
// Из адресов запросов остаётся только путь без строки запроса: в query бывает
// текст поиска, а показывать и держать его незачем.

const MS_BEFORE_DATA_READY = 500;
const RECENT_LIMIT = 10;

const numberFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });

let dataReadyAt = null;

const perf = () => (typeof performance !== 'undefined' ? performance : null);

// Буфер Resource Timing по умолчанию хранит 250 записей, а приложение за
// долгий сеанс делает больше запросов: без запаса самые первые, то есть
// стартовые, записи вытеснились бы раньше, чем их успели бы посмотреть.
export function initLoadTiming() {
    try {
        perf()?.setResourceTimingBufferSize?.(1000);
    } catch {
        // Замер необязателен: без него приложение работает как раньше.
    }
}

// Вызывается при каждой успешной загрузке, но запоминает только первую:
// «первые данные» - это момент, когда на экране появился первый снимок.
export function markDataReady() {
    if (dataReadyAt !== null) return;
    const now = perf()?.now?.();
    if (Number.isFinite(now)) dataReadyAt = now;
}

export function resetLoadTimingForTests() {
    dataReadyAt = null;
}

const finite = value => (Number.isFinite(value) ? value : null);

function readPage() {
    try {
        const entry = perf()?.getEntriesByType?.('navigation')?.[0];
        if (!entry) return null;
        return {
            responseStart: finite(entry.responseStart),
            // transferSize === 0 - страница не пришла по сети, её отдал кеш;
            // workerStart > 0 - запрос прошёл через service worker.
            fromCache: entry.transferSize === 0,
            viaWorker: entry.workerStart > 0,
        };
    } catch {
        return null;
    }
}

// Только запросы к нашему API: ресурсы вроде скриптов и шрифтов в этом
// списке были бы шумом. Старый Safari не отдаёт serverTiming - тогда
// массив просто пустой.
function readRequests() {
    const p = perf();
    if (!p?.getEntriesByType) return [];
    let entries;
    try {
        entries = p.getEntriesByType('resource');
    } catch {
        return [];
    }
    const origin = typeof location !== 'undefined' ? location.origin : undefined;
    const result = [];
    for (const entry of entries || []) {
        let url;
        try {
            url = new URL(entry.name, origin);
        } catch {
            continue;
        }
        if ((origin && url.origin !== origin) || !url.pathname.startsWith('/api/')) continue;
        result.push({
            path: url.pathname,
            duration: finite(entry.duration),
            startTime: finite(entry.startTime),
            transferSize: finite(entry.transferSize),
            serverTiming: Array.isArray(entry.serverTiming)
                ? entry.serverTiming
                    .filter(item => item && typeof item.name === 'string' && Number.isFinite(item.duration))
                    .map(item => ({ name: item.name, duration: item.duration }))
                : [],
        });
    }
    return result.sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0));
}

export function readLoadTiming() {
    const requests = readRequests();
    return {
        page: readPage(),
        dataReadyAt,
        startupRequests: dataReadyAt === null
            ? []
            : requests.filter(item => (item.startTime ?? 0) <= dataReadyAt + MS_BEFORE_DATA_READY),
        // Свежие сверху: интересно, что произошло только что.
        recentRequests: requests.slice(-RECENT_LIMIT).reverse(),
    };
}

export function formatMs(value) {
    return `${numberFormat.format(Math.round(value))} мс`;
}

const SERVER_LABELS = { db: 'база', calc: 'расчет', total: 'всего' };

// «база 310, расчет 120, всего 450»: порядок фиксированный, чужие метрики
// (например, от прокси) не показываются.
export function describeServerTiming(serverTiming) {
    const parts = [];
    for (const name of Object.keys(SERVER_LABELS)) {
        const item = serverTiming.find(entry => entry.name === name);
        if (item) parts.push(`${SERVER_LABELS[name]} ${numberFormat.format(Math.round(item.duration))}`);
    }
    return parts.join(', ');
}

export function describeRequest(request) {
    const server = describeServerTiming(request.serverTiming);
    const duration = request.duration === null ? '—' : formatMs(request.duration);
    return `${request.path} — ${duration}${server ? ` (сервер: ${server})` : ''}`;
}
