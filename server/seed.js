const Transaction = require('./models/Transaction');
const Category = require('./models/Category');
const Account = require('./models/Account');

// Первичное наполнение пустой базы. Раньше жило прямо в .then() у
// mongoose.connect в index.js и поэтому не могло быть ни вызвано отдельно,
// ни проверено тестом: любой импорт сервера сеял базу как побочный эффект.
//
// Каждый шаг идемпотентен и срабатывает только на пустоте - функция
// вызывается при каждом старте сервера, а не один раз при разворачивании.

const DEFAULT_ACCOUNTS = [
    { name: 'Мой Revolut', type: 'card', icon: '💳', isDefault: true, order: 1 },
    { name: 'Жена BOC', type: 'card', icon: '💳', isDefault: true, order: 2 },
    { name: 'Жена Revolut', type: 'card', icon: '💳', isDefault: true, order: 3 },
    { name: 'Наличные', type: 'cash', icon: '💵', isDefault: true, order: 4 }
];

const DEFAULT_CATEGORIES = [
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

const INITIAL_BALANCE = {
    title: 'Стартовый баланс',
    amount: 5650,
    type: 'initial',
    category: 'Другое',
    description: 'Стартовый баланс',
    date: '2025-11-09'
};

// Одноразовая миграция: до появления коллекции счетов операции хранили в
// account/toAccount не идентификатор, а литералы 'card' и 'cash'. Запускается
// только вместе с засевом счетов, то есть на базе, где счетов ещё не было -
// после первого прохода таких операций уже не остаётся.
async function migrateLegacyAccountLiterals(accounts, log) {
    const cardAccount = accounts.find(a => a.name === 'Жена BOC');
    const cashAccount = accounts.find(a => a.name === 'Наличные');
    if (!cardAccount || !cashAccount) return null;

    log('⏳ Running migration for existing transactions...');

    // Последовательно, как и было до выделения в модуль: четыре апдейта
    // задевают одни и те же документы (у перевода мигрируют оба поля), и
    // раскладывать их в Promise.all ради миграции, которая выполняется
    // один раз в жизни базы, - менять проверенное на непроверенное.
    const account = await Transaction.updateMany({ account: 'card' }, { account: cardAccount._id.toString() });
    const cash = await Transaction.updateMany({ account: 'cash' }, { account: cashAccount._id.toString() });
    const toAccount = await Transaction.updateMany({ toAccount: 'card' }, { toAccount: cardAccount._id.toString() });
    const toCash = await Transaction.updateMany({ toAccount: 'cash' }, { toAccount: cashAccount._id.toString() });

    const migrated = {
        account: account.modifiedCount,
        cash: cash.modifiedCount,
        toAccount: toAccount.modifiedCount,
        toCash: toCash.modifiedCount
    };

    log('✅ Migration complete!');
    log(`  Updated account: 'card' -> 'Жена BOC' ID: ${migrated.account} docs`);
    log(`  Updated account: 'cash' -> 'Наличные' ID: ${migrated.cash} docs`);
    log(`  Updated toAccount: 'card' -> 'Жена BOC' ID: ${migrated.toAccount} docs`);
    log(`  Updated toAccount: 'cash' -> 'Наличные' ID: ${migrated.toCash} docs`);

    return migrated;
}

// Возвращает отчёт о том, что было создано, - вызывающему это нужно только
// для лога, но по нему же тест видит, что второй прогон ничего не тронул.
async function seedDefaults({ log = console.log } = {}) {
    const report = { accounts: 0, categories: 0, initialBalance: false, migrated: null };

    // 1. Счета по умолчанию, если счетов нет вовсе
    let accounts = await Account.find();
    if (accounts.length === 0) {
        accounts = await Account.insertMany(DEFAULT_ACCOUNTS);
        report.accounts = accounts.length;
        log('Default accounts seeded');
        report.migrated = await migrateLegacyAccountLiterals(accounts, log);
    }

    // 2. Стартовый баланс, если его ещё не заводили
    const initialExists = await Transaction.findOne({ type: 'initial' });
    if (!initialExists) {
        const cashAccount = await Account.findOne({ name: 'Наличные' });
        await new Transaction({
            ...INITIAL_BALANCE,
            account: cashAccount ? cashAccount._id.toString() : 'cash'
        }).save();
        report.initialBalance = true;
        log('Initial balance seeded');
    }

    // 3. Категории по умолчанию, если список пуст. Пустым он может стать и
    // намеренно - категории разрешено удалять все до одной, - и тогда при
    // следующем старте сервер зальёт стандартный набор заново.
    const categoryCount = await Category.countDocuments();
    if (categoryCount === 0) {
        await Category.insertMany(DEFAULT_CATEGORIES);
        report.categories = DEFAULT_CATEGORIES.length;
        log('Default categories seeded');
    }

    return report;
}

module.exports = {
    seedDefaults,
    DEFAULT_ACCOUNTS,
    DEFAULT_CATEGORIES,
    INITIAL_BALANCE
};
