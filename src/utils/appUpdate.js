import { useEffect, useState } from 'react';
import { scheduleIdle } from './prefetch';

// Проверка новой версии: при запуске и при возвращении приложения из фона.
//
// Зачем при запуске. Service worker отдает оболочку приложения из кеша сразу,
// не дожидаясь сети (public/sw.js), а свежую берет в фоне. Поэтому после
// выката приложение один раз открывается на оболочке прошлой сборки, и узнать
// об этом можно только спросив сервер. Первый вопрос уходит, когда на экране
// уже есть данные и браузер свободен: так он не конкурирует с запросами
// запуска.
//
// Зачем при возвращении из фона. Приложение с экрана «Домой» на iPhone iOS
// достает из фона вместе со старым бандлом, и выкат виден только после
// закрытия через переключатель приложений. Поэтому, когда страница снова
// становится видимой, спрашиваем сервер, какой сборкой он сейчас отдает
// страницу (GET /api/version), и сравниваем с той, из которой запущены мы.
// Сравниваются адреса входного модуля: Vite кладет в имя хеш содержимого, так
// что он меняется ровно тогда, когда меняется код.
//
// Как обновляемся. Просто перезагрузить страницу нельзя: оболочка в кеше воркера
// все еще старая и перезагрузка вернула бы ту же сборку. Поэтому сначала
// просим воркер принести свежую оболочку ('refresh-shell') и дожидаемся
// ответа, и только потом перезагружаемся (applyUpdate). Защита от
// бесконечной перезагрузки: на каждую целевую версию автоматическая
// перезагрузка случается один раз за сеанс вкладки. Если после нее страница
// все равно оказалась старой (например, выкат еще идет и сервер отдает
// страницы разных сборок), повторять бессмысленно: подхватится при следующем
// запуске. В хранилище лежит только строка с адресом сборки - не финансовые
// данные.

const VERSION_URL = '/api/version';
const MIN_INTERVAL_MS = 60_000;
// Сколько ждем ответа воркера на 'refresh-shell'. Дольше не ждем: обновление
// важно, но не ценой зависшего экрана при плохой связи.
const SHELL_REFRESH_TIMEOUT_MS = 4000;
// Ключ защиты от повторной перезагрузки: адрес сборки, ради которой уже
// перезагружались в этой вкладке.
const RELOADED_FOR_KEY = 'budgetpro-reloaded-for';

// Адрес входного модуля, из которого загружена эта страница, или null в
// разработке: dev-сервер Vite отдаёт /src/main.jsx, а не /assets/..., и
// сравнивать там не с чем.
export function currentBuildVersion(doc = document) {
    const script = doc.querySelector('script[type="module"][src*="/assets/"]');
    const src = script?.getAttribute('src');
    if (!src) return null;
    try {
        return new URL(src, doc.baseURI || 'http://localhost/').pathname;
    } catch {
        return null;
    }
}

// Перезагрузка вынесена в функцию, чтобы тесты могли подменить её: location.reload
// в jsdom не переопределить.
export function reloadPage() {
    window.location.reload();
}

// Просит воркер, управляющий страницей, обновить оболочку в кеше. Промис
// завершается (не отклоняется) после ответа воркера, по таймауту или сразу,
// если воркера нет или он не отвечает на сообщения.
export function refreshShell({ serviceWorker = globalThis.navigator?.serviceWorker, timeoutMs = SHELL_REFRESH_TIMEOUT_MS } = {}) {
    return new Promise((resolve) => {
        const worker = serviceWorker?.controller;
        if (!worker || typeof MessageChannel === 'undefined') {
            resolve(false);
            return;
        }
        let timer = null;
        const channel = new MessageChannel();
        const finish = (ok) => {
            if (timer !== null) clearTimeout(timer);
            channel.port1.onmessage = null;
            try { channel.port1.close(); } catch { /* закрыт */ }
            resolve(ok);
        };
        channel.port1.onmessage = (event) => finish(event.data?.type === 'shell-refreshed' && event.data.ok === true);
        timer = setTimeout(() => finish(false), timeoutMs);
        try {
            worker.postMessage({ type: 'refresh-shell' }, [channel.port2]);
        } catch {
            finish(false);
        }
    });
}

// Сам доступ к window.sessionStorage в части браузеров бросает исключение
// (заблокированные данные сайта), поэтому он тоже в try/catch.
function getSessionStorage() {
    try {
        return globalThis.sessionStorage ?? null;
    } catch {
        return null;
    }
}

// Хранилище вкладки может быть недоступно (закрытый режим, заблокированные
// данные сайта): обращения в try/catch, сбой значит «не знаем».
function readReloadedFor(storage) {
    try {
        return storage.getItem(RELOADED_FOR_KEY);
    } catch {
        return undefined;
    }
}

function writeReloadedFor(storage, version) {
    try {
        storage.setItem(RELOADED_FOR_KEY, version);
        return true;
    } catch {
        return false;
    }
}

// Применяет найденное обновление: просит воркер обновить оболочку и
// перезагружает страницу. Возвращает true, если перезагрузка запущена.
//
// force: true - нажатие «Обновить» на плашке; это решение человека, и защита от
// повторной перезагрузки на него не действует. Автоматический вызов (force не
// задан) перезагружает не более одного раза на версию target за сеанс вкладки и
// не перезагружает совсем, если запомнить это нечем (хранилище недоступно):
// без памяти нельзя исключить бесконечную перезагрузку.
//
// Без воркера, который управляет страницей, перезагрузка идет сразу и
// синхронно: запрос страницы тогда и так уйдет в сеть.
export function applyUpdate(target, {
    force = false,
    reload = reloadPage,
    serviceWorker = globalThis.navigator?.serviceWorker,
    storage = getSessionStorage(),
    timeoutMs = SHELL_REFRESH_TIMEOUT_MS,
} = {}) {
    const key = typeof target === 'string' && target ? target : null;
    if (force) {
        if (key && storage) writeReloadedFor(storage, key);
    } else {
        if (!key || !storage) return false;
        const seen = readReloadedFor(storage);
        // undefined - хранилище не читается; запомнить, что перезагружались,
        // нечем, значит и разрешить автоматическую перезагрузку нельзя.
        if (seen === undefined || seen === key) return false;
        if (!writeReloadedFor(storage, key)) return false;
    }

    if (!serviceWorker?.controller) {
        reload();
        return true;
    }
    refreshShell({ serviceWorker, timeoutMs }).then(() => reload());
    return true;
}

// { updateAvailable, targetVersion }: updateAvailable становится true, когда
// сервер сообщил версию, отличную от текущей, а targetVersion - эта версия.
// Ошибки сети и HTTP молча игнорируются: следующая проверка попробует еще
// раз. Проверка идет: один раз при запуске (в простое, когда ready стало true
// - то есть данные уже на экране), и при каждом возвращении из фона. Возврат из
// фона - не чаще раза в minIntervalMs, чтобы быстрые переключения между
// приложениями не засыпали сервер запросами; проверка при запуске в этот
// интервал не входит.
export function useAppUpdate({ fetchImpl, now = Date.now, minIntervalMs = MIN_INTERVAL_MS, ready = true } = {}) {
    const [update, setUpdate] = useState({ available: false, target: null });

    useEffect(() => {
        const current = currentBuildVersion();
        // Разработка: версии нет, ходить за ней на сервер незачем.
        if (!current) return undefined;

        let lastCheckAt = null;
        let inFlight = false;
        let active = true;

        const check = async ({ throttle = true } = {}) => {
            if (inFlight || !active) return;
            // Офлайн проверка бессмысленна и не должна съедать интервал.
            if (navigator.onLine === false) return;
            const startedAt = now();
            if (throttle) {
                if (lastCheckAt !== null && startedAt - lastCheckAt < minIntervalMs) return;
                lastCheckAt = startedAt;
            }
            inFlight = true;
            try {
                // fetch берётся в момент вызова, а не при импорте: так его
                // подменяют в тестах.
                const response = await (fetchImpl || fetch)(VERSION_URL, { cache: 'no-store' });
                if (!response.ok) return;
                const { version } = await response.json();
                if (active && typeof version === 'string' && version && version !== current) {
                    setUpdate({ available: true, target: version });
                }
            } catch {
                // Нет связи или ответ не JSON: это не повод что-то показывать.
            } finally {
                inFlight = false;
            }
        };

        const onVisibilityChange = () => {
            if (document.visibilityState === 'visible') check();
        };
        // Safari восстанавливает страницу из bfcache без visibilitychange
        // в части случаев: тогда сигналом служит pageshow с persisted.
        const onPageShow = (event) => {
            if (event.persisted) check();
        };

        // Запуск: когда данные уже на экране, в простое браузера.
        const cancelStartupCheck = ready ? scheduleIdle(() => check({ throttle: false })) : null;

        document.addEventListener('visibilitychange', onVisibilityChange);
        window.addEventListener('pageshow', onPageShow);
        return () => {
            active = false;
            cancelStartupCheck?.();
            document.removeEventListener('visibilitychange', onVisibilityChange);
            window.removeEventListener('pageshow', onPageShow);
        };
    }, [fetchImpl, now, minIntervalMs, ready]);

    return { updateAvailable: update.available, targetVersion: update.target };
}
