// @vitest-environment node
//
// Снимок кэша общий для всех запросов, поэтому ни один потребитель не вправе
// менять его документы и счета: правка в одном запросе испортила бы ответы
// всем следующим. Серверный код не в strict mode, где запись в замороженный
// объект молча игнорируется, так что заморозки мало - вместо неё документы
// оборачиваются в Proxy, который бросает на любой записи, удалении и
// определении свойства (в том числе sort/push/splice по массиву).

import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import { buildDashboard } from './dashboard.js';
import { buildHistoryPage, parseHistoryQuery } from './history.js';
import { transformTransactions } from './transform.js';
import { computeBalances, computeMonthlyTotals, computeMonthlyTotalsByAccount } from './stats.js';
import { computeSearchResults, computeDescriptionSuggestions } from './analytics.js';
import { prepareData } from './askTools.js';
import { docsByDateDesc } from './ledgerCache.js';
import { createDerived } from './ledgerDerived.js';

const ObjectId = mongoose.Types.ObjectId;

function readOnly(value) {
    // Даты и ObjectId - не простые объекты: методы Date требуют настоящий Date
    // в this, через Proxy они не работают. Их замораживаем: сеттеры Date от
    // этого не бросают, но и менять такой объект потребитель по смыслу не должен.
    if (value === null || typeof value !== 'object') return value;
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) return value;
    const cache = new Map();
    const reject = (what) => () => { throw new TypeError(`Запись в снимок кэша: ${what}`); };
    return new Proxy(value, {
        get(target, key, receiver) {
            const item = Reflect.get(target, key, receiver);
            if (typeof key === 'symbol' || typeof item !== 'object' || item === null) return item;
            if (!cache.has(key)) cache.set(key, readOnly(item));
            return cache.get(key);
        },
        set: reject('set'),
        deleteProperty: reject('delete'),
        defineProperty: reject('defineProperty'),
        setPrototypeOf: reject('setPrototypeOf')
    });
}

const card = { _id: new ObjectId(), name: 'Карта', type: 'card', order: 1, excludeFromTotal: false };
const cash = { _id: new ObjectId(), name: 'Наличные', type: 'cash', order: 2, excludeFromTotal: false };
const deposit = { _id: new ObjectId(), name: 'Залог', type: 'card', order: 3, excludeFromTotal: true };
const accounts = [card, cash, deposit];

let counter = 0;
function doc(overrides) {
    counter += 1;
    return {
        _id: new ObjectId(),
        title: `Операция ${counter}`,
        amount: 10 + counter,
        type: 'expense',
        category: counter % 2 ? 'Продукты' : 'Транспорт',
        description: counter % 3 ? 'Лидл' : 'такси',
        account: String(card._id),
        date: new Date(Date.UTC(2026, 6 + (counter % 3), 1 + (counter % 27))),
        logoMode: 'auto',
        excludeFromStats: false,
        __v: 0,
        ...overrides
    };
}

const docs = [
    doc({ type: 'initial', amount: 500, category: 'Начальный баланс', date: new Date('2026-07-01T00:00:00Z') }),
    doc({ type: 'income', amount: 1000, category: 'Зарплата', date: new Date('2026-08-05T00:00:00Z') }),
    doc({ type: 'transfer', amount: 40, category: undefined, toAccount: String(cash._id), date: new Date('2026-08-06T00:00:00Z') }),
    doc({ type: 'expense', amount: 12, account: 'cash', date: new Date('2026-08-07T00:00:00Z') }),
    doc({ splitId: 'split-1', companyName: 'Лидл', description: 'чек (молоко)', date: new Date('2026-08-10T00:00:00Z') }),
    doc({ splitId: 'split-1', companyName: 'Лидл', description: 'чек (хлеб)', date: new Date('2026-08-10T00:00:00Z') }),
    doc({ excludeFromStats: true, date: new Date('2026-08-11T00:00:00Z') }),
    doc({ account: String(deposit._id), type: 'income', amount: 300, category: 'Фриланс', date: new Date('2026-08-12T00:00:00Z') }),
    ...Array.from({ length: 40 }, () => doc({}))
];

const run = {
    transformTransactions: (d, a) => transformTransactions(d, a),
    computeBalances: (d, a) => computeBalances(d, a),
    computeMonthlyTotals: (d, a) => computeMonthlyTotals(d, a, { account: 'type:card', category: 'Продукты' }),
    computeMonthlyTotalsByAccount: (d, a) => computeMonthlyTotalsByAccount(d, a, { category: 'Продукты' }),
    'buildDashboard (с аналитикой)': (d, a) => buildDashboard(d, a, {
        month: '2026-08', timeRange: 'month', today: '2026-08-15', analytics: true
    }),
    'buildDashboard (год, фильтры)': (d, a) => buildDashboard(d, a, {
        month: '2026-08', timeRange: 'year', account: String(card._id), category: 'Продукты', type: 'expense', today: '2026-08-15', analytics: false
    }),
    'buildHistoryPage (вся лента)': (d, a) => buildHistoryPage(d, a, parseHistoryQuery({ continuous: '1', all: '1' })),
    'buildHistoryPage (месяц)': (d, a) => buildHistoryPage(d, a, parseHistoryQuery({ month: '2026-08', timeRange: 'month' })),
    'buildHistoryPage (поиск)': (d, a) => buildHistoryPage(d, a, parseHistoryQuery({ continuous: '1', all: '1', q: 'лидл' })),
    computeSearchResults: (d, a) => computeSearchResults(transformTransactions(d, a), 'лидл', null, null, null),
    computeDescriptionSuggestions: (d, a) => computeDescriptionSuggestions(transformTransactions(d, a), 'Продукты', 'expense'),
    prepareData: (d, a) => prepareData({ docs: d, accounts: a, categories: [], today: '2026-08-15' }),
    docsByDateDesc: (d) => docsByDateDesc({ docs: d }).map(item => String(item._id))
};

describe('потребители снимка кэша не меняют его', () => {
    it('сам Proxy ловит запись и сортировку на месте', () => {
        const frozen = readOnly([{ a: 1 }, { a: 2 }]);

        expect(() => { frozen[0].a = 5; }).toThrow(/Запись в снимок/);
        expect(() => frozen.sort((x, y) => y.a - x.a)).toThrow(/Запись в снимок/);
        expect(() => frozen.push({ a: 3 })).toThrow(/Запись в снимок/);
    });

    for (const [name, fn] of Object.entries(run)) {
        it(`${name}: результат тот же, ошибок записи нет`, () => {
            const expected = fn(docs.map(d => ({ ...d })), accounts.map(a => ({ ...a })));

            const result = fn(readOnly(docs), readOnly(accounts));

            expect(result).toEqual(expected);
        });
    }

    it('после всех расчётов исходные данные не изменились', () => {
        const before = JSON.stringify({ docs, accounts });

        for (const fn of Object.values(run)) fn(docs, accounts);

        expect(JSON.stringify({ docs, accounts })).toBe(before);
    });
});

// Запомненные на снимок производные (ledgerDerived.js) общие так же, как сам
// снимок: их отдают всем запросам, и правка в одном ответила бы чужой сводке.
// Здесь потребители получают их в Proxy, бросающем на любой записи.
describe('потребители запомненных производных их не меняют', () => {
    // Производные над неизменяемыми документами, значения которых тоже неизменяемы.
    function readOnlyDerived(source = { docs: readOnly(docs), accounts: readOnly(accounts) }) {
        const derived = createDerived(source);
        return {
            transactions: () => readOnly(derived.transactions()),
            transactionOf: doc => readOnly(derived.transactionOf(doc)),
            balances: () => readOnly(derived.balances()),
            monthEndBalances: () => readOnly(derived.monthEndBalances()),
            monthlyTotalsByAccount: category => readOnly(derived.monthlyTotalsByAccount(category)),
            categoryUsage: () => readOnly(derived.categoryUsage()),
            raw: derived
        };
    }

    const paramsList = [
        { month: '2026-08', timeRange: 'month', today: '2026-08-15', analytics: true },
        { month: '2026-09', timeRange: 'year', account: String(card._id), type: 'expense', today: '2026-09-02', analytics: true },
        { month: '2026-08', timeRange: 'lifetime', category: 'Продукты', today: '2026-08-15', analytics: false }
    ];

    it('buildDashboard на запомненных производных: те же ответы, ошибок записи нет', () => {
        const derived = readOnlyDerived();

        for (const params of paramsList) {
            const expected = buildDashboard(docs.map(d => ({ ...d })), accounts.map(a => ({ ...a })), params);
            // Дважды: второй вызов целиком идёт по запомненному.
            expect(buildDashboard(docs, accounts, params, derived)).toEqual(expected);
            expect(buildDashboard(docs, accounts, params, derived)).toEqual(expected);
        }
    });

    it('история, поиск и подсказки на общих расчётных операциях: те же ответы, ошибок записи нет', () => {
        // Документы здесь настоящие: история отдаёт те же объекты, что лежат в снимке.
        const derived = readOnlyDerived({ docs, accounts });
        const sorted = docsByDateDesc({ docs });
        const transactions = derived.transactions();
        const histories = [
            parseHistoryQuery({ continuous: '1', all: '1' }),
            parseHistoryQuery({ month: '2026-08', timeRange: 'month' }),
            parseHistoryQuery({ continuous: '1', all: '1', q: 'лидл' })
        ];

        for (const options of histories) {
            const expected = buildHistoryPage(sorted.map(d => ({ ...d })), accounts.map(a => ({ ...a })), options);
            const shared = sorted.map(doc => derived.transactionOf(doc));
            expect(buildHistoryPage(sorted, accounts, options, shared)).toEqual(expected);
            expect(buildHistoryPage(sorted, accounts, options, shared)).toEqual(expected);
        }
        expect(computeSearchResults(transactions, 'лидл', null, null, null))
            .toEqual(computeSearchResults(transformTransactions(docs, accounts), 'лидл', null, null, null));
        expect(computeDescriptionSuggestions(transactions, 'Продукты', 'expense'))
            .toEqual(computeDescriptionSuggestions(transformTransactions(docs, accounts), 'Продукты', 'expense'));
    });

    it('после всех расчётов запомненные значения не изменились', () => {
        const derived = createDerived({ docs, accounts });
        const snapshot = () => JSON.stringify([
            derived.transactions(), derived.balances(), derived.monthEndBalances(),
            derived.monthlyTotalsByAccount(), derived.categoryUsage()
        ]);
        const before = snapshot();

        for (const params of paramsList) buildDashboard(docs, accounts, params, derived);
        for (const query of [{ continuous: '1', all: '1' }, { month: '2026-08', timeRange: 'month' }, { continuous: '1', all: '1', q: 'лидл' }]) {
            buildHistoryPage(docs, accounts, parseHistoryQuery(query), derived.transactions());
        }
        computeSearchResults(derived.transactions(), 'лидл', null, null, null);
        computeDescriptionSuggestions(derived.transactions(), 'Продукты', 'expense');

        expect(snapshot()).toBe(before);
    });
});
