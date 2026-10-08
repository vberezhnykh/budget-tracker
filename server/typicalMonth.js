// «Обычный месяц»: с чем сравнивать текущие траты и от чего строить прогноз
// на конец месяца.
//
// Модель: по каждому дню месяца - медиана накопленного расхода за 6 последних
// ПОЛНЫХ месяцев до выбранного. Медиана, а не среднее, потому что один
// месяц с отпуском или разовой крупной покупкой не должен сдвигать «обычное».
// А накопленное по дням, а не «сумма за месяц / число дней», потому что траты
// неравномерны: аренда уходит первого числа, и линейная экстраполяция
// «потрачено к 5-му × 6» давала бы абсурдный прогноз.
//
// Правила расхода (переводы, «не в статистике», фильтры счёта и категории)
// берутся из analytics.js те же самые, что у остальных итогов, - своей копии
// правила здесь нет, чтобы цифры не разъехались.
//
// «Сегодня» приходит параметром по той же причине, что и в analytics.js:
// сервер живёт в UTC, а календарь, о котором идёт речь, - клиентский.
// Все даты - строки 'YYYY-MM-DD'; дни считаются арифметикой над строками и
// UTC-датами, без локальной зоны.

const { sumExpense, applyFilters, shiftMonth } = require('./analytics');

const REFERENCE_MONTHS = 6;
// Меньше трёх месяцев медиана - почти случайное число, прогноз по ней хуже,
// чем его отсутствие.
const MIN_REFERENCE_MONTHS = 3;

const round2 = x => Math.round(x * 100) / 100;

function monthStr(year, month) {
    return `${year}-${String(month).padStart(2, '0')}`;
}

function daysInMonth(monthKey) {
    const [year, month] = monthKey.split('-').map(Number);
    // День 0 следующего месяца - последний день этого; UTC, чтобы не зависеть
    // от зоны сервера.
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// Медиана; при чётном числе значений - среднее двух средних.
function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Накопленный расход месяца по дням: cum[d - 1] - потрачено с 1-го по d-е
// включительно, положительным числом. Расход каждого дня считается тем же
// sumExpense, что и везде.
function cumulativeExpense(monthTransactions, length) {
    const perDay = Array.from({ length }, () => []);
    monthTransactions.forEach(t => {
        const day = parseInt(t.date.slice(8, 10), 10);
        if (day >= 1 && day <= length) perDay[day - 1].push(t);
    });

    let running = 0;
    return perDay.map(dayTransactions => {
        running += -sumExpense(dayTransactions);
        return running;
    });
}

// Месяцы, по которым можно строить «обычное», от новых к старым. Месяц
// полный, только если данные покрывают его целиком: он строго позже месяца
// самой ранней операции либо самая ранняя операция датирована его 1-м числом.
// Иначе у первого месяца истории (завели приложение 9-го) «потрачено» было бы
// занижено и тянуло медиану вниз. Тихие месяцы внутри покрытия считаются
// нулями - это реальные данные, выбрасывать их значило бы завышать «обычное».
//
// Месяц не позже сегодняшнего тоже требуется: при просмотре будущего месяца
// иначе в эталон попали бы идущий (неполный) месяц и пустые будущие.
function pickReferenceMonths(transactions, month, today) {
    const earliest = transactions.reduce((min, t) => (!min || t.date < min) ? t.date : min, null);
    if (!earliest) return [];

    const earliestMonth = earliest.slice(0, 7);
    const earliestIsFirstOfMonth = earliest.slice(8, 10) === '01';
    const todayMonth = today ? String(today).slice(0, 7) : null;

    const [year, mon] = month.split('-').map(Number);
    const result = [];
    for (let i = 1; result.length < REFERENCE_MONTHS; i += 1) {
        const shifted = shiftMonth(year, mon, -i);
        const str = monthStr(shifted.year, shifted.month);
        // Дальше в прошлое данных уже нет - все следующие месяцы тоже пустые.
        if (str < earliestMonth) break;
        if (todayMonth && str >= todayMonth) continue;

        const isFull = str > earliestMonth || earliestIsFirstOfMonth;
        if (isFull) result.push(str);
    }
    return result;
}

function computeTypicalMonth(transactions, { month, today, account = null, category = null }) {
    const referenceMonths = pickReferenceMonths(transactions, month, today);
    if (referenceMonths.length < MIN_REFERENCE_MONTHS) return null;

    const filtered = applyFilters(transactions, { account, category });
    const byMonth = referenceMonths.map(str => {
        const length = daysInMonth(str);
        const cum = cumulativeExpense(filtered.filter(t => t.date.startsWith(str)), length);
        return { length, cum, total: cum[length - 1] };
    });

    // Последний день выбранного месяца всегда соответствует последнему дню
    // эталонного (иначе в 28-дневном феврале «конец месяца» брал бы 28-е
    // число 31-дневного, и прогноз терял бы три дня трат). Дни 29-31,
    // которых нет в коротком эталонном месяце, приравниваются к его
    // последнему дню.
    const selectedLength = daysInMonth(month);
    const refDay = (d, ref) => (d === selectedLength ? ref.length : Math.min(d, ref.length));
    const cumAt = (d, ref) => ref.cum[refDay(d, ref) - 1];

    const byDay = Array.from({ length: selectedLength }, (_, i) => (
        round2(median(byMonth.map(ref => cumAt(i + 1, ref))))
    ));

    let todayBlock = null;
    if (today && String(today).startsWith(`${month}-`)) {
        const day = parseInt(String(today).slice(8, 10), 10);
        const selectedCum = cumulativeExpense(
            filtered.filter(t => t.date.startsWith(month)),
            selectedLength
        );
        const spent = selectedCum[day - 1];
        // Медиана остатков по месяцам, а не «обычный итог минус обычное к
        // этому дню»: разность двух медиан может не совпасть ни с одним
        // реальным месяцем, а остаток каждого месяца - настоящее число.
        const typicalRemaining = median(byMonth.map(ref => ref.total - cumAt(day, ref)));

        todayBlock = {
            day,
            typicalToDate: byDay[day - 1],
            typicalRemaining: round2(typicalRemaining),
            spent: round2(spent),
            forecast: round2(spent + typicalRemaining)
        };
    }

    return {
        months: referenceMonths,
        byDay,
        monthTotal: round2(median(byMonth.map(ref => ref.total))),
        today: todayBlock
    };
}

module.exports = { computeTypicalMonth };
