// Серверный порт getPeriodData из src/utils/finance.js: сгруппированный по
// дням список операций за период плюс итоги этого периода.
//
// Считается поверх transform.js, а не по сырым документам, - см. причину
// там же. Правила перенесены построчно, а совпадение с клиентской версией
// проверяется на одних данных (server/periodStats.test.js).

const { transformTransactions, matchesAccount } = require('./transform');

// Какую часть истории покрывает период - через префикс, общий у её дат:
// 'YYYY-MM' для месяца, 'YYYY' для года, '' для «всего времени» (пустой
// префикс означает отсутствие фильтра по дате).
function periodPrefixOf(timeRange, selectedMonth) {
    if (timeRange === 'lifetime') return '';
    if (timeRange === 'year') return String(selectedMonth || '').split('-')[0];
    return selectedMonth || '';
}

function computePeriodData(transactions, periodPrefix, options = {}) {
    const {
        account: accountFilter = null,
        category: categoryFilter = null,
        type: typeFilter = null
    } = options;

    let filtered = periodPrefix
        ? transactions.filter(t => t.date.startsWith(periodPrefix))
        : [...transactions];

    if (accountFilter) {
        filtered = filtered.filter(t => matchesAccount(t, accountFilter));
    }

    if (categoryFilter) {
        filtered = filtered.filter(t => t.category === categoryFilter);
    }

    // Цифры карточек считаются по данным, отфильтрованным счётом и
    // категорией, но ДО фильтра по типу: иначе, включив фильтр «доход»,
    // пользователь увидел бы нулевой расход.
    const income = filtered.reduce((acc, t) => (t.visualAmount > 0 && t.type !== 'initial' && t.type !== 'transfer' && !t.excludeFromStats) ? acc + t.visualAmount : acc, 0);
    const expense = filtered.reduce((acc, t) => (t.visualAmount < 0 && t.type !== 'transfer' && !t.excludeFromStats) ? acc + t.visualAmount : acc, 0);

    const categoryTotals = filtered
        .filter(t => t.type === 'expense' && !t.excludeFromStats)
        .reduce((acc, t) => {
            const cat = t.category || 'Другое';
            acc[cat] = (acc[cat] || 0) + Math.abs(t.visualAmount);
            return acc;
        }, {});

    // Фильтр по типу применяется только к списку.
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
                    // Общее описание группы - то, что стоит до скобки с
                    // уточнением части. Клиентская версия здесь падает на
                    // операции без описания (t.description.split): у
                    // разделённой операции описание обычно есть, но модель
                    // его не требует. На сервере это не повод отдать 500.
                    description: (t.description || '').split(' (')[0],
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

        // Итог дня - то же, что идёт в статистику: без переводов, стартового
        // баланса и помеченных excludeFromStats.
        if (t.type !== 'initial' && t.type !== 'transfer' && !t.excludeFromStats) {
            groups[date].dailySum += t.visualAmount;
        }
        return groups;
    }, {});

    Object.keys(grouped).forEach(date => {
        grouped[date].items = Object.values(grouped[date].itemsById).sort((a, b) => {
            return b.id > a.id ? 1 : -1;
        });
        delete grouped[date].itemsById;
    });

    return { transactions: grouped, income, expense, categoryTotals };
}

// Обёртка для роута: принимает сырые документы и справочник счетов.
function computePeriod(docs, accounts, { timeRange, month, account, category, type } = {}) {
    const transformed = transformTransactions(docs, accounts);
    return computePeriodData(transformed, periodPrefixOf(timeRange, month), { account, category, type });
}

module.exports = { computePeriodData, computePeriod, periodPrefixOf };
