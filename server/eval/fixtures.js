// Детерминированные данные для оффлайн-оценки функций на Claude.
//
// Один и тот же набор при каждом запуске: ответ на «сколько ушло на кафе в
// сентябре» считается из этих же данных, поэтому любое случайное расхождение
// между прогонами сделало бы сравнение ответов бессмысленным. Поэтому здесь
// свой генератор с фиксированным зерном (mulberry32), а не Math.random, и
// фиксированные _id у всего, что сортируется по id при равных суммах и датах.
//
// «Сегодня» - вторник 13 октября 2026: операции идут по 12 октября включительно.

const mongoose = require('mongoose');
const { normalizeCompanyName } = require('../companies');

const TODAY = '2026-10-13';
// Месячный лимит в настройках (для разбора месяца).
const MONTHLY_LIMIT = 3500;
const FIRST_MONTH = { year: 2024, month: 10 };
const LAST_MONTH = { year: 2026, month: 10 };
const LAST_DAY_OF_LAST_MONTH = 12;

const SEED = 20261013;

function mulberry32(seed) {
    let state = seed >>> 0;
    return function next() {
        state = (state + 0x6D2B79F5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const MONTH_NAMES = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

const objectId = (prefix, index) => new mongoose.Types.ObjectId(`${prefix}${index.toString(16).padStart(24 - prefix.length, '0')}`);

const ACCOUNT_SPECS = [
    { name: 'Revolut', type: 'card', icon: '💳', isDefault: true },
    { name: 'Wise', type: 'card', icon: '💳' },
    { name: 'Alpha Bank', type: 'card', icon: '🏦' },
    { name: 'Eurobank', type: 'card', icon: '🏦' },
    { name: 'Кредитка Piraeus', type: 'card', icon: '💳' },
    // Единственный наличный счёт: на нём проверяется «сколько у меня наличных».
    { name: 'Наличные', type: 'cash', icon: '💵' },
    { name: 'Депозит', type: 'card', icon: '🏛️', excludeFromTotal: true }
];

const EXPENSE_CATEGORIES = ['Жилье', 'Авто', 'Отпуск', 'Кафе и досуг', 'Продукты', 'Транспорт', 'Здоровье', 'Связь и подписки', 'Одежда', 'Подарки', 'Техника'];
const INCOME_CATEGORIES = ['Зарплата', 'Кэшбэк', 'Прочие доходы'];

const COMPANY_NAMES = [
    'Lidl', 'Sklavenitis', 'AB Vassilopoulos', 'My Market', 'Фурнос Пекарня',
    'Starbucks', 'Coffee Island', 'Everest', 'Taverna Kritikos', 'Cinema Pallas', 'Periptero',
    'Bolt', 'Uber', 'OASA',
    'Shell', 'EKO', 'Автосервис Мотор', 'Interamerican', 'Парковка',
    'Aegean Airlines', 'Booking.com', 'Ryanair', 'Avis', 'Mythos Tavern', 'Calypso Beach Bar', 'Parnassos Ski Center',
    'Netflix', 'Spotify', 'Cosmote',
    'Intersport', 'Zara', 'Hondos Center',
    'Аптека Пападопулос',
    'Арендодатель', 'ΔΕΗ',
    'Public', 'Flying Tiger', 'Jumbo'
];

// Дробные суммы копятся с ошибкой плавающей точки: каждая сумма округляется до центов.
const cents = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

function buildFixtures() {
    const random = mulberry32(SEED);
    const between = (min, max) => min + random() * (max - min);
    const money = (min, max) => cents(between(min, max));
    const intBetween = (min, max) => Math.floor(between(min, max + 1));
    const pick = (list) => list[Math.floor(random() * list.length)];
    const chance = (probability) => random() < probability;
    const weighted = (pairs) => {
        const total = pairs.reduce((sum, [, weight]) => sum + weight, 0);
        let point = random() * total;
        for (const [value, weight] of pairs) {
            point -= weight;
            if (point < 0) return value;
        }
        return pairs[pairs.length - 1][0];
    };

    const accounts = ACCOUNT_SPECS.map((spec, index) => ({
        _id: objectId('a1', index + 1),
        isDefault: false,
        excludeFromTotal: false,
        ...spec,
        order: index
    }));
    const accountId = (name) => String(accounts.find(account => account.name === name)._id);

    const categories = [
        ...EXPENSE_CATEGORIES.map((name, index) => ({ name, type: 'expense', order: index })),
        ...INCOME_CATEGORIES.map((name, index) => ({ name, type: 'income', order: index }))
    ];

    const companies = COMPANY_NAMES.map((rawName, index) => {
        const { name, normalizedName } = normalizeCompanyName(rawName);
        return { _id: objectId('c0', index + 1), name, normalizedName, logoMode: 'auto' };
    });
    const companyByName = new Map(companies.map(company => [company.name, company]));

    // --- Календарь ---------------------------------------------------------------

    const months = [];
    for (let year = FIRST_MONTH.year, month = FIRST_MONTH.month; year < LAST_MONTH.year || (year === LAST_MONTH.year && month <= LAST_MONTH.month);) {
        months.push({ year, month });
        month += 1;
        if (month > 12) { month = 1; year += 1; }
    }
    const daysIn = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();
    const dateKey = (year, month, day) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    // --- Операции ----------------------------------------------------------------

    const ops = [];
    let sequence = 0;
    // pay: имя счёта или список [[имя, вес], ...]; если в списке есть наличные,
    // выбор уточняется при разборе месяца по дням (наличных должно хватать).
    const add = (op) => {
        ops.push({ ...op, seq: sequence += 1 });
    };

    // Остаток наличных и долг по кредитке по ходу разбора.
    let cashBalance = 0;
    const creditSpentByMonth = new Map();
    const CASH = 'Наличные';
    const CREDIT = 'Кредитка Piraeus';

    // Стартовые остатки: нулевой (кредитка) пропускается.
    const initialBalances = [['Revolut', 2500], ['Wise', 800], ['Alpha Bank', 4000], ['Eurobank', 600], [CASH, 300], ['Депозит', 10000]];
    for (const [name, amount] of initialBalances) {
        add({ date: '2024-10-01', day: 0, type: 'initial', title: 'Стартовый баланс', amount, category: 'Другое', description: 'Стартовый баланс', pay: name, account: name });
        if (name === CASH) cashBalance += amount;
    }

    // Счёт для операции со списком вариантов. Наличные выбираются, только пока
    // их хватает: иначе остаток ушёл бы в минус, чего у живого человека не бывает.
    const resolveAccount = (op) => {
        if (!Array.isArray(op.pay)) return op.pay;
        const name = weighted(op.pay);
        if (name !== CASH || cashBalance >= op.amount + 5) return name;
        const others = op.pay.filter(([option]) => option !== CASH);
        return others.length > 0 ? weighted(others) : 'Revolut';
    };

    const expense = (year, month, day, { company, category, amount, pay, description = '', excluded = false }) => {
        add({ date: dateKey(year, month, day), day, type: 'expense', title: company, companyName: company, category, amount, pay, description, excludeFromStats: excluded });
    };

    for (const { year, month } of months) {
        const monthStart = ops.length;
        const isLast = year === LAST_MONTH.year && month === LAST_MONTH.month;
        const total = daysIn(year, month);
        const lastDay = isLast ? LAST_DAY_OF_LAST_MONTH : total;
        // Доля месяца, прошедшая к последнему дню данных: в неполном месяце счётчики масштабируются.
        const share = lastDay / total;
        const count = (min, max) => Math.max(1, Math.round(intBetween(min, max) * share));
        const day = (from = 1, to = lastDay) => intBetween(Math.min(from, lastDay), Math.min(to, lastDay));
        const monthName = MONTH_NAMES[month - 1];
        const ym = year * 100 + month;
        const onDay = (d) => (d <= lastDay ? d : null);

        // Регулярные платежи.
        expense(year, month, 1, { company: 'Арендодатель', category: 'Жилье', amount: 1100, pay: 'Alpha Bank', description: `Аренда за ${monthName}` });
        if (onDay(12)) expense(year, month, 12, { company: 'ΔΕΗ', category: 'Жилье', amount: money(60, 110), pay: 'Alpha Bank', description: `Электричество за ${monthName}` });
        // Cosmote - фиксированный платёж. Бросок chance() оставлен, чтобы не сдвигать остальные случайные числа набора.
        chance(0.25);
        if (onDay(5)) expense(year, month, 5, { company: 'Cosmote', category: 'Связь и подписки', amount: 44.9, pay: 'Alpha Bank', description: 'Интернет и мобильная связь' });
        // Netflix подорожал с сентября 2026; Spotify в сентябре 2026 не списался (до и после - 10,99).
        if (onDay(8)) expense(year, month, 8, { company: 'Netflix', category: 'Связь и подписки', amount: ym >= 202609 ? 15.99 : 13.99, pay: 'Revolut' });
        if (onDay(10) && ym !== 202609) expense(year, month, 10, { company: 'Spotify', category: 'Связь и подписки', amount: 10.99, pay: 'Revolut' });
        expense(year, month, 2, { company: 'OASA', category: 'Транспорт', amount: 30, pay: 'Wise', description: 'Месячный проездной' });

        // Продукты.
        const groceryNotes = ['на неделю', 'на выходные', 'пикник', 'для гостей', ''];
        for (let i = count(10, 14); i > 0; i -= 1) {
            expense(year, month, day(), {
                company: pick(['Lidl', 'Lidl', 'Sklavenitis', 'Sklavenitis', 'AB Vassilopoulos', 'My Market']),
                category: 'Продукты',
                amount: money(15, 90),
                pay: [['Revolut', 4], ['Wise', 3], [CASH, 2]],
                description: chance(0.35) ? pick(groceryNotes) : ''
            });
        }
        for (let i = count(9, 14); i > 0; i -= 1) {
            expense(year, month, day(), { company: 'Фурнос Пекарня', category: 'Продукты', amount: money(2, 9), pay: [['Revolut', 3], [CASH, 2]] });
        }

        // Кафе и досуг.
        const cafeNotes = ['с коллегами', 'с друзьями', 'после работы', 'завтрак', 'день рождения Маши', ''];
        for (let i = count(8, 12); i > 0; i -= 1) {
            const company = weighted([['Starbucks', 3], ['Coffee Island', 3], ['Everest', 3], ['Taverna Kritikos', 2]]);
            const amount = company === 'Taverna Kritikos' ? money(20, 60) : company === 'Everest' ? money(6, 18) : money(4, 12);
            expense(year, month, day(), { company, category: 'Кафе и досуг', amount, pay: [['Revolut', 3], ['Eurobank', 1], [CASH, 3]], description: chance(0.4) ? pick(cafeNotes) : '' });
        }
        for (let i = count(6, 9); i > 0; i -= 1) {
            expense(year, month, day(), { company: 'Periptero', category: 'Кафе и досуг', amount: money(1.5, 5), pay: [[CASH, 1]], description: pick(['вода', 'кофе', 'фраппе', '']) });
        }
        for (let i = count(1, 2); i > 0; i -= 1) {
            expense(year, month, day(), { company: 'Cinema Pallas', category: 'Кафе и досуг', amount: money(8, 25), pay: [['Eurobank', 1], ['Revolut', 1]], description: chance(0.5) ? 'кино' : '' });
        }

        // Транспорт: такси.
        for (let i = count(5, 9); i > 0; i -= 1) {
            expense(year, month, day(), { company: pick(['Bolt', 'Bolt', 'Uber']), category: 'Транспорт', amount: money(7, 25), pay: [['Wise', 1], ['Revolut', 1]], description: chance(0.2) ? pick(['в аэропорт', 'ночью', 'под дождем']) : '' });
        }

        // Авто: топливо и парковка.
        for (let i = count(2, 3); i > 0; i -= 1) {
            expense(year, month, day(), { company: pick(['Shell', 'EKO']), category: 'Авто', amount: money(50, 80), pay: 'Wise', description: chance(0.2) ? 'полный бак' : '' });
        }
        for (let i = count(6, 9); i > 0; i -= 1) {
            expense(year, month, day(), { company: 'Парковка', category: 'Авто', amount: money(1, 4), pay: [[CASH, 1], ['Wise', 1]] });
        }

        // Здоровье.
        for (let i = count(1, 2); i > 0; i -= 1) {
            expense(year, month, day(), { company: 'Аптека Пападопулос', category: 'Здоровье', amount: money(8, 60), pay: [['Revolut', 2], [CASH, 1]], description: chance(0.4) ? pick(['витамины', 'антибиотики', 'от простуды']) : '' });
        }

        // Одежда: несколько раз в квартал.
        if (chance(0.4)) {
            expense(year, month, day(), { company: pick(['Zara', 'Intersport', 'Hondos Center']), category: 'Одежда', amount: money(25, 140), pay: [[CREDIT, 2], ['Eurobank', 1]] });
        }

        // Подарки: в основном декабрь, плюс дни рождения.
        if (month === 12) {
            for (let i = intBetween(4, 6); i > 0; i -= 1) {
                expense(year, month, day(1, 24), { company: pick(['Public', 'Flying Tiger', 'Jumbo', 'Zara']), category: 'Подарки', amount: money(20, 120), pay: [[CREDIT, 2], ['Eurobank', 1]], description: 'новогодние подарки' });
            }
        }
        if (month === 5 || month === 9) {
            expense(year, month, day(1, 20), { company: pick(['Flying Tiger', 'Jumbo']), category: 'Подарки', amount: money(30, 80), pay: 'Eurobank', description: month === 5 ? 'день рождения Маши' : 'день рождения Игоря' });
        }

        // Разовые и сезонные расходы.
        if (month === 3) {
            expense(year, month, 14, { company: 'Interamerican', category: 'Авто', amount: year === 2025 ? 415 : 428, pay: 'Alpha Bank', description: 'Страховка авто на год' });
        }
        if (ym === 202504) expense(year, month, 9, { company: 'Автосервис Мотор', category: 'Авто', amount: 280, pay: 'Wise', description: 'ТО 45 000 км' });
        if (ym === 202510) expense(year, month, 7, { company: 'Автосервис Мотор', category: 'Авто', amount: 220, pay: 'Wise', description: 'ТО 52 000 км, замена тормозных колодок' });
        if (ym === 202604) expense(year, month, 16, { company: 'Автосервис Мотор', category: 'Авто', amount: 450, pay: 'Wise', description: 'ТО 60 000 км' });

        // Отпуска.
        if (ym === 202506) {
            expense(year, month, 18, { company: 'Booking.com', category: 'Отпуск', amount: 1350, pay: CREDIT, description: 'Отель, Крит, июль' });
            expense(year, month, 20, { company: 'Aegean Airlines', category: 'Отпуск', amount: 520, pay: CREDIT, description: 'Билеты на Крит' });
        }
        if (ym === 202507) {
            expense(year, month, 6, { company: 'Avis', category: 'Отпуск', amount: 180, pay: CREDIT, description: 'Машина на неделю' });
            [[7, 'Mythos Tavern', 62], [9, 'Calypso Beach Bar', 38], [10, 'Mythos Tavern', 71], [12, 'Calypso Beach Bar', 45], [13, 'Mythos Tavern', 58]]
                .forEach(([d, company, amount]) => expense(year, month, d, { company, category: 'Отпуск', amount, pay: 'Wise', description: 'в отпуске' }));
        }
        if (ym === 202607) {
            expense(year, month, 20, { company: 'Ryanair', category: 'Отпуск', amount: 380, pay: CREDIT, description: 'Билеты на август' });
        }
        if (ym === 202608) {
            expense(year, month, 2, { company: 'Booking.com', category: 'Отпуск', amount: 1900, pay: CREDIT, description: 'Отель на две недели' });
            expense(year, month, 4, { company: 'Avis', category: 'Отпуск', amount: 260, pay: CREDIT, description: 'Машина на две недели' });
            [[5, 'Mythos Tavern', 84], [6, 'Calypso Beach Bar', 52], [8, 'Mythos Tavern', 96], [9, 'Calypso Beach Bar', 61], [11, 'Mythos Tavern', 118], [12, 'Calypso Beach Bar', 47], [14, 'Mythos Tavern', 73], [15, 'Calypso Beach Bar', 66], [17, 'Mythos Tavern', 92], [18, 'Mythos Tavern', 105], [19, 'Calypso Beach Bar', 58], [20, 'Mythos Tavern', 131], [22, 'Calypso Beach Bar', 77], [23, 'Mythos Tavern', 144]]
                .forEach(([d, company, amount]) => expense(year, month, d, { company, category: 'Отпуск', amount, pay: 'Wise', description: 'в отпуске' }));
        }
        if (ym === 202602) {
            expense(year, month, 6, { company: 'Booking.com', category: 'Отпуск', amount: 380, pay: CREDIT, description: 'Зимний отель' });
            expense(year, month, 14, { company: 'Parnassos Ski Center', category: 'Отпуск', amount: 190, pay: 'Wise', description: 'Ски-пассы' });
            expense(year, month, 14, { company: 'Everest', category: 'Отпуск', amount: 48, pay: 'Wise', description: 'на склоне' });
            expense(year, month, 15, { company: 'Mythos Tavern', category: 'Отпуск', amount: 82, pay: 'Wise', description: 'ужин' });
        }

        // Техника.
        if (ym === 202511) expense(year, month, 28, { company: 'Public', category: 'Техника', amount: 160, pay: CREDIT, description: 'Наушники, распродажа' });
        if (ym === 202605) expense(year, month, 14, { company: 'Public', category: 'Техника', amount: 1150, pay: CREDIT, description: 'Ноутбук' });

        // Траты, которые не должны попадать в статистику (заплатил за друга).
        if (ym === 202504) expense(year, month, 20, { company: 'Taverna Kritikos', category: 'Кафе и досуг', amount: 85, pay: 'Revolut', description: 'Заплатил за друга, вернет', excluded: true });
        if (ym === 202603) expense(year, month, 22, { company: 'Taverna Kritikos', category: 'Кафе и досуг', amount: 140, pay: 'Revolut', description: 'Долг другу', excluded: true });
        if (ym === 202609) expense(year, month, 19, { company: 'Taverna Kritikos', category: 'Кафе и досуг', amount: 200, pay: 'Revolut', description: 'Долг другу', excluded: true });

        // Доходы.
        if (onDay(25)) {
            add({ date: dateKey(year, month, 25), day: 25, type: 'income', title: 'Зарплата', amount: ym >= 202601 ? 3400 : 3200, category: 'Зарплата', pay: 'Alpha Bank', description: `Зарплата за ${monthName}` });
        }
        if (onDay(20)) {
            add({ date: dateKey(year, month, 20), day: 20, type: 'income', title: 'Кэшбэк', amount: money(5, 25), category: 'Кэшбэк', pay: 'Revolut', description: 'Кэшбэк за месяц' });
        }
        const otherIncome = {
            202503: [14, 150, 'Продал велосипед'],
            202511: [21, 85, 'Вернули за билеты'],
            202604: [8, 220, 'Продал диван'],
            202607: [15, 40, 'Подарок на день рождения']
        }[ym];
        if (otherIncome) {
            add({ date: dateKey(year, month, otherIncome[0]), day: otherIncome[0], type: 'income', title: otherIncome[2], amount: otherIncome[1], category: 'Прочие доходы', pay: 'Revolut', description: otherIncome[2] });
        }

        // Переводы.
        const transfer = (d, from, to, amount, title, description = '') => {
            if (d > lastDay) return;
            add({ date: dateKey(year, month, d), day: d, type: 'transfer', title, amount, category: 'Перевод', pay: from, toAccount: to, description });
        };
        transfer(3, 'Revolut', CASH, intBetween(3, 5) * 50, 'Снятие наличных', 'Банкомат');
        transfer(26, 'Alpha Bank', 'Revolut', 800, 'Перевод на Revolut', 'Ежемесячное пополнение');
        transfer(26, 'Alpha Bank', 'Wise', 550, 'Перевод на Wise', 'Ежемесячное пополнение');
        transfer(26, 'Alpha Bank', 'Eurobank', 50, 'Перевод на Eurobank');
        if ((month - 1) % 3 === 0) transfer(5, 'Alpha Bank', 'Депозит', 300, 'Взнос на депозит', 'Квартальный взнос');
        // Погашение кредитки за прошлый месяц; сумма известна, только когда прошлый месяц разобран.
        const previous = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
        const owed = creditSpentByMonth.get(previous);
        if (owed) transfer(4, 'Alpha Bank', CREDIT, cents(owed), 'Погашение кредитки', `Погашение за ${previous}`);

        // Разбор месяца по дням: счёт выбирается в порядке дат, чтобы знать остаток наличных.
        const monthOps = ops.slice(monthStart).sort((a, b) => a.day - b.day || a.seq - b.seq);
        for (const op of monthOps) {
            op.account = resolveAccount(op);
            if (op.type === 'transfer') {
                if (op.toAccount === CASH) cashBalance += op.amount;
                if (op.account === CASH) cashBalance -= op.amount;
            } else if (op.type === 'income') {
                if (op.account === CASH) cashBalance += op.amount;
            } else if (op.account === CASH) {
                cashBalance -= op.amount;
            }
            if (op.account === CREDIT && op.type === 'expense') {
                const key = op.date.slice(0, 7);
                creditSpentByMonth.set(key, cents((creditSpentByMonth.get(key) || 0) + op.amount));
            }
        }
    }

    // --- Сборка документов -----------------------------------------------------

    const sorted = [...ops].sort((a, b) => a.date.localeCompare(b.date) || a.seq - b.seq);
    const transactions = sorted.map((op, index) => {
        const date = new Date(`${op.date}T00:00:00.000Z`);
        const doc = {
            _id: objectId('7a', index + 1),
            title: op.title,
            amount: cents(op.amount),
            type: op.type,
            account: accountId(op.account),
            date,
            createdAt: date,
            excludeFromStats: Boolean(op.excludeFromStats)
        };
        if (op.type !== 'transfer') doc.category = op.category;
        if (op.description) doc.description = op.description;
        if (op.type === 'transfer') doc.toAccount = accountId(op.toAccount);
        if (op.type === 'expense') {
            const company = companyByName.get(op.companyName);
            doc.companyName = company.name;
            doc.companyId = company._id;
        }
        return doc;
    });

    return { accounts, categories, companies, transactions };
}

module.exports = { TODAY, MONTHLY_LIMIT, buildFixtures, MONTH_NAMES };
