import { describe, it, expect } from 'vitest';
import { prepareData, executeTool, buildToolDefinitions, describeToolCall, formatRangeRu, formatMonthRu, MAX_GROUPS } from './askTools.js';
import { transformTransactions } from './transform.js';
import { computePeriodData } from './periodStats.js';
import { computeYearlyData, computeLifetimeStats, applyFilters } from './analytics.js';
import { computeBalances, computeMonthlyTotals } from './stats.js';
import { computeTypicalMonth } from './typicalMonth.js';

const TODAY = '2026-10-12';

const accounts = [
    { _id: 'acc-card', name: 'Revolut', type: 'card', excludeFromTotal: false },
    { _id: 'acc-cash', name: 'Наличные', type: 'cash', excludeFromTotal: false },
    { _id: 'acc-deposit', name: 'Залог', type: 'card', excludeFromTotal: true }
];

const categories = [
    { name: 'Транспорт', type: 'expense' },
    { name: 'Кафе', type: 'expense' },
    { name: 'Продукты', type: 'expense' },
    { name: 'Прочее', type: 'expense' },
    { name: 'Зарплата', type: 'income' },
    { name: 'Прочее', type: 'income' }
];

const tx = (id, type, amount, category, account, date, extra = {}) => ({
    _id: id, type, amount, category, account, date: `${date}T00:00:00.000Z`, title: category, ...extra
});

const docs = [
    tx('i0', 'initial', 5650, 'Другое', 'acc-cash', '2025-11-09'),
    // Лето 2025
    tx('a1', 'expense', 20, 'Транспорт', 'acc-card', '2025-06-10', { companyName: 'Bolt' }),
    tx('a2', 'expense', 30.5, 'Транспорт', 'acc-cash', '2025-07-15', { companyName: 'Uber' }),
    tx('a3', 'expense', 12, 'Транспорт', 'acc-card', '2025-08-31', { companyName: 'Bolt' }),
    // Лето 2026
    tx('b1', 'expense', 25, 'Транспорт', 'acc-card', '2026-06-01', { companyName: 'Bolt' }),
    tx('b2', 'expense', 40.25, 'Транспорт', 'acc-card', '2026-07-20', { companyName: 'Bolt', description: 'аэропорт' }),
    tx('b3', 'expense', 15, 'Транспорт', 'acc-cash', '2026-08-31', { companyName: 'Uber' }),
    tx('b4', 'expense', 99, 'Транспорт', 'acc-card', '2026-09-01', { companyName: 'Bolt' }),
    // Старая операция без поля companyName: имя берётся из описания
    tx('b5', 'expense', 7, 'Транспорт', 'acc-card', '2026-07-02', { title: 'Такси', description: 'bolt' }),
    // Не в статистике и перевод в расход не входят
    tx('b6', 'expense', 500, 'Транспорт', 'acc-card', '2026-07-03', { companyName: 'Bolt', excludeFromStats: true }),
    tx('b7', 'transfer', 300, 'Перевод', 'acc-card', '2026-07-04', { toAccount: 'acc-cash' }),
    // Август 2026 в других категориях
    tx('c1', 'expense', 18.4, 'Кафе', 'acc-cash', '2026-08-10', { companyName: 'Wolt', description: 'обед' }),
    tx('c2', 'expense', 60, 'Продукты', 'acc-card', '2026-08-12', { companyName: 'Lidl' }),
    tx('c3', 'income', 3000, 'Зарплата', 'acc-card', '2026-08-05'),
    tx('c4', 'income', 50, 'Прочее', 'acc-cash', '2026-08-20'),
    tx('c5', 'expense', 10, 'Прочее', 'acc-cash', '2026-08-21'),
    tx('c6', 'transfer', 2000, 'Обмен', 'acc-card', '2026-08-22', { toAccount: 'acc-deposit' }),
    // Продукты каждый месяц: из них строится «типичный месяц»
    ...[3, 4, 5, 6, 7, 9].map(month => tx(`g${month}`, 'expense', 100 + month, 'Продукты', 'acc-card', `2026-${String(month).padStart(2, '0')}-05`, { companyName: 'Lidl' })),
    tx('g10', 'expense', 80, 'Продукты', 'acc-card', '2026-10-03', { companyName: 'Lidl' })
];

const data = prepareData({ docs, accounts, categories, today: TODAY });
const transformed = transformTransactions(docs, accounts);

const run = (name, input) => {
    const outcome = executeTool(name, input, data);
    return { ...outcome, json: outcome.isError ? null : JSON.parse(outcome.content) };
};
const sum = (input) => run('sum_operations', {
    from: '2026-01-01', to: '2026-12-31', type: 'expense', category: null, account: null, company: null, group_by: 'none', ...input
});
const find = (input) => run('find_operations', {
    from: '2025-01-01', to: '2026-12-31', type: null, category: null, account: null, text: null, sort: 'date_desc', limit: null, ...input
});
const cents = (value) => Math.round(value * 100) / 100;

describe('sum_operations: итоги совпадают с функциями экранов', () => {
    it('расход за месяц равен расходу карточки периода', () => {
        const period = computePeriodData(transformed, '2026-08', { includeTransactions: false });
        const result = sum({ from: '2026-08-01', to: '2026-08-31' }).json;
        expect(result.total).toBe(cents(-period.expense));
        // 15 + 18.4 + 60 + 10: перевод и «не в статистике» не входят
        expect(result.total).toBe(103.4);
        expect(result.count).toBe(4);
    });

    it('доход за месяц равен доходу карточки периода', () => {
        const period = computePeriodData(transformed, '2026-08', { includeTransactions: false });
        const result = sum({ from: '2026-08-01', to: '2026-08-31', type: 'income' }).json;
        expect(result.total).toBe(cents(period.income));
        expect(result.total).toBe(3050);
        expect(result.count).toBe(2);
    });

    it('категория и счёт дают тот же итог, что фильтры периода', () => {
        const byCategory = computePeriodData(transformed, '2026-07', { includeTransactions: false, category: 'Транспорт' });
        expect(sum({ from: '2026-07-01', to: '2026-07-31', category: 'Транспорт' }).json.total).toBe(cents(-byCategory.expense));

        const byAccount = computePeriodData(transformed, '2026-08', { includeTransactions: false, account: 'acc-cash' });
        const result = sum({ from: '2026-08-01', to: '2026-08-31', account: 'Наличные' }).json;
        expect(result.total).toBe(cents(-byAccount.expense));
        expect(result.filters).toEqual({ category: null, account: 'Наличные', company: null });
    });

    it('год и всё время совпадают с годовой и общей сводкой', () => {
        const yearly = computeYearlyData(transformed, '2026-08');
        expect(sum({ from: '2026-01-01', to: '2026-12-31' }).json.total).toBe(cents(-yearly.expense));

        const lifetime = computeLifetimeStats(transformed, '2025-11-09');
        expect(sum({ from: '2025-11-09', to: '2026-12-31' }).json.total).toBe(cents(-lifetime.expense));
        expect(sum({ from: '2025-11-09', to: '2026-12-31', type: 'income' }).json.total).toBe(cents(lifetime.income));
    });

    it('сумма разложена руками: лето 2026 и лето 2025', () => {
        // 25 + 40.25 + 7 (старая запись) + 15; 99 в сентябре, 500 «не в статистике»
        expect(sum({ from: '2026-06-01', to: '2026-08-31', category: 'Транспорт' }).json).toMatchObject({ total: 87.25, count: 4 });
        expect(sum({ from: '2025-06-01', to: '2025-08-31', category: 'Транспорт' }).json).toMatchObject({ total: 62.5, count: 3 });
    });

    it('день границы входит в период с обеих сторон', () => {
        expect(sum({ from: '2026-08-31', to: '2026-08-31', category: 'Транспорт' }).json.total).toBe(15);
        expect(sum({ from: '2026-06-01', to: '2026-06-01', category: 'Транспорт' }).json.total).toBe(25);
    });

    it('перевод в расход и доход не входит ни при каком фильтре по счёту', () => {
        const result = sum({ from: '2026-07-04', to: '2026-07-04', account: 'Наличные' }).json;
        expect(result).toMatchObject({ total: 0, count: 0 });
    });

    it('фильтр по компании: без регистра, и по описанию старой записи', () => {
        const result = sum({ from: '2026-06-01', to: '2026-08-31', company: ['BOLT'] }).json;
        // 25 + 40.25 и старая запись с описанием «bolt» (7); 500 не в статистике
        expect(result.total).toBe(72.25);
        expect(result.count).toBe(3);
        expect(result.filters.company).toEqual(['BOLT']);
        expect(result).not.toHaveProperty('note');
        expect(sum({ from: '2026-06-01', to: '2026-08-31', company: [' uber '] }).json.total).toBe(15);
    });

    it('несколько компаний считаются вместе: Bolt и Uber', () => {
        const result = sum({ from: '2026-06-01', to: '2026-08-31', category: 'Транспорт', company: ['Bolt', 'Uber'] }).json;
        expect(result).toMatchObject({ total: 87.25, count: 4, filters: { company: ['Bolt', 'Uber'] } });
        expect(result).not.toHaveProperty('note');
        // Регистр и порядок не важны, повтор не удваивает сумму
        const mixed = sum({ from: '2026-06-01', to: '2026-08-31', category: 'Транспорт', company: ['uber', 'BOLT', ' bolt '] }).json;
        expect(mixed).toMatchObject({ total: 87.25, count: 4, filters: { company: ['uber', 'BOLT'] } });
    });

    it('одна строка вместо списка принимается как список из одной компании', () => {
        const result = sum({ from: '2026-06-01', to: '2026-08-31', company: 'bolt' }).json;
        expect(result).toMatchObject({ total: 72.25, count: 3, filters: { company: ['bolt'] } });
    });

    it('пустой список и пустая строка - без фильтра по компании', () => {
        const all = sum({ from: '2026-06-01', to: '2026-08-31' }).json;
        expect(sum({ from: '2026-06-01', to: '2026-08-31', company: [] }).json).toEqual(all);
        expect(sum({ from: '2026-06-01', to: '2026-08-31', company: '  ' }).json).toEqual(all);
        expect(all.filters.company).toBeNull();
    });

    it('компания, которой нет, возвращает ноль и подсказку с её названием', () => {
        const result = sum({ company: ['Несуществующая'] }).json;
        expect(result).toMatchObject({ total: 0, count: 0 });
        expect(result.note).toBe('No operation has exactly these company names: Несуществующая. Check the spelling with find_operations (text) or group_by company.');
    });

    it('часть названий неизвестна: известные считаются, неизвестное названо в подсказке', () => {
        const result = sum({ from: '2026-06-01', to: '2026-08-31', company: ['Bolt', 'Taxify', 'Uber', 'Gett'] }).json;
        expect(result).toMatchObject({ total: 87.25, count: 4 });
        expect(result.note).toMatch(/exactly these company names: Taxify, Gett\./);
        expect(result.note).not.toMatch(/Bolt|Uber/);
    });

    it('группировка по компаниям вместе со списком компаний', () => {
        const result = sum({ from: '2026-06-01', to: '2026-08-31', company: ['Bolt', 'Uber', 'Wolt'], group_by: 'company' }).json;
        expect(result.groups).toEqual([
            { key: 'Bolt', total: 72.25, count: 3 },
            { key: 'Wolt', total: 18.4, count: 1 },
            { key: 'Uber', total: 15, count: 1 }
        ]);
        expect(result.total).toBe(105.65);
    });
});

describe('sum_operations: группировка', () => {
    it('по месяцам: каждый месяц равен расходу из итогов месяцев', () => {
        const totals = computeMonthlyTotals(docs, accounts);
        const result = sum({ from: '2026-03-01', to: '2026-10-31', group_by: 'month' }).json;
        for (const group of result.groups) {
            expect(group.total).toBe(cents(-totals[group.key].expense));
        }
        expect(result.groups.map(group => group.key).sort()).toEqual(Object.keys(totals).filter(key => key >= '2026-03' && key <= '2026-10').sort());
        expect(cents(result.groups.reduce((acc, group) => acc + group.total, 0))).toBe(result.total);
    });

    it('группы идут от большей суммы к меньшей', () => {
        const { groups } = sum({ from: '2026-08-01', to: '2026-08-31', group_by: 'category' }).json;
        expect(groups).toEqual([
            { key: 'Продукты', total: 60, count: 1 },
            { key: 'Кафе', total: 18.4, count: 1 },
            { key: 'Транспорт', total: 15, count: 1 },
            { key: 'Прочее', total: 10, count: 1 }
        ]);
    });

    it('по категориям: те же суммы, что в разбивке периода', () => {
        const period = computePeriodData(transformed, '2026-08', { includeTransactions: false });
        const { groups } = sum({ from: '2026-08-01', to: '2026-08-31', group_by: 'category' }).json;
        expect(Object.fromEntries(groups.map(group => [group.key, group.total]))).toEqual(
            Object.fromEntries(Object.entries(period.categoryTotals).map(([key, value]) => [key, cents(value)]))
        );
    });

    it('по счетам и по компаниям', () => {
        const byAccount = sum({ from: '2026-06-01', to: '2026-08-31', category: 'Транспорт', group_by: 'account' }).json.groups;
        expect(byAccount).toEqual([{ key: 'Revolut', total: 72.25, count: 3 }, { key: 'Наличные', total: 15, count: 1 }]);

        const byCompany = sum({ from: '2026-06-01', to: '2026-08-31', category: 'Транспорт', group_by: 'company' }).json.groups;
        // Старая запись «bolt» и Bolt - одна компания
        expect(byCompany).toEqual([{ key: 'Bolt', total: 72.25, count: 3 }, { key: 'Uber', total: 15, count: 1 }]);
    });

    it('без группировки поля groups нет', () => {
        expect(sum({}).json).not.toHaveProperty('groups');
        expect(sum({ group_by: 'month' }).json).toHaveProperty('groups');
    });

    it(`больше ${MAX_GROUPS} групп: остаток собирается в others`, () => {
        const many = Array.from({ length: 45 }, (_, index) => tx(`m${index}`, 'expense', index + 1, 'Прочее', 'acc-card', '2026-05-10', { companyName: `Shop ${String(index + 1).padStart(2, '0')}` }));
        const bigData = prepareData({ docs: many, accounts, categories, today: TODAY });
        const outcome = executeTool('sum_operations', {
            from: '2026-05-01', to: '2026-05-31', type: 'expense', category: null, account: null, company: null, group_by: 'company'
        }, bigData);
        const result = JSON.parse(outcome.content);
        expect(result.groups).toHaveLength(MAX_GROUPS);
        expect(result.groups[0]).toEqual({ key: 'Shop 45', total: 45, count: 1 });
        // Остались суммы 1..5
        expect(result.others).toEqual({ groups: 5, total: 15, count: 5 });
        expect(result.total).toBe(1035);
    });
});

describe('find_operations', () => {
    it('находит по тексту в компании, описании и названии без регистра', () => {
        const byCompany = find({ text: 'BOLT', sort: 'amount_desc' }).json;
        // a1, a3, b1, b2, b4, b6 и старая запись b5 (описание bolt)
        expect(byCompany.total_found).toBe(7);
        expect(byCompany.operations.map(op => op.amount)).toEqual([500, 99, 40.25, 25, 20, 12, 7]);

        expect(find({ text: 'АЭРОПОРТ' }).json.operations).toHaveLength(1);
        expect(find({ text: 'такси' }).json.operations[0]).toMatchObject({ date: '2026-07-02', amount: 7 });
    });

    it('текст без совпадений: в результате подсказка про категории; с совпадениями и без текста её нет', () => {
        const empty = find({ text: 'кофе' }).json;
        expect(empty.total_found).toBe(0);
        expect(empty.operations).toEqual([]);
        expect(empty.note).toBe('No operation has this text in its company name or note. Text search does not look at categories: for a kind of spending use sum_operations with the closest category.');

        expect(find({ text: 'bolt' }).json).not.toHaveProperty('note');
        expect(find({ text: null }).json).not.toHaveProperty('note');
        // Пустой результат без текста (другой фильтр) подсказки не получает.
        const noText = find({ from: '2020-01-01', to: '2020-01-02' }).json;
        expect(noText.total_found).toBe(0);
        expect(noText).not.toHaveProperty('note');
    });

    it('сортирует: новые первыми или крупные первыми, и ограничивает число', () => {
        const newest = find({ category: 'Транспорт', from: '2026-01-01', limit: 3 }).json;
        expect(newest.total_found).toBe(7 - 1);
        expect(newest.operations.map(op => op.date)).toEqual(['2026-09-01', '2026-08-31', '2026-07-20']);

        const biggest = find({ type: 'expense', from: '2026-08-01', to: '2026-08-31', sort: 'amount_desc', limit: 2 }).json;
        expect(biggest.operations.map(op => op.amount)).toEqual([60, 18.4]);
        expect(biggest.total_found).toBe(4);
    });

    it('по умолчанию 15 строк, но total_found считает все', () => {
        const many = Array.from({ length: 20 }, (_, index) => tx(`n${index}`, 'expense', 5, 'Прочее', 'acc-card', `2026-05-${String(index + 1).padStart(2, '0')}`));
        const outcome = executeTool('find_operations', {
            from: '2026-05-01', to: '2026-05-31', type: null, category: null, account: null, text: null, sort: 'date_desc', limit: null
        }, prepareData({ docs: many, accounts, categories, today: TODAY }));
        const result = JSON.parse(outcome.content);
        expect(result.total_found).toBe(20);
        expect(result.operations).toHaveLength(15);
    });

    it('показывает поля операции: счёт по имени, компания, описание', () => {
        const [op] = find({ text: 'аэропорт' }).json.operations;
        expect(op).toEqual({
            date: '2026-07-20', amount: 40.25, type: 'expense', category: 'Транспорт', account: 'Revolut', company: 'Bolt', description: 'аэропорт'
        });
        // Старая запись: имя - это описание, комментария нет
        expect(find({ text: 'такси' }).json.operations[0]).toMatchObject({ company: 'bolt', description: '' });
    });

    it('перевод показывает оба счёта, а операция вне статистики помечена', () => {
        const transfer = find({ type: 'transfer', from: '2026-07-01', to: '2026-07-31' }).json.operations;
        expect(transfer).toEqual([expect.objectContaining({ type: 'transfer', amount: 300, account: 'Revolut', to_account: 'Наличные' })]);
        const excluded = find({ text: 'bolt', from: '2026-07-03', to: '2026-07-03' }).json.operations[0];
        expect(excluded).toMatchObject({ amount: 500, not_in_stats: true });
    });

    it('счёт в поиске находит и переводы на этот счёт', () => {
        const result = find({ account: 'Наличные', from: '2026-07-04', to: '2026-07-04' }).json;
        expect(result.operations).toHaveLength(1);
        expect(result.operations[0].type).toBe('transfer');
    });

    it('стартовый баланс в поиск не попадает', () => {
        expect(find({ from: '2025-11-01', to: '2025-11-30' }).json.total_found).toBe(0);
    });

    it('в результате указаны действующие фильтры', () => {
        expect(find({ category: 'Кафе', text: 'wolt' }).json).toMatchObject({
            filters: { type: null, category: 'Кафе', account: null, text: 'wolt' }, from: '2025-01-01', to: '2026-12-31', sort: 'date_desc'
        });
    });
});

describe('get_balances', () => {
    it('совпадает с computeBalances и учитывает замороженный счёт', () => {
        const expected = computeBalances(transformed, accounts);
        const { json } = run('get_balances', {});
        const byName = Object.fromEntries(json.accounts.map(account => [account.name, account]));
        expect(byName.Revolut.balance).toBe(cents(expected.byAccount['acc-card']));
        expect(byName['Наличные'].balance).toBe(cents(expected.byAccount['acc-cash']));
        expect(byName['Залог']).toMatchObject({ balance: 2000, excluded_from_total: true, type: 'card' });
        expect(json.total).toBe(cents(expected.total));
        expect(json.held_on_excluded_accounts).toBe(cents(expected.held));
        expect(json.by_type).toEqual({ card: cents(expected.byType.card), cash: cents(expected.byType.cash) });
        expect(json.as_of).toBe(TODAY);
    });

    it('операция «не в статистике» остаётся в остатках', () => {
        // 500 из b6 не входит в статистику, но деньги со счёта ушли
        const without = prepareData({ docs: docs.filter(doc => doc._id !== 'b6'), accounts, categories, today: TODAY });
        const before = JSON.parse(executeTool('get_balances', {}, without).content).accounts.find(account => account.name === 'Revolut').balance;
        const after = run('get_balances', {}).json.accounts.find(account => account.name === 'Revolut').balance;
        expect(cents(before - after)).toBe(500);
    });

    it('деньги на счёте-литерале без записи в справочнике не теряются', () => {
        const legacy = prepareData({ docs: [{ _id: 'l1', type: 'income', amount: 70, category: 'Зарплата', date: '2026-05-01T00:00:00.000Z' }], accounts: [], categories, today: TODAY });
        const result = JSON.parse(executeTool('get_balances', {}, legacy).content);
        expect(result.accounts).toEqual([{ name: 'Карта', type: 'card', balance: 70, excluded_from_total: false }]);
    });
});

describe('get_typical_month', () => {
    it('собирает компактную сводку из computeTypicalMonth', () => {
        const typical = computeTypicalMonth(transformed, { month: '2026-10', today: TODAY, category: 'Продукты' });
        const { json } = run('get_typical_month', { month: '2026-10', category: 'Продукты' });
        expect(json).toMatchObject({
            month: '2026-10',
            category: 'Продукты',
            available: true,
            status: 'current',
            reference_months: typical.months,
            typical_month_total: typical.monthTotal,
            days_counted: 12,
            spent_so_far: 80,
            typical_by_this_day: typical.byDay[11],
            typical_remaining: typical.today.typicalRemaining,
            forecast_month_end: typical.today.forecast
        });
        expect(json.reference_months.length).toBeGreaterThanOrEqual(3);
    });

    it('прошлый месяц: без прогноза', () => {
        const { json } = run('get_typical_month', { month: '2026-08', category: null });
        expect(json).toMatchObject({ available: true, status: 'past', days_counted: 31 });
        expect(json).not.toHaveProperty('forecast_month_end');
    });

    it('мало истории: available=false с причиной', () => {
        const { json } = run('get_typical_month', { month: '2025-08', category: null });
        expect(json).toMatchObject({ available: false, month: '2025-08' });
        expect(json.reason).toMatch(/3 full months/);
    });
});

describe('проверка ввода: ошибка как is_error, а не исключение', () => {
    const valid = {
        from: '2026-01-01', to: '2026-12-31', type: 'expense', category: null, account: null, company: null, group_by: 'none'
    };

    it.each([
        ['несуществующая дата', { from: '2026-02-30' }, /from/],
        ['дата в другом формате', { to: '31.12.2026' }, /to/],
        ['from позже to', { from: '2026-12-31', to: '2026-01-01' }, /later/],
        ['период длиннее 10 лет', { from: '2010-01-01', to: '2026-01-01' }, /10 years/],
        ['неизвестный тип', { type: 'transfer' }, /type/],
        ['неизвестная категория', { category: 'Рестораны' }, /category/],
        ['категория другого типа', { category: 'Зарплата' }, /category/],
        ['неизвестный счёт', { account: 'Тинькофф' }, /account/],
        ['неизвестная группировка', { group_by: 'week' }, /group_by/],
        ['слишком длинная компания', { company: 'x'.repeat(101) }, /company/],
        ['слишком длинная компания в списке', { company: ['Bolt', 'x'.repeat(101)] }, /company/],
        ['больше десяти компаний', { company: Array.from({ length: 11 }, (_, index) => `Shop ${index}`) }, /at most 10/],
        ['компания не строка', { company: 5 }, /company/],
        ['в списке не строка', { company: ['Bolt', 5] }, /company/],
        ['в списке null', { company: ['Bolt', null] }, /company/]
    ])('sum_operations: %s', (_name, patch, message) => {
        const outcome = executeTool('sum_operations', { ...valid, ...patch }, data);
        expect(outcome.isError).toBe(true);
        expect(outcome.content).toMatch(message);
    });

    it('граница в десять лет допустима', () => {
        expect(executeTool('sum_operations', { ...valid, from: '2016-10-12', to: '2026-10-12' }, data).isError).toBe(false);
    });

    it.each([
        [{ limit: 0 }, /limit/],
        [{ limit: 31 }, /limit/],
        [{ limit: 2.5 }, /limit/],
        [{ sort: 'random' }, /sort/],
        [{ type: 'initial' }, /type/],
        [{ text: 'x'.repeat(101) }, /text/],
        [{ from: 'вчера' }, /from/]
    ])('find_operations: %j', (patch, message) => {
        const outcome = executeTool('find_operations', {
            from: '2026-01-01', to: '2026-12-31', type: null, category: null, account: null, text: null, sort: 'date_desc', limit: null, ...patch
        }, data);
        expect(outcome.isError).toBe(true);
        expect(outcome.content).toMatch(message);
    });

    it.each([{ month: '2026-13' }, { month: '2026-1' }, { month: 202610 }, { month: '1999-12' }, { month: '2026-10', category: 'Зарплата' }])('get_typical_month: %j', (input) => {
        expect(executeTool('get_typical_month', input, data).isError).toBe(true);
    });

    it('неизвестный инструмент и не-объект на входе', () => {
        expect(executeTool('drop_database', {}, data)).toMatchObject({ isError: true });
        expect(executeTool('constructor', {}, data)).toMatchObject({ isError: true });
        expect(executeTool('sum_operations', null, data)).toMatchObject({ isError: true });
        expect(executeTool('sum_operations', [], data)).toMatchObject({ isError: true });
        expect(executeTool('sum_operations', 'text', data)).toMatchObject({ isError: true });
    });

    it('никогда не бросает на мусоре', () => {
        const garbage = [{}, { from: {}, to: [] }, { from: null, to: null }, { type: 5, from: '2026-01-01', to: '2026-01-02' }, { category: {}, from: '2026-01-01', to: '2026-01-02', type: 'expense' }];
        for (const name of ['sum_operations', 'find_operations', 'get_typical_month']) {
            for (const input of garbage) expect(() => executeTool(name, input, data)).not.toThrow();
        }
    });

    it('отсутствие необязательных ключей равносильно null', () => {
        const outcome = executeTool('sum_operations', { from: '2026-08-01', to: '2026-08-31', type: 'expense' }, data);
        expect(outcome.isError).toBe(false);
        expect(JSON.parse(outcome.content).total).toBe(103.4);
    });
});

describe('buildToolDefinitions', () => {
    const tools = buildToolDefinitions(data);

    it('четыре инструмента со строгой схемой: все свойства обязательны', () => {
        expect(tools.map(tool => tool.name)).toEqual(['sum_operations', 'find_operations', 'get_balances', 'get_typical_month']);
        for (const tool of tools) {
            expect(tool.strict).toBe(true);
            expect(tool.input_schema.type).toBe('object');
            expect(tool.input_schema.additionalProperties).toBe(false);
            expect([...tool.input_schema.required].sort()).toEqual(Object.keys(tool.input_schema.properties).sort());
            expect(typeof tool.description).toBe('string');
        }
    });

    it('категории и счета - перечисления из данных человека, необязательное - через null', () => {
        const { properties } = tools[0].input_schema;
        expect(properties.category.anyOf).toEqual([{ type: 'string', enum: ['Транспорт', 'Кафе', 'Продукты', 'Прочее', 'Зарплата'] }, { type: 'null' }]);
        expect(properties.account.anyOf[0].enum).toEqual(['Revolut', 'Наличные', 'Залог']);
        expect(properties.company.anyOf).toEqual([{ type: 'array', items: { type: 'string' } }, { type: 'null' }]);
        expect(properties.group_by.enum).toEqual(['none', 'month', 'category', 'company', 'account']);
        expect(tools[3].input_schema.properties.category.anyOf[0].enum).toEqual(['Транспорт', 'Кафе', 'Продукты', 'Прочее']);
        expect(tools[2].input_schema.properties).toEqual({});
    });

    it('пустой список не превращается в пустой enum', () => {
        const empty = buildToolDefinitions({ categories: [], accounts: [] });
        expect(JSON.stringify(empty)).not.toContain('"enum":[]');
        expect(empty[0].input_schema.properties.category.type).toBe('null');
    });

    it('ограничения в схеме не используются: их проверяет сервер', () => {
        expect(JSON.stringify(tools)).not.toMatch(/"(minimum|maximum|minLength|maxLength|pattern|format)"/);
    });
});

describe('подпись шага', () => {
    it('формат периода', () => {
        expect(formatRangeRu('2026-06-01', '2026-08-31')).toBe('1 июня – 31 августа 2026');
        expect(formatRangeRu('2025-06-01', '2025-08-31')).toBe('1 июня – 31 августа 2025');
        expect(formatRangeRu('2026-09-01', '2026-09-30')).toBe('сентябрь 2026');
        expect(formatRangeRu('2026-02-01', '2026-02-28')).toBe('февраль 2026');
        expect(formatRangeRu('2024-02-01', '2024-02-29')).toBe('февраль 2024');
        expect(formatRangeRu('2026-01-01', '2026-12-31')).toBe('2026 год');
        expect(formatRangeRu('2026-09-05', '2026-09-05')).toBe('5 сентября 2026');
        expect(formatRangeRu('2026-09-05', '2026-09-20')).toBe('5 – 20 сентября 2026');
        expect(formatRangeRu('2025-12-15', '2026-01-14')).toBe('15 декабря 2025 – 14 января 2026');
        expect(formatRangeRu('2026-09-01', '2026-09-29')).toBe('1 – 29 сентября 2026');
        expect(formatRangeRu('нет', 'нет')).toBe('нет – нет');
    });

    it('все двенадцать месяцев в родительном и именительном падеже', () => {
        const genitive = Array.from({ length: 12 }, (_, index) => formatRangeRu(`2026-${String(index + 1).padStart(2, '0')}-10`, `2026-${String(index + 1).padStart(2, '0')}-11`).split(' ')[3]);
        expect(genitive).toEqual(['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']);
        expect(formatMonthRu('2026-10')).toBe('октябрь 2026');
        expect(formatMonthRu('2026-05')).toBe('май 2026');
    });

    it('подписи инструментов', () => {
        expect(describeToolCall('sum_operations', { from: '2026-06-01', to: '2026-08-31', type: 'expense', category: 'Транспорт' })).toBe('Транспорт, 1 июня – 31 августа 2026');
        expect(describeToolCall('sum_operations', { from: '2026-09-01', to: '2026-09-30', type: 'expense', category: null })).toBe('Расходы, сентябрь 2026');
        expect(describeToolCall('sum_operations', { from: '2026-09-01', to: '2026-09-30', type: 'income', category: null, account: 'Revolut' })).toBe('Доходы · Revolut, сентябрь 2026');
        expect(describeToolCall('sum_operations', { from: '2026-06-01', to: '2026-08-31', type: 'expense', category: 'Транспорт', company: ['Bolt', 'Uber'] })).toBe('Транспорт · Bolt, Uber, 1 июня – 31 августа 2026');
        expect(describeToolCall('sum_operations', { from: '2026-06-01', to: '2026-08-31', type: 'expense', category: null, company: 'Bolt' })).toBe('Расходы · Bolt, 1 июня – 31 августа 2026');
        expect(describeToolCall('find_operations', { text: 'такси', from: '2026-09-01', to: '2026-09-30' })).toBe('Поиск: такси, сентябрь 2026');
        expect(describeToolCall('find_operations', { category: 'Кафе', from: '2026-09-01', to: '2026-09-30' })).toBe('Операции: Кафе, сентябрь 2026');
        expect(describeToolCall('get_balances', {})).toBe('Остатки по счетам');
        expect(describeToolCall('get_typical_month', { month: '2026-10' })).toBe('Типичный месяц: октябрь 2026');
        expect(describeToolCall('get_typical_month', { month: '2026-10', category: 'Кафе' })).toBe('Типичный месяц: октябрь 2026, Кафе');
    });

    it('не падает на неверном вводе и неизвестном инструменте', () => {
        expect(describeToolCall('sum_operations', null)).toMatch(/Расходы/);
        expect(describeToolCall('sum_operations', { from: 5, to: {} })).toMatch(/Расходы/);
        expect(describeToolCall('sum_operations', { from: '2026-01-01', to: '2026-01-02', company: [5, null, {}, 'Bolt'] })).toBe('Расходы · Bolt, 1 – 2 января 2026');
        expect(describeToolCall('sum_operations', { from: '2026-01-01', to: '2026-01-02', company: ['К'.repeat(30), 'Л'.repeat(30)] }).length).toBeLessThan(90);
        expect(describeToolCall('what', {})).toBe('Расчёт');
        expect(describeToolCall('find_operations', { text: 'т'.repeat(100), from: '2026-01-01', to: '2026-01-02' }).length).toBeLessThan(80);
    });
});

describe('тот же отбор, что у applyFilters', () => {
    it('фильтры инструмента не расходятся с общей функцией на всех комбинациях', () => {
        for (const category of [null, 'Транспорт', 'Продукты']) {
            for (const account of [null, 'Revolut', 'Наличные']) {
                const accountId = account === 'Revolut' ? 'acc-card' : account === 'Наличные' ? 'acc-cash' : null;
                const expected = applyFilters(transformed.filter(t => t.date >= '2026-01-01' && t.date <= '2026-12-31'), { category, account: accountId, type: 'expense' })
                    .filter(t => !t.excludeFromStats)
                    .reduce((acc, t) => acc + t.amount, 0);
                expect(sum({ category, account }).json.total).toBe(cents(expected));
            }
        }
    });
});
