// Один mongod на весь прогон.
//
// Изначально базу поднимал каждый файл тестов роутов сам. Изоляция при этом
// была честная, но шесть mongod'ов рядом с jsdom-сьютами фронтенда съедали
// машину: прогон становился флаки - то падали хуки роутов по таймауту
// запуска инстанса, то произвольный тест фронтенда, и каждый раз в разном
// месте. Один инстанс на прогон снимает и это, и минуту с времени прогона.
//
// Изоляция никуда не делась: каждый файл работает в своей базе внутри этого
// инстанса (dbName в connectTestDb), а чистка идёт по коллекциям своей базы.
//
// URI уезжает тестам через provide/inject, а не через process.env: воркеры
// vitest - отдельные процессы, и полагаться на то, что переменная,
// выставленная здесь, доедет до них, не стоит.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export default async function setup({ provide }) {
    // В CI база уже поднята сервис-контейнером mongo:7 - поднимать свою
    // незачем (и нечем: бинарника на раннере нет, он бы качался).
    if (process.env.MONGODB_URI_TEST) {
        provide('mongoUri', process.env.MONGODB_URI_TEST);
        return;
    }

    // Вне node_modules: оттуда бинарник сносит каждая переустановка
    // зависимостей, а это ~780 МБ загрузки заново.
    process.env.MONGOMS_DOWNLOAD_DIR ||= path.join(REPO_ROOT, '.cache', 'mongodb-binaries');

    const { MongoMemoryReplSet } = await import('mongodb-memory-server');
    // Дефолтные 10 секунд не покрывают ни первый запуск после скачивания,
    // ни холодный старт под нагрузкой.
    const server = await MongoMemoryReplSet.create({
        replSet: { count: 1 },
        instanceOpts: [{ launchTimeout: 60_000 }]
    });
    provide('mongoUri', server.getUri());

    return async () => {
        await server.stop();
    };
}
