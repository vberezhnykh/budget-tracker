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

    const total = Object.values(byAccount).reduce((sum, bal) => sum + bal, 0);

    const byType = { card: 0, cash: 0 };
    if (accounts && accounts.length > 0) {
        accounts.forEach(acc => {
            const bal = byAccount[acc._id] || 0;
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

    return { byAccount, byType, total };
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

export const getMonthlyData = (transactions, selectedMonth, accountFilter = null, categoryFilter = null, typeFilter = null) => {
    const monthFiltered = transactions.filter(t => t.date.startsWith(selectedMonth));

    let filtered = [...monthFiltered];

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

export const getComparisonData = (transactions, selectedMonth) => {
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
        prevMonthName: new Date(prevMonthYear, prevMonth - 1, 1).toLocaleDateString('ru-RU', { month: 'long' }),
        // "2 июля" - the genitive form Russian needs after "на", which
        // month-only formatting ("июль") can't give.
        prevMonthDayLabel: new Date(prevMonthYear, prevMonth - 1, comparisonDay)
            .toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
    };
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
