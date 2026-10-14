// База для оценки: временный mongod в памяти с данными из fixtures.js.
//
// Роутеры (ask.js, quickEntry.js) читают Mongo через свои defaultLoadContext,
// поэтому оценка идёт по настоящему пути загрузки, а не по подставленному
// loadContext. Подключение одно на процесс (mongoose-синглтон), как в приложении.

const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

// Бинарник вне node_modules, как в server/test/globalSetup.js: тот же кэш
// используют тесты, и повторная загрузка (~780 МБ) не нужна.
process.env.MONGOMS_DOWNLOAD_DIR ||= path.join(REPO_ROOT, '.cache', 'mongodb-binaries');

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Account = require('../models/Account');
const Category = require('../models/Category');
const Company = require('../models/Company');
const Transaction = require('../models/Transaction');
const MonthReview = require('../models/MonthReview');
const { saveCanonicalSettings } = require('../settingsSingleton');
const { activeTransactionFilter } = require('../ledgerState');
const { prepareData } = require('../askTools');
const { buildFixtures, MONTHLY_LIMIT } = require('./fixtures');

async function startEvalDb() {
    // Первый запуск может качать mongod несколько минут; дальше берётся из кэша.
    const server = await MongoMemoryServer.create({ instance: { launchTimeout: 120_000 } });
    await mongoose.connect(server.getUri(), { dbName: 'budget_eval' });
    // Уникальные индексы строятся асинхронно: до их готовности дубликат записался бы молча.
    await Promise.all(Object.values(mongoose.models).map(model => model.init()));

    const fixtures = buildFixtures();
    await Account.insertMany(fixtures.accounts);
    await Category.insertMany(fixtures.categories);
    await Company.insertMany(fixtures.companies);
    await Transaction.insertMany(fixtures.transactions, { ordered: true });
    // Месячный лимит, как его сохранило бы приложение (единственный документ настроек).
    await saveCanonicalSettings(MONTHLY_LIMIT);

    return {
        fixtures,
        async stop() {
            await mongoose.disconnect();
            await server.stop();
        }
    };
}

// Те же три запроса, что у ask.js defaultLoadContext: ожидаемые ответы
// считаются из тех же данных, которые видит приложение, а не из фикстур
// напрямую (иначе мы проверяли бы фикстуры, а не путь через базу).
async function loadAskContext() {
    const [docs, accounts, categories] = await Promise.all([
        Transaction.find(activeTransactionFilter()).lean(),
        Account.find().sort({ order: 1 }).lean(),
        Category.find().sort({ type: 1, order: 1 }).lean()
    ]);
    return { docs, accounts, categories };
}

async function loadAskData(today) {
    return prepareData({ ...(await loadAskContext()), today });
}

// Сохранённые разборы месяца стираются между прогонами, чтобы каждый заново шёл в Claude.
async function clearMonthReviews() {
    await MonthReview.deleteMany({});
}

module.exports = { startEvalDb, loadAskData, loadAskContext, clearMonthReviews };
