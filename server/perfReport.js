// Отчёт по замерам скорости: чистая функция из записей PerfSample в русский
// текст, который можно открыть в Safari и вставить в чат. Без обращений к базе
// и к часам - время и часовой пояс приходят параметрами, чтобы результат был
// воспроизводим в тестах.

const DEFAULT_TIME_ZONE = 'Europe/Bucharest';
// Запуск приложения считается «после пробуждения сервера», если запись о
// запуске сервера (boot) сделана не раньше чем за столько до запуска
// приложения. Связывать запросы по времени ненадёжно, поэтому только так.
const WAKE_WINDOW_MS = 3 * 60 * 1000;
// Запросы, обслуженные в первые секунды жизни процесса: их время показывает,
// сколько стоит холодный старт, а не обычная работа.
const COLD_UPTIME_SECONDS = 120;
const SLOWEST_LIMIT = 10;
const EM_DASH = '—';

const numberFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });

// Квантиль с линейной интерполяцией между соседними значениями. Пустой набор
// даёт null, а не 0: «нет данных» и «ноль миллисекунд» - разные вещи.
function quantile(values, q) {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (sorted.length === 0) return null;
    const position = (sorted.length - 1) * q;
    const low = Math.floor(position);
    const high = Math.ceil(position);
    return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

const median = values => quantile(values, 0.5);
const p90 = values => quantile(values, 0.9);

const formatMs = value => (value === null || value === undefined ? EM_DASH : `${numberFormat.format(Math.round(value))} мс`);
const formatCount = value => numberFormat.format(value);
// Часы периода бывают и дробными (?hours=1.5).
const hoursFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });

function localParts(date, timeZone) {
    const formatter = new Intl.DateTimeFormat('ru-RU', {
        timeZone,
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23'
    });
    return Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
}

// '19.10 07:12:33' - без года: отчёт за сутки-двое, год везде один.
function formatTime(date, timeZone) {
    const p = localParts(date, timeZone);
    return `${p.day}.${p.month} ${p.hour}:${p.minute}:${p.second}`;
}

function formatDateTime(date, timeZone) {
    const p = localParts(date, timeZone);
    return `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}`;
}

const asDate = value => (value instanceof Date ? value : new Date(value));

const pick = (items, field) => items.map(item => item[field]).filter(Number.isFinite);

function statsLine(label, values) {
    if (values.length === 0) return `  ${label}: ${EM_DASH}`;
    return `  ${label}: медиана ${formatMs(median(values))}, p90 ${formatMs(p90(values))}`;
}

function startupGroup(title, startups) {
    const lines = [`${title}: ${formatCount(startups.length)}`];
    if (startups.length === 0) return lines;
    lines.push(statsLine('ответ сервера на страницу', startups.map(item => item.page?.responseStart).filter(Number.isFinite)));
    lines.push(statsLine('данные на экране', pick(startups, 'dataReadyAt')));
    return lines;
}

function section(number, title, body) {
    return [`${number}. ${title}`, ...body, ''];
}

function bootSection(boots, timeZone) {
    if (boots.length === 0) return section(2, 'Запуски сервера', ['Запусков сервера за период не было.']);
    const lines = boots.map(boot => {
        const parts = [
            `подключение к базе ${formatMs(boot.connectMs)}`,
            `засев ${formatMs(boot.seedMs)}`,
            `от старта процесса до готовности ${formatMs(boot.sinceProcessStartMs)}`
        ];
        return `${formatTime(asDate(boot.at), timeZone)} — ${parts.join(', ')}`;
    });
    return section(2, 'Запуски сервера', lines);
}

function startupSection(startups, boots) {
    if (startups.length === 0) return section(3, 'Запуски приложения', ['Запусков приложения за период нет.']);

    const bootTimes = boots.map(boot => asDate(boot.at).getTime());
    const afterWake = item => {
        const at = asDate(item.at).getTime();
        return bootTimes.some(time => time <= at && at - time <= WAKE_WINDOW_MS);
    };
    const hasCacheFlag = item => typeof item.page?.fromCache === 'boolean';

    const lines = [
        ...startupGroup('Всего запусков', startups),
        '',
        ...startupGroup('Страница из кеша', startups.filter(item => hasCacheFlag(item) && item.page.fromCache)),
        ...startupGroup('Страница по сети', startups.filter(item => hasCacheFlag(item) && !item.page.fromCache)),
        '',
        ...startupGroup('Сразу после пробуждения сервера', startups.filter(afterWake)),
        ...startupGroup('Сервер уже работал', startups.filter(item => !afterWake(item)))
    ];
    return section(3, 'Запуски приложения', lines);
}

// Запросы с телефона: из пакетов вынимаются записи, у каждой запоминается
// время на часах сервера. Страница присылает performance.now() на момент
// отправки (sentAt), поэтому время запроса = момент приёма минус то, сколько
// прошло между запросом и отправкой. Без sentAt берётся момент приёма.
function clientRequests(clients) {
    const result = [];
    for (const client of clients) {
        const receivedAt = asDate(client.at).getTime();
        for (const request of client.requests || []) {
            const age = Number.isFinite(client.sentAt) && Number.isFinite(request.startTime)
                ? Math.max(0, client.sentAt - request.startTime)
                : 0;
            result.push({ ...request, at: new Date(receivedAt - age) });
        }
    }
    return result;
}

const byPath = (items, keyOf) => {
    const groups = new Map();
    for (const item of items) {
        const key = keyOf(item);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(item);
    }
    return groups;
};

function phoneRequestsSection(requests) {
    if (requests.length === 0) return section(4, 'Запросы с телефона по путям', ['Запросов с телефона за период нет.']);

    const groups = [...byPath(requests, item => item.path)].map(([path, items]) => ({
        path,
        items,
        medianDuration: median(pick(items, 'duration'))
    }));
    // Медленные сверху: по ним решается, что оптимизировать.
    groups.sort((a, b) => (b.medianDuration ?? -1) - (a.medianDuration ?? -1) || a.path.localeCompare(b.path));

    const lines = [];
    for (const { path, items } of groups) {
        const withServer = items.filter(item => Number.isFinite(item.serverTotal) && Number.isFinite(item.duration));
        const network = withServer.map(item => Math.max(0, item.duration - item.serverTotal));
        lines.push(path);
        lines.push(`  запросов ${formatCount(items.length)}; на телефоне: медиана ${formatMs(median(pick(items, 'duration')))}, p90 ${formatMs(p90(pick(items, 'duration')))}`);
        if (withServer.length === 0) {
            lines.push('  сервер не сообщил времени');
        } else {
            lines.push(`  сервер: всего ${formatMs(median(pick(items, 'serverTotal')))}, база ${formatMs(median(pick(items, 'serverDb')))}, расчет ${formatMs(median(pick(items, 'serverCalc')))}`);
            lines.push(`  сеть и ожидание: ${formatMs(median(network))} (по ${formatCount(withServer.length)} запросам)`);
        }
    }
    return section(4, 'Запросы с телефона по путям (медианы)', lines);
}

function serverRequestsSection(servers) {
    if (servers.length === 0) return section(5, 'Запросы на сервере по путям', ['Записей сервера за период нет.']);

    const groups = [...byPath(servers, item => `${item.method} ${item.path}`)].map(([key, items]) => ({
        key,
        items,
        medianTotal: median(pick(items, 'totalMs'))
    }));
    groups.sort((a, b) => (b.medianTotal ?? -1) - (a.medianTotal ?? -1) || a.key.localeCompare(b.key));

    const lines = [];
    for (const { key, items } of groups) {
        const failures = items.filter(item => item.status >= 500).length;
        lines.push(key);
        lines.push(`  запросов ${formatCount(items.length)}${failures ? ` (ошибок 5xx: ${formatCount(failures)})` : ''}; всего: медиана ${formatMs(median(pick(items, 'totalMs')))}, p90 ${formatMs(p90(pick(items, 'totalMs')))}`);
        lines.push(`  база ${formatMs(median(pick(items, 'dbMs')))}, расчет ${formatMs(median(pick(items, 'calcMs')))}`);
        // Доля обращений, которым хватило кэша в памяти: только у роутов, которые
        // его используют, и считается по записям, где состояние кэша известно.
        const cached = items.filter(item => typeof item.cache === 'string');
        if (cached.length > 0) {
            const hits = cached.filter(item => item.cache === 'hit').length;
            const stale = cached.filter(item => item.cache === 'stale').length;
            const misses = cached.length - hits - stale;
            const share = Math.round((hits / cached.length) * 100);
            lines.push(`  кэш: из памяти ${formatCount(hits)} из ${formatCount(cached.length)} (${share}%), устаревший ${formatCount(stale)}, из базы ${formatCount(misses)}`);
        }
        // Доля запросов, которым ответ был уже готов (без расчета): в отчете
        // видно, помогает ли прогрев готовых ответов после смены суток.
        const memoed = items.filter(item => typeof item.memo === 'string');
        if (memoed.length > 0) {
            const ready = memoed.filter(item => item.memo === 'hit').length;
            lines.push(`  готовый ответ: ${formatCount(ready)} из ${formatCount(memoed.length)} (${Math.round((ready / memoed.length) * 100)}%), посчитан заново ${formatCount(memoed.length - ready)}`);
        }
    }

    const cold = servers.filter(item => Number.isFinite(item.uptime) && item.uptime < COLD_UPTIME_SECONDS);
    const warm = servers.filter(item => Number.isFinite(item.uptime) && item.uptime >= COLD_UPTIME_SECONDS);
    lines.push('');
    lines.push(`Первые ${COLD_UPTIME_SECONDS} с после старта процесса: запросов ${formatCount(cold.length)}, медиана всего ${formatMs(median(pick(cold, 'totalMs')))}`);
    lines.push(`Позже: запросов ${formatCount(warm.length)}, медиана всего ${formatMs(median(pick(warm, 'totalMs')))}`);
    return section(5, 'Запросы на сервере по путям (медианы)', lines);
}

function slowestSection(requests, timeZone) {
    if (requests.length === 0) return section(6, `${SLOWEST_LIMIT} самых медленных запросов с телефона`, ['Запросов с телефона за период нет.']);
    const slowest = requests
        .filter(item => Number.isFinite(item.duration))
        .sort((a, b) => b.duration - a.duration)
        .slice(0, SLOWEST_LIMIT);
    const lines = slowest.map((item, index) => {
        const server = Number.isFinite(item.serverTotal) ? `сервер ${formatMs(item.serverTotal)}` : 'сервер без замера';
        return `${index + 1}. ${formatTime(item.at, timeZone)} — ${item.path} — ${formatMs(item.duration)} (${server})`;
    });
    return section(6, `${SLOWEST_LIMIT} самых медленных запросов с телефона`, lines);
}

function buildPerfReport(samples, { now, hours = 24, timeZone = DEFAULT_TIME_ZONE } = {}) {
    const end = asDate(now);
    const start = new Date(end.getTime() - hours * 3600 * 1000);
    const head = [
        'Отчет о скорости приложения',
        `Период: ${formatDateTime(start, timeZone)} — ${formatDateTime(end, timeZone)} (последние ${hoursFormat.format(hours)} ч, ${timeZone})`,
        ''
    ];

    const list = Array.isArray(samples) ? samples : [];
    const servers = list.filter(item => item.kind === 'server');
    const boots = list.filter(item => item.kind === 'boot').sort((a, b) => asDate(a.at) - asDate(b.at));
    const clients = list.filter(item => item.kind === 'client');
    const startups = clients.filter(item => item.event === 'startup');

    if (list.length === 0) {
        return [...head, 'За этот период замеров нет. Либо приложением еще не пользовались, либо запись выключена (PERF_LOG=off).', ''].join('\n');
    }

    const phone = clientRequests(clients);
    const counts = section(1, 'Записи за период', [
        `Всего: ${formatCount(list.length)}`,
        `  запросы на сервере: ${formatCount(servers.length)}`,
        `  запуски сервера: ${formatCount(boots.length)}`,
        `  отчеты с телефона: ${formatCount(clients.length)} (запусков приложения ${formatCount(startups.length)}, запросов ${formatCount(phone.length)})`
    ]);

    return [
        ...head,
        ...counts,
        ...bootSection(boots, timeZone),
        ...startupSection(startups, boots),
        ...phoneRequestsSection(phone),
        ...serverRequestsSection(servers),
        ...slowestSection(phone, timeZone)
    ].join('\n');
}

module.exports = { DEFAULT_TIME_ZONE, WAKE_WINDOW_MS, COLD_UPTIME_SECONDS, buildPerfReport, quantile, median, p90 };
