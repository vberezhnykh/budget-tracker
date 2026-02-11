/**
 * Finance utility functions for transforming API data and calculating balances.
 */

export const transformTransactions = (data) => {
    return data.map(t => {
        const amount = parseFloat(t.amount);
        // Initial balance and Income are POSITIVE, Expense is NEGATIVE
        const signedAmount = (t.type === 'income' || t.type === 'initial') ? amount : -amount;
        const isTransfer = t.type === 'transfer';

        let cashFlow = 0;
        let cardFlow = 0;
        let visualAmount = signedAmount;

        if (isTransfer) {
            visualAmount = amount; // Show absolute amount in history list
            if (t.account === 'cash') cashFlow = -amount;
            if (t.account === 'card') cardFlow = -amount;
            if (t.toAccount === 'cash') cashFlow = amount;
            if (t.toAccount === 'card') cardFlow = amount;
        } else {
            cashFlow = t.account === 'cash' ? signedAmount : 0;
            cardFlow = t.account === 'card' ? signedAmount : 0;
        }

        return {
            id: t._id,
            title: t.title || t.category,
            amount: amount,
            visualAmount: visualAmount,
            cashFlow: cashFlow,
            cardFlow: cardFlow,
            type: t.type,
            category: t.category,
            description: t.description,
            account: t.account,
            toAccount: t.toAccount,
            date: t.date?.split('T')[0], // Use YYYY-MM-DD
            splitId: t.splitId
        };
    });
};

export const calculateBalances = (transactions) => {
    const b = transactions.reduce((acc, curr) => {
        return {
            cash: acc.cash + curr.cashFlow,
            card: acc.card + curr.cardFlow
        };
    }, { cash: 0, card: 0 });
    return { ...b, total: b.cash + b.card };
};

export const getMonthlyData = (transactions, selectedMonth, accountFilter = null, categoryFilter = null) => {
    let filtered = transactions.filter(t => t.date.startsWith(selectedMonth));

    if (accountFilter) {
        filtered = filtered.filter(t => t.account === accountFilter || t.toAccount === accountFilter);
    }

    if (categoryFilter) {
        filtered = filtered.filter(t => t.category === categoryFilter);
    }

    const income = filtered.reduce((acc, t) => (t.visualAmount > 0 && t.type !== 'initial' && t.type !== 'transfer') ? acc + t.visualAmount : acc, 0);
    const expense = filtered.reduce((acc, t) => (t.visualAmount < 0 && t.type !== 'transfer') ? acc + t.visualAmount : acc, 0);

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

        if (t.type !== 'initial' && t.type !== 'transfer') {
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

    const categoryTotals = filtered
        .filter(t => t.type === 'expense')
        .reduce((acc, t) => {
            const cat = t.category || 'Другое';
            acc[cat] = (acc[cat] || 0) + Math.abs(t.visualAmount);
            return acc;
        }, {});

    return { transactions: grouped, income, expense, categoryTotals };
};

export const getYearlyData = (transactions, selectedMonth, accountFilter = null, categoryFilter = null) => {
    const year = selectedMonth.split('-')[0];
    let filtered = transactions.filter(t => t.date.startsWith(year));

    if (accountFilter) {
        filtered = filtered.filter(t => t.account === accountFilter || t.toAccount === accountFilter);
    }

    if (categoryFilter) {
        filtered = filtered.filter(t => t.category === categoryFilter);
    }

    const income = filtered.reduce((acc, t) => (t.visualAmount > 0 && t.type !== 'initial' && t.type !== 'transfer') ? acc + t.visualAmount : acc, 0);
    const expense = filtered.reduce((acc, t) => (t.visualAmount < 0 && t.type !== 'transfer') ? acc + t.visualAmount : acc, 0);

    const categoryTotals = filtered
        .filter(t => t.type === 'expense')
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
        filtered = filtered.filter(t => t.account === accountFilter || t.toAccount === accountFilter);
    }

    if (categoryFilter) {
        filtered = filtered.filter(t => t.category === categoryFilter);
    }

    const income = filtered.reduce((acc, t) =>
        (t.visualAmount > 0 && t.type !== 'initial' && t.type !== 'transfer') ? acc + t.visualAmount : acc, 0
    );
    const expense = filtered.reduce((acc, t) =>
        (t.visualAmount < 0 && t.type !== 'transfer') ? acc + t.visualAmount : acc, 0
    );

    return { income, expense, total: income + expense };
};

export const getSearchResults = (transactions, query, accountFilter = null, categoryFilter = null) => {
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
        filtered = filtered.filter(t => t.account === accountFilter || t.toAccount === accountFilter);
    }

    if (categoryFilter) {
        filtered = filtered.filter(t => t.category === categoryFilter);
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
