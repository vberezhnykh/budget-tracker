// @vitest-environment node
import express from 'express';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuthMiddleware } from './auth.js';
import { createClientErrorRateLimiter } from './operational.js';
import {
    buildReceiptPrompt,
    buildReceiptSchema,
    createQuickEntryRouter,
    sanitizeReceiptDraft
} from './quickEntry.js';

const KEY = 'sk-ant-test-secret-1234567890';
const TODAY = '2026-10-12';
const PHRASE_URL = '/api/quick-entry';
const RECEIPT_URL = '/api/quick-entry/receipt';
const UNPARSED = 'Не удалось прочитать чек. Сфотографируйте его целиком, ровно и при хорошем свете или заполните поля вручную.';

// Не настоящая картинка: серверу важны только первые три байта JPEG.
const jpeg = (size = 64) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(size, 7)]);

const context = {
    categories: [
        { name: 'Продукты', type: 'expense' },
        { name: 'Дом', type: 'expense' },
        { name: 'Кафе', type: 'expense' },
        { name: 'Зарплата', type: 'income' }
    ],
    accounts: [
        { _id: 'acc-cash', name: 'Наличные', type: 'cash' },
        { _id: 'acc-card', name: 'Revolut', type: 'card' }
    ],
    companies: [
        { _id: 'co-2', name: 'Lidl', normalizedName: 'lidl', logoMode: 'category' }
    ]
};

const reply = (draft, extra = {}) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(draft) }], ...extra });
const full = (draft = {}) => ({ amount: null, category: null, splits: null, account: null, date: null, company: null, description: null, ...draft });

function makeApp(options = {}, authenticated = false) {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    if (authenticated) app.use(createAuthMiddleware(false));
    app.use('/api/quick-entry', createQuickEntryRouter({
        getApiKey: () => KEY,
        loadContext: async () => context,
        createMessage: async () => reply(full({ amount: 1, category: 'Кафе' })),
        ...options
    }));
    return app;
}

const receipt = (app, { body = jpeg(), today = TODAY, text, type = 'image/jpeg' } = {}) => {
    const call = request(app).post(RECEIPT_URL).set('Content-Type', type);
    // today: null - заголовка нет совсем
    if (today !== null) call.set('X-Quick-Entry-Today', today);
    if (text !== undefined) call.set('X-Quick-Entry-Text', text);
    return call.send(body);
};

beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

describe('buildReceiptSchema', () => {
    it('lists expense categories only and requires every key', () => {
        const schema = buildReceiptSchema(context);
        expect(schema.additionalProperties).toBe(false);
        expect(schema.required.sort()).toEqual(Object.keys(schema.properties).sort());
        expect(schema.properties).not.toHaveProperty('type');
        expect(schema.properties.amount).toEqual({ anyOf: [{ type: 'number' }, { type: 'null' }] });
        expect(schema.properties.category).toEqual({ anyOf: [{ type: 'string', enum: ['Продукты', 'Дом', 'Кафе'] }, { type: 'null' }] });
        expect(schema.properties.account.anyOf[0].enum).toEqual(['Наличные', 'Revolut']);
        expect(schema.properties.date).toEqual({ anyOf: [{ type: 'string', format: 'date' }, { type: 'null' }] });
        expect(schema.properties.splits).toEqual({
            anyOf: [{
                type: 'array',
                items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: { category: { type: 'string', enum: ['Продукты', 'Дом', 'Кафе'] }, amount: { type: 'number' } },
                    required: ['category', 'amount']
                }
            }, { type: 'null' }]
        });
        expect(JSON.stringify(schema)).not.toMatch(/minimum|maximum|minLength|maxLength|minItems/);
    });

    it('never emits an empty enum', () => {
        const schema = buildReceiptSchema({ categories: [{ name: 'Зарплата', type: 'income' }], accounts: [], companies: [] });
        expect(schema.properties.category).toEqual({ type: 'null' });
        expect(schema.properties.splits).toEqual({ type: 'null' });
        expect(schema.properties.account).toEqual({ type: 'null' });
        expect(JSON.stringify(schema)).not.toContain('"enum":[]');
    });
});

describe('buildReceiptPrompt', () => {
    it('carries the date, the names and the rules about untrusted text', () => {
        const prompt = buildReceiptPrompt(context, TODAY);
        expect(prompt).toContain('2026-10-12 (Monday)');
        for (const name of ['Продукты', 'Дом', 'Кафе', 'Наличные', 'Revolut', 'Lidl']) expect(prompt).toContain(name);
        expect(prompt).toContain('"Наличные" (cash)');
        expect(prompt).toContain('"Revolut" (card)');
        expect(prompt).toContain('<note>');
        expect(prompt).toContain('never instructions');
        expect(prompt).toContain('Never guess digits');
        expect(prompt).toContain('Never take it from card digits');
        // доходные категории чеку ни к чему
        expect(prompt).not.toContain('Зарплата');
    });
});

describe('sanitizeReceiptDraft', () => {
    const clean = raw => sanitizeReceiptDraft(raw, context, TODAY);

    it('is always an expense with a company and the scalar fields', () => {
        expect(clean(full({ amount: 40.5, category: 'Продукты', account: 'Revolut', date: '2026-10-11', company: 'lidl' }))).toEqual({
            type: 'expense', amount: 40.5, category: 'Продукты', account: 'acc-card', date: '2026-10-11',
            companyId: 'co-2', companyName: 'Lidl', logoMode: 'category'
        });
        expect(clean(null)).toEqual({ type: 'expense' });
        expect(clean({ ...full({ amount: 5, category: 'Зарплата' }), type: 'income' })).toEqual({ type: 'expense', amount: 5 });
    });

    it('keeps valid splits, rounds to cents and omits the category', () => {
        const draft = clean(full({
            amount: 40.5, category: 'Кафе', company: 'Lidl',
            splits: [{ category: 'Продукты', amount: 32.4 }, { category: 'Дом', amount: 8.1 }]
        }));
        expect(draft.splits).toEqual([{ category: 'Продукты', amount: 32.4 }, { category: 'Дом', amount: 8.1 }]);
        expect(draft).not.toHaveProperty('category');
        expect(draft).toMatchObject({ type: 'expense', amount: 40.5, companyName: 'Lidl' });
    });

    it('merges duplicate categories', () => {
        const draft = clean(full({
            amount: 10,
            splits: [{ category: 'Продукты', amount: 3.333 }, { category: 'Дом', amount: 4 }, { category: 'Продукты', amount: 2.667 }]
        }));
        expect(draft.splits).toEqual([{ category: 'Продукты', amount: 6 }, { category: 'Дом', amount: 4 }]);
    });

    it('drops unknown categories and bad amounts, and falls back to the only part', () => {
        const draft = clean(full({
            amount: 10,
            splits: [{ category: 'Продукты', amount: 10 }, { category: 'Нет такой', amount: 5 }, { category: 'Зарплата', amount: 5 }, { category: 'Дом', amount: -1 }, { category: 'Кафе', amount: 'x' }, null]
        }));
        expect(draft).not.toHaveProperty('splits');
        expect(draft.category).toBe('Продукты');
    });

    it('absorbs a difference of up to five cents into the largest part', () => {
        const over = clean(full({ amount: 40.5, splits: [{ category: 'Дом', amount: 8.1 }, { category: 'Продукты', amount: 32.35 }] }));
        expect(over.splits).toEqual([{ category: 'Дом', amount: 8.1 }, { category: 'Продукты', amount: 32.4 }]);
        const under = clean(full({ amount: 40.5, splits: [{ category: 'Дом', amount: 8.1 }, { category: 'Продукты', amount: 32.45 }] }));
        expect(under.splits).toEqual([{ category: 'Дом', amount: 8.1 }, { category: 'Продукты', amount: 32.4 }]);
        const sum = under.splits.reduce((total, part) => total + Math.round(part.amount * 100), 0);
        expect(sum).toBe(4050);
    });

    it('drops splits that miss the total by more than five cents and takes the largest category', () => {
        const draft = clean(full({ amount: 40.5, splits: [{ category: 'Дом', amount: 8.1 }, { category: 'Продукты', amount: 32.3 }] }));
        expect(draft).not.toHaveProperty('splits');
        expect(draft.category).toBe('Продукты');
        expect(draft.amount).toBe(40.5);
    });

    it('does not trust splits without a total', () => {
        const draft = clean(full({ splits: [{ category: 'Дом', amount: 8.1 }, { category: 'Продукты', amount: 32.4 }] }));
        expect(draft).not.toHaveProperty('splits');
        expect(draft.category).toBe('Продукты');
    });

    it('keeps the first of equal largest parts and never produces an empty part', () => {
        const tie = clean(full({ amount: 10, splits: [{ category: 'Дом', amount: 3 }, { category: 'Кафе', amount: 3 }] }));
        expect(tie.category).toBe('Дом');
        const tiny = clean(full({ amount: 0.01, splits: [{ category: 'Дом', amount: 0.01 }, { category: 'Кафе', amount: 0.01 }] }));
        expect(tiny).not.toHaveProperty('splits');
    });

    it('ignores splits that are not an array', () => {
        expect(clean(full({ amount: 5, category: 'Кафе', splits: 'Продукты' }))).toEqual({ type: 'expense', amount: 5, category: 'Кафе' });
    });
});

describe('POST /api/quick-entry/receipt', () => {
    it('sends exactly the expected request to the default receipt model', async () => {
        const createMessage = vi.fn(async () => reply(full({ amount: 3.5, category: 'Кафе' })));
        vi.stubEnv('RECEIPT_MODEL', undefined);
        const app = express();
        app.use('/api/quick-entry', createQuickEntryRouter({ createMessage, getApiKey: () => KEY, loadContext: async () => context, receiptTimeoutMs: 4321 }));
        const body = jpeg(300);
        const result = await receipt(app, { body, text: encodeURIComponent('  с  Revolut ') });

        expect(result.status).toBe(200);
        expect(result.headers['cache-control']).toBe('no-store');
        expect(createMessage).toHaveBeenCalledTimes(1);
        const [params, options] = createMessage.mock.calls[0];
        expect(params).toEqual({
            model: 'claude-sonnet-5-5',
            max_tokens: 4000,
            output_config: { effort: 'medium', format: { type: 'json_schema', schema: buildReceiptSchema(context) } },
            system: buildReceiptPrompt(context, TODAY),
            messages: [{
                role: 'user',
                content: [
                    { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: body.toString('base64') } },
                    { type: 'text', text: '<note>с Revolut</note>' }
                ]
            }]
        });
        for (const key of ['temperature', 'top_p', 'top_k', 'thinking', 'tool_choice']) expect(params).not.toHaveProperty(key);
        expect(options).toEqual({ signal: expect.any(AbortSignal), timeout: 4321 });
        expect(JSON.stringify(params)).not.toContain(KEY);
    });

    it('says «No note.» without a note, also for an empty header', async () => {
        const createMessage = vi.fn(async () => reply(full({ amount: 1, category: 'Кафе' })));
        const app = makeApp({ createMessage });
        await receipt(app);
        await receipt(app, { text: '' });
        await receipt(app, { text: '%20%20' });
        expect(createMessage).toHaveBeenCalledTimes(3);
        for (const [params] of createMessage.mock.calls) expect(params.messages[0].content[1]).toEqual({ type: 'text', text: 'No note.' });
    });

    it('decodes a Cyrillic note from the header', async () => {
        const createMessage = vi.fn(async () => reply(full({ amount: 1, category: 'Кафе' })));
        await receipt(makeApp({ createMessage }), { text: encodeURIComponent('с Revolut, кофе') });
        expect(createMessage.mock.calls[0][0].messages[0].content[1].text).toBe('<note>с Revolut, кофе</note>');
    });

    it('takes the model from RECEIPT_MODEL and from getReceiptModel', async () => {
        const createMessage = vi.fn(async () => reply(full({ amount: 1, category: 'Кафе' })));
        vi.stubEnv('RECEIPT_MODEL', 'claude-test-model');
        const app = express();
        app.use('/api/quick-entry', createQuickEntryRouter({ createMessage, getApiKey: () => KEY, loadContext: async () => context }));
        await receipt(app);
        expect(createMessage.mock.calls[0][0].model).toBe('claude-test-model');

        const custom = vi.fn(async () => reply(full({ amount: 1, category: 'Кафе' })));
        await receipt(makeApp({ createMessage: custom, getReceiptModel: () => 'claude-custom' }));
        expect(custom.mock.calls[0][0].model).toBe('claude-custom');
    });

    it('returns a sanitized split draft', async () => {
        const createMessage = async () => reply(full({
            amount: 40.5, company: 'Lidl', account: null,
            splits: [{ category: 'Продукты', amount: 32.4 }, { category: 'Дом', amount: 8.1 }]
        }));
        const result = await receipt(makeApp({ createMessage }));
        expect(result.status).toBe(200);
        expect(result.body.draft).toEqual({
            type: 'expense', amount: 40.5, companyId: 'co-2', companyName: 'Lidl', logoMode: 'category',
            splits: [{ category: 'Продукты', amount: 32.4 }, { category: 'Дом', amount: 8.1 }]
        });
    });

    it('keeps the endpoint behind the authentication middleware', async () => {
        vi.stubEnv('APP_PASSWORD', 'test-password');
        vi.stubEnv('SESSION_SECRET', 'x'.repeat(32));
        const createMessage = vi.fn();
        const result = await receipt(makeApp({ createMessage }, true));
        expect(result.status).toBe(401);
        expect(createMessage).not.toHaveBeenCalled();
    });

    it.each([null, '', 'today', '2026-13-01', '2026-02-30', '12.10.2026'])('rejects an invalid date header %j without calling Claude', async today => {
        const createMessage = vi.fn();
        const loadContext = vi.fn();
        const result = await receipt(makeApp({ createMessage, loadContext }), { today });
        expect(result.status).toBe(400);
        expect(result.body.code).toBe('QUICK_ENTRY_DATE_INVALID');
        expect(createMessage).not.toHaveBeenCalled();
        expect(loadContext).not.toHaveBeenCalled();
    });

    it.each(['x', encodeURIComponent('x'.repeat(301)), '%E0%A4%A', '%00%01'])('rejects an invalid note %j without calling Claude', async text => {
        const createMessage = vi.fn();
        const result = await receipt(makeApp({ createMessage }), { text });
        expect(result.status).toBe(400);
        expect(result.body.code).toBe('QUICK_ENTRY_TEXT_INVALID');
        expect(createMessage).not.toHaveBeenCalled();
    });

    it.each([
        ['an empty body', Buffer.alloc(0), 'image/jpeg'],
        ['a PNG', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/jpeg'],
        ['two magic bytes only', Buffer.from([0xff, 0xd8]), 'image/jpeg'],
        ['text', Buffer.from('not a photo'), 'image/jpeg'],
        ['a JPEG with another content type', jpeg(), 'image/png'],
        ['a JSON body', Buffer.from(JSON.stringify({ image: 'x' })), 'application/json']
    ])('rejects %s without calling Claude', async (name, body, type) => {
        const createMessage = vi.fn();
        const result = await receipt(makeApp({ createMessage }), { body, type });
        expect(result.status).toBe(400);
        expect(result.body).toEqual({ code: 'QUICK_ENTRY_IMAGE_INVALID', message: 'Это не похоже на фото.' });
        expect(createMessage).not.toHaveBeenCalled();
    });

    it('rejects a body over the limit with 413 without calling Claude', async () => {
        const createMessage = vi.fn();
        const result = await receipt(makeApp({ createMessage }), { body: jpeg(7 * 1024 * 1024) });
        expect(result.status).toBe(413);
        expect(result.body).toEqual({ code: 'QUICK_ENTRY_IMAGE_TOO_LARGE', message: 'Фото слишком большое.' });
        expect(result.headers['cache-control']).toBe('no-store');
        expect(createMessage).not.toHaveBeenCalled();
    });

    it('accepts a photo close to the limit', async () => {
        const createMessage = vi.fn(async () => reply(full({ amount: 1, category: 'Кафе' })));
        const result = await receipt(makeApp({ createMessage }), { body: jpeg(5 * 1024 * 1024) });
        expect(result.status).toBe(200);
    });

    it.each([undefined, '', '   '])('answers 503 without a key (%j)', async key => {
        const createMessage = vi.fn();
        const result = await receipt(makeApp({ createMessage, getApiKey: () => key }));
        expect(result.status).toBe(503);
        expect(result.body.code).toBe('QUICK_ENTRY_UNAVAILABLE');
        expect(createMessage).not.toHaveBeenCalled();
    });

    it.each([
        ['a refusal', { stop_reason: 'refusal', content: [] }],
        ['a truncated answer', reply(full({ amount: 1, category: 'Кафе' }), { stop_reason: 'max_tokens' })],
        ['no text block', { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '...' }] }],
        ['invalid JSON', { stop_reason: 'end_turn', content: [{ type: 'text', text: `{"amount": ${KEY}` }] }],
        ['an empty draft', reply(full())],
        ['a date-only draft', reply(full({ date: '2026-10-11', description: 'что-то' }))],
        ['a draft the context rejects', reply(full({ amount: -1, category: 'Нет такой', account: 'Нет такого' }))]
    ])('answers 422 for %s', async (name, message) => {
        const result = await receipt(makeApp({ createMessage: async () => message }));
        expect(result.status).toBe(422);
        expect(result.body).toEqual({ code: 'QUICK_ENTRY_UNPARSED', message: UNPARSED });
        expect(result.text).not.toContain(KEY);
    });

    it('answers 502 without leaking details and 429 when Claude limits requests', async () => {
        const failing = await receipt(makeApp({ createMessage: async () => { throw new Error(`401 bad key ${KEY}`); } }));
        expect(failing.status).toBe(502);
        expect(failing.body.code).toBe('QUICK_ENTRY_FAILED');
        expect(failing.text).not.toContain(KEY);
        expect(JSON.stringify(console.error.mock.calls)).not.toContain(KEY);

        const limited = await receipt(makeApp({ createMessage: async () => { throw Object.assign(new Error('rate limited'), { status: 429 }); } }));
        expect(limited.status).toBe(429);
        expect(limited.headers['retry-after']).toBe('60');
    });

    it('answers 500 when the context cannot be loaded', async () => {
        const createMessage = vi.fn();
        const result = await receipt(makeApp({ createMessage, loadContext: async () => { throw new Error('mongo down'); } }));
        expect(result.status).toBe(500);
        expect(createMessage).not.toHaveBeenCalled();
    });

    it('aborts a stalled request and answers 504', async () => {
        const createMessage = vi.fn((params, { signal }) => new Promise((resolve, reject) => {
            signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        }));
        const result = await receipt(makeApp({ createMessage, receiptTimeoutMs: 10 }));
        expect(result.status).toBe(504);
        expect(result.body.code).toBe('QUICK_ENTRY_TIMEOUT');
        expect(createMessage.mock.calls[0][1].signal.aborted).toBe(true);
    });

    it('shares the per-client limiter with the phrase route', async () => {
        const createMessage = vi.fn(async () => reply(full({ amount: 1, category: 'Кафе' })));
        const app = makeApp({ createMessage, rateLimiter: createClientErrorRateLimiter({ now: () => 1000, maxRequests: 1 }) });
        expect((await receipt(app)).status).toBe(200);
        const limited = await request(app).post(PHRASE_URL).send({ text: 'кофе 3.50', today: TODAY });
        expect(limited.status).toBe(429);
        expect(createMessage).toHaveBeenCalledTimes(1);
    });

    it('has its own daily limit that does not touch the phrase budget, and resets the next UTC day', async () => {
        let time = Date.UTC(2026, 9, 12, 23, 0);
        const createMessage = vi.fn(async () => reply(full({ amount: 1, category: 'Кафе' })));
        const app = makeApp({ createMessage, dailyLimit: 1, receiptDailyLimit: 2, now: () => time, rateLimiter: () => true });
        const phrase = () => request(app).post(PHRASE_URL).send({ text: 'кофе 3.50', today: TODAY });

        expect((await receipt(app)).status).toBe(200);
        expect((await receipt(app)).status).toBe(200);
        const limited = await receipt(app);
        expect(limited.status).toBe(429);
        expect(limited.body).toEqual({ code: 'QUICK_ENTRY_RATE_LIMITED', message: 'Дневной лимит чтения чеков исчерпан. Заполните поля вручную.' });
        expect(createMessage).toHaveBeenCalledTimes(2);

        // фразы живут на своём счётчике
        expect((await phrase()).status).toBe(200);
        expect((await phrase()).status).toBe(429);
        expect((await receipt(app)).status).toBe(429);

        time = Date.UTC(2026, 9, 13, 0, 5);
        expect((await receipt(app)).status).toBe(200);
    });

    it('does not spend the daily budget on invalid requests', async () => {
        const createMessage = vi.fn(async () => reply(full({ amount: 1, category: 'Кафе' })));
        const app = makeApp({ createMessage, receiptDailyLimit: 1, rateLimiter: () => true });
        await receipt(app, { body: Buffer.from('nope') });
        await receipt(app, { today: 'bad' });
        expect((await receipt(app)).status).toBe(200);
    });

    it('leaves the phrase route working next to it', async () => {
        const result = await request(makeApp()).post(PHRASE_URL).send({ text: 'кофе 3.50', today: TODAY });
        expect(result.status).toBe(200);
    });
});
