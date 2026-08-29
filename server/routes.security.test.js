// @vitest-environment node
//
// Заголовки безопасности. Проверяются две вещи, и вторая не менее важная,
// чем первая: что политика стоит - и что она не запрещает того, на чём
// приложение работает. Слишком строгий CSP ломает интерфейс молча, в
// браузере пользователя, а не в сборке.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { connectTestDb, disconnectTestDb, DB_HOOK_TIMEOUT } from './test/harness.js';

let app;

beforeAll(async () => {
    app = await connectTestDb('routes-security');
}, DB_HOOK_TIMEOUT);

afterAll(disconnectTestDb, DB_HOOK_TIMEOUT);

// Разбирает Content-Security-Policy в { директива: [источники] }.
function parseCsp(header) {
    return Object.fromEntries(
        header.split(';')
            .map(part => part.trim())
            .filter(Boolean)
            .map((part) => {
                const [name, ...sources] = part.split(/\s+/);
                return [name, sources];
            })
    );
}

describe('Заголовки безопасности', () => {
    it('ставятся и на неавторизованные ответы тоже', async () => {
        // /api/health доступен без куки, и заголовки на нём должны быть -
        // middleware стоит до всего, а не после гейта.
        const res = await request(app).get('/api/health');

        expect(res.status).toBe(200);
        expect(res.headers['content-security-policy']).toBeDefined();
        expect(res.headers['x-content-type-options']).toBe('nosniff');
        expect(res.headers['referrer-policy']).toBeDefined();
    });

    it('не сообщает, на чём написан сервер', async () => {
        const res = await request(app).get('/api/health');

        expect(res.headers['x-powered-by']).toBeUndefined();
    });

    it('запрещает встраивание в чужую страницу', async () => {
        const res = await request(app).get('/api/health');
        const csp = parseCsp(res.headers['content-security-policy']);

        expect(csp['frame-ancestors']).toEqual(["'none'"]);
    });

    it('пускает только свои скрипты и никакие плагины', async () => {
        const res = await request(app).get('/api/health');
        const csp = parseCsp(res.headers['content-security-policy']);

        expect(csp['script-src']).toEqual(["'self'"]);
        expect(csp['object-src']).toEqual(["'none'"]);
        expect(csp['base-uri']).toEqual(["'self'"]);
        expect(csp['default-src']).toEqual(["'self'"]);
    });

    it('разрешает инлайновые стили - без них интерфейс осыпется', async () => {
        // В компонентах больше трёхсот атрибутов style={{}} и несколько
        // блоков <style>. CSP распространяется и на атрибут style, поэтому
        // без 'unsafe-inline' приложение открылось бы без вёрстки.
        const res = await request(app).get('/api/health');
        const csp = parseCsp(res.headers['content-security-policy']);

        expect(csp['style-src']).toContain("'unsafe-inline'");
    });

    it('пускает шрифты Google - на них завязан src/index.css', async () => {
        const res = await request(app).get('/api/health');
        const csp = parseCsp(res.headers['content-security-policy']);

        // Таблица стилей приезжает с googleapis, сами файлы шрифтов - с
        // gstatic. Забыть второй хост - обычная ошибка: стили загрузятся,
        // а шрифт молча подменится системным.
        expect(csp['style-src']).toContain('https://fonts.googleapis.com');
        expect(csp['font-src']).toContain('https://fonts.gstatic.com');
    });

    it('разрешает манифест и service worker', async () => {
        const res = await request(app).get('/api/health');
        const csp = parseCsp(res.headers['content-security-policy']);

        expect(csp['manifest-src']).toEqual(["'self'"]);
        expect(csp['worker-src']).toEqual(["'self'"]);
    });

    it('вне продакшена не требует апгрейда до https', async () => {
        // Собранное приложение проверяют локально по http://localhost -
        // upgrade-insecure-requests сломал бы эту проверку на ровном месте.
        const res = await request(app).get('/api/health');

        expect(res.headers['content-security-policy']).not.toContain('upgrade-insecure-requests');
    });
});
