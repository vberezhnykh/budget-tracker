// Разбор параметров сводки и её расчёт по снимку: общее место для роутов
// (/api/stats/dashboard, /api/bootstrap) и для прогрева готовых ответов
// (dashboardWarmer.js). Прогрев обязан положить в responseMemo ровно тот ключ,
// под которым ответ потом будет искать запрос, поэтому и разбор, и расчёт
// живут в одном месте, а прогрев строит параметры тем же разбором.

const { buildDashboard } = require('./dashboard');
const { derivedOf } = require('./ledgerDerived');

// Параметры сводки из строки запроса. Ключ готового ответа (responseMemo) строится
// из params целиком, поэтому «без month» и «с текущим month» дают один ключ.
//
// tz - часовой пояс клиента (IANA), нужен только прогреву: в params и ключ
// ответа он не входит, ответ определяет уже присланный today. Неизвестное имя
// зоны молча отбрасывается, а запрос обрабатывается как без него.
function parseDashboardQuery(query) {
    const str = (key) => (typeof query[key] === 'string' && query[key] ? query[key] : null);

    const month = str('month') || new Date().toISOString().slice(0, 7);
    const timeRange = str('timeRange') || 'month';
    const account = str('account');
    const category = str('category');
    const type = str('type');
    const today = str('today') || new Date().toISOString().slice(0, 10);

    if (!/^\d{4}-\d{2}$/.test(month)) {
        return { error: 'Некорректное значение month: ожидается YYYY-MM' };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) {
        return { error: 'Некорректное значение today: ожидается YYYY-MM-DD' };
    }

    const analytics = query.analytics !== '0';
    // Ключ ответа - все параметры, от которых он зависит; month и today уже
    // приведены к значениям по умолчанию, поэтому «без month» и «с текущим
    // month» дают один ключ.
    return { params: { month, timeRange, account, category, type, today, analytics }, tz: validTimeZone(str('tz')) };
}

// Имя зоны, которое понимает Intl, или null. Строка из запроса: длина ограничена
// до проверки, чтобы мусор не доходил до конструктора.
const MAX_TIME_ZONE_LENGTH = 64;
// Уже проверенные имена: проверка идёт на каждый запрос сводки, а создание
// форматтера на слабом процессоре заметно. Неверные имена не запоминаются -
// иначе клиент мог бы наращивать набор мусором.
const knownZones = new Set();
const MAX_KNOWN_ZONES = 64;

function validTimeZone(value) {
    if (typeof value !== 'string' || value.length === 0 || value.length > MAX_TIME_ZONE_LENGTH) return null;
    if (knownZones.has(value)) return value;
    try {
        new Intl.DateTimeFormat('en-CA', { timeZone: value });
    } catch {
        return null;
    }
    if (knownZones.size >= MAX_KNOWN_ZONES) knownZones.clear();
    knownZones.add(value);
    return value;
}

// Готовая JSON-строка сводки по снимку. Производные, не зависящие от параметров,
// берутся из запомненных на снимок (ledgerDerived.js).
function computeDashboardJson(snapshot, params) {
    return JSON.stringify(buildDashboard(snapshot.docs, snapshot.accounts, params, derivedOf(snapshot)));
}

module.exports = { parseDashboardQuery, validTimeZone, computeDashboardJson, MAX_TIME_ZONE_LENGTH };
