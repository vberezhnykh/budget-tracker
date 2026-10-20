// Снимок активных операций и счетов в памяти сервера.
//
// Зачем он нужен. Сводка, история, поиск и подсказки каждый раз читали из
// Atlas всю историю: на бесплатном M0 это полсекунды на запрос, и столько же
// ещё уходило на расчёт. Сами данные при этом меняются раз в несколько минут,
// а читаются при каждом открытии экрана. Поэтому история лежит в памяти
// процесса и перечитывается только после записи.
//
// Что кладётся в память и что нет. Только то, что и так читали эти роуты:
// активные операции и счета. Деньги не попадают на телефон и никуда не
// уходят из процесса сервера - правило «финансовые данные на телефоне не
// храним» этим не нарушается.
//
// Три опасности и чем они закрыты.
//
// 1. Устаревшие данные после записи. Любая запись в Transaction или Account
//    (см. server/ledgerCachePlugin.js) вызывает invalidate(): версия растёт, а
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
//    фоне (stale-while-revalidate), после HARD_TTL_MS - перечитывается
//    синхронно, как будто снимка нет.
//
// Объекты снимка читатели менять не вправе: он общий для всех запросов.
// Все потребители (transformTransactions, buildDashboard и остальные) только
// читают документы; это проверяется тестом на замороженном снимке.

// Через сколько снимок считается устаревшим: отдаётся как есть, а перечитывается
// в фоне. Правки скриптами вне сервера редки, поэтому десяти минут достаточно,
// чтобы они доехали сами, без перезапуска процесса.
const SOFT_TTL_MS = 10 * 60 * 1000;

// Через сколько снимку не верим совсем: фоновое обновление могло не завершиться
// (база недоступна), а отдавать часовые данные молча нельзя.
const HARD_TTL_MS = 60 * 60 * 1000;

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

function createLedgerCache({
    load,
    now = () => Date.now(),
    softTtlMs = SOFT_TTL_MS,
    hardTtlMs = HARD_TTL_MS,
    reloadDebounceMs = RELOAD_DEBOUNCE_MS,
    isEnabled = () => isLedgerCacheEnabled(),
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

    function logBackgroundError(error) {
        const time = now();
        if (lastErrorLogAt !== null && time - lastErrorLogAt < ERROR_LOG_INTERVAL_MS) return;
        lastErrorLogAt = time;
        try {
            logger.warn('Не удалось загрузить кэш операций:', error?.message || error);
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
                // Версия сменилась (запись) - результат мог прочитать старое:
                // вызвавшему он отдаётся, но на место снимка не встаёт.
                if (version === startVersion) {
                    // Заменяется живой снимок той же версии (фоновое обновление
                    // или перечитывание по возрасту): данные могли измениться
                    // без единой записи через этот процесс, а ответы,
                    // посчитанные по старому снимку, привязаны к его версии. Новая
                    // версия не даёт их выдать за ответы по новым данным.
                    if (snapshot && snapshot.version === version) {
                        version += 1;
                        installedVersion = version;
                    }
                }
                const next = { version: installedVersion, loadedAt: startedAt, docs: data.docs, accounts: data.accounts };
                if (version === installedVersion) snapshot = next;
                return next;
            })
            .finally(() => {
                if (inflight === entry) inflight = null;
            });
        inflight = entry;
        return entry.promise;
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
        // 'stale' - отдан устаревший, обновление пошло в фоне, 'miss' -
        // пришлось ждать загрузку, 'off' - кэш выключен, данные прочитаны из базы.
        async get() {
            if (!isEnabled()) {
                const data = await load();
                return { snapshot: { version: -1, loadedAt: now(), docs: data.docs, accounts: data.accounts }, state: 'off' };
            }
            inUse = true;
            if (snapshot) {
                const age = now() - snapshot.loadedAt;
                if (age < hardTtlMs) {
                    if (age < softTtlMs) return { snapshot, state: 'hit' };
                    loadInBackground();
                    return { snapshot, state: 'stale' };
                }
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
async function loadFromDatabase() {
    const Transaction = require('./models/Transaction');
    const Account = require('./models/Account');
    const { activeTransactionFilter } = require('./ledgerState');
    const [docs, accounts] = await Promise.all([
        Transaction.find(activeTransactionFilter()).lean(),
        Account.find().lean()
    ]);
    return { docs, accounts };
}

const ledgerCache = createLedgerCache({ load: loadFromDatabase });

module.exports = {
    SOFT_TTL_MS,
    HARD_TTL_MS,
    RELOAD_DEBOUNCE_MS,
    createLedgerCache,
    isLedgerCacheEnabled,
    docsByDateDesc,
    ledgerCache
};
