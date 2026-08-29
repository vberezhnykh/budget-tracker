// Разбор параметров выборки для GET /api/transactions: период (from/to) и
// постраничная отдача (limit/skip).
//
// Отдельным модулем - по той же причине, что и transactionInput.js: чистую
// функцию можно покрыть тестами напрямую, без поднятого сервера и базы.
//
// Совместимость намеренная: запрос без параметров означает ровно то же, что
// и раньше, - вся история одним массивом, отсортированная по убыванию даты.
// Фронтенд сегодня считает из полного массива всё (балансы, статистику за
// всё время, ряды по месяцам, поиск - см. src/utils/finance.js), поэтому
// перевести его на страницы можно будет только после того, как агрегаты
// переедут на сервер. До тех пор эти параметры - то, на что он будет
// переезжать, а не то, что у него отнимают.

// Верхняя граница на limit: она защищает не столько базу, сколько сервер и
// сеть - ответ с сотней тысяч документов всё равно никому не нужен, а вот
// память процесса он съест. Запрос без limit по-прежнему отдаёт всё: это
// осознанное поведение по умолчанию, а не недосмотр.
const MAX_LIMIT = 5000;

const MONTH_RE = /^\d{4}-\d{2}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// Границы периода считаются в UTC, потому что даты операций хранятся как
// UTC-полночь: фронт присылает 'YYYY-MM-DD', и Date разбирает такую строку
// именно как UTC. Считать их в локальной зоне сервера значило бы сдвигать
// границу месяца на несколько часов - и терять или прихватывать операции
// по краям периода в зависимости от того, где этот сервер запущен.
//
// Возвращает полуинтервал [start, endExclusive): верхняя граница - начало
// следующего дня или месяца. Так не нужно угадывать, с какой точностью
// хранится время внутри дня.
function parseBoundary(raw) {
    if (typeof raw !== 'string') return null;
    const value = raw.trim();

    if (MONTH_RE.test(value)) {
        const [year, month] = value.split('-').map(Number);
        if (month < 1 || month > 12) return null;
        return {
            start: new Date(Date.UTC(year, month - 1, 1)),
            endExclusive: new Date(Date.UTC(year, month, 1)),
        };
    }

    if (DAY_RE.test(value)) {
        const [year, month, day] = value.split('-').map(Number);
        const start = new Date(Date.UTC(year, month - 1, day));
        // Отсекает даты вроде 2026-02-31: Date их не отвергает, а
        // переносит на следующий месяц, и обратная проверка это ловит.
        if (Number.isNaN(start.getTime()) || start.getUTCMonth() !== month - 1 || start.getUTCDate() !== day) {
            return null;
        }
        return {
            start,
            endExclusive: new Date(Date.UTC(year, month - 1, day + 1)),
        };
    }

    return null;
}

function parseCount(raw, { min }) {
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min) return null;
    return value;
}

function isPresent(query, key) {
    return Object.prototype.hasOwnProperty.call(query, key)
        && query[key] !== undefined
        && query[key] !== '';
}

// Возвращает либо { error } с сообщением, либо { filter, limit, skip },
// где limit === null означает «без ограничения».
function parseTransactionQuery(query) {
    if (!query || typeof query !== 'object' || Array.isArray(query)) {
        return { filter: {}, limit: null, skip: 0 };
    }

    const dateFilter = {};

    if (isPresent(query, 'from')) {
        const from = parseBoundary(query.from);
        if (!from) {
            return { error: 'Некорректное значение from: ожидается YYYY-MM или YYYY-MM-DD' };
        }
        dateFilter.$gte = from.start;
    }

    if (isPresent(query, 'to')) {
        const to = parseBoundary(query.to);
        if (!to) {
            return { error: 'Некорректное значение to: ожидается YYYY-MM или YYYY-MM-DD' };
        }
        // Граница включающая: to=2026-08 означает «по август включительно»,
        // то есть строго меньше 1 сентября.
        dateFilter.$lt = to.endExclusive;
    }

    if (dateFilter.$gte && dateFilter.$lt && dateFilter.$gte >= dateFilter.$lt) {
        return { error: 'Период пуст: from позже, чем to' };
    }

    let limit = null;
    if (isPresent(query, 'limit')) {
        limit = parseCount(query.limit, { min: 1 });
        if (limit === null) {
            return { error: 'limit должен быть целым числом больше нуля' };
        }
        if (limit > MAX_LIMIT) {
            return { error: `limit не может превышать ${MAX_LIMIT}` };
        }
    }

    let skip = 0;
    if (isPresent(query, 'skip')) {
        skip = parseCount(query.skip, { min: 0 });
        if (skip === null) {
            return { error: 'skip должен быть целым неотрицательным числом' };
        }
    }

    const filter = Object.keys(dateFilter).length > 0 ? { date: dateFilter } : {};
    return { filter, limit, skip };
}

module.exports = { parseTransactionQuery, MAX_LIMIT };
