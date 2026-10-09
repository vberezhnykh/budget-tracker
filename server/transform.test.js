import { describe, it, expect } from 'vitest';
import { transformTransactions as transformOnServer, matchesAccount } from './transform.js';

// Тот же набор данных, что и в stats.test.js: он специально проходит по
// всем правилам, которые легко перепутать - перевод, заморозка,
// excludeFromStats, разделённая операция, последний день месяца в UTC.
const accounts = [
    { _id: 'acc-card', name: 'Revolut', type: 'card', excludeFromTotal: false },
    { _id: 'acc-cash', name: 'Наличные', type: 'cash', excludeFromTotal: false },
    { _id: 'acc-deposit', name: 'Залог', type: 'card', excludeFromTotal: true },
    { _id: 'acc-exchange', name: 'Обмен', type: 'cash', excludeFromTotal: true },
];

const transactions = [
    { _id: 't1', title: 'Стартовый баланс', amount: 5650, type: 'initial', category: 'Другое', account: 'acc-cash', date: '2025-11-09T00:00:00.000Z' },
    { _id: 't2', __v: 3, title: 'Зарплата', amount: 4200, type: 'income', category: 'Зарплата', account: 'acc-card', date: '2026-07-05T00:00:00.000Z' },
    { _id: 't3', title: 'Продукты', amount: 120.55, type: 'expense', category: 'Продукты', account: 'acc-card', date: '2026-07-06T00:00:00.000Z' },
    { _id: 't5', title: 'Перевод', amount: 500, type: 'transfer', category: 'Перевод', account: 'acc-card', toAccount: 'acc-cash', date: '2026-08-02T00:00:00.000Z' },
    { _id: 't6', title: 'Возврат долга', amount: 900, type: 'expense', category: 'Другое', account: 'acc-card', date: '2026-08-03T00:00:00.000Z', excludeFromStats: true },
    { _id: 't8', title: 'Обмен', amount: 700, type: 'transfer', category: 'Обмен', account: 'acc-exchange', toAccount: 'acc-cash', date: '2026-08-05T00:00:00.000Z' },
    { _id: 't9', title: 'Продукты', amount: 40, type: 'expense', category: 'Продукты', account: 'acc-card', date: '2026-08-06T00:00:00.000Z', splitId: 'split-1' },
    { _id: 't11', title: 'Ужин', amount: 65, type: 'expense', category: 'Кафе и доставка', account: 'acc-cash', date: '2026-08-31T00:00:00.000Z' },
    // Операция со старым литералом вместо идентификатора счёта - такие
    // остались до появления коллекции счетов.
    { _id: 't13', title: 'Старая покупка', amount: 12, type: 'expense', category: 'Другое', account: 'cash', date: '2025-12-01T00:00:00.000Z' },
    // Счёт, которого нет в справочнике: тип должен вывестись в 'card'.
    { _id: 't14', title: 'Неизвестный счёт', amount: 5, type: 'expense', category: 'Другое', account: 'acc-удалённый', date: '2025-12-02T00:00:00.000Z' },
];

describe('transformTransactions: полный вид преобразованной операции', () => {
    const rowsById = (docs, accs) => Object.fromEntries(transformOnServer(docs, accs).map(t => [t.id, t]));

    it('на всём наборе: каждая операция превращается в ожидаемую строку', () => {
        // Главная проверка модуля: агрегаты считаются поверх этого
        // преобразования, и расхождение здесь разъехалось бы сразу во всех.
        // Для каждой операции: знаковая сумма, движение по счетам, типы
        // счетов и дата.
        const rows = transformOnServer(transactions, accounts);

        expect(rows.map(t => [t.id, t.visualAmount, t.accountFlows, t.accountType, t.toAccountType, t.date])).toEqual([
            ['t1', 5650, { 'acc-cash': 5650 }, 'cash', null, '2025-11-09'],
            ['t2', 4200, { 'acc-card': 4200 }, 'card', null, '2026-07-05'],
            ['t3', -120.55, { 'acc-card': -120.55 }, 'card', null, '2026-07-06'],
            ['t5', 500, { 'acc-card': -500, 'acc-cash': 500 }, 'card', 'cash', '2026-08-02'],
            ['t6', -900, { 'acc-card': -900 }, 'card', null, '2026-08-03'],
            // Счёт «Обмена» - cash в справочнике, поэтому тип назначения тоже cash.
            ['t8', 700, { 'acc-exchange': -700, 'acc-cash': 700 }, 'cash', 'cash', '2026-08-05'],
            ['t9', -40, { 'acc-card': -40 }, 'card', null, '2026-08-06'],
            ['t11', -65, { 'acc-cash': -65 }, 'cash', null, '2026-08-31'],
            ['t13', -12, { cash: -12 }, 'cash', null, '2025-12-01'],
            ['t14', -5, { 'acc-удалённый': -5 }, 'card', null, '2025-12-02'],
        ]);
    });

    it('все поля одной строки: расход в карточном счёте', () => {
        // Остальные поля (заголовок, логотип, флаги) - значения по умолчанию.
        expect(rowsById(transactions, accounts).t3).toEqual({
            id: 't3',
            __v: 0,
            title: 'Продукты',
            amount: 120.55,
            visualAmount: -120.55,
            accountFlows: { 'acc-card': -120.55 },
            type: 'expense',
            category: 'Продукты',
            logoMode: 'auto',
            account: 'acc-card',
            toAccount: null,
            accountType: 'card',
            toAccountType: null,
            date: '2026-07-06',
            excludeFromStats: false
        });
    });

    it('все поля одной строки: перевод с «Обменом» в старой категории', () => {
        expect(rowsById(transactions, accounts).t8).toEqual({
            id: 't8',
            __v: 0,
            title: 'Обмен',
            amount: 700,
            visualAmount: 700,
            accountFlows: { 'acc-exchange': -700, 'acc-cash': 700 },
            type: 'transfer',
            // Старая категория «Обмен» читается как «Перевод».
            category: 'Перевод',
            logoMode: 'auto',
            account: 'acc-exchange',
            toAccount: 'acc-cash',
            accountType: 'cash',
            toAccountType: 'cash',
            date: '2026-08-05',
            excludeFromStats: false
        });
    });

    it('разделённая операция сохраняет splitId', () => {
        expect(rowsById(transactions, accounts).t9).toMatchObject({ id: 't9', splitId: 'split-1', visualAmount: -40 });
    });

    it('без справочника счетов типы выводятся только из литерала cash', () => {
        // Справочника нет: «cash» - наличные, всё остальное (включая
        // идентификатор acc-cash, о котором никто не знает) - карта.
        const rows = transformOnServer(transactions);

        expect(rows.map(t => [t.id, t.accountType, t.toAccountType])).toEqual([
            ['t1', 'card', null],
            ['t2', 'card', null],
            ['t3', 'card', null],
            ['t5', 'card', 'card'],
            ['t6', 'card', null],
            ['t8', 'card', 'card'],
            ['t9', 'card', null],
            ['t11', 'card', null],
            ['t13', 'cash', null],
            ['t14', 'card', null],
        ]);
        // Суммы и движение по счетам от справочника не зависят.
        expect(rows[3].accountFlows).toEqual({ 'acc-card': -500, 'acc-cash': 500 });
    });

    it('на пустой истории', () => {
        expect(transformOnServer([], accounts)).toEqual([]);
        expect(transformOnServer(undefined, accounts)).toEqual([]);
    });

    it('preserves the logo choice of API history and period results', () => {
        const fixture = { ...transactions[2], title: 'Chop Chop' };
        const variants = [
            { ...fixture, _id: 'chosen-company', logoMode: 'domain', merchantDomain: 'chopchop.me' },
            { ...fixture, _id: 'chosen-category', logoMode: 'category' },
            { ...fixture, _id: 'automatic', logoMode: 'auto' },
            { ...fixture, _id: 'legacy' }
        ];
        const serverRows = transformOnServer(variants, accounts);
        expect(serverRows.map(({ id, logoMode, merchantDomain }) => ({ id, logoMode, merchantDomain }))).toEqual([
            { id: 'chosen-company', logoMode: 'domain', merchantDomain: 'chopchop.me' },
            { id: 'chosen-category', logoMode: 'category', merchantDomain: undefined },
            { id: 'automatic', logoMode: 'auto', merchantDomain: undefined },
            { id: 'legacy', logoMode: 'auto', merchantDomain: undefined }
        ]);
    });

    it('preserves company snapshots and distinguishes explicit no company from legacy rows', () => {
        const fixture = transactions[2];
        const rows = [
            { ...fixture, _id: 'company', companyId: '507f1f77bcf86cd799439011', companyName: 'Chop Chop' },
            { ...fixture, _id: 'no-company', companyName: '' },
            { ...fixture, _id: 'legacy' }
        ];
        const transformed = transformOnServer(rows);
        expect(transformed[0]).toMatchObject({ companyId: rows[0].companyId, companyName: 'Chop Chop' });
        expect(transformed[1]).toHaveProperty('companyName', '');
        expect(transformed[2]).not.toHaveProperty('companyName');
    });
});

describe('transformTransactions: правила, которые легко потерять', () => {
    const byId = Object.fromEntries(transformOnServer(transactions, accounts).map(t => [t.id, t]));

    it('перевод показывается положительной суммой и двигает два счёта', () => {
        const transfer = byId['t5'];

        expect(transfer.visualAmount).toBe(500);
        expect(transfer.accountFlows).toEqual({ 'acc-card': -500, 'acc-cash': 500 });
    });

    it('расход уходит в минус, доход и стартовый баланс - в плюс', () => {
        expect(byId['t3'].visualAmount).toBe(-120.55);
        expect(byId['t2'].visualAmount).toBe(4200);
        expect(byId['t1'].visualAmount).toBe(5650);
    });

    it('старая категория «Обмен» у перевода читается как «Перевод»', () => {
        // Данные в базе не правились - приведение только на входе.
        expect(byId['t8'].category).toBe('Перевод');
    });

    it('дата приводится в UTC: последний день месяца остаётся в своём месяце', () => {
        // В локальной зоне сервера 31 августа могло бы стать 1 сентября, и
        // операция уехала бы в соседний месяц во всех отчётах сразу.
        expect(byId['t11'].date).toBe('2026-08-31');
    });

    it('тип счёта берётся из справочника, а для литерала и неизвестного - выводится', () => {
        expect(byId['t3'].accountType).toBe('card');
        expect(byId['t13'].accountType).toBe('cash');
        expect(byId['t14'].accountType).toBe('card');
    });

    it('excludeFromStats доезжает, а по умолчанию false', () => {
        expect(byId['t6'].excludeFromStats).toBe(true);
        expect(byId['t3'].excludeFromStats).toBe(false);
    });

    it('сохраняет версию документа, а legacy без __v считает версией 0', () => {
        expect(byId['t2'].__v).toBe(3);
        expect(byId['t3'].__v).toBe(0);
    });
});

describe('matchesAccount', () => {
    const transformed = transformOnServer(transactions, accounts);
    const find = (id) => transformed.find(t => t.id === id);

    it('обычная операция совпадает по своему счёту', () => {
        expect(matchesAccount(find('t3'), 'acc-card')).toBe(true);
        expect(matchesAccount(find('t3'), 'acc-cash')).toBe(false);
    });

    it('перевод совпадает с обоими своими концами', () => {
        expect(matchesAccount(find('t5'), 'acc-card')).toBe(true);
        expect(matchesAccount(find('t5'), 'acc-cash')).toBe(true);
        expect(matchesAccount(find('t5'), 'acc-deposit')).toBe(false);
    });

    it('группа счетов задаётся строкой type:', () => {
        expect(matchesAccount(find('t11'), 'type:cash')).toBe(true);
        expect(matchesAccount(find('t11'), 'type:card')).toBe(false);
        // У перевода достаточно совпадения любого конца.
        expect(matchesAccount(find('t5'), 'type:cash')).toBe(true);
        expect(matchesAccount(find('t5'), 'type:card')).toBe(true);
    });
});
