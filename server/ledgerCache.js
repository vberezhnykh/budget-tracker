// Снимок активных операций, счетов, категорий и настроек в памяти сервера.
//
// Зачем он нужен. Сводка, история, поиск и подсказки каждый раз читали из
// Atlas всю историю: на бесплатном M0 это полсекунды на запрос, и столько же
// ещё уходило на расчёт. Сами данные при этом меняются раз в несколько минут,
// а читаются при каждом открытии экрана. Поэтому история лежит в памяти
// процесса и перечитывается только после записи.
//
// Что кладётся в память и что нет. Только то, что и так читали эти роуты:
// активные операции и счета, а также категории и настройки: их читал запуск
// приложения (GET /api/bootstrap) параллельно со сводкой, и после простоя
// первое же обращение к Atlas занимало полсекунды (холодное соединение), хотя
// сама выборка из трёх крошечных коллекций - единицы миллисекунд. Деньги не
// попадают на телефон и никуда не уходят из процесса сервера - правило
// «финансовые данные на телефоне не храним» этим не нарушается.
//
// Настройки в снимке - это число лимита или признак нарушенной целостности
// (несколько наборов настроек, см. settingsSingleton.js): роуты на него
// по-прежнему отвечают 409, а остальные части снимка от этого не страдают.
// Флаги функций (features) в снимок не входят: они берутся из окружения при
// каждом запросе.
//
// Три опасности и чем они закрыты.
//
// 1. Устаревшие данные после записи. Любая запись в Transaction, Account,
//    Category или Settings (см. server/ledgerCachePlugin.js) вызывает invalidate(): версия растёт, а
//    снимок выбрасывается. Следующий читатель загружает свежий.
//
// 2. Гонка загрузки и записи. Загрузка, начатая до записи, может прочитать
//    старые данные и закончиться уже после invalidate(). Поэтому результат
//    ставится на место снимка, только если версия за время загрузки не
//    менялась. Читатель, пришедший после записи, не подключается к такой
//    загрузке, а начинает свою: старая могла не увидеть его записи.
//
// 3. Запись не через этот процесс. Скрипты в server/*.js (восстановление,
//    правки данных) запускаются отдельно и кэш не уведомляют. Защита по
//    возрасту: после SOFT_TTL_MS снимок ещё отдаётся, но тут же обновляется в
//    фоне (stale-while-revalidate). Читатель при этом не ждет Atlas никогда,
//    пока снимок есть: раньше через час простоя запрос перечитывал историю
//    синхронно (полсекунды-секунда на M0), а это ровно тот запрос, которым
//    открывается приложение утром. Верхней границы возраста нет намеренно:
//    единственный источник отставания - правки скриптами вне сервера (свои
//    записи сбрасывают снимок сразу), и лучше отдать вчерашнюю картину, чем
//    ошибку, когда Atlas недоступен. Чтобы отставание не прошло молча, каждая
//    неудачная фоновая загрузка пишется в лог с возрастом снимка.
//    Дождаться загрузки приходится, только когда снимка нет совсем: старт до
//    окончания прогрева и первое чтение после записи.
//
//    Фоновое обновление не считается заменой данных автоматически: новый набор
//    сравнивается со снимком по отпечатку (см. fingerprintLedger). Не
//    изменился - версия остается, и готовые ответы responseMemo остаются
//    действительными (иначе каждое обновление раз в 10 минут заставляло бы
//    следующий запрос считать сводку заново). Изменился - ставится снимок с
//    новой версией.
//
// Объекты снимка читатели менять не вправе: он общий для всех запросов.
// Все потребители (transformTransactions, buildDashboard и остальные) только
// читают документы; это проверяется тестом на замороженном снимке.

const crypto = require('node:crypto');

// Через сколько снимок считается устаревшим: отдаётся как есть, а перечитывается
// в фоне. Правки скриптами вне сервера редки, поэтому десяти минут достаточно,
// чтобы они доехали сами, без перезапуска процесса.
const SOFT_TTL_MS = 10 * 60 * 1000;

// Пауза перед фоновой перезагрузкой после записи. Приложение после сохранения
// само просит свежую сводку и историю, и к этому моменту снимок уже должен
// быть тёплым; пачка записей подряд (разделённая покупка, импорт) при этом
// даёт одну перезагрузку, а не по одной на каждую запись.
const RELOAD_DEBOUNCE_MS = 200;

// Ошибка фоновой загрузки пишется в лог не чаще раза в это время: при
// недоступной базе иначе каждая запись добавляла бы строку.
const ERROR_LOG_INTERVAL_MS = 5 * 60 * 1000;

// LEDGER_CACHE=off - аварийный выключатель: каждый вызов читает базу напрямую,
// как до появления кэша. Читается при каждом обращении, а не при загрузке
// модуля, чтобы значение можно было сменить без пересоздания кэша (тесты).
function isLedgerCacheEnabled(env = process.env) {
    return String(env.LEDGER_CACHE || '').trim().toLowerCase() !== 'off';
}

// Отпечаток набора: по нему видно, что фоновая загрузка принесла те же данные.
// У операций нет updatedAt (скрипт, правящий сумму, ничего больше не трогает), а
// _id при правке не меняется, так что «число и максимальный _id» правку не
// увидели бы. Поэтому хешируется содержимое каждого документа целиком.
//
// Хеши документов складываются через XOR, а не в одну строку подряд: порядок,
// в котором база отдает документы без сортировки, не гарантирован, и смена
// порядка без смены данных не должна считаться изменением. Ложное «изменилось»
// безвредно (версия вырастет, ответы посчитаются заново), а ложное «не
// изменилось» опасно, поэтому в хеш идет весь документ, включая __v.
// JSON.stringify для ObjectId и Date дает строку через их toJSON.
function fingerprintLedger({ docs, accounts, categories = [], settings = null }) {
    const part = (items) => {
        const sum = Buffer.alloc(20);
        for (const item of items) {
            const digest = crypto.createHash('sha1').update(JSON.stringify(item)).digest();
            for (let i = 0; i < sum.length; i += 1) sum[i] ^= digest[i];
        }
        return `${items.length}:${sum.toString('hex')}`;
    };
    // Настройки - один небольшой объект: считается как набор из одного документа.
    return `${part(docs)}|${part(accounts)}|${part(categories)}|${part(settings ? [settings] : [])}`;
}

function createLedgerCache({
    load,
    now = () => Date.now(),
    softTtlMs = SOFT_TTL_MS,
    reloadDebounceMs = RELOAD_DEBOUNCE_MS,
    isEnabled = () => isLedgerCacheEnabled(),
    fingerprint = fingerprintLedger,
    logger = console
} = {}) {
    if (typeof load !== 'function') throw new TypeError('createLedgerCache требует функцию load');

    // Поколение данных. Растёт при каждой записи и при замене снимка новым.
    let version = 0;
    let snapshot = null;
    // Загрузка, которую можно делить между читателями: только та, что начата
    // на текущей версии.
    let inflight = null;
    let reloadTimer = null;
    // Открытых транзакций, чьи записи ещё не зафиксированы: пока они есть,
    // фоновая перезагрузка бессмысленна - она прочитала бы данные до коммита.
    let openTransactions = 0;
    // Фоновая перезагрузка нужна, только если кэшем уже пользовались: иначе
    // запись в базу без единого чтения (скрипт, тест) тянула бы историю зря.
    let inUse = false;
    let lastErrorLogAt = null;
    // Подписчики на «фоновое обновление нашло изменённые данные» (прогрев
    // готовых ответов, см. dashboardWarmer.js). Обычная запись через этот
    // процесс их не вызывает: после неё следующий запрос клиента сам считает
    // ответ, и считать его заранее значило бы удвоить нагрузку.
    const refreshListeners = new Set();
    // Отпечаток снимка считается не при установке, а при первом сравнении:
    // большинство снимков заменяет запись, и до сравнения дело не доходит.
    const fingerprints = new WeakMap();

    function fingerprintOf(snap) {
        let value = fingerprints.get(snap);
        if (value === undefined) {
            value = fingerprint(snap);
            fingerprints.set(snap, value);
        }
        return value;
    }

    function logBackgroundError(error) {
        const time = now();
        if (lastErrorLogAt !== null && time - lastErrorLogAt < ERROR_LOG_INTERVAL_MS) return;
        lastErrorLogAt = time;
        try {
            // Снимок при этом продолжает отдаваться: читатель увидит данные
            // без ошибки, и только лог говорит, насколько они отстали.
            const age = snapshot ? ` Снимок отдается устаревшим (${Math.round((time - snapshot.loadedAt) / 60000)} мин).` : '';
            logger.warn(`Не удалось загрузить кэш операций:${age}`, error?.message || error);
        } catch {
            // Лог не должен ломать приложение.
        }
    }

    function startLoad() {
        if (inflight && inflight.version === version) return inflight.promise;

        const startVersion = version;
        const startedAt = now();
        const entry = { version: startVersion, promise: null };
        entry.promise = Promise.resolve()
            .then(load)
            .then(data => {
                let installedVersion = startVersion;
                let refreshChanged = false;
                // Версия сменилась (запись) - результат мог прочитать старое:
                // вызвавшему он отдаётся, но на место снимка не встаёт.
                if (version === startVersion) {
                    // Заменяется живой снимок той же версии (фоновое обновление
                    // по возрасту): данные могли измениться без единой записи
                    // через этот процесс, а ответы, посчитанные по старому
                    // снимку, привязаны к его версии. Новая версия не дает их
                    // выдать за ответы по новым данным.
                    if (snapshot && snapshot.version === version) {
                        if (fingerprintOf(snapshot) === fingerprint(data)) {
                            // Те же данные: снимок и версия остаются, а значит
                            // остаются действительными и готовые ответы. Меняется
                            // только отметка свежести. Поле меняется на месте:
                            // это служебная отметка кэша, документы и счета
                            // читатели видят прежними, а запомненная на снимок
                            // сортировка истории (docsByDateDesc) не теряется.
                            snapshot.loadedAt = startedAt;
                            return snapshot;
                        }
                        version += 1;
                        installedVersion = version;
                        refreshChanged = true;
                    }
                }
                const next = {
                    version: installedVersion,
                    loadedAt: startedAt,
                    docs: data.docs,
                    accounts: data.accounts,
                    categories: data.categories,
                    settings: data.settings
                };
                if (version === installedVersion) snapshot = next;
                if (refreshChanged && snapshot === next) notifyRefreshChanged(next);
                return next;
            })
            .finally(() => {
                if (inflight === entry) inflight = null;
            });
        inflight = entry;
        return entry.promise;
    }

    function notifyRefreshChanged(next) {
        for (const listener of refreshListeners) {
            try {
                listener(next);
            } catch (error) {
                logBackgroundError(error);
            }
        }
    }

    // Фоновая загрузка: ошибки не уходят никому, кроме лога.
    function loadInBackground() {
        startLoad().catch(logBackgroundError);
    }

    function scheduleReload() {
        if (!inUse || !isEnabled() || openTransactions > 0) return;
        if (reloadTimer) clearTimeout(reloadTimer);
        reloadTimer = setTimeout(() => {
            reloadTimer = null;
            if (!isEnabled() || snapshot || openTransactions > 0) return;
            loadInBackground();
        }, reloadDebounceMs);
        reloadTimer.unref?.();
    }

    return {
        // Возвращает { snapshot, state }. state: 'hit' - снимок свежий,
        // 'stale' - отдан устаревший (любого возраста), обновление пошло в фоне,
        // 'miss' - снимка не было и пришлось ждать загрузку, 'off' - кэш выключен, данные прочитаны из базы.
        async get() {
            if (!isEnabled()) {
                const data = await load();
                return {
                    snapshot: {
                        version: -1,
                        loadedAt: now(),
                        docs: data.docs,
                        accounts: data.accounts,
                        categories: data.categories,
                        settings: data.settings
                    },
                    state: 'off'
                };
            }
            inUse = true;
            if (snapshot) {
                if (now() - snapshot.loadedAt < softTtlMs) return { snapshot, state: 'hit' };
                loadInBackground();
                return { snapshot, state: 'stale' };
            }
            return { snapshot: await startLoad(), state: 'miss' };
        },

        // Прогрев при старте: ошибка не бросается, чтобы не мешать запуску.
        warm() {
            if (!isEnabled()) return Promise.resolve();
            inUse = true;
            if (snapshot) return Promise.resolve();
            return startLoad().then(() => undefined, logBackgroundError);
        },

        // Данные изменились. reload: false - вызывающий сам запланирует
        // перезагрузку позже (запись внутри транзакции: коммита ещё нет).
        invalidate({ reload = true } = {}) {
            version += 1;
            snapshot = null;
            if (reload) scheduleReload();
        },

        // Начало и конец открытой транзакции с записями в операции или счета.
        holdReload() {
            openTransactions += 1;
        },
        releaseReload() {
            openTransactions = Math.max(0, openTransactions - 1);
            scheduleReload();
        },

        // Подписка на фоновое обновление, которое принесло другие данные.
        // Слушатель получает новый снимок и вызывается синхронно, поэтому
        // тяжёлую работу откладывает сам. Возвращает функцию отписки.
        onRefreshChanged(listener) {
            refreshListeners.add(listener);
            return () => refreshListeners.delete(listener);
        },

        isEnabled: () => Boolean(isEnabled()),
        getVersion: () => version,
        peek: () => snapshot,

        // Для тестов: возвращает кэш в исходное состояние. Идущая загрузка
        // получает новую версию и потому не сможет поставить свой результат.
        reset() {
            version += 1;
            snapshot = null;
            inflight = null;
            openTransactions = 0;
            inUse = false;
            lastErrorLogAt = null;
            if (reloadTimer) clearTimeout(reloadTimer);
            reloadTimer = null;
        }
    };
}

// Операции в порядке { date: -1, _id: -1 } - так их отдавала база для истории.
// Снимок хранится в естественном порядке базы (в нём же читают остальные роуты:
// от порядка зависит, например, какое из равных по частоте описаний подсказка
// покажет первым), поэтому для истории порядок строится копией и запоминается
// на снимок. Запоминание в WeakMap, а не полем снимка: снимок общий и его
// объекты читателям менять нельзя.
const sortedBySnapshot = new WeakMap();

function dateValue(doc) {
    // Документ без даты (или с нечитаемой) база при сортировке по убыванию
    // ставит в конец; -Infinity даёт тот же порядок.
    return doc.date instanceof Date && !Number.isNaN(doc.date.getTime()) ? doc.date.getTime() : -Infinity;
}

function docsByDateDesc(snap) {
    let sorted = sortedBySnapshot.get(snap);
    if (!sorted) {
        // Сравнение id как строки hex даёт тот же порядок, что и сравнение
        // байтов ObjectId в базе.
        const keys = new Map(snap.docs.map(doc => [doc, String(doc._id)]));
        sorted = [...snap.docs].sort((a, b) => {
            const byDate = dateValue(b) - dateValue(a);
            if (byDate !== 0 && !Number.isNaN(byDate)) return byDate;
            const ka = keys.get(a);
            const kb = keys.get(b);
            return ka < kb ? 1 : ka > kb ? -1 : 0;
        });
        sortedBySnapshot.set(snap, sorted);
    }
    return sorted;
}

// Загрузка из базы - ровно те запросы, что роуты делали сами. Модели берутся
// здесь, а не при загрузке модуля: плагин инвалидации подключается в моделях
// и требует этот файл, цикл иначе неизбежен.
//
// Категории читаются с тем же порядком, что у GET /api/categories (тип, затем
// order). Счета, наоборот, лежат в естественном порядке базы (от него зависят
// расчёты), а порядок экрана строится при отдаче (см. ledgerCatalog.js).
async function loadFromDatabase() {
    const Transaction = require('./models/Transaction');
    const Account = require('./models/Account');
    const Category = require('./models/Category');
    const { activeTransactionFilter } = require('./ledgerState');
    const [docs, accounts, categories, settings] = await Promise.all([
        Transaction.find(activeTransactionFilter()).lean(),
        Account.find().lean(),
        Category.find().sort({ type: 1, order: 1 }).lean(),
        loadSettingsData()
    ]);
    return { docs, accounts, categories, settings };
}

// Лимит из канонического документа настроек (с принятием единственного
// старого документа - это делает getCanonicalSettings) либо признак нарушенной
// целостности. Любая другая ошибка (база недоступна) уходит наверх, как и у
// остальных частей снимка.
async function loadSettingsData() {
    const { getCanonicalSettings } = require('./settingsSingleton');
    try {
        const settings = await getCanonicalSettings();
        return { monthlyLimit: settings ? settings.monthlyLimit : null, integrityError: null };
    } catch (error) {
        if (error?.code !== 'SETTINGS_INTEGRITY') throw error;
        return { monthlyLimit: null, integrityError: error.message };
    }
}

const ledgerCache = createLedgerCache({ load: loadFromDatabase });

module.exports = {
    SOFT_TTL_MS,
    RELOAD_DEBOUNCE_MS,
    createLedgerCache,
    fingerprintLedger,
    isLedgerCacheEnabled,
    docsByDateDesc,
    ledgerCache
};
