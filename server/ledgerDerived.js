// Производные от снимка кэша (server/ledgerCache.js), которые не зависят от
// параметров запроса, и готовые тела справочников.
//
// Зачем. После простоя первый запрос сводки считал её с нуля, а на слабом
// процессоре Koyeb расчёт идёт в 20-40 раз медленнее, чем на ноутбуке. Больше
// трёх четвертей этого времени уходило на величины, которые от параметров
// сводки (месяц, счёт, период, «сегодня») не зависят вовсе: приведение всех
// операций к расчётному виду (transformTransactions), остатки, остатки на конец
// месяцев, итоги по месяцам для всех счетов, счётчик использования категорий.
// Они меняются только вместе с данными, то есть вместе с версией снимка.
// Поэтому считаются один раз на снимок и дальше только читаются - и сводкой
// для любого месяца и счёта, и историей, поиском, подсказками.
//
// Привязка к снимку через WeakMap по самому объекту снимка: новый снимок (запись,
// фоновое обновление с изменившимися данными) - новый объект, а значит и пустые
// производные; старый снимок вместе с ними собирает сборщик мусора. Ничего
// чистить вручную не нужно, и устаревший результат выдать некому.
//
// Результаты общие для всех запросов, поэтому менять их нельзя - как и сам
// снимок. Потребители только читают (проверяется тестом на Proxy, который бросает
// на любой записи: server/ledgerCache.immutability.test.js).

const { transformTransactions } = require('./transform');
const { computeBalances, computeMonthEndBalances, computeMonthlyTotalsByAccount } = require('./stats');
const { computeCategoryUsage } = require('./analytics');

// Ленивые, один раз вычисляемые производные от набора документов и счетов.
// Принимает любой объект с docs и accounts: снимок кэша или временный набор
// (кэш выключен, тест, прямой вызов buildDashboard).
function createDerived(source) {
    const values = new Map();
    const once = (key, compute) => {
        if (!values.has(key)) values.set(key, compute());
        return values.get(key);
    };

    const derived = {
        // Расчётный вид операций в естественном порядке снимка.
        transactions: () => once('transactions', () => transformTransactions(source.docs, source.accounts)),

        // Расчётный вид того же документа: история берёт операции в своём порядке
        // и по своему периоду, а преобразование у каждой операции одно.
        transactionOf(doc) {
            const byDoc = once('byDoc', () => {
                const map = new Map();
                const list = derived.transactions();
                source.docs.forEach((item, index) => map.set(item, list[index]));
                return map;
            });
            return byDoc.get(doc);
        },

        balances: () => once('balances', () => computeBalances(source.docs, source.accounts)),
        monthEndBalances: () => once('monthEndBalances', () => computeMonthEndBalances(source.docs, source.accounts)),

        // Итоги по месяцам для всех счетов. Без фильтра по категории это
        // величина снимка и запоминается; с категорией считается заново и не
        // запоминается: значение приходит из строки запроса, и запоминать по
        // нему значило бы дать клиенту наращивать память процесса.
        monthlyTotalsByAccount(category = null) {
            if (category) return computeMonthlyTotalsByAccount(source.docs, source.accounts, { category });
            return once('monthlyTotalsByAccount', () => computeMonthlyTotalsByAccount(source.docs, source.accounts, { category: null }));
        },

        categoryUsage: () => once('categoryUsage', () => computeCategoryUsage(derived.transactions()))
    };
    return derived;
}

const derivedBySnapshot = new WeakMap();

function derivedOf(snapshot) {
    let derived = derivedBySnapshot.get(snapshot);
    if (!derived) {
        derived = createDerived(snapshot);
        derivedBySnapshot.set(snapshot, derived);
    }
    return derived;
}

// --- Справочники в виде готового JSON ---------------------------------------

// Тела GET /api/accounts и GET /api/categories должны остаться прежними до
// байта. Раньше их отдавали документы Mongoose (toJSON): с дефолтами схемы для
// полей, которых в старом документе нет, и с порядком полей, который задаёт
// схема. В снимке лежат lean-документы без этого, поэтому перед
// сериализацией они проходят через Model.hydrate - тот же путь, что у
// результата find(). Готовая строка запоминается на снимок: JSON справочника
// один на все запросы.
const catalogJsonBySnapshot = new WeakMap();

function catalogJson(snapshot, name, build) {
    let entry = catalogJsonBySnapshot.get(snapshot);
    if (!entry) {
        entry = {};
        catalogJsonBySnapshot.set(snapshot, entry);
    }
    if (entry[name] === undefined) entry[name] = build();
    return entry[name];
}

// База сортировала счета по order без индекса: документ без поля order (или с
// null) идёт раньше любого числа, равные порядки остаются как есть. Sort в JS
// устойчив, так что равные порядки сохраняют естественный порядок снимка.
function orderKey(account) {
    return typeof account.order === 'number' ? account.order : -Infinity;
}

function accountsJsonOf(snapshot) {
    return catalogJson(snapshot, 'accounts', () => {
        const Account = require('./models/Account');
        const sorted = [...snapshot.accounts].sort((a, b) => {
            const ka = orderKey(a);
            const kb = orderKey(b);
            return ka < kb ? -1 : ka > kb ? 1 : 0;
        });
        return JSON.stringify(sorted.map(account => Account.hydrate(account)));
    });
}

// Категории уже прочитаны в нужном порядке (тип, затем order): его даёт сама база.
function categoriesJsonOf(snapshot) {
    return catalogJson(snapshot, 'categories', () => {
        const Category = require('./models/Category');
        return JSON.stringify(snapshot.categories.map(category => Category.hydrate(category)));
    });
}

module.exports = { createDerived, derivedOf, accountsJsonOf, categoriesJsonOf };
