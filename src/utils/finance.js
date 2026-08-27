/**
 * Finance utility functions for transforming API data and calculating balances.
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

export const calculateBalances = (transactions, accounts = []) => {
    const byAccount = transactions.reduce((acc, curr) => {
        if (curr.accountFlows) {
            Object.entries(curr.accountFlows).forEach(([accId, flow]) => {
                acc[accId] = (acc[accId] || 0) + flow;
            });
        }
        return acc;
    }, {});

    // Счета с excludeFromTotal (залог у арендодателя, срочный вклад) держат
    // деньги, которых на руках нет. Общий капитал считаем без них - иначе он
    // обещает больше, чем можно потратить, - а сумму по ним отдаём отдельно
    // (held), чтобы она не исчезла из виду совсем.
    const heldAccountIds = new Set(
        (accounts || []).filter(acc => acc.excludeFromTotal).map(acc => acc._id)
    );
    const heldBalances = Object.entries(byAccount)
        .filter(([accId]) => heldAccountIds.has(accId))
        .map(([, bal]) => bal);
    const grandTotal = Object.values(byAccount).reduce((sum, bal) => sum + bal, 0);
    const total = grandTotal - heldBalances.reduce((sum, bal) => sum + bal, 0);
    // В подпись под капиталом идут только положительные остатки. Счёт вроде
    // «Обмена» (деньги, влитые из непрослеживаемого кармана - рублей) живёт в
    // минусе: это счётчик влитого, а не замороженные деньги. Сложить его с
    // залогом в одну цифру значило бы выдать бессмыслицу.
    const held = heldBalances.reduce((sum, bal) => bal > 0 ? sum + bal : sum, 0);

    const byType = { card: 0, cash: 0 };
    if (accounts && accounts.length > 0) {
        accounts.forEach(acc => {
            const bal = byAccount[acc._id] || 0;
            if (acc.excludeFromTotal) return;
            if (acc.type === 'cash') {
                byType.cash += bal;
            } else {
                byType.card += bal;
            }
        });
    } else {
        // Fallback for tests if accounts list is not supplied
        byType.cash = byAccount['cash'] || 0;
        byType.card = byAccount['card'] || 0;
    }

    return { byAccount, byType, total, held, grandTotal };
};

const matchesAccount = (t, accountFilter) => {
    if (accountFilter.startsWith('type:')) {
        const targetType = accountFilter.split(':')[1];
        if (t.type === 'transfer') {
            return t.accountType === targetType || t.toAccountType === targetType;
        }
        return t.accountType === targetType;
    }
    if (t.type === 'transfer') return t.account === accountFilter || t.toAccount === accountFilter;
    return t.account === accountFilter;
};

// Which slice of history a period covers, expressed as the prefix its
// dates share: 'YYYY-MM' for a month, 'YYYY' for a year, and '' for
// "всё время" - an empty prefix means "no date filter at all".
export const getPeriodPrefix = (timeRange, selectedMonth) => {
    if (timeRange === 'lifetime') return '';
    if (timeRange === 'year') return selectedMonth.split('-')[0];
    return selectedMonth;
};

// The grouped transaction list plus its totals for an arbitrary period,
// not just one month: the drawer's history shows whatever range the period
// picker is on.
export const getPeriodData = (transactions, periodPrefix, accountFilter = null, categoryFilter = null, typeFilter = null) => {
    let filtered = periodPrefix
        ? transactions.filter(t => t.date.startsWith(periodPrefix))
        : [...transactions];

    if (accountFilter) {
        filtered = filtered.filter(t => matchesAccount(t, accountFilter));
    }

    if (categoryFilter) {
        filtered = filtered.filter(t => t.category === categoryFilter);
    }

    // Calculations for the cards should use the account/category filtered data, 
    // but stay independent of the type filter to keep the cards visible.
    const income = filtered.reduce((acc, t) => (t.visualAmount > 0 && t.type !== 'initial' && t.type !== 'transfer' && !t.excludeFromStats) ? acc + t.visualAmount : acc, 0);
    const expense = filtered.reduce((acc, t) => (t.visualAmount < 0 && t.type !== 'transfer' && !t.excludeFromStats) ? acc + t.visualAmount : acc, 0);

    const categoryTotals = filtered
        .filter(t => t.type === 'expense' && !t.excludeFromStats)
        .reduce((acc, t) => {
            const cat = t.category || 'Другое';
            acc[cat] = (acc[cat] || 0) + Math.abs(t.visualAmount);
            return acc;
        }, {});

    // Apply type filter ONLY for the list display
    if (typeFilter) {
        filtered = filtered.filter(t => t.type === typeFilter);
    }

    const grouped = filtered.reduce((groups, t) => {
        const date = t.date;
        if (!groups[date]) {
            groups[date] = { itemsById: {}, dailySum: 0 };
        }

        if (t.splitId) {
            if (!groups[date].itemsById[t.splitId]) {
                groups[date].itemsById[t.splitId] = {
                    id: t.splitId,
                    type: 'split_group',
                    date: t.date,
                    description: t.description.split(' (')[0], // Base description
                    account: t.account,
                    visualAmount: 0,
                    items: []
                };
            }
            groups[date].itemsById[t.splitId].items.push(t);
            groups[date].itemsById[t.splitId].visualAmount += t.visualAmount;
        } else {
            groups[date].itemsById[t.id] = t;
        }

        if (t.type !== 'initial' && t.type !== 'transfer' && !t.excludeFromStats) {
            groups[date].dailySum += t.visualAmount;
        }
        return groups;
    }, {});

    // Convert itemsById to items array for each date and sort them
    Object.keys(grouped).forEach(date => {
        grouped[date].items = Object.values(grouped[date].itemsById).sort((a, b) => {
            return b.id > a.id ? 1 : -1;
        });
        delete grouped[date].itemsById;
    });

    return { transactions: grouped, income, expense, categoryTotals };
};

// The month-shaped view of the same aggregation - what the monthly limit
// and pace forecast are computed from, whatever period is on screen.
export const getMonthlyData = (transactions, selectedMonth, accountFilter = null, categoryFilter = null, typeFilter = null) =>
    getPeriodData(transactions, selectedMonth, accountFilter, categoryFilter, typeFilter);

// The rule shared by every "this month vs last month" comparison: a month
// still in progress is compared against the previous month cut off at
// today's day-of-month (comparing like with like), while a finished month
// is compared against the previous month in full.
export const getComparisonWindow = (selectedMonth) => {
    const [year, month] = selectedMonth.split('-').map(Number);
    const now = new Date();
    const isCurrentMonth = now.getFullYear() === year && (now.getMonth() + 1) === month;

    // Determine the comparison day
    let comparisonDay;
    if (isCurrentMonth) {
        comparisonDay = now.getDate();
    } else {
        // For past months, we compare the full month or up to the last day of that month
        // But "this day month ago" usually implies relative progress.
        // Let's use the last day of the selected month if it's in the past.
        const lastDayOfMonth = new Date(year, month, 0).getDate();
        comparisonDay = lastDayOfMonth;
    }

    // Previous month string YYYY-MM
    let prevMonthYear = year;
    let prevMonth = month - 1;
    if (prevMonth === 0) {
        prevMonth = 12;
        prevMonthYear -= 1;
    }
    const prevMonthStr = `${prevMonthYear}-${String(prevMonth).padStart(2, '0')}`;

    return {
        isCurrentMonth,
        comparisonDay,
        prevMonthStr,
        prevMonthName: new Date(prevMonthYear, prevMonth - 1, 1).toLocaleDateString('ru-RU', { month: 'long' }),
        // "2 июля" - the genitive form Russian needs after "на", which
        // month-only formatting ("июль") can't give.
        prevMonthDayLabel: new Date(prevMonthYear, prevMonth - 1, comparisonDay)
            .toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
    };
};

export const getComparisonData = (transactions, selectedMonth) => {
    const { comparisonDay, prevMonthStr, prevMonthName, prevMonthDayLabel } = getComparisonWindow(selectedMonth);

    // Filter transactions for previous month up to comparisonDay
    const prevMonthTransactions = transactions.filter(t => {
        if (!t.date.startsWith(prevMonthStr)) return false;
        const day = parseInt(t.date.split('-')[2]);
        return day <= comparisonDay;
    });

    const income = prevMonthTransactions.reduce((acc, t) =>
        (t.visualAmount > 0 && t.type !== 'initial' && t.type !== 'transfer' && !t.excludeFromStats) ? acc + t.visualAmount : acc, 0
    );
    const expense = prevMonthTransactions.reduce((acc, t) =>
        (t.visualAmount < 0 && t.type !== 'transfer' && !t.excludeFromStats) ? acc + t.visualAmount : acc, 0
    );

    return {
        saldo: income + expense,
        expense: Math.abs(expense),
        day: comparisonDay,
        prevMonthName,
        prevMonthDayLabel
    };
};

// Per-category version of getComparisonData: how much each expense category
// cost this month vs. the same (day-cutoff-aware) stretch of the previous
// one. Categories that only existed last month are included too, at value 0,
// so a category that was dropped entirely still shows as "gone".
export const getCategoryComparison = (transactions, selectedMonth, accountFilter = null) => {
    const { comparisonDay, prevMonthStr } = getComparisonWindow(selectedMonth);

    let currentTx = transactions.filter(t => t.date.startsWith(selectedMonth));
    let prevTx = transactions.filter(t => {
        if (!t.date.startsWith(prevMonthStr)) return false;
        const day = parseInt(t.date.split('-')[2]);
        return day <= comparisonDay;
    });

    if (accountFilter) {
        currentTx = currentTx.filter(t => matchesAccount(t, accountFilter));
        prevTx = prevTx.filter(t => matchesAccount(t, accountFilter));
    }

    const isExpense = t => t.type === 'expense' && !t.excludeFromStats;

    const result = {};
    currentTx.filter(isExpense).forEach(t => {
        const cat = t.category || 'Другое';
        if (!result[cat]) result[cat] = { value: 0, previous: 0 };
        result[cat].value += Math.abs(t.visualAmount);
    });
    prevTx.filter(isExpense).forEach(t => {
        const cat = t.category || 'Другое';
        if (!result[cat]) result[cat] = { value: 0, previous: 0 };
        result[cat].previous += Math.abs(t.visualAmount);
    });

    Object.keys(result).forEach(cat => {
        const { value, previous } = result[cat];
        const diff = value - previous;
        result[cat] = {
            value,
            previous,
            diff,
            percent: previous > 0 ? Math.round((diff / previous) * 100) : null
        };
    });

    return result;
};

// Short Russian month label ("авг") without the trailing dot that
// toLocaleDateString appends to abbreviated month names.
const shortMonthLabel = (year, month) =>
    new Date(year, month - 1, 1).toLocaleDateString('ru-RU', { month: 'short' }).replace(/\.$/, '');

const shiftMonth = (year, month, delta) => {
    const total = (year * 12 + (month - 1)) + delta;
    return { year: Math.floor(total / 12), month: (total % 12) + 1 };
};

// Trailing `months` months up to and including endMonth, e.g. for a bar
// chart of recent activity. Leading months older than the earliest
// transaction on record are trimmed - a brand-new account shouldn't show a
// wall of empty bars - but zero-activity months *within* the data's range
// are kept, so a quiet month doesn't just disappear from the middle of the
// chart.
export const getMonthlySeries = (transactions, endMonth, months = 6, accountFilter = null, categoryFilter = null) => {
    const [endYear, endMon] = endMonth.split('-').map(Number);

    const candidateMonths = [];
    for (let i = months - 1; i >= 0; i--) {
        const { year, month } = shiftMonth(endYear, endMon, -i);
        candidateMonths.push({ year, month, str: `${year}-${String(month).padStart(2, '0')}` });
    }

    const earliestDate = transactions.reduce((min, t) => (!min || t.date < min) ? t.date : min, null);
    const earliestMonth = earliestDate ? earliestDate.slice(0, 7) : null;
    const monthsToUse = earliestMonth
        ? candidateMonths.filter(m => m.str >= earliestMonth)
        : candidateMonths;

    return monthsToUse.map(({ year, month, str }) => {
        let filtered = transactions.filter(t => t.date.startsWith(str));
        if (accountFilter) filtered = filtered.filter(t => matchesAccount(t, accountFilter));
        if (categoryFilter) filtered = filtered.filter(t => t.category === categoryFilter);

        const income = filtered.reduce((acc, t) => (t.visualAmount > 0 && t.type !== 'initial' && t.type !== 'transfer' && !t.excludeFromStats) ? acc + t.visualAmount : acc, 0);
        const expense = filtered.reduce((acc, t) => (t.visualAmount < 0 && t.type !== 'transfer' && !t.excludeFromStats) ? acc + t.visualAmount : acc, 0);

        return {
            month: str,
            label: shortMonthLabel(year, month),
            year,
            income,
            expense: Math.abs(expense)
        };
    });
};

// How fast the current month's spending is running, so the analytics tab can
// show "at this rate you'll spend €X by month end" instead of just a raw
// total. Only meaningful for the month actually in progress.
export const getPaceForecast = (expenseAbs, selectedMonth, monthlyLimit = null) => {
    const [year, month] = selectedMonth.split('-').map(Number);
    const now = new Date();
    if (now.getFullYear() !== year || (now.getMonth() + 1) !== month) return null;

    const daysInMonth = new Date(year, month, 0).getDate();
    const daysElapsed = now.getDate();
    const daysLeft = daysInMonth - daysElapsed;

    const perDay = expenseAbs / daysElapsed;
    const forecast = perDay * daysInMonth;

    const limitUsable = Number.isFinite(monthlyLimit) && monthlyLimit > 0;
    let remaining = null;
    let perDayLeft = null;
    let willExceedLimit = null;
    if (limitUsable) {
        remaining = monthlyLimit - expenseAbs;
        perDayLeft = daysLeft > 0 ? remaining / daysLeft : null;
        willExceedLimit = forecast > monthlyLimit;
    }

    return { daysInMonth, daysElapsed, daysLeft, perDay, forecast, remaining, perDayLeft, willExceedLimit };
};

export const getYearlyData = (transactions, selectedMonth, accountFilter = null, categoryFilter = null) => {
    const year = selectedMonth.split('-')[0];
    let filtered = transactions.filter(t => t.date.startsWith(year));

    if (accountFilter) {
        filtered = filtered.filter(t => matchesAccount(t, accountFilter));
    }

    if (categoryFilter) {
        filtered = filtered.filter(t => t.category === categoryFilter);
    }

    const income = filtered.reduce((acc, t) => (t.visualAmount > 0 && t.type !== 'initial' && t.type !== 'transfer' && !t.excludeFromStats) ? acc + t.visualAmount : acc, 0);
    const expense = filtered.reduce((acc, t) => (t.visualAmount < 0 && t.type !== 'transfer' && !t.excludeFromStats) ? acc + t.visualAmount : acc, 0);

    const categoryTotals = filtered
        .filter(t => t.type === 'expense' && !t.excludeFromStats)
        .reduce((acc, t) => {
            const cat = t.category || 'Другое';
            acc[cat] = (acc[cat] || 0) + Math.abs(t.visualAmount);
            return acc;
        }, {});

    return { income, expense, categoryTotals };
};

export const getLifetimeStats = (transactions, startDate = '2025-11-09', accountFilter = null, categoryFilter = null) => {
    let filtered = transactions.filter(t => t.date >= startDate);

    if (accountFilter) {
        filtered = filtered.filter(t => matchesAccount(t, accountFilter));
    }

    if (categoryFilter) {
        filtered = filtered.filter(t => t.category === categoryFilter);
    }

    const income = filtered.reduce((acc, t) =>
        (t.visualAmount > 0 && t.type !== 'initial' && t.type !== 'transfer' && !t.excludeFromStats) ? acc + t.visualAmount : acc, 0
    );
    const expense = filtered.reduce((acc, t) =>
        (t.visualAmount < 0 && t.type !== 'transfer' && !t.excludeFromStats) ? acc + t.visualAmount : acc, 0
    );

    // Same shape as the monthly/yearly totals, so the stats panel can show
    // its category breakdown for this range too.
    const categoryTotals = filtered
        .filter(t => t.type === 'expense' && !t.excludeFromStats)
        .reduce((acc, t) => {
            const cat = t.category || 'Другое';
            acc[cat] = (acc[cat] || 0) + Math.abs(t.visualAmount);
            return acc;
        }, {});

    return { income, expense, total: income + expense, categoryTotals };
};

export const getSearchResults = (transactions, query, accountFilter = null, categoryFilter = null, typeFilter = null) => {
    if (!query) return { transactions: {}, count: 0 };

    const searchLower = query.toLowerCase();
    let filtered = transactions.filter(t => {
        const textMatch = (t.description || '').toLowerCase().includes(searchLower) ||
            (t.category || '').toLowerCase().includes(searchLower) ||
            (t.title || '').toLowerCase().includes(searchLower);
        const amountMatch = t.amount.toString().includes(query) ||
            Math.abs(t.visualAmount).toString().includes(query);
        return textMatch || amountMatch;
    });

    if (accountFilter) {
        filtered = filtered.filter(t => matchesAccount(t, accountFilter));
    }

    if (categoryFilter) {
        filtered = filtered.filter(t => t.category === categoryFilter);
    }

    if (typeFilter) {
        filtered = filtered.filter(t => t.type === typeFilter);
    }

    const grouped = filtered.reduce((groups, t) => {
        const date = t.date;
        if (!groups[date]) {
            groups[date] = { items: [], dailySum: 0 };
        }
        groups[date].items.push(t);
        if (t.type !== 'initial' && t.type !== 'transfer') {
            groups[date].dailySum += t.visualAmount;
        }
        return groups;
    }, {});

    // Sort items within each date
    Object.keys(grouped).forEach(date => {
        grouped[date].items.sort((a, b) => b.id > a.id ? 1 : -1);
    });

    return { transactions: grouped, count: filtered.length };
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
export const FREQUENT_CATEGORY_LIMIT = 8;
export const FREQUENT_CATEGORY_WINDOW_DAYS = 90;

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

    let counts = countUsage(daysAgo(windowDays, now));
    if (counts.size === 0) counts = countUsage(null);

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

/**
 * Сколько операций ссылается на каждую категорию - ключ "тип::имя".
 *
 * Категория хранится в операции строкой (см. server/models/Transaction.js),
 * поэтому удаление категории историю не ломает: строки остаются, статистика
 * продолжает группировать по имени. Но удалять вслепую всё равно не стоит,
 * поэтому настройки показывают счётчик рядом с каждой категорией.
 */
export const getCategoryUsage = (transactions) => {
    const usage = {};
    (transactions || []).forEach(t => {
        if (!t.category) return;
        const key = `${t.type}::${t.category}`;
        usage[key] = (usage[key] || 0) + 1;
    });
    return usage;
};

export const categoryUsageKey = (category) => `${category.type}::${category.name}`;
