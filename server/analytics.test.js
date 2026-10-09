import { describe, it, expect } from 'vitest';
import {
    computeComparison,
    computeCategoryComparison,
    computeMonthlySeries,
    computeYearlyData,
    computeLifetimeStats,
    computeSearchResults,
    computeDescriptionSuggestions,
    computeCategoryUsage,
    computeCategoryCounts
} from './analytics.js';
import { transformTransactions } from './transform.js';

// «Сегодня» приходит в серверные функции параметром (окно сравнения зависит
// от текущего числа), поэтому системное время подменять не нужно.
const TODAY = '2026-08-15';

const accounts = [
    { _id: 'acc-card', name: 'Revolut', type: 'card', excludeFromTotal: false },
    { _id: 'acc-cash', name: 'Наличные', type: 'cash', excludeFromTotal: false },
    { _id: 'acc-deposit', name: 'Залог', type: 'card', excludeFromTotal: true },
];

const transactions = [
    { _id: 't1', title: 'Стартовый баланс', amount: 5650, type: 'initial', category: 'Другое', account: 'acc-cash', date: '2025-11-09T00:00:00.000Z' },
    // Прошлый месяц: часть до 15-го числа, часть после - на этом проверяется
    // обрезка окна сравнения.
    { _id: 't2', title: 'Продукты', amount: 100, type: 'expense', category: 'Продукты', description: 'Лидл', account: 'acc-card', date: '2026-07-05T00:00:00.000Z' },
    { _id: 't3', title: 'Кафе', amount: 40, type: 'expense', category: 'Кафе и доставка', description: 'Wolt', account: 'acc-card', date: '2026-07-14T00:00:00.000Z' },
    { _id: 't4', title: 'Продукты', amount: 70, type: 'expense', category: 'Продукты', description: 'лидл ', account: 'acc-cash', date: '2026-07-20T00:00:00.000Z' },
    { _id: 't5', title: 'Зарплата', amount: 4200, type: 'income', category: 'Зарплата', account: 'acc-card', date: '2026-07-05T00:00:00.000Z' },
    // Текущий месяц
    { _id: 't6', title: 'Продукты', amount: 130, type: 'expense', category: 'Продукты', description: 'Lidl', account: 'acc-card', date: '2026-08-03T00:00:00.000Z' },
    { _id: 't7', title: 'Кафе', amount: 25, type: 'expense', category: 'Кафе и доставка', description: 'wolt', account: 'acc-cash', date: '2026-08-10T00:00:00.000Z' },
    { _id: 't8', title: 'Шопинг', amount: 60, type: 'expense', category: 'Шопинг', account: 'acc-card', date: '2026-08-12T00:00:00.000Z' },
    { _id: 't9', title: 'Перевод', amount: 500, type: 'transfer', category: 'Перевод', account: 'acc-card', toAccount: 'acc-cash', date: '2026-08-04T00:00:00.000Z' },
    { _id: 't10', title: 'Возврат', amount: 900, type: 'expense', category: 'Другое', account: 'acc-card', date: '2026-08-05T00:00:00.000Z', excludeFromStats: true },
    { _id: 't11', title: 'Фриланс', amount: 300, type: 'income', category: 'Фриланс', account: 'acc-card', date: '2026-08-11T00:00:00.000Z' },
    // Май - месяц без операций между ним и июлем оставлен пустым намеренно.
    { _id: 't12', title: 'Аренда', amount: 800, type: 'expense', category: 'Жилье', account: 'acc-card', date: '2026-05-01T00:00:00.000Z' },
];

const onServer = transformTransactions(transactions, accounts);


// Быстрый взгляд на результат поиска: сколько найдено и по дням - итог дня
// и идентификаторы найденных операций.
const searchSummary = (result) => ({
    count: result.count,
    days: Object.fromEntries(Object.entries(result.transactions).map(([date, day]) => [
        date, { sum: day.dailySum, ids: day.items.map(item => item.id) }
    ]))
});

describe('сравнение с прошлым месяцем', () => {
    it('идущий месяц обрезает прошлый по сегодняшнее число', () => {
        // Июль до 15-го: зарплата 4200 (5 июля), продукты 100 и кафе 40.
        // Покупка 20 июля не в счёт - сравнивать половину августа с полным
        // июлем было бы бессмысленно.
        expect(computeComparison(onServer, '2026-08', TODAY)).toEqual({
            saldo: 4060,
            expense: 140,
            day: 15,
            prevMonthName: 'июль',
            prevMonthDayLabel: '15 июля'
        });
    });

    it('законченный месяц сравнивается с прошлым целиком', () => {
        // Сегодня уже сентябрь, август закончен: июль берётся весь, и 20 июля
        // (продукты 70) в него входит. Расход 100 + 40 + 70, доход 4200.
        expect(computeComparison(onServer, '2026-08', '2026-09-10')).toEqual({
            saldo: 3990,
            expense: 210,
            day: 31,
            prevMonthName: 'июль',
            prevMonthDayLabel: '31 июля'
        });
    });

    it('законченный месяц без операций в прошлом: нули и последний день месяца', () => {
        const result = computeComparison(onServer, '2026-07', TODAY);

        // В июне операций нет. У июня 30 дней, а сравнение берёт 31-е число
        // июля: подпись упирается в последний день июня, а не уезжает в июль.
        expect(result).toMatchObject({ saldo: 0, expense: 0, day: 31, prevMonthName: 'июнь', prevMonthDayLabel: '30 июня' });
    });

    it('31-е число идущего месяца после короткого прошлого: подпись - последний день прошлого', () => {
        expect(computeComparison(onServer, '2026-03', '2026-03-31').prevMonthDayLabel).toBe('28 февраля');
    });

    it('январь сравнивается с декабрём прошлого года', () => {
        expect(computeComparison(onServer, '2026-01', TODAY)).toEqual({
            saldo: 0,
            expense: 0,
            day: 31,
            prevMonthName: 'декабрь',
            prevMonthDayLabel: '31 декабря'
        });
    });
});

describe('покатегорийное сравнение', () => {
    // Август до 15-го числа против июля до 15-го. Возврат с excludeFromStats
    // и перевод в расходы не входят.
    const PRODUCTS = { value: 130, previous: 100, diff: 30, percent: 30 };
    const SHOPPING = { value: 60, previous: 0, diff: 60, percent: null };

    it('без фильтра по счёту', () => {
        expect(computeCategoryComparison(onServer, '2026-08', TODAY)).toEqual({
            'Продукты': PRODUCTS,
            // Было 40 (Wolt 14 июля), стало 25: -15 от 40 - это -37.5%, округление к большему.
            'Кафе и доставка': { value: 25, previous: 40, diff: -15, percent: -37 },
            'Шопинг': SHOPPING
        });
    });

    it.each(['acc-card', 'type:card'])('фильтр по счёту %s: категория, пропавшая в этом месяце, остаётся с нулём', (account) => {
        expect(computeCategoryComparison(onServer, '2026-08', TODAY, account)).toEqual({
            'Продукты': PRODUCTS,
            // Кафе на карте в июле было (40), а в августе кафе оплачено наличными.
            'Кафе и доставка': { value: 0, previous: 40, diff: -40, percent: -100 },
            'Шопинг': SHOPPING
        });
    });

    it.each(['acc-cash', 'type:cash'])('фильтр по счёту %s: категория без прошлого месяца', (account) => {
        // Наличные: в августе кафе 25; покупка продуктов за наличные в июле
        // была 20-го, то есть после обрезки окна.
        expect(computeCategoryComparison(onServer, '2026-08', TODAY, account)).toEqual({
            'Кафе и доставка': { value: 25, previous: 0, diff: 25, percent: null }
        });
    });

    it('категории вне двух сравниваемых отрезков не появляются', () => {
        const result = computeCategoryComparison(onServer, '2026-08', TODAY);

        // «Жилье» было в мае, но не в июле до 15-го и не в августе - в
        // сравнении именно этих двух месяцев её быть не должно. Возврат долга
        // («Другое») помечен excludeFromStats.
        expect(result['Жилье']).toBeUndefined();
        expect(result['Другое']).toBeUndefined();
        // «Шопинг» появился только сейчас: рост с нуля - не проценты.
        expect(result['Шопинг']).toEqual({ value: 60, previous: 0, diff: 60, percent: null });
        expect(result['Продукты']).toEqual({ value: 130, previous: 100, diff: 30, percent: 30 });
    });
});

describe('ряд по месяцам', () => {
    const triple = (m) => [m.month, m.income, m.expense];

    it('6 месяцев: полный вид каждого столбика', () => {
        expect(computeMonthlySeries(onServer, '2026-08', 6)).toEqual([
            { month: '2026-03', label: 'март', year: 2026, income: 0, expense: 0 },
            { month: '2026-04', label: 'апр', year: 2026, income: 0, expense: 0 },
            // Аренда 800.
            { month: '2026-05', label: 'май', year: 2026, income: 0, expense: 800 },
            { month: '2026-06', label: 'июнь', year: 2026, income: 0, expense: 0 },
            // Зарплата 4200; продукты 100 + 70 и кафе 40.
            { month: '2026-07', label: 'июль', year: 2026, income: 4200, expense: 210 },
            // Фриланс 300; 130 + 25 + 60. Перевод и возврат долга не считаются.
            { month: '2026-08', label: 'авг', year: 2026, income: 300, expense: 215 }
        ]);
    });

    it('3 месяца', () => {
        expect(computeMonthlySeries(onServer, '2026-08', 3)).toEqual([
            { month: '2026-06', label: 'июнь', year: 2026, income: 0, expense: 0 },
            { month: '2026-07', label: 'июль', year: 2026, income: 4200, expense: 210 },
            { month: '2026-08', label: 'авг', year: 2026, income: 300, expense: 215 }
        ]);
    });

    it('12 месяцев: ряд начинается с ноября 2025 - месяца первой операции', () => {
        expect(computeMonthlySeries(onServer, '2026-08', 12).map(triple)).toEqual([
            // Стартовый баланс - не доход.
            ['2025-11', 0, 0],
            ['2025-12', 0, 0],
            ['2026-01', 0, 0],
            ['2026-02', 0, 0],
            ['2026-03', 0, 0],
            ['2026-04', 0, 0],
            ['2026-05', 0, 800],
            ['2026-06', 0, 0],
            ['2026-07', 4200, 210],
            ['2026-08', 300, 215]
        ]);
    });

    it.each([
        // Карта: аренда в мае, в июле зарплата и расход 100 + 40, в августе
        // фриланс и расход 130 + 60. Перевод на наличные не расход.
        ['acc-card', [['2026-05', 0, 800], ['2026-07', 4200, 140], ['2026-08', 300, 190]]],
        // Наличные: продукты 70 в июле и кафе 25 в августе. Приход перевода
        // 500 доходом не считается.
        ['acc-cash', [['2026-07', 0, 70], ['2026-08', 0, 25]]],
        ['type:card', [['2026-05', 0, 800], ['2026-07', 4200, 140], ['2026-08', 300, 190]]],
        ['type:cash', [['2026-07', 0, 70], ['2026-08', 0, 25]]]
    ])('фильтр по счёту %s', (account, nonEmpty) => {
        const series = computeMonthlySeries(onServer, '2026-08', 6, account);

        // Пустые месяцы внутри диапазона остаются, поэтому ряд всегда из шести столбиков.
        expect(series.map(m => m.month)).toEqual(['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08']);
        expect(series.map(triple).filter(([, income, expense]) => income || expense)).toEqual(nonEmpty);
    });

    it('фильтр по категории', () => {
        // «Продукты» по месяцам: июль 100 + 70, август 130. Остальные месяцы пустые.
        const series = computeMonthlySeries(onServer, '2026-08', 3, null, 'Продукты');

        expect(series.map(triple)).toEqual([['2026-06', 0, 0], ['2026-07', 0, 170], ['2026-08', 0, 130]]);
    });

    it('фильтры по счёту и категории вместе', () => {
        // Продукты на карте: июль 100 (покупка за 70 - наличными, не в счёт), август 130.
        const series = computeMonthlySeries(onServer, '2026-08', 3, 'acc-card', 'Продукты');

        expect(series.map(triple)).toEqual([['2026-06', 0, 0], ['2026-07', 0, 100], ['2026-08', 0, 130]]);
    });

    it('обрезает месяцы старше первой операции, но не пустые в середине', () => {
        const series = computeMonthlySeries(onServer, '2026-08', 12);

        // Первая операция - ноябрь 2025, значит 12 месяцев до августа 2026
        // начинаются с сентября 2025 и первые два обрезаются.
        expect(series[0].month).toBe('2025-11');
        // Июнь пустой, но между маем и июлем остаётся. Подпись - «июнь»:
        // короткие названия в русском сокращаются не у всех месяцев.
        expect(series.find(m => m.month === '2026-06')).toEqual({
            month: '2026-06', label: 'июнь', year: 2026, income: 0, expense: 0
        });
    });
});

describe('итоги за год и за всё время', () => {
    // Год 2026 / вся история (кроме стартового баланса, он не доход и не
    // расход): доход 4200 + 300; расход 100 + 40 + 70 + 130 + 25 + 60 + 800.
    // Перевод и возврат долга с excludeFromStats не учитываются.
    const ALL = {
        income: 4500,
        expense: -1225,
        categoryTotals: { 'Продукты': 300, 'Кафе и доставка': 65, 'Шопинг': 60, 'Жилье': 800 }
    };
    // Все операции на карте: доходы те же, расход без наличных 70 и 25.
    const CARD = {
        income: 4500,
        expense: -1130,
        categoryTotals: { 'Продукты': 230, 'Кафе и доставка': 40, 'Шопинг': 60, 'Жилье': 800 }
    };
    // Наличные: только расходы 70 (июль) и 25 (август).
    const CASH = {
        income: 0,
        expense: -95,
        categoryTotals: { 'Продукты': 70, 'Кафе и доставка': 25 }
    };

    it.each([
        [null, ALL],
        ['acc-card', CARD],
        ['acc-cash', CASH],
        ['type:card', CARD],
        ['type:cash', CASH]
    ])('год, фильтр по счёту %s', (account, expected) => {
        expect(computeYearlyData(onServer, '2026-08', account)).toEqual(expected);
    });

    it.each([
        ['Продукты', { income: 0, expense: -300, categoryTotals: { 'Продукты': 300 } }],
        ['Кафе и доставка', { income: 0, expense: -65, categoryTotals: { 'Кафе и доставка': 65 } }],
        [null, ALL]
    ])('год, фильтр по категории %s', (category, expected) => {
        expect(computeYearlyData(onServer, '2026-08', null, category)).toEqual(expected);
    });

    it('год берётся из выбранного месяца, а операции другого года не входят', () => {
        // В 2025 году только стартовый баланс и расходов с доходами нет.
        expect(computeYearlyData(onServer, '2025-12')).toEqual({ income: 0, expense: 0, categoryTotals: {} });
    });

    it.each([
        [null, { ...ALL, total: 3275 }],
        ['acc-card', { ...CARD, total: 3370 }],
        // Стартовый баланс на наличных ни доход, ни расход.
        ['acc-cash', { ...CASH, total: -95 }],
        ['type:card', { ...CARD, total: 3370 }],
        ['type:cash', { ...CASH, total: -95 }]
    ])('всё время, фильтр по счёту %s', (account, expected) => {
        expect(computeLifetimeStats(onServer, '2025-11-09', account)).toEqual(expected);
    });

    it('всё время отсекает операции раньше стартовой даты', () => {
        // С 1 июня нет ни стартового баланса, ни майской аренды (800).
        expect(computeLifetimeStats(onServer, '2026-06-01')).toEqual({
            income: 4500,
            expense: -425,
            total: 4075,
            categoryTotals: { 'Продукты': 300, 'Кафе и доставка': 65, 'Шопинг': 60 }
        });
    });
});

describe('поиск', () => {
    it.each([
        // «Лидл» и «лидл » (с пробелом) в описании; «Lidl» латиницей не подходит.
        ['лидл', 2, { '2026-07-05': { sum: -100, ids: ['t2'] }, '2026-07-20': { sum: -70, ids: ['t4'] } }],
        // Регистр не важен: «Wolt» находит и «Wolt», и «wolt».
        ['Wolt', 2, { '2026-07-14': { sum: -40, ids: ['t3'] }, '2026-08-10': { sum: -25, ids: ['t7'] } }],
        // По названию и категории: три покупки продуктов.
        ['продукты', 3, {
            '2026-07-05': { sum: -100, ids: ['t2'] },
            '2026-07-20': { sum: -70, ids: ['t4'] },
            '2026-08-03': { sum: -130, ids: ['t6'] }
        }],
        // По сумме.
        ['130', 1, { '2026-08-03': { sum: -130, ids: ['t6'] } }],
        ['4200', 1, { '2026-07-05': { sum: 4200, ids: ['t5'] } }],
        ['ничего такого', 0, {}],
        ['', 0, {}]
    ])('запрос «%s»', (query, count, days) => {
        expect(searchSummary(computeSearchResults(onServer, query))).toEqual({ count, days });
    });

    it.each([
        [null, 3],
        ['acc-card', 2],
        ['acc-cash', 1],
        ['type:card', 2],
        ['type:cash', 1]
    ])('запрос «продукты» с фильтром по счёту %s', (account, count) => {
        // Покупки продуктов: t2 и t6 на карте, t4 за наличные.
        expect(computeSearchResults(onServer, 'продукты', account).count).toBe(count);
    });

    it('с фильтром по счёту остаются только операции этого счёта', () => {
        expect(searchSummary(computeSearchResults(onServer, 'продукты', 'acc-card'))).toEqual({
            count: 2,
            days: { '2026-07-05': { sum: -100, ids: ['t2'] }, '2026-08-03': { sum: -130, ids: ['t6'] } }
        });
        expect(searchSummary(computeSearchResults(onServer, 'продукты', 'type:cash'))).toEqual({
            count: 1,
            days: { '2026-07-20': { sum: -70, ids: ['t4'] } }
        });
    });

    it('ищет и по сумме, и по тексту, не различая регистра', () => {
        // «Лидл» и «лидл » - два попадания; «Lidl» латиницей под кириллический
        // запрос не подходит, и это ожидаемо: поиск сравнивает строки, а не
        // раскладки.
        expect(computeSearchResults(onServer, 'лидл').count).toBe(2);
        expect(computeSearchResults(onServer, 'lidl').count).toBe(1);
        expect(computeSearchResults(onServer, '130').count).toBe(1);
    });

    it('пустой запрос ничего не находит, а не находит всё', () => {
        expect(computeSearchResults(onServer, '')).toEqual({ transactions: {}, count: 0 });
    });
});

describe('подсказки описаний', () => {
    it.each([
        // «Лидл» и «лидл » - одно написание, последнее (20 июля) - «лидл»; «Lidl» один раз.
        ['Продукты', 'expense', ['лидл', 'Lidl']],
        // «Wolt» (14 июля) и «wolt» (10 августа) склеиваются, остаётся позднее.
        ['Кафе и доставка', 'expense', ['wolt']],
        // У зарплаты описания нет.
        ['Зарплата', 'income', []],
        // Без типа - все операции категории.
        ['Продукты', null, ['лидл', 'Lidl']],
        // Тип другой, чем у операций категории.
        ['Продукты', 'income', []]
    ])('категория «%s», тип %s', (category, type, expected) => {
        expect(computeDescriptionSuggestions(onServer, category, type)).toEqual(expected);
    });

    it('склеивает варианты написания и показывает последнее', () => {
        // «Лидл», «лидл » и «Lidl» - три операции, но «Лидл»/«лидл » это одно
        // и то же написание в разном регистре, а последнее из них - 20 июля.
        const suggestions = computeDescriptionSuggestions(onServer, 'Продукты', 'expense');

        expect(suggestions).toEqual(['лидл', 'Lidl']);
    });

    it('при равной частоте выше то, что использовалось позже', () => {
        const ties = transformTransactions([
            { _id: 'a', amount: 10, type: 'expense', category: 'Транспорт', description: 'Такси', account: 'acc-card', date: '2026-01-01T00:00:00.000Z' },
            { _id: 'b', amount: 10, type: 'expense', category: 'Транспорт', description: 'Бензин', account: 'acc-card', date: '2026-01-10T00:00:00.000Z' }
        ], accounts);

        expect(computeDescriptionSuggestions(ties, 'Транспорт', 'expense')).toEqual(['Бензин', 'Такси']);
    });

    it('учитывает лимит', () => {
        expect(computeDescriptionSuggestions(onServer, 'Продукты', 'expense', 1)).toEqual(['лидл']);
    });

    it('без категории подсказок нет', () => {
        expect(computeDescriptionSuggestions(onServer, '', 'expense')).toEqual([]);
    });
});

describe('счётчик категорий', () => {
    it('число операций на категорию', () => {
        // Ключ - «тип::категория». Возврат долга с excludeFromStats и стартовый
        // баланс считаются тоже: это счётчик ссылок, а не статистика.
        expect(computeCategoryUsage(onServer)).toEqual({
            'initial::Другое': 1,
            'expense::Продукты': 3,
            'expense::Кафе и доставка': 2,
            'expense::Шопинг': 1,
            'expense::Другое': 1,
            'expense::Жилье': 1,
            'income::Зарплата': 1,
            'income::Фриланс': 1,
            'transfer::Перевод': 1
        });
    });
});

describe('частота категорий задаёт порядок «часто используемых»', () => {
    const categories = [
        { name: 'Отпуск', type: 'expense', order: 1 },
        { name: 'Продукты', type: 'expense', order: 2 },
        { name: 'Кафе и доставка', type: 'expense', order: 3 },
        { name: 'Шопинг', type: 'expense', order: 4 },
        { name: 'Жилье', type: 'expense', order: 5 },
    ];

    it('счётчик расходов за окно', () => {
        // Окно 90 дней от 15 августа - с 17 мая. Продукты 3 (5 и 20 июля,
        // 3 августа), кафе 2, шопинг 1, возврат долга («Другое») тоже 1:
        // считаются все расходы, в том числе с excludeFromStats.
        expect(computeCategoryCounts(onServer, 'expense', TODAY)).toEqual({
            'Продукты': 3,
            'Кафе и доставка': 2,
            'Шопинг': 1,
            'Другое': 1
        });
    });

    it('порядок по убыванию частоты, при равенстве - серверный', () => {
        const counts = computeCategoryCounts(onServer, 'expense', TODAY);

        // Категории сортируются по частоте; у «Отпуска» и «Жилья» по нулю,
        // и «Отпуск» стоит выше, как в серверном списке.
        const ordered = categories
            .map((cat, index) => ({ name: cat.name, index, count: counts[cat.name] || 0 }))
            .sort((a, b) => b.count - a.count || a.index - b.index)
            .map(entry => entry.name);

        expect(ordered).toEqual(['Продукты', 'Кафе и доставка', 'Шопинг', 'Отпуск', 'Жилье']);
    });

    it('за окно в 90 дней старые операции не считаются', () => {
        // Май за окном (90 дней от 15 августа - это 17 мая), поэтому «Жилье»
        // в счётчик не попадает.
        const counts = computeCategoryCounts(onServer, 'expense', TODAY);

        expect(counts['Жилье']).toBeUndefined();
        expect(counts['Продукты']).toBe(3);
    });

    it('если за окно операций нет вовсе, считает по всей истории', () => {
        // Иначе блок «часто используемые» выродился бы в произвольные первые
        // категории из серверного порядка.
        const counts = computeCategoryCounts(onServer, 'expense', '2027-06-01');

        expect(counts['Продукты']).toBe(3);
        expect(counts['Жилье']).toBe(1);
    });
});
