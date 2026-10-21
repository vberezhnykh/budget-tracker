// Service worker: приложение открывается при плохой связи и в метро.
//
// Написан руками, а не собран Workbox'ом, по двум причинам. Первая - правил
// тут ровно три, и каждое из них важно понимать точно, а не через слой
// генерации. Вторая и главная: самое важное правило здесь - запретительное,
// и оно должно быть видно глазами.
//
// ЧЕГО ЭТОТ КОД НЕ ДЕЛАЕТ: он никогда не кеширует /api/*. Там деньги и кука
// сессии. Закешированный ответ API - это, во-первых, устаревшие остатки,
// показанные как текущие (а расхождение в деньгах между двумя экранами
// хуже, чем отсутствие офлайна), во-вторых - финансовая история, оставшаяся
// в кеше браузера после выхода из аккаунта.
//
// Ничего не предзагружается на install, кроме самой страницы: имена бандлов
// содержат хеш и меняются с каждой сборкой, а держать их список в актуальном
// состоянии руками - гарантированная рассинхронизация. Вместо этого все
// кладется в кеш по факту первого запроса. Старые бандлы выметаются из кеша
// после каждого обновления страницы в кеше: хеши меняются с выкатом, а кеш
// иначе копил бы их вечно.
//
// НАВИГАЦИЯ (открытие приложения) - СНАЧАЛА КЕШ, НЕ СЕТЬ. Оболочка (HTML
// страницы, без единой цифры из API) отдается из кеша сразу, а из сети
// обновляется в фоне для следующего запуска (stale-while-revalidate). Раньше
// страница всегда ждала сеть: на телефоне это целый сетевой круг до первого
// байта, хотя ничего финансового в ней нет. Цена: после выката приложение
// один раз открывается на оболочке прошлой сборки. Это закрывает само
// приложение: при запуске оно спрашивает у сервера версию сборки
// (src/utils/appUpdate.js) и, если она новее, просит воркер обновить оболочку
// ('refresh-shell', см. ниже) и перезагружается уже в новую. Без закешированной
// оболочки (первый запуск) навигация идет в сеть, как и раньше.
//
// Бандлы и иконки - тоже сначала кеш: имя бандла содержит хеш содержимого, так
// что закешированный ответ устареть не может.
//
// 'refresh-shell': страница просит воркера принести оболочку из сети в обход
// HTTP-кеша, положить ее в кеш и ответить. Только после ответа страница
// перезагружается - иначе перезагрузка снова попала бы на старую оболочку из
// кеша.

const CACHE = 'budgetpro-v1';

// Оболочка приложения: то, без чего не открыть ни один экран. Лежит в кеше под
// одним ключом, отдается на любую навигацию (приложение одностраничное, сервер на
// любой путь отвечает той же страницей) и обновляется из сети в фоне.
const OFFLINE_FALLBACK = '/';

self.addEventListener('install', (event) => {
    // Единственное, что имеет смысл получить заранее, - сама страница:
    // навигация офлайн упрётся именно в неё.
    event.waitUntil(
        caches.open(CACHE)
            .then(cache => cache.add(OFFLINE_FALLBACK))
            // Сборка может быть выкачена в момент установки - тогда
            // предзагрузка не удастся, и это не повод не устанавливаться.
            .catch(() => {})
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
            // Забираем управление уже открытыми вкладками, иначе первый
            // после обновления запуск остался бы без воркера.
            .then(() => self.clients.claim())
    );
});

function isApiRequest(url) {
    return url.pathname.toLowerCase().startsWith('/api/');
}

// Бандлы прошлых сборок: их имена хешированы, поэтому новая страница на них
// не ссылается, а из кеша они сами не уходят - activate срабатывает только
// при изменении самого sw.js, а не при каждом выкате. Живыми считаем то, на
// что ссылается свежий HTML.
function pruneAssets(cache, html) {
    const live = new Set(html.match(/\/assets\/[^"'\s)<>?#]+/g) || []);
    // Страница без единой ссылки на /assets - не наша оболочка (неожиданный
    // 200). По ней нельзя судить, что устарело, поэтому не удаляем ничего.
    if (live.size === 0) return Promise.resolve();
    return cache.keys().then(requests => Promise.all(
        requests
            .filter((request) => {
                const { pathname } = new URL(request.url);
                return pathname.startsWith('/assets/') && !live.has(pathname);
            })
            .map(request => cache.delete(request))
    ));
}

// Кладет свежую оболочку в кеш и убирает бандлы, на которые она уже не
// ссылается. Ошибка уборки не должна ломать обновление оболочки: в худшем
// случае старый бандл полежит до следующего раза.
function storeShell(response) {
    const forPrune = response.clone();
    return caches.open(CACHE).then(cache => cache.put(OFFLINE_FALLBACK, response)
        .then(() => forPrune.text()
            .then(html => pruneAssets(cache, html))
            .catch(() => {})));
}

// Оболочка из сети в кеш. cacheMode - режим HTTP-кеша браузера для этого
// запроса: фоновое обновление спрашивает сервер условным запросом
// ('no-cache'), явная просьба страницы - в обход кеша вовсе ('no-store').
// Неудачный ответ (не 2xx) в кеш не попадает и считается ошибкой: рабочая
// оболочка лучше страницы с ошибкой.
function refreshShell(cacheMode) {
    return fetch(OFFLINE_FALLBACK, { cache: cacheMode }).then((response) => {
        if (!response.ok) throw new Error('shell: ' + response.status);
        return storeShell(response);
    });
}

self.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.type !== 'refresh-shell') return;

    // Ответ уходит по каналу, который открыла страница, а без него - самой
    // странице-отправителю.
    const port = event.ports && event.ports[0];
    const reply = (ok) => {
        try {
            const message = { type: 'shell-refreshed', ok };
            if (port) port.postMessage(message);
            else if (event.source) event.source.postMessage(message);
        } catch {
            // Страница могла закрыться: отвечать некому.
        }
    };
    // waitUntil: воркер не должен уснуть, пока оболочка не легла в кеш.
    event.waitUntil(refreshShell('no-store').then(() => reply(true), () => reply(false)));
});

self.addEventListener('fetch', (event) => {
    const { request } = event;

    // Всё, кроме GET, идёт мимо: POST/PUT/DELETE - это изменения, их
    // кешировать нечем и незачем.
    if (request.method !== 'GET') return;

    const url = new URL(request.url);

    // Чужие домены (шрифты Google) не трогаем: офлайн подставится системный
    // шрифт из fallback-стека, и это лучше, чем разбираться с
    // непрозрачными ответами.
    if (url.origin !== self.location.origin) return;

    // Вот оно, главное правило. Ни чтения из кеша, ни записи в него.
    // Bank callbacks contain one-time authorization codes. Keep the whole
    // banking flow out of caches and never replace the offline app shell
    // with a callback or privacy page.
    if (isApiRequest(url) || url.pathname.toLowerCase().startsWith('/banking/')) return;

    // Навигация - сначала кеш (см. шапку файла). Оболочка в кеше есть:
    // отдаем ее сразу и в фоне обновляем из сети для следующего запуска.
    // Оболочки нет (первый запуск) - сеть, как и раньше; если и сети нет,
    // это настоящая ошибка загрузки страницы.
    if (request.mode === 'navigate') {
        // Сбой чтения кеша не должен оставить без страницы: тогда как без кеша.
        const shell = caches.match(OFFLINE_FALLBACK).catch(() => undefined);
        // waitUntil заранее и синхронно: воркер не должен уснуть до конца
        // фонового обновления, а вызов из цепочки respondWith в части
        // браузеров уже опоздал бы.
        event.waitUntil(shell.then(cached => (cached ? refreshShell('no-cache').catch(() => {}) : undefined)));
        event.respondWith(
            shell.then(cached => cached || fetch(request)
                .then((response) => {
                    // Ошибка записи не должна ломать навигацию.
                    if (response.ok) storeShell(response.clone()).catch(() => {});
                    return response;
                })
                .catch(() => Response.error()))
        );
        return;
    }

    // Всё остальное своего домена - бандлы, иконки, манифест - сначала кеш.
    // Имя файла бандла содержит хеш содержимого, поэтому закешированный
    // ответ не может устареть: после новой сборки страница попросит другой
    // адрес. Иконки и манифест меняются раз в год, и обновятся при смене
    // CACHE.
    event.respondWith(
        caches.match(request).then((cached) => {
            if (cached) return cached;
            return fetch(request).then((response) => {
                if (response.ok) {
                    const copy = response.clone();
                    caches.open(CACHE).then(cache => cache.put(request, copy));
                }
                return response;
            });
        })
    );
});
