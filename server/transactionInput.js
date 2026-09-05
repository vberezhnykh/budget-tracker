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
// недопустимую сумму и нечитаемую дату. Такая операция потом
// ломала подсчёты на фронте: transformTransactions выводит знак суммы
// из типа (income/initial - плюс, всё остальное - минус), и тип вне
// перечисления молча попадает в «минус».
//
// Обновление остаётся частичным: проверяются и переписываются только те
// поля, которые реально пришли в запросе. Ключ, которого в теле нет,
// в объект обновления не попадает и потому сохранённое значение не трогает.
//
// Ровно одно исключение из этого правила - toAccount, см. ниже: у операции,
// переставшей быть переводом, поле «куда» не может остаться от прежней
// жизни, а частичное обновление само его не снимет.

const TRANSACTION_TYPES = ['income', 'expense', 'initial', 'transfer'];

// Суммы движений хранятся положительными - знак операции задаётся её типом
// (см. transformTransactions в src/utils/finance.js). Исключение - initial:
// его отрицательное значение означает долг на момент начала учёта.
// Ноль не несёт движения или начального остатка и всегда отклоняется.
// Number.isFinite отсекает заодно NaN и Infinity: JSON вида 1e999
// разбирается именно в Infinity, а не в ошибку разбора.
function parseAmount(raw, type) {
    if (typeof raw !== 'number' && typeof raw !== 'string') return null;
    if (typeof raw === 'string' && raw.trim() === '') return null;
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount === 0) return null;

    // Начальный остаток может быть отрицательным: так хранится долг на
    // счёте в момент начала учёта. Для всех движений после этой точки знак
    // по-прежнему задаётся типом операции, поэтому их суммы положительные.
    if (amount < 0 && type !== 'initial') return null;
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
function validateTransactionState(state) {
    if (!TRANSACTION_TYPES.includes(state.type)) {
        return `Недопустимый тип операции. Допустимые: ${TRANSACTION_TYPES.join(', ')}`;
    }

    if (parseAmount(state.amount, state.type) === null) {
        return state.type === 'initial'
            ? 'Сумма начального остатка должна быть ненулевым числом'
            : 'Сумма должна быть положительным числом';
    }

    if (nonEmptyString(state.title) === null) return 'Название обязательно';
    if (nonEmptyString(state.account) === null) return 'Счёт обязателен';

    const date = state.date instanceof Date ? state.date : new Date(state.date);
    if (state.date === null || state.date === '' || Number.isNaN(date.getTime())) {
        return 'Некорректная дата';
    }

    if (state.type === 'transfer') {
        const toAccount = nonEmptyString(state.toAccount);
        if (toAccount === null) return 'Для перевода обязателен счёт назначения';
        if (toAccount === nonEmptyString(state.account)) {
            return 'Счета отправления и назначения должны различаться';
        }
    } else if (nonEmptyString(state.category) === null) {
        return 'Категория обязательна';
    }

    return null;
}

function validateTransactionVersion(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return { error: 'Тело запроса должно быть объектом' };
    }
    if (!Object.prototype.hasOwnProperty.call(body, '__v')
        || !Number.isInteger(body.__v)
        || body.__v < 0) {
        return { error: '__v обязателен и должен быть целым неотрицательным числом' };
    }
    return { expectedVersion: body.__v };
}

function validateTransactionUpdate(body, currentTransaction = null) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return { error: 'Тело запроса должно быть объектом' };
    }

    const update = {};
    // Поля, которые надо не переписать, а убрать из документа ($unset).
    const unset = [];

    if (isPresent(body, 'type')) {
        if (!TRANSACTION_TYPES.includes(body.type)) {
            return { error: `Недопустимый тип операции. Допустимые: ${TRANSACTION_TYPES.join(', ')}` };
        }
        update.type = body.type;
    }

    if (isPresent(body, 'amount')) {
        const finalType = body.type !== undefined ? body.type : currentTransaction?.type;
        const amount = parseAmount(body.amount, finalType);
        if (amount === null) {
            return {
                error: finalType === 'initial'
                    ? 'Сумма начального остатка должна быть ненулевым числом'
                    : 'Сумма должна быть положительным числом'
            };
        }
        update.amount = amount;
    }

    if (isPresent(body, 'date')) {
        if (body.date === null || body.date === '' || typeof body.date === 'boolean' || Array.isArray(body.date)) {
            return { error: 'Некорректная дата' };
        }
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

    // «Куда» есть только у перевода. Форма при сохранении не-перевода
    // просто не кладёт toAccount в тело (см. handleSubmit в
    // src/components/AddTransactionForm.jsx), а частичное обновление
    // отсутствующие поля не трогает - поэтому у перевода, переделанного в
    // расход, поле оставалось от прежней жизни. Читать его у не-перевода
    // сейчас некому, но это ложные данные в базе, и первый же отчёт по
    // переводам на них споткнётся.
    //
    // Поэтому при явной смене типа на не-перевод поле снимается, а
    // присланное вместе с таким типом значение игнорируется: «расход, но
    // куда-то» - противоречие, и разрешать его молча записью не стоит.
    // Когда типа в теле нет, поле не трогается вовсе: обновление одной
    // только суммы не должно ничего вычищать.
    const becomesNonTransfer = update.type !== undefined && update.type !== 'transfer';
    if (becomesNonTransfer) {
        unset.push('toAccount');
    } else if (isPresent(body, 'toAccount')) {
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
        if (typeof body.excludeFromStats !== 'boolean') {
            return { error: 'excludeFromStats должен быть логическим значением' };
        }
        update.excludeFromStats = body.excludeFromStats;
    }

    // Для частичного PUT проверяем состояние, полученное из прочитанного
    // документа и этого запроса, а не только поля из тела. Иначе expense ->
    // transfer без toAccount или transfer -> expense без category проходили
    // по отдельности валидный patch. Это проверка одного запроса; она не
    // заменяет optimistic concurrency при одновременных обновлениях.
    if (currentTransaction) {
        const current = typeof currentTransaction.toObject === 'function'
            ? currentTransaction.toObject()
            : currentTransaction;
        const finalState = { ...current, ...update };
        for (const field of unset) delete finalState[field];

        const stateError = validateTransactionState(finalState);
        if (stateError) return { error: stateError };
    }

    return { update, unset };
}

// Строгая нормализация для одиночного и пакетного POST. Оба пути должны
// принимать одинаковую форму операции; разница между ними только в splitId.
function validateTransactionCreate(body, { allowSplitId = false } = {}) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return { error: 'Операция должна быть объектом' };
    }

    const { error, update } = validateTransactionUpdate(body);
    if (error) return { error };

    // Как и раньше, пустое название обычной операции заменяется категорией.
    if (!isPresent(body, 'title')) {
        const fallback = nonEmptyString(body.category);
        if (fallback !== null) update.title = fallback;
    }

    if (allowSplitId && isPresent(body, 'splitId')) {
        const splitId = nonEmptyString(body.splitId);
        if (splitId === null) return { error: 'Некорректный splitId' };
        update.splitId = splitId;
    }

    const stateError = validateTransactionState(update);
    if (stateError) return { error: stateError };
    return { transaction: update };
}

module.exports = {
    validateTransactionCreate,
    validateTransactionUpdate,
    validateTransactionState,
    validateTransactionVersion,
    TRANSACTION_TYPES
};
