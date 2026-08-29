import { describe, it, expect } from 'vitest';
import { computePeriodData, computePeriod, periodPrefixOf } from './periodStats.js';
import { transformTransactions } from './transform.js';
import { getPeriodData, getPeriodPrefix, transformTransactions as transformOnClient } from '../src/utils/finance.js';

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
const onClient = transformOnClient(transactions, accounts);

const PERIODS = ['2026-08', '2026-07', '2026', ''];
const ACCOUNT_FILTERS = [null, 'acc-card', 'acc-cash', 'acc-deposit', 'type:card', 'type:cash'];

describe('computePeriodData совпадает с getPeriodData', () => {
    it.each(PERIODS)('период «%s» без фильтров', (prefix) => {
        expect(computePeriodData(onServer, prefix)).toEqual(getPeriodData(onClient, prefix));
    });

    it.each(ACCOUNT_FILTERS)('фильтр по счёту %s', (account) => {
        expect(computePeriodData(onServer, '2026-08', { account }))
            .toEqual(getPeriodData(onClient, '2026-08', account));
    });

    it.each(['Продукты', 'Кафе и доставка', 'Перевод', 'Категории нет'])(
        'фильтр по категории «%s»',
        (category) => {
            expect(computePeriodData(onServer, '', { category }))
                .toEqual(getPeriodData(onClient, '', null, category));
        }
    );

    it.each(['expense', 'income', 'transfer', 'initial'])('фильтр по типу «%s»', (type) => {
        expect(computePeriodData(onServer, '', { type }))
            .toEqual(getPeriodData(onClient, '', null, null, type));
    });

    it('все три фильтра сразу', () => {
        expect(computePeriodData(onServer, '2026', { account: 'acc-card', category: 'Продукты', type: 'expense' }))
            .toEqual(getPeriodData(onClient, '2026', 'acc-card', 'Продукты', 'expense'));
    });

    it('на пустой истории', () => {
        expect(computePeriodData([], '2026-08')).toEqual(getPeriodData([], '2026-08'));
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

    it('не падает на разделённой операции без описания', () => {
        // Модель описание не требует, а клиентская версия здесь падает на
        // t.description.split(...). Отдавать из-за этого 500 нельзя.
        const noDescription = transformTransactions([
            { _id: 's1', title: 'Часть 1', amount: 10, type: 'expense', category: 'Продукты', account: 'acc-card', date: '2026-08-10T00:00:00.000Z', splitId: 'split-2' },
            { _id: 's2', title: 'Часть 2', amount: 20, type: 'expense', category: 'Шопинг', account: 'acc-card', date: '2026-08-10T00:00:00.000Z', splitId: 'split-2' }
        ], accounts);

        const result = computePeriodData(noDescription, '2026-08');

        expect(result.transactions['2026-08-10'].items[0].description).toBe('');
        expect(result.expense).toBe(-30);
    });
});

describe('periodPrefixOf совпадает с getPeriodPrefix', () => {
    it.each([
        ['month', '2026-08'],
        ['year', '2026-08'],
        ['lifetime', '2026-08']
    ])('%s / %s', (timeRange, month) => {
        expect(periodPrefixOf(timeRange, month)).toBe(getPeriodPrefix(timeRange, month));
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
