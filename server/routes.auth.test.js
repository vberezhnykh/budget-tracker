// @vitest-environment node
//
// Гейт аутентификации на живом приложении.
//
// auth.test.js проверяет чистые куски по отдельности - подпись токена,
// сравнение пароля, лимитер. Здесь проверяется то, что из них собрано:
// что middleware действительно стоит перед роутами и что его нельзя обойти
// порядком регистрации.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { connectTestDb, disconnectTestDb, clearCollections, TEST_PASSWORD, DB_HOOK_TIMEOUT } from './test/harness.js';

let app;

beforeAll(async () => {
    app = await connectTestDb('routes-auth');
}, DB_HOOK_TIMEOUT);

afterAll(disconnectTestDb, DB_HOOK_TIMEOUT);
beforeEach(clearCollections);

// Лимитер входа глобален для процесса и живёт в модульной Map: пять неверных
// паролей в одном тесте закрыли бы вход всем следующим. Сбросить его из теста
// нельзя - resetLoginRateLimiter(), полученный через import, оказывается из
// другого экземпляра модуля, чем тот, что подключил app.js через require, и
// на лимитер приложения не влияет.
//
// Поэтому изоляция делается тем же способом, каким лимитер и разделяет
// клиентов, - по IP. app.set('trust proxy', 1) означает, что req.ip берётся
// из X-Forwarded-For, так что каждый тест, который жжёт попытки, работает со
// своего адреса. Заодно это проверяет и сам trust proxy: без него все
// запросы приходили бы с 127.0.0.1 и блокировали друг друга.
const loginFrom = (ip) => request(app).post('/api/login').set('X-Forwarded-For', ip);

describe('Гейт /api/*', () => {
    it('без куки не пускает ни к одному роуту данных', async () => {
        const routes = [
            ['get', '/api/transactions'],
            ['get', '/api/accounts'],
            ['get', '/api/categories'],
            ['get', '/api/settings'],
            ['get', '/api/stats/balances'],
            ['get', '/api/stats/monthly'],
            ['post', '/api/transactions'],
            ['put', '/api/settings']
        ];

        for (const [method, path] of routes) {
            const res = await request(app)[method](path);
            expect(res.status, `${method.toUpperCase()} ${path}`).toBe(401);
        }
    });

    it('пропускает без куки только вход и проверку здоровья', async () => {
        expect((await request(app).get('/api/health')).status).toBe(200);
        // Вход без пароля - это 401, а не 401 «не авторизован» от гейта:
        // важно, что запрос до роута вообще доходит.
        expect((await request(app).post('/api/login').send({})).status).toBe(401);
    });

    it('не даёт обойти гейт регистром пути', async () => {
        const res = await request(app).get('/API/Transactions');

        expect(res.status).toBe(401);
    });
});

describe('POST /api/login', () => {
    it('на верный пароль ставит куку, и с ней запросы проходят', async () => {
        const agent = request.agent(app);

        const login = await agent.post('/api/login').send({ password: TEST_PASSWORD });

        expect(login.status).toBe(200);
        expect(login.headers['set-cookie'].join(';')).toContain('HttpOnly');
        expect((await agent.get('/api/transactions')).status).toBe(200);
    });

    it('на неверный пароль отвечает 401 и куки не ставит', async () => {
        const res = await request(app).post('/api/login').send({ password: 'не-тот-пароль' });

        expect(res.status).toBe(401);
        expect(res.headers['set-cookie']).toBeUndefined();
    });

    it('после пяти неудач блокирует вход, даже с верным паролем', async () => {
        const ip = '203.0.113.10';

        for (let attempt = 0; attempt < 5; attempt += 1) {
            expect((await loginFrom(ip).send({ password: 'не-тот-пароль' })).status).toBe(401);
        }

        // Лимит проверяется до пароля - иначе по разнице ответов можно было
        // бы отличить «сервер не настроен» от «пароль неверный».
        expect((await loginFrom(ip).send({ password: TEST_PASSWORD })).status).toBe(429);
    });

    it('блокировка одного адреса не закрывает вход остальным', async () => {
        const blocked = '203.0.113.11';
        const innocent = '203.0.113.12';

        for (let attempt = 0; attempt < 5; attempt += 1) {
            await loginFrom(blocked).send({ password: 'не-тот-пароль' });
        }

        expect((await loginFrom(blocked).send({ password: TEST_PASSWORD })).status).toBe(429);
        expect((await loginFrom(innocent).send({ password: TEST_PASSWORD })).status).toBe(200);
    });

    it('удачный вход сбрасывает счётчик неудач', async () => {
        const ip = '203.0.113.13';

        for (let attempt = 0; attempt < 4; attempt += 1) {
            await loginFrom(ip).send({ password: 'не-тот-пароль' });
        }
        expect((await loginFrom(ip).send({ password: TEST_PASSWORD })).status).toBe(200);

        // Если бы счётчик не сбрасывался, эти четыре неудачи стали бы
        // пятой-восьмой подряд и вход закрылся бы.
        for (let attempt = 0; attempt < 4; attempt += 1) {
            await loginFrom(ip).send({ password: 'не-тот-пароль' });
        }
        expect((await loginFrom(ip).send({ password: TEST_PASSWORD })).status).toBe(200);
    });
});

describe('POST /api/logout', () => {
    it('снимает куку, и запросы снова упираются в гейт', async () => {
        const agent = request.agent(app);
        await agent.post('/api/login').send({ password: TEST_PASSWORD });
        expect((await agent.get('/api/transactions')).status).toBe(200);

        const res = await agent.post('/api/logout');

        expect(res.status).toBe(200);
        expect((await agent.get('/api/transactions')).status).toBe(401);
    });
});

describe('GET /api/health', () => {
    it('отвечает JSON, а не страницей, и сообщает, что сервер настроен', async () => {
        const res = await request(app).get('/api/health');

        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/application\/json/);
        expect(res.body.configured).toBe(true);
    });
});
