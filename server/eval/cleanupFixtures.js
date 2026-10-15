// Данные для оценки «Чистки старых описаний»: те же выдуманные два года, что у
// остальных оценок (fixtures.js), но расходы с 2024-10-01 по 2025-01-31 стали
// «старыми записями» - без companyName и companyId, с текстом в title (иногда в
// описании). Остальные оценки берут fixtures.js как есть и этим файлом не
// затронуты.
//
// Часть расходов получает тексты из списка ниже вместе с правильным ответом;
// остальные расходы периода сохраняют название своей компании как текст (их
// ответ - «это компания из справочника», он находится без Claude).
//
// Компания «Парковка» из справочника убрана: парковка в списке - не компания,
// а вид расходов, и иначе точное совпадение сделало бы её компанией.

const { buildFixtures } = require('./fixtures');
const { normalizeCompanyName } = require('../companies');

const FROM = '2024-10-01';
const TO = '2025-01-31';

// Расходы, у которых название компании - постоянный регулярный платёж; они
// не отдаются под тексты списка, пока хватает других.
const KEEP = new Set(['Арендодатель', 'ΔΕΗ', 'OASA']);
const REMOVED_COMPANIES = new Set(['Парковка']);

const existing = (company, note = null) => ({ kind: 'existing', company, note });
const created = (company, note = null) => ({ kind: 'new', company, note });
const note = () => ({ kind: 'note', company: null, note: null });

// text - как записано в старой операции; company/category - откуда брать
// операции (название прежней компании или категория); field - где лежит
// текст ('title' по умолчанию); uses - сколько операций с этим текстом.
const CLEANUP_TEXTS = [
    // Компании справочника в разных написаниях.
    { text: 'LIDL NICOSIA', company: 'Lidl', expect: existing('Lidl') },
    { text: 'Лидл', company: 'Lidl', expect: existing('Lidl') },
    { text: 'lidl', company: 'Lidl', expect: existing('Lidl') },
    { text: 'Lidl продукты на неделю', company: 'Lidl', field: 'description', expect: existing('Lidl', 'продукты на неделю') },
    { text: 'ΣΚΛΑΒΕΝΙΤΗΣ', company: 'Sklavenitis', expect: existing('Sklavenitis') },
    { text: 'Склавенитис', company: 'Sklavenitis', expect: existing('Sklavenitis') },
    { text: 'АБ Василопулос', company: 'AB Vassilopoulos', expect: existing('AB Vassilopoulos') },
    { text: 'Старбакс', company: 'Starbucks', expect: existing('Starbucks') },
    { text: 'Starbucks кофе', company: 'Starbucks', field: 'description', expect: existing('Starbucks', 'кофе') },
    { text: 'Coffee Island', company: 'Coffee Island', expect: existing('Coffee Island') },
    { text: 'болт такси', company: 'Bolt', expect: existing('Bolt', 'такси') },
    { text: 'Uber поездка в аэропорт', company: 'Uber', field: 'description', expect: existing('Uber', 'поездка в аэропорт') },
    { text: 'Shell', company: 'Shell', expect: existing('Shell') },
    { text: 'EKO заправка', company: 'EKO', expect: existing('EKO', 'заправка') },
    { text: 'Нетфликс', company: 'Netflix', expect: existing('Netflix') },
    { text: 'Spotify', company: 'Spotify', expect: existing('Spotify') },
    { text: 'Cosmote', company: 'Cosmote', expect: existing('Cosmote') },
    { text: 'аптека Пападопулос', company: 'Аптека Пападопулос', expect: existing('Аптека Пападопулос') },
    { text: 'Zara', company: 'Zara', expect: existing('Zara') },
    { text: 'Ryanair билеты', category: 'Отпуск', expect: existing('Ryanair', 'билеты') },
    { text: 'Букинг', category: 'Отпуск', expect: existing('Booking.com') },
    { text: 'Jumbo', company: 'Jumbo', expect: existing('Jumbo') },
    // Компании, которых в справочнике нет.
    { text: 'Вольт', category: 'Кафе и досуг', expect: created('Wolt') },
    { text: 'Wolt доставка', category: 'Кафе и досуг', field: 'description', expect: created('Wolt', 'доставка') },
    { text: 'ИКЕА', category: 'Техника', expect: created('IKEA') },
    { text: 'Бургер Кинг', category: 'Кафе и досуг', expect: created('Burger King') },
    // Не компании: виды расходов, места, поводы, несколько вещей в одном тексте.
    { text: 'Продукты', category: 'Продукты', uses: 4, expect: note() },
    { text: 'Обед', category: 'Кафе и досуг', uses: 3, expect: note() },
    { text: 'Бензин', category: 'Авто', uses: 3, expect: note() },
    { text: 'Такси', category: 'Транспорт', uses: 3, expect: note() },
    { text: 'Ужин, машина', category: 'Кафе и досуг', expect: note() },
    { text: 'Продукты, ИКЕА, кофе', category: 'Продукты', expect: note() },
    { text: 'Кальянная', category: 'Кафе и досуг', expect: note() },
    { text: 'Маникюр, продукты', category: 'Здоровье', expect: note() },
    { text: 'подарок маме', category: 'Подарки', field: 'description', expect: note() },
    { text: 'ТО машины', category: 'Авто', expect: note() },
    { text: 'Парковка', company: 'Парковка', uses: 3, expect: note() },
    { text: 'Кино', category: 'Кафе и досуг', expect: note() },
    { text: 'Такси, продукты', category: 'Транспорт', expect: note() },
    { text: 'Кофе', category: 'Кафе и досуг', expect: note() },

    // Отложенные тексты (heldOut): ни один из них не встречается в подсказке
    // (descriptionCleanup.js), поэтому по ним видно, насколько ответ держится
    // на понимании, а не на примерах. Операции берутся с конца периода.
    { text: 'Лидль', heldOut: true, company: 'Lidl', expect: existing('Lidl') },
    { text: 'старбакс кофе', heldOut: true, company: 'Starbucks', field: 'description', expect: existing('Starbucks', 'кофе') },
    { text: 'σκλαβενίτης', heldOut: true, company: 'Sklavenitis', expect: existing('Sklavenitis') },
    { text: 'AB VASSILOPOULOS ΛΕΜΕΣΟΣ', heldOut: true, company: 'AB Vassilopoulos', expect: existing('AB Vassilopoulos') },
    { text: 'болт', heldOut: true, company: 'Bolt', expect: existing('Bolt') },
    { text: 'COSMOTE ΛΟΓΑΡΙΑΣΜΟΣ', heldOut: true, company: 'Cosmote', expect: existing('Cosmote', 'λογαριασμός') },
    { text: 'Шелл заправка', heldOut: true, company: 'Shell', expect: existing('Shell', 'заправка') },
    { text: 'Spotify Premium', heldOut: true, company: 'Spotify', field: 'description', expect: existing('Spotify', 'Premium') },
    { text: 'booking отель', heldOut: true, category: 'Отпуск', expect: existing('Booking.com', 'отель') },
    { text: 'Леруа Мерлен', heldOut: true, category: 'Техника', expect: created('Leroy Merlin') },
    { text: 'H&M футболки', heldOut: true, category: 'Одежда', expect: created('H&M', 'футболки') },
    { text: 'Decathlon', heldOut: true, category: 'Одежда', expect: created('Decathlon') },
    { text: 'Глово', heldOut: true, category: 'Кафе и досуг', expect: created('Glovo') },
    { text: 'кофе с собой', heldOut: true, category: 'Кафе и досуг', expect: note() },
    { text: 'Продукты и бытовая химия', heldOut: true, category: 'Продукты', expect: note() },
    { text: 'стрижка', heldOut: true, category: 'Здоровье', expect: note() },
    { text: 'врач', heldOut: true, category: 'Здоровье', expect: note() },
    { text: 'Цветы', heldOut: true, category: 'Подарки', expect: note() },
    { text: 'Бензин+мойка', heldOut: true, category: 'Авто', expect: note() },
    { text: 'Подарок на ДР', heldOut: true, category: 'Подарки', field: 'description', expect: note() },
    // Трудные: внимательный человек отнес бы их к заметкам.
    { text: 'Аптека', heldOut: true, hard: true, category: 'Здоровье', expect: note() },
    { text: 'Lidl + Sklavenitis', heldOut: true, hard: true, category: 'Продукты', expect: note() }
];

// Категория операций, если текст берётся по компании, а такой компании в периоде не хватило.
const COMPANY_CATEGORY = {
    Lidl: 'Продукты', Sklavenitis: 'Продукты', 'AB Vassilopoulos': 'Продукты',
    Starbucks: 'Кафе и досуг', 'Coffee Island': 'Кафе и досуг',
    Bolt: 'Транспорт', Uber: 'Транспорт', Shell: 'Авто', EKO: 'Авто', 'Парковка': 'Авто',
    Netflix: 'Связь и подписки', Spotify: 'Связь и подписки', Cosmote: 'Связь и подписки',
    'Аптека Пападопулос': 'Здоровье', Zara: 'Одежда', Jumbo: 'Подарки'
};

const keyOf = (text) => normalizeCompanyName(text).normalizedName;
const dayOf = (date) => date.toISOString().slice(0, 10);

// Дублирует fixtures.js, но с тестовыми «старыми» записями и ожидаемыми
// ответами: { ...fixtures, expected: Map(key -> { text, kind, company, note, origin }) }.
function buildCleanupFixtures() {
    const base = buildFixtures();
    const companies = base.companies.filter(company => !REMOVED_COMPANIES.has(company.name));

    const transactions = base.transactions.map(doc => ({ ...doc }));
    const inRange = transactions.filter(doc => doc.type === 'expense' && dayOf(doc.date) >= FROM && dayOf(doc.date) <= TO);
    const originalCompany = new Map(inRange.map(doc => [doc._id, doc.companyName]));
    const used = new Set();
    const expected = new Map();

    const take = (spec, count, fromEnd = false) => {
        const free = inRange.filter(doc => !used.has(doc._id));
        if (fromEnd) free.reverse();
        const category = spec.category || COMPANY_CATEGORY[spec.company];
        const own = free.filter(doc => (spec.company ? originalCompany.get(doc._id) === spec.company : doc.category === category));
        const picked = own.slice(0, count);
        if (picked.length < count) {
            // Не хватило операций нужной компании или категории: берём любые другие,
            // кроме регулярных платежей, и ставим им категорию текста.
            const rest = free.filter(doc => !picked.includes(doc) && !KEEP.has(originalCompany.get(doc._id)));
            picked.push(...rest.slice(0, count - picked.length).map((doc) => { doc.category = category; return doc; }));
        }
        return picked;
    };

    for (const spec of CLEANUP_TEXTS) {
        for (const doc of take(spec, spec.uses || 2, spec.heldOut)) {
            used.add(doc._id);
            doc.title = spec.field === 'description' ? doc.category : spec.text;
            if (spec.field === 'description') doc.description = spec.text;
            else delete doc.description;
            delete doc.companyName;
            delete doc.companyId;
        }
        expected.set(keyOf(spec.text), { text: spec.text, ...spec.expect, heldOut: Boolean(spec.heldOut), hard: Boolean(spec.hard), origin: 'list' });
    }

    // Остальные расходы периода - просто название компании.
    const directory = new Map(companies.map(company => [company.normalizedName, company.name]));
    for (const doc of inRange) {
        if (used.has(doc._id)) continue;
        const name = originalCompany.get(doc._id);
        doc.title = name;
        delete doc.description;
        delete doc.companyName;
        delete doc.companyId;
        const key = keyOf(name);
        if (expected.has(key)) continue;
        expected.set(key, directory.has(key)
            ? { text: name, kind: 'existing', company: directory.get(key), note: null, origin: 'company' }
            : { text: name, ...note(), origin: 'company' });
    }

    return { ...base, companies, transactions, expected };
}

module.exports = { CLEANUP_TEXTS, buildCleanupFixtures, FROM, TO };
