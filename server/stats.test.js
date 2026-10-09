import { describe, it, expect } from 'vitest';
import { computeBalances, computeMonthlyTotals, computeMonthlyTotalsByAccount, toDateKey } from './stats.js';

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

// Деньги с копейками складываются с хвостами двоичной дроби (-40 - 15.30 даёт
// -55.300000000000004), поэтому суммы в ожидаемых значениях сравниваются после
// округления до копеек.
const toCents = (value) => {
    if (typeof value === 'number') return Math.round(value * 100) / 100;
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, toCents(inner)]));
    }
    return value;
};

// Главная проверка модуля: цифры, которые видны на экране, на этом наборе
// данных. Ожидаемые значения выписаны вручную по документам выше.
describe('серверные агрегаты на контрольном наборе', () => {
    it.each([undefined, 'Продукты', 'Другое'])('сводки всех счетов совпадают с отдельными запросами: %s', category => {
        const docs = [...transactions,
            { account: 'acc-cash', date: '2026-08-01', type: 'initial', amount: -15, category: 'Другое' },
            { date: '2026-08-01', type: 'expense', amount: 5, category: 'Другое' },
        ];
        const summaries = computeMonthlyTotalsByAccount(docs, accounts, { category });
        for (const account of ['', 'type:cash', 'type:card', 'card', ...accounts.map(a => a._id)]) {
            expect(summaries[account] || {}, account).toEqual(computeMonthlyTotals(docs, accounts, { account, category }));
        }
        expect(summaries['acc-deposit']).toEqual({});
    });

    it('остатки по счетам, капитал и заморожено', () => {
        const balances = computeBalances(transactions, accounts);

        // Наличные: 5650 стартовых - 30 обед + 500 перевод с карты
        // + 700 «обмен» - 65 ужин.
        // Карта: 4200 + 300 доходов - 120.55 - 900 (excludeFromStats всё равно
        // списан) - 40 - 15.30 - 500 перевод - 2000 залог.
        expect(toCents(balances.byAccount)).toEqual({
            'acc-cash': 6755,
            'acc-card': 924.15,
            'acc-deposit': 2000,
            'acc-exchange': -700
        });
        // Все счета вместе: 6755 + 924.15 + 2000 - 700.
        expect(toCents(balances.grandTotal)).toBe(8979.15);
        // Капитал - без замороженных (залог +2000 и обмен -700): 8979.15 - 1300.
        expect(toCents(balances.total)).toBe(7679.15);
        // В «заморожено» идёт только положительный остаток залога.
        expect(balances.held).toBe(2000);
        // По типам - только незамороженные счета.
        expect(toCents(balances.byType)).toEqual({ card: 924.15, cash: 6755 });
    });

    it('итоги по месяцам', () => {
        expect(toCents(computeMonthlyTotals(transactions, accounts))).toEqual({
            // Стартовый баланс - не доход.
            '2025-11': { income: 0, expense: 0 },
            '2026-07': { income: 4200, expense: -120.55 },
            // Август: 30 + 40 + 15.30 + 65; переводы и возврат долга с флагом не в счёт.
            '2026-08': { income: 0, expense: -150.3 },
            '2026-09': { income: 300, expense: 0 }
        });
    });

    // Переводов в итогах нет, поэтому фильтр по счёту оставляет только
    // обычные операции этого счёта (или всех счетов этого типа).
    const CARD_MONTHS = {
        '2026-07': { income: 4200, expense: -120.55 },
        '2026-08': { income: 0, expense: -55.3 },
        '2026-09': { income: 300, expense: 0 }
    };
    const CASH_MONTHS = {
        '2025-11': { income: 0, expense: 0 },
        '2026-08': { income: 0, expense: -95 }
    };

    it.each([
        // t2, t3, t9, t10, t12; t6 с флагом и переводы не считаются.
        ['acc-card', CARD_MONTHS],
        // t1 (стартовый), t4 и t11.
        ['acc-cash', CASH_MONTHS],
        // На залоге только перевод - итогов нет вовсе.
        ['acc-deposit', {}],
        // Карточные операции все на acc-card, наличные - на acc-cash.
        ['type:card', CARD_MONTHS],
        ['type:cash', CASH_MONTHS]
    ])('итоги по месяцам с фильтром по счёту %s', (accountFilter, expected) => {
        expect(toCents(computeMonthlyTotals(transactions, accounts, { account: accountFilter }))).toEqual(expected);
    });

    it.each([
        ['Продукты', {
            '2026-07': { income: 0, expense: -120.55 },
            '2026-08': { income: 0, expense: -40 }
        }],
        ['Кафе и доставка', { '2026-08': { income: 0, expense: -95 } }],
        ['Зарплата', { '2026-07': { income: 4200, expense: 0 } }],
        // Под «Другое» только стартовый баланс (месяц есть, суммы нулевые)
        // и возврат долга с excludeFromStats, которого в итогах нет.
        ['Другое', { '2025-11': { income: 0, expense: 0 } }]
    ])('итоги по месяцам с фильтром по категории %s', (categoryFilter, expected) => {
        expect(toCents(computeMonthlyTotals(transactions, accounts, { category: categoryFilter }))).toEqual(expected);
    });

    it('итоги по месяцам с обоими фильтрами сразу', () => {
        // Все «Продукты» лежат на карте, поэтому счёт ничего не отсекает.
        expect(toCents(computeMonthlyTotals(transactions, accounts, { account: 'acc-card', category: 'Продукты' }))).toEqual({
            '2026-07': { income: 0, expense: -120.55 },
            '2026-08': { income: 0, expense: -40 }
        });
        // На наличных «Продуктов» нет.
        expect(computeMonthlyTotals(transactions, accounts, { account: 'acc-cash', category: 'Продукты' })).toEqual({});
    });

    it('пустая история', () => {
        expect(computeBalances([], accounts)).toEqual({
            byAccount: {},
            byType: { card: 0, cash: 0 },
            total: 0,
            held: 0,
            grandTotal: 0
        });
        expect(computeMonthlyTotals([], accounts)).toEqual({});
    });
});

// Те же остатки по одному правилу за раз: при падении сразу видно, какое
// правило сломалось.
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

describe('computeBalances: замороженные счета', () => {
    const frozenAccounts = [
        { _id: 'card', name: 'Карта', type: 'card' },
        { _id: 'cash', name: 'Наличные', type: 'cash' },
        { _id: 'dep', name: 'Залог', type: 'card', excludeFromTotal: true },
    ];
    const doc = (id, type, amount, account, toAccount, date = '2026-01-05T00:00:00Z') => ({
        _id: id, type, amount, account, ...(toAccount ? { toAccount } : {}), date
    });
    const history = [
        doc('1', 'initial', 1000, 'card', null, '2026-01-01T00:00:00Z'),
        doc('2', 'initial', 200, 'cash', null, '2026-01-01T00:00:00Z'),
        // Внесённый залог: перевод с карты на замороженный счёт.
        doc('3', 'transfer', 500, 'card', 'dep'),
    ];

    it('держит замороженный счёт вне общего капитала, но отдаёт его суммой held', () => {
        const balances = computeBalances(history, frozenAccounts);

        expect(balances.byAccount.dep).toBe(500);
        expect(balances.held).toBe(500);
        // 1000 - 500 на карте плюс 200 наличными; залог сюда не входит.
        expect(balances.total).toBe(700);
        expect(balances.grandTotal).toBe(1200);
    });

    it('не даёт замороженному счёту раздуть корзину «все карты»', () => {
        const balances = computeBalances(history, frozenAccounts);

        // Только настоящая карта; залог - тоже card, но заморожен.
        expect(balances.byType).toEqual({ card: 500, cash: 200 });
    });

    it('не смешивает счёт-минус («Обмен») с залогом в подписи «заморожено»', () => {
        const withExchange = [...frozenAccounts, { _id: 'exch', name: 'Обмен', type: 'cash', excludeFromTotal: true }];
        const balances = computeBalances([
            doc('1', 'initial', 1000, 'card', null, '2026-01-01T00:00:00Z'),
            // Залог: деньги реально лежат на замороженном счёте.
            doc('2', 'transfer', 500, 'card', 'dep'),
            // Обмен: рубли пришли извне, счёт уходит в минус на влитую сумму.
            doc('3', 'transfer', 300, 'exch', 'card', '2026-01-06T00:00:00Z'),
        ], withExchange);

        expect(balances.byAccount.exch).toBe(-300);
        // Подпись называет только реально лежащие деньги, минус в неё не лезет.
        expect(balances.held).toBe(500);
        // Из капитала исключены оба счёта: 1000 - 500 + 300.
        expect(balances.total).toBe(800);
    });

    it('оставляет капитал прежним, когда замороженных счетов нет', () => {
        const balances = computeBalances(history, frozenAccounts.slice(0, 2));

        expect(balances.held).toBe(0);
        expect(balances.total).toBe(balances.grandTotal);
        expect(balances.total).toBe(1200);
    });

    it('возврат залога поднимает капитал обратно, не создавая дохода', () => {
        const withReturn = [
            doc('1', 'initial', 1000, 'card', null, '2026-01-01T00:00:00Z'),
            doc('3', 'transfer', 500, 'card', 'dep'),
            doc('4', 'transfer', 500, 'dep', 'card', '2026-06-01T00:00:00Z'),
        ];

        const balances = computeBalances(withReturn, frozenAccounts);

        expect(balances.held).toBe(0);
        expect(balances.total).toBe(1000);
        // Переводы не попадают в доход ни на одном из концов.
        expect(computeMonthlyTotals(withReturn, frozenAccounts)).toEqual({
            '2026-01': { income: 0, expense: 0 }
        });
    });

    it('пустая сумма не ломает остатки', () => {
        const balances = computeBalances([doc('1', 'expense', 0, 'card', null, '2026-01-01T00:00:00Z')], frozenAccounts);

        expect(balances.total).toBe(0);
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
