import { describe, it, expect } from 'vitest';
import { computePeriodData, computePeriod, periodPrefixOf } from './periodStats.js';
import { transformTransactions } from './transform.js';

const accounts = [
    { _id: 'acc-card', name: 'Revolut', type: 'card', excludeFromTotal: false },
    { _id: 'acc-cash', name: 'Наличные', type: 'cash', excludeFromTotal: false },
    { _id: 'acc-deposit', name: 'Залог', type: 'card', excludeFromTotal: true },
];

const transactions = [
    { _id: 't1', title: 'Стартовый баланс', amount: 5650, type: 'initial', category: 'Другое', account: 'acc-cash', date: '2025-11-09T00:00:00.000Z' },
    { _id: 't2', title: 'Зарплата', amount: 4200, type: 'income', category: 'Зарплата', account: 'acc-card', date: '2026-07-05T00:00:00.000Z' },
    { _id: 't3', title: 'Продукты', amount: 120.55, type: 'expense', category: 'Продукты', account: 'acc-card', date: '2026-07-06T00:00:00.000Z' },
    { _id: 't4', title: 'Обед', amount: 30, type: 'expense', category: 'Кафе и доставка', account: 'acc-cash', date: '2026-08-01T00:00:00.000Z' },
    { _id: 't5', title: 'Перевод', amount: 500, type: 'transfer', category: 'Перевод', account: 'acc-card', toAccount: 'acc-cash', date: '2026-08-02T00:00:00.000Z' },
    { _id: 't6', title: 'Возврат долга', amount: 900, type: 'expense', category: 'Другое', account: 'acc-card', date: '2026-08-03T00:00:00.000Z', excludeFromStats: true },
    { _id: 't7', title: 'Залог за квартиру', amount: 2000, type: 'transfer', category: 'Перевод', account: 'acc-card', toAccount: 'acc-deposit', date: '2026-08-04T00:00:00.000Z' },
    // Разделённая операция: две записи одной покупки в один день.
    { _id: 't9', title: 'Продукты', amount: 40, type: 'expense', category: 'Продукты', description: 'Лидл (продукты)', account: 'acc-card', date: '2026-08-06T00:00:00.000Z', splitId: 'split-1' },
    { _id: 't10', title: 'Химия', amount: 15.30, type: 'expense', category: 'Шопинг', description: 'Лидл (химия)', account: 'acc-card', date: '2026-08-06T00:00:00.000Z', splitId: 'split-1' },
    { _id: 't11', title: 'Ужин', amount: 65, type: 'expense', category: 'Кафе и доставка', account: 'acc-cash', date: '2026-08-31T00:00:00.000Z' },
    { _id: 't12', title: 'Фриланс', amount: 300, type: 'income', category: 'Фриланс', account: 'acc-card', date: '2026-09-01T00:00:00.000Z' },
];

const onServer = transformTransactions(transactions, accounts);

// Деньги с копейками складываются с хвостами двоичной дроби, поэтому суммы
// в ожидаемых значениях сравниваются после округления до копеек.
const cents = (value) => Math.round(value * 100) / 100;

// Короткий вид результата: итоги периода и по каждому дню - сумма дня и
// идентификаторы строк списка в порядке показа (новые id выше). Разделённая
// покупка в списке - одна строка с id её splitId.
const summarize = (result) => ({
    income: cents(result.income),
    expense: cents(result.expense),
    categoryTotals: Object.fromEntries(Object.entries(result.categoryTotals).map(([cat, sum]) => [cat, cents(sum)])),
    days: Object.fromEntries(Object.entries(result.transactions).map(([date, day]) => [
        date, { sum: cents(day.dailySum), ids: day.items.map(item => item.id) }
    ]))
});

// Дни контрольного набора. Строки внутри дня идут по убыванию id
// (сравнение строк: 't9' старше 't10').
const NOVEMBER_DAYS = { '2025-11-09': { sum: 0, ids: ['t1'] } };
const JULY_DAYS = {
    // Зарплата 4200 - доход дня.
    '2026-07-05': { sum: 4200, ids: ['t2'] },
    '2026-07-06': { sum: -120.55, ids: ['t3'] }
};
const AUGUST_DAYS = {
    '2026-08-01': { sum: -30, ids: ['t4'] },
    // Перевод и залог (тоже перевод) в итог дня не идут.
    '2026-08-02': { sum: 0, ids: ['t5'] },
    // Возврат долга с excludeFromStats - в списке есть, в итоге дня нет.
    '2026-08-03': { sum: 0, ids: ['t6'] },
    '2026-08-04': { sum: 0, ids: ['t7'] },
    // Две части одной покупки (40 и 15.30) - одна строка списка.
    '2026-08-06': { sum: -55.3, ids: ['split-1'] },
    '2026-08-31': { sum: -65, ids: ['t11'] }
};
const SEPTEMBER_DAYS = { '2026-09-01': { sum: 300, ids: ['t12'] } };

// Итоги за всю историю: доход 4200 + 300 (стартовых 5650 среди них нет),
// расход 120.55 + (30 + 40 + 15.30 + 65).
const LIFETIME_CARDS = {
    income: 4500,
    expense: -270.85,
    categoryTotals: { 'Продукты': 160.55, 'Кафе и доставка': 95, 'Шопинг': 15.3 }
};

describe('computePeriodData: период, фильтры и вид результата', () => {
    it('август без фильтров', () => {
        expect(summarize(computePeriodData(onServer, '2026-08'))).toEqual({
            income: 0,
            expense: -150.3,
            categoryTotals: { 'Кафе и доставка': 95, 'Продукты': 40, 'Шопинг': 15.3 },
            days: AUGUST_DAYS
        });
    });

    it('июль без фильтров', () => {
        expect(summarize(computePeriodData(onServer, '2026-07'))).toEqual({
            income: 4200,
            expense: -120.55,
            categoryTotals: { 'Продукты': 120.55 },
            days: JULY_DAYS
        });
    });

    it('год: все месяцы 2026, без стартового баланса прошлого года', () => {
        expect(summarize(computePeriodData(onServer, '2026'))).toEqual({
            ...LIFETIME_CARDS,
            days: { ...JULY_DAYS, ...AUGUST_DAYS, ...SEPTEMBER_DAYS }
        });
    });

    it('всё время: пустой префикс не фильтрует по дате', () => {
        expect(summarize(computePeriodData(onServer, ''))).toEqual({
            ...LIFETIME_CARDS,
            days: { ...NOVEMBER_DAYS, ...JULY_DAYS, ...AUGUST_DAYS, ...SEPTEMBER_DAYS }
        });
    });

    it('в строках списка лежат преобразованные операции', () => {
        // Не копия и не пересчёт: в списке те же объекты, что подали на вход.
        const day = computePeriodData(onServer, '2026-08').transactions['2026-08-01'];

        expect(day.items[0]).toBe(onServer.find(t => t.id === 't4'));
    });

    // Для счёта в выборку попадают и переводы с любого конца; группа 'type:'
    // отбирает по типу счёта. Карточки (доход, расход, разбивка) считаются
    // по отфильтрованным данным.
    const CARD_AUGUST = {
        income: 0,
        expense: -55.3,
        categoryTotals: { 'Продукты': 40, 'Шопинг': 15.3 },
        days: {
            '2026-08-02': AUGUST_DAYS['2026-08-02'],
            '2026-08-03': AUGUST_DAYS['2026-08-03'],
            '2026-08-04': AUGUST_DAYS['2026-08-04'],
            '2026-08-06': AUGUST_DAYS['2026-08-06']
        }
    };
    const CASH_AUGUST = {
        income: 0,
        expense: -95,
        categoryTotals: { 'Кафе и доставка': 95 },
        days: {
            '2026-08-01': AUGUST_DAYS['2026-08-01'],
            '2026-08-02': AUGUST_DAYS['2026-08-02'],
            '2026-08-31': AUGUST_DAYS['2026-08-31']
        }
    };

    it.each([
        // t5 (карта -> наличные), t6, t7 (карта -> залог), t9 и t10.
        ['acc-card', CARD_AUGUST],
        // t4, t5 (приход перевода) и t11.
        ['acc-cash', CASH_AUGUST],
        // На залоге только перевод-залог: в списке он есть, в цифрах нет.
        ['acc-deposit', { income: 0, expense: 0, categoryTotals: {}, days: { '2026-08-04': AUGUST_DAYS['2026-08-04'] } }],
        // Тип card: все обычные операции на acc-card, а перевод t7 (карта -> залог)
        // уже попал в выборку через карту - состав тот же, что у acc-card.
        ['type:card', CARD_AUGUST],
        // Тип cash: t4, t11 и перевод t5 (приходит на наличные); t7 идёт
        // на залог (card) и сюда не попадает.
        ['type:cash', CASH_AUGUST]
    ])('фильтр по счёту %s', (account, expected) => {
        expect(summarize(computePeriodData(onServer, '2026-08', { account }))).toEqual(expected);
    });

    it.each([
        // t3 в июле и t9 в августе (часть разделённой покупки, одна в группе).
        ['Продукты', {
            income: 0,
            expense: -160.55,
            categoryTotals: { 'Продукты': 160.55 },
            days: { '2026-07-06': JULY_DAYS['2026-07-06'], '2026-08-06': { sum: -40, ids: ['split-1'] } }
        }],
        ['Кафе и доставка', {
            income: 0,
            expense: -95,
            categoryTotals: { 'Кафе и доставка': 95 },
            days: { '2026-08-01': AUGUST_DAYS['2026-08-01'], '2026-08-31': AUGUST_DAYS['2026-08-31'] }
        }],
        // Переводы: в списке есть, в доход и расход не идут.
        ['Перевод', {
            income: 0,
            expense: 0,
            categoryTotals: {},
            days: { '2026-08-02': AUGUST_DAYS['2026-08-02'], '2026-08-04': AUGUST_DAYS['2026-08-04'] }
        }],
        ['Категории нет', { income: 0, expense: 0, categoryTotals: {}, days: {} }]
    ])('фильтр по категории «%s»', (category, expected) => {
        expect(summarize(computePeriodData(onServer, '', { category }))).toEqual(expected);
    });

    // Фильтр по типу меняет только список: карточки считаются до него, иначе
    // при включённом «доходе» расход обнулился бы.
    it.each([
        ['expense', {
            '2026-07-06': JULY_DAYS['2026-07-06'],
            '2026-08-01': AUGUST_DAYS['2026-08-01'],
            '2026-08-03': AUGUST_DAYS['2026-08-03'],
            '2026-08-06': AUGUST_DAYS['2026-08-06'],
            '2026-08-31': AUGUST_DAYS['2026-08-31']
        }],
        ['income', { '2026-07-05': JULY_DAYS['2026-07-05'], ...SEPTEMBER_DAYS }],
        ['transfer', { '2026-08-02': AUGUST_DAYS['2026-08-02'], '2026-08-04': AUGUST_DAYS['2026-08-04'] }],
        ['initial', NOVEMBER_DAYS]
    ])('фильтр по типу «%s» меняет список, но не карточки', (type, days) => {
        expect(summarize(computePeriodData(onServer, '', { type }))).toEqual({ ...LIFETIME_CARDS, days });
    });

    it('все три фильтра сразу', () => {
        // Год, карта, «Продукты», расход: t3 и одна часть разделённой покупки.
        expect(summarize(computePeriodData(onServer, '2026', { account: 'acc-card', category: 'Продукты', type: 'expense' }))).toEqual({
            income: 0,
            expense: -160.55,
            categoryTotals: { 'Продукты': 160.55 },
            days: { '2026-07-06': JULY_DAYS['2026-07-06'], '2026-08-06': { sum: -40, ids: ['split-1'] } }
        });
    });

    it('на пустой истории', () => {
        expect(computePeriodData([], '2026-08')).toEqual({ transactions: {}, income: 0, expense: 0, categoryTotals: {} });
    });
});

describe('computePeriodData: правила, которые легко потерять', () => {
    const august = computePeriodData(onServer, '2026-08');

    it('переводы и excludeFromStats не идут ни в доход, ни в расход', () => {
        // t5 и t7 - переводы, t6 - помечен excludeFromStats. Остаются
        // обед 30, разделённая покупка 40 + 15.30 и ужин 65.
        expect(august.expense).toBeCloseTo(-150.30, 2);
        expect(august.income).toBe(0);
    });

    it('разделённая операция собирается в одну строку списка', () => {
        const day = august.transactions['2026-08-06'];
        const group = day.items.find(item => item.type === 'split_group');

        expect(day.items).toHaveLength(1);
        expect(group.id).toBe('split-1');
        expect(group.items).toHaveLength(2);
        expect(group.visualAmount).toBeCloseTo(-55.30, 2);
        // Описание группы - общая часть до скобки с уточнением.
        expect(group.description).toBe('Лидл');
    });

    it('итог дня считается по тем же правилам, что и статистика', () => {
        // 2 августа - только перевод, он в итог дня не идёт.
        expect(august.transactions['2026-08-02'].dailySum).toBe(0);
        expect(august.transactions['2026-08-01'].dailySum).toBe(-30);
    });

    it('разбивка по категориям берёт только расходы и по модулю', () => {
        expect(august.categoryTotals).toEqual({
            'Кафе и доставка': 95,
            'Продукты': 40,
            'Шопинг': 15.30
        });
    });

    it('стартовый баланс не попадает в доход, но остаётся в списке', () => {
        const lifetime = computePeriodData(onServer, '');

        expect(lifetime.transactions['2025-11-09'].items).toHaveLength(1);
        expect(lifetime.transactions['2025-11-09'].dailySum).toBe(0);
        // 4200 зарплаты и 300 фриланса - стартовых 5650 среди них нет.
        expect(lifetime.income).toBe(4500);
    });

    it.each([undefined, null])('не падает на разделённой операции без описания (%s)', (description) => {
        // Модель описание не требует, а прежняя клиентская версия здесь падала на
        // t.description.split(...). Отдавать из-за этого 500 нельзя.
        const noDescription = transformTransactions([
            { _id: 's1', title: 'Часть 1', amount: 10, type: 'expense', category: 'Продукты', description, account: 'acc-card', date: '2026-08-10T00:00:00.000Z', splitId: 'split-2' },
            { _id: 's2', title: 'Часть 2', amount: 20, type: 'expense', category: 'Шопинг', description, account: 'acc-card', date: '2026-08-10T00:00:00.000Z', splitId: 'split-2' }
        ], accounts);

        const result = computePeriodData(noDescription, '2026-08');
        const group = result.transactions['2026-08-10'].items[0];

        expect(group.type).toBe('split_group');
        expect(group.description).toBe('');
        expect(group.items).toHaveLength(2);
        expect(result.expense).toBe(-30);
    });

    it('операция без категории идёт в разбивку под «Другое»', () => {
        const dirty = transformTransactions([
            { _id: 'd1', amount: '100', type: 'expense', account: 'acc-card', date: '2026-01-01' }
        ], accounts);

        expect(computePeriodData(dirty, '2026-01').categoryTotals).toEqual({ 'Другое': 100 });
    });

    it('соседние годы не смешиваются при выборе месяца', () => {
        const years = transformTransactions([
            { _id: 'y1', amount: '100', type: 'income', date: '2025-01-01' },
            { _id: 'y2', amount: '200', type: 'income', date: '2026-01-01' }
        ], accounts);

        expect(computePeriodData(years, '2025-01').income).toBe(100);
        expect(computePeriodData(years, '2026-01').income).toBe(200);
    });
});

describe('split company snapshots', () => {
    const part = (id, overrides = {}) => ({
        _id: id, amount: 10, type: 'expense', category: 'Красота', account: 'acc-card', date: '2026-08-10T00:00:00.000Z',
        splitId: 'company-split', companyName: 'Chop Chop', description: 'Стрижка (утром)', logoMode: 'domain', merchantDomain: 'chopchop.me', ...overrides
    });
    it.each([
        // label, изменения во второй части, companyName, logoMode, merchantDomain группы
        ['same company', {}, 'Chop Chop', 'domain', 'chopchop.me'],
        ['different company', { companyName: 'Другой салон' }, '', undefined, undefined],
        ['legacy mixed with new', { companyName: undefined }, '', undefined, undefined],
        ['different logo snapshot', { merchantDomain: 'barber.com' }, 'Chop Chop', 'category', undefined]
    ])('groups split parts consistently for %s', (_label, changes, companyName, logoMode, merchantDomain) => {
        const docs = [part('s1'), part('s2', changes)];
        const result = computePeriodData(transformTransactions(docs), '2026-08');
        const day = result.transactions['2026-08-10'];
        const group = day.items[0];
        expect(day.items).toHaveLength(1);
        expect(group.type).toBe('split_group');
        expect(group.items.map(item => item.id)).toEqual(['s1', 's2']);
        expect(group.companyName).toBe(companyName);
        expect(group.logoMode).toBe(logoMode);
        expect(group.merchantDomain).toBe(merchantDomain);
        expect(group.description).toBe('Стрижка (утром)');
        expect(group.visualAmount).toBe(-20);
        expect(day.dailySum).toBe(-20);
        expect(result.expense).toBe(-20);
    });
});

describe('split company snapshots: состав группы', () => {
    const common = {
        splitId: 'split-1', amount: 20, type: 'expense', account: 'acc-card', date: '2026-01-10T00:00:00.000Z',
        companyName: 'Wolt', description: 'Обед', logoMode: 'domain', merchantDomain: 'wolt.com'
    };
    const groupWith = (first, second) => computePeriodData(transformTransactions([
        { ...common, _id: '1', ...first }, { ...common, _id: '2', ...second }
    ], accounts), '2026-01').transactions['2026-01-10'].items[0];

    it('общая компания и точный комментарий не зависят от категорий частей', () => {
        const group = groupWith(
            { category: 'Еда', companyId: 'company-1', description: 'Обед (для гостей)' },
            { category: 'Подарки', companyId: 'company-1', description: 'Обед (для гостей)' }
        );

        expect(group).toMatchObject({
            companyName: 'Wolt', description: 'Обед (для гостей)', logoMode: 'domain', merchantDomain: 'wolt.com', visualAmount: -40
        });
        // Снимок компании лежит в частях, а не в самой группе.
        expect(group.items.every(item => item.companyId === 'company-1')).toBe(true);
        expect(group).not.toHaveProperty('companyId');
    });

    it('не берёт компанию и комментарий у первой части, если части разошлись', () => {
        expect(groupWith({}, { companyName: 'Zara', description: 'Подарок' })).toMatchObject({ companyName: '', description: '' });
        // У второй части компании нет вовсе (старая запись): группа без компании, но комментарий общий.
        expect(groupWith({}, { companyName: undefined })).toMatchObject({ companyName: '', description: 'Обед' });
    });

    it('при разных логотипах компания остаётся, а логотип по домену пропадает', () => {
        const group = groupWith({}, { merchantDomain: 'zara.com' });

        expect(group).toMatchObject({ companyName: 'Wolt', logoMode: 'category' });
        expect(group).not.toHaveProperty('merchantDomain');
    });
});

describe('periodPrefixOf', () => {
    it.each([
        ['month', '2026-08', '2026-08'],
        ['year', '2026-08', '2026'],
        ['lifetime', '2026-08', '']
    ])('%s / %s', (timeRange, month, expected) => {
        expect(periodPrefixOf(timeRange, month)).toBe(expected);
    });
});

describe('computePeriod: обёртка для роута', () => {
    it('принимает сырые документы и повторяет тот же результат', () => {
        expect(computePeriod(transactions, accounts, { timeRange: 'month', month: '2026-08' }))
            .toEqual(computePeriodData(onServer, '2026-08'));
    });

    it('на «всё время» отдаёт всю историю', () => {
        expect(computePeriod(transactions, accounts, { timeRange: 'lifetime', month: '2026-08' }))
            .toEqual(computePeriodData(onServer, ''));
    });

    it('на «год» берёт год из выбранного месяца', () => {
        expect(computePeriod(transactions, accounts, { timeRange: 'year', month: '2026-08' }))
            .toEqual(computePeriodData(onServer, '2026'));
    });
});
