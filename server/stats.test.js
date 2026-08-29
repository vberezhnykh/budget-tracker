import { describe, it, expect } from 'vitest';
import { computeBalances, computeMonthlyTotals, toDateKey } from './stats.js';
import { transformTransactions, calculateBalances, getMonthlyTotals } from '../src/utils/finance.js';

// Счета всех интересных видов: карта, наличные, замороженный счёт с
// положительным остатком (залог) и замороженный с отрицательным (счётчик
// влитого из непрослеживаемого кармана).
const accounts = [
    { _id: 'acc-card', name: 'Revolut', type: 'card', excludeFromTotal: false },
    { _id: 'acc-cash', name: 'Наличные', type: 'cash', excludeFromTotal: false },
    { _id: 'acc-deposit', name: 'Залог', type: 'card', excludeFromTotal: true },
    { _id: 'acc-exchange', name: 'Обмен', type: 'cash', excludeFromTotal: true },
];

// Сырые документы в том виде, в каком их отдаёт API: дата - строка ISO,
// сумма положительная, знак задаётся типом. Набор намеренно проходит по всем
// правилам, которые легко перепутать.
const transactions = [
    { _id: 't1', title: 'Стартовый баланс', amount: 5650, type: 'initial', category: 'Другое', account: 'acc-cash', date: '2025-11-09T00:00:00.000Z' },
    { _id: 't2', title: 'Зарплата', amount: 4200, type: 'income', category: 'Зарплата', account: 'acc-card', date: '2026-07-05T00:00:00.000Z' },
    { _id: 't3', title: 'Продукты', amount: 120.55, type: 'expense', category: 'Продукты', account: 'acc-card', date: '2026-07-06T00:00:00.000Z' },
    { _id: 't4', title: 'Обед', amount: 30, type: 'expense', category: 'Кафе и доставка', account: 'acc-cash', date: '2026-08-01T00:00:00.000Z' },
    // Перевод двигает два счёта и в статистику не идёт вовсе.
    { _id: 't5', title: 'Перевод', amount: 500, type: 'transfer', category: 'Перевод', account: 'acc-card', toAccount: 'acc-cash', date: '2026-08-02T00:00:00.000Z' },
    // excludeFromStats убирает операцию из статистики, но деньги по счёту
    // всё равно прошли - в остатках она обязана остаться.
    { _id: 't6', title: 'Возврат долга', amount: 900, type: 'expense', category: 'Другое', account: 'acc-card', date: '2026-08-03T00:00:00.000Z', excludeFromStats: true },
    { _id: 't7', title: 'Залог за квартиру', amount: 2000, type: 'transfer', category: 'Перевод', account: 'acc-card', toAccount: 'acc-deposit', date: '2026-08-04T00:00:00.000Z' },
    // Влитое из рублей: счёт «Обмена» уходит в минус, и в подпись под
    // капиталом он попадать не должен.
    { _id: 't8', title: 'Обмен', amount: 700, type: 'transfer', category: 'Перевод', account: 'acc-exchange', toAccount: 'acc-cash', date: '2026-08-05T00:00:00.000Z' },
    // Разделённая операция - две записи одной покупки.
    { _id: 't9', title: 'Продукты', amount: 40, type: 'expense', category: 'Продукты', account: 'acc-card', date: '2026-08-06T00:00:00.000Z', splitId: 'split-1' },
    { _id: 't10', title: 'Химия', amount: 15.30, type: 'expense', category: 'Шопинг', account: 'acc-card', date: '2026-08-06T00:00:00.000Z', splitId: 'split-1' },
    // Последний день месяца в UTC: при пересчёте в локальную зону уехал бы
    // в сентябрь.
    { _id: 't11', title: 'Ужин', amount: 65, type: 'expense', category: 'Кафе и доставка', account: 'acc-cash', date: '2026-08-31T00:00:00.000Z' },
    { _id: 't12', title: 'Фриланс', amount: 300, type: 'income', category: 'Фриланс', account: 'acc-card', date: '2026-09-01T00:00:00.000Z' },
];

// Та же история глазами клиента: именно из этого фронтенд считает свои
// цифры сегодня.
const asClientSees = transformTransactions(transactions, accounts);

// Главная проверка модуля. Сервер и клиент считают одно и то же разными
// путями (сервер - по сырым документам, клиент - по преобразованным), и
// разойтись они не имеют права: это одна и та же цифра на одном и том же
// экране.
describe('серверные агрегаты совпадают с клиентскими', () => {
    it('остатки по счетам, капитал и заморожено', () => {
        expect(computeBalances(transactions, accounts)).toEqual(calculateBalances(asClientSees, accounts));
    });

    it('итоги по месяцам', () => {
        expect(computeMonthlyTotals(transactions, accounts)).toEqual(getMonthlyTotals(asClientSees));
    });

    it.each(['acc-card', 'acc-cash', 'acc-deposit', 'type:card', 'type:cash'])(
        'итоги по месяцам с фильтром по счёту %s',
        (accountFilter) => {
            expect(computeMonthlyTotals(transactions, accounts, { account: accountFilter }))
                .toEqual(getMonthlyTotals(asClientSees, accountFilter));
        }
    );

    it.each(['Продукты', 'Кафе и доставка', 'Зарплата', 'Другое'])(
        'итоги по месяцам с фильтром по категории %s',
        (categoryFilter) => {
            expect(computeMonthlyTotals(transactions, accounts, { category: categoryFilter }))
                .toEqual(getMonthlyTotals(asClientSees, null, categoryFilter));
        }
    );

    it('итоги по месяцам с обоими фильтрами сразу', () => {
        expect(computeMonthlyTotals(transactions, accounts, { account: 'acc-card', category: 'Продукты' }))
            .toEqual(getMonthlyTotals(asClientSees, 'acc-card', 'Продукты'));
    });

    it('пустая история', () => {
        expect(computeBalances([], accounts)).toEqual(calculateBalances([], accounts));
        expect(computeMonthlyTotals([], accounts)).toEqual(getMonthlyTotals([]));
    });
});

// Отдельно от сверки с клиентом: если однажды разъедется и то и другое
// одинаково, эти проверки поймают ошибку по существу.
describe('computeBalances по существу', () => {
    const balances = computeBalances(transactions, accounts);

    it('перевод снимает с одного счёта и кладёт на другой', () => {
        // acc-deposit получил только перевод-залог.
        expect(balances.byAccount['acc-deposit']).toBe(2000);
        // acc-exchange только отдавал.
        expect(balances.byAccount['acc-exchange']).toBe(-700);
    });

    it('операция с excludeFromStats остаётся в остатках', () => {
        const withoutFlag = transactions.map(t => (t._id === 't6' ? { ...t, excludeFromStats: false } : t));
        expect(computeBalances(withoutFlag, accounts).byAccount['acc-card'])
            .toBe(balances.byAccount['acc-card']);
    });

    it('капитал не включает замороженные счета, ни плюсом, ни минусом', () => {
        const frozen = balances.byAccount['acc-deposit'] + balances.byAccount['acc-exchange'];
        expect(balances.total).toBeCloseTo(balances.grandTotal - frozen, 10);
    });

    it('в подпись «заморожено» идут только положительные остатки', () => {
        expect(balances.held).toBe(2000);
    });

    it('по типам счетов замороженные не учитываются', () => {
        expect(balances.byType.card).toBeCloseTo(balances.byAccount['acc-card'], 10);
        expect(balances.byType.cash).toBeCloseTo(balances.byAccount['acc-cash'], 10);
    });
});

describe('computeMonthlyTotals по существу', () => {
    const totals = computeMonthlyTotals(transactions, accounts);

    it('расход отрицательный, доход положительный', () => {
        expect(totals['2026-07']).toEqual({ income: 4200, expense: -120.55 });
    });

    it('стартовый баланс не считается доходом', () => {
        expect(totals['2025-11']).toEqual({ income: 0, expense: 0 });
    });

    it('переводы и excludeFromStats в итоги не попадают', () => {
        // Август: 30 + 40 + 15.30 + 65 расхода. Ни перевода, ни залога,
        // ни обмена, ни возврата долга с флагом.
        expect(totals['2026-08'].expense).toBeCloseTo(-150.3, 10);
        expect(totals['2026-08'].income).toBe(0);
    });

    it('последний день месяца остаётся в своём месяце', () => {
        expect(Object.keys(totals)).toContain('2026-08');
        expect(totals['2026-09']).toEqual({ income: 300, expense: 0 });
    });
});

describe('toDateKey', () => {
    it('принимает и Date из базы, и строку из JSON', () => {
        expect(toDateKey(new Date('2026-08-14T00:00:00.000Z'))).toBe('2026-08-14');
        expect(toDateKey('2026-08-14T00:00:00.000Z')).toBe('2026-08-14');
        expect(toDateKey('2026-08-14')).toBe('2026-08-14');
    });

    it('на мусоре не падает', () => {
        expect(toDateKey(new Date('нет такой даты'))).toBe('');
        expect(toDateKey(undefined)).toBe('');
        expect(toDateKey(null)).toBe('');
    });
});
