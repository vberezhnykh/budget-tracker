// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
    allowedNumbers,
    buildMonthFacts,
    buildMonthReviewPrompt,
    buildReviewSchema,
    findUnknownDates,
    findUnknownNumbers,
    generateMonthReview,
    hashFacts,
    sanitizeReview
} from './monthReview.js';

const TODAY = '2026-10-05';
const MONTH = '2026-09';
const accounts = [{ _id: 'acc-card', name: 'Revolut', type: 'card' }];

let sequence = 0;
// Сырой документ операции, как он приходит из базы.
const doc = (type, date, amount, category, extra = {}) => {
    sequence += 1;
    return { _id: `d${sequence}`, type, amount, category, account: 'acc-card', date: `${date}T00:00:00.000Z`, title: category, ...extra };
};
const spend = (date, amount, category, company, extra = {}) => doc('expense', date, amount, category, { companyName: company, ...extra });
const earn = (date, amount) => doc('income', date, amount, 'Зарплата');
const initial = (date) => doc('initial', date, 1000, 'Другое');

const build = (docs, patch = {}) => buildMonthFacts({ docs, accounts, monthlyLimit: 3500, month: MONTH, today: TODAY, ...patch });

// Март - август 2026: шесть эталонных месяцев для сентября.
const referenceMonths = ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08'];

function scenarioDocs() {
    const docs = [initial('2026-03-01')];
    for (const month of [...referenceMonths, MONTH]) {
        docs.push(spend(`${month}-01`, 1000, 'Жилье', 'Арендодатель', { description: 'Аренда' }));
        docs.push(earn(`${month}-25`, month === MONTH ? 3200 : 3000));
    }
    // Продукты по 100 в месяц, в сентябре 150 двумя операциями.
    for (const month of referenceMonths) docs.push(spend(`${month}-10`, 100, 'Продукты', 'Lidl'));
    docs.push(spend('2026-09-10', 90, 'Продукты', 'Lidl'), spend('2026-09-17', 60, 'Продукты', 'lidl '));
    // Авто по 50 в каждом эталонном месяце, в сентябре ничего.
    for (const month of referenceMonths) docs.push(spend(`${month}-12`, 50, 'Авто', 'Shell'));
    // Подписки: Netflix 13,99 июнь - август и 15,99 в сентябре, Spotify в сентябре не списался.
    for (const month of ['2026-06', '2026-07', '2026-08']) {
        docs.push(spend(`${month}-08`, 13.99, 'Связь и подписки', 'Netflix'));
        docs.push(spend(`${month}-10`, 10.99, 'Связь и подписки', 'Spotify'));
    }
    docs.push(spend('2026-09-08', 15.99, 'Связь и подписки', 'Netflix'));
    // Отпуск: в августе 300, в остальных эталонных месяцах нули, в сентябре отель.
    docs.push(spend('2026-08-05', 300, 'Отпуск', 'Ryanair'));
    docs.push(spend('2026-09-14', 1200, 'Отпуск', 'Booking.com', { description: 'Отель, Крит' }));
    // Одежда была только в марте и августе: медиана с нулями равна нулю.
    docs.push(spend('2026-03-20', 40, 'Одежда', 'Zara'), spend('2026-08-20', 60, 'Одежда', 'Zara'));
    // Старая операция без компании: название берётся из заметки или заголовка.
    docs.push(doc('expense', '2026-09-20', 20, 'Другое', { title: 'Разное' }));
    // Не расход: перевод, операция «не в статистике», операции после сентября и вне эталона.
    docs.push(doc('transfer', '2026-09-03', 5000, undefined, { toAccount: 'acc-other' }));
    docs.push(spend('2026-09-19', 700, 'Кафе', 'Taverna', { excludeFromStats: true }));
    docs.push(spend('2026-10-02', 9999, 'Отпуск', 'Octopus'));
    return docs;
}

const facts = build(scenarioDocs());

describe('buildMonthFacts: когда месяц не разбирается', () => {
    it('идущий и будущий месяц - null', () => {
        expect(build(scenarioDocs(), { month: '2026-10' })).toBeNull();
        expect(build(scenarioDocs(), { month: '2026-11' })).toBeNull();
    });

    it('меньше трёх полных эталонных месяцев - null', () => {
        const docs = scenarioDocs().filter(t => t.date >= '2026-07-01');
        docs.push(initial('2026-07-01'));
        expect(build(docs)).toBeNull();
    });

    it('сегодняшний месяц даёт null и когда сентябрь уже прошёл на день', () => {
        expect(build(scenarioDocs(), { today: '2026-09-30' })).toBeNull();
        expect(build(scenarioDocs(), { today: '2026-10-01' })).not.toBeNull();
    });

    it('неверный месяц или дата - null', () => {
        expect(build(scenarioDocs(), { month: '2026-9' })).toBeNull();
        expect(build(scenarioDocs(), { today: '2026-13-01' })).toBeNull();
    });
});

describe('buildMonthFacts: итоги', () => {
    it('месяц и подпись, эталонные месяцы от computeTypicalMonth', () => {
        expect(facts.month).toBe('2026-09');
        expect(facts.month_label).toBe('сентябрь 2026');
        expect(facts.reference_months).toEqual([...referenceMonths].reverse());
    });

    it('расход: переводы и «не в статистике» не входят, обычный - медиана месяцев', () => {
        // Сентябрь: 1000 + 150 + 15,99 + 1200 + 20.
        expect(facts.expense).toEqual({ total: 2385.99, count: 6, typical: 1174.98, diff: 1211.01, diff_pct: 103 });
    });

    it('доход: обычный - медиана месячных доходов', () => {
        expect(facts.income).toEqual({ total: 3200, count: 1, typical: 3000, diff: 200, diff_pct: 7 });
    });

    it('лимит входит в факты, только когда превышен: остаток со знаком, процент целым', () => {
        expect(build(scenarioDocs(), { monthlyLimit: 2000 }).limit).toEqual({ amount: 2000, spent: 2385.99, left: -385.99, used_pct: 119 });
    });

    it('лимит не превышен или потрачен ровно - limit null', () => {
        expect(facts.limit).toBeNull();
        expect(build(scenarioDocs(), { monthlyLimit: 2385.99 }).limit).toBeNull();
        expect(build(scenarioDocs(), { monthlyLimit: 2385.98 }).limit).toMatchObject({ left: -0.01 });
    });

    it('без допустимого лимита limit - null', () => {
        for (const monthlyLimit of [undefined, null, 0, -5, NaN, '3500']) {
            expect(build(scenarioDocs(), { monthlyLimit }).limit).toBeNull();
        }
    });

    it('если обычный расход нулевой, процента нет', () => {
        const docs = [initial('2026-03-01'), earn('2026-04-10', 100), spend('2026-09-10', 50, 'Продукты', 'Lidl')];
        const quiet = build(docs);
        expect(quiet.expense).toEqual({ total: 50, count: 1, typical: 0, diff: 50, diff_pct: null });
    });

    it('операции после месяца факты месяца не меняют', () => {
        const later = [...scenarioDocs(), spend('2026-10-03', 400, 'Продукты', 'Lidl'), spend('2026-11-03', 400, 'Продукты', 'Lidl')];
        expect(hashFacts(build(later))).toBe(hashFacts(facts));
    });
});

describe('buildMonthFacts: категории', () => {
    it('по убыванию |diff|, при равенстве по сумме; нули в медиане считаются', () => {
        expect(facts.categories.map(category => category.name)).toEqual(['Отпуск', 'Продукты', 'Авто', 'Другое', 'Связь и подписки', 'Жилье']);
        const byName = Object.fromEntries(facts.categories.map(category => [category.name, category]));
        // Отпуск: [0, 0, 0, 0, 0, 300] - медиана 0, а не 300.
        expect(byName['Отпуск']).toEqual({ name: 'Отпуск', total: 1200, typical: 0, diff: 1200, diff_pct: null, count: 1, months_with_spending: 1 });
        expect(byName['Продукты']).toEqual({ name: 'Продукты', total: 150, typical: 100, diff: 50, diff_pct: 50, count: 2, months_with_spending: 6 });
        // Пропавшая категория: потрачено 0, обычно 50.
        expect(byName['Авто']).toEqual({ name: 'Авто', total: 0, typical: 50, diff: -50, diff_pct: -100, count: 0, months_with_spending: 6 });
        expect(byName['Жилье']).toMatchObject({ diff: 0, diff_pct: 0 });
    });

    it('months_with_spending: в скольких эталонных месяцах были траты категории', () => {
        const byName = Object.fromEntries(facts.categories.map(category => [category.name, category]));
        expect(facts.reference_months_count).toBe(6);
        // Отпуск: медиана 0, но траты были в августе - в 1 месяце из 6.
        expect(byName['Отпуск']).toMatchObject({ typical: 0, months_with_spending: 1 });
        expect(byName['Жилье'].months_with_spending).toBe(6);
        expect(byName['Продукты'].months_with_spending).toBe(6);
        expect(byName['Связь и подписки'].months_with_spending).toBe(3);
        // Категория без эталонных трат вовсе.
        expect(byName['Другое'].months_with_spending).toBe(0);
        for (const category of facts.categories) {
            expect(Number.isInteger(category.months_with_spending)).toBe(true);
            expect(category.months_with_spending).toBeLessThanOrEqual(facts.reference_months_count);
        }
    });

    it('months_with_spending не считает переводы и «не в статистике»', () => {
        const docs = [
            initial('2026-03-01'),
            spend('2026-04-10', 50, 'Кафе', 'Taverna', { excludeFromStats: true }),
            spend('2026-05-10', 50, 'Кафе', 'Taverna'),
            spend('2026-09-10', 80, 'Кафе', 'Taverna')
        ];
        expect(build(docs).categories.find(category => category.name === 'Кафе').months_with_spending).toBe(1);
    });

    it('категория без трат в месяце и с нулевой медианой не попадает в список', () => {
        expect(facts.categories.map(category => category.name)).not.toContain('Одежда');
    });

    it('не больше 12 категорий', () => {
        const docs = [initial('2026-03-01')];
        for (let index = 1; index <= 15; index += 1) docs.push(spend('2026-09-10', index, `Кат ${index}`, `Компания ${index}`));
        docs.push(spend('2026-05-10', 1, 'Кат 1', 'Компания 1'));
        const many = build(docs);
        expect(many.categories).toHaveLength(12);
        expect(many.categories[0].name).toBe('Кат 15');
    });
});

describe('buildMonthFacts: крупнейшие операции', () => {
    it('пять самых больших, разовость по компании в эталонных месяцах', () => {
        expect(facts.largest).toEqual([
            { date: '2026-09-14', amount: 1200, category: 'Отпуск', company: 'Booking.com', description: 'Отель, Крит', one_off: true, share_pct: 50 },
            { date: '2026-09-01', amount: 1000, category: 'Жилье', company: 'Арендодатель', description: 'Аренда', one_off: false, share_pct: 42 },
            { date: '2026-09-10', amount: 90, category: 'Продукты', company: 'Lidl', description: '', one_off: false, share_pct: 4 },
            { date: '2026-09-17', amount: 60, category: 'Продукты', company: 'lidl', description: '', one_off: false, share_pct: 3 },
            { date: '2026-09-20', amount: 20, category: 'Другое', company: 'Разное', description: '', one_off: true, share_pct: 1 }
        ]);
    });

    it('операция без названия компании разовая; длинные строки обрезаются', () => {
        const long = 'д'.repeat(300);
        const docs = [initial('2026-03-01'), spend('2026-05-02', 10, 'Продукты', 'Lidl'), spend('2026-09-10', 70, 'Продукты', 'Lidl', { description: long }), spend('2026-09-11', 30, 'Продукты', '   ')];
        const result = build(docs);
        expect(result.largest[0].description.length).toBeLessThanOrEqual(121);
        expect(result.largest.at(-1)).toMatchObject({ company: '', one_off: true });
    });

    it('разовая и по размеру: не меньше чем втрое крупнее самой крупной операции компании за эталон', () => {
        const oneOff = (amount, reference = [100, 60]) => build([
            initial('2026-03-01'),
            ...reference.map((value, index) => spend(`2026-0${4 + index}-05`, value, 'Отпуск', 'Booking.com')),
            spend('2026-09-05', amount, 'Отпуск', 'Booking.com')
        ]).largest[0].one_off;

        expect(oneOff(299.99)).toBe(false);
        expect(oneOff(300)).toBe(true);
        expect(oneOff(1900)).toBe(true);
        // Сравнивается с самой крупной операцией, а не с последней или средней.
        expect(oneOff(250, [100, 60, 20])).toBe(false);
        expect(oneOff(179.99, [60, 20])).toBe(false);
        expect(oneOff(180, [60, 20])).toBe(true);
    });

    it('операции самого месяца с эталоном не сравниваются', () => {
        const docs = [initial('2026-03-01'), spend('2026-05-05', 100, 'Продукты', 'Lidl'), spend('2026-09-05', 250, 'Продукты', 'Lidl'), spend('2026-09-06', 250, 'Продукты', 'Lidl')];
        expect(build(docs).largest.map(item => item.one_off)).toEqual([false, false]);
    });

    it('сравнение компаний без регистра и лишних пробелов', () => {
        const docs = [initial('2026-03-01'), spend('2026-05-02', 60, 'Продукты', ' LIDL  '), spend('2026-09-10', 70, 'Продукты', 'lidl')];
        expect(build(docs).largest[0].one_off).toBe(false);
    });
});

describe('buildMonthFacts: регулярные платежи', () => {
    // По списку сумм на июнь, июль, август (и необязательно сентябрь); null - платежа в месяце нет.
    const recurring = (amounts, { company = 'Gym', category = 'Здоровье' } = {}) => {
        const docs = [initial('2026-03-01')];
        ['2026-06', '2026-07', '2026-08', '2026-09'].forEach((month, index) => {
            [].concat(amounts[index] ?? []).forEach((amount, nth) => docs.push(spend(`${month}-${String(5 + nth).padStart(2, '0')}`, amount, category, company)));
        });
        return build(docs).recurring;
    };

    it('изменившийся платёж: сумма, прошлая сумма, разница и процент', () => {
        expect(recurring([13.99, 13.99, 13.99, 15.99], { company: 'Netflix', category: 'Связь и подписки' }).changed).toEqual([
            { company: 'Netflix', category: 'Связь и подписки', amount: 15.99, previous_amount: 13.99, diff: 2, diff_pct: 14 }
        ]);
    });

    it('не прошедший платёж: обычная сумма - медиана, последняя дата', () => {
        expect(recurring([10.5, 11, 11.5, null], { company: 'Spotify', category: 'Связь и подписки' }).missing).toEqual([
            { company: 'Spotify', category: 'Связь и подписки', usual_amount: 11, last_date: '2026-08-05' }
        ]);
    });

    it('сумма не меняется - платёж нигде не упомянут', () => {
        expect(recurring([20, 20, 20, 20])).toEqual({ changed: [], missing: [] });
    });

    it('порог изменения: не меньше 0,50 и не меньше 3% прошлой суммы', () => {
        expect(recurring([20, 20, 20, 20.4]).changed).toEqual([]);
        expect(recurring([20, 20, 20, 20.6]).changed).toHaveLength(1);
        expect(recurring([100, 100, 100, 102.5]).changed).toEqual([]);
        expect(recurring([100, 100, 100, 103]).changed).toHaveLength(1);
        expect(recurring([100, 100, 100, 97]).changed[0]).toMatchObject({ diff: -3, diff_pct: -3 });
    });

    it('устойчивость: все три суммы в пределах ±5% от медианы (граница входит)', () => {
        expect(recurring([47.5, 50, 52.5, null]).missing).toHaveLength(1);
        expect(recurring([47.4, 50, 52.5, null]).missing).toEqual([]);
        expect(recurring([47.5, 50, 52.6, null]).missing).toEqual([]);
        // Прежние ±20%: переменный счет больше не регулярный платеж.
        expect(recurring([40, 50, 60, null]).missing).toEqual([]);
        expect(recurring([60, 90, 110, 70]).changed).toEqual([]);
    });

    it('одна или две операции в каждом из трёх месяцев', () => {
        expect(recurring([[10, 10], 20, 20, null]).missing).toHaveLength(1);
        expect(recurring([[10, 10, 10], 30, 30, null]).missing).toEqual([]);
        expect(recurring([20, null, 20, null]).missing).toEqual([]);
        expect(recurring([null, 20, 20, null]).missing).toEqual([]);
    });

    it('учитываются именно три месяца перед разбираемым', () => {
        const docs = [initial('2026-03-01'), spend('2026-05-05', 20, 'Здоровье', 'Gym'), spend('2026-06-05', 20, 'Здоровье', 'Gym'), spend('2026-07-05', 20, 'Здоровье', 'Gym')];
        expect(build(docs).recurring).toEqual({ changed: [], missing: [] });
    });

    it('переводы и «не в статистике» платежом не считаются', () => {
        const docs = [initial('2026-03-01')];
        for (const month of ['2026-06', '2026-07', '2026-08']) docs.push(spend(`${month}-05`, 20, 'Здоровье', 'Gym', { excludeFromStats: true }));
        expect(build(docs).recurring).toEqual({ changed: [], missing: [] });
    });

    it('сортировка и не больше восьми', () => {
        const docs = [initial('2026-03-01')];
        for (let index = 1; index <= 10; index += 1) {
            for (const month of ['2026-06', '2026-07', '2026-08']) docs.push(spend(`${month}-05`, 10 * index, 'Здоровье', `Сервис ${index}`));
        }
        const result = build(docs).recurring;
        expect(result.missing).toHaveLength(8);
        expect(result.missing.map(item => item.usual_amount)).toEqual([100, 90, 80, 70, 60, 50, 40, 30]);
    });

    it('в общем сценарии: Lidl и Netflix изменились, Shell и Spotify не прошли, аренда не упомянута', () => {
        // Lidl: по 100 раз в месяц, в сентябре две операции на 150 - тоже регулярный платёж, который вырос.
        expect(facts.recurring.changed.map(item => item.company)).toEqual(['lidl', 'Netflix']);
        expect(facts.recurring.missing.map(item => item.company)).toEqual(['Shell', 'Spotify']);
    });
});

describe('findUnknownDates', () => {
    it('дата из фактов (в любом поле) допустима, в любой форме и регистре', () => {
        expect(findUnknownDates('Отель забронирован 14 сентября', facts)).toEqual([]);
        expect(findUnknownDates('Spotify не списался, последний раз 10 августа.', facts)).toEqual([]);
        expect(findUnknownDates('20 Сентября и 01 сентября', facts)).toEqual([]);
        expect(findUnknownDates('Без дат: 14 штук и €1 200', facts)).toEqual([]);
    });

    it('день из фактов, но другой месяц - чужая дата', () => {
        expect(findUnknownDates('Ноутбук в Public 14 августа', facts)).toEqual(['14 августа']);
        expect(findUnknownDates('14 сентября и 14 мая, 14 мая', facts)).toEqual(['14 мая']);
    });

    it('все двенадцать родительных падежей читаются как месяцы', () => {
        const names = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
        const found = findUnknownDates(names.map(name => `3 ${name}`).join(', '), { dates: ['2026-08-05'] });
        expect(found).toEqual(names.map(name => `3 ${name}`));
        expect(findUnknownDates('3 июня', { dates: ['2026-06-03'] })).toEqual([]);
        // не месяц: «3 мая» не находится внутри «3 маяка»
        expect(findUnknownDates('3 маяка', { dates: [] })).toEqual([]);
    });

    it('с годом сверяется и год', () => {
        expect(findUnknownDates('Аренда 1 сентября 2026', facts)).toEqual([]);
        expect(findUnknownDates('Аренда 1 сентября 2025', facts)).toEqual(['1 сентября 2025']);
    });
});

describe('allowedNumbers и findUnknownNumbers', () => {
    it('числа фактов, их модули и округление до евро', () => {
        expect(findUnknownNumbers('Расходы €2 385,99, обычно €1 174,98, на €1 211,01 больше (103%)', facts)).toEqual([]);
        expect(findUnknownNumbers('Это около €2 386, а Netflix стал дороже на €2 (14%)', facts)).toEqual([]);
        expect(findUnknownNumbers('Авто: на €50 меньше обычного', facts)).toEqual([]);
    });

    it('даты: год, месяц и день из фактов', () => {
        expect(findUnknownNumbers('Отель 14 сентября 2026, последний платёж 10 августа', facts)).toEqual([]);
        expect(findUnknownNumbers('Операция 27 сентября', facts)).toEqual([27]);
    });

    it('малые числа 1..12 и число эталонных месяцев всегда допустимы', () => {
        expect(findUnknownNumbers('За 6 месяцев, 3 операции, 12 раз', facts)).toEqual([]);
        expect(findUnknownNumbers('13 раз', facts)).toEqual([13]);
    });

    it('чужие числа находятся, повторы убираются', () => {
        expect(findUnknownNumbers('€777, потом снова €777 и 41%', facts)).toEqual([777, 41]);
    });

    it('сумма с обычным пробелом тысяч не распадается на чужие 200', () => {
        expect(findUnknownNumbers('Отель за €1 200', facts)).toEqual([]);
        expect(findUnknownNumbers('Отель за €1 200 и €2\u00A0385,99', facts)).toEqual([]);
        expect(findUnknownNumbers('Отель за €1 300', facts)).toEqual([1300]);
    });

    it('допуск 0,011: копейки считаются', () => {
        expect(findUnknownNumbers('€15,99', facts)).toEqual([]);
        expect(findUnknownNumbers('€15,9', facts)).toEqual([15.9]);
    });

    it('числа из названий и описаний допустимы', () => {
        const withNote = { ...facts, largest: [{ ...facts.largest[0], description: 'ТО 60 000 км' }] };
        expect(findUnknownNumbers('ТО на 60 000 км', withNote)).toEqual([]);
        expect(allowedNumbers(withNote)).toContain(60000);
    });
});

describe('sanitizeReview', () => {
    const names = ['Отпуск', 'Продукты'];

    it('чистит управляющие символы, NFKC и пробелы; режет по длине', () => {
        const review = sanitizeReview({
            headline: `  Сентябрь\u0000:\n  на\u00A0€210 больше ${'я'.repeat(200)}`,
            points: [{ text: `Ｌidl\tтекст ${'ю'.repeat(400)}`, category: 'Отпуск' }]
        }, names);
        expect(review.headline.length).toBeLessThanOrEqual(100);
        expect(review.headline.startsWith('Сентябрь : на €210 больше')).toBe(true);
        expect(review.points[0].text.startsWith('Lidl текст')).toBe(true);
        expect(review.points[0].text.length).toBeLessThanOrEqual(300);
    });

    it('категория остаётся, только если это известная категория расходов', () => {
        const review = sanitizeReview({
            headline: 'Итог',
            points: [{ text: 'a', category: 'Продукты' }, { text: 'b', category: 'Выдумка' }, { text: 'c', category: null }, { text: 'd' }]
        }, names);
        expect(review.points.map(point => point.category)).toEqual(['Продукты', null, null, null]);
    });

    it('не больше четырёх пунктов, пустые пропускаются', () => {
        const points = [{ text: ' ' }, ...Array.from({ length: 6 }, (_, index) => ({ text: `п${index}`, category: null }))];
        expect(sanitizeReview({ headline: 'Итог', points }, names).points.map(point => point.text)).toEqual(['п0', 'п1', 'п2', 'п3']);
    });

    it('без заголовка, без пунктов или не объект - null', () => {
        expect(sanitizeReview({ headline: ' ', points: [{ text: 'a', category: null }] }, names)).toBeNull();
        expect(sanitizeReview({ headline: 'Итог', points: [] }, names)).toBeNull();
        expect(sanitizeReview({ headline: 'Итог', points: [{ text: ' ', category: null }] }, names)).toBeNull();
        expect(sanitizeReview({ headline: 'Итог' }, names)).toBeNull();
        for (const raw of [null, undefined, 'text', [], 5]) expect(sanitizeReview(raw, names)).toBeNull();
    });
});

describe('подсказка и схема', () => {
    const names = ['Отпуск', 'Продукты'];

    it('факты уходят в сообщении пользователя, правила и категории - в system', () => {
        const { system, user } = buildMonthReviewPrompt(facts, names);
        expect(user).toBe(`<facts>\n${JSON.stringify(facts)}\n</facts>`);
        expect(system).toContain('"Отпуск"');
        expect(system).toContain('Every number you write must appear in the facts');
        expect(system).not.toContain('Booking.com');
        expect(system).toContain('months_with_spending');
        expect(system).toContain('whole euros');
    });

    it('правила про нулевое «обычное» и про лимит', () => {
        const { system } = buildMonthReviewPrompt(facts, names);
        expect(system).not.toContain('обычно здесь 0, траты были');
        expect(system).toContain('never write «обычно здесь 0», «обычно 0»');
        expect(system).toContain('за полгода до этого траты здесь были только в одном месяце');
        expect(system).toContain('в предыдущие полгода трат здесь не было');
        expect(system).toContain('«за предыдущие N месяцев»');
        expect(system).toContain('only when months_with_spending is 0');
        expect(system).toContain('mention the limit only when the facts contain it');
        expect(system).toContain('never make two points about the same category or the same operation');
    });

    it('схема строгая, категория - перечисление или null', () => {
        const schema = buildReviewSchema(names);
        expect(schema.additionalProperties).toBe(false);
        expect(schema.required).toEqual(['headline', 'points']);
        expect(schema.properties.points.items.required).toEqual(['text', 'category']);
        expect(schema.properties.points.items.properties.category.anyOf[0].enum).toEqual(names);
        expect(buildReviewSchema([]).properties.points.items.properties.category).toEqual({ type: 'null' });
    });
});

describe('generateMonthReview', () => {
    const names = ['Отпуск', 'Продукты', 'Жилье'];
    const good = {
        headline: 'Сентябрь: на €1 211 больше обычного',
        points: [
            { text: 'Расходы составили €2 385,99 при обычных €1 174,98.', category: null },
            { text: 'Отель Booking.com на €1 200 в категории «Отпуск».', category: 'Отпуск' }
        ]
    };
    const usage = { input_tokens: 1500, output_tokens: 200 };
    const reply = (value, patch = {}) => ({ stop_reason: 'end_turn', usage, content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }], ...patch });
    const run = (send) => generateMonthReview({ send, model: 'test-model', facts, categoryNames: names, timeoutMs: 1000 });

    it('успех с первого запроса: параметры запроса и расход', async () => {
        const send = vi.fn(async () => reply(good));
        const result = await run(send);

        expect(result).toEqual({ review: good, attempts: 1, usage: [usage], unknownFirst: [] });
        expect(send).toHaveBeenCalledTimes(1);
        const [params, options] = send.mock.calls[0];
        expect(params).toMatchObject({ model: 'test-model', max_tokens: 4000, output_config: { effort: 'medium', format: { type: 'json_schema' } } });
        expect(params.messages).toEqual([{ role: 'user', content: `<facts>\n${JSON.stringify(facts)}\n</facts>` }]);
        expect(typeof params.system).toBe('string');
        expect(options.timeout).toBe(1000);
        expect(options.signal).toBeInstanceOf(AbortSignal);
    });

    it('чужое число в первом ответе: один повтор с перечнем чисел', async () => {
        const invented = { ...good, headline: 'Сентябрь: на €777 больше обычного' };
        const send = vi.fn()
            .mockResolvedValueOnce(reply(invented))
            .mockResolvedValueOnce(reply(good));
        const result = await run(send);

        expect(result).toMatchObject({ review: good, attempts: 2, unknownFirst: [777] });
        expect(result.usage).toHaveLength(2);
        const retry = send.mock.calls[1][0].messages;
        expect(retry).toHaveLength(3);
        expect(retry[1]).toEqual({ role: 'assistant', content: JSON.stringify(invented) });
        expect(retry[2]).toEqual({ role: 'user', content: 'These numbers are not in the facts: 777. Rewrite the review using only numbers that appear in the facts.' });
    });

    it('чужая дата: один повтор с перечнем дат, число 14 при этом допустимо', async () => {
        const wrong = { ...good, points: [{ text: 'Отель Booking.com на €1 200 забронирован 14 августа.', category: 'Отпуск' }, good.points[0]] };
        const fixed = { ...good, points: [{ text: 'Отель Booking.com на €1 200 забронирован 14 сентября.', category: 'Отпуск' }, good.points[0]] };
        const send = vi.fn()
            .mockResolvedValueOnce(reply(wrong))
            .mockResolvedValueOnce(reply(fixed));
        const result = await run(send);

        expect(result).toMatchObject({ review: fixed, attempts: 2, unknownFirst: [] });
        const retry = send.mock.calls[1][0].messages;
        expect(retry[2].role).toBe('user');
        expect(retry[2].content).toContain('These dates are not in the facts: 14 августа.');
        expect(retry[2].content).not.toContain('These numbers');
    });

    it('чужие число и дата вместе: в одной просьбе, а если дата осталась - unknown_numbers', async () => {
        const both = { ...good, headline: 'Сентябрь: на €777 больше обычного', points: [{ text: 'Отель 14 августа.', category: null }] };
        const stillWrongDate = { ...good, points: [{ text: 'Отель 14 августа.', category: null }] };
        const send = vi.fn()
            .mockResolvedValueOnce(reply(both))
            .mockResolvedValueOnce(reply(stillWrongDate));
        const result = await run(send);

        const content = send.mock.calls[1][0].messages[2].content;
        expect(content).toContain('These numbers are not in the facts: 777.');
        expect(content).toContain('These dates are not in the facts: 14 августа.');
        expect(result).toMatchObject({ error: 'unknown_numbers', attempts: 2 });
        expect(send).toHaveBeenCalledTimes(2);
    });

    it('верная дата с годом проходит без повтора', async () => {
        const dated = { ...good, points: [{ text: 'Аренда 1 сентября 2026 на €1 000.', category: null }] };
        const send = vi.fn(async () => reply(dated));
        expect(await run(send)).toMatchObject({ review: dated, attempts: 1 });
    });

    it('повтор тоже с чужим числом - unknown_numbers, третьего запроса нет', async () => {
        const invented = { ...good, headline: 'Сентябрь: на €777 больше обычного' };
        const send = vi.fn(async () => reply(invented));
        const result = await run(send);

        expect(result).toMatchObject({ error: 'unknown_numbers', attempts: 2 });
        expect(result.review).toBeUndefined();
        expect(send).toHaveBeenCalledTimes(2);
    });

    it('невалидный JSON, не тот формат, отказ и обрыв по длине - unparsed без повтора', async () => {
        for (const response of [
            reply('это не JSON'),
            reply({ headline: '', points: [] }),
            reply(good, { stop_reason: 'refusal' }),
            reply(good, { stop_reason: 'max_tokens' }),
            { stop_reason: 'end_turn', usage, content: [] }
        ]) {
            const send = vi.fn(async () => response);
            expect(await run(send)).toMatchObject({ error: 'unparsed', attempts: 1 });
            expect(send).toHaveBeenCalledTimes(1);
        }
    });

    it('невалидный JSON во втором ответе - unparsed на второй попытке', async () => {
        const send = vi.fn()
            .mockResolvedValueOnce(reply({ ...good, headline: 'На €777 больше' }))
            .mockResolvedValueOnce(reply('мусор'));
        expect(await run(send)).toMatchObject({ error: 'unparsed', attempts: 2 });
    });

    it('ошибки запроса: таймаут, лимит Claude, остальное', async () => {
        const fail = (error) => run(vi.fn(async () => { throw error; }));
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            expect(await fail(Object.assign(new Error('x'), { status: 429 }))).toMatchObject({ error: 'rate_limit', attempts: 1 });
            expect(await fail(Object.assign(new Error('x'), { status: 500 }))).toMatchObject({ error: 'failed', attempts: 1 });
            const hang = await generateMonthReview({
                send: (params, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))),
                model: 'm', facts, categoryNames: names, timeoutMs: 20
            });
            expect(hang).toMatchObject({ error: 'timeout', attempts: 1 });
        } finally {
            error.mockRestore();
        }
    });
});
