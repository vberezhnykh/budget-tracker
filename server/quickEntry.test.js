// @vitest-environment node
import express from 'express';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuthMiddleware } from './auth.js';
import { createClientErrorRateLimiter } from './operational.js';
import {
    buildOutputSchema,
    buildSystemPrompt,
    createQuickEntryRouter,
    isQuickEntryEnabled,
    normalizePhrase,
    sanitizeDraft
} from './quickEntry.js';

const KEY = 'sk-ant-test-secret-1234567890';
const TODAY = '2026-10-12';
const PHRASE = 'кофе 3.50 старбакс вчера с карты';

const context = {
    categories: [
        { name: 'Кафе', type: 'expense' },
        { name: 'Транспорт', type: 'expense' },
        { name: 'Зарплата', type: 'income' },
        { name: 'Прочее', type: 'expense' },
        { name: 'Прочее', type: 'income' }
    ],
    accounts: [
        { _id: 'acc-cash', name: 'Наличные', type: 'cash' },
        { _id: 'acc-card', name: 'Revolut', type: 'card' }
    ],
    companies: [
        { _id: 'co-1', name: 'Starbucks', normalizedName: 'starbucks', logoMode: 'domain', merchantDomain: 'starbucks.com' },
        { _id: 'co-2', name: 'Lidl', normalizedName: 'lidl', logoMode: 'category' },
        { _id: 'co-3', name: 'Wolt', normalizedName: 'wolt' }
    ]
};

const reply = (draft, extra = {}) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(draft) }], ...extra });
const full = (draft = {}) => ({
    type: 'expense', amount: null, category: null, account: null, toAccount: null, date: null, company: null, description: null, ...draft
});

function makeApp(options = {}, authenticated = false) {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    if (authenticated) app.use(createAuthMiddleware(false));
    app.use('/api/quick-entry', createQuickEntryRouter({
        getApiKey: () => KEY,
        loadContext: async () => context,
        createMessage: async () => reply(full({ amount: 1 })),
        ...options
    }));
    return app;
}

const post = (app, body = { text: PHRASE, today: TODAY }) => request(app).post('/api/quick-entry').send(body);

beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

describe('isQuickEntryEnabled', () => {
    it('is on only for a non-empty key', () => {
        expect(isQuickEntryEnabled({})).toBe(false);
        expect(isQuickEntryEnabled({ ANTHROPIC_API_KEY: '' })).toBe(false);
        expect(isQuickEntryEnabled({ ANTHROPIC_API_KEY: '   ' })).toBe(false);
        expect(isQuickEntryEnabled({ ANTHROPIC_API_KEY: KEY })).toBe(true);
    });

    it('reads process.env by default', () => {
        vi.stubEnv('ANTHROPIC_API_KEY', undefined);
        expect(isQuickEntryEnabled()).toBe(false);
        vi.stubEnv('ANTHROPIC_API_KEY', KEY);
        expect(isQuickEntryEnabled()).toBe(true);
    });
});

describe('normalizePhrase', () => {
    it('applies NFKC, collapses whitespace and trims', () => {
        expect(normalizePhrase('  кофе \n 3.50\t\tＡＢＣ  ')).toBe('кофе 3.50 ABC');
    });

    it.each([undefined, null, 42, '', ' ', 'x', 'x'.repeat(301), 'x'.repeat(1001), 'кофе\u0000 3', ['кофе'], { text: 'кофе' }])('rejects %j', value => {
        expect(normalizePhrase(value)).toBeNull();
    });

    it('accepts the length limits', () => {
        expect(normalizePhrase('ab')).toBe('ab');
        expect(normalizePhrase('x'.repeat(300))).toHaveLength(300);
    });
});

describe('buildOutputSchema', () => {
    it('lists unique names and requires every key', () => {
        const schema = buildOutputSchema(context);
        expect(schema.additionalProperties).toBe(false);
        expect(schema.required.sort()).toEqual(Object.keys(schema.properties).sort());
        expect(schema.properties.type.enum).toEqual(['expense', 'income', 'transfer']);
        expect(schema.properties.category).toEqual({ anyOf: [{ type: 'string', enum: ['Кафе', 'Транспорт', 'Зарплата', 'Прочее'] }, { type: 'null' }] });
        expect(schema.properties.account.anyOf[0].enum).toEqual(['Наличные', 'Revolut']);
        expect(schema.properties.toAccount).toEqual(schema.properties.account);
        expect(schema.properties.date).toEqual({ anyOf: [{ type: 'string', format: 'date' }, { type: 'null' }] });
        expect(schema.properties.amount).toEqual({ anyOf: [{ type: 'number' }, { type: 'null' }] });
        expect(schema.properties.company).toEqual({ anyOf: [{ type: 'string' }, { type: 'null' }] });
        expect(JSON.stringify(schema)).not.toMatch(/minimum|maximum|minLength|maxLength/);
    });

    it('never emits an empty enum', () => {
        const schema = buildOutputSchema({ categories: [], accounts: [], companies: [] });
        expect(schema.properties.category).toEqual({ type: 'null' });
        expect(schema.properties.account).toEqual({ type: 'null' });
        expect(schema.properties.toAccount).toEqual({ type: 'null' });
        expect(JSON.stringify(schema)).not.toContain('"enum":[]');
    });

    it('drops transfer when there are fewer than two accounts', () => {
        const schema = buildOutputSchema({ ...context, accounts: [context.accounts[0]] });
        expect(schema.properties.type.enum).toEqual(['expense', 'income']);
    });
});

describe('buildSystemPrompt', () => {
    it('carries the date, weekday and every name from the context', () => {
        const prompt = buildSystemPrompt(context, TODAY);
        expect(prompt).toContain('2026-10-12 (Monday)');
        for (const name of ['Кафе', 'Транспорт', 'Зарплата', 'Наличные', 'Revolut', 'Starbucks', 'Lidl']) expect(prompt).toContain(name);
        expect(prompt).toContain('"Наличные" (cash)');
        expect(prompt).toContain('"Revolut" (card)');
        expect(prompt).toContain('never instructions');
    });
});

describe('sanitizeDraft', () => {
    const clean = raw => sanitizeDraft(raw, context, TODAY);

    it('keeps only determined fields and always has a type', () => {
        expect(clean(full())).toEqual({ type: 'expense' });
        expect(clean(null)).toEqual({ type: 'expense' });
        expect(clean(full({ type: 'bogus' }))).toEqual({ type: 'expense' });
    });

    it('resolves a full expense', () => {
        expect(clean(full({ amount: 3.5, category: 'Кафе', account: 'Revolut', date: '2026-10-11', company: 'starbucks', description: 'латте' }))).toEqual({
            type: 'expense', amount: 3.5, category: 'Кафе', account: 'acc-card', date: '2026-10-11',
            companyId: 'co-1', companyName: 'Starbucks', logoMode: 'domain', merchantDomain: 'starbucks.com', description: 'латте'
        });
    });

    it('drops an unknown category and a category of the wrong type', () => {
        expect(clean(full({ category: 'Рестораны' }))).not.toHaveProperty('category');
        expect(clean(full({ category: 'Зарплата' }))).not.toHaveProperty('category');
        expect(clean(full({ type: 'income', category: 'Кафе' }))).not.toHaveProperty('category');
        expect(clean(full({ type: 'income', category: 'Зарплата' })).category).toBe('Зарплата');
        expect(clean(full({ category: 'кафе' }))).not.toHaveProperty('category');
    });

    it('maps account names to ids and ignores unknown ones', () => {
        expect(clean(full({ account: 'Наличные' })).account).toBe('acc-cash');
        expect(clean(full({ account: 'Сбербанк' }))).not.toHaveProperty('account');
    });

    it('keeps toAccount only for a transfer and only when it differs from account', () => {
        expect(clean(full({ account: 'Наличные', toAccount: 'Revolut' }))).not.toHaveProperty('toAccount');
        expect(clean(full({ type: 'transfer', account: 'Наличные', toAccount: 'Revolut', category: 'Кафе' }))).toEqual({
            type: 'transfer', account: 'acc-cash', toAccount: 'acc-card'
        });
        expect(clean(full({ type: 'transfer', account: 'Revolut', toAccount: 'Revolut' }))).toEqual({ type: 'transfer', account: 'acc-card' });
    });

    it('turns a transfer into an expense with fewer than two accounts', () => {
        const single = { ...context, accounts: [context.accounts[0]] };
        expect(sanitizeDraft(full({ type: 'transfer', account: 'Наличные', toAccount: 'Revolut', amount: 5 }), single, TODAY))
            .toEqual({ type: 'expense', amount: 5, account: 'acc-cash' });
    });

    it.each([
        ['2025-10-10', false], ['2026-10-12', true], ['2027-10-13', true], ['2027-10-14', false], ['2025-10-11', true],
        ['2026-02-30', false], ['11.10.2026', false], ['вчера', false], [20261011, false]
    ])('checks the date %j within 366 days of today', (date, kept) => {
        const draft = clean(full({ date }));
        if (kept) expect(draft.date).toBe(date); else expect(draft).not.toHaveProperty('date');
    });

    it.each([0, -5, NaN, Infinity, 1e9 + 1, '5', null])('drops the amount %j', amount => {
        expect(clean(full({ amount }))).not.toHaveProperty('amount');
    });

    it('rounds the amount to cents and allows the upper bound', () => {
        expect(clean(full({ amount: 3.456 })).amount).toBe(3.46);
        expect(clean(full({ amount: 1e9 })).amount).toBe(1e9);
    });

    it('matches a known company ignoring case and spacing, and takes the stored spelling', () => {
        expect(clean(full({ company: '  LIDL ' }))).toMatchObject({ companyId: 'co-2', companyName: 'Lidl', logoMode: 'category' });
        expect(clean(full({ company: 'lidl' }))).not.toHaveProperty('merchantDomain');
        expect(clean(full({ company: 'Wolt' }))).toMatchObject({ companyId: 'co-3', logoMode: 'auto' });
    });

    it('gives a new company auto logo mode and no id', () => {
        expect(clean(full({ company: 'Кафе  Рога' }))).toEqual({ type: 'expense', companyId: '', companyName: 'Кафе Рога', logoMode: 'auto' });
    });

    it('does not set a company for income or transfers', () => {
        expect(clean(full({ type: 'income', company: 'Lidl' }))).not.toHaveProperty('companyName');
        expect(clean(full({ type: 'transfer', company: 'Lidl' }))).not.toHaveProperty('companyName');
    });

    it('cleans the description', () => {
        expect(clean(full({ description: '  латте \n\n  с овсяным\u0007  ' })).description).toBe('латте с овсяным');
        expect(clean(full({ description: 'я'.repeat(500) })).description).toHaveLength(200);
        expect(clean(full({ description: ' \n ' }))).not.toHaveProperty('description');
        expect(clean(full({ description: 5 }))).not.toHaveProperty('description');
    });
});

describe('POST /api/quick-entry', () => {
    it('returns a sanitized draft with no-store', async () => {
        const createMessage = vi.fn(async () => reply(full({ amount: 3.5, category: 'Кафе', account: 'Revolut', date: '2026-10-11', company: 'Starbucks' })));
        const result = await post(makeApp({ createMessage }));
        expect(result.status).toBe(200);
        expect(result.headers['cache-control']).toBe('no-store');
        expect(result.body.draft).toMatchObject({ type: 'expense', amount: 3.5, category: 'Кафе', account: 'acc-card', companyId: 'co-1' });
        expect(result.text).not.toContain(KEY);
    });

    it('keeps the endpoint behind the authentication middleware', async () => {
        vi.stubEnv('APP_PASSWORD', 'test-password');
        vi.stubEnv('SESSION_SECRET', 'x'.repeat(32));
        const createMessage = vi.fn();
        const result = await post(makeApp({ createMessage }, true));
        expect(result.status).toBe(401);
        expect(createMessage).not.toHaveBeenCalled();
    });

    it.each([
        [{ today: TODAY }], [{ text: '', today: TODAY }], [{ text: 'x', today: TODAY }], [{ text: 'x'.repeat(301), today: TODAY }],
        [{ text: 'кофе\u0000', today: TODAY }], [{ text: ['кофе 3'], today: TODAY }], [{ text: { a: 1 }, today: TODAY }]
    ])('rejects an invalid text %j without calling Claude', async body => {
        const createMessage = vi.fn();
        const loadContext = vi.fn();
        const result = await post(makeApp({ createMessage, loadContext }), body);
        expect(result.status).toBe(400);
        expect(result.body.code).toBe('QUICK_ENTRY_TEXT_INVALID');
        expect(result.body.message).toBe('Опишите операцию: от 2 до 300 символов.');
        expect(result.headers['cache-control']).toBe('no-store');
        expect(createMessage).not.toHaveBeenCalled();
        expect(loadContext).not.toHaveBeenCalled();
    });

    it.each([undefined, '', 'сегодня', '2026-13-01', '2026-02-30', '12.10.2026', '2026-10-12T00:00:00Z', 20261012])('rejects an invalid date %j without calling Claude', async today => {
        const createMessage = vi.fn();
        const result = await post(makeApp({ createMessage }), { text: PHRASE, today });
        expect(result.status).toBe(400);
        expect(result.body.code).toBe('QUICK_ENTRY_DATE_INVALID');
        expect(createMessage).not.toHaveBeenCalled();
    });

    it('validates before it checks the key', async () => {
        const result = await post(makeApp({ getApiKey: () => undefined }), { text: '', today: TODAY });
        expect(result.status).toBe(400);
    });

    it.each([undefined, '', '   '])('answers 503 without a key (%j)', async key => {
        const createMessage = vi.fn();
        const result = await post(makeApp({ createMessage, getApiKey: () => key }));
        expect(result.status).toBe(503);
        expect(result.body).toEqual({ code: 'QUICK_ENTRY_UNAVAILABLE', message: 'Ввод фразой не настроен.' });
        expect(createMessage).not.toHaveBeenCalled();
    });

    it('sends exactly the expected request to the default model', async () => {
        const createMessage = vi.fn(async () => reply(full({ amount: 1 })));
        vi.stubEnv('QUICK_ENTRY_MODEL', undefined);
        const app = express();
        app.use(express.json());
        app.use('/api/quick-entry', createQuickEntryRouter({ createMessage, getApiKey: () => KEY, loadContext: async () => context, timeoutMs: 4321 }));
        await post(app, { text: '  кофе   3.50 старбакс ', today: TODAY, amount: 99, history: ['secret'] });

        expect(createMessage).toHaveBeenCalledTimes(1);
        const [params, options] = createMessage.mock.calls[0];
        expect(params).toEqual({
            model: 'claude-haiku-5-5',
            max_tokens: 2000,
            output_config: { effort: 'low', format: { type: 'json_schema', schema: buildOutputSchema(context) } },
            system: buildSystemPrompt(context, TODAY),
            messages: [{ role: 'user', content: '<phrase>кофе 3.50 старбакс</phrase>' }]
        });
        expect(params).not.toHaveProperty('temperature');
        expect(params).not.toHaveProperty('top_p');
        expect(params).not.toHaveProperty('top_k');
        expect(params).not.toHaveProperty('thinking');
        expect(params).not.toHaveProperty('tool_choice');
        expect(options).toEqual({ signal: expect.any(AbortSignal), timeout: 4321 });
        for (const name of ['Кафе', 'Revolut', 'Starbucks', TODAY]) expect(params.system).toContain(name);
        expect(JSON.stringify(params)).not.toContain('secret');
        expect(JSON.stringify(params)).not.toContain(KEY);
    });

    it('takes the model from QUICK_ENTRY_MODEL via getModel', async () => {
        const createMessage = vi.fn(async () => reply(full({ amount: 1 })));
        vi.stubEnv('QUICK_ENTRY_MODEL', 'claude-test-model');
        const app = express();
        app.use(express.json());
        app.use('/api/quick-entry', createQuickEntryRouter({ createMessage, getApiKey: () => KEY, loadContext: async () => context }));
        await post(app);
        expect(createMessage.mock.calls[0][0].model).toBe('claude-test-model');

        const custom = vi.fn(async () => reply(full({ amount: 1 })));
        await post(makeApp({ createMessage: custom, getModel: () => 'claude-custom' }));
        expect(custom.mock.calls[0][0].model).toBe('claude-custom');
    });

    it.each([
        ['a refusal', { stop_reason: 'refusal', content: [] }],
        ['a truncated answer', reply(full({ amount: 1 }), { stop_reason: 'max_tokens' })],
        ['no text block', { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '...' }] }],
        ['invalid JSON', { stop_reason: 'end_turn', content: [{ type: 'text', text: `{"type": ${KEY}` }] }],
        ['a non-object answer', { stop_reason: 'end_turn', content: [{ type: 'text', text: '"expense"' }] }],
        ['an empty draft', reply(full())],
        ['a draft the context rejects', reply(full({ amount: -1, category: 'Нет такой', account: 'Нет такого', date: '1999-01-01' }))],
        ['a date-only draft', reply(full({ date: '2026-10-11' }))]
    ])('answers 422 for %s', async (name, message) => {
        const result = await post(makeApp({ createMessage: async () => message }));
        expect(result.status).toBe(422);
        expect(result.body).toEqual({
            code: 'QUICK_ENTRY_UNPARSED',
            message: 'Не получилось разобрать фразу. Добавьте сумму и на что потрачено или заполните поля вручную.'
        });
        expect(result.text).not.toContain(KEY);
    });

    it('answers 502 for an ordinary failure without leaking details', async () => {
        const createMessage = vi.fn(async () => { throw new Error(`401 {"error":"bad key ${KEY}"} кофе 3.50`); });
        const result = await post(makeApp({ createMessage }));
        expect(result.status).toBe(502);
        expect(result.body).toEqual({ code: 'QUICK_ENTRY_FAILED', message: 'Не удалось связаться с Claude. Заполните поля вручную.' });
        expect(result.text).not.toContain(KEY);
        expect(result.text).not.toContain('кофе');
        // В журнал тоже не попадает ни фраза, ни тело ошибки.
        expect(JSON.stringify(console.error.mock.calls)).not.toContain(KEY);
        expect(JSON.stringify(console.error.mock.calls)).not.toContain('кофе');
    });

    it('answers 429 when Claude itself limits requests', async () => {
        const createMessage = async () => { throw Object.assign(new Error('rate limited'), { status: 429 }); };
        const result = await post(makeApp({ createMessage }));
        expect(result.status).toBe(429);
        expect(result.body.code).toBe('QUICK_ENTRY_RATE_LIMITED');
        expect(result.headers['retry-after']).toBe('60');
    });

    it('answers 500 when the context cannot be loaded', async () => {
        const createMessage = vi.fn();
        const result = await post(makeApp({ createMessage, loadContext: async () => { throw new Error('mongo down'); } }));
        expect(result.status).toBe(500);
        expect(result.text).not.toContain('mongo');
        expect(createMessage).not.toHaveBeenCalled();
    });

    it('aborts a stalled request and answers 504', async () => {
        const createMessage = vi.fn((params, { signal }) => new Promise((resolve, reject) => {
            signal.addEventListener('abort', () => reject(new Error(`aborted ${KEY}`)), { once: true });
        }));
        const result = await post(makeApp({ createMessage, timeoutMs: 10 }));
        expect(result.status).toBe(504);
        expect(result.body.code).toBe('QUICK_ENTRY_TIMEOUT');
        expect(createMessage.mock.calls[0][1].signal.aborted).toBe(true);
        expect(result.text).not.toContain(KEY);
    });

    it('limits requests per client before spending another call and resets after the window', async () => {
        let time = 1000;
        const createMessage = vi.fn(async () => reply(full({ amount: 1 })));
        const app = makeApp({ createMessage, rateLimiter: createClientErrorRateLimiter({ now: () => time, maxRequests: 1 }) });
        expect((await post(app)).status).toBe(200);
        const limited = await post(app);
        expect(limited.status).toBe(429);
        expect(limited.body.code).toBe('QUICK_ENTRY_RATE_LIMITED');
        expect(limited.headers['retry-after']).toBe('60');
        expect(createMessage).toHaveBeenCalledTimes(1);
        time += 60_000;
        expect((await post(app)).status).toBe(200);
        expect(createMessage).toHaveBeenCalledTimes(2);
    });

    it('stops at the daily limit and starts counting again on the next UTC day', async () => {
        let time = Date.UTC(2026, 9, 12, 23, 0);
        const createMessage = vi.fn(async () => reply(full({ amount: 1 })));
        const app = makeApp({ createMessage, dailyLimit: 2, now: () => time, rateLimiter: () => true });
        expect((await post(app)).status).toBe(200);
        expect((await post(app)).status).toBe(200);
        const limited = await post(app);
        expect(limited.status).toBe(429);
        expect(limited.body).toEqual({ code: 'QUICK_ENTRY_RATE_LIMITED', message: 'Дневной лимит разборов исчерпан. Заполните поля вручную.' });
        expect(createMessage).toHaveBeenCalledTimes(2);
        time = Date.UTC(2026, 9, 13, 0, 5);
        expect((await post(app)).status).toBe(200);
        expect(createMessage).toHaveBeenCalledTimes(3);
    });

    it('does not spend the daily budget on invalid requests', async () => {
        const createMessage = vi.fn(async () => reply(full({ amount: 1 })));
        const app = makeApp({ createMessage, dailyLimit: 1, rateLimiter: () => true });
        await post(app, { text: '', today: TODAY });
        expect((await post(app)).status).toBe(200);
    });
});
