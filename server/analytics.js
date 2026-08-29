// Серверные порты оставшихся агрегатов из src/utils/finance.js: сравнения с
// прошлым месяцем, ряд по месяцам, итоги за год и за всё время, поиск,
// подсказки описаний и частота категорий.
//
// Как и periodStats.js, считается поверх transform.js, а совпадение с
// клиентом проверяется равенством на одних данных (server/analytics.test.js).
//
// Два отличия от клиентских версий, оба намеренные:
//
// 1. «Сегодня» приходит параметром, а не берётся из new Date(). От него
//    зависят окно сравнения (незаконченный месяц сравнивается с прошлым,
//    обрезанным по сегодняшнее число) и окно частоты категорий. Сервер живёт
//    в UTC, телефон - в зоне Кипра, и несколько часов в сутки их «сегодня»
//    не совпадают: цифра «на 2 июля» меняла бы значение в зависимости от
//    того, где выполнился подсчёт. Дату присылает клиент - чей календарь
//    здесь и имеется в виду.
//
// 2. Повторяющиеся у клиента четырежды свёртки дохода и расхода здесь
//    вынесены в одну функцию. Четыре копии одного правила - четыре места,
//    где оно может разъехаться.

const { matchesAccount } = require('./transform');

// Доход: положительные суммы, кроме стартового баланса и переводов, и без
// помеченных excludeFromStats.
function sumIncome(transactions) {
    return transactions.reduce((acc, t) => (
        t.visualAmount > 0 && t.type !== 'initial' && t.type !== 'transfer' && !t.excludeFromStats
    ) ? acc + t.visualAmount : acc, 0);
}

// Расход отрицательным числом - ровно как у клиента. Стартовый баланс сюда
// попадает, если он отрицательный: поведение сохранено как есть.
function sumExpense(transactions) {
    return transactions.reduce((acc, t) => (
        t.visualAmount < 0 && t.type !== 'transfer' && !t.excludeFromStats
    ) ? acc + t.visualAmount : acc, 0);
}

function sumByCategory(transactions) {
    return transactions
        .filter(t => t.type === 'expense' && !t.excludeFromStats)
        .reduce((acc, t) => {
            const cat = t.category || 'Другое';
            acc[cat] = (acc[cat] || 0) + Math.abs(t.visualAmount);
            return acc;
        }, {});
}

function applyFilters(transactions, { account = null, category = null, type = null } = {}) {
    let filtered = transactions;
    if (account) filtered = filtered.filter(t => matchesAccount(t, account));
    if (category) filtered = filtered.filter(t => t.category === category);
    if (type) filtered = filtered.filter(t => t.type === type);
    return filtered;
}

// --- Сравнение с прошлым месяцем ------------------------------------------

// Правило, общее у всех сравнений «этот месяц против прошлого»: идущий
// месяц сравнивается с прошлым, обрезанным по сегодняшнее число (сравнивать
// неполный месяц с полным бессмысленно), а законченный - с прошлым целиком.
function comparisonWindow(selectedMonth, today) {
    const [year, month] = selectedMonth.split('-').map(Number);
    const [todayYear, todayMonth, todayDay] = String(today).split('-').map(Number);
    const isCurrentMonth = todayYear === year && todayMonth === month;

    const lastDayOfMonth = new Date(year, month, 0).getDate();
    const comparisonDay = isCurrentMonth ? todayDay : lastDayOfMonth;

    let prevMonthYear = year;
    let prevMonth = month - 1;
    if (prevMonth === 0) {
        prevMonth = 12;
        prevMonthYear -= 1;
    }

    return {
        isCurrentMonth,
        comparisonDay,
        prevMonthStr: `${prevMonthYear}-${String(prevMonth).padStart(2, '0')}`,
        prevMonthName: new Date(prevMonthYear, prevMonth - 1, 1).toLocaleDateString('ru-RU', { month: 'long' }),
        // «2 июля» - родительный падеж, который нужен после «на» и которого
        // форматирование одного месяца («июль») не даёт.
        prevMonthDayLabel: new Date(prevMonthYear, prevMonth - 1, comparisonDay)
            .toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
    };
}

function inPrevWindow(t, prevMonthStr, comparisonDay) {
    if (!t.date.startsWith(prevMonthStr)) return false;
    return parseInt(t.date.split('-')[2], 10) <= comparisonDay;
}

function computeComparison(transactions, selectedMonth, today) {
    const { comparisonDay, prevMonthStr, prevMonthName, prevMonthDayLabel } = comparisonWindow(selectedMonth, today);
    const prev = transactions.filter(t => inPrevWindow(t, prevMonthStr, comparisonDay));

    const income = sumIncome(prev);
    const expense = sumExpense(prev);

    return {
        saldo: income + expense,
        expense: Math.abs(expense),
        day: comparisonDay,
        prevMonthName,
        prevMonthDayLabel
    };
}

// Покатегорийная версия сравнения. Категории, которых в этом месяце уже нет,
// а в прошлом были, попадают в результат с нулём - иначе исчезнувшая статья
// расходов просто пропала бы из виду.
function computeCategoryComparison(transactions, selectedMonth, today, accountFilter = null) {
    const { comparisonDay, prevMonthStr } = comparisonWindow(selectedMonth, today);

    let currentTx = transactions.filter(t => t.date.startsWith(selectedMonth));
    let prevTx = transactions.filter(t => inPrevWindow(t, prevMonthStr, comparisonDay));

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
            // Процент от нуля не считается: рост с нуля не «бесконечность»,
            // а «появилось».
            percent: previous > 0 ? Math.round((diff / previous) * 100) : null
        };
    });

    return result;
}

// --- Ряд по месяцам -------------------------------------------------------

// Короткая подпись месяца («авг») без точки, которую добавляет
// toLocaleDateString к сокращённым названиям.
function shortMonthLabel(year, month) {
    return new Date(year, month - 1, 1).toLocaleDateString('ru-RU', { month: 'short' }).replace(/\.$/, '');
}

function shiftMonth(year, month, delta) {
    const total = (year * 12 + (month - 1)) + delta;
    return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

// Последние `months` месяцев по endMonth включительно. Месяцы старше самой
// ранней операции обрезаются - у нового аккаунта не должно быть стены пустых
// столбиков, - а пустые месяцы ВНУТРИ диапазона остаются: тихий месяц не
// должен молча исчезать из середины графика.
function computeMonthlySeries(transactions, endMonth, months = 6, accountFilter = null, categoryFilter = null) {
    const [endYear, endMon] = endMonth.split('-').map(Number);

    const candidateMonths = [];
    for (let i = months - 1; i >= 0; i -= 1) {
        const { year, month } = shiftMonth(endYear, endMon, -i);
        candidateMonths.push({ year, month, str: `${year}-${String(month).padStart(2, '0')}` });
    }

    const earliestDate = transactions.reduce((min, t) => (!min || t.date < min) ? t.date : min, null);
    const earliestMonth = earliestDate ? earliestDate.slice(0, 7) : null;
    const monthsToUse = earliestMonth
        ? candidateMonths.filter(m => m.str >= earliestMonth)
        : candidateMonths;

    return monthsToUse.map(({ year, month, str }) => {
        const filtered = applyFilters(
            transactions.filter(t => t.date.startsWith(str)),
            { account: accountFilter, category: categoryFilter }
        );

        return {
            month: str,
            label: shortMonthLabel(year, month),
            year,
            income: sumIncome(filtered),
            expense: Math.abs(sumExpense(filtered))
        };
    });
}

// --- Итоги за год и за всё время ------------------------------------------

function computeYearlyData(transactions, selectedMonth, accountFilter = null, categoryFilter = null) {
    const year = selectedMonth.split('-')[0];
    const filtered = applyFilters(
        transactions.filter(t => t.date.startsWith(year)),
        { account: accountFilter, category: categoryFilter }
    );

    return {
        income: sumIncome(filtered),
        expense: sumExpense(filtered),
        categoryTotals: sumByCategory(filtered)
    };
}

function computeLifetimeStats(transactions, startDate = '2025-11-09', accountFilter = null, categoryFilter = null) {
    const filtered = applyFilters(
        transactions.filter(t => t.date >= startDate),
        { account: accountFilter, category: categoryFilter }
    );

    const income = sumIncome(filtered);
    const expense = sumExpense(filtered);

    return { income, expense, total: income + expense, categoryTotals: sumByCategory(filtered) };
}

// --- Поиск ----------------------------------------------------------------

// Ищет по описанию, категории и названию, а заодно по сумме: «12» находит и
// операцию на 12 евро, и комментарий с числом 12. Группировка по дням здесь
// проще, чем в списке периода: разделённые операции не собираются в группу -
// в результатах поиска показывается конкретная найденная часть.
function computeSearchResults(transactions, query, accountFilter = null, categoryFilter = null, typeFilter = null) {
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

    filtered = applyFilters(filtered, { account: accountFilter, category: categoryFilter, type: typeFilter });

    const grouped = filtered.reduce((groups, t) => {
        const date = t.date;
        if (!groups[date]) {
            groups[date] = { items: [], dailySum: 0 };
        }
        groups[date].items.push(t);
        // excludeFromStats здесь не смотрится - так у клиента; итог дня в
        // результатах поиска считается по всем найденным.
        if (t.type !== 'initial' && t.type !== 'transfer') {
            groups[date].dailySum += t.visualAmount;
        }
        return groups;
    }, {});

    Object.keys(grouped).forEach(date => {
        grouped[date].items.sort((a, b) => b.id > a.id ? 1 : -1);
    });

    return { transactions: grouped, count: filtered.length };
}

// --- Подсказки и частоты --------------------------------------------------

// Комментарии, которые чаще всего пишут для этой категории. Считается по
// паре категория+тип: одноимённая категория может быть и в расходах, и в
// доходах («Другое»), а привычные комментарии у них разные. Варианты
// написания склеиваются, показывается последнее использованное - оно
// отражает, как пользователь пишет этот комментарий сейчас.
function computeDescriptionSuggestions(transactions, category, type = null, limit = 5) {
    if (!category) return [];

    const byNormalized = new Map();

    (transactions || []).forEach(t => {
        if (t.category !== category) return;
        if (type && t.type !== type) return;

        const description = (t.description || '').trim();
        if (!description) return;

        const key = description.toLowerCase();
        const existing = byNormalized.get(key);
        // Операции приходят неотсортированными, поэтому последнее написание
        // выбирается по дате, а не по порядку в массиве.
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
}

// Сколько операций ссылается на каждую категорию - ключ «тип::имя».
// Показывается в настройках рядом с кнопкой удаления.
function computeCategoryUsage(transactions) {
    const usage = {};
    (transactions || []).forEach(t => {
        if (!t.category) return;
        const key = `${t.type}::${t.category}`;
        usage[key] = (usage[key] || 0) + 1;
    });
    return usage;
}

const FREQUENT_CATEGORY_WINDOW_DAYS = 90;

function daysAgo(days, today) {
    const [year, month, day] = String(today).split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day - days)).toISOString().slice(0, 10);
}

// Частота категорий за окно, по которому форма поднимает наверх то, чем
// реально пользуются. Считающая половина splitCategoriesByUsage: сам делёж
// на «частые» и «остальные» остаётся на клиенте - он зависит от выбранной
// сейчас категории и от того, сколько чипов помещается на экран.
//
// Если за окно операций не нашлось вообще (долгий перерыв, свежий импорт
// старых данных), считается по всей истории - иначе блок выродился бы в
// произвольные первые восемь категорий.
function computeCategoryCounts(transactions, type, today, windowDays = FREQUENT_CATEGORY_WINDOW_DAYS) {
    const countUsage = (since) => {
        const counts = {};
        (transactions || []).forEach(t => {
            if (type && t.type !== type) return;
            if (!t.category) return;
            if (since && (t.date || '') < since) return;
            counts[t.category] = (counts[t.category] || 0) + 1;
        });
        return counts;
    };

    const windowed = countUsage(daysAgo(windowDays, today));
    return Object.keys(windowed).length > 0 ? windowed : countUsage(null);
}

module.exports = {
    comparisonWindow,
    computeComparison,
    computeCategoryComparison,
    computeMonthlySeries,
    computeYearlyData,
    computeLifetimeStats,
    computeSearchResults,
    computeDescriptionSuggestions,
    computeCategoryUsage,
    computeCategoryCounts,
    FREQUENT_CATEGORY_WINDOW_DAYS
};
