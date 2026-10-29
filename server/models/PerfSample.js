const mongoose = require('mongoose');

// Замеры скорости: диагностика, а не данные пользователя. В них только пути
// запросов, длительности, размеры и флаги - ни сумм, ни названий, ни текста
// поиска (путь приводится к виду /api/transactions/:id до записи, строка
// запроса отбрасывается). Поэтому коллекция не входит в бэкап (см.
// BACKUP_COLLECTIONS в backup-core.js) и не восстанавливается из него.
//
// Хранятся 14 дней и стираются сами по TTL-индексу: замеров за день-два
// достаточно, чтобы решить, что оптимизировать, а свободное место на M0
// ограничено. Коллекцию можно удалить целиком, ничего не потеряв.
//
// Одна коллекция на три вида записей, различаются полем kind:
//   server - один API-запрос, замеренный на сервере;
//   boot   - один запуск процесса (сколько ушло на подключение и засев);
//   client - пакет замеров с телефона (запуск приложения или запросы).
// Схема строгая: поля вне списка Mongoose молча отбрасывает.
const KINDS = ['server', 'boot', 'client'];
const CLIENT_EVENTS = ['startup', 'requests'];
const RETENTION_SECONDS = 14 * 24 * 60 * 60;

const ms = { type: Number, min: 0 };

const ClientRequestSchema = new mongoose.Schema({
    path: { type: String, required: true, maxlength: 200 },
    startTime: { ...ms, required: true },
    duration: { ...ms, required: true },
    transferSize: ms,
    // Из Server-Timing ответа: что сервер сам сообщил про этот запрос.
    serverTotal: ms,
    serverDb: ms,
    serverCalc: ms
}, { _id: false });

const PerfSampleSchema = new mongoose.Schema({
    kind: { type: String, required: true, enum: KINDS },
    at: { type: Date, required: true },

    // kind: 'server'
    method: { type: String, maxlength: 10 },
    path: { type: String, maxlength: 200 },
    status: { type: Number, min: 100, max: 599 },
    totalMs: ms,
    dbMs: ms,
    calcMs: ms,
    // Кэш операций в памяти сервера: hit - данные были в памяти, stale - отданы
    // устаревшие с обновлением в фоне, miss - читали базу. Нет поля - роут кэш
    // не использует.
    cache: { type: String, enum: ['hit', 'miss', 'stale'] },
    // Готовый ответ (responseMemo): hit - отдан без расчёта, miss - посчитан в
    // этом запросе. Нет поля - роут готовые ответы не использует.
    memo: { type: String, enum: ['hit', 'miss'] },
    // Content-Length ответа, если он был выставлен.
    bytes: ms,
    // process.uptime() в секундах на начало запроса: видно, какие запросы
    // обслужены сразу после холодного старта.
    uptime: ms,

    // kind: 'boot'
    connectMs: ms,
    seedMs: ms,
    sinceProcessStartMs: ms,

    // kind: 'client'
    event: { type: String, enum: CLIENT_EVENTS },
    // Случайный идентификатор загрузки страницы: связывает записи одного сеанса.
    pageId: { type: String, maxlength: 64 },
    page: {
        type: new mongoose.Schema({
            responseStart: ms,
            fromCache: Boolean,
            viaWorker: Boolean
        }, { _id: false })
    },
    dataReadyAt: ms,
    standalone: Boolean,
    // performance.now() в момент отправки: по нему из startTime записи
    // восстанавливается её приблизительное время на часах сервера.
    sentAt: ms,
    requests: { type: [ClientRequestSchema], default: undefined }
}, { versionKey: false, strict: true });

PerfSampleSchema.index({ at: 1 }, { expireAfterSeconds: RETENTION_SECONDS });

module.exports = mongoose.model('PerfSample', PerfSampleSchema);
