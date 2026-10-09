// @vitest-environment node
//
// Установка на домашний экран и офлайн.
//
// Проверяется то, что иначе выясняется только на телефоне и только когда
// уже не работает: манифест разъехался с иконками, у иконки не тот размер,
// service worker начал кешировать API.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(REPO_ROOT, 'public');

const read = (...parts) => fs.readFileSync(path.join(...parts), 'utf8');

const manifest = JSON.parse(read(PUBLIC_DIR, 'manifest.webmanifest'));
const indexHtml = read(REPO_ROOT, 'index.html');

// Ширина и высота PNG лежат в IHDR - первом чанке, сразу после 8-байтовой
// сигнатуры и 8 байт заголовка чанка.
function pngSize(file) {
    const buf = fs.readFileSync(file);
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (!buf.subarray(0, 8).equals(signature)) return null;
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe('Манифест', () => {
    it('объявляет всё, без чего браузер не предложит установку', async () => {
        expect(manifest.name).toBeTruthy();
        expect(manifest.start_url).toBe('/');
        expect(manifest.scope).toBe('/');
        expect(manifest.display).toBe('standalone');
        expect(manifest.icons.length).toBeGreaterThan(0);
    });

    it('иконки существуют и того размера, который заявлен', async () => {
        // Заявить 512x512, а положить 192x192 - ошибка, которую браузер не
        // сообщает: он просто не считает приложение устанавливаемым.
        for (const icon of manifest.icons) {
            const file = path.join(PUBLIC_DIR, icon.src.replace(/^\//, ''));
            expect(fs.existsSync(file), icon.src).toBe(true);

            const [width, height] = icon.sizes.split('x').map(Number);
            expect(pngSize(file), icon.src).toEqual({ width, height });
        }
    });

    it('есть maskable-иконка: без неё Android обрежет углы рисунка', async () => {
        const maskable = manifest.icons.filter(icon => String(icon.purpose).includes('maskable'));

        expect(maskable.length).toBeGreaterThan(0);
        // Требование спецификации к устанавливаемому приложению - хотя бы
        // одна иконка 512x512.
        expect(maskable.some(icon => icon.sizes === '512x512')).toBe(true);
    });

    it('цвет темы в манифесте и в мета-теге совпадает', async () => {
        // Android берёт цвет строки состояния из мета-тега, а цвет заставки
        // при запуске - из манифеста. Разойдясь, они дают заметную смену
        // цвета в момент открытия.
        const meta = indexHtml.match(/<meta\s+name="theme-color"\s+content="([^"]+)"/);

        expect(meta).not.toBeNull();
        expect(meta[1]).toBe(manifest.theme_color);
    });

    it('цвета темы и заставки совпадают с фоном страницы', async () => {
        // Строка состояния и заставка при запуске должны сливаться с серым
        // фоном экрана (--color-bg), а не выделяться прежним синим.
        const css = read(REPO_ROOT, 'src', 'index.css');
        const background = css.match(/--color-bg:\s*(#[0-9a-fA-F]{6})\s*;/);

        expect(background).not.toBeNull();
        expect(manifest.theme_color.toLowerCase()).toBe(background[1].toLowerCase());
        expect(manifest.background_color.toLowerCase()).toBe(background[1].toLowerCase());
    });
});

describe('index.html', () => {
    it('подключает манифест', async () => {
        expect(indexHtml).toMatch(/<link\s+rel="manifest"\s+href="\/manifest\.webmanifest"/);
    });

    it('отдаёт iOS отдельную иконку: манифест она не читает', async () => {
        const link = indexHtml.match(/<link\s+rel="apple-touch-icon"\s+href="([^"]+)"/);

        expect(link).not.toBeNull();
        const file = path.join(PUBLIC_DIR, link[1].replace(/^\//, ''));
        expect(fs.existsSync(file)).toBe(true);
        expect(pngSize(file)).toEqual({ width: 180, height: 180 });
    });

    it('не ссылается на файлы, которых нет', async () => {
        const hrefs = [...indexHtml.matchAll(/(?:href|content)="(\/[^"]+\.(?:png|svg|webmanifest))"/g)]
            .map(match => match[1]);

        expect(hrefs.length).toBeGreaterThan(0);
        for (const href of hrefs) {
            expect(fs.existsSync(path.join(PUBLIC_DIR, href.replace(/^\//, ''))), href).toBe(true);
        }
    });
});

describe('Service worker', () => {
    // sw.js исполняется браузером в своей области видимости, поэтому здесь
    // он загружается в поддельную: собираем self, caches и fetch руками и
    // смотрим, что делает обработчик. Это дороже, чем поискать строку в
    // исходнике, но проверяет поведение, а не текст.
    let handlers;
    let cacheStore;
    let fetchCalls;
    let fetchImpl;

    beforeAll(async () => {
        const source = read(PUBLIC_DIR, 'sw.js');

        handlers = {};
        const self = {
            addEventListener: (type, handler) => { handlers[type] = handler; },
            location: new URL('https://budget.example/'),
            skipWaiting: () => Promise.resolve(),
            clients: { claim: () => Promise.resolve() }
        };

        cacheStore = new Map();
        // Настоящий кеш хранит абсолютные адреса, даже если положили '/'.
        const absolute = (key) => new URL(key, 'https://budget.example/').href;
        const cache = {
            add: async () => {},
            put: async (request, response) => {
                cacheStore.set(typeof request === 'string' ? request : request.url, response);
            },
            match: async (request) => cacheStore.get(typeof request === 'string' ? request : request.url),
            keys: async () => [...cacheStore.keys()].map(key => ({ url: absolute(key) })),
            delete: async (request) => {
                const target = absolute(typeof request === 'string' ? request : request.url);
                const key = [...cacheStore.keys()].find(candidate => absolute(candidate) === target);
                return key === undefined ? false : cacheStore.delete(key);
            }
        };
        const caches = {
            open: async () => cache,
            keys: async () => [],
            delete: async () => true,
            match: async (request) => cache.match(request)
        };

        fetchCalls = [];
        fetchImpl = async (request) => {
            fetchCalls.push(request.url || request);
            return { ok: true, clone: () => ({ from: 'network' }), from: 'network' };
        };

        const load = new Function('self', 'caches', 'fetch', 'Response', 'URL', source);
        load(self, caches, (request) => fetchImpl(request), { error: () => ({ error: true }) }, URL);
    });

    // Минимальная замена FetchEvent: запоминает, вмешался ли обработчик.
    function dispatchFetch(url, { mode = 'no-cors', method = 'GET' } = {}) {
        const event = {
            request: { url, method, mode },
            responded: false,
            respondWith(promise) {
                this.responded = true;
                this.response = promise;
            }
        };
        handlers.fetch(event);
        return event;
    }

    it('никогда не трогает /api - там деньги и кука сессии', async () => {
        // Закешированный ответ API - это устаревшие остатки, показанные как
        // текущие, и финансовая история, оставшаяся в браузере после выхода.
        for (const url of [
            'https://budget.example/api/transactions',
            'https://budget.example/api/stats/balances',
            'https://budget.example/API/Transactions'
        ]) {
            const event = dispatchFetch(url);
            expect(event.responded, url).toBe(false);
        }

        expect(cacheStore.size).toBe(0);
    });

    it('не трогает ничего, кроме GET', async () => {
        const event = dispatchFetch('https://budget.example/assets/index-abc123.js', { method: 'POST' });

        expect(event.responded).toBe(false);
    });

    it('не кеширует банковские ответы и не заменяет ими офлайн-оболочку', async () => {
        const before = new Map(cacheStore);
        for (const url of [
            'https://budget.example/banking/callback.html?code=one-time&state=nonce',
            'https://budget.example/banking/privacy.html',
            'https://budget.example/BANKING/callback.js'
        ]) {
            expect(dispatchFetch(url, { mode: 'navigate' }).responded).toBe(false);
            expect(dispatchFetch(url).responded).toBe(false);
        }
        expect(cacheStore).toEqual(before);
    });

    it('не трогает чужие домены', async () => {
        const event = dispatchFetch('https://fonts.gstatic.com/s/inter/font.woff2');

        expect(event.responded).toBe(false);
    });

    it('кладёт бандлы в кеш и второй раз берёт оттуда, не ходя в сеть', async () => {
        const url = 'https://budget.example/assets/index-abc123.js';

        await dispatchFetch(url).response;
        expect(fetchCalls).toContain(url);
        expect(cacheStore.has(url)).toBe(true);

        const callsBefore = fetchCalls.length;
        const second = await dispatchFetch(url).response;
        expect(fetchCalls.length).toBe(callsBefore);
        expect(second).toBeDefined();
    });

    it('страницу берёт из сети, а офлайн - из кеша', async () => {
        const page = { ok: true, clone: () => ({ from: 'page' }), from: 'page' };
        fetchImpl = async () => page;

        const online = await dispatchFetch('https://budget.example/', { mode: 'navigate' }).response;
        expect(online).toBe(page);

        // Связи нет - должна отдаться сохранённая страница, а не ошибка.
        fetchImpl = async () => { throw new Error('офлайн'); };
        const offline = await dispatchFetch('https://budget.example/', { mode: 'navigate' }).response;
        expect(offline).toEqual({ from: 'page' });
    });

    describe('уборка старых бандлов', () => {
        const ORIGIN = 'https://budget.example';

        // Уборка запускается без ожидания (как и сама запись в кеш), поэтому
        // тесту нужно дать цепочке промисов отработать.
        async function settle() {
            for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 0));
        }

        function pageWith(html) {
            return { ok: true, text: async () => html, clone: () => ({ from: 'page', text: async () => html }) };
        }

        beforeEach(() => {
            cacheStore.clear();
            cacheStore.set('/', { from: 'old-page' });
            cacheStore.set(`${ORIGIN}/icon-192.png`, { from: 'icon' });
            cacheStore.set(`${ORIGIN}/manifest.webmanifest`, { from: 'manifest' });
            cacheStore.set(`${ORIGIN}/assets/index-old.js`, { from: 'old-js' });
            cacheStore.set(`${ORIGIN}/assets/index-old.css`, { from: 'old-css' });
            cacheStore.set(`${ORIGIN}/assets/index-new.js`, { from: 'new-js' });
        });

        it('после удачной загрузки страницы удаляет бандлы, на которые она уже не ссылается', async () => {
            // Хеши меняются с каждой сборкой, а сам кеш при выкате не
            // переименовывается: без уборки старые бандлы копились бы вечно.
            fetchImpl = async () => pageWith(
                '<script src="/assets/index-new.js"></script><link href="/assets/index-new.css">'
            );

            await dispatchFetch(`${ORIGIN}/`, { mode: 'navigate' }).response;
            await settle();

            expect(cacheStore.has(`${ORIGIN}/assets/index-old.js`)).toBe(false);
            expect(cacheStore.has(`${ORIGIN}/assets/index-old.css`)).toBe(false);
            // Живой бандл, оболочка и не-бандлы остаются.
            expect(cacheStore.has(`${ORIGIN}/assets/index-new.js`)).toBe(true);
            expect(cacheStore.get('/').from).toBe('page');
            expect(cacheStore.has(`${ORIGIN}/icon-192.png`)).toBe(true);
            expect(cacheStore.has(`${ORIGIN}/manifest.webmanifest`)).toBe(true);
        });

        it('если страница не ссылается ни на один бандл, ничего не удаляет', async () => {
            // Неожиданный 200 (заглушка, страница ошибки) не повод судить,
            // что в кеше устарело.
            fetchImpl = async () => pageWith('<html><body>Технические работы</body></html>');
            const before = [...cacheStore.keys()].sort();

            await dispatchFetch(`${ORIGIN}/`, { mode: 'navigate' }).response;
            await settle();

            expect([...cacheStore.keys()].sort()).toEqual(before);
        });

        it('офлайн ничего не удаляет', async () => {
            fetchImpl = async () => { throw new Error('офлайн'); };
            const before = [...cacheStore.keys()].sort();

            await dispatchFetch(`${ORIGIN}/`, { mode: 'navigate' }).response;
            await settle();

            expect([...cacheStore.keys()].sort()).toEqual(before);
        });
    });
});
