// Агрегаты, которые до сих пор считались на клиенте: остатки по счетам и
// итоги по месяцам.
//
// Зачем это на сервере. Фронтенд считает и то и другое из полной истории
// операций (calculateBalances и getMonthlyTotals в src/utils/finance.js), а
// значит, обязан скачивать её целиком при каждом открытии приложения. Пока
// операций пара тысяч, это терпимо; коллекция растёт линейно и навсегда.
// Здесь те же величины считаются рядом с базой, а телефон получает сводку
// в несколько килобайт вместо всей истории.
//
// Почему обычным перебором, а не aggregation pipeline. Правила подсчёта
// нетривиальны (перевод двигает два счёта; excludeFromStats влияет на
// статистику, но не на остатки; замороженные счета вычитаются из капитала
// целиком, а в подпись идут только положительными), и повторить их на
// сервере надо в точности - расхождение в деньгах между двумя экранами
// хуже, чем отсутствие фичи. Обычную функцию можно прогнать в тестах на тех
// же данных, что и клиентскую, и сравнить результаты до копейки
// (см. stats.test.js); pipeline без поднятой MongoDB не проверяется никак.
// Перевод на pipeline остаётся возможным - эти тесты станут для него
// эталоном, - но делать его вслепую, ради экономии на паре тысяч
// документов, значит менять проверяемое на непроверяемое.

// Дата операции хранится как UTC-полночь, а на клиенте живёт строкой
// 'YYYY-MM-DD' (см. transformTransactions). Приводим к той же строке
// независимо от того, пришёл документ из базы (Date) или из JSON (строка),
// и обязательно в UTC: в зоне сервера начало месяца уехало бы на несколько
// часов, и операции по краям попали бы в соседний месяц.
function toDateKey(raw) {
    if (raw instanceof Date) {
        return Number.isNaN(raw.getTime()) ? '' : raw.toISOString().slice(0, 10);
    }
    if (typeof raw === 'string') return raw.slice(0, 10);
    return '';
}

// Как операция двигает деньги по счетам. Повторяет accountFlows из
// transformTransactions: перевод снимает с одного счёта и кладёт на другой,
// всё остальное меняет один счёт, а знак задаётся типом.
//
// excludeFromStats здесь намеренно не смотрится: этот флаг убирает операцию
// из статистики, но деньги-то по счёту всё равно прошли.
function accountFlows(t) {
    const amount = parseFloat(t.amount);
    const account = t.account || 'card';
    const toAccount = t.toAccount || null;
    const flows = {};

    if (Number.isNaN(amount)) return flows;

    if (t.type === 'transfer') {
        if (account) flows[account] = (flows[account] || 0) - amount;
        if (toAccount) flows[toAccount] = (flows[toAccount] || 0) + amount;
    } else {
        const signed = (t.type === 'income' || t.type === 'initial') ? amount : -amount;
        if (account) flows[account] = (flows[account] || 0) + signed;
    }

    return flows;
}

function accountTypeOf(accountId, accountTypeMap) {
    return accountTypeMap[accountId] || (accountId === 'cash' ? 'cash' : 'card');
}

function buildAccountTypeMap(accounts) {
    const map = {};
    (accounts || []).forEach(acc => {
        map[String(acc._id)] = acc.type;
    });
    return map;
}

// Фильтр по счёту в том же виде, в каком его присылает интерфейс: либо id
// конкретного счёта, либо 'type:card' / 'type:cash' - группа счетов в
// карусели капитала.
function matchesAccount(t, accountFilter, accountTypeMap) {
    const account = t.account || 'card';

    if (accountFilter.startsWith('type:')) {
        const targetType = accountFilter.split(':')[1];
        if (t.type === 'transfer') {
            const toType = t.toAccount ? accountTypeOf(t.toAccount, accountTypeMap) : null;
            return accountTypeOf(account, accountTypeMap) === targetType || toType === targetType;
        }
        return accountTypeOf(account, accountTypeMap) === targetType;
    }

    if (t.type === 'transfer') return account === accountFilter || t.toAccount === accountFilter;
    return account === accountFilter;
}

// Остатки по счетам, по типам счетов и общий капитал.
//
// Счета с excludeFromTotal (залог у арендодателя, срочный вклад) держат
// деньги, которых на руках нет: капитал считается без них целиком, включая
// уход в минус, а в подпись под капиталом (held) попадают только
// положительные остатки - счёт-счётчик влитого живёт в минусе, и складывать
// его с залогом в одну цифру бессмысленно.
function computeBalances(transactions, accounts = []) {
    const byAccount = {};
    (transactions || []).forEach(t => {
        Object.entries(accountFlows(t)).forEach(([accId, flow]) => {
            byAccount[accId] = (byAccount[accId] || 0) + flow;
        });
    });

    const heldAccountIds = new Set(
        (accounts || []).filter(acc => acc.excludeFromTotal).map(acc => String(acc._id))
    );
    const heldBalances = Object.entries(byAccount)
        .filter(([accId]) => heldAccountIds.has(accId))
        .map(([, bal]) => bal);

    const grandTotal = Object.values(byAccount).reduce((sum, bal) => sum + bal, 0);
    const total = grandTotal - heldBalances.reduce((sum, bal) => sum + bal, 0);
    const held = heldBalances.reduce((sum, bal) => (bal > 0 ? sum + bal : sum), 0);

    const byType = { card: 0, cash: 0 };
    if (accounts && accounts.length > 0) {
        accounts.forEach(acc => {
            if (acc.excludeFromTotal) return;
            const bal = byAccount[String(acc._id)] || 0;
            if (acc.type === 'cash') byType.cash += bal;
            else byType.card += bal;
        });
    } else {
        byType.cash = byAccount['cash'] || 0;
        byType.card = byAccount['card'] || 0;
    }

    return { byAccount, byType, total, held, grandTotal };
}

// Доход и расход по каждому месяцу истории: { 'YYYY-MM': { income, expense } },
// расход отрицательным числом - ровно как у getMonthlyTotals на клиенте.
//
// Переводы и операции с excludeFromStats в статистику не идут. Стартовый
// баланс тоже не доход - он не заработан, а объявлен, - но в расход
// отрицательная «начальная» сумма попала бы, и это поведение сохранено
// как есть.
//
// Фильтра по типу операции здесь нет намеренно: доход и расход в карточках
// месяца от него не зависят, иначе, включив фильтр «доход», пользователь
// увидел бы нулевой расход.
function computeMonthlyTotals(transactions, accounts = [], options = {}) {
    const { account: accountFilter = null, category: categoryFilter = null } = options;
    const accountTypeMap = buildAccountTypeMap(accounts);
    const totals = {};

    (transactions || []).forEach(t => {
        if (t.type === 'transfer' || t.excludeFromStats) return;
        if (accountFilter && !matchesAccount(t, accountFilter, accountTypeMap)) return;
        if (categoryFilter && t.category !== categoryFilter) return;

        const month = toDateKey(t.date).slice(0, 7);
        if (!month) return;

        const amount = parseFloat(t.amount);
        if (Number.isNaN(amount)) return;
        const visualAmount = (t.type === 'income' || t.type === 'initial') ? amount : -amount;

        if (!totals[month]) totals[month] = { income: 0, expense: 0 };

        if (visualAmount > 0) {
            if (t.type !== 'initial') totals[month].income += visualAmount;
        } else {
            totals[month].expense += visualAmount;
        }
    });

    return totals;
}

module.exports = { computeBalances, computeMonthlyTotals, accountFlows, toDateKey };
