// Инструменты для «Вопросов к данным»: Claude сам ничего не считает, а
// вызывает эти функции, и цифры в ответе берутся из их результата.
//
// Все они - тонкие обёртки над теми же функциями, по которым считаются
// экраны: transformTransactions (какой операция выглядит для аналитики),
// applyFilters и sumExpense/sumIncome (что входит в расход и доход: переводы и
// excludeFromStats не входят), computeBalances и computeTypicalMonth. Своего
// правила подсчёта здесь нет - иначе ответ в чате разошёлся бы с экраном, а
// это хуже, чем отсутствие чата. Сверка с этими функциями - в askTools.test.js.
//
// Каждый инструмент получает уже проверенные данные и никогда не бросает
// исключение наружу: неверный ввод возвращается как is_error с короткой
// причиной, по которой модель может повторить вызов.

const { transformTransactions } = require('./transform');
const { applyFilters, sumExpense, sumIncome } = require('./analytics');
const { computeBalances } = require('./stats');
const { computeTypicalMonth } = require('./typicalMonth');
const { parseDay, DAY_MS } = require('./claudeClient');

const MAX_RANGE_DAYS = 3660;
const MAX_GROUPS = 40;
const DEFAULT_FIND_LIMIT = 15;
const MAX_FIND_LIMIT = 30;
const MAX_TEXT_LENGTH = 100;
const MAX_COMPANIES = 10;
const MAX_FIELD_LENGTH = 200;

const GROUP_BY = ['none', 'month', 'category', 'company', 'account'];
const SUM_TYPES = ['expense', 'income'];
const FIND_TYPES = ['expense', 'income', 'transfer'];
const SORTS = ['date_desc', 'amount_desc'];
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

// Операции, названия и описания приходят от человека; в результат инструмента
// они уходят обрезанными, чтобы одна длинная заметка не раздувала запрос.
const clip = (value, limit = MAX_FIELD_LENGTH) => {
    const text = typeof value === 'string' ? value.trim() : '';
    return text.length > limit ? `${text.slice(0, limit)}…` : text;
};

// --- Данные запроса -----------------------------------------------------------

// Один снимок на вопрос: операции преобразованы один раз, и все вызовы
// инструментов внутри вопроса видят одно и то же состояние.
function prepareData({ docs, accounts, categories, today }) {
    const transactions = transformTransactions(docs, accounts);
    const accountList = (accounts || []).map(account => ({
        id: String(account._id),
        name: account.name,
        type: account.type === 'cash' ? 'cash' : 'card',
        excludeFromTotal: Boolean(account.excludeFromTotal)
    }));
    const categoryList = (categories || []).map(({ name, type }) => ({ name, type }));
    const earliest = transactions.reduce((min, t) => (t.date && (!min || t.date < min) ? t.date : min), null);
    return { transactions, accounts: accountList, rawAccounts: accounts || [], categories: categoryList, today, earliest };
}

const LEGACY_ACCOUNT_NAMES = { card: 'Карта', cash: 'Наличные' };

function accountName(data, id) {
    const account = data.accounts.find(item => item.id === id);
    return account ? account.name : (LEGACY_ACCOUNT_NAMES[id] || 'Неизвестный счёт');
}

// Название, под которым строку показывает приложение (TransactionList): у
// операции с полем companyName это компания, у старой, до появления
// компаний, - описание или название.
const hasCompanyField = (t) => typeof t.companyName === 'string';
const companyOf = (t) => (hasCompanyField(t) ? t.companyName : (t.description || t.title || ''));
const descriptionOf = (t) => (hasCompanyField(t) ? (t.description || '') : '');

// Сравнение названий без регистра, лишних пробелов и NFKC-вариантов написания.
const nameKey = (value) => (typeof value === 'string'
    ? value.normalize('NFKC').trim().toLowerCase().replace(/\s+/gu, ' ')
    : '');

// --- Проверка ввода -----------------------------------------------------------

const fail = (error) => ({ ok: false, error });

function readRange(input) {
    const from = parseDay(input.from);
    const to = parseDay(input.to);
    if (from === null) return { error: "Invalid 'from': expected a real date as YYYY-MM-DD." };
    if (to === null) return { error: "Invalid 'to': expected a real date as YYYY-MM-DD." };
    if (from > to) return { error: "'from' must not be later than 'to'." };
    if ((to - from) / DAY_MS > MAX_RANGE_DAYS) return { error: 'The range is longer than 10 years. Ask for a shorter period.' };
    return { from: input.from, to: input.to };
}

// Необязательные параметры приходят как null; отсутствие ключа сходно с null.
const isAbsent = (value) => value === undefined || value === null;

function readChoice(value, allowed, field, { optional = false } = {}) {
    if (isAbsent(value) && optional) return { value: null };
    if (!allowed.includes(value)) return { error: `Invalid '${field}': use one of ${allowed.join(', ')}.` };
    return { value };
}

function readCategory(value, data, type) {
    if (isAbsent(value)) return { value: null };
    if (typeof value !== 'string' || !data.categories.some(category => category.name === value && (!type || type === 'transfer' || category.type === type))) {
        return { error: `Unknown category '${clip(String(value), 60)}'${type && type !== 'transfer' ? ` for type ${type}` : ''}. Use one of the categories listed in the system prompt, spelled exactly.` };
    }
    return { value };
}

function readAccount(value, data) {
    if (isAbsent(value)) return { value: null, id: null };
    const account = typeof value === 'string' ? data.accounts.find(item => item.name === value) : null;
    if (!account) return { error: `Unknown account '${clip(String(value), 60)}'. Use one of the accounts listed in the system prompt, spelled exactly.` };
    return { value: account.name, id: account.id };
}

function readText(value, field) {
    if (isAbsent(value)) return { value: null };
    if (typeof value !== 'string') return { error: `Invalid '${field}': expected a string.` };
    const text = value.normalize('NFKC').trim();
    if (text === '') return { value: null };
    if (text.length > MAX_TEXT_LENGTH) return { error: `Invalid '${field}': at most ${MAX_TEXT_LENGTH} characters.` };
    return { value: text };
}

// Список компаний для sum_operations: от одной до MAX_COMPANIES строк, каждая
// как в readText. Одна строка вместо списка принимается за список из одной -
// модель иногда путает форму. Повторы (по nameKey) убираются, пустой список - без фильтра.
function readCompanies(value) {
    if (isAbsent(value)) return { value: null };
    const items = Array.isArray(value) ? value : [value];
    if (items.length > MAX_COMPANIES) return { error: `Invalid 'company': at most ${MAX_COMPANIES} names.` };
    const names = [];
    const seen = new Set();
    for (const item of items) {
        const text = readText(item, 'company');
        if (text.error) return text;
        if (text.value === null) {
            if (typeof item === 'string') continue;
            return { error: "Invalid 'company': expected a list of non-empty strings." };
        }
        const key = nameKey(text.value);
        if (seen.has(key)) continue;
        seen.add(key);
        names.push(text.value);
    }
    return { value: names.length > 0 ? names : null };
}

// Первое же сообщение об ошибке: инструмент возвращает его модели как есть.
const firstError = (...results) => results.find(result => result?.error)?.error || null;

// --- Инструмент: сумма операций -----------------------------------------------

function sumOperations(input, data) {
    const range = readRange(input);
    const type = readChoice(input.type, SUM_TYPES, 'type');
    const groupBy = readChoice(input.group_by ?? 'none', GROUP_BY, 'group_by');
    const category = readCategory(input.category, data, type.value);
    const account = readAccount(input.account, data);
    const company = readCompanies(input.company);
    const error = firstError(range, type, groupBy, category, account, company);
    if (error) return fail(error);

    const { from, to } = range;
    const companyKeys = company.value === null ? null : new Set(company.value.map(nameKey));
    const sum = type.value === 'expense' ? (items) => -sumExpense(items) : sumIncome;
    const filtered = applyFilters(
        data.transactions.filter(t => t.date >= from && t.date <= to),
        { account: account.id, category: category.value, type: type.value }
    ).filter(t => companyKeys === null || companyKeys.has(nameKey(companyOf(t))));
    // В итог входит то, что экраны считают расходом или доходом (sumExpense,
    // sumIncome); сколько таких операций, проверяется теми же функциями.
    const counted = filtered.filter(t => sum([t]) !== 0);

    const result = {
        from,
        to,
        type: type.value,
        filters: { category: category.value, account: account.value, company: company.value },
        group_by: groupBy.value,
        total: round2(sum(counted)),
        count: counted.length
    };

    if (groupBy.value !== 'none') {
        const keyOf = {
            month: (t) => t.date.slice(0, 7),
            category: (t) => t.category || 'Другое',
            account: (t) => accountName(data, t.account),
            company: (t) => nameKey(companyOf(t)) || 'Без компании'
        }[groupBy.value];
        const labels = new Map();
        const buckets = new Map();
        for (const t of counted) {
            const key = keyOf(t);
            if (!buckets.has(key)) buckets.set(key, []);
            buckets.get(key).push(t);
            if (groupBy.value === 'company' && !labels.has(key)) labels.set(key, clip(companyOf(t), 100) || 'Без компании');
        }
        const groups = [...buckets].map(([key, items]) => ({ key: labels.get(key) ?? key, total: round2(sum(items)), count: items.length }))
            .sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
        result.groups = groups.slice(0, MAX_GROUPS);
        if (groups.length > MAX_GROUPS) {
            const rest = groups.slice(MAX_GROUPS);
            result.others = {
                groups: rest.length,
                total: round2(rest.reduce((acc, group) => acc + group.total, 0)),
                count: rest.reduce((acc, group) => acc + group.count, 0)
            };
        }
    }

    if (company.value !== null) {
        const matched = new Set(counted.map(t => nameKey(companyOf(t))));
        const unknown = company.value.filter(name => !matched.has(nameKey(name)));
        if (unknown.length > 0) {
            result.note = `No operation has exactly these company names: ${unknown.join(', ')}. Check the spelling with find_operations (text) or group_by company.`;
        }
    }
    return { ok: true, result };
}

// --- Инструмент: поиск операций -----------------------------------------------

function describeOperation(t, data) {
    const row = {
        date: t.date,
        amount: round2(Math.abs(t.amount)),
        type: t.type,
        category: t.category || '',
        account: accountName(data, t.account)
    };
    if (t.type === 'transfer') row.to_account = t.toAccount ? accountName(data, t.toAccount) : '';
    row.company = clip(companyOf(t), 100);
    row.description = clip(descriptionOf(t));
    if (t.excludeFromStats) row.not_in_stats = true;
    return row;
}

function findOperations(input, data) {
    const range = readRange(input);
    const type = readChoice(input.type, FIND_TYPES, 'type', { optional: true });
    const category = readCategory(input.category, data, type.value);
    const account = readAccount(input.account, data);
    const text = readText(input.text, 'text');
    const sort = readChoice(input.sort ?? 'date_desc', SORTS, 'sort');
    let limit = DEFAULT_FIND_LIMIT;
    if (!isAbsent(input.limit)) {
        if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > MAX_FIND_LIMIT) {
            return fail(`Invalid 'limit': an integer from 1 to ${MAX_FIND_LIMIT}.`);
        }
        limit = input.limit;
    }
    const error = firstError(range, type, category, account, text, sort);
    if (error) return fail(error);

    const { from, to } = range;
    // Стартовый баланс - не операция, которую человек искал бы.
    let found = applyFilters(
        data.transactions.filter(t => t.date >= from && t.date <= to && t.type !== 'initial'),
        { account: account.id, category: category.value, type: type.value }
    );
    if (text.value !== null) {
        const needle = text.value.toLowerCase();
        found = found.filter(t => [t.companyName, t.description, t.title].some(field => typeof field === 'string' && field.toLowerCase().includes(needle)));
    }

    const byId = (a, b) => String(b.id).localeCompare(String(a.id));
    found.sort(sort.value === 'amount_desc'
        ? (a, b) => b.amount - a.amount || b.date.localeCompare(a.date) || byId(a, b)
        : (a, b) => b.date.localeCompare(a.date) || byId(a, b));

    const result = {
        from,
        to,
        filters: { type: type.value, category: category.value, account: account.value, text: text.value },
        sort: sort.value,
        total_found: found.length,
        operations: found.slice(0, limit).map(t => describeOperation(t, data))
    };
    // Текст ищет только по компании и описанию: вид трат модель должна искать по категории.
    if (text.value !== null && found.length === 0) {
        result.note = 'No operation has this text in its company name or note. Text search does not look at categories: for a kind of spending use sum_operations with the closest category.';
    }
    return { ok: true, result };
}

// --- Инструмент: остатки ------------------------------------------------------

function getBalances(input, data) {
    const balances = computeBalances(data.transactions, data.rawAccounts);
    const known = new Set(data.accounts.map(account => account.id));
    const accounts = data.accounts.map(account => ({
        name: account.name,
        type: account.type,
        balance: round2(balances.byAccount[account.id] || 0),
        excluded_from_total: account.excludeFromTotal
    }));
    // Старые операции могут ссылаться на счёт-литерал ('card', 'cash'), которого
    // нет в справочнике: деньги там есть, и пропустить их значило бы потерять сумму.
    for (const [id, balance] of Object.entries(balances.byAccount)) {
        if (known.has(id) || round2(balance) === 0) continue;
        accounts.push({ name: accountName(data, id), type: id === 'cash' ? 'cash' : 'card', balance: round2(balance), excluded_from_total: false });
    }
    return {
        ok: true,
        result: {
            as_of: data.today,
            accounts,
            total: round2(balances.total),
            held_on_excluded_accounts: round2(balances.held),
            by_type: { card: round2(balances.byType.card), cash: round2(balances.byType.cash) }
        }
    };
}

// --- Инструмент: типичный месяц -----------------------------------------------

function getTypicalMonth(input, data) {
    if (typeof input.month !== 'string' || !MONTH_PATTERN.test(input.month) || input.month < '2000-01' || input.month > '2100-12') {
        return fail("Invalid 'month': expected YYYY-MM.");
    }
    const category = readCategory(input.category, data, 'expense');
    if (category.error) return fail(category.error);

    const month = input.month;
    const typical = computeTypicalMonth(data.transactions, { month, today: data.today, category: category.value });
    if (!typical) {
        return {
            ok: true,
            result: {
                month,
                category: category.value,
                available: false,
                reason: 'Fewer than 3 full months of history before this month, so there is no typical month to compare with.'
            }
        };
    }

    const todayMonth = data.today.slice(0, 7);
    const elapsedDays = typical.actualByDay.length;
    const result = {
        month,
        category: category.value,
        available: true,
        status: month === todayMonth ? 'current' : (month < todayMonth ? 'past' : 'future'),
        reference_months: typical.months,
        typical_month_total: typical.monthTotal,
        days_counted: elapsedDays,
        spent_so_far: elapsedDays > 0 ? typical.actualByDay[elapsedDays - 1] : 0,
        typical_by_this_day: elapsedDays > 0 ? typical.byDay[elapsedDays - 1] : 0
    };
    if (typical.today) {
        result.typical_remaining = typical.today.typicalRemaining;
        result.forecast_month_end = typical.today.forecast;
    }
    return { ok: true, result };
}

const TOOLS = {
    sum_operations: sumOperations,
    find_operations: findOperations,
    get_balances: getBalances,
    get_typical_month: getTypicalMonth
};

// Выполняет вызов и возвращает содержимое tool_result. Ничего не бросает:
// неизвестный инструмент, чужой формат ввода и ошибка внутри - всё это
// is_error с короткой причиной.
function executeTool(name, input, data) {
    const tool = Object.hasOwn(TOOLS, name) ? TOOLS[name] : null;
    if (!tool) return { content: `Unknown tool '${clip(String(name), 40)}'.`, isError: true };
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return { content: 'The tool input must be a JSON object.', isError: true };
    }
    try {
        const outcome = tool(input, data);
        return outcome.ok
            ? { content: JSON.stringify(outcome.result), isError: false }
            : { content: outcome.error, isError: true };
    } catch {
        return { content: 'The tool failed unexpectedly. Try a different request.', isError: true };
    }
}

// --- Описание инструментов для Claude -----------------------------------------

const nullable = (schema, description) => ({ anyOf: [schema, { type: 'null' }], ...(description ? { description } : {}) });
// Пустой enum схема не принимает: без значений остаётся только null.
const nameChoice = (names, description) => (names.length > 0
    ? nullable({ type: 'string', enum: names }, description)
    : { type: 'null', description });

const DATE_NOTE = 'YYYY-MM-DD';

function buildToolDefinitions({ categories = [], accounts = [] }) {
    const categoryNames = [...new Set(categories.map(category => category.name))];
    const expenseNames = [...new Set(categories.filter(category => category.type === 'expense').map(category => category.name))];
    const accountNames = accounts.map(account => account.name);
    const strictSchema = (properties) => ({
        type: 'object',
        properties,
        required: Object.keys(properties),
        additionalProperties: false
    });

    return [
        {
            name: 'sum_operations',
            description: 'Total of expenses or income over a period, computed by the app with the same rules as its Analytics screens: transfers between own accounts and operations marked "not in statistics" are not counted. Use it for EVERY total, comparison or breakdown; call it once per period you need. Result: total and count (positive numbers, euros), the effective filters, and for group_by month/category/company/account the groups sorted by total, largest first (at most 40, the rest summed in "others"). Months are YYYY-MM.',
            strict: true,
            input_schema: strictSchema({
                from: { type: 'string', description: `First day of the period, ${DATE_NOTE}, inclusive.` },
                to: { type: 'string', description: `Last day of the period, ${DATE_NOTE}, inclusive. At most 10 years after "from".` },
                type: { type: 'string', enum: SUM_TYPES },
                category: nameChoice(categoryNames, 'Only this category, or null for all.'),
                account: nameChoice(accountNames, 'Only this account (by name), or null for all.'),
                company: nullable({ type: 'array', items: { type: 'string' } }, 'Exact company/merchant names, case-insensitive; operations of any of them are counted together. null for all. At most 10 names. To find the spelling use find_operations with text or group_by company.'),
                group_by: { type: 'string', enum: GROUP_BY, description: 'none for one total, or split by month, category, company or account.' }
            })
        },
        {
            name: 'find_operations',
            description: 'Find individual operations (date, amount, type, category, account, company, description). Use it to show the largest or latest operations or to look for a merchant or a note. The list is limited, so NEVER add its amounts up: use sum_operations for totals. Rows with not_in_stats are not counted in totals. Result: total_found and the operations.',
            strict: true,
            input_schema: strictSchema({
                from: { type: 'string', description: `First day, ${DATE_NOTE}, inclusive.` },
                to: { type: 'string', description: `Last day, ${DATE_NOTE}, inclusive. At most 10 years after "from".` },
                type: nullable({ type: 'string', enum: FIND_TYPES }, 'Only this operation type, or null for all.'),
                category: nameChoice(categoryNames, 'Only this category, or null for all.'),
                account: nameChoice(accountNames, 'Only this account (by name; transfers match either side), or null for all.'),
                text: nullable({ type: 'string' }, 'Case-insensitive substring of the company, description or title, or null.'),
                sort: { type: 'string', enum: SORTS, description: 'date_desc: newest first. amount_desc: largest first.' },
                limit: nullable({ type: 'integer' }, 'How many operations to return, 1 to 30; null for 15.')
            })
        },
        {
            name: 'get_balances',
            description: 'Current balance of every account and the total capital, computed exactly like the app\'s overview. Accounts marked excluded_from_total (a deposit, money held elsewhere) are left out of the total; held_on_excluded_accounts is the positive money on them.',
            strict: true,
            input_schema: strictSchema({})
        },
        {
            name: 'get_typical_month',
            description: 'How a month\'s expenses compare with a typical month: the median of the last (up to 6) full months before it. Result: spent so far, typical spend by the same day, the typical full month, for the current month also the typical remainder and the forecast for month end, and the reference months used. available=false when there are fewer than 3 full months of history.',
            strict: true,
            input_schema: strictSchema({
                month: { type: 'string', description: 'The month, YYYY-MM.' },
                category: nameChoice(expenseNames, 'Only this expense category, or null for all expenses.')
            })
        }
    ];
}

// --- Подпись шага для интерфейса ----------------------------------------------

const MONTHS_NOMINATIVE = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const MONTHS_GENITIVE = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

const lastDayOfMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();

// «октябрь 2026» по ключу месяца YYYY-MM.
function formatMonthRu(month) {
    if (typeof month !== 'string' || !MONTH_PATTERN.test(month)) return String(month);
    const [year, number] = month.split('-').map(Number);
    return `${MONTHS_NOMINATIVE[number - 1]} ${year}`;
}

// Период для подписи шага: один день, целый месяц, целый год или диапазон.
// Месяцы в родительном падеже («1 июня – 31 августа 2026»), годы не повторяются,
// если совпадают.
function formatRangeRu(from, to) {
    if (parseDay(from) === null || parseDay(to) === null) return `${from} – ${to}`;
    const [y1, m1, d1] = from.split('-').map(Number);
    const [y2, m2, d2] = to.split('-').map(Number);
    if (from === to) return `${d1} ${MONTHS_GENITIVE[m1 - 1]} ${y1}`;
    if (y1 === y2 && m1 === 1 && d1 === 1 && m2 === 12 && d2 === 31) return `${y1} год`;
    if (y1 === y2 && m1 === m2) {
        if (d1 === 1 && d2 === lastDayOfMonth(y2, m2)) return `${MONTHS_NOMINATIVE[m1 - 1]} ${y1}`;
        return `${d1} – ${d2} ${MONTHS_GENITIVE[m1 - 1]} ${y1}`;
    }
    if (y1 === y2) return `${d1} ${MONTHS_GENITIVE[m1 - 1]} – ${d2} ${MONTHS_GENITIVE[m2 - 1]} ${y1}`;
    return `${d1} ${MONTHS_GENITIVE[m1 - 1]} ${y1} – ${d2} ${MONTHS_GENITIVE[m2 - 1]} ${y2}`;
}

const stepText = (value, limit = 40) => {
    const text = typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : '';
    return text.length > limit ? `${text.slice(0, limit)}…` : text;
};

// Подпись для списка шагов («Транспорт, 1 июня – 31 августа 2026»). Строится
// по вводу вызова, даже неверному: подпись не должна падать, иначе вопрос
// оборвётся из-за косметики.
function describeToolCall(name, input) {
    const source = input && typeof input === 'object' ? input : {};
    try {
        switch (name) {
            case 'sum_operations': {
                const head = [
                    stepText(source.category) || (source.type === 'income' ? 'Доходы' : 'Расходы'),
                    stepText(Array.isArray(source.company)
                        ? source.company.filter(name => typeof name === 'string').join(', ')
                        : source.company),
                    stepText(source.account)
                ].filter(Boolean).join(' · ');
                return `${head}, ${formatRangeRu(source.from, source.to)}`;
            }
            case 'find_operations': {
                const text = stepText(source.text);
                const head = text
                    ? `Поиск: ${text}`
                    : ['Операции', [stepText(source.category), stepText(source.account)].filter(Boolean).join(' · ')].filter(Boolean).join(': ');
                return `${head}, ${formatRangeRu(source.from, source.to)}`;
            }
            case 'get_balances':
                return 'Остатки по счетам';
            case 'get_typical_month': {
                const category = stepText(source.category);
                return `Типичный месяц: ${formatMonthRu(source.month)}${category ? `, ${category}` : ''}`;
            }
            default:
                return 'Расчёт';
        }
    } catch {
        return 'Расчёт';
    }
}

module.exports = {
    prepareData,
    executeTool,
    buildToolDefinitions,
    describeToolCall,
    formatRangeRu,
    formatMonthRu,
    sumOperations,
    findOperations,
    getBalances,
    getTypicalMonth,
    companyOf,
    descriptionOf,
    nameKey,
    clip,
    MAX_GROUPS
};
