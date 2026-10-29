// Плагин Mongoose: любая запись в операции, счета, категории или настройки
// сбрасывает кэш (server/ledgerCache.js).
//
// Почему middleware модели, а не вызовы в роутах. Писать в Transaction и
// Account умеют десяток мест: роуты, корзина, предстоящие платежи, банк,
// очистка описаний, засев. Помнить про каждое из них - значит рано или поздно
// забыть одно, и тогда приложение молча покажет старые деньги. Хук на схеме
// ловит запись, откуда бы она ни пришла.
//
// Что хуки не видят: запись в обход Mongoose (`Model.collection.insertOne`,
// драйвер напрямую) и запись из другого процесса. Для первого в серверном коде
// таких мест нет (проверено grep'ом), для второго есть защита по возрасту
// снимка (SOFT_TTL_MS в ledgerCache.js: фоновое обновление с проверкой, изменились ли данные).
//
// Сбрасываем и до записи, и после. После - главное: именно оно гарантирует, что
// ответ на запись уйдёт уже при сброшенном кэше. До записи - на случай, когда
// запись упала посередине (пакет прошёл частично) и послезапросный хук не
// выполнился; ошибочные хуки ниже закрывают то же самое ещё раз.

const { ledgerCache } = require('./ledgerCache');

// Запросы, документные операции и операции модели - имена в Mongoose 8.
const QUERY_OPERATIONS = [
    'updateOne', 'updateMany', 'deleteOne', 'deleteMany',
    'findOneAndUpdate', 'findOneAndDelete', 'findOneAndReplace', 'replaceOne'
];
const DOCUMENT_OPERATIONS = ['save', 'updateOne', 'deleteOne'];
const MODEL_OPERATIONS = ['insertMany', 'bulkWrite'];

// Сессии, за которыми уже следим: подменять методы второй раз нельзя.
const watchedSessions = new WeakMap();

// Запись внутри транзакции видна другим только после коммита, а хук
// послезапросный срабатывает раньше. Перезагрузка в этом промежутке положила бы
// в кэш данные до коммита, и они пролежали бы до следующей записи. Поэтому на
// завершение транзакции (коммит, откат, закрытие сессии) сбрасываем кэш ещё
// раз: загрузка, начавшаяся раньше, потеряет версию и в кэш не попадёт.
function watchSession(session) {
    let state = watchedSessions.get(session);
    if (!state) {
        state = { holding: false };
        watchedSessions.set(session, state);

        const settle = () => {
            ledgerCache.invalidate({ reload: false });
            if (state.holding) {
                state.holding = false;
                ledgerCache.releaseReload();
            }
        };
        // withTransaction вызывает commitTransaction / abortTransaction на самой
        // сессии, так что подмена на экземпляре перехватывает и его. Сброс стоит в
        // finally: коммит мог упасть уже после применения на сервере.
        for (const method of ['commitTransaction', 'abortTransaction']) {
            const original = session[method];
            if (typeof original !== 'function') continue;
            session[method] = async function patched(...args) {
                try {
                    return await original.apply(this, args);
                } finally {
                    settle();
                }
            };
        }
        session.once?.('ended', settle);
    }
    if (!state.holding) {
        state.holding = true;
        ledgerCache.holdReload();
    }
}

function noteWrite(session) {
    if (session && typeof session.inTransaction === 'function' && session.inTransaction()) {
        watchSession(session);
        ledgerCache.invalidate({ reload: false });
        return;
    }
    ledgerCache.invalidate();
}

// Сессия записи: у запроса в options, у документа - $session(), у операций
// модели - в последнем аргументе (options).
function sessionOf(context, args) {
    if (typeof context?.getOptions === 'function') return context.getOptions()?.session;
    if (typeof context?.$session === 'function') return context.$session();
    for (const arg of args) {
        if (arg && typeof arg === 'object' && arg.session) return arg.session;
    }
    return undefined;
}

function ledgerInvalidationPlugin(schema) {
    const register = (name, options) => {
        // Без options второй аргумент у Mongoose должен отсутствовать, а не быть
        // undefined.
        const withOptions = (fn) => (options ? [name, options, fn] : [name, fn]);
        // Хук с параметром next: Kareem передаёт ему аргументы операции (для
        // insertMany и bulkWrite - массив и options, откуда берётся сессия).
        schema.pre(...withOptions(function ledgerPre(next, ...args) {
            noteWrite(sessionOf(this, args));
            next();
        }));
        schema.post(...withOptions(function ledgerPost() {
            ledgerCache.invalidate();
        }));
        // Обработчик ошибок (три параметра): запись могла пройти частично.
        schema.post(...withOptions(function ledgerError(error, result, next) {
            ledgerCache.invalidate();
            next(error);
        }));
    };

    for (const name of QUERY_OPERATIONS) register(name, { query: true, document: false });
    for (const name of DOCUMENT_OPERATIONS) {
        register(name, name === 'save' ? undefined : { query: false, document: true });
    }
    for (const name of MODEL_OPERATIONS) register(name, undefined);
}

module.exports = { ledgerInvalidationPlugin, QUERY_OPERATIONS, DOCUMENT_OPERATIONS, MODEL_OPERATIONS };
