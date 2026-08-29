import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
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
import {
    transformTransactions as transformOnClient,
    getComparisonData,
    getCategoryComparison,
    getMonthlySeries,
    getYearlyData,
    getLifetimeStats,
    getSearchResults,
    getDescriptionSuggestions,
    getCategoryUsage,
    splitCategoriesByUsage
} from '../src/utils/finance.js';

// «Сегодня» для всего файла. Клиентские функции берут его из new Date(), а
// серверные принимают параметром - поэтому время замораживается, иначе
// сравнивать было бы нечего: окно сравнения зависит от текущего числа.
//
// Полдень по местному времени, а не UTC-полночь: конструктор new Date(y, m, d)
// локальный, и в полночь дата «сегодня» зависела бы от зоны машины.
const TODAY = '2026-08-15';
const FROZEN = new Date(2026, 7, 15, 12, 0, 0);

beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FROZEN);
});

afterAll(() => {
    vi.useRealTimers();
});

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
const onClient = transformOnClient(transactions, accounts);

const MONTHS = ['2026-08', '2026-07', '2026-01'];
const ACCOUNT_FILTERS = [null, 'acc-card', 'acc-cash', 'type:card', 'type:cash'];

describe('сравнение с прошлым месяцем совпадает с клиентским', () => {
    it.each(MONTHS)('месяц %s', (month) => {
        expect(computeComparison(onServer, month, TODAY)).toEqual(getComparisonData(onClient, month));
    });

    it('идущий месяц обрезает прошлый по сегодняшнее число', () => {
        // Июль до 15-го: продукты 100 и кафе 40. Покупка 20 июля не в счёт -
        // сравнивать половину августа с полным июлем было бы бессмысленно.
        const result = computeComparison(onServer, '2026-08', TODAY);

        expect(result.day).toBe(15);
        expect(result.expense).toBe(140);
        expect(result.prevMonthName).toBe('июль');
        expect(result.prevMonthDayLabel).toBe('15 июля');
    });

    it('законченный месяц сравнивается с прошлым целиком', () => {
        const result = computeComparison(onServer, '2026-07', TODAY);

        expect(result.day).toBe(31);
    });
});

describe('покатегорийное сравнение совпадает с клиентским', () => {
    it.each(ACCOUNT_FILTERS)('фильтр по счёту %s', (account) => {
        expect(computeCategoryComparison(onServer, '2026-08', TODAY, account))
            .toEqual(getCategoryComparison(onClient, '2026-08', account));
    });

    it('категория, пропавшая в этом месяце, остаётся с нулём', () => {
        const result = computeCategoryComparison(onServer, '2026-08', TODAY);

        // «Жилье» было в мае, но не в июле до 15-го и не в августе - в
        // сравнении именно этих двух месяцев её быть не должно.
        expect(result['Жилье']).toBeUndefined();
        // «Шопинг» появился только сейчас: рост с нуля - не проценты.
        expect(result['Шопинг']).toEqual({ value: 60, previous: 0, diff: 60, percent: null });
        expect(result['Продукты']).toEqual({ value: 130, previous: 100, diff: 30, percent: 30 });
    });
});

describe('ряд по месяцам совпадает с клиентским', () => {
    it.each([6, 12, 3])('%i месяцев', (months) => {
        expect(computeMonthlySeries(onServer, '2026-08', months))
            .toEqual(getMonthlySeries(onClient, '2026-08', months));
    });

    it.each(ACCOUNT_FILTERS)('фильтр по счёту %s', (account) => {
        expect(computeMonthlySeries(onServer, '2026-08', 6, account))
            .toEqual(getMonthlySeries(onClient, '2026-08', 6, account));
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

describe('итоги за год и за всё время совпадают с клиентскими', () => {
    it.each(ACCOUNT_FILTERS)('год, фильтр по счёту %s', (account) => {
        expect(computeYearlyData(onServer, '2026-08', account))
            .toEqual(getYearlyData(onClient, '2026-08', account));
    });

    it.each(['Продукты', 'Кафе и доставка', null])('год, фильтр по категории %s', (category) => {
        expect(computeYearlyData(onServer, '2026-08', null, category))
            .toEqual(getYearlyData(onClient, '2026-08', null, category));
    });

    it.each(ACCOUNT_FILTERS)('всё время, фильтр по счёту %s', (account) => {
        expect(computeLifetimeStats(onServer, '2025-11-09', account))
            .toEqual(getLifetimeStats(onClient, '2025-11-09', account));
    });

    it('всё время отсекает операции раньше стартовой даты', () => {
        expect(computeLifetimeStats(onServer, '2026-06-01'))
            .toEqual(getLifetimeStats(onClient, '2026-06-01'));
    });
});

describe('поиск совпадает с клиентским', () => {
    it.each(['лидл', 'Wolt', 'продукты', '130', '4200', 'ничего такого', ''])(
        'запрос «%s»',
        (query) => {
            expect(computeSearchResults(onServer, query)).toEqual(getSearchResults(onClient, query));
        }
    );

    it.each(ACCOUNT_FILTERS)('запрос с фильтром по счёту %s', (account) => {
        expect(computeSearchResults(onServer, 'продукты', account))
            .toEqual(getSearchResults(onClient, 'продукты', account));
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

describe('подсказки описаний совпадают с клиентскими', () => {
    it.each([
        ['Продукты', 'expense'],
        ['Кафе и доставка', 'expense'],
        ['Зарплата', 'income'],
        ['Продукты', null]
    ])('категория «%s», тип %s', (category, type) => {
        expect(computeDescriptionSuggestions(onServer, category, type))
            .toEqual(getDescriptionSuggestions(onClient, category, type));
    });

    it('склеивает варианты написания и показывает последнее', () => {
        // «Лидл», «лидл » и «Lidl» - три операции, но «Лидл»/«лидл » это одно
        // и то же написание в разном регистре, а последнее из них - 20 июля.
        const suggestions = computeDescriptionSuggestions(onServer, 'Продукты', 'expense');

        expect(suggestions).toEqual(['лидл', 'Lidl']);
    });
});

describe('счётчик категорий совпадает с клиентским', () => {
    it('число операций на категорию', () => {
        expect(computeCategoryUsage(onServer)).toEqual(getCategoryUsage(onClient));
    });
});

describe('частота категорий даёт тот же порядок, что и клиентский делёж', () => {
    const categories = [
        { name: 'Отпуск', type: 'expense', order: 1 },
        { name: 'Продукты', type: 'expense', order: 2 },
        { name: 'Кафе и доставка', type: 'expense', order: 3 },
        { name: 'Шопинг', type: 'expense', order: 4 },
        { name: 'Жилье', type: 'expense', order: 5 },
    ];

    it('порядок по убыванию частоты, при равенстве - серверный', () => {
        const counts = computeCategoryCounts(onServer, 'expense', TODAY);

        // Тот же порядок, что строит splitCategoriesByUsage внутри себя.
        const fromServerCounts = categories
            .map((cat, index) => ({ cat, index, count: counts[cat.name] || 0 }))
            .sort((a, b) => b.count - a.count || a.index - b.index)
            .map(entry => entry.cat);

        const { frequent, rest } = splitCategoriesByUsage(categories, onClient, 'expense', { now: FROZEN });

        expect(fromServerCounts).toEqual([...frequent, ...rest]);
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
