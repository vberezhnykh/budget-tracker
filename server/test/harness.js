// Общая обвязка тестов роутов: своя база, авторизованный клиент, чистка
// между тестами. Держится отдельно от самих тестов, потому что каждая из
// этих вещей - ловушка, и ошибиться в ней проще, чем в проверке.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import request from 'supertest';

// Первый прогон качает mongod (~780 МБ) и в дефолтном месте кладёт его в
// server/node_modules/.cache - то есть теряет при каждой переустановке
// зависимостей. Отсюда явный каталог вне node_modules (в .gitignore).
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
process.env.MONGOMS_DOWNLOAD_DIR ||= path.join(REPO_ROOT, '.cache', 'mongodb-binaries');

// Скачивание и холодный старт mongod в дефолтные 10 секунд vitest не
// укладываются. Прогретый инстанс поднимается примерно за секунду, но
// закладываться надо на первый запуск и на CI.
export const DB_HOOK_TIMEOUT = 180_000;

// Пароль и секрет тестового окружения. Не «отключаем» аутентификацию через
// AUTH_DISABLED: тот путь работает только при незаданных APP_PASSWORD /
// SESSION_SECRET и только с loopback, то есть заодно увёл бы из-под проверки
// сам гейт. Длины - минимально допустимые (см. server/auth.js): 8 и 32.
export const TEST_PASSWORD = 'test-password';
export const TEST_SECRET = 'test-session-secret-at-least-32-chars-long';

let memoryServer = null;

// URI берётся из окружения, а memory-server поднимается только когда
// переменной нет. Так одни и те же тесты идут локально на скачанном mongod и
// в CI на сервис-контейнере mongo:7, без развилки в самих тестах.
async function resolveUri() {
    if (process.env.MONGODB_URI_TEST) return process.env.MONGODB_URI_TEST;

    const { MongoMemoryServer } = await import('mongodb-memory-server');
    // Свой launchTimeout вместо дефолтных 10 секунд: прогретый mongod
    // поднимается примерно за секунду, но первый запуск после скачивания
    // (и запуск на холодном раннере CI) в десять секунд не укладывается, и
    // падение выглядит как «инстанс не стартовал», хотя он просто не успел.
    memoryServer = await MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } });
    return memoryServer.getUri();
}

// dbName задаётся вызывающим и должен быть свой у каждого файла: vitest
// гоняет файлы параллельно, и общая база означала бы, что чистка из одного
// файла сносит фикстуры другого.
export async function connectTestDb(dbName) {
    process.env.APP_PASSWORD = TEST_PASSWORD;
    process.env.SESSION_SECRET = TEST_SECRET;
    delete process.env.AUTH_DISABLED;

    const uri = await resolveUri();
    await mongoose.connect(uri, { dbName });

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

export async function disconnectTestDb() {
    await mongoose.disconnect();
    if (memoryServer) {
        await memoryServer.stop();
        memoryServer = null;
    }
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
