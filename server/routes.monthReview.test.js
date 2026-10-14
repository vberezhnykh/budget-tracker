// @vitest-environment node
//
// Роут «Разбора месяца» на настоящей базе: загрузка данных, хранение разбора,
// повторное использование и перегенерация. Claude подменён: createMessage
// передаётся в роутер, как в ask.test.js. Роутер поднят на маленьком
// приложении (без входа), а за входом и ключом в настоящем приложении следят
// два последних теста.

import express from 'express';
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectTestDb, disconnectTestDb, clearCollections, loginAgent, tx, DB_HOOK_TIMEOUT } from './test/harness.js';
import { createMonthReviewRouter } from './monthReview.js';
import { saveCanonicalSettings } from './settingsSingleton.js';

const KEY = 'sk-ant-test-secret-1234567890';
const TODAY = '2026-10-05';
const HOUR = 60 * 60 * 1000;

let app;
let Transaction;
let Account;
let MonthReview;
let card;

beforeAll(async () => {
    app = await connectTestDb('routes-month-review');
    Transaction = mongoose.model('Transaction');
    Account = mongoose.model('Account');
    MonthReview = mongoose.model('MonthReview');
}, DB_HOOK_TIMEOUT);

afterAll(disconnectTestDb, DB_HOOK_TIMEOUT);

afterEach(() => {
    vi.unstubAllEnvs();
});

const expense = (date, amount, category, companyName, extra = {}) => tx({
    type: 'expense', amount, category, companyName, account: card._id.toString(), date: `${date}T00:00:00.000Z`, ...extra
});

// Март - сентябрь 2026: по 100 на продукты в месяц, в сентябре ещё отель на 200.
// Сентябрь: расход 300 при обычных 100, разница 200.
async function seedHistory() {
    card = await Account.create({ name: 'Revolut', type: 'card', order: 1 });
    await Transaction.create([
        tx({ type: 'initial', amount: 1000, category: 'Другое', account: card._id.toString(), date: '2026-03-01T00:00:00.000Z' }),
        ...['03', '04', '05', '06', '07', '08', '09'].map(month => expense(`2026-${month}-10`, 100, 'Продукты', 'Lidl')),
        expense('2026-09-14', 200, 'Отпуск', 'Booking.com', { description: 'Отель' })
    ]);
}

beforeEach(async () => {
    await clearCollections();
    await seedHistory();
    await Promise.all([
        mongoose.model('Category').create([
            { name: 'Продукты', type: 'expense', order: 1 },
            { name: 'Отпуск', type: 'expense', order: 2 }
        ])
    ]);
});

const GOOD = {
    headline: 'Сентябрь: на €200 больше обычного',
    points: [
        { text: 'Расходы составили €300 при обычных €100.', category: null },
        { text: 'Отель Booking.com на €200 в отпуске.', category: 'Отпуск' }
    ]
};
const usage = { input_tokens: 1000, output_tokens: 150 };
const reply = (value) => ({ stop_reason: 'end_turn', usage, content: [{ type: 'text', text: JSON.stringify(value) }] });

// Роутер на своём приложении; clock.now двигает время для лимитов и «свежести» текста.
function setup(options = {}) {
    const clock = { now: Date.parse('2026-10-05T12:00:00Z') };
    const createMessage = options.createMessage || vi.fn(async () => reply(GOOD));
    const lines = [];
    const mini = express();
    mini.use(express.json());
    mini.use('/api/month-review', createMonthReviewRouter({
        createMessage,
        getApiKey: () => KEY,
        rateLimiter: () => true,
        now: () => clock.now,
        timeoutMs: 2000,
        log: (line) => lines.push(line),
        ...options.router
    }));
    return { mini, clock, createMessage, lines, post: (body, target = mini) => request(target).post('/api/month-review').send(body) };
}

const factsOf = (createMessage, call = 0) => {
    const content = createMessage.mock.calls[call][0].messages[0].content;
    return JSON.parse(content.replace(/^<facts>\n/, '').replace(/\n<\/facts>$/, ''));
};

describe('POST /api/month-review: генерация и хранение', () => {
    it('первый запрос пишет разбор, сохраняет его и возвращает', async () => {
        const { post, createMessage, lines, clock } = setup();
        const res = await post({ month: '2026-09', today: TODAY });

        expect(res.status).toBe(200);
        expect(res.headers['cache-control']).toBe('no-store');
        expect(res.body).toEqual({ month: '2026-09', review: GOOD, generatedAt: new Date(clock.now).toISOString(), stale: false });
        expect(createMessage).toHaveBeenCalledTimes(1);
        expect(createMessage.mock.calls[0][0].model).toBe('claude-sonnet-5-5');

        const stored = await MonthReview.findOne({ month: '2026-09' }).lean();
        expect(stored).toMatchObject({ month: '2026-09', model: 'claude-sonnet-5-5', attempts: 1, review: GOOD });
        expect(stored.factsHash).toMatch(/^[0-9a-f]{64}$/);
        expect(stored.generatedAt.getTime()).toBe(clock.now);

        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatch(/^\[month-review\] month=2026-09 outcome=generated attempts=1 ms=\d+$/);
    });

    it('в Claude уходят факты из базы: активные операции, лимит по умолчанию', async () => {
        await Transaction.create(expense('2026-09-20', 5000, 'Отпуск', 'Удалённая', { deletedAt: new Date('2026-09-21T00:00:00Z') }));
        const { post, createMessage } = setup();
        await post({ month: '2026-09', today: TODAY });

        const facts = factsOf(createMessage);
        expect(facts.expense).toMatchObject({ total: 300, typical: 100, diff: 200, diff_pct: 200 });
        expect(facts.limit).toMatchObject({ amount: 7000, spent: 300 });
        expect(facts.largest[0]).toMatchObject({ company: 'Booking.com', one_off: true });
    });

    it('лимит берётся из настроек', async () => {
        await saveCanonicalSettings(3500);
        const { post, createMessage } = setup();
        await post({ month: '2026-09', today: TODAY });

        expect(factsOf(createMessage).limit).toEqual({ amount: 3500, spent: 300, left: 3200, used_pct: 9 });
    });

    it('MONTH_REVIEW_MODEL задаёт модель', async () => {
        vi.stubEnv('MONTH_REVIEW_MODEL', 'claude-test-model');
        const { post, createMessage } = setup({ router: { getModel: undefined } });
        await post({ month: '2026-09', today: TODAY });

        expect(createMessage.mock.calls[0][0].model).toBe('claude-test-model');
        expect((await MonthReview.findOne({ month: '2026-09' }).lean()).model).toBe('claude-test-model');
    });

    it('второй запрос отдаёт сохранённое без Claude и не тратит дневной лимит', async () => {
        const { post, createMessage, lines } = setup({ router: { dailyLimit: 1 } });
        const first = await post({ month: '2026-09', today: TODAY });
        const second = await post({ month: '2026-09', today: TODAY });
        const third = await post({ month: '2026-09', today: TODAY });

        expect(createMessage).toHaveBeenCalledTimes(1);
        expect(second.status).toBe(200);
        expect(second.body).toEqual(first.body);
        expect(third.body).toEqual(first.body);
        expect(lines.map(line => line.match(/outcome=(\S+)/)[1])).toEqual(['generated', 'cached', 'cached']);
    });

    it('неизменные факты не требуют новой генерации и после minRegenerateMs', async () => {
        const { post, createMessage, clock } = setup();
        await post({ month: '2026-09', today: TODAY });
        clock.now += 48 * HOUR;
        const res = await post({ month: '2026-09', today: TODAY });

        expect(res.body.stale).toBe(false);
        expect(createMessage).toHaveBeenCalledTimes(1);
    });

    it('операции после месяца текст сентября не пересоздают', async () => {
        const { post, createMessage, clock } = setup();
        await post({ month: '2026-09', today: TODAY });
        await Transaction.create(expense('2026-10-02', 800, 'Продукты', 'Lidl'));
        clock.now += 48 * HOUR;
        await post({ month: '2026-09', today: TODAY });

        expect(createMessage).toHaveBeenCalledTimes(1);
    });

    it('факты изменились, а текст свежий: stale без генерации; позже - новый текст', async () => {
        const { post, createMessage, clock, lines } = setup();
        const first = await post({ month: '2026-09', today: TODAY });
        await Transaction.create(expense('2026-09-25', 50, 'Продукты', 'Lidl'));

        clock.now += 10 * 60 * 1000;
        const stale = await post({ month: '2026-09', today: TODAY });
        expect(stale.status).toBe(200);
        expect(stale.body).toEqual({ ...first.body, stale: true });
        expect(createMessage).toHaveBeenCalledTimes(1);

        const before = await MonthReview.findOne({ month: '2026-09' }).lean();
        clock.now += HOUR;
        createMessage.mockResolvedValueOnce(reply({ headline: 'Сентябрь: на €250 больше обычного', points: [{ text: 'Расходы составили €350 при обычных €100.', category: null }] }));
        const fresh = await post({ month: '2026-09', today: TODAY });
        expect(fresh.body.stale).toBe(false);
        expect(fresh.body.review.headline).toBe('Сентябрь: на €250 больше обычного');
        expect(createMessage).toHaveBeenCalledTimes(2);
        const after = await MonthReview.find({ month: '2026-09' }).lean();
        expect(after).toHaveLength(1);
        expect(after[0].factsHash).not.toBe(before.factsHash);
        expect(lines.map(line => line.match(/outcome=(\S+)/)[1])).toEqual(['generated', 'stale', 'generated']);
    });

    it('число вне фактов: повтор, в базе attempts 2', async () => {
        const createMessage = vi.fn()
            .mockResolvedValueOnce(reply({ ...GOOD, headline: 'Сентябрь: на €777 больше обычного' }))
            .mockResolvedValueOnce(reply(GOOD));
        const { post, lines } = setup({ createMessage });
        const res = await post({ month: '2026-09', today: TODAY });

        expect(res.body.review).toEqual(GOOD);
        expect(createMessage).toHaveBeenCalledTimes(2);
        expect((await MonthReview.findOne({ month: '2026-09' }).lean()).attempts).toBe(2);
        expect(lines[0]).toContain('outcome=generated attempts=2');
    });

    it('одновременные запросы на один месяц делят одну генерацию', async () => {
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        const createMessage = vi.fn(async () => { await gate; return reply(GOOD); });
        const { mini, post } = setup({ createMessage });
        const server = mini.listen(0, '127.0.0.1');
        await new Promise(resolve => server.once('listening', resolve));
        try {
            const pending = [post({ month: '2026-09', today: TODAY }, server), post({ month: '2026-09', today: TODAY }, server)].map(call => call.then(res => res));
            await vi.waitFor(() => expect(createMessage).toHaveBeenCalledTimes(1));
            // Второй запрос успевает дойти до роутера, пока первый ждёт Claude.
            await new Promise(resolve => setTimeout(resolve, 150));
            release();
            const [a, b] = await Promise.all(pending);
            expect([a.status, b.status]).toEqual([200, 200]);
            expect(a.body.review).toEqual(GOOD);
            expect(b.body.review).toEqual(GOOD);
            expect(createMessage).toHaveBeenCalledTimes(1);
            expect(await MonthReview.countDocuments()).toBe(1);
        } finally {
            server.closeAllConnections();
            await new Promise(resolve => server.close(resolve));
        }
    });
});

describe('POST /api/month-review: ошибки Claude', () => {
    const failing = (error) => vi.fn(async () => { throw error; });

    it('сбой при сохранённом разборе: он возвращается со stale', async () => {
        const { post, createMessage, clock } = setup();
        const first = await post({ month: '2026-09', today: TODAY });
        await Transaction.create(expense('2026-09-25', 50, 'Продукты', 'Lidl'));
        clock.now += 2 * HOUR;
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        createMessage.mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 500 }));
        const res = await post({ month: '2026-09', today: TODAY });
        spy.mockRestore();

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ ...first.body, stale: true });
    });

    it('сбой без сохранённого: 502, 429 с Retry-After, 504 по времени; ничего не сохраняется', async () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            const failed = await setup({ createMessage: failing(Object.assign(new Error('boom'), { status: 500 })) }).post({ month: '2026-09', today: TODAY });
            expect(failed.status).toBe(502);
            expect(failed.body.code).toBe('MONTH_REVIEW_FAILED');
            expect(JSON.stringify(failed.body)).not.toContain('boom');

            const limited = await setup({ createMessage: failing(Object.assign(new Error('slow down'), { status: 429 })) }).post({ month: '2026-09', today: TODAY });
            expect(limited.status).toBe(429);
            expect(limited.body.code).toBe('MONTH_REVIEW_RATE_LIMITED');
            expect(limited.headers['retry-after']).toBe('60');

            const hang = vi.fn((params, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))));
            const slow = await setup({ createMessage: hang, router: { timeoutMs: 30 } }).post({ month: '2026-09', today: TODAY });
            expect(slow.status).toBe(504);
            expect(slow.body.code).toBe('MONTH_REVIEW_TIMEOUT');

            expect(await MonthReview.countDocuments()).toBe(0);
        } finally {
            spy.mockRestore();
        }
    });

    it('чужие числа и во втором ответе: 502, ничего не сохраняется', async () => {
        const createMessage = vi.fn(async () => reply({ ...GOOD, headline: 'Сентябрь: на €777 больше' }));
        const { post, lines } = setup({ createMessage });
        const res = await post({ month: '2026-09', today: TODAY });

        expect(res.status).toBe(502);
        expect(createMessage).toHaveBeenCalledTimes(2);
        expect(await MonthReview.countDocuments()).toBe(0);
        expect(lines[0]).toContain('outcome=MONTH_REVIEW_FAILED attempts=2');
    });

    it('дневной лимит: 429 без сохранённого, а сохранённый отдаётся со stale', async () => {
        const { post, createMessage, clock } = setup({ router: { dailyLimit: 1 } });
        await post({ month: '2026-09', today: TODAY });

        const other = await post({ month: '2026-08', today: TODAY });
        expect(other.status).toBe(429);
        expect(other.body.code).toBe('MONTH_REVIEW_RATE_LIMITED');

        await Transaction.create(expense('2026-09-25', 50, 'Продукты', 'Lidl'));
        clock.now += 2 * HOUR;
        const stale = await post({ month: '2026-09', today: TODAY });
        expect(stale.status).toBe(200);
        expect(stale.body.stale).toBe(true);
        expect(createMessage).toHaveBeenCalledTimes(1);
    });

    it('в журнале нет текстов и сумм', async () => {
        const { post, lines } = setup();
        await post({ month: '2026-09', today: TODAY });
        expect(lines.join('\n')).not.toMatch(/Booking|Сентябрь|€|300/);
    });
});

describe('POST /api/month-review: проверка запроса', () => {
    it('нет ключа - 503, Claude не вызывается', async () => {
        const { post, createMessage } = setup({ router: { getApiKey: () => '  ' } });
        const res = await post({ month: '2026-09', today: TODAY });

        expect(res.status).toBe(503);
        expect(res.body.code).toBe('MONTH_REVIEW_UNAVAILABLE');
        expect(createMessage).not.toHaveBeenCalled();
    });

    it('идущий, будущий и неверный месяц - 400', async () => {
        const { post, createMessage } = setup();
        for (const month of ['2026-10', '2026-11', '2027-01', '2026-13', '2026-9', '', null, 202609, undefined]) {
            const res = await post({ month, today: TODAY });
            expect(res.status, String(month)).toBe(400);
            expect(res.body.code).toBe('MONTH_REVIEW_MONTH_INVALID');
        }
        expect(createMessage).not.toHaveBeenCalled();
    });

    it('неверная сегодняшняя дата - 400', async () => {
        const { post } = setup();
        for (const today of ['2026-02-30', '05.10.2026', '', null, undefined]) {
            const res = await post({ month: '2026-09', today });
            expect(res.status).toBe(400);
            expect(res.body.code).toBe('MONTH_REVIEW_DATE_INVALID');
        }
    });

    it('мало истории - not_enough_history, Claude не вызывается', async () => {
        const { post, createMessage, lines } = setup();
        const res = await post({ month: '2026-05', today: TODAY });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ month: '2026-05', review: null, reason: 'not_enough_history' });
        expect(createMessage).not.toHaveBeenCalled();
        expect(await MonthReview.countDocuments()).toBe(0);
        expect(lines[0]).toContain('outcome=not_enough_history attempts=0');
    });
});

describe('в настоящем приложении', () => {
    it('без входа - 401', async () => {
        const res = await request(app).post('/api/month-review').send({ month: '2026-09', today: TODAY });
        expect(res.status).toBe(401);
    });

    it('после входа без ключа Anthropic - 503, с ключом разбор включён в настройках', async () => {
        const agent = await loginAgent(app);
        vi.stubEnv('ANTHROPIC_API_KEY', '');
        // Настоящий роутер пишет строку журнала в console.info.
        const info = vi.spyOn(console, 'info').mockImplementation(() => {});
        const res = await agent.post('/api/month-review').send({ month: '2026-09', today: TODAY });
        info.mockRestore();
        expect(res.status).toBe(503);
        expect(res.body.code).toBe('MONTH_REVIEW_UNAVAILABLE');

        vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
        expect((await agent.get('/api/settings')).body.features.monthReview).toBe(true);
    });
});
