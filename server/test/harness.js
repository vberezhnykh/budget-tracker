// Общая обвязка тестов роутов: своя база, авторизованный клиент, чистка
// между тестами. Держится отдельно от самих тестов, потому что каждая из
// этих вещей - ловушка, и ошибиться в ней проще, чем в проверке.

import { inject } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';

// Подключение к уже поднятой базе занимает миллисекунды, но первый файл в
// прогоне может прийти, пока mongod ещё разогревается, а на холодном
// раннере CI сервис-контейнер отвечает не сразу.
export const DB_HOOK_TIMEOUT = 60_000;

// Пароль и секрет тестового окружения. Не «отключаем» аутентификацию через
// AUTH_DISABLED: тот путь работает только при незаданных APP_PASSWORD /
// SESSION_SECRET и только с loopback, то есть заодно увёл бы из-под проверки
// сам гейт. Длины - минимально допустимые (см. server/auth.js): 8 и 32.
export const TEST_PASSWORD = 'test-password';
export const TEST_SECRET = 'test-session-secret-at-least-32-chars-long';

// URI один на весь прогон: его поднимает и отдаёт server/test/globalSetup.js -
// либо это сервис-контейнер из MONGODB_URI_TEST, либо поднятый им
// mongodb-memory-replset. Развилки в самих тестах при этом нет.
function resolveUri() {
    const uri = process.env.MONGODB_URI_TEST || inject('mongoUri');
    if (!uri) {
        throw new Error(
            'Нет URI базы для тестов. Их поднимает server/test/globalSetup.js - ' +
            'проверьте globalSetup в vitest.config.js.'
        );
    }
    return uri;
}

// dbName задаётся вызывающим и должен быть свой у каждого файла: vitest
// гоняет файлы параллельно, и общая база означала бы, что чистка из одного
// файла сносит фикстуры другого.
export async function connectTestDb(dbName) {
    process.env.APP_PASSWORD = TEST_PASSWORD;
    process.env.SESSION_SECRET = TEST_SECRET;
    delete process.env.AUTH_DISABLED;

    await mongoose.connect(resolveUri(), { dbName });

    // app.js импортируется только после подключения и только динамически:
    // статический import подняли бы наверх файла, и модель успела бы
    // зарегистрироваться раньше, чем выставлены переменные окружения выше.
    const app = (await import('../app.js')).default;

    // Уникальные индексы (Category { name, type }, Account { name }) строятся
    // асинхронно и в свежей базе к первому запросу ещё не готовы. Без этого
    // проверка «такая категория уже существует» проходила бы вхолостую:
    // дубликат просто записался бы, ошибки 11000 не случилось бы, а тест был
    // бы зелёным.
    await Promise.all(Object.values(mongoose.models).map(model => model.init()));

    return app;
}

// Инстанс базы общий на прогон и останавливается в globalSetup - здесь
// закрывается только своё подключение.
export async function disconnectTestDb() {
    await mongoose.disconnect();
}

// dropDatabase() пересоздал бы коллекции без индексов, поэтому чистим
// документы, а индексы оставляем на месте.
export async function clearCollections() {
    const collections = await mongoose.connection.db.collections();
    await Promise.all(collections.map(collection => collection.deleteMany({})));
}

// Логинится один раз и возвращает клиента с кукой сессии. Дальше все
// запросы идут через него - именно так, как ходит браузер.
export async function loginAgent(app) {
    const agent = request.agent(app);
    const res = await agent.post('/api/login').send({ password: TEST_PASSWORD });
    if (res.status !== 200) {
        throw new Error(`Не удалось залогиниться в тестовом приложении: ${res.status} ${JSON.stringify(res.body)}`);
    }
    return agent;
}

// Фикстуры. Даты пишутся с явным Z: операции хранятся как UTC-полночь, и
// границы периода в transactionQuery.js тоже считаются в UTC, так что дата
// без зоны сделала бы тест зелёным в одной зоне и красным в другой.
export function tx(overrides = {}) {
    return {
        title: 'Операция',
        amount: 100,
        type: 'expense',
        category: 'Продукты',
        account: 'acc-1',
        date: '2026-03-15T00:00:00.000Z',
        ...overrides
    };
}
