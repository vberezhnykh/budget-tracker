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
// Ничего не предзагружается на install: имена бандлов содержат хеш и
// меняются с каждой сборкой, а держать их список в актуальном состоянии
// руками - гарантированная рассинхронизация. Вместо этого всё кладётся в
// кеш по факту первого запроса; после первого визита приложение открывается
// офлайн.

const CACHE = 'budgetpro-v1';

// Оболочка приложения: то, без чего не открыть ни один экран. Кладётся при
// первом же обращении, отдаётся из кеша, когда сети нет.
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
    if (isApiRequest(url)) return;

    // Навигация - сначала сеть: страница должна обновляться сразу после
    // выката, а не через сутки. Кеш тут - страховка на случай, когда сети
    // нет вовсе.
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    if (response.ok) {
                        const copy = response.clone();
                        caches.open(CACHE).then(cache => cache.put(OFFLINE_FALLBACK, copy));
                    }
                    return response;
                })
                .catch(() => caches.match(OFFLINE_FALLBACK).then(cached => cached || Response.error()))
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
