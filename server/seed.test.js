// @vitest-environment node
//
// Засев пустой базы. Раньше он жил прямо в .then() у mongoose.connect и
// потому не проверялся ничем: сработать он мог только как побочный эффект
// импорта сервера. Проверять его стоит по той же причине, по которой стоит
// проверять миграции: выполняется он один раз в жизни базы, и увидеть
// результат до того, как станет поздно, больше негде.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { connectTestDb, disconnectTestDb, clearCollections, DB_HOOK_TIMEOUT } from './test/harness.js';

let seedDefaults;
let Account;
let Category;
let Transaction;

// Засев многословен в логах, а в прогоне тестов это шум.
const silent = { log: () => {} };

beforeAll(async () => {
    await connectTestDb('seed');
    ({ seedDefaults } = await import('./seed.js'));
    Account = mongoose.model('Account');
    Category = mongoose.model('Category');
    Transaction = mongoose.model('Transaction');
}, DB_HOOK_TIMEOUT);

afterAll(disconnectTestDb, DB_HOOK_TIMEOUT);
beforeEach(clearCollections);

describe('seedDefaults', () => {
    it('наполняет пустую базу счетами, категориями и стартовым балансом', async () => {
        const report = await seedDefaults(silent);

        expect(report.accounts).toBe(4);
        expect(report.categories).toBe(16);
        expect(report.initialBalance).toBe(true);

        expect(await Account.countDocuments()).toBe(4);
        expect(await Category.countDocuments({ type: 'expense' })).toBe(11);
        expect(await Category.countDocuments({ type: 'income' })).toBe(5);
    });

    it('вешает стартовый баланс на счёт наличных, а не на строку "cash"', async () => {
        await seedDefaults(silent);

        const cash = await Account.findOne({ name: 'Наличные' });
        const initial = await Transaction.findOne({ type: 'initial' });

        expect(initial.account).toBe(cash._id.toString());
        expect(initial.amount).toBe(5650);
    });

    it('второй прогон ничего не добавляет', async () => {
        // Функция вызывается при каждом старте сервера, а не один раз при
        // разворачивании: неидемпотентный засев удваивал бы счета и стартовый
        // баланс при каждом перезапуске.
        await seedDefaults(silent);
        const second = await seedDefaults(silent);

        expect(second).toEqual({ accounts: 0, categories: 0, initialBalance: false, migrated: null });
        expect(await Account.countDocuments()).toBe(4);
        expect(await Category.countDocuments()).toBe(16);
        expect(await Transaction.countDocuments({ type: 'initial' })).toBe(1);
    });

    it('возвращает удалённые категории, но не трогает остальное', async () => {
        // Категории разрешено удалять все до одной; тогда при следующем
        // старте сервер заливает стандартный набор заново. Счета и стартовый
        // баланс при этом должны остаться как были.
        await seedDefaults(silent);
        await Category.deleteMany({});

        const report = await seedDefaults(silent);

        expect(report.categories).toBe(16);
        expect(report.accounts).toBe(0);
        expect(report.initialBalance).toBe(false);
        expect(await Transaction.countDocuments({ type: 'initial' })).toBe(1);
    });

    it('переводит старые операции с литералов card/cash на идентификаторы счетов', async () => {
        // До появления коллекции счетов операции хранили в account не
        // идентификатор, а строку. Миграция идёт только вместе с засевом
        // счетов - то есть ровно на той базе, где такие операции и остались.
        await Transaction.create([
            { title: 'Старый расход', amount: 100, type: 'expense', category: 'Продукты', account: 'card', date: '2025-12-01T00:00:00.000Z' },
            { title: 'Старые наличные', amount: 50, type: 'expense', category: 'Продукты', account: 'cash', date: '2025-12-02T00:00:00.000Z' },
            { title: 'Перевод в карту', amount: 30, type: 'transfer', account: 'cash', toAccount: 'card', date: '2025-12-03T00:00:00.000Z' },
            { title: 'Перевод в наличные', amount: 40, type: 'transfer', account: 'card', toAccount: 'cash', date: '2025-12-04T00:00:00.000Z' }
        ]);

        const report = await seedDefaults(silent);

        const card = await Account.findOne({ name: 'Жена BOC' });
        const cash = await Account.findOne({ name: 'Наличные' });

        // По два документа на каждый литерал в account (расход и перевод) и
        // по одному в toAccount.
        expect(report.migrated).toEqual({ account: 2, cash: 2, toAccount: 1, toCash: 1 });
        expect((await Transaction.findOne({ title: 'Старый расход' })).account).toBe(card._id.toString());
        expect((await Transaction.findOne({ title: 'Старые наличные' })).account).toBe(cash._id.toString());

        // У перевода мигрируют оба конца, и каждый - в свой счёт.
        const transfer = await Transaction.findOne({ title: 'Перевод в карту' });
        expect(transfer.account).toBe(cash._id.toString());
        expect(transfer.toAccount).toBe(card._id.toString());

        // Литералов в базе не остаётся ни в одном из полей.
        expect(await Transaction.countDocuments({
            $or: [{ account: { $in: ['card', 'cash'] } }, { toAccount: { $in: ['card', 'cash'] } }]
        })).toBe(0);
    });

    it('не запускает миграцию на базе, где счета уже заведены', async () => {
        await Account.create({ name: 'Мой Revolut', type: 'card', order: 1 });
        await Transaction.create({
            title: 'Старый расход', amount: 100, type: 'expense',
            category: 'Продукты', account: 'card', date: '2025-12-01T00:00:00.000Z'
        });

        const report = await seedDefaults(silent);

        expect(report.migrated).toBeNull();
        // Литерал остаётся как есть: переписывать его не на что - счетов
        // из старого набора в этой базе нет.
        expect((await Transaction.findOne({ title: 'Старый расход' })).account).toBe('card');
    });
});
