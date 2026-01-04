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
            date: t.date?.split('T')[0] // Use YYYY-MM-DD
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
            groups[date] = { items: [], dailySum: 0 };
        }
        groups[date].items.push(t);
        if (t.type !== 'initial' && t.type !== 'transfer') {
            groups[date].dailySum += t.visualAmount;
        }
        return groups;
    }, {});

    const categoryTotals = filtered
        .filter(t => t.type === 'expense')
        .reduce((acc, t) => {
            const cat = t.category || 'Другое';
            acc[cat] = (acc[cat] || 0) + Math.abs(t.visualAmount);
            return acc;
        }, {});

    return { transactions: grouped, income, expense, categoryTotals };
};
