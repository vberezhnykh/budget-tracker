const ALLOWED_STATUSES = ['pending', 'skipped'];

function nonEmptyString(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed || null;
}

function positiveAmount(value) {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    if (typeof value === 'string' && value.trim() === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function utcDay(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
        return null;
    }
    return date;
}

function versionOf(body) {
    if (!body || !Number.isInteger(body.__v) || body.__v < 0) {
        return { error: '__v обязателен и должен быть целым неотрицательным числом' };
    }
    return { version: body.__v };
}

function normalizeCreate(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return { error: 'Тело платежа должно быть объектом' };
    }
    const title = nonEmptyString(body.title);
    const amount = positiveAmount(body.amount);
    const dueDate = utcDay(body.dueDate);
    const account = nonEmptyString(body.account);
    const category = nonEmptyString(body.category);
    if (!title) return { error: 'Название обязательно' };
    if (amount === null) return { error: 'Сумма должна быть положительным числом' };
    if (!dueDate) return { error: 'dueDate должен быть корректной датой YYYY-MM-DD' };
    if (!account) return { error: 'Счёт обязателен' };
    if (!category) return { error: 'Категория обязательна' };
    if (body.status !== undefined && body.status !== 'pending') {
        return { error: 'Новый платёж должен иметь статус pending' };
    }
    if (body.description !== undefined && typeof body.description !== 'string') {
        return { error: 'Описание должно быть строкой' };
    }
    return {
        payment: {
            title,
            amount,
            dueDate,
            account,
            category,
            description: typeof body.description === 'string' ? body.description.trim() : '',
            status: 'pending'
        }
    };
}

function normalizePatch(body, current) {
    const parsedVersion = versionOf(body);
    if (parsedVersion.error) return parsedVersion;
    const update = {};

    if (body.title !== undefined) {
        update.title = nonEmptyString(body.title);
        if (!update.title) return { error: 'Название обязательно' };
    }
    if (body.amount !== undefined) {
        update.amount = positiveAmount(body.amount);
        if (update.amount === null) return { error: 'Сумма должна быть положительным числом' };
    }
    if (body.dueDate !== undefined) {
        update.dueDate = utcDay(body.dueDate);
        if (!update.dueDate) return { error: 'dueDate должен быть корректной датой YYYY-MM-DD' };
    }
    for (const field of ['account', 'category']) {
        if (body[field] !== undefined) {
            update[field] = nonEmptyString(body[field]);
            if (!update[field]) return { error: `${field} обязателен` };
        }
    }
    if (body.description !== undefined) {
        if (typeof body.description !== 'string') return { error: 'Описание должно быть строкой' };
        update.description = body.description.trim();
    }
    if (body.status !== undefined) {
        if (!ALLOWED_STATUSES.includes(body.status)) return { error: 'Статус должен быть pending или skipped' };
        update.status = body.status;
    }

    return { update, version: parsedVersion.version, final: { ...current, ...update } };
}

function normalizePayBody(body) {
    const parsedVersion = versionOf(body);
    if (parsedVersion.error) return parsedVersion;
    if (body.transactionId !== undefined) {
        if (typeof body.transactionId !== 'string' || !body.transactionId) {
            return { error: 'Некорректный transactionId' };
        }
        return { mode: 'link', transactionId: body.transactionId, version: parsedVersion.version };
    }

    const amount = positiveAmount(body.amount);
    const date = utcDay(body.date);
    const account = nonEmptyString(body.account);
    const category = nonEmptyString(body.category);
    if (amount === null) return { error: 'Сумма должна быть положительным числом' };
    if (!date) return { error: 'date должен быть корректной датой YYYY-MM-DD' };
    if (!account) return { error: 'Счёт обязателен' };
    if (!category) return { error: 'Категория обязательна' };
    return { mode: 'create', amount, date, account, category, version: parsedVersion.version };
}

module.exports = { normalizeCreate, normalizePatch, normalizePayBody, utcDay, versionOf };
