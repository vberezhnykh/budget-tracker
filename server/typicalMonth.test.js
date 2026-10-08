import { describe, it, expect } from 'vitest';
import { computeTypicalMonth } from './typicalMonth.js';

// Операции в том виде, в каком их отдаёт transformTransactions: считаются
// только visualAmount, type, date, account/accountType, category и
// excludeFromStats.
let seq = 0;
const exp = (date, amount, extra = {}) => ({
    id: `e${seq += 1}`, type: 'expense', visualAmount: -amount, amount, date,
    account: 'acc-card', accountType: 'card', category: 'Продукты', excludeFromStats: false, ...extra
});
// Доход не влияет на расход, но задаёт, с какой даты данные есть, - им
// удобно отмерять «покрытие» истории.
const inc = (date, extra = {}) => ({
    id: `i${seq += 1}`, type: 'income', visualAmount: 10, amount: 10, date,
    account: 'acc-card', accountType: 'card', category: 'Зарплата', excludeFromStats: false, ...extra
});

describe('computeTypicalMonth: медиана', () => {
    it('нечётное число месяцев - средний', () => {
        const data = [
            inc('2026-04-01'),
            exp('2026-04-10', 100), exp('2026-05-10', 300), exp('2026-06-10', 200)
        ];

        const result = computeTypicalMonth(data, { month: '2026-07', today: '2026-07-20' });

        expect(result.months).toEqual(['2026-06', '2026-05', '2026-04']);
        expect(result.monthTotal).toBe(200);
        expect(result.byDay).toHaveLength(31);
        expect(result.byDay[8]).toBe(0);
        expect(result.byDay[9]).toBe(200);
    });

    it('чётное число месяцев - среднее двух средних', () => {
        const data = [
            inc('2026-03-01'),
            exp('2026-03-10', 100), exp('2026-04-10', 300), exp('2026-05-10', 200), exp('2026-06-10', 400)
        ];

        const result = computeTypicalMonth(data, { month: '2026-07', today: '2026-07-20' });

        expect(result.months).toHaveLength(4);
        expect(result.monthTotal).toBe(250);
        expect(result.byDay[9]).toBe(250);
    });

    it('берёт не больше шести месяцев, новые первыми', () => {
        const data = [inc('2025-01-01'), exp('2025-01-05', 1)];

        const result = computeTypicalMonth(data, { month: '2026-07', today: '2026-07-20' });

        expect(result.months).toEqual(['2026-06', '2026-05', '2026-04', '2026-03', '2026-02', '2026-01']);
    });

    it('деньги округляются до копеек', () => {
        const data = [
            inc('2026-04-01'),
            exp('2026-04-10', 0.1), exp('2026-04-10', 0.2),
            exp('2026-05-10', 0.1), exp('2026-05-10', 0.2),
            exp('2026-06-10', 0.1), exp('2026-06-10', 0.2)
        ];

        const result = computeTypicalMonth(data, { month: '2026-07', today: '2026-07-20' });

        expect(result.monthTotal).toBe(0.3);
        expect(result.byDay[9]).toBe(0.3);
    });
});

describe('computeTypicalMonth: какие месяцы считаются полными', () => {
    // Первый месяц истории начат 9-го: до этого трат могло не быть просто
    // потому, что приложения ещё не было.
    const withRows = (start) => [
        inc(start),
        exp('2026-03-20', 100), exp('2026-04-10', 100), exp('2026-05-10', 100), exp('2026-06-10', 100)
    ];

    it('неполный первый месяц не берётся', () => {
        const result = computeTypicalMonth(withRows('2026-03-09'), { month: '2026-07', today: '2026-07-20' });

        expect(result.months).toEqual(['2026-06', '2026-05', '2026-04']);
    });

    it('первый месяц берётся, если история начинается с 1-го числа', () => {
        const result = computeTypicalMonth(withRows('2026-03-01'), { month: '2026-07', today: '2026-07-20' });

        expect(result.months).toEqual(['2026-06', '2026-05', '2026-04', '2026-03']);
    });

    it('меньше трёх полных месяцев - null', () => {
        const data = [inc('2026-05-01'), exp('2026-05-10', 100), exp('2026-06-10', 100)];

        expect(computeTypicalMonth(data, { month: '2026-07', today: '2026-07-20' })).toBeNull();
    });

    it('ровно три полных месяца достаточно', () => {
        const data = [inc('2026-04-01'), exp('2026-05-10', 100)];

        expect(computeTypicalMonth(data, { month: '2026-07', today: '2026-07-20' })).not.toBeNull();
    });

    it('без операций - null', () => {
        expect(computeTypicalMonth([], { month: '2026-07', today: '2026-07-20' })).toBeNull();
    });

    it('тихий месяц внутри истории считается нулями', () => {
        const data = [
            inc('2026-03-01'),
            exp('2026-03-10', 100), exp('2026-06-10', 100)
        ];

        const result = computeTypicalMonth(data, { month: '2026-07', today: '2026-07-20' });

        // Март 100, апрель 0, май 0, июнь 100: без тихих месяцев вышло бы 100.
        expect(result.months).toEqual(['2026-06', '2026-05', '2026-04', '2026-03']);
        expect(result.monthTotal).toBe(50);
    });

    it('при просмотре будущего месяца идущий и будущие месяцы в эталон не попадают', () => {
        const data = [inc('2026-03-01'), exp('2026-07-05', 999)];

        const result = computeTypicalMonth(data, { month: '2026-09', today: '2026-07-10' });

        expect(result.months).toEqual(['2026-06', '2026-05', '2026-04', '2026-03']);
        expect(result.today).toBeNull();
    });
});

describe('computeTypicalMonth: что считается расходом', () => {
    const base = [inc('2026-04-01')];

    it('переводы и «не в статистике» не учитываются', () => {
        const data = [
            ...base,
            exp('2026-04-10', 100), exp('2026-05-10', 100), exp('2026-06-10', 100),
            exp('2026-04-11', 5000, { type: 'transfer', visualAmount: 5000 }),
            exp('2026-05-11', 5000, { excludeFromStats: true }),
            exp('2026-06-11', 5000, { type: 'transfer', visualAmount: -5000 })
        ];

        const result = computeTypicalMonth(data, { month: '2026-07', today: '2026-07-20' });

        expect(result.monthTotal).toBe(100);
    });

    it('доходы не уменьшают расход', () => {
        const data = [...base, exp('2026-04-10', 100), exp('2026-05-10', 100), exp('2026-06-10', 100), inc('2026-05-12')];

        expect(computeTypicalMonth(data, { month: '2026-07', today: '2026-07-20' }).monthTotal).toBe(100);
    });

    it('фильтр по счёту', () => {
        const cash = { account: 'acc-cash', accountType: 'cash' };
        const data = [
            ...base,
            exp('2026-04-10', 100), exp('2026-05-10', 100), exp('2026-06-10', 100),
            exp('2026-04-10', 30, cash), exp('2026-05-10', 30, cash), exp('2026-06-10', 30, cash)
        ];

        const all = computeTypicalMonth(data, { month: '2026-07', today: '2026-07-20' });
        const onlyCash = computeTypicalMonth(data, { month: '2026-07', today: '2026-07-20', account: 'acc-cash' });
        const cashType = computeTypicalMonth(data, { month: '2026-07', today: '2026-07-20', account: 'type:cash' });

        expect(all.monthTotal).toBe(130);
        expect(onlyCash.monthTotal).toBe(30);
        expect(cashType.monthTotal).toBe(30);
    });

    it('покрытие истории считается по всем операциям, а не по отфильтрованным', () => {
        // По наличным в апреле ничего не было, но данные за апрель есть (доход
        // по карте с 1-го числа) - это месяц с нулём, а не отсутствие месяца.
        const data = [
            inc('2026-04-01'),
            exp('2026-05-10', 30, { account: 'acc-cash', accountType: 'cash' }),
            exp('2026-06-10', 30, { account: 'acc-cash', accountType: 'cash' })
        ];

        const result = computeTypicalMonth(data, { month: '2026-07', today: '2026-07-20', account: 'acc-cash' });

        expect(result.months).toEqual(['2026-06', '2026-05', '2026-04']);
        expect(result.monthTotal).toBe(30);
    });

    it('фильтр по категории', () => {
        const data = [
            ...base,
            exp('2026-04-10', 100), exp('2026-05-10', 100), exp('2026-06-10', 100),
            exp('2026-04-10', 40, { category: 'Кафе' }), exp('2026-05-10', 40, { category: 'Кафе' }),
            exp('2026-06-10', 40, { category: 'Кафе' })
        ];

        const result = computeTypicalMonth(data, { month: '2026-07', today: '2026-07-20', category: 'Кафе' });

        expect(result.monthTotal).toBe(40);
        expect(result.today.spent).toBe(0);
    });

    it('фильтры применяются и к расходу выбранного месяца', () => {
        const data = [
            ...base,
            exp('2026-04-10', 100), exp('2026-05-10', 100), exp('2026-06-10', 100),
            exp('2026-07-02', 25, { category: 'Кафе' }), exp('2026-07-03', 70)
        ];

        const result = computeTypicalMonth(data, { month: '2026-07', today: '2026-07-10', category: 'Кафе' });

        expect(result.today.spent).toBe(25);
    });
});

describe('computeTypicalMonth: соответствие дней', () => {
    it('31-дневный месяц против 30-, 31- и 28-дневных эталонных', () => {
        // Эталон: февраль (28), март (31), апрель (30), май (31), июнь (30).
        const data = [
            inc('2026-02-01'),
            exp('2026-02-28', 5), exp('2026-03-28', 7), exp('2026-04-28', 9),
            exp('2026-05-28', 11), exp('2026-06-28', 13),
            exp('2026-03-31', 100)
        ];

        const result = computeTypicalMonth(data, { month: '2026-07', today: '2026-08-01' });

        expect(result.months).toHaveLength(5);
        expect(result.byDay).toHaveLength(31);
        expect(result.byDay[26]).toBe(0);
        expect(result.byDay[27]).toBe(9);
        // 29-е и 30-е: в феврале их нет - берётся его последний день (5).
        expect(result.byDay[28]).toBe(9);
        expect(result.byDay[29]).toBe(9);
        // 31-е - последний день: февраль 5, март 107, апрель и июнь (30 дней)
        // свой последний день 9 и 13, май 11 -> медиана 11.
        expect(result.byDay[30]).toBe(11);
        expect(result.monthTotal).toBe(11);
    });

    it('февраль против 31-дневных: последний день выбранного месяца - это итог эталонных', () => {
        // Эталон: октябрь, ноябрь (30), декабрь, январь. В каждом по 10 на 28-е и
        // по 100 на последний день.
        const data = [
            inc('2025-10-01'),
            exp('2025-10-28', 10), exp('2025-10-31', 100),
            exp('2025-11-28', 10), exp('2025-11-30', 100),
            exp('2025-12-28', 10), exp('2025-12-31', 100),
            exp('2026-01-28', 10), exp('2026-01-31', 100)
        ];

        const result = computeTypicalMonth(data, { month: '2026-02', today: '2026-03-05' });

        expect(result.months).toEqual(['2026-01', '2025-12', '2025-11', '2025-10']);
        expect(result.byDay).toHaveLength(28);
        expect(result.byDay[26]).toBe(0);
        expect(result.byDay[27]).toBe(110);
        expect(result.monthTotal).toBe(110);
    });

    it('переход через год: январь смотрит на декабрь прошлого года', () => {
        const data = [inc('2025-09-01'), exp('2025-10-05', 1)];

        const result = computeTypicalMonth(data, { month: '2026-01', today: '2026-02-01' });

        expect(result.months).toEqual(['2025-12', '2025-11', '2025-10', '2025-09']);
    });
});

describe('computeTypicalMonth: блок today', () => {
    const history = [
        inc('2026-04-01'),
        exp('2026-04-10', 100), exp('2026-05-10', 100), exp('2026-06-10', 100)
    ];

    it('для прошедшего месяца null', () => {
        const result = computeTypicalMonth(history, { month: '2026-07', today: '2026-09-01' });

        expect(result.today).toBeNull();
        expect(result.byDay).toHaveLength(31);
    });

    it('без today блока нет', () => {
        expect(computeTypicalMonth(history, { month: '2026-07', today: null }).today).toBeNull();
    });

    it('для идущего месяца отдаёт день, обычное к дате, остаток, потрачено и прогноз', () => {
        const data = [...history, exp('2026-07-03', 40), exp('2026-07-09', 60), exp('2026-07-11', 500)];

        const result = computeTypicalMonth(data, { month: '2026-07', today: '2026-07-10' });

        expect(result.today).toEqual({
            day: 10,
            typicalToDate: 100,
            typicalRemaining: 0,
            // Трата 11-го ещё не случилась в календаре клиента.
            spent: 100,
            forecast: 100
        });
    });

    it('аренда первого числа: прогноз около обычного итога, а не линейная экстраполяция', () => {
        const rows = [inc('2026-03-01')];
        ['2026-03', '2026-04', '2026-05', '2026-06'].forEach(m => {
            rows.push(exp(`${m}-01`, 1000));
            for (let d = 2; d <= 11; d += 1) rows.push(exp(`${m}-${String(d).padStart(2, '0')}`, 10));
        });
        rows.push(exp('2026-07-01', 1000));
        for (let d = 2; d <= 5; d += 1) rows.push(exp(`2026-07-0${d}`, 10));

        const result = computeTypicalMonth(rows, { month: '2026-07', today: '2026-07-05' });

        expect(result.monthTotal).toBe(1100);
        expect(result.today.spent).toBe(1040);
        expect(result.today.typicalToDate).toBe(1040);
        expect(result.today.forecast).toBe(1100);
        // Линейно вышло бы 1040 / 5 * 31 = 6448.
        expect(result.today.forecast).toBeLessThan(result.monthTotal * 1.1);
    });

    it('остаток - медиана остатков по месяцам, а не итог минус обычное к дате', () => {
        // Остатки после 10-го: апрель 300, май 100, июнь 100.
        const data = [
            inc('2026-04-01'),
            exp('2026-04-05', 100), exp('2026-04-20', 300),
            exp('2026-05-05', 300), exp('2026-05-20', 100),
            exp('2026-06-05', 200), exp('2026-06-20', 100),
            exp('2026-07-04', 150)
        ];

        const result = computeTypicalMonth(data, { month: '2026-07', today: '2026-07-10' });

        expect(result.today.typicalToDate).toBe(200);
        expect(result.monthTotal).toBe(400);
        // Разность медиан дала бы 400 - 200 = 200; медиана остатков - 100.
        expect(result.today.typicalRemaining).toBe(100);
        expect(result.today.spent).toBe(150);
        expect(result.today.forecast).toBe(250);
    });

    it('в последний день месяца остаток по месяцам нулевой', () => {
        const result = computeTypicalMonth(history, { month: '2026-07', today: '2026-07-31' });

        expect(result.today.day).toBe(31);
        expect(result.today.typicalToDate).toBe(100);
        expect(result.today.typicalRemaining).toBe(0);
    });
});

describe('computeTypicalMonth: actualByDay', () => {
    const history = [
        inc('2026-04-01'),
        exp('2026-04-10', 100), exp('2026-05-10', 100), exp('2026-06-10', 100)
    ];

    it('идущий месяц: накопленный расход только за дни до сегодняшнего', () => {
        const data = [...history, exp('2026-07-03', 40), exp('2026-07-03', 10), exp('2026-07-09', 60), exp('2026-07-11', 500)];

        const result = computeTypicalMonth(data, { month: '2026-07', today: '2026-07-10' });

        expect(result.actualByDay).toHaveLength(10);
        expect(result.actualByDay.slice(0, 4)).toEqual([0, 0, 50, 50]);
        expect(result.actualByDay[8]).toBe(110);
        // Последний элемент - то же число, что «потрачено» в блоке today.
        expect(result.actualByDay[9]).toBe(110);
        expect(result.actualByDay[9]).toBe(result.today.spent);
    });

    it('прошедший месяц: весь месяц, последнее значение - его итог', () => {
        const data = [...history, exp('2026-06-30', 25), exp('2026-07-03', 40), exp('2026-07-31', 60)];

        const result = computeTypicalMonth(data, { month: '2026-07', today: '2026-09-01' });

        expect(result.actualByDay).toHaveLength(31);
        expect(result.actualByDay[1]).toBe(0);
        expect(result.actualByDay[2]).toBe(40);
        expect(result.actualByDay[30]).toBe(100);
        expect(result.today).toBeNull();
    });

    it('будущий месяц: пустой массив', () => {
        const result = computeTypicalMonth(history, { month: '2026-08', today: '2026-07-15' });

        expect(result.actualByDay).toEqual([]);
        expect(result.byDay).toHaveLength(31);
    });

    it('длина прошедшего месяца равна числу его дней', () => {
        const result = computeTypicalMonth(history, { month: '2026-09', today: '2026-10-15' });

        expect(result.actualByDay).toHaveLength(30);
    });

    it('те же правила, что у «потрачено»: переводы, «не в статистике», доходы не считаются', () => {
        const data = [
            ...history,
            exp('2026-07-02', 30),
            exp('2026-07-02', 999, { type: 'transfer' }),
            exp('2026-07-03', 999, { excludeFromStats: true }),
            inc('2026-07-04')
        ];

        const result = computeTypicalMonth(data, { month: '2026-07', today: '2026-07-05' });

        expect(result.actualByDay).toEqual([0, 30, 30, 30, 30]);
    });

    it('фильтры счёта и категории применяются к факту', () => {
        const data = [
            ...history,
            exp('2026-07-02', 30, { account: 'acc-cash', accountType: 'cash' }),
            exp('2026-07-02', 20, { category: 'Кафе' })
        ];

        const byAccount = computeTypicalMonth(data, { month: '2026-07', today: '2026-07-03', account: 'acc-cash' });
        const byCategory = computeTypicalMonth(data, { month: '2026-07', today: '2026-07-03', category: 'Кафе' });

        expect(byAccount.actualByDay).toEqual([0, 30, 30]);
        expect(byCategory.actualByDay).toEqual([0, 20, 20]);
    });

    it('суммы округляются до копеек', () => {
        const data = [...history, exp('2026-07-01', 0.1), exp('2026-07-01', 0.2)];

        const result = computeTypicalMonth(data, { month: '2026-07', today: '2026-07-02' });

        expect(result.actualByDay).toEqual([0.3, 0.3]);
    });
});
