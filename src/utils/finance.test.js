import { describe, it, expect } from 'vitest';
import {
    transformTransactions,
    getDescriptionSuggestions,
    splitCategoriesByUsage,
    categoryUsageKey
} from './finance';

describe('transformTransactions', () => {
    const mockData = [
        { _id: '1', amount: '1000', type: 'initial', account: 'card', date: '2026-01-01T00:00:00Z' },
        { _id: '2', amount: '500', type: 'income', account: 'cash', category: 'Salary', date: '2026-01-05T00:00:00Z' },
        { _id: '3', amount: '200', type: 'expense', account: 'card', category: 'Food', date: '2026-01-10T00:00:00Z' },
        { _id: '4', amount: '100', type: 'transfer', account: 'card', toAccount: 'cash', date: '2026-01-15T00:00:00Z' }
    ];

    it('transforms transactions correctly', () => {
        const transformed = transformTransactions(mockData);

        // Initial balance (Card: +1000)
        expect(transformed[0].accountFlows['card']).toBe(1000);

        // Income (Cash: +500)
        expect(transformed[1].accountFlows['cash']).toBe(500);

        // Expense (Card: -200)
        expect(transformed[2].accountFlows['card']).toBe(-200);

        // Transfer (Card: -100, Cash: +100)
        expect(transformed[3].accountFlows['card']).toBe(-100);
        expect(transformed[3].accountFlows['cash']).toBe(100);
        expect(transformed[3].visualAmount).toBe(100); // Visual should stay positive for transfers
    });

    it('preserves the optimistic-concurrency version and maps legacy rows to version zero', () => {
        const transformed = transformTransactions([
            { _id: 'versioned', __v: 4, amount: 10, type: 'expense', account: 'card', date: '2026-01-01' },
            { _id: 'legacy', amount: 20, type: 'expense', account: 'card', date: '2026-01-02' },
        ]);

        expect(transformed[0].__v).toBe(4);
        expect(transformed[1].__v).toBe(0);
    });

    it('preserves the saved logo selection when transactions are reloaded', () => {
        const common = { amount: 10, type: 'expense', account: 'card', date: '2026-09-12' };
        const [selected, category, legacy] = transformTransactions([
            { ...common, _id: 'selected', logoMode: 'domain', merchantDomain: 'chophairdressing.com' },
            { ...common, _id: 'category', logoMode: 'category' },
            { ...common, _id: 'legacy' },
        ]);
        expect(selected).toMatchObject({ logoMode: 'domain', merchantDomain: 'chophairdressing.com' });
        expect(category.logoMode).toBe('category');
        expect(legacy.logoMode).toBe('auto');
    });

    it('preserves company snapshots and distinguishes explicitly empty companies from legacy rows', () => {
        const common = { amount: 10, type: 'expense', account: 'card', date: '2026-09-12', description: 'Подарок' };
        const [selected, empty, legacy] = transformTransactions([
            { ...common, _id: 'selected', companyId: 'company-1', companyName: 'Chop Chop', logoMode: 'domain', merchantDomain: 'chophairdressing.com' },
            { ...common, _id: 'empty', companyName: '' },
            { ...common, _id: 'legacy' },
        ]);
        expect(selected).toMatchObject({ companyId: 'company-1', companyName: 'Chop Chop', description: 'Подарок', logoMode: 'domain', merchantDomain: 'chophairdressing.com' });
        expect(empty.companyName).toBe('');
        expect(empty).not.toHaveProperty('companyId');
        expect(legacy).not.toHaveProperty('companyName');
        expect(legacy).not.toHaveProperty('companyId');
    });

    it('renames the legacy "Обмен" transfer category to "Перевод"', () => {
        const transformed = transformTransactions([
            { _id: 't1', amount: '100', type: 'transfer', account: 'card', toAccount: 'cash', category: 'Обмен', date: '2026-01-15T00:00:00Z' },
            { _id: 't2', amount: '100', type: 'transfer', account: 'card', toAccount: 'cash', category: 'Депозит', date: '2026-01-16T00:00:00Z' },
            { _id: 't3', amount: '50', type: 'expense', account: 'card', category: 'Обмен', date: '2026-01-17T00:00:00Z' }
        ]);

        expect(transformed[0].category).toBe('Перевод');
        // A transfer saved under some other category keeps it, and a
        // non-transfer named "Обмен" is left alone - only the legacy
        // transfer default is renamed.
        expect(transformed[1].category).toBe('Депозит');
        expect(transformed[2].category).toBe('Обмен');
    });
});

describe('getDescriptionSuggestions', () => {
    const history = [
        { category: 'Продукты', type: 'expense', description: 'Wolt', date: '2026-01-01' },
        { category: 'Продукты', type: 'expense', description: 'wolt ', date: '2026-01-20' },
        { category: 'Продукты', type: 'expense', description: 'Lidl', date: '2026-01-05' },
        { category: 'Продукты', type: 'expense', description: '', date: '2026-01-06' },
        { category: 'Развлечения', type: 'expense', description: 'Кино', date: '2026-01-07' },
        { category: 'Другое', type: 'income', description: 'Возврат', date: '2026-01-08' },
        { category: 'Другое', type: 'expense', description: 'Штраф', date: '2026-01-09' }
    ];

    it('returns the comments used for that category, most frequent first', () => {
        expect(getDescriptionSuggestions(history, 'Продукты', 'expense')).toEqual(['wolt', 'Lidl']);
    });

    it('does not leak comments across categories', () => {
        expect(getDescriptionSuggestions(history, 'Развлечения', 'expense')).toEqual(['Кино']);
    });

    it('separates same-named categories of different types', () => {
        expect(getDescriptionSuggestions(history, 'Другое', 'income')).toEqual(['Возврат']);
        expect(getDescriptionSuggestions(history, 'Другое', 'expense')).toEqual(['Штраф']);
    });

    it('breaks frequency ties by most recent use', () => {
        const ties = [
            { category: 'Транспорт', type: 'expense', description: 'Такси', date: '2026-01-01' },
            { category: 'Транспорт', type: 'expense', description: 'Бензин', date: '2026-01-10' }
        ];
        expect(getDescriptionSuggestions(ties, 'Транспорт', 'expense')).toEqual(['Бензин', 'Такси']);
    });

    it('respects the limit and handles empty input', () => {
        expect(getDescriptionSuggestions(history, 'Продукты', 'expense', 1)).toEqual(['wolt']);
        expect(getDescriptionSuggestions(history, '', 'expense')).toEqual([]);
        expect(getDescriptionSuggestions([], 'Продукты', 'expense')).toEqual([]);
    });
});

describe('splitCategoriesByUsage', () => {
    const categories = [
        { _id: 'c1', name: 'Продукты', type: 'expense', order: 1 },
        { _id: 'c2', name: 'Еда вне дома', type: 'expense', order: 2 },
        { _id: 'c3', name: 'Транспорт', type: 'expense', order: 3 },
        { _id: 'c4', name: 'Отпуск', type: 'expense', order: 4 },
        { _id: 'c5', name: 'Подписки', type: 'expense', order: 5 },
        { _id: 'c6', name: 'Зарплата', type: 'income', order: 1 },
    ];

    const tx = (category, date, type = 'expense') => ({ category, date, type });
    const now = new Date('2026-08-26');
    const options = { limit: 3, now };

    it('поднимает наверх то, чем пользуются чаще, и оставляет остальное в хвосте', () => {
        const transactions = [
            tx('Подписки', '2026-08-01'),
            tx('Подписки', '2026-08-10'),
            tx('Подписки', '2026-08-20'),
            tx('Транспорт', '2026-08-05'),
            tx('Транспорт', '2026-08-15'),
            tx('Продукты', '2026-08-12'),
        ];

        const { frequent, rest } = splitCategoriesByUsage(categories, transactions, 'expense', options);

        expect(frequent.map(c => c.name)).toEqual(['Подписки', 'Транспорт', 'Продукты']);
        expect(rest.map(c => c.name)).toEqual(['Еда вне дома', 'Отпуск']);
    });

    it('фильтрует по типу - доходная категория не попадает в расходный список', () => {
        const { frequent, rest } = splitCategoriesByUsage(categories, [], 'expense', options);

        expect([...frequent, ...rest].map(c => c.name)).not.toContain('Зарплата');
        expect(splitCategoriesByUsage(categories, [], 'income', options).frequent.map(c => c.name))
            .toEqual(['Зарплата']);
    });

    it('не даёт одноимённой категории другого типа накрутить частоту', () => {
        const withDuplicate = [...categories, { _id: 'c7', name: 'Другое', type: 'expense', order: 6 }];
        const transactions = [
            tx('Другое', '2026-08-01', 'income'),
            tx('Другое', '2026-08-02', 'income'),
            tx('Другое', '2026-08-03', 'income'),
        ];

        const { frequent } = splitCategoriesByUsage(withDuplicate, transactions, 'expense', options);

        expect(frequent.map(c => c.name)).toEqual(['Продукты', 'Еда вне дома', 'Транспорт']);
    });

    it('игнорирует операции старше окна', () => {
        const transactions = [
            tx('Отпуск', '2026-01-10'), // больше 90 дней назад
            tx('Отпуск', '2026-01-11'),
            tx('Продукты', '2026-08-20'),
        ];

        const { frequent } = splitCategoriesByUsage(categories, transactions, 'expense', options);

        expect(frequent[0].name).toBe('Продукты');
        expect(frequent.map(c => c.name)).not.toContain('Отпуск');
    });

    it('падает обратно на всю историю, когда в окне нет ни одной операции', () => {
        const transactions = [tx('Отпуск', '2026-01-10'), tx('Отпуск', '2026-01-11')];

        const { frequent } = splitCategoriesByUsage(categories, transactions, 'expense', options);

        expect(frequent[0].name).toBe('Отпуск');
    });

    it('добирает неиспользованные категории в серверном порядке, чтобы блок не был пустым', () => {
        const { frequent, rest } = splitCategoriesByUsage(categories, [], 'expense', options);

        expect(frequent.map(c => c.name)).toEqual(['Продукты', 'Еда вне дома', 'Транспорт']);
        expect(rest.map(c => c.name)).toEqual(['Отпуск', 'Подписки']);
    });

    it('показывает выбранную категорию рядом с частыми, даже если она из хвоста', () => {
        const { frequent, rest } = splitCategoriesByUsage(categories, [], 'expense', { ...options, pinned: 'Отпуск' });

        expect(frequent.map(c => c.name)).toEqual(['Продукты', 'Еда вне дома', 'Транспорт', 'Отпуск']);
        expect(rest.map(c => c.name)).toEqual(['Подписки']);
    });

    it('не дублирует выбранную категорию, если она и так в топе', () => {
        const { frequent, rest } = splitCategoriesByUsage(categories, [], 'expense', { ...options, pinned: 'Продукты' });

        expect(frequent.map(c => c.name)).toEqual(['Продукты', 'Еда вне дома', 'Транспорт']);
        expect(rest.map(c => c.name)).toEqual(['Отпуск', 'Подписки']);
    });

    it('переживает пустые входные данные', () => {
        expect(splitCategoriesByUsage([], [], 'expense')).toEqual({ frequent: [], rest: [] });
        expect(splitCategoriesByUsage(null, null, 'expense')).toEqual({ frequent: [], rest: [] });
    });
});

describe('categoryUsageKey', () => {
    it('склеивает тип и имя, чтобы одноимённые категории разных типов не смешивались', () => {
        expect(categoryUsageKey({ type: 'expense', name: 'Другое' })).toBe('expense::Другое');
        expect(categoryUsageKey({ type: 'income', name: 'Другое' })).toBe('income::Другое');
    });
});
