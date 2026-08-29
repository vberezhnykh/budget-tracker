import { describe, it, expect } from 'vitest';
import { transformTransactions as transformOnServer, matchesAccount } from './transform.js';
import { transformTransactions as transformOnClient } from '../src/utils/finance.js';

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
    { _id: 't2', title: 'Зарплата', amount: 4200, type: 'income', category: 'Зарплата', account: 'acc-card', date: '2026-07-05T00:00:00.000Z' },
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

describe('transformTransactions на сервере совпадает с клиентским', () => {
    it('на всём наборе, поле в поле', () => {
        // Главная проверка модуля: агрегаты, которые переезжают на сервер,
        // считаются поверх этого преобразования, и расхождение здесь
        // разъехалось бы сразу во всех тринадцати.
        expect(transformOnServer(transactions, accounts)).toEqual(transformOnClient(transactions, accounts));
    });

    it('без справочника счетов - тоже', () => {
        expect(transformOnServer(transactions)).toEqual(transformOnClient(transactions));
    });

    it('на пустой истории', () => {
        expect(transformOnServer([], accounts)).toEqual(transformOnClient([], accounts));
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
