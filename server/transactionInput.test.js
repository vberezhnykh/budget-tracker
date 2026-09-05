import { describe, it, expect } from 'vitest';
import {
    validateTransactionCreate,
    validateTransactionUpdate,
    validateTransactionVersion
} from './transactionInput.js';

// Полное тело, какое присылает форма редактирования (см. handleSubmit в
// src/components/AddTransactionForm.jsx): отдельные проверки ниже правят в
// нём одно поле, чтобы было видно, что именно проверяется.
const validBody = () => ({
    title: 'Обед',
    amount: 12.5,
    type: 'expense',
    category: 'Кафе и доставка',
    description: 'с коллегами',
    account: 'acc-card-1',
    date: '2026-08-14',
    excludeFromStats: false,
});

describe('validateTransactionUpdate: тип операции', () => {
    // Собственно та дыра, ради которой всё затевалось: findByIdAndUpdate не
    // применяет enum из модели, так что до проверки такой тип доезжал до
    // базы и ломал знак суммы на фронте.
    it('отклоняет тип вне перечисления модели', () => {
        const { error, update } = validateTransactionUpdate({ ...validBody(), type: 'ерунда' });
        expect(update).toBeUndefined();
        expect(error).toMatch(/тип операции/i);
    });

    it.each(['income', 'expense', 'initial', 'transfer'])('принимает тип %s', (type) => {
        const { error, update } = validateTransactionUpdate({ amount: 10, type, category: 'Другое', account: 'acc' });
        expect(error).toBeUndefined();
        expect(update.type).toBe(type);
    });

    it('отклоняет тип, переданный не строкой', () => {
        expect(validateTransactionUpdate({ type: 42 }).error).toBeTruthy();
        expect(validateTransactionUpdate({ type: ['expense'] }).error).toBeTruthy();
    });
});

describe('validateTransactionUpdate: сумма', () => {
    it('приводит числовую строку из формы к числу', () => {
        expect(validateTransactionUpdate({ amount: '12.50' }).update.amount).toBe(12.5);
    });

    // Суммы хранятся положительными, знак задаётся типом операции, поэтому
    // ноль и минус - это мусор, а не «другая сторона».
    it.each([0, -5, '0', 'abc', '', null, true, [], [1], {}])('отклоняет сумму %j', (amount) => {
        const { error, update } = validateTransactionUpdate({ amount });
        expect(update).toBeUndefined();
        expect(error).toMatch(/сумма/i);
    });

    // 1e999 разбирается JSON.parse именно в Infinity, а не в ошибку: без
    // проверки на конечность он доехал бы до базы.
    it('отклоняет Infinity', () => {
        expect(validateTransactionUpdate({ amount: Infinity }).error).toBeTruthy();
        expect(validateTransactionUpdate({ amount: JSON.parse('1e999') }).error).toBeTruthy();
    });

    it('разрешает отрицательный начальный остаток, но не нулевой', () => {
        expect(validateTransactionUpdate({ type: 'initial', amount: -500 }).update.amount).toBe(-500);
        expect(validateTransactionUpdate({ type: 'initial', amount: 0 }).error).toMatch(/остатка/i);
    });

    it('учитывает сохранённый тип при частичном обновлении суммы', () => {
        const current = { ...validBody(), type: 'initial', amount: 100 };
        expect(validateTransactionUpdate({ amount: -50 }, current).update.amount).toBe(-50);
    });
});

describe('validateTransactionUpdate: дата', () => {
    it('разбирает YYYY-MM-DD в Date', () => {
        const { update } = validateTransactionUpdate({ date: '2026-08-14' });
        expect(update.date).toBeInstanceOf(Date);
        expect(update.date.toISOString().slice(0, 10)).toBe('2026-08-14');
    });

    it.each(['вчера', '2026-13-45', '', null, true, []])('отклоняет нечитаемую дату %j', (date) => {
        expect(validateTransactionUpdate({ date }).error).toMatch(/дата/i);
    });
});

describe('validateTransactionUpdate: категория и название', () => {
    it('отклоняет пустую категорию у обычной операции', () => {
        expect(validateTransactionUpdate({ type: 'expense', category: '   ' }).error).toMatch(/категория/i);
    });

    // У перевода категория в модели не обязательна, поэтому пустое значение
    // не ошибка - поле просто не переписывается.
    it('у перевода пустую категорию пропускает, не трогая поле', () => {
        const { error, update } = validateTransactionUpdate({ type: 'transfer', category: '' });
        expect(error).toBeUndefined();
        expect(update).not.toHaveProperty('category');
    });

    it('обрезает пробелы вокруг категории', () => {
        expect(validateTransactionUpdate({ category: '  Продукты  ' }).update.category).toBe('Продукты');
    });

    it('подставляет категорию вместо пустого названия - как это делает POST', () => {
        expect(validateTransactionUpdate({ title: '', category: 'Транспорт' }).update.title).toBe('Транспорт');
    });

    it('отклоняет пустое название, когда подставить нечего', () => {
        expect(validateTransactionUpdate({ title: '   ' }).error).toMatch(/название/i);
    });
});

describe('validateTransactionUpdate: остальные поля', () => {
    it('отклоняет пустой счёт', () => {
        expect(validateTransactionUpdate({ account: '' }).error).toMatch(/счёт/i);
    });

    it('принимает только настоящие логические значения excludeFromStats', () => {
        expect(validateTransactionUpdate({ excludeFromStats: true }).update.excludeFromStats).toBe(true);
        expect(validateTransactionUpdate({ excludeFromStats: false }).update.excludeFromStats).toBe(false);
        expect(validateTransactionUpdate({ excludeFromStats: 'false' }).error).toMatch(/логическим/i);
        expect(validateTransactionUpdate({ excludeFromStats: 0 }).error).toMatch(/логическим/i);
    });

    it('позволяет стереть описание пустой строкой', () => {
        expect(validateTransactionUpdate({ description: '  ' }).update.description).toBe('');
    });
});

describe('validateTransactionUpdate: toAccount у бывшего перевода', () => {
    // Форма не кладёт toAccount в тело, когда операция не перевод, а
    // частичное обновление отсутствующие поля не трогает - поэтому поле
    // и оставалось от прежней жизни операции.
    it.each(['expense', 'income', 'initial'])('снимает toAccount при смене типа на %s', (type) => {
        const { error, update, unset } = validateTransactionUpdate({ type, category: 'Продукты', amount: 30 });
        expect(error).toBeUndefined();
        expect(unset).toEqual(['toAccount']);
        expect(update).not.toHaveProperty('toAccount');
    });

    // «Расход, но куда-то» - противоречие; молча записывать его не стоит.
    it('игнорирует toAccount, присланный вместе с типом не-перевода', () => {
        const { update, unset } = validateTransactionUpdate({ type: 'expense', category: 'Продукты', toAccount: 'acc-cash' });
        expect(update).not.toHaveProperty('toAccount');
        expect(unset).toEqual(['toAccount']);
    });

    it('у перевода toAccount сохраняется и ничего не снимается', () => {
        const { update, unset } = validateTransactionUpdate({ type: 'transfer', account: 'acc-card-1', toAccount: 'acc-cash' });
        expect(update.toAccount).toBe('acc-cash');
        expect(unset).toEqual([]);
    });

    // Обновление одной только суммы не должно ничего вычищать: типа в теле
    // нет, значит, перевод остаётся переводом.
    it('не трогает toAccount, когда тип в запросе не участвует', () => {
        const { update, unset } = validateTransactionUpdate({ amount: 42 });
        expect(update).not.toHaveProperty('toAccount');
        expect(unset).toEqual([]);
    });

    it('не снимает toAccount, когда тип пришёл, но остался переводом', () => {
        expect(validateTransactionUpdate({ type: 'transfer', amount: 42 }).unset).toEqual([]);
    });
});

describe('validateTransactionUpdate: форма обновления', () => {
    it('пропускает полное тело из формы редактирования', () => {
        const { error, update } = validateTransactionUpdate(validBody());
        expect(error).toBeUndefined();
        expect(update).toMatchObject({
            title: 'Обед',
            amount: 12.5,
            type: 'expense',
            category: 'Кафе и доставка',
            description: 'с коллегами',
            account: 'acc-card-1',
            excludeFromStats: false,
        });
    });

    // Обновление остаётся частичным: поля, которого в теле нет, не должно
    // быть и в объекте обновления - иначе PUT затирал бы сохранённое
    // значение вместо того, чтобы его не трогать.
    it('не добавляет полей, которых не было в запросе', () => {
        const { update } = validateTransactionUpdate({ amount: 5 });
        expect(Object.keys(update)).toEqual(['amount']);
    });

    it('игнорирует явные undefined и посторонние поля', () => {
        const { update } = validateTransactionUpdate({ amount: 5, title: undefined, _id: 'подмена', splitId: 'x' });
        expect(Object.keys(update)).toEqual(['amount']);
    });

    it('пустое тело - валидное обновление, которое ничего не меняет', () => {
        expect(validateTransactionUpdate({})).toEqual({ update: {}, unset: [] });
    });

    it.each([null, undefined, 'строка', [{ amount: 1 }]])('отклоняет тело %j', (body) => {
        expect(validateTransactionUpdate(body).error).toBeTruthy();
    });
});

describe('валидация итогового состояния частичного PUT', () => {
    const expense = () => ({
        ...validBody(),
        date: new Date('2026-08-14T00:00:00.000Z')
    });

    it('не превращает расход в перевод без счёта назначения', () => {
        expect(validateTransactionUpdate({ type: 'transfer' }, expense()).error).toMatch(/назначения/i);
    });

    it('не превращает перевод без категории в расход', () => {
        const transfer = { ...expense(), type: 'transfer', category: undefined, toAccount: 'acc-cash' };
        expect(validateTransactionUpdate({ type: 'expense' }, transfer).error).toMatch(/категория/i);
    });

    it('не разрешает перевод на тот же счёт при обновлении любой стороны', () => {
        const transfer = { ...expense(), type: 'transfer', category: undefined, toAccount: 'acc-cash' };
        expect(validateTransactionUpdate({ account: 'acc-cash' }, transfer).error).toMatch(/различаться/i);
        expect(validateTransactionUpdate({ toAccount: 'acc-card-1' }, transfer).error).toMatch(/различаться/i);
    });
});

describe('validateTransactionCreate', () => {
    it('нормализует полную операцию и подставляет категорию в название', () => {
        const { error, transaction } = validateTransactionCreate({ ...validBody(), title: undefined });
        expect(error).toBeUndefined();
        expect(transaction.title).toBe('Кафе и доставка');
        expect(transaction.amount).toBe(12.5);
    });

    it('требует непустой счёт и корректный перевод', () => {
        expect(validateTransactionCreate({ ...validBody(), account: undefined }).error).toMatch(/счёт/i);
        expect(validateTransactionCreate({ ...validBody(), type: 'transfer', category: undefined, title: 'Перевод' }).error).toMatch(/назначения/i);
        expect(validateTransactionCreate({ ...validBody(), type: 'transfer', category: undefined, title: 'Перевод', toAccount: 'acc-card-1' }).error).toMatch(/различаться/i);
    });

    it('разрешает отрицательный initial и запрещает отрицательные движения', () => {
        expect(validateTransactionCreate({ ...validBody(), type: 'initial', amount: -100 }).transaction.amount).toBe(-100);
        expect(validateTransactionCreate({ ...validBody(), type: 'expense', amount: -100 }).error).toMatch(/положительным/i);
    });
});

describe('validateTransactionVersion', () => {
    it('принимает нулевую и положительную целую версию', () => {
        expect(validateTransactionVersion({ __v: 0 })).toEqual({ expectedVersion: 0 });
        expect(validateTransactionVersion({ __v: 7 })).toEqual({ expectedVersion: 7 });
    });

    it.each([{}, { __v: -1 }, { __v: 1.5 }, { __v: '0' }, { __v: null }])(
        'отклоняет отсутствующую или некорректную версию %j',
        (body) => expect(validateTransactionVersion(body).error).toMatch(/__v/)
    );
});
