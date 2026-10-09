/**
 * Клиентские помощники для данных операций. Все агрегаты (балансы, итоги по
 * периодам и месяцам, сравнения, поиск, счётчики) считает сервер, а здесь
 * остаётся только то, что нужно интерфейсу на месте:
 *  - transformTransactions - приводит ответ API к виду, с которым работают
 *    экраны (знак суммы, движение по счетам, дата без времени);
 *  - getDescriptionSuggestions - подсказки комментариев в форме операции;
 *  - splitCategoriesByUsage - деление категорий на «частые» и остальные;
 *  - categoryUsageKey - ключ «тип::имя» для счётчиков использования категорий.
 */

export const transformTransactions = (data, accounts = []) => {
    const accountTypeMap = {};
    if (accounts && accounts.length > 0) {
        accounts.forEach(acc => {
            accountTypeMap[acc._id] = acc.type;
        });
    }

    return data.map(t => {
        const amount = parseFloat(t.amount);
        // Initial balance and Income are POSITIVE, Expense is NEGATIVE
        const signedAmount = (t.type === 'income' || t.type === 'initial') ? amount : -amount;
        const isTransfer = t.type === 'transfer';

        let visualAmount = signedAmount;
        const accountFlows = {};

        const account = t.account || 'card';
        const toAccount = t.toAccount || null;

        if (isTransfer) {
            visualAmount = amount; // Show absolute amount in history list
            if (account) accountFlows[account] = (accountFlows[account] || 0) - amount;
            if (toAccount) accountFlows[toAccount] = (accountFlows[toAccount] || 0) + amount;
        } else {
            if (account) accountFlows[account] = (accountFlows[account] || 0) + signedAmount;
        }

        return {
            id: t._id,
            __v: Number.isInteger(t.__v) ? t.__v : 0,
            title: t.title || t.category,
            amount: amount,
            visualAmount: visualAmount,
            accountFlows: accountFlows,
            type: t.type,
            // Transfers used to be saved under the category "Обмен"; the app
            // now calls them "Перевод" everywhere. Normalising on the way in
            // keeps history rows, the category filter and newly saved
            // transfers speaking the same word without touching stored data.
            category: isTransfer && t.category === 'Обмен' ? 'Перевод' : t.category,
            description: t.description,
            ...(typeof t.companyName === 'string' ? { companyName: t.companyName } : {}),
            ...(t.companyId ? { companyId: t.companyId } : {}),
            logoMode: t.logoMode || 'auto',
            merchantDomain: t.merchantDomain,
            account: account,
            toAccount: toAccount,
            accountType: accountTypeMap[account] || (account === 'cash' ? 'cash' : 'card'),
            toAccountType: toAccount ? (accountTypeMap[toAccount] || (toAccount === 'cash' ? 'cash' : 'card')) : null,
            date: t.date?.split('T')[0], // Use YYYY-MM-DD
            splitId: t.splitId,
            excludeFromStats: t.excludeFromStats || false
        };
    });
};

/**
 * Комментарии, которые пользователь чаще всего пишет для конкретной категории.
 *
 * Считаем по паре категория+тип: одноимённая категория может существовать и в
 * расходах, и в доходах ("Другое"), а привычные комментарии у них разные.
 * Варианты написания ("Wolt" / "wolt ") склеиваются в одну подсказку, а
 * показывается последнее использованное написание - оно отражает то, как
 * пользователь пишет этот комментарий сейчас.
 *
 * Сортировка: сначала частота, при равной частоте - что использовалось позже.
 */
export const getDescriptionSuggestions = (transactions, category, type = null, limit = 5) => {
    if (!category) return [];

    const byNormalized = new Map();

    (transactions || []).forEach(t => {
        if (t.category !== category) return;
        if (type && t.type !== type) return;

        const description = (t.description || '').trim();
        if (!description) return;

        const key = description.toLowerCase();
        const existing = byNormalized.get(key);
        // Транзакции приходят не отсортированными, поэтому последнее написание
        // выбираем по дате, а не по порядку в массиве.
        if (!existing) {
            byNormalized.set(key, { label: description, count: 1, lastDate: t.date || '' });
        } else {
            existing.count += 1;
            if ((t.date || '') >= existing.lastDate) {
                existing.label = description;
                existing.lastDate = t.date || '';
            }
        }
    });

    return [...byNormalized.values()]
        .sort((a, b) => b.count - a.count || (a.lastDate < b.lastDate ? 1 : a.lastDate > b.lastDate ? -1 : 0))
        .slice(0, limit)
        .map(s => s.label);
};

// Сколько категорий показывать в блоке "часто используемые" и за какое окно
// считать частоту. 8 - это два ряда чипов на телефоне: достаточно, чтобы
// закрыть повседневные траты, и достаточно мало, чтобы блок читался целиком.
const FREQUENT_CATEGORY_LIMIT = 8;
const FREQUENT_CATEGORY_WINDOW_DAYS = 90;

const daysAgo = (days, now) => new Date(now.getTime() - days * 86400000).toISOString().slice(0, 10);

/**
 * Делит категории на "часто используемые" и остальные.
 *
 * Порядок с сервера (поле order) - это порядок заведения, а не пользы: редкий
 * "Отпуск" стоит там выше ежедневных "Продуктов", а всё, что добавлено
 * недавно, падает в конец списка. Поэтому наверх поднимаем то, чем реально
 * пользуются, а хвост форма прячет под "Ещё N".
 *
 * Частота считается по паре категория+тип (одноимённая категория может быть и
 * в расходах, и в доходах) за последние windowDays дней - привычки меняются, и
 * прошлогодние траты не должны держать категорию в топе. Если за это окно
 * операций не нашлось вообще (долгий перерыв, свежий импорт старых данных),
 * считаем по всей истории, иначе блок выродился бы в произвольные первые
 * восемь категорий.
 *
 * Если использованных категорий меньше лимита, добираем неиспользованными в
 * серверном порядке: блок из двух чипов на новом аккаунте выглядел бы поломкой.
 *
 * pinned - категория, которая должна остаться на виду в любом случае (сейчас
 * выбранная). При редактировании старой операции с редкой категорией она иначе
 * оказалась бы спрятанной в свёрнутом хвосте.
 */
export const splitCategoriesByUsage = (categories, transactions, type, options = {}) => {
    const {
        limit = FREQUENT_CATEGORY_LIMIT,
        windowDays = FREQUENT_CATEGORY_WINDOW_DAYS,
        pinned = null,
        now = new Date(),
    } = options;

    const pool = (categories || []).filter(c => !type || c.type === type);
    if (pool.length === 0) return { frequent: [], rest: [] };

    const countUsage = (since) => {
        const counts = new Map();
        (transactions || []).forEach(t => {
            if (type && t.type !== type) return;
            if (!t.category) return;
            if (since && (t.date || '') < since) return;
            counts.set(t.category, (counts.get(t.category) || 0) + 1);
        });
        return counts;
    };

    let counts = options.counts ? new Map(Object.entries(options.counts)) : countUsage(daysAgo(windowDays, now));
    if (!options.counts && counts.size === 0) counts = countUsage(null);

    // Стабильная сортировка: при равной частоте (в том числе у неиспользованных
    // категорий с нулём) сохраняется серверный порядок.
    const byUsage = pool
        .map((cat, index) => ({ cat, index, count: counts.get(cat.name) || 0 }))
        .sort((a, b) => b.count - a.count || a.index - b.index)
        .map(entry => entry.cat);

    const frequent = byUsage.slice(0, limit);
    const rest = byUsage.slice(limit);

    const pinnedIndex = pinned ? rest.findIndex(c => c.name === pinned) : -1;
    if (pinnedIndex === -1) return { frequent, rest };

    // Выбранная категория попала в хвост - показываем её вместе с топом, а не
    // вместо одной из частых: терять привычный чип из-за разовой правки хуже,
    // чем показать на один чип больше.
    return {
        frequent: [...frequent, rest[pinnedIndex]],
        rest: rest.filter((_, i) => i !== pinnedIndex),
    };
};

// Ключ счётчика использования категории - «тип::имя» (одноимённые категории
// доходов и расходов не смешиваются). Тот же ключ строит сервер в
// computeCategoryUsage (server/analytics.js).
export const categoryUsageKey = (category) => `${category.type}::${category.name}`;
