// Проверка и приведение тела запроса при обновлении транзакции.
//
// Живёт отдельным модулем, а не внутри обработчика роута, по той же причине,
// что и чистые куски аутентификации в auth.js: так это можно покрыть
// юнит-тестами напрямую, без поднятого сервера и без базы.
//
// Зачем это вообще понадобилось: PUT /api/transactions/:id обновляет
// документ через findByIdAndUpdate, а он, в отличие от save(), по умолчанию
// схему НЕ применяет (runValidators выключен). POST создаёт документ через
// new Transaction(...).save() и потому защищён enum'ом из модели, а вот
// через PUT до сих пор можно было записать type, которого в enum нет,
// нулевую или отрицательную сумму и нечитаемую дату. Такая операция потом
// ломала подсчёты на фронте: transformTransactions выводит знак суммы
// из типа (income/initial - плюс, всё остальное - минус), и тип вне
// перечисления молча попадает в «минус».
//
// Обновление остаётся частичным: проверяются и переписываются только те
// поля, которые реально пришли в запросе. Ключ, которого в теле нет,
// в объект обновления не попадает и потому сохранённое значение не трогает.

const TRANSACTION_TYPES = ['income', 'expense', 'initial', 'transfer'];

// Суммы хранятся положительными - знак операции задаётся её типом
// (см. transformTransactions в src/utils/finance.js). Поэтому ноль и
// отрицательное значение здесь не «другая сторона операции», а мусор.
// Number.isFinite отсекает заодно NaN и Infinity: JSON вида 1e999
// разбирается именно в Infinity, а не в ошибку разбора.
function parseAmount(raw) {
    if (typeof raw === 'boolean' || raw === null || raw === '') return null;
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    return amount;
}

function isPresent(body, key) {
    return Object.prototype.hasOwnProperty.call(body, key) && body[key] !== undefined;
}

function nonEmptyString(raw) {
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    return trimmed === '' ? null : trimmed;
}

// Возвращает либо { error } с сообщением для пользователя, либо { update } -
// готовый объект для findByIdAndUpdate, содержащий только проверенные поля.
function validateTransactionUpdate(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return { error: 'Тело запроса должно быть объектом' };
    }

    const update = {};

    if (isPresent(body, 'type')) {
        if (!TRANSACTION_TYPES.includes(body.type)) {
            return { error: `Недопустимый тип операции. Допустимые: ${TRANSACTION_TYPES.join(', ')}` };
        }
        update.type = body.type;
    }

    if (isPresent(body, 'amount')) {
        const amount = parseAmount(body.amount);
        if (amount === null) {
            return { error: 'Сумма должна быть положительным числом' };
        }
        update.amount = amount;
    }

    if (isPresent(body, 'date')) {
        const date = new Date(body.date);
        if (Number.isNaN(date.getTime())) {
            return { error: 'Некорректная дата' };
        }
        update.date = date;
    }

    // Переводу категория не нужна (в модели она required только для
    // остальных типов), поэтому пустое значение для него - не ошибка, а
    // просто повод не трогать поле. Для всех прочих типов пустая категория
    // упёрлась бы в required уже на уровне схемы, но там она превратилась
    // бы в 500-подобное сообщение mongoose вместо внятного ответа.
    if (isPresent(body, 'category')) {
        const category = nonEmptyString(body.category);
        if (category === null) {
            if (body.type !== 'transfer') {
                return { error: 'Категория обязательна' };
            }
        } else {
            update.category = category;
        }
    }

    if (isPresent(body, 'account')) {
        const account = nonEmptyString(body.account);
        if (account === null) {
            return { error: 'Счёт обязателен' };
        }
        update.account = account;
    }

    if (isPresent(body, 'toAccount')) {
        const toAccount = nonEmptyString(body.toAccount);
        if (toAccount !== null) {
            update.toAccount = toAccount;
        }
    }

    // Название в модели обязательно, но форма его может и не заполнить -
    // тогда, как и при создании (см. POST /api/transactions), подставляется
    // категория.
    if (isPresent(body, 'title')) {
        const title = nonEmptyString(body.title);
        const fallback = update.category || nonEmptyString(body.category);
        if (title === null && fallback === null) {
            return { error: 'Название обязательно' };
        }
        update.title = title || fallback;
    }

    if (isPresent(body, 'description')) {
        const description = nonEmptyString(body.description);
        update.description = description === null ? '' : description;
    }

    if (isPresent(body, 'excludeFromStats')) {
        update.excludeFromStats = Boolean(body.excludeFromStats);
    }

    return { update };
}

module.exports = { validateTransactionUpdate, TRANSACTION_TYPES };
