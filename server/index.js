const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const Transaction = require('./models/Transaction');
const Category = require('./models/Category');
const Account = require('./models/Account');
const {
    COOKIE_NAME,
    TOKEN_TTL_MS,
    checkPassword,
    createToken,
    getAuthConfig,
    buildHealthPayload,
    cookieOptions,
    createAuthMiddleware,
    logStartupConfigStatus
} = require('./auth');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

const isProduction = process.env.NODE_ENV === 'production';
logStartupConfigStatus(isProduction);
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
        } catch (e) {
            // Invalid URL in origin header
        }
    }

    if (isAllowed) {
        callback(null, { origin: true, credentials: true });
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
// uptime pings). See server/auth.js for the fail-closed/fail-open behavior
// when APP_PASSWORD/SESSION_SECRET are missing.
app.use(createAuthMiddleware(isProduction));

// ---- Auth ----

app.post('/api/login', (req, res) => {
    const { appPassword, sessionSecret, isConfigured } = getAuthConfig();
    if (!isConfigured) {
        return res.status(503).json({ message: 'Сервер не настроен: отсутствуют переменные окружения APP_PASSWORD/SESSION_SECRET.' });
    }

    const { password } = req.body || {};
    if (!checkPassword(password, appPassword)) {
        return res.status(401).json({ message: 'Неверный пароль' });
    }

    const token = createToken(sessionSecret);
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
                { name: 'Продукты', type: 'expense', isDefault: true, order: 1 },
                { name: 'Еда вне дома', type: 'expense', isDefault: true, order: 2 },
                { name: 'Транспорт', type: 'expense', isDefault: true, order: 3 },
                { name: 'Развлечения', type: 'expense', isDefault: true, order: 4 },
                { name: 'Шопинг', type: 'expense', isDefault: true, order: 5 },
                { name: 'Красота', type: 'expense', isDefault: true, order: 6 },
                { name: 'Жилье', type: 'expense', isDefault: true, order: 7 },
                { name: 'Питомцы', type: 'expense', isDefault: true, order: 8 },
                { name: 'Услуги', type: 'expense', isDefault: true, order: 9 },
                { name: 'Отпуск', type: 'expense', isDefault: true, order: 10 },
                { name: 'Другое', type: 'expense', isDefault: true, order: 11 },
                // Income categories
                { name: 'Зарплата', type: 'income', isDefault: true, order: 1 },
                { name: 'Фриланс', type: 'income', isDefault: true, order: 2 },
                { name: 'Подарок', type: 'income', isDefault: true, order: 3 },
                { name: 'Кэшбэк', type: 'income', isDefault: true, order: 4 },
                { name: 'Другое', type: 'income', isDefault: true, order: 5 },
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
        const { name, type, icon } = req.body;
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
        const { name, icon, order } = req.body;
        const account = await Account.findById(req.params.id);
        if (!account) {
            return res.status(404).json({ message: 'Account not found' });
        }
        
        if (name) account.name = name.trim();
        if (icon) account.icon = icon;
        if (order !== undefined) account.order = order;
        
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
            isDefault: false,
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

// Delete a custom category
app.delete('/api/categories/:id', async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ message: 'Invalid category ID' });
        }
        const cat = await Category.findById(req.params.id);
        if (!cat) {
            return res.status(404).json({ message: 'Category not found' });
        }
        if (cat.isDefault) {
            return res.status(400).json({ message: 'Нельзя удалить стандартную категорию' });
        }
        await Category.findByIdAndDelete(req.params.id);
        res.json({ message: 'Category deleted' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ---- Transactions ----

// Get all transactions
app.get('/api/transactions', async (req, res) => {
    try {
        const transactions = await Transaction.find().sort({ date: -1 });
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

// Update transaction
app.put('/api/transactions/:id', async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ message: 'Invalid transaction ID' });
        }
        const { title, amount, type, category, description, account, toAccount, date, excludeFromStats } = req.body;
        const updatedTransaction = await Transaction.findByIdAndUpdate(
            req.params.id,
            { title, amount, type, category, description, account, toAccount, date, excludeFromStats },
            { new: true }
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
