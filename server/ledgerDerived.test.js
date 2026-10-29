// @vitest-environment node

import { describe, it, expect, vi } from 'vitest';
import mongoose from 'mongoose';
import { createDerived, derivedOf, accountsJsonOf, categoriesJsonOf } from './ledgerDerived.js';
import { createLedgerCache } from './ledgerCache.js';
import { buildDashboard } from './dashboard.js';
import { transformTransactions } from './transform.js';
import { computeBalances, computeMonthEndBalances, computeMonthlyTotalsByAccount } from './stats.js';
import { computeCategoryUsage } from './analytics.js';

const ObjectId = mongoose.Types.ObjectId;

const card = { _id: new ObjectId(), name: 'Карта', type: 'card', order: 1 };
const cash = { _id: new ObjectId(), name: 'Наличные', type: 'cash', order: 2 };
const accounts = [card, cash];
const docs = [
    { _id: new ObjectId(), type: 'income', amount: 1000, category: 'Зарплата', account: String(card._id), date: new Date('2026-08-01T00:00:00Z') },
    { _id: new ObjectId(), type: 'expense', amount: 40, category: 'Продукты', account: String(card._id), date: new Date('2026-08-05T00:00:00Z') },
    { _id: new ObjectId(), type: 'transfer', amount: 100, account: String(card._id), toAccount: String(cash._id), date: new Date('2026-08-06T00:00:00Z') },
    { _id: new ObjectId(), type: 'expense', amount: 7, category: 'Продукты', account: String(cash._id), date: new Date('2026-09-02T00:00:00Z') }
];
const snapshotOf = (extra = {}) => ({ version: 1, loadedAt: 0, docs, accounts, categories: [], settings: null, ...extra });

describe('createDerived', () => {
    it('считает каждую величину один раз и отдаёт тот же объект при повторных обращениях', () => {
        const derived = createDerived({ docs, accounts });

        for (const name of ['transactions', 'balances', 'monthEndBalances', 'monthlyTotalsByAccount', 'categoryUsage']) {
            expect(derived[name](), name).toBe(derived[name]());
        }
    });

    it('значения равны тем, что считают сами функции', () => {
        const derived = createDerived({ docs, accounts });

        expect(derived.transactions()).toEqual(transformTransactions(docs, accounts));
        expect(derived.balances()).toEqual(computeBalances(docs, accounts));
        expect(derived.monthEndBalances()).toEqual(computeMonthEndBalances(docs, accounts));
        expect(derived.monthlyTotalsByAccount()).toEqual(computeMonthlyTotalsByAccount(docs, accounts, { category: null }));
        expect(derived.categoryUsage()).toEqual(computeCategoryUsage(transformTransactions(docs, accounts)));
    });

    it('итоги по месяцам с категорией считаются заново и не запоминаются', () => {
        const derived = createDerived({ docs, accounts });

        const food = derived.monthlyTotalsByAccount('Продукты');

        expect(food).toEqual(computeMonthlyTotalsByAccount(docs, accounts, { category: 'Продукты' }));
        expect(food).not.toBe(derived.monthlyTotalsByAccount('Продукты'));
        expect(derived.monthlyTotalsByAccount()).toBe(derived.monthlyTotalsByAccount(null));
        expect(derived.monthlyTotalsByAccount()).not.toEqual(food);
    });

    it('transactionOf отдаёт ту же расчётную операцию, что и общий список', () => {
        const derived = createDerived({ docs, accounts });

        docs.forEach((doc, index) => expect(derived.transactionOf(doc)).toBe(derived.transactions()[index]));
        expect(derived.transactionOf({})).toBeUndefined();
    });

    it('сводка с запомненными производными равна сводке без них', () => {
        const params = { month: '2026-08', timeRange: 'month', today: '2026-08-15', analytics: true };
        const derived = createDerived({ docs, accounts });

        const withDerived = buildDashboard(docs, accounts, params, derived);
        // Второй вызов на тех же производных (другой месяц и счёт) не пересчитывает основу.
        const second = buildDashboard(docs, accounts, { ...params, month: '2026-09', account: String(cash._id) }, derived);

        expect(withDerived).toEqual(buildDashboard(docs, accounts, params));
        expect(second).toEqual(buildDashboard(docs, accounts, { ...params, month: '2026-09', account: String(cash._id) }));
        expect(second.balances).toBe(withDerived.balances);
        expect(second.monthlyTotalsByAccount).toBe(withDerived.monthlyTotalsByAccount);
    });
});

describe('derivedOf: производные привязаны к снимку', () => {
    it('в пределах снимка один и тот же набор', () => {
        const snapshot = snapshotOf();

        expect(derivedOf(snapshot)).toBe(derivedOf(snapshot));
        expect(derivedOf(snapshot).transactions()).toBe(derivedOf(snapshot).transactions());
    });

    it('новый снимок получает пустые производные, старый хранит свои', () => {
        const first = snapshotOf();
        const second = snapshotOf({ version: 2 });
        const firstTransactions = derivedOf(first).transactions();

        expect(derivedOf(second).transactions()).not.toBe(firstTransactions);
        expect(derivedOf(first).transactions()).toBe(firstTransactions);
    });

    it('после invalidate кэш ставит новый снимок и производные считаются заново', async () => {
        const flush = () => new Promise(resolve => setImmediate(resolve));
        const load = vi.fn(async () => ({ docs: [...docs], accounts: [...accounts], categories: [], settings: null }));
        const cache = createLedgerCache({ load, reloadDebounceMs: 0, logger: { warn() {} } });

        const { snapshot: before } = await cache.get();
        const transactions = derivedOf(before).transactions();
        // Тот же снимок (hit) - те же производные.
        expect(derivedOf((await cache.get()).snapshot).transactions()).toBe(transactions);

        cache.invalidate({ reload: false });
        const { snapshot: after } = await cache.get();
        await flush();

        expect(after).not.toBe(before);
        expect(derivedOf(after).transactions()).not.toBe(transactions);
        expect(derivedOf(after).transactions()).toEqual(transactions);
    });
});

describe('справочники готовой строкой', () => {
    const legacyAccount = { _id: new ObjectId(), name: 'Старый', type: 'card' };

    it('счета идут в порядке order, документ без order - раньше всех, равные порядки не переставляются', () => {
        const first = { _id: new ObjectId(), name: 'Первый', type: 'card', order: 1 };
        const tieA = { _id: new ObjectId(), name: 'Ничья А', type: 'card', order: 3 };
        const tieB = { _id: new ObjectId(), name: 'Ничья Б', type: 'card', order: 3 };
        const snapshot = snapshotOf({ accounts: [tieA, first, legacyAccount, tieB] });

        const names = JSON.parse(accountsJsonOf(snapshot)).map(account => account.name);

        expect(names).toEqual(['Старый', 'Первый', 'Ничья А', 'Ничья Б']);
    });

    it('в документе без полей схемы подставляются значения по умолчанию, как у результата find()', () => {
        const [account] = JSON.parse(accountsJsonOf(snapshotOf({ accounts: [legacyAccount] })));

        expect(account).toMatchObject({ name: 'Старый', icon: '💳', isDefault: false, excludeFromTotal: false, order: 0 });
        expect(Object.keys(account)).not.toContain('id');
    });

    it('строка запоминается на снимок', () => {
        const snapshot = snapshotOf({ categories: [{ _id: new ObjectId(), name: 'Еда', type: 'expense', order: 1 }] });

        expect(accountsJsonOf(snapshot)).toBe(accountsJsonOf(snapshot));
        expect(categoriesJsonOf(snapshot)).toBe(categoriesJsonOf(snapshot));
        expect(JSON.parse(categoriesJsonOf(snapshot))).toMatchObject([{ name: 'Еда', type: 'expense', order: 1 }]);
    });
});
