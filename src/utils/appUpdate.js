import { useEffect, useState } from 'react';

// Проверка новой версии при возвращении приложения из фона.
//
// Приложение с экрана «Домой» на iPhone iOS достаёт из фона вместе со старым
// бандлом, и выкат виден только после закрытия через переключатель
// приложений. Поэтому, когда страница снова становится видимой, спрашиваем
// сервер, какой сборкой он сейчас отдаёт страницу (GET /api/version), и
// сравниваем с той, из которой запущены мы. Сравниваются адреса входного
// модуля: Vite кладёт в имя хеш содержимого, так что он меняется ровно тогда,
// когда меняется код.

const VERSION_URL = '/api/version';
const MIN_INTERVAL_MS = 60_000;

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

// { updateAvailable } становится true, когда сервер сообщил версию, отличную
// от текущей. Ошибки сети и HTTP молча игнорируются: следующее возвращение
// из фона проверит ещё раз. При монтировании не проверяем - страница только
// что загружена свежей. Не чаще раза в minIntervalMs, чтобы быстрые
// переключения между приложениями не засыпали сервер запросами.
export function useAppUpdate({ fetchImpl, now = Date.now, minIntervalMs = MIN_INTERVAL_MS } = {}) {
    const [updateAvailable, setUpdateAvailable] = useState(false);

    useEffect(() => {
        const current = currentBuildVersion();
        // Разработка: версии нет, ходить за ней на сервер незачем.
        if (!current) return undefined;

        let lastCheckAt = null;
        let inFlight = false;
        let active = true;

        const check = async () => {
            if (inFlight || !active) return;
            // Офлайн проверка бессмысленна и не должна съедать интервал.
            if (navigator.onLine === false) return;
            const startedAt = now();
            if (lastCheckAt !== null && startedAt - lastCheckAt < minIntervalMs) return;
            lastCheckAt = startedAt;
            inFlight = true;
            try {
                // fetch берётся в момент вызова, а не при импорте: так его
                // подменяют в тестах.
                const response = await (fetchImpl || fetch)(VERSION_URL, { cache: 'no-store' });
                if (!response.ok) return;
                const { version } = await response.json();
                if (active && typeof version === 'string' && version && version !== current) {
                    setUpdateAvailable(true);
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

        document.addEventListener('visibilitychange', onVisibilityChange);
        window.addEventListener('pageshow', onPageShow);
        return () => {
            active = false;
            document.removeEventListener('visibilitychange', onVisibilityChange);
            window.removeEventListener('pageshow', onPageShow);
        };
    }, [fetchImpl, now, minIntervalMs]);

    return { updateAvailable };
}
