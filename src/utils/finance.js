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

export const getMonthlyData = (transactions, selectedMonth) => {
    const filtered = transactions.filter(t => t.date.startsWith(selectedMonth));

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
            // Put newer transactions first (using ID or date/time if available)
            // Since we sorted in API, we can rely on order if we had indices,
            // but for now let's just use string comparison for IDs or similar
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
