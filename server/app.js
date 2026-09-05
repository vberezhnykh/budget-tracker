// Приложение целиком: middleware, роуты, отдача статики - и ничего больше.
// Ни подключения к базе, ни засева, ни listen: этим занимается server/index.js.
//
// Разделение сделано ради тестов. Пока это был один файл, импорт сервера в
// тест тянул за собой mongoose.connect(process.env.MONGODB_URI) - в тесте это
// undefined, - засев поверх фикстур и висящий порт с таймером самопинга.
// Теперь тест импортирует app и подключается к своей базе сам.

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const path = require('path');
const Transaction = require('./models/Transaction');
const PlannedPayment = require('./models/PlannedPayment');
const Category = require('./models/Category');
const Account = require('./models/Account');
const {
    validateTransactionCreate,
    validateTransactionUpdate,
    validateTransactionVersion
} = require('./transactionInput');
const { getCanonicalSettings, saveCanonicalSettings } = require('./settingsSingleton');
const { createOperationalRouter } = require('./operational');
const { activeTransactionFilter } = require('./ledgerState');
const { validateAccountReferences } = require('./accountRefs');
const { createTrashRouter, softDeleteTransaction } = require('./trash');
const { createPlannedPaymentsRouter } = require('./plannedPayments');
const { parseTransactionQuery } = require('./transactionQuery');
const { computeBalances, computeMonthlyTotals } = require('./stats');
const { transformTransactions } = require('./transform');
const { computePeriodData, periodPrefixOf } = require('./periodStats');
const {
    computeComparison,
    computeCategoryComparison,
    computeMonthlySeries,
    computeYearlyData,
    computeLifetimeStats,
    computeSearchResults,
    computeDescriptionSuggestions,
    computeCategoryUsage,
    computeCategoryCounts
} = require('./analytics');
const {
    COOKIE_NAME,
    TOKEN_TTL_MS,
    checkPassword,
    createToken,
    getAuthConfig,
    buildHealthPayload,
    cookieOptions,
    createAuthMiddleware,
    isLoginRateLimited,
    recordLoginFailure,
    recordLoginSuccess
} = require('./auth');

const app = express();

const isProduction = process.env.NODE_ENV === 'production';
// Only ever intended for local development: explicitly opts an unconfigured
// server into serving loopback-only requests instead of a 503. See
// server/auth.js (createAuthMiddleware) for the loopback check that also
// gates this, and server/.env.example for the full warning.
const authDisabled = process.env.AUTH_DISABLED === 'true';

// The app runs behind a reverse proxy (Render's load balancer) in
// production, so the socket's remote address is the proxy, not the real
// client. Trusting exactly one hop tells Express to derive req.ip from the
// rightmost untrusted entry of X-Forwarded-For (i.e. the one the proxy
// itself appended), rather than either using the proxy's own address or
// naively trusting a client-suppliable header value outright. The login rate
// limiter relies on req.ip. AUTH_DISABLED is stricter: auth.js requires both
// req.ip and the actual socket peer to be loopback, covering direct requests
// and a local reverse proxy without trusting either signal alone.
app.set('trust proxy', 1);

// Заголовки безопасности. Ставятся первыми, до всего остального, чтобы
// попасть и на ответы роутов, и на отдачу статики, и на страницы ошибок.
//
// Дефолты helmet берутся как есть - X-Content-Type-Options, Referrer-Policy,
// HSTS и прочее, - а руками задаётся только CSP: политику по умолчанию это
// приложение не переживает, и молча выключить её (contentSecurityPolicy:
// false) значило бы оставить незакрытым ровно то, ради чего helmet и ставят.
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],

            // Скрипты только свои, инлайновых в сборке нет.
            scriptSrc: ["'self'"],

            // 'unsafe-inline' здесь - не небрежность, а состояние
            // интерфейса: в компонентах больше трёхсот атрибутов style={{}}
            // плюс несколько блоков <style> (см. App.jsx,
            // AddTransactionForm.jsx, TransactionsDrawer.jsx), а CSP
            // распространяется и на атрибут style, не только на теги.
            // Убрать это можно, только переписав их на классы; до тех пор
            // ограничение бессмысленно, а остальные директивы работают.
            // Хост Google - из-за двух @import в начале src/index.css.
            styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
            fontSrc: ["'self'", 'https://fonts.gstatic.com'],

            // data: нужен иконкам, которые Vite инлайнит в сборке мелкими.
            imgSrc: ["'self'", 'data:'],

            // Запросы уходят только на свой origin: в проде фронт и API на
            // одном домене, в разработке - через прокси Vite.
            connectSrc: ["'self'"],

            manifestSrc: ["'self'"],
            workerSrc: ["'self'"],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
            // Строже, чем X-Frame-Options: приложение не встраивается никуда.
            frameAncestors: ["'none'"],

            // Только в проде. Локально собранное приложение открывают по
            // http://localhost, и апгрейд до https сломал бы его на ровном
            // месте - включая проверку сборки перед выкатом.
            upgradeInsecureRequests: isProduction ? [] : null
        }
    }
}));

const allowedOrigins = [
    'http://localhost:5173',
    'http://127.0.0.1:5173'
];
if (process.env.RENDER_EXTERNAL_URL) {
    allowedOrigins.push(process.env.RENDER_EXTERNAL_URL);
}

// Middleware
const corsOptionsDelegate = function (req, callback) {
    const origin = req.header('Origin');
    let isAllowed = false;

    if (!origin) {
        isAllowed = true;
    } else if (!isProduction) {
        isAllowed = true;
    } else if (allowedOrigins.indexOf(origin) !== -1) {
        isAllowed = true;
    } else {
        try {
            const originHost = new URL(origin).host;
            const requestHost = req.header('x-forwarded-host') || req.header('host');
            if (originHost === requestHost) {
                isAllowed = true;
            }
        } catch {
            // Invalid URL in origin header
        }
    }

    if (isAllowed) {
        // exposedHeaders: без этого браузер не отдаёт X-Total-Count скрипту
        // при кросс-доменном запросе - в список безопасных по умолчанию он
        // не входит. В проде фронт и API на одном origin, а в разработке
        // запрос идёт через прокси Vite, так что сегодня это на всякий
        // случай; но заголовок без него бесполезен ровно в тот момент,
        // когда понадобится.
        callback(null, { origin: true, credentials: true, exposedHeaders: ['X-Total-Count'] });
    } else {
        // Instead of throwing an Error (which returns a 500 Internal Server Error page),
        // we just disable CORS for this origin, which allows standard browser CORS blocking.
        callback(null, { origin: false });
    }
};
app.use(cors(corsOptionsDelegate));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// Auth gate for the API. Mounted before any route definitions (not after),
// so it can't be bypassed by route ordering. Excludes /api/login (you need
// to be able to reach it while unauthenticated), /api/health (liveness) and
// /api/ready (readiness). See server/auth.js for the fail-closed behavior when
// APP_PASSWORD/SESSION_SECRET are missing or too weak, and for the
// AUTH_DISABLED/loopback-only bypass.
app.use(createAuthMiddleware(authDisabled));

// Readiness is public so an orchestrator can decide whether to route traffic;
// client error reports pass through the auth gate above like business APIs.
app.use('/api', createOperationalRouter({ mongoose }));
app.use('/api/trash', createTrashRouter());
app.use('/api/planned-payments', createPlannedPaymentsRouter());

// ---- Auth ----

app.post('/api/login', (req, res) => {
    const clientIp = req.ip;

    // Rate limit before touching config/credentials at all, so a locked-out
    // IP can't use this endpoint to distinguish "unconfigured server" from
    // "wrong password" either.
    if (isLoginRateLimited(clientIp)) {
        return res.status(429).json({ message: 'Слишком много попыток входа. Попробуйте позже.' });
    }

    const { appPassword, sessionSecret, isConfigured } = getAuthConfig();
    if (!isConfigured) {
        return res.status(503).json({ message: 'Сервер не настроен: отсутствуют переменные окружения APP_PASSWORD/SESSION_SECRET.' });
    }

    const { password } = req.body || {};
    if (!checkPassword(password, appPassword)) {
        recordLoginFailure(clientIp);
        return res.status(401).json({ message: 'Неверный пароль' });
    }

    recordLoginSuccess(clientIp);
    const token = createToken(sessionSecret, appPassword);
    res.cookie(COOKIE_NAME, token, cookieOptions(isProduction, TOKEN_TTL_MS));
    res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
    res.clearCookie(COOKIE_NAME, cookieOptions(isProduction));
    res.json({ ok: true });
});

// ---- Accounts ----

// Get all accounts
app.get('/api/accounts', async (req, res) => {
    try {
        const accounts = await Account.find().sort({ order: 1 });
        res.json(accounts);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Add a new account
app.post('/api/accounts', async (req, res) => {
    try {
        const { name, type, icon, excludeFromTotal } = req.body;
        if (!name || !type) {
            return res.status(400).json({ message: 'Name and type are required' });
        }
        
        // Find max order
        const maxOrder = await Account.findOne().sort({ order: -1 });
        const newAccount = new Account({
            name: name.trim(),
            type,
            icon: icon || (type === 'cash' ? '💵' : '💳'),
            isDefault: false,
            excludeFromTotal: Boolean(excludeFromTotal),
            order: (maxOrder?.order || 0) + 1
        });
        
        const saved = await newAccount.save();
        res.json(saved);
    } catch (err) {
        if (err.code === 11000) {
            return res.status(400).json({ message: 'Счёт с таким именем уже существует' });
        }
        res.status(400).json({ message: err.message });
    }
});

// Update an account
app.put('/api/accounts/:id', async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ message: 'Invalid account ID' });
        }
        const { name, icon, order, excludeFromTotal } = req.body;
        const account = await Account.findById(req.params.id);
        if (!account) {
            return res.status(404).json({ message: 'Account not found' });
        }
        
        if (name) account.name = name.trim();
        if (icon) account.icon = icon;
        if (order !== undefined) account.order = order;
        if (excludeFromTotal !== undefined) account.excludeFromTotal = Boolean(excludeFromTotal);
        
        const saved = await account.save();
        res.json(saved);
    } catch (err) {
        if (err.code === 11000) {
            return res.status(400).json({ message: 'Счёт с таким именем уже существует' });
        }
        res.status(400).json({ message: err.message });
    }
});

// Delete a custom account
app.delete('/api/accounts/:id', async (req, res) => {
    let session;
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ message: 'Invalid account ID' });
        }
        session = await mongoose.startSession();
        let outcome;
        await session.withTransaction(async () => {
            const account = await Account.findById(req.params.id).session(session);
            if (!account) {
                outcome = { status: 404, message: 'Account not found' };
                return;
            }

            const txCount = await Transaction.countDocuments({
                $or: [
                    { account: req.params.id },
                    { toAccount: req.params.id }
                ]
            }).session(session);
            const planCount = await PlannedPayment.countDocuments({ account: req.params.id }).session(session);
            if (txCount > 0) {
                outcome = { status: 400, message: 'Нельзя удалить счёт, по которому есть транзакции' };
                return;
            }
            if (planCount > 0) {
                outcome = { status: 400, message: 'Нельзя удалить счёт, на который ссылаются предстоящие платежи' };
                return;
            }
            await Account.deleteOne({ _id: account._id }, { session });
            outcome = { status: 200 };
        });
        if (outcome.status !== 200) return res.status(outcome.status).json({ message: outcome.message });
        res.json({ message: 'Account deleted' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    } finally {
        if (session) await session.endSession();
    }
});

// ---- Categories ----

// Get all categories
app.get('/api/categories', async (req, res) => {
    try {
        const categories = await Category.find().sort({ type: 1, order: 1 });
        res.json(categories);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Add a new category
app.post('/api/categories', async (req, res) => {
    try {
        const { name, type } = req.body;
        if (!name || !type) {
            return res.status(400).json({ message: 'Name and type are required' });
        }
        // Get max order for this type
        const maxOrder = await Category.findOne({ type }).sort({ order: -1 });
        const newCategory = new Category({
            name: name.trim(),
            type,
            order: (maxOrder?.order || 0) + 1
        });
        const saved = await newCategory.save();
        res.json(saved);
    } catch (err) {
        if (err.code === 11000) {
            return res.status(400).json({ message: 'Такая категория уже существует' });
        }
        res.status(400).json({ message: err.message });
    }
});

// Переименование категории. Операции хранят категорию строкой, а не
// ссылкой на документ, поэтому одного апдейта в коллекции категорий мало:
// историю пришлось бы читать со старым названием, а разбивка по категориям
// разъехалась бы на две. Поэтому вместе с самой категорией переписываются и
// все операции того же типа с прежним названием (тип важен: имя уникально
// только в паре с ним, и одноимённая категория доходов должна остаться
// нетронутой). Заголовок операции не трогаем - это текст, введённый
// пользователем, даже когда он когда-то подставился из названия категории.
app.put('/api/categories/:id', async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ message: 'Invalid category ID' });
        }
        const { name } = req.body;
        if (!name || !String(name).trim()) {
            return res.status(400).json({ message: 'Name is required' });
        }
        const newName = String(name).trim();
        const session = await mongoose.startSession();
        let outcome;
        try {
            await session.withTransaction(async () => {
                const cat = await Category.findById(req.params.id).session(session);
                if (!cat) {
                    outcome = { notFound: true };
                    return;
                }

                const oldName = cat.name;
                if (newName === oldName) {
                    outcome = { category: cat, updatedTransactions: 0 };
                    return;
                }

                cat.name = newName;
                const saved = await cat.save({ session });
                const result = await Transaction.updateMany(
                    { type: cat.type, category: oldName },
                    { $set: { category: newName }, $inc: { __v: 1 } },
                    { session }
                );
                if (cat.type === 'expense') {
                    await PlannedPayment.updateMany(
                        { category: oldName },
                        { $set: { category: newName }, $inc: { __v: 1 } },
                        { session }
                    );
                }
                outcome = {
                    category: saved,
                    updatedTransactions: result.modifiedCount || 0
                };
            });
        } finally {
            await session.endSession();
        }

        if (outcome?.notFound) {
            return res.status(404).json({ message: 'Category not found' });
        }
        res.json(outcome);
    } catch (err) {
        if (err.code === 11000) {
            return res.status(400).json({ message: 'Такая категория уже существует' });
        }
        res.status(500).json({ message: err.message });
    }
});

// Delete a category. Засеянные при первом запуске ничем не отличаются
// от заведённых руками: список категорий - личный, и вычищать из него
// лишнее должно быть можно. Пустой список сидер зальёт заново при
// следующем старте (см. countDocuments выше).
app.delete('/api/categories/:id', async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ message: 'Invalid category ID' });
        }
        const cat = await Category.findById(req.params.id);
        if (!cat) {
            return res.status(404).json({ message: 'Category not found' });
        }
        await Category.findByIdAndDelete(req.params.id);
        res.json({ message: 'Category deleted' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ---- Settings ----
// A single shared document (see server/models/Settings.js) holding
// app-wide settings - currently just monthlyLimit, driving the limit
// progress bar in the stats panel. Stored server-side (rather than per-
// browser) so it's shared across devices.

const DEFAULT_MONTHLY_LIMIT = 7000;

// Get settings. Returns the default rather than 404 when the collection is
// empty. A single legacy document is adopted under the canonical key without
// changing its value; multiple documents fail explicitly instead of picking
// one and silently losing another saved limit.
app.get('/api/settings', async (req, res) => {
    try {
        const settings = await getCanonicalSettings();
        res.json({ monthlyLimit: settings ? settings.monthlyLimit : DEFAULT_MONTHLY_LIMIT });
    } catch (err) {
        if (err.code === 'SETTINGS_INTEGRITY') {
            return res.status(409).json({ message: err.message });
        }
        res.status(500).json({ message: err.message });
    }
});

// Update settings, creating the single document on first save.
//
// monthlyLimit must be a finite, strictly positive number: Number.isNaN
// alone lets through Infinity (e.g. JSON `1e999` parses to Infinity) and 0,
// both of which make the frontend's limit percentage render as NaN% or
// Infinity%. Number.isFinite rules out Infinity/-Infinity/NaN in one check;
// `> 0` rules out zero and negatives. The Settings schema enforces the same
// constraint at the model layer (see server/models/Settings.js) so it can't
// be bypassed by any other write path either.
app.put('/api/settings', async (req, res) => {
    try {
        const { monthlyLimit } = req.body;
        const parsedLimit = Number(monthlyLimit);
        if (monthlyLimit === undefined || monthlyLimit === null || monthlyLimit === '' || !Number.isFinite(parsedLimit) || parsedLimit <= 0) {
            return res.status(400).json({ message: 'Некорректное значение лимита' });
        }

        const saved = await saveCanonicalSettings(parsedLimit);
        res.json(saved);
    } catch (err) {
        if (err.code === 'SETTINGS_INTEGRITY') {
            return res.status(409).json({ message: err.message });
        }
        res.status(400).json({ message: err.message });
    }
});

// ---- Статистика ----
//
// Величины, которые фронтенд до сих пор считал сам из полной истории
// операций. Считаются рядом с базой (см. server/stats.js), чтобы телефону
// не приходилось скачивать всю историю ради двух сводных цифр.
//
// Пока фронтенд их не использует - переход на них меняет весь слой загрузки
// данных в App.jsx и делается отдельно. Тесты (server/stats.test.js)
// сверяют эти ответы с тем, что считает src/utils/finance.js, на одних и тех
// же данных: разойтись в деньгах два экрана одного приложения не имеют
// права.

// Остатки по счетам, по типам счетов, общий капитал и сумма на замороженных
// счетах - всё, из чего собрана карусель капитала в шапке.
app.get('/api/stats/balances', async (req, res) => {
    try {
        const [transactions, accounts] = await Promise.all([
            Transaction.find(activeTransactionFilter()).lean(),
            Account.find().lean()
        ]);
        res.json(computeBalances(transactions, accounts));
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Доход и расход по каждому месяцу истории - то, из чего рисуется лента
// карточек месяцев. Принимает те же фильтры, что и интерфейс: account
// (id счёта либо 'type:card' / 'type:cash') и category.
app.get('/api/stats/monthly', async (req, res) => {
    try {
        const account = typeof req.query.account === 'string' && req.query.account ? req.query.account : null;
        const category = typeof req.query.category === 'string' && req.query.category ? req.query.category : null;

        const [transactions, accounts] = await Promise.all([
            Transaction.find(activeTransactionFilter()).lean(),
            Account.find().lean()
        ]);
        res.json(computeMonthlyTotals(transactions, accounts, { account, category }));
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});


// Все сводные величины главного экрана одним ответом.
//
// Одним, а не восемью отдельными роутами, по двум причинам. Первая: экран
// показывает их вместе, и восемь запросов - это восемь чтений истории и
// восемь шансов, что телефон получит цифры, посчитанные в разные моменты.
// Расхождение в деньгах между соседними блоками одного экрана хуже, чем
// лишний килобайт. Вторая: история читается один раз и преобразуется один
// раз, а не восемь.
//
// Ответ не зависит от размера истории: наружу уходят только итоги, а не
// операции. Список операций отдаётся отдельно и постранично.
//
// today присылает клиент. От него зависят окно сравнения и окно частоты
// категорий, а сервер живёт в UTC: взяв «сегодня» из своих часов, он
// несколько часов в сутки считал бы по другому календарю, чем телефон.
app.get('/api/stats/dashboard', async (req, res) => {
    try {
        const str = (key) => (typeof req.query[key] === 'string' && req.query[key] ? req.query[key] : null);

        const month = str('month') || new Date().toISOString().slice(0, 7);
        const timeRange = str('timeRange') || 'month';
        const account = str('account');
        const category = str('category');
        const type = str('type');
        const today = str('today') || new Date().toISOString().slice(0, 10);
        const seriesMonths = timeRange === 'month' ? 6 : 12;

        if (!/^\d{4}-\d{2}$/.test(month)) {
            return res.status(400).json({ message: 'Некорректное значение month: ожидается YYYY-MM' });
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) {
            return res.status(400).json({ message: 'Некорректное значение today: ожидается YYYY-MM-DD' });
        }

        const [docs, accounts] = await Promise.all([
            Transaction.find(activeTransactionFilter()).lean(),
            Account.find().lean()
        ]);
        const transactions = transformTransactions(docs, accounts);

        // Итоги периода и месяца считаются одной функцией: месячный вид -
        // это тот же период с префиксом месяца. Лимит и прогноз темпа
        // считаются от месячных цифр, какой бы период ни был на экране,
        // поэтому нужны оба.
        const periodTotals = computePeriodData(transactions, periodPrefixOf(timeRange, month), { account, category, type });
        const monthTotals = computePeriodData(transactions, month, { account, category, type });
        const stripList = ({ income, expense, categoryTotals }) => ({ income, expense, categoryTotals });

        res.json({
            balances: computeBalances(docs, accounts),
            monthlyTotals: computeMonthlyTotals(docs, accounts, { account, category }),
            period: stripList(periodTotals),
            month: stripList(monthTotals),
            yearly: computeYearlyData(transactions, month, account, category),
            lifetime: computeLifetimeStats(transactions, '2025-11-09', account, category),
            comparison: computeComparison(transactions, month, today),
            categoryComparison: computeCategoryComparison(transactions, month, today, account),
            monthlySeries: computeMonthlySeries(transactions, month, seriesMonths, account, category),
            categoryUsage: computeCategoryUsage(transactions),
            // Частота считается сразу по обоим типам: форма добавления
            // переключается между расходом и доходом без похода на сервер.
            categoryCounts: {
                expense: computeCategoryCounts(transactions, 'expense', today),
                income: computeCategoryCounts(transactions, 'income', today)
            }
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Поиск по истории. Отдельно от сводки: он идёт от набора в строке поиска,
// а не от выбранного периода, и запрашивается только когда в строке
// что-то есть.
app.get('/api/search', async (req, res) => {
    try {
        const str = (key) => (typeof req.query[key] === 'string' && req.query[key] ? req.query[key] : null);
        const query = str('q');
        if (!query) {
            return res.json({ transactions: {}, count: 0 });
        }

        const [docs, accounts] = await Promise.all([
            Transaction.find(activeTransactionFilter()).lean(),
            Account.find().lean()
        ]);
        const transactions = transformTransactions(docs, accounts);

        res.json(computeSearchResults(transactions, query, str('account'), str('category'), str('type')));
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Частые комментарии для категории - подсказки под полем описания в форме.
app.get('/api/suggestions/descriptions', async (req, res) => {
    try {
        const str = (key) => (typeof req.query[key] === 'string' && req.query[key] ? req.query[key] : null);
        const category = str('category');
        if (!category) {
            return res.json([]);
        }

        const [docs, accounts] = await Promise.all([
            Transaction.find(activeTransactionFilter()).lean(),
            Account.find().lean()
        ]);
        const transactions = transformTransactions(docs, accounts);

        res.json(computeDescriptionSuggestions(transactions, category, str('type')));
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ---- Transactions ----

// Get transactions.
//
// Без параметров ведёт себя ровно как раньше - вся история одним массивом по
// убыванию даты, - но принимает период (from/to) и постраничную выборку
// (limit/skip); разбор и проверка параметров в server/transactionQuery.js.
// Сортировка совпадает с индексом { date: -1 } из модели, поэтому берётся
// из него, а не выполняется в памяти после выборки.
//
// Форма ответа не меняется от наличия параметров - это всегда массив, - а
// общее число подходящих операций уезжает отдельным заголовком
// X-Total-Count: клиенту нужно знать, сколько всего страниц, но менять из-за
// этого тип тела ответа значило бы ломать всех, кто уже читает массив.
app.get('/api/transactions', async (req, res) => {
    try {
        const { error, filter, limit, skip } = parseTransactionQuery(req.query);
        if (error) {
            return res.status(400).json({ message: error });
        }

        // Ответ только сериализуется и не меняется через методы документа,
        // поэтому hydration Mongoose здесь не нужна. lean сохраняет форму
        // JSON, сортировку и пагинацию, уменьшая накладные расходы выборки.
        const activeFilter = activeTransactionFilter(filter);
        let query = Transaction.find(activeFilter).sort({ date: -1 }).lean();
        if (skip > 0) query = query.skip(skip);
        if (limit !== null) query = query.limit(limit);

        const transactions = await query;

        // Лишний запрос в базу нужен только когда выдача урезана: иначе
        // общее число - это длина уже полученного массива.
        const total = (limit !== null || skip > 0)
            ? await Transaction.countDocuments(activeFilter)
            : transactions.length;
        res.set('X-Total-Count', String(total));

        res.json(transactions);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Add transaction
app.post('/api/transactions', async (req, res) => {
    try {
        // Handle batch insert for split transactions
        if (Array.isArray(req.body)) {
            const transactions = req.body;
            if (transactions.length === 0) {
                return res.status(400).json({ message: 'Batch must contain at least one transaction' });
            }

            // Пакет проходит ту же строгую нормализацию, что одиночная
            // операция: иначе отрицательная сумма или пустой счёт могли
            // попасть в split только потому, что выбран другой endpoint.
            const sanitizedTransactions = [];
            for (const tx of transactions) {
                const { error, transaction } = validateTransactionCreate(tx, { allowSplitId: true });
                if (error) return res.status(400).json({ message: error });
                sanitizedTransactions.push(transaction);
            }

            const accountCheck = await validateAccountReferences(
                sanitizedTransactions.flatMap(transaction => [transaction.account, transaction.toAccount])
            );
            if (accountCheck.error) return res.status(400).json({ message: accountCheck.error });

            const savedTransactions = await Transaction.insertMany(sanitizedTransactions);
            return res.json(savedTransactions);
        }

        const { error, transaction } = validateTransactionCreate(req.body);
        if (error) return res.status(400).json({ message: error });
        const accountCheck = await validateAccountReferences([transaction.account, transaction.toAccount]);
        if (accountCheck.error) return res.status(400).json({ message: accountCheck.error });

        const newTransaction = new Transaction(transaction);

        const savedTransaction = await newTransaction.save();
        res.json(savedTransaction);
    } catch (err) {
        console.error('POST Error:', err.message);
        res.status(400).json({ message: err.message });
    }
});

// Update transaction.
//
// Тело запроса проверяется и приводится к типам до записи (см.
// server/transactionInput.js), а условный findOneAndUpdate вызывается с
// runValidators: true и ожидаемой версией снимка. Раньше не было ни того,
// ни другого: значения из
// запроса уходили в базу как есть, а findByIdAndUpdate схему по умолчанию
// не применяет - в результате через PUT можно было записать type вне enum
// модели, нулевую сумму или нечитаемую дату, хотя POST рядом всё это
// отсекал (он создаёт документ через save(), а тот валидацию выполняет).
app.put('/api/transactions/:id', async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ message: 'Invalid transaction ID' });
        }

        const currentTransaction = await Transaction.findById(req.params.id);
        if (!currentTransaction) {
            return res.status(404).json({ message: 'Transaction not found' });
        }
        if (currentTransaction.deletedAt) {
            return res.status(409).json({ message: 'Операция находится в корзине и не может быть изменена' });
        }

        const { error: versionError, expectedVersion } = validateTransactionVersion(req.body);
        if (versionError) {
            return res.status(400).json({ message: versionError });
        }

        const currentVersion = Number.isInteger(currentTransaction.__v) ? currentTransaction.__v : 0;
        if (expectedVersion !== currentVersion) {
            return res.status(409).json({ message: 'Операция уже была изменена. Обновите данные и повторите попытку.' });
        }

        const { error, update, unset } = validateTransactionUpdate(req.body, currentTransaction);
        if (error) {
            return res.status(400).json({ message: error });
        }
        if (update.account !== undefined || update.toAccount !== undefined) {
            const accountCheck = await validateAccountReferences([
                update.account !== undefined ? update.account : currentTransaction.account,
                update.toAccount !== undefined ? update.toAccount : currentTransaction.toAccount
            ]);
            if (accountCheck.error) return res.status(400).json({ message: accountCheck.error });
        }

        if (update.type !== undefined && update.type !== 'expense') {
            const linked = await PlannedPayment.exists({ transactionId: currentTransaction._id, status: 'paid' });
            if (linked) {
                return res.status(409).json({ message: 'Связанный с платежом расход нельзя изменить на другой тип' });
            }
        }

        // $set и $unset собираются явно, а не отдаются на автоматическое
        // оборачивание mongoose: оно надёжно только пока в документе
        // обновления нет ни одного оператора. Пустой $set при этом не
        // отправляется вовсе - MongoDB такой документ отвергает.
        const mongoUpdate = {};
        if (Object.keys(update).length > 0) {
            mongoUpdate.$set = update;
        }
        if (unset.length > 0) {
            mongoUpdate.$unset = Object.fromEntries(unset.map(field => [field, '']));
        }
        mongoUpdate.$inc = { __v: 1 };

        const versionFilter = expectedVersion === 0
            ? {
                _id: req.params.id,
                deletedAt: null,
                $or: [{ __v: 0 }, { __v: { $exists: false } }]
            }
            : { _id: req.params.id, __v: expectedVersion, deletedAt: null };

        const updatedTransaction = await Transaction.findOneAndUpdate(
            versionFilter,
            mongoUpdate,
            { new: true, runValidators: true }
        );
        if (!updatedTransaction) {
            const stillExists = await Transaction.exists({ _id: req.params.id });
            if (!stillExists) {
                return res.status(404).json({ message: 'Transaction not found' });
            }
            return res.status(409).json({ message: 'Операция уже была изменена. Обновите данные и повторите попытку.' });
        }
        res.json(updatedTransaction);
    } catch (err) {
        console.error('PUT Error:', err.message);
        res.status(400).json({ message: err.message });
    }
});

// Delete transaction
app.delete('/api/transactions/:id', async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ message: 'Invalid transaction ID' });
        }
        const { splitId } = req.query;
        if (splitId !== undefined && typeof splitId !== 'string') {
            return res.status(400).json({ message: 'Invalid splitId' });
        }
        res.json(await softDeleteTransaction(req.params.id, splitId));
    } catch (err) {
        res.status(err.status || 500).json({ message: err.message });
    }
});




// Registered before the production static-serving / SPA catch-all below.
// That catch-all (`app.get('*', ...)`) matches every unmatched GET, so if
// this route were registered after it (as it used to be), Express would
// never reach it in production - /api/health would silently return
// index.html instead of JSON, which is exactly what was happening against
// the live deployment (and why the Render self-ping below and any host
// health check were only ever proving the static files were served, not
// that the API process was healthy).
app.get('/api/health', (req, res) => {
    res.status(200).json(buildHealthPayload());
});

// Serve static assets in production
if (process.env.NODE_ENV === 'production') {
    const fs = require('fs');
    const distPath = path.resolve(__dirname, '..', 'dist');

    if (fs.existsSync(distPath)) {
        console.log(`✅ Dist folder found at: ${distPath}`);
        try {
            const files = fs.readdirSync(distPath);
            console.log(`Files in dist: ${files.join(', ')}`);
        } catch (e) { console.error('Error reading dist:', e.message); }

        // Hashed assets (JS/CSS) — cache forever (filename changes on each build)
        app.use('/assets', express.static(path.join(distPath, 'assets'), {
            maxAge: '1y',
            immutable: true
        }));

        // All other static files (favicon, etc.) — short cache
        app.use(express.static(distPath, {
            maxAge: '1h',
            setHeaders: (res, filePath) => {
                // Never cache index.html even if requested directly.
                //
                // sw.js - по той же причине, но следствия у неё другие:
                // браузер сверяет воркер с сервером при каждом заходе, и
                // час кеша означал бы, что после выката пользователь до часа
                // сидит под старым воркером. Имя файла при этом не
                // хешируется (адрес /sw.js зафиксирован в регистрации), так
                // что отличить новую версию по адресу нельзя.
                if (filePath.endsWith('.html') || filePath.endsWith('sw.js')) {
                    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
                    res.setHeader('Pragma', 'no-cache');
                    res.setHeader('Expires', '0');
                }
            }
        }));

        // SPA fallback — always serve fresh index.html with no-cache headers
        app.get('*', (req, res) => {
            const indexPath = path.join(distPath, 'index.html');
            if (fs.existsSync(indexPath)) {
                res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
                res.setHeader('Pragma', 'no-cache');
                res.setHeader('Expires', '0');
                res.sendFile(indexPath);
            } else {
                console.error(`❌ index.html not found in dist: ${indexPath}`);
                res.status(404).send('index.html not found');
            }
        });
    } else {
        console.error(`❌ Dist folder NOT FOUND at: ${distPath}`);
    }
}

module.exports = app;
