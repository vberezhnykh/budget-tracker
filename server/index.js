const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const Transaction = require('./models/Transaction');
const Category = require('./models/Category');
const Account = require('./models/Account');
const Settings = require('./models/Settings');
const { validateTransactionUpdate } = require('./transactionInput');
const { parseTransactionQuery } = require('./transactionQuery');
const { computeBalances, computeMonthlyTotals } = require('./stats');
const {
    COOKIE_NAME,
    TOKEN_TTL_MS,
    checkPassword,
    createToken,
    getAuthConfig,
    buildHealthPayload,
    cookieOptions,
    createAuthMiddleware,
    logStartupConfigStatus,
    isLoginRateLimited,
    recordLoginFailure,
    recordLoginSuccess
} = require('./auth');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

const isProduction = process.env.NODE_ENV === 'production';
// Only ever intended for local development: explicitly opts an unconfigured
// server into serving loopback-only requests instead of a 503. See
// server/auth.js (createAuthMiddleware) for the loopback check that also
// gates this, and server/.env.example for the full warning.
const authDisabled = process.env.AUTH_DISABLED === 'true';
logStartupConfigStatus(isProduction, authDisabled);

// The app runs behind a reverse proxy (Render's load balancer) in
// production, so the socket's remote address is the proxy, not the real
// client. Trusting exactly one hop tells Express to derive req.ip from the
// rightmost untrusted entry of X-Forwarded-For (i.e. the one the proxy
// itself appended), rather than either using the proxy's own address or
// naively trusting a client-suppliable header value outright. This is what
// both the login rate limiter and the AUTH_DISABLED loopback check rely on
// for req.ip to mean "the actual caller".
app.set('trust proxy', 1);

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
// to be able to reach it while unauthenticated) and /api/health (used by
// uptime pings). See server/auth.js for the fail-closed behavior when
// APP_PASSWORD/SESSION_SECRET are missing or too weak, and for the
// AUTH_DISABLED/loopback-only bypass.
app.use(createAuthMiddleware(authDisabled));

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

// Database Connection
const dbOptions = !isProduction ? { dbName: 'budget-tracker-dev' } : {};

mongoose.connect(process.env.MONGODB_URI, dbOptions)
    .then(async () => {
        console.log(`MongoDB Connected (${isProduction ? 'Production' : 'Development: budget-tracker-dev'})`);
        
        // 1. Seed default accounts if none exist
        let accounts = await Account.find();
        if (accounts.length === 0) {
            const defaultAccounts = [
                { name: 'Мой Revolut', type: 'card', icon: '💳', isDefault: true, order: 1 },
                { name: 'Жена BOC', type: 'card', icon: '💳', isDefault: true, order: 2 },
                { name: 'Жена Revolut', type: 'card', icon: '💳', isDefault: true, order: 3 },
                { name: 'Наличные', type: 'cash', icon: '💵', isDefault: true, order: 4 }
            ];
            accounts = await Account.insertMany(defaultAccounts);
            console.log('Default accounts seeded');

            // --- DATA MIGRATION ---
            // Map old hardcoded 'card' and 'cash' strings to the new database account IDs
            const cardAccount = accounts.find(a => a.name === 'Жена BOC');
            const cashAccount = accounts.find(a => a.name === 'Наличные');

            if (cardAccount && cashAccount) {
                console.log('⏳ Running migration for existing transactions...');
                
                // Migrate transactions where account is 'card' or 'cash'
                const migrateAccountRes = await Transaction.updateMany(
                    { account: 'card' },
                    { account: cardAccount._id.toString() }
                );
                const migrateCashRes = await Transaction.updateMany(
                    { account: 'cash' },
                    { account: cashAccount._id.toString() }
                );
                
                // Migrate transactions where toAccount is 'card' or 'cash'
                const migrateToAccountRes = await Transaction.updateMany(
                    { toAccount: 'card' },
                    { toAccount: cardAccount._id.toString() }
                );
                const migrateToCashRes = await Transaction.updateMany(
                    { toAccount: 'cash' },
                    { toAccount: cashAccount._id.toString() }
                );

                console.log(`✅ Migration complete!`);
                console.log(`  Updated account: 'card' -> 'Жена BOC' ID: ${migrateAccountRes.modifiedCount} docs`);
                console.log(`  Updated account: 'cash' -> 'Наличные' ID: ${migrateCashRes.modifiedCount} docs`);
                console.log(`  Updated toAccount: 'card' -> 'Жена BOC' ID: ${migrateToAccountRes.modifiedCount} docs`);
                console.log(`  Updated toAccount: 'cash' -> 'Наличные' ID: ${migrateToCashRes.modifiedCount} docs`);
            }
        }

        // 2. Seed initial balance if not exists
        const initialExists = await Transaction.findOne({ type: 'initial' });
        if (!initialExists) {
            const cashAccount = await Account.findOne({ name: 'Наличные' });
            const initialBalance = new Transaction({
                title: "Стартовый баланс",
                amount: 5650,
                type: "initial",
                category: "Другое",
                description: "Стартовый баланс",
                account: cashAccount ? cashAccount._id.toString() : "cash",
                date: "2025-11-09"
            });
            await initialBalance.save();
            console.log('Initial balance seeded');
        }

        // 3. Seed default categories if none exist
        const categoryCount = await Category.countDocuments();
        if (categoryCount === 0) {
            const defaultCategories = [
                // Expense categories
                { name: 'Продукты', type: 'expense', order: 1 },
                { name: 'Еда вне дома', type: 'expense', order: 2 },
                { name: 'Транспорт', type: 'expense', order: 3 },
                { name: 'Развлечения', type: 'expense', order: 4 },
                { name: 'Шопинг', type: 'expense', order: 5 },
                { name: 'Красота', type: 'expense', order: 6 },
                { name: 'Жилье', type: 'expense', order: 7 },
                { name: 'Питомцы', type: 'expense', order: 8 },
                { name: 'Услуги', type: 'expense', order: 9 },
                { name: 'Отпуск', type: 'expense', order: 10 },
                { name: 'Другое', type: 'expense', order: 11 },
                // Income categories
                { name: 'Зарплата', type: 'income', order: 1 },
                { name: 'Фриланс', type: 'income', order: 2 },
                { name: 'Подарок', type: 'income', order: 3 },
                { name: 'Кэшбэк', type: 'income', order: 4 },
                { name: 'Другое', type: 'income', order: 5 },
            ];
            await Category.insertMany(defaultCategories);
            console.log('Default categories seeded');
        }
    })
    .catch(err => console.log(err));

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
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ message: 'Invalid account ID' });
        }
        const account = await Account.findById(req.params.id);
        if (!account) {
            return res.status(404).json({ message: 'Account not found' });
        }
        
        // Check if there are any transactions associated with this account
        const txCount = await Transaction.countDocuments({
            $or: [
                { account: req.params.id },
                { toAccount: req.params.id }
            ]
        });
        
        if (txCount > 0) {
            return res.status(400).json({ message: 'Нельзя удалить счёт, по которому есть транзакции' });
        }
        
        await Account.findByIdAndDelete(req.params.id);
        res.json({ message: 'Account deleted' });
    } catch (err) {
        res.status(500).json({ message: err.message });
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
        const cat = await Category.findById(req.params.id);
        if (!cat) {
            return res.status(404).json({ message: 'Category not found' });
        }

        const newName = String(name).trim();
        const oldName = cat.name;
        if (newName === oldName) {
            return res.json({ category: cat, updatedTransactions: 0 });
        }

        cat.name = newName;
        const saved = await cat.save();

        const result = await Transaction.updateMany(
            { type: cat.type, category: oldName },
            { $set: { category: newName } }
        );

        res.json({ category: saved, updatedTransactions: result.modifiedCount || 0 });
    } catch (err) {
        if (err.code === 11000) {
            return res.status(400).json({ message: 'Такая категория уже существует' });
        }
        res.status(400).json({ message: err.message });
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

// Get settings. Returns the default rather than 404/erroring when no
// document exists yet, so an existing database keeps working untouched -
// the document is only created the first time someone saves a new value.
app.get('/api/settings', async (req, res) => {
    try {
        const settings = await Settings.findOne();
        res.json({ monthlyLimit: settings ? settings.monthlyLimit : DEFAULT_MONTHLY_LIMIT });
    } catch (err) {
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

        // Atomic upsert instead of findOne + new Settings(...): the previous
        // read-then-write was not atomic, so two concurrent first writes
        // could each find no document and each create one, leaving two
        // singleton documents behind (a later read would then pick an
        // arbitrary one). findOneAndUpdate with upsert performs the
        // find-or-create as a single atomic operation at the database level.
        // runValidators re-applies the schema validation above (which
        // findOneAndUpdate skips by default) so the model-level constraint
        // still holds on this write path.
        const saved = await Settings.findOneAndUpdate(
            {},
            { monthlyLimit: parsedLimit },
            { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
        );
        res.json(saved);
    } catch (err) {
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
            Transaction.find().lean(),
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
            Transaction.find().lean(),
            Account.find().lean()
        ]);
        res.json(computeMonthlyTotals(transactions, accounts, { account, category }));
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

        let query = Transaction.find(filter).sort({ date: -1 });
        if (skip > 0) query = query.skip(skip);
        if (limit !== null) query = query.limit(limit);

        const transactions = await query;

        // Лишний запрос в базу нужен только когда выдача урезана: иначе
        // общее число - это длина уже полученного массива.
        const total = (limit !== null || skip > 0)
            ? await Transaction.countDocuments(filter)
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

            // Basic validation and sanitization for each item
            const sanitizedTransactions = [];
            for (const tx of transactions) {
                if (!tx.amount || (!tx.category && tx.type !== 'transfer')) {
                    return res.status(400).json({ message: 'Amount and category are required for all items' });
                }
                sanitizedTransactions.push({
                    title: tx.title || tx.category,
                    amount: Number(tx.amount),
                    type: String(tx.type),
                    category: tx.category ? String(tx.category) : undefined,
                    description: tx.description ? String(tx.description) : undefined,
                    account: String(tx.account),
                    toAccount: tx.toAccount ? String(tx.toAccount) : undefined,
                    date: String(tx.date),
                    splitId: tx.splitId ? String(tx.splitId) : undefined,
                    excludeFromStats: Boolean(tx.excludeFromStats)
                });
            }

            const savedTransactions = await Transaction.insertMany(sanitizedTransactions);
            return res.json(savedTransactions);
        }

        const { title, amount, type, category, description, account, toAccount, date, excludeFromStats } = req.body;

        // Validate required fields
        if (!amount || (!category && type !== 'transfer')) {
            return res.status(400).json({ message: 'Amount and category are required' });
        }

        const newTransaction = new Transaction({
            title: title || category,
            amount: Number(amount),
            type: String(type),
            category: category ? String(category) : undefined,
            description: description ? String(description) : undefined,
            account: String(account),
            toAccount: toAccount ? String(toAccount) : undefined,
            date: String(date),
            excludeFromStats: Boolean(excludeFromStats)
        });

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
// server/transactionInput.js), а findByIdAndUpdate вызывается с
// runValidators: true. Раньше не было ни того, ни другого: значения из
// запроса уходили в базу как есть, а findByIdAndUpdate схему по умолчанию
// не применяет - в результате через PUT можно было записать type вне enum
// модели, нулевую сумму или нечитаемую дату, хотя POST рядом всё это
// отсекал (он создаёт документ через save(), а тот валидацию выполняет).
app.put('/api/transactions/:id', async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ message: 'Invalid transaction ID' });
        }

        const { error, update, unset } = validateTransactionUpdate(req.body);
        if (error) {
            return res.status(400).json({ message: error });
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

        const updatedTransaction = await Transaction.findByIdAndUpdate(
            req.params.id,
            mongoUpdate,
            { new: true, runValidators: true }
        );
        if (!updatedTransaction) {
            return res.status(404).json({ message: 'Transaction not found' });
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
        if (splitId) {
            await Transaction.deleteMany({ splitId: String(splitId) });
        } else {
            const deleted = await Transaction.findByIdAndDelete(req.params.id);
            if (!deleted) {
                return res.status(404).json({ message: 'Transaction not found' });
            }
        }
        res.json({ message: 'Transaction deleted' });
    } catch (err) {
        res.status(500).json({ message: err.message });
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
                // Never cache index.html even if requested directly
                if (filePath.endsWith('.html')) {
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

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);

    // Prevention of Render's "Sleep" mode
    const url = process.env.RENDER_EXTERNAL_URL;
    if (url) {
        console.log(`Setting up self-ping for ${url}`);
        setInterval(() => {
            fetch(`${url}/api/health`)
                .then(res => {
                    if (res.ok) console.log('Self-ping successful');
                    else console.error('Self-ping returned error status');
                })
                .catch(err => console.error('Self-ping failed:', err.message));
        }, 14 * 60 * 1000); // Every 14 minutes
    }
});
