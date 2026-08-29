import { describe, it, expect } from 'vitest';
import { parseTransactionQuery, MAX_LIMIT } from './transactionQuery.js';

describe('parseTransactionQuery: совместимость', () => {
    // Фронтенд сегодня ходит без параметров и рассчитывает получить всю
    // историю: он считает из неё балансы и статистику за всё время.
    it('пустой запрос означает всю историю без ограничений', () => {
        expect(parseTransactionQuery({})).toEqual({ filter: {}, limit: null, skip: 0 });
    });

    it('пустые строки в параметрах равносильны их отсутствию', () => {
        expect(parseTransactionQuery({ from: '', to: '', limit: '', skip: '' }))
            .toEqual({ filter: {}, limit: null, skip: 0 });
    });
});

describe('parseTransactionQuery: период', () => {
    it('месяц разворачивается в полуинтервал от первого числа до первого числа следующего', () => {
        const { filter } = parseTransactionQuery({ from: '2026-08', to: '2026-08' });
        expect(filter.date.$gte.toISOString()).toBe('2026-08-01T00:00:00.000Z');
        expect(filter.date.$lt.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    });

    it('декабрь переносит верхнюю границу на январь следующего года', () => {
        const { filter } = parseTransactionQuery({ to: '2026-12' });
        expect(filter.date.$lt.toISOString()).toBe('2027-01-01T00:00:00.000Z');
    });

    it('конкретный день включается целиком', () => {
        const { filter } = parseTransactionQuery({ from: '2026-08-14', to: '2026-08-14' });
        expect(filter.date.$gte.toISOString()).toBe('2026-08-14T00:00:00.000Z');
        expect(filter.date.$lt.toISOString()).toBe('2026-08-15T00:00:00.000Z');
    });

    it('одна граница задаётся без второй', () => {
        expect(parseTransactionQuery({ from: '2026-08' }).filter.date).toHaveProperty('$gte');
        expect(parseTransactionQuery({ from: '2026-08' }).filter.date).not.toHaveProperty('$lt');
    });

    // Границы считаются в UTC, потому что даты операций хранятся как
    // UTC-полночь: в локальной зоне сервера начало месяца уехало бы на
    // несколько часов и захватило соседние операции.
    it('границы считаются в UTC, независимо от зоны сервера', () => {
        const { filter } = parseTransactionQuery({ from: '2026-01' });
        expect(filter.date.$gte.getUTCHours()).toBe(0);
        expect(filter.date.$gte.getUTCDate()).toBe(1);
        expect(filter.date.$gte.getUTCMonth()).toBe(0);
    });

    it.each(['вчера', '2026-8', '26-08', '2026-13', '2026-00', '2026-02-31', '2026-08-32', '2026/08'])(
        'отклоняет границу %j',
        (from) => {
            expect(parseTransactionQuery({ from }).error).toMatch(/from/);
        }
    );

    it('отклоняет период, у которого начало позже конца', () => {
        expect(parseTransactionQuery({ from: '2026-09', to: '2026-08' }).error).toMatch(/период/i);
    });

    it('период из одного месяца пустым не считается', () => {
        expect(parseTransactionQuery({ from: '2026-08', to: '2026-08' }).error).toBeUndefined();
    });
});

describe('parseTransactionQuery: постраничная выборка', () => {
    it('разбирает limit и skip из строк запроса', () => {
        expect(parseTransactionQuery({ limit: '50', skip: '100' })).toMatchObject({ limit: 50, skip: 100 });
    });

    it('skip без limit допустим', () => {
        expect(parseTransactionQuery({ skip: '10' })).toMatchObject({ limit: null, skip: 10 });
    });

    it.each(['0', '-1', '1.5', 'abc', 'NaN'])('отклоняет limit %j', (limit) => {
        expect(parseTransactionQuery({ limit }).error).toMatch(/limit/);
    });

    it.each(['-1', '2.5', 'abc'])('отклоняет skip %j', (skip) => {
        expect(parseTransactionQuery({ skip }).error).toMatch(/skip/);
    });

    it('skip = 0 допустим', () => {
        expect(parseTransactionQuery({ skip: '0' })).toMatchObject({ skip: 0 });
    });

    // Потолок бережёт не базу, а память процесса и сеть: ответ в сотню
    // тысяч документов всё равно никому не нужен.
    it('отклоняет limit выше потолка и принимает ровно потолок', () => {
        expect(parseTransactionQuery({ limit: String(MAX_LIMIT + 1) }).error).toMatch(/limit/);
        expect(parseTransactionQuery({ limit: String(MAX_LIMIT) }).limit).toBe(MAX_LIMIT);
    });
});

describe('parseTransactionQuery: посторонний ввод', () => {
    it('игнорирует незнакомые параметры', () => {
        expect(parseTransactionQuery({ sort: 'amount', foo: 'bar' }))
            .toEqual({ filter: {}, limit: null, skip: 0 });
    });

    // req.query при повторе параметра (?limit=1&limit=2) приходит массивом,
    // а не строкой - Number от него даёт NaN, и это должно быть ошибкой, а
    // не тихим «без ограничения».
    it('отклоняет параметр, повторённый в строке запроса', () => {
        expect(parseTransactionQuery({ limit: ['1', '2'] }).error).toMatch(/limit/);
        expect(parseTransactionQuery({ from: ['2026-08', '2026-09'] }).error).toMatch(/from/);
    });

    it('на отсутствующий или нестандартный объект запроса отвечает значениями по умолчанию', () => {
        expect(parseTransactionQuery(undefined)).toEqual({ filter: {}, limit: null, skip: 0 });
        expect(parseTransactionQuery(null)).toEqual({ filter: {}, limit: null, skip: 0 });
    });
});
