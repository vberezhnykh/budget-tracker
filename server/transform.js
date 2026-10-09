// Приведение сырых документов операций к виду, в котором считаются все
// агрегаты сервера (транзакционный слой для stats.js, periodStats.js и
// analytics.js).
//
// Зачем он нужен. Все величины считаются не по сырым документам, а по
// преобразованным: знак суммы уже выведен из типа (visualAmount), движение
// по счетам разложено (accountFlows), тип счёта подставлен из справочника,
// дата приведена к 'YYYY-MM-DD'. Правила подсчёта в analytics.js и
// periodStats.js написаны в этих терминах, а не выводятся заново из сырых
// документов каждым агрегатом - так у них одно общее определение того, что
// такое «расход» или «перевод».
//
// Правила проверяются на контрольном наборе данных (server/transform.test.js).

const { toDateKey } = require('./stats');

function buildAccountTypeMap(accounts) {
    const map = {};
    (accounts || []).forEach(acc => {
        map[String(acc._id)] = acc.type;
    });
    return map;
}

// Тип счёта, когда справочник его не знает: 'cash' для литерала 'cash',
// иначе карта. Литералы остались в старых операциях, до появления
// коллекции счетов (см. миграцию в server/seed.js).
function accountTypeOf(accountId, accountTypeMap) {
    return accountTypeMap[accountId] || (accountId === 'cash' ? 'cash' : 'card');
}

function transformTransactions(docs, accounts = []) {
    const accountTypeMap = buildAccountTypeMap(accounts);

    return (docs || []).map(t => {
        const amount = parseFloat(t.amount);
        // Стартовый баланс и доход - плюс, всё остальное - минус.
        const signedAmount = (t.type === 'income' || t.type === 'initial') ? amount : -amount;
        const isTransfer = t.type === 'transfer';

        let visualAmount = signedAmount;
        const accountFlows = {};

        const account = t.account || 'card';
        const toAccount = t.toAccount || null;

        if (isTransfer) {
            // В списке истории перевод показывается абсолютной суммой: он не
            // расход и не доход, деньги просто переехали.
            visualAmount = amount;
            if (account) accountFlows[account] = (accountFlows[account] || 0) - amount;
            if (toAccount) accountFlows[toAccount] = (accountFlows[toAccount] || 0) + amount;
        } else {
            if (account) accountFlows[account] = (accountFlows[account] || 0) + signedAmount;
        }

        return {
            id: String(t._id),
            // Версия нужна форме редактирования для условного PUT. Старые
            // документы до появления OCC физически не имеют __v и считаются
            // версией 0.
            __v: Number.isInteger(t.__v) ? t.__v : 0,
            title: t.title || t.category,
            amount,
            visualAmount,
            accountFlows,
            type: t.type,
            // Переводы когда-то сохранялись категорией «Обмен», сейчас
            // приложение везде называет их «Перевод». Приведение на входе
            // избавляет от правки уже сохранённых данных.
            category: isTransfer && t.category === 'Обмен' ? 'Перевод' : t.category,
            description: t.description,
            ...(typeof t.companyName === 'string' ? { companyName: t.companyName } : {}),
            ...(t.companyId ? { companyId: String(t.companyId) } : {}),
            logoMode: t.logoMode || 'auto',
            merchantDomain: t.merchantDomain,
            account,
            toAccount,
            accountType: accountTypeOf(account, accountTypeMap),
            toAccountType: toAccount ? accountTypeOf(toAccount, accountTypeMap) : null,
            // Дата хранится как UTC-полночь и приводится к строке в UTC:
            // в зоне сервера операции по краям месяца уехали бы в соседний.
            date: toDateKey(t.date),
            splitId: t.splitId,
            excludeFromStats: t.excludeFromStats || false
        };
    });
}

// Фильтр по счёту приходит либо
// идентификатором, либо группой 'type:card' / 'type:cash'.
function matchesAccount(t, accountFilter) {
    if (accountFilter.startsWith('type:')) {
        const targetType = accountFilter.split(':')[1];
        if (t.type === 'transfer') {
            return t.accountType === targetType || t.toAccountType === targetType;
        }
        return t.accountType === targetType;
    }
    if (t.type === 'transfer') return t.account === accountFilter || t.toAccount === accountFilter;
    return t.account === accountFilter;
}

module.exports = { transformTransactions, matchesAccount, buildAccountTypeMap, accountTypeOf };
