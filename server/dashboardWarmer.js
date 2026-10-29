// Прогрев готовых ответов сводки (responseMemo) в фоне.
//
// Проблема. Ключ готового ответа включает «сегодня» клиента, поэтому первый
// запуск приложения в каждые новые сутки считал сводку с нуля - около
// 400 мс на слабом процессоре, - хотя данные не менялись. То же после фонового
// обновления снимка, которое нашло другие данные (правка скриптом вне
// сервера): версия выросла, и все готовые ответы стали недействительны.
//
// Решение. Сервер помнит несколько последних наборов параметров сводки (без
// «сегодня») вместе с часовым поясом клиента. Когда меняются сутки в этом
// поясе или фоновое обновление приносит другие данные, ответы для этих наборов
// считаются заранее, вне запроса: по одному за такт, через setImmediate, чтобы
// не задерживать живой запрос.
//
// Чего прогрев не делает намеренно:
// - после обычной записи не греет. Приложение само просит свежую сводку сразу
//   после сохранения, и заранее посчитанный ответ удвоил бы нагрузку на
//   процессор в тот самый момент, когда он нужнее всего;
// - не читает базу: нет снимка в памяти - нет прогрева, первый запрос сам
//   дождется загрузки;
// - не работает при LEDGER_CACHE=off (без снимка нет версии, к которой
//   привязывается ответ);
// - не бросает исключений: диагностика и ускорение не должны ронять сервер.

const { parseDashboardQuery, validTimeZone } = require('./dashboardRequest');

const MAX_TRACKED = 6;
// Как часто проверять смену суток. Прогрев должен успеть до утреннего запуска,
// а не к первой секунде новых суток, поэтому пяти-десяти минут достаточно.
const DAY_CHECK_INTERVAL_MS = 5 * 60 * 1000;

const formatters = new Map();

// Локальная дата (YYYY-MM-DD) момента в зоне tz. Форматтер запоминается: их
// создание дорогое, а разных зон в одном процессе единицы.
function localDateIn(tz, timestamp) {
    let formatter = formatters.get(tz);
    if (!formatter) {
        formatter = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
        if (formatters.size >= 32) formatters.clear();
        formatters.set(tz, formatter);
    }
    const parts = Object.fromEntries(formatter.formatToParts(new Date(timestamp)).map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
}

// Набор без «сегодня» и без analytics: прогревается всегда с analytics=1 (его
// просит запуск приложения), а ответ с analytics=1 - надмножество ответа с 0.
function setKey({ month, timeRange, account, category, type }) {
    return JSON.stringify([month, timeRange, account, category, type]);
}

function createDashboardWarmer({
    ledgerCache,
    responseMemo,
    computeJson,
    now = () => Date.now(),
    schedule = (fn) => setImmediate(fn),
    setTimer = (fn, ms) => setInterval(fn, ms),
    clearTimer = (timer) => clearInterval(timer),
    maxTracked = MAX_TRACKED,
    checkIntervalMs = DAY_CHECK_INTERVAL_MS,
    logger = console
}) {
    // Последний использованный набор - в конце. Запись: params (month, timeRange,
    // account, category, type), tz (или null), today - «сегодня», которое клиент
    // присылал в последний раз либо для которого набор прогревался в последний раз.
    const tracked = new Map();
    const queue = [];
    let running = false;
    let timer = null;
    let unsubscribe = null;
    let lastErrorLogged = false;

    function logOnce(error) {
        if (lastErrorLogged) return;
        lastErrorLogged = true;
        try {
            logger.warn('Не удалось прогреть готовые ответы сводки:', error?.message || error);
        } catch {
            // Лог не должен ломать приложение.
        }
    }

    // Запоминает набор из запроса. Дешёвая операция: вызывается на каждом запросе сводки.
    function track(params, tz = null) {
        try {
            if (!params || !ledgerCache.isEnabled()) return;
            const { month, timeRange, account, category, type, today } = params;
            const entry = {
                params: { month, timeRange, account: account ?? null, category: category ?? null, type: type ?? null },
                tz: validTimeZone(tz),
                today
            };
            const key = setKey(entry.params);
            // Обновление переставляет набор в конец, самый давний вытесняется.
            tracked.delete(key);
            tracked.set(key, entry);
            while (tracked.size > maxTracked) tracked.delete(tracked.keys().next().value);
        } catch (error) {
            logOnce(error);
        }
    }

    // Что просил бы клиент с этим набором сейчас: для набора с известной зоной
    // «сегодня» берётся из часов в этой зоне, а месяц переходит на новый, только
    // если до этого был месяцем прежнего «сегодня» (выбранный вручную прошлый
    // месяц остаётся прежним). Без зоны сутки неизвестны: набор прогревается как
    // есть.
    function targetOf(entry) {
        if (!entry.tz) return { month: entry.params.month, today: entry.today };
        const today = localDateIn(entry.tz, now());
        const month = entry.params.month === entry.today.slice(0, 7) ? today.slice(0, 7) : entry.params.month;
        return { month, today };
    }

    function enqueue(entries) {
        for (const entry of entries) {
            if (!queue.includes(entry)) queue.push(entry);
        }
        pump();
    }

    function pump() {
        if (running || queue.length === 0) return;
        running = true;
        schedule(() => {
            const entry = queue.shift();
            try {
                if (entry) warmEntry(entry);
            } catch (error) {
                logOnce(error);
            }
            running = false;
            pump();
        });
    }

    function warmEntry(entry) {
        if (!ledgerCache.isEnabled()) return;
        // Только то, что уже в памяти: чтение базы ради прогрева не нужно.
        const snapshot = ledgerCache.peek();
        if (!snapshot) return;
        // Набор могли вытеснить, пока он стоял в очереди.
        const key = setKey(entry.params);
        if (tracked.get(key) !== entry) return;

        const { month, today } = targetOf(entry);
        // Параметры строятся тем же разбором, что и у запроса: ключ ответа
        // совпадёт по построению.
        const query = { month, timeRange: entry.params.timeRange, today, analytics: '1' };
        for (const name of ['account', 'category', 'type']) {
            if (entry.params[name]) query[name] = entry.params[name];
        }
        const { params, error } = parseDashboardQuery(query);
        if (error) return;
        responseMemo.getEntry('dashboard', params, snapshot.version, () => computeJson(snapshot, params));

        // Набор теперь соответствует новым суткам и месяцу. Если рядом уже есть
        // набор с таким же ключом, новый его заменяет.
        const next = { params: { ...entry.params, month }, tz: entry.tz, today };
        const nextKey = setKey(next.params);
        if (nextKey === key) {
            tracked.set(key, next);
        } else {
            tracked.delete(key);
            tracked.set(nextKey, next);
        }
    }

    // Фоновое обновление нашло другие данные: версия выросла, готовых ответов
    // под новой версией нет.
    function warmAll() {
        try {
            if (!ledgerCache.isEnabled()) return;
            enqueue([...tracked.values()]);
        } catch (error) {
            logOnce(error);
        }
    }

    // Проверка смены суток: прогреваются только наборы, у которых в их зоне
    // наступили новые сутки.
    function checkDayRollover() {
        try {
            if (!ledgerCache.isEnabled()) return;
            const due = [...tracked.values()].filter(entry => entry.tz && localDateIn(entry.tz, now()) !== entry.today);
            if (due.length > 0) enqueue(due);
        } catch (error) {
            logOnce(error);
        }
    }

    return {
        track,
        checkDayRollover,
        warmAll,

        // Подписка на фоновые обновления снимка и таймер смены суток. Таймер не
        // держит процесс живым (unref): прогрев не повод оставлять сервер запущенным.
        start() {
            if (timer) return;
            unsubscribe = ledgerCache.onRefreshChanged(() => warmAll());
            timer = setTimer(checkDayRollover, checkIntervalMs);
            timer?.unref?.();
        },
        stop() {
            if (timer) clearTimer(timer);
            timer = null;
            unsubscribe?.();
            unsubscribe = null;
            queue.length = 0;
        },

        // Для тестов.
        trackedSets: () => [...tracked.values()].map(entry => ({ ...entry, params: { ...entry.params } })),
        clear() {
            tracked.clear();
            queue.length = 0;
            lastErrorLogged = false;
        },
        isBusy: () => running || queue.length > 0
    };
}

module.exports = { MAX_TRACKED, DAY_CHECK_INTERVAL_MS, createDashboardWarmer, localDateIn };
