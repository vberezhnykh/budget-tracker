// Готовые ответы тяжёлых роутов (сводка, история) до следующей записи.
//
// Снимок в памяти (ledgerCache.js) убирает чтение базы, но расчёт остаётся:
// на слабом процессоре сводка считается около 400 мс, история около 200.
// Данные между записями не меняются, а экран просит одно и то же при каждом
// открытии - так что посчитанное можно просто отдать.
//
// Ответ привязан к версии снимка, по которому посчитан: запись меняет версию, и
// запись под старой версией никому больше не отдаётся. Отдельной чистки при
// записи не нужно, устаревшее вытесняется само при первой же новой записи.
//
// В памяти лежит готовая JSON-строка, а не объект ответа: роут всё равно
// отдаёт JSON, а строка вдвое легче объекта и не требует сериализации на
// каждый запрос. Заголовки при этом те же, что у res.json (см. sendJson).
//
// Один расчёт на ключ. Расчёт синхронный, а между проверкой «ответа нет» и
// записью готового ответа в нём нет ни одного await, поэтому два одновременных
// одинаковых запроса не могут посчитать дважды: второй после первого уже
// находит ответ. Если расчёт когда-нибудь станет асинхронным, здесь нужна
// карта идущих расчётов.

// Потолки по группам. История целиком - до мегабайта строки, а вариантов
// сводки много (месяц, фильтры по счёту и категории), поэтому у истории свой,
// меньший предел: полный список один на фильтр, а не на каждый месяц.
const GROUP_LIMITS = Object.freeze({ dashboard: 32, history: 8 });

function createResponseMemo({ limits = GROUP_LIMITS } = {}) {
    // Map помнит порядок вставки: самый давний ключ первый, а при обращении
    // запись переставляется в конец - получается LRU.
    const groups = new Map(Object.keys(limits).map(name => [name, new Map()]));
    let latestVersion = -Infinity;
    const stats = { hits: 0, misses: 0, computes: 0 };

    function purgeOlderThan(version) {
        for (const entries of groups.values()) {
            for (const [key, entry] of entries) {
                if (entry.version < version) entries.delete(key);
            }
        }
    }

    return {
        // compute() возвращает JSON-строку. Ответ с тем же ключом и версией
        // снимка отдаётся без расчёта.
        getJson(group, params, version, compute) {
            return this.getEntry(group, params, version, compute).json;
        },

        // То же, но с признаком попадания: hit - ответ был готов, иначе его
        // только что посчитали. По нему в Server-Timing видно, платил ли запрос
        // за расчёт (см. setMemoState в serverTiming.js).
        getEntry(group, params, version, compute) {
            const entries = groups.get(group);
            if (!entries) throw new Error(`Неизвестная группа ответов: ${group}`);
            const key = JSON.stringify(params);

            const entry = entries.get(key);
            if (entry && entry.version === version) {
                entries.delete(key);
                entries.set(key, entry);
                stats.hits += 1;
                return { json: entry.json, hit: true };
            }

            stats.misses += 1;
            stats.computes += 1;
            const json = compute();

            // Версия старее уже виденной - запрос держит снимок, который успели
            // сбросить. Его ответ верен для него самого, но хранить его нельзя:
            // он вытеснил бы свежие.
            if (version < latestVersion) return { json, hit: false };
            if (version > latestVersion) {
                latestVersion = version;
                purgeOlderThan(version);
            }
            entries.delete(key);
            entries.set(key, { version, json });
            while (entries.size > limits[group]) {
                entries.delete(entries.keys().next().value);
            }
            return { json, hit: false };
        },

        size: () => [...groups.values()].reduce((sum, entries) => sum + entries.size, 0),
        sizeOf: group => groups.get(group)?.size ?? 0,
        stats: () => ({ ...stats }),

        // Для тестов.
        clear() {
            for (const entries of groups.values()) entries.clear();
            latestVersion = -Infinity;
            stats.hits = 0;
            stats.misses = 0;
            stats.computes = 0;
        }
    };
}

// Ответ тем же образом, что делает res.json(): Content-Type выставляется до
// send, а ETag и обработку If-None-Match делает сам res.send для строки.
function sendJson(res, json) {
    if (!res.get('Content-Type')) res.set('Content-Type', 'application/json');
    return res.send(json);
}

const responseMemo = createResponseMemo();

module.exports = { GROUP_LIMITS, createResponseMemo, sendJson, responseMemo };
