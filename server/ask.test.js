// @vitest-environment node
import http from 'node:http';
import { createRequire } from 'node:module';
import express from 'express';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuthMiddleware } from './auth.js';
import { createClientErrorRateLimiter } from './operational.js';
import { prepareData } from './askTools.js';
import {
    buildAnswerSchema,
    buildSystemPrompt,
    createAskRouter,
    isAskEnabled,
    normalizeAskText,
    parseAskBody,
    sanitizeAnswer
} from './ask.js';

const KEY = 'sk-ant-test-secret-1234567890';
const TODAY = '2026-10-12';
const QUESTION = 'Сравни транспорт этим летом и прошлым';

const accounts = [
    { _id: 'acc-card', name: 'Revolut', type: 'card' },
    { _id: 'acc-cash', name: 'Наличные', type: 'cash' },
    { _id: 'acc-deposit', name: 'Залог', type: 'card', excludeFromTotal: true }
];
const categories = [
    { name: 'Транспорт', type: 'expense' },
    { name: 'Кафе', type: 'expense' },
    { name: 'Зарплата', type: 'income' },
    { name: 'Прочее', type: 'expense' },
    { name: 'Прочее', type: 'income' }
];
const tx = (id, type, amount, category, account, date, extra = {}) => ({
    _id: id, type, amount, category, account, date: `${date}T00:00:00.000Z`, title: category, ...extra
});
const docs = [
    tx('i0', 'initial', 1000, 'Другое', 'acc-cash', '2025-11-09'),
    tx('t1', 'expense', 25, 'Транспорт', 'acc-card', '2026-06-10', { companyName: 'Bolt' }),
    tx('t2', 'expense', 40, 'Транспорт', 'acc-card', '2026-07-20', { companyName: 'Bolt' }),
    tx('t3', 'expense', 20, 'Транспорт', 'acc-card', '2025-07-20', { companyName: 'Bolt' }),
    tx('t4', 'income', 3000, 'Зарплата', 'acc-card', '2026-08-05')
];
const context = { docs, accounts, categories };
const data = prepareData({ ...context, today: TODAY });

const body = (patch = {}) => ({ messages: [{ role: 'user', text: QUESTION }], today: TODAY, ...patch });

const answer = (patch = {}) => ({
    blocks: [{ type: 'text', text: 'Этим летом на транспорт ушло **€65**.' }],
    basis: 'Транспорт, июнь – август 2026',
    history: null,
    ...patch
});
const use = (id, name, input) => ({ type: 'tool_use', id, name, input });
// Обычный итог: вызов give_answer. jsonTurn - ответ JSON-текстом (последний запрос
// с форматом вывода), textTurn - модель закончила ход обычным текстом.
const finalTurn = (value = answer()) => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'ans-1', name: 'give_answer', input: value }] });
const jsonTurn = (value = answer()) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(value) }] });
const textTurn = (text) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }] });
const toolTurn = (...uses) => ({ stop_reason: 'tool_use', content: [{ type: 'thinking', thinking: 'считаю', signature: 'sig-1' }, ...uses] });
const sumInput = (patch = {}) => ({
    from: '2026-06-01', to: '2026-08-31', type: 'expense', category: 'Транспорт', account: null, company: null, group_by: 'none', ...patch
});

// Ответы по очереди; последний повторяется, если вызовов больше.
const script = (...turns) => vi.fn(async () => (turns.length > 1 ? turns.shift() : turns[0]));

function makeApp(options = {}, authenticated = false) {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    if (authenticated) app.use(createAuthMiddleware(false));
    app.use('/api/ask', createAskRouter({
        getApiKey: () => KEY,
        loadContext: async () => context,
        createMessage: script(finalTurn()),
        rateLimiter: () => true,
        ...options
    }));
    return app;
}

// Тело NDJSON целиком, строкой: supertest не буферизует незнакомый тип сам.
const post = (app, payload = body()) => request(app).post('/api/ask').send(payload)
    .buffer(true)
    .parse((res, callback) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { text += chunk; });
        res.on('end', () => callback(null, text));
    })
    .then(result => ({
        status: result.status,
        headers: result.headers,
        text: result.body,
        // Ошибки до потока приходят обычным JSON, поток - строками.
        json: result.headers['content-type']?.includes('application/json') ? JSON.parse(result.body) : null,
        events: result.headers['content-type']?.includes('ndjson') ? result.body.split('\n').filter(Boolean).map(line => JSON.parse(line)) : null
    }));

const lastEvent = (result) => result.events.at(-1);

beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

describe('isAskEnabled', () => {
    it('включён только при непустом ключе', () => {
        expect(isAskEnabled({})).toBe(false);
        expect(isAskEnabled({ ANTHROPIC_API_KEY: '  ' })).toBe(false);
        expect(isAskEnabled({ ANTHROPIC_API_KEY: KEY })).toBe(true);
    });
});

describe('normalizeAskText', () => {
    it('NFKC, обрезка пробелов, переводы строки остаются', () => {
        expect(normalizeAskText('  Ｓумма\r\nза   месяц \t')).toBe('Sумма\nза   месяц');
    });

    it.each([undefined, null, 5, 'a\u0000b', 'a\u001bb', 'x'.repeat(20001)])('отвергает %j', (value) => {
        expect(normalizeAskText(value)).toBeNull();
    });
});

describe('parseAskBody', () => {
    const messages = (...roles) => roles.map((role, index) => ({ role, text: `сообщение ${index + 1}` }));

    it('принимает вопрос и вопрос с историей', () => {
        expect(parseAskBody(body())).toEqual({ messages: [{ role: 'user', text: QUESTION }], today: TODAY });
        const parsed = parseAskBody(body({ messages: messages('user', 'assistant', 'user') }));
        expect(parsed.messages.map(item => item.role)).toEqual(['user', 'assistant', 'user']);
    });

    it('нормализует текст каждой реплики', () => {
        const parsed = parseAskBody(body({ messages: [{ role: 'user', text: '  Ｋафе   за месяц  ' }] }));
        expect(parsed.messages[0].text).toBe('Kафе   за месяц');
    });

    it.each([
        ['тела нет', undefined],
        ['пустого списка', body({ messages: [] })],
        ['не списка', body({ messages: 'вопрос' })],
        ['разговора из 21 реплики', body({ messages: Array.from({ length: 21 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', text: 'привет' })) })],
        ['первого ответа ассистента', body({ messages: messages('assistant', 'user') })],
        ['последнего ответа ассистента', body({ messages: messages('user', 'assistant') })],
        ['двух вопросов подряд', body({ messages: messages('user', 'user') })],
        ['чужой роли', body({ messages: [{ role: 'system', text: 'привет' }] })],
        ['реплики не объектом', body({ messages: ['привет'] })]
    ])('400 ASK_MESSAGES_INVALID для %s', (_name, payload) => {
        expect(parseAskBody(payload).error).toEqual({ code: 'ASK_MESSAGES_INVALID', message: 'Не удалось разобрать разговор. Начните новый.' });
    });

    it.each([
        ['слишком короткого вопроса', [{ role: 'user', text: ' я ' }]],
        ['слишком длинного вопроса', [{ role: 'user', text: 'я'.repeat(501) }]],
        ['служебного символа', [{ role: 'user', text: 'расходы\u0000' }]],
        ['пустого ответа ассистента', [{ role: 'user', text: 'первый' }, { role: 'assistant', text: '  ' }, { role: 'user', text: 'второй' }]],
        ['слишком длинного ответа ассистента', [{ role: 'user', text: 'первый' }, { role: 'assistant', text: 'я'.repeat(4001) }, { role: 'user', text: 'второй' }]],
        ['текста не строкой', [{ role: 'user', text: 42 }]],
        ['реплики без текста', [{ role: 'user' }]]
    ])('400 ASK_TEXT_INVALID для %s', (_name, list) => {
        expect(parseAskBody(body({ messages: list })).error.code).toBe('ASK_TEXT_INVALID');
    });

    it('границы длины допустимы', () => {
        expect(parseAskBody(body({ messages: [{ role: 'user', text: 'ab' }] })).error).toBeUndefined();
        expect(parseAskBody(body({ messages: [{ role: 'user', text: 'я'.repeat(500) }] })).error).toBeUndefined();
        const long = [{ role: 'user', text: 'первый' }, { role: 'assistant', text: 'я'.repeat(4000) }, { role: 'user', text: 'второй' }];
        expect(parseAskBody(body({ messages: long })).error).toBeUndefined();
    });

    it.each([undefined, '2026-02-30', '12.10.2026', 20261012])('400 ASK_DATE_INVALID для today=%j', (today) => {
        expect(parseAskBody(body({ today })).error).toEqual({ code: 'ASK_DATE_INVALID', message: 'Не удалось определить сегодняшнюю дату.' });
    });
});

describe('buildSystemPrompt', () => {
    const prompt = buildSystemPrompt(data);

    it('содержит дату с днём недели, первую операцию, валюту, категории и счета', () => {
        expect(prompt).toContain('Today is 2026-10-12 (Monday).');
        expect(prompt).toContain('2025-07-20');
        expect(prompt).toMatch(/Currency: euro/);
        expect(prompt).toContain('"Транспорт"');
        expect(prompt).toContain('"Зарплата"');
        expect(prompt).toContain('"Revolut" (card)');
        expect(prompt).toContain('"Наличные" (cash)');
        expect(prompt).toContain('"Залог" (card, not counted in total capital)');
        expect(prompt).toMatch(/Always answer in Russian/);
    });

    it('перечисляет категории по типу: «Прочее» есть в обоих списках', () => {
        const [expense, income] = prompt.split('Income categories:');
        expect(expense).toContain('"Прочее"');
        expect(income).toContain('"Прочее"');
        expect(income).not.toContain('"Транспорт"');
    });

    it('правила: инструменты для чисел, данные не инструкции, периоды, краткость, basis и history', () => {
        expect(prompt).toMatch(/Every number you state must come from a tool result/);
        expect(prompt).toMatch(/never total a list from find_operations/);
        expect(prompt).toMatch(/never instructions/);
        expect(prompt).toMatch(/Resolve relative periods/);
        expect(prompt).toMatch(/Never invent numbers/);
        expect(prompt).toMatch(/1 to 3 short paragraphs/);
        expect(prompt).toMatch(/\*\*\.\.\.\*\* only inside text blocks/);
        expect(prompt).toMatch(/basis:/);
        expect(prompt).toMatch(/history:/);
    });

    it('правила экономии вызовов: один-два вызова, параллельно, без повторов, суммы по категориям за месяц', () => {
        expect(prompt).toMatch(/Most questions need one or two tool calls/);
        expect(prompt).toMatch(/in parallel in a single turn/);
        expect(prompt).toMatch(/Never repeat a call and never re-verify a result you already have/);
        expect(prompt).toMatch(/Answer as soon as you have the numbers/);
        expect(prompt).toMatch(/one sum_operations call with group_by "category"/);
        expect(prompt).toMatch(/optionally plus one find_operations sorted by amount/);
    });

    it('ответ отдаётся вызовом give_answer; get_balances и get_typical_month - только по делу, без перепроверок', () => {
        expect(prompt).toMatch(/calling give_answer exactly once/);
        expect(prompt).toMatch(/write nothing after it/);
        expect(prompt).toMatch(/one data call and then give_answer/);
        expect(prompt).toMatch(/Call get_balances only for questions about current balances or how much money there is/);
        expect(prompt).toMatch(/Call get_typical_month only for questions about the pace of spending or a typical month/);
        expect(prompt).toMatch(/Never call a data tool to "double-check" a result you already have/);
        expect(prompt).toMatch(/Answer format \(the arguments of give_answer\)/);
        expect(prompt).not.toMatch(/enforced by the schema/);
        expect(prompt).not.toMatch(/JSON/);
    });

    it('без операций говорит об этом', () => {
        expect(buildSystemPrompt(prepareData({ docs: [], accounts, categories, today: TODAY }))).toContain('There are no operations');
    });
});

describe('buildAnswerSchema', () => {
    const schema = buildAnswerSchema(data);

    it('все ключи обязательны и без лишних свойств на каждом уровне', () => {
        const walk = (node) => {
            if (!node || typeof node !== 'object') return;
            if (node.type === 'object') {
                expect(node.additionalProperties).toBe(false);
                expect([...node.required].sort()).toEqual(Object.keys(node.properties).sort());
            }
            Object.values(node).forEach(walk);
        };
        walk(schema);
        expect(Object.keys(schema.properties)).toEqual(['blocks', 'basis', 'history']);
    });

    it('история: категории и счета из данных, null допустим', () => {
        const history = schema.properties.history.anyOf[0];
        expect(schema.properties.history.anyOf[1]).toEqual({ type: 'null' });
        expect(history.properties.category.anyOf[0].enum).toEqual(['Транспорт', 'Кафе', 'Зарплата', 'Прочее']);
        expect(history.properties.account.anyOf[0].enum).toEqual(['Revolut', 'Наличные', 'Залог']);
        expect(history.properties.type.anyOf[0].enum).toEqual(['expense', 'income']);
    });

    it('блоки: текст или таблица', () => {
        const kinds = schema.properties.blocks.items.anyOf.map(item => item.properties.type.enum[0]);
        expect(kinds).toEqual(['text', 'table']);
        expect(JSON.stringify(schema)).not.toMatch(/"(minimum|maximum|minLength|maxLength|minItems|maxItems)"/);
        expect(JSON.stringify(schema)).not.toContain('"enum":[]');
    });
});

describe('sanitizeAnswer', () => {
    it('оставляет нормальный ответ', () => {
        const raw = answer({
            blocks: [
                { type: 'text', text: 'Первый абзац.\n\nВторой с **€5**.' },
                { type: 'table', columns: ['Месяц', '2026'], rows: [['Июнь', '€25'], ['Июль', '€40']] }
            ],
            history: { category: 'Транспорт', account: 'Revolut', type: 'expense', month: '2026-08' }
        });
        expect(sanitizeAnswer(raw, data)).toEqual({
            blocks: raw.blocks,
            basis: 'Транспорт, июнь – август 2026',
            history: { category: 'Транспорт', account: 'acc-card', type: 'expense', month: '2026-08' }
        });
    });

    it.each([null, 'текст', [], {}, { blocks: [] }, { blocks: [{ type: 'image' }] }, { blocks: [{ type: 'text', text: '   ' }] }, { blocks: [{ type: 'table', columns: [], rows: [['a']] }] }, { blocks: [{ type: 'table', columns: ['a'], rows: [] }] }])('отвергает %j', (raw) => {
        expect(sanitizeAnswer(raw, data)).toBeNull();
    });

    it('не больше 12 блоков, таблица не больше 6 колонок и 24 строк, строки по ширине таблицы', () => {
        const blocks = Array.from({ length: 15 }, (_, index) => ({ type: 'text', text: `абзац ${index}` }));
        expect(sanitizeAnswer(answer({ blocks }), data).blocks).toHaveLength(12);

        const wide = {
            type: 'table',
            columns: Array.from({ length: 8 }, (_, index) => `к${index}`),
            rows: Array.from({ length: 30 }, (_, row) => Array.from({ length: 9 }, (_, column) => `${row}:${column}`))
        };
        const [table] = sanitizeAnswer(answer({ blocks: [wide] }), data).blocks;
        expect(table.columns).toHaveLength(6);
        expect(table.rows).toHaveLength(24);
        expect(table.rows.every(row => row.length === 6)).toBe(true);

        const [short] = sanitizeAnswer(answer({ blocks: [{ type: 'table', columns: ['a', 'b'], rows: [['1']] }] }), data).blocks;
        expect(short.rows).toEqual([['1', '']]);
    });

    it('обрезает строки и чистит служебные символы', () => {
        const result = sanitizeAnswer({
            blocks: [
                { type: 'text', text: `  ${'я'.repeat(2000)}  ` },
                { type: 'text', text: 'строка\u0000 один\nстрока\u001b два' },
                { type: 'table', columns: ['к\u0000олонка'], rows: [['я'.repeat(200) + '\n']] }
            ],
            basis: `${'о'.repeat(300)}\n`,
            history: null
        }, data);
        expect(result.blocks[0].text).toHaveLength(1500);
        expect(result.blocks[1].text).toBe('строка один\nстрока два');
        expect(result.blocks[2].columns).toEqual(['к олонка']);
        expect(result.blocks[2].rows[0][0]).toHaveLength(80);
        expect(result.basis).toHaveLength(160);
    });

    it('история: неизвестные категория и счёт отбрасываются, счёт уходит как id', () => {
        const history = (patch) => sanitizeAnswer(answer({ history: { category: null, account: null, type: null, month: null, ...patch } }), data).history;
        expect(history({ category: 'Рестораны', account: 'Тинькофф', month: '2026-07' })).toEqual({ category: null, account: null, type: null, month: '2026-07' });
        expect(history({ account: 'Наличные' })).toEqual({ category: null, account: 'acc-cash', type: null, month: null });
        // Категория другого типа в связке не годится, тип остаётся
        expect(history({ category: 'Зарплата', type: 'expense' })).toEqual({ category: null, account: null, type: 'expense', month: null });
        expect(history({ category: 'Зарплата', type: 'income' })).toMatchObject({ category: 'Зарплата', type: 'income' });
        expect(history({ month: '2026-13' })).toBeNull();
        expect(history({ type: 'transfer' })).toBeNull();
        expect(history({})).toBeNull();
    });

    it('без истории история null', () => {
        expect(sanitizeAnswer(answer({ history: null }), data).history).toBeNull();
        expect(sanitizeAnswer({ blocks: answer().blocks, basis: 5 }, data)).toMatchObject({ basis: '', history: null });
    });
});

describe('POST /api/ask: вход и допуск', () => {
    it('неверный вход - 400 до всякого обращения к Claude и без расхода лимита', async () => {
        const createMessage = script(finalTurn());
        const loadContext = vi.fn(async () => context);
        const app = makeApp({ createMessage, loadContext, dailyLimit: 1 });

        const bad = await post(app, body({ messages: [{ role: 'user', text: 'я' }] }));
        expect(bad.status).toBe(400);
        expect(bad.json).toEqual({ code: 'ASK_TEXT_INVALID', message: 'Вопрос: от 2 до 500 символов, без служебных символов.' });
        expect(bad.headers['cache-control']).toBe('no-store');
        expect(createMessage).not.toHaveBeenCalled();
        expect(loadContext).not.toHaveBeenCalled();

        expect((await post(app, body({ today: 'сегодня' }))).json.code).toBe('ASK_DATE_INVALID');
        expect((await post(app, { messages: 'x', today: TODAY })).json.code).toBe('ASK_MESSAGES_INVALID');
        // Лимит в 1 вопрос не потрачен неверными запросами
        expect((await post(app)).status).toBe(200);
    });

    it('без ключа - 503 ASK_UNAVAILABLE', async () => {
        const createMessage = script(finalTurn());
        const result = await post(makeApp({ createMessage, getApiKey: () => '  ' }));
        expect(result.status).toBe(503);
        expect(result.json).toEqual({ code: 'ASK_UNAVAILABLE', message: 'Вопросы к данным не настроены.' });
        expect(createMessage).not.toHaveBeenCalled();
    });

    it('за проверкой входа: без куки - 401, Claude не вызывается', async () => {
        vi.stubEnv('APP_PASSWORD', 'test-password');
        vi.stubEnv('SESSION_SECRET', 'x'.repeat(32));
        const createMessage = script(finalTurn());
        const result = await post(makeApp({ createMessage }, true));
        expect(result.status).toBe(401);
        expect(createMessage).not.toHaveBeenCalled();
    });

    it('10 вопросов в минуту с адреса: следующий - 429 и Retry-After, потом окно сбрасывается', async () => {
        let time = 1000;
        const createMessage = script(finalTurn());
        const app = makeApp({ createMessage, rateLimiter: createClientErrorRateLimiter({ now: () => time, windowMs: 60_000, maxRequests: 10 }) });
        for (let index = 0; index < 10; index += 1) expect((await post(app)).status).toBe(200);
        const limited = await post(app);
        expect(limited.status).toBe(429);
        expect(limited.json.code).toBe('ASK_RATE_LIMITED');
        expect(limited.headers['retry-after']).toBe('60');
        expect(createMessage).toHaveBeenCalledTimes(10);
        time += 60_000;
        expect((await post(app)).status).toBe(200);
    });

    it('по умолчанию лимит 10 в минуту', async () => {
        const app = express();
        app.use(express.json());
        app.use('/api/ask', createAskRouter({ getApiKey: () => KEY, loadContext: async () => context, createMessage: script(finalTurn()) }));
        for (let index = 0; index < 10; index += 1) expect((await post(app)).status).toBe(200);
        expect((await post(app)).status).toBe(429);
    });

    it('100 вопросов в сутки: потом 429 с понятным текстом, на следующие сутки счёт заново', async () => {
        let time = Date.UTC(2026, 9, 12, 23, 0);
        const createMessage = script(finalTurn());
        const app = makeApp({ createMessage, dailyLimit: 2, now: () => time });
        expect((await post(app)).status).toBe(200);
        expect((await post(app)).status).toBe(200);
        const limited = await post(app);
        expect(limited.status).toBe(429);
        expect(limited.json).toEqual({ code: 'ASK_RATE_LIMITED', message: 'Дневной лимит вопросов исчерпан.' });
        expect(createMessage).toHaveBeenCalledTimes(2);
        time = Date.UTC(2026, 9, 13, 0, 5);
        expect((await post(app)).status).toBe(200);
    });

    it('по умолчанию дневной потолок 100', async () => {
        const createMessage = script(finalTurn());
        const app = makeApp({ createMessage });
        for (let index = 0; index < 100; index += 1) expect((await post(app)).status).toBe(200);
        expect((await post(app)).status).toBe(429);
        expect(createMessage).toHaveBeenCalledTimes(100);
    });

    it('в дневной счёт идёт один вопрос, сколько бы шагов в нём ни было', async () => {
        const createMessage = script(toolTurn(use('u1', 'get_balances', {})), finalTurn());
        const app = makeApp({ createMessage, dailyLimit: 2 });
        expect((await post(app)).status).toBe(200);
        expect((await post(app)).status).toBe(200);
        expect((await post(app)).status).toBe(429);
    });

    it('если данные не загрузились - 500 до потока, и вопрос не засчитан', async () => {
        const createMessage = script(finalTurn());
        let fail = true;
        const app = makeApp({ createMessage, dailyLimit: 1, loadContext: async () => { if (fail) throw new Error('mongo down'); return context; } });
        const result = await post(app);
        expect(result.status).toBe(500);
        expect(result.json.code).toBe('ASK_FAILED');
        expect(createMessage).not.toHaveBeenCalled();
        fail = false;
        expect((await post(app)).status).toBe(200);
    });
});

describe('POST /api/ask: цикл с инструментами', () => {
    it('отдаёт NDJSON: шаги, отметки готовности и ответ', async () => {
        const createMessage = script(
            toolTurn(use('u1', 'sum_operations', sumInput())),
            toolTurn(use('u2', 'sum_operations', sumInput({ from: '2025-06-01', to: '2025-08-31' }))),
            finalTurn(answer({ history: { category: 'Транспорт', account: null, type: 'expense', month: '2026-08' } }))
        );
        const result = await post(makeApp({ createMessage }));

        expect(result.status).toBe(200);
        expect(result.headers['content-type']).toBe('application/x-ndjson; charset=utf-8');
        expect(result.headers['cache-control']).toBe('no-store');
        expect(result.headers['x-accel-buffering']).toBe('no');
        expect(result.events).toEqual([
            { type: 'step', label: 'Транспорт, 1 июня – 31 августа 2026' },
            { type: 'step_done' },
            { type: 'step', label: 'Транспорт, 1 июня – 31 августа 2025' },
            { type: 'step_done' },
            {
                type: 'answer',
                blocks: [{ type: 'text', text: 'Этим летом на транспорт ушло **€65**.' }],
                basis: 'Транспорт, июнь – август 2026',
                history: { category: 'Транспорт', account: null, type: 'expense', month: '2026-08' }
            }
        ]);
        expect(createMessage).toHaveBeenCalledTimes(3);
    });

    it('результат инструмента - числа из серверных функций', async () => {
        const createMessage = script(toolTurn(use('u1', 'sum_operations', sumInput())), finalTurn());
        await post(makeApp({ createMessage }));
        const [, followUp] = createMessage.mock.calls;
        const [result] = followUp[0].messages.at(-1).content;
        expect(result).toMatchObject({ type: 'tool_result', tool_use_id: 'u1' });
        expect(result).not.toHaveProperty('is_error');
        expect(JSON.parse(result.content)).toMatchObject({ from: '2026-06-01', to: '2026-08-31', total: 65, count: 2, filters: { category: 'Транспорт' } });
    });

    it('запрос к Claude: модель, лимит, усилие без формата вывода, инструменты с give_answer, кэш; без чужих параметров', async () => {
        const createMessage = script(finalTurn());
        await post(makeApp({ createMessage }));
        const [params, options] = createMessage.mock.calls[0];

        expect(params.model).toBe('claude-sonnet-5-5');
        expect(params.max_tokens).toBe(8000);
        expect(params.cache_control).toEqual({ type: 'ephemeral' });
        // Формат вывода вместе с инструментами мешал модели закончить ход: на обычных раундах его нет.
        expect(params.output_config).toEqual({ effort: 'medium' });
        expect(params.tools.map(tool => tool.name)).toEqual(['sum_operations', 'find_operations', 'get_balances', 'get_typical_month', 'give_answer']);
        expect(params.tools.every(tool => tool.strict === true)).toBe(true);
        const giveAnswer = params.tools.at(-1);
        expect(giveAnswer.input_schema).toEqual(buildAnswerSchema(data));
        expect(giveAnswer.input_schema.additionalProperties).toBe(false);
        expect(giveAnswer.input_schema.required).toEqual(['blocks', 'basis', 'history']);
        expect(giveAnswer.description).toMatch(/exactly once/);
        expect(giveAnswer.description).toMatch(/nothing comes after it/);
        expect(params.system).toBe(buildSystemPrompt(data));
        for (const forbidden of ['temperature', 'top_p', 'top_k', 'thinking', 'tool_choice']) expect(params).not.toHaveProperty(forbidden);
        expect(options.signal).toBeInstanceOf(AbortSignal);
        expect(params.messages).toEqual([{ role: 'user', content: QUESTION }]);
    });

    it('модель берётся из ASK_MODEL', async () => {
        vi.stubEnv('ASK_MODEL', 'claude-test-model');
        const createMessage = script(finalTurn());
        const app = express();
        app.use(express.json());
        app.use('/api/ask', createAskRouter({ createMessage, getApiKey: () => KEY, loadContext: async () => context, rateLimiter: () => true }));
        await post(app);
        expect(createMessage.mock.calls[0][0].model).toBe('claude-test-model');

        const custom = script(finalTurn());
        await post(makeApp({ createMessage: custom, getModel: () => 'claude-custom' }));
        expect(custom.mock.calls[0][0].model).toBe('claude-custom');
    });

    it('прошлые реплики уходят обычным текстом, и только они', async () => {
        const createMessage = script(finalTurn());
        await post(makeApp({ createMessage }), body({
            messages: [
                { role: 'user', text: 'Сколько на кафе?' },
                { role: 'assistant', text: 'На кафе ушло €18.' },
                { role: 'user', text: 'А на транспорт?' }
            ]
        }));
        expect(createMessage.mock.calls[0][0].messages).toEqual([
            { role: 'user', content: 'Сколько на кафе?' },
            { role: 'assistant', content: 'На кафе ушло €18.' },
            { role: 'user', content: 'А на транспорт?' }
        ]);
    });

    it('ответ модели возвращается как есть, а результаты параллельных вызовов - одним сообщением', async () => {
        const first = toolTurn(
            use('u1', 'sum_operations', sumInput()),
            use('u2', 'get_balances', {}),
            use('u3', 'sum_operations', sumInput({ category: 'Рестораны' }))
        );
        const createMessage = script(first, finalTurn());
        const result = await post(makeApp({ createMessage }));

        const [, second] = createMessage.mock.calls;
        const sent = second[0].messages;
        expect(sent).toHaveLength(3);
        // Блоки размышления и вызовов не тронуты: тот же объект, а не копия
        expect(sent[1]).toEqual({ role: 'assistant', content: first.content });
        expect(sent[1].content).toBe(first.content);
        expect(sent[1].content[0]).toMatchObject({ type: 'thinking', signature: 'sig-1' });
        expect(sent[2].role).toBe('user');
        expect(sent[2].content.map(block => block.tool_use_id)).toEqual(['u1', 'u2', 'u3']);
        expect(sent[2].content.every(block => block.type === 'tool_result')).toBe(true);
        // Неверный ввод - is_error, а не исключение, и цикл продолжается
        expect(sent[2].content[2]).toMatchObject({ is_error: true });
        expect(sent[2].content[2].content).toMatch(/Unknown category/);
        expect(sent[2].content[0]).not.toHaveProperty('is_error');

        expect(result.events.filter(event => event.type === 'step')).toHaveLength(3);
        expect(result.events.map(event => event.type)).toEqual(['step', 'step_done', 'step', 'step_done', 'step', 'step_done', 'answer']);
    });

    it('история растёт: каждый следующий запрос содержит все прошлые шаги', async () => {
        const createMessage = script(
            toolTurn(use('u1', 'get_balances', {})),
            toolTurn(use('u2', 'sum_operations', sumInput())),
            finalTurn()
        );
        await post(makeApp({ createMessage }));
        expect(createMessage.mock.calls.map(call => call[0].messages.length)).toEqual([1, 3, 5]);
    });

    it('система, инструменты и параметры байт-в-байт одни и те же на всех шагах', async () => {
        const createMessage = script(
            toolTurn(use('u1', 'get_balances', {})),
            toolTurn(use('u2', 'sum_operations', sumInput())),
            finalTurn()
        );
        await post(makeApp({ createMessage }));
        const calls = createMessage.mock.calls.map(call => call[0]);
        expect(calls).toHaveLength(3);
        for (const params of calls) {
            expect(JSON.stringify(params.system)).toBe(JSON.stringify(calls[0].system));
            expect(JSON.stringify(params.tools)).toBe(JSON.stringify(calls[0].tools));
            expect(JSON.stringify(params.output_config)).toBe(JSON.stringify(calls[0].output_config));
            const { messages: _drop, ...rest } = params;
            const { messages: _first, ...firstRest } = calls[0];
            expect(JSON.stringify(rest)).toBe(JSON.stringify(firstRest));
        }
    });

    it('чистит ответ: лишние блоки, неизвестная категория в истории', async () => {
        const createMessage = script(finalTurn(answer({
            blocks: Array.from({ length: 14 }, (_, index) => ({ type: 'text', text: `абзац ${index}` })),
            history: { category: 'Рестораны', account: 'Revolut', type: null, month: null }
        })));
        const result = await post(makeApp({ createMessage }));
        const final = lastEvent(result);
        expect(final.blocks).toHaveLength(12);
        expect(final.history).toEqual({ category: null, account: 'acc-card', type: null, month: null });
    });

    it('данные не уходят в Claude целиком: в запросе нет операций', async () => {
        const createMessage = script(finalTurn());
        await post(makeApp({ createMessage }));
        const text = JSON.stringify(createMessage.mock.calls[0][0]);
        expect(text).not.toContain('Bolt');
        expect(text).not.toContain('3000');
    });
});

describe('POST /api/ask: итоговый ответ give_answer', () => {
    const unparsed = { type: 'error', code: 'ASK_UNPARSED', message: 'Не получилось ответить. Попробуйте спросить иначе.' };
    const finalAnswer = { type: 'answer', blocks: answer().blocks, basis: answer().basis, history: null };

    it('вызов данных, затем give_answer в следующем ответе: шаг, ответ, запрос к Claude без tool_choice', async () => {
        const createMessage = script(toolTurn(use('u1', 'sum_operations', sumInput())), finalTurn());
        const result = await post(makeApp({ createMessage }));
        expect(result.events).toEqual([
            { type: 'step', label: 'Транспорт, 1 июня – 31 августа 2026' },
            { type: 'step_done' },
            finalAnswer
        ]);
        expect(createMessage).toHaveBeenCalledTimes(2);
        for (const [params] of createMessage.mock.calls) {
            expect(params.output_config).not.toHaveProperty('format');
            expect(params).not.toHaveProperty('tool_choice');
        }
    });

    it('give_answer в первом ответе: ответ без единого шага', async () => {
        const createMessage = script(finalTurn(answer({ history: { category: 'Транспорт', account: 'Revolut', type: 'expense', month: '2026-08' } })));
        const result = await post(makeApp({ createMessage }));
        expect(result.events).toEqual([{ ...finalAnswer, history: { category: 'Транспорт', account: 'acc-card', type: 'expense', month: '2026-08' } }]);
        expect(createMessage).toHaveBeenCalledTimes(1);
    });

    it('give_answer рядом с вызовом данных: ответ, вызов не выполняется и шага нет', async () => {
        const createMessage = script({
            stop_reason: 'tool_use',
            content: [
                { type: 'thinking', thinking: 'считаю', signature: 'sig-1' },
                use('u1', 'sum_operations', sumInput()),
                use('ans-1', 'give_answer', answer()),
                use('u2', 'get_balances', {})
            ]
        });
        const log = vi.fn();
        const result = await post(makeApp({ createMessage, log }));
        expect(result.events).toEqual([finalAnswer]);
        expect(createMessage).toHaveBeenCalledTimes(1);
        expect(log.mock.calls[0][0]).toContain('tools=give_answer outcome=answer');
    });

    it('ввод give_answer чистится как любой ответ', async () => {
        const createMessage = script(finalTurn(answer({
            blocks: Array.from({ length: 14 }, (_, index) => ({ type: 'text', text: `абзац ${index}` })),
            basis: 'о'.repeat(300),
            history: { category: 'Рестораны', account: 'Revolut', type: null, month: null }
        })));
        const final = lastEvent(await post(makeApp({ createMessage })));
        expect(final.blocks).toHaveLength(12);
        expect(final.basis).toHaveLength(160);
        expect(final.history).toEqual({ category: null, account: 'acc-card', type: null, month: null });
    });

    it('give_answer с неверным вводом - ASK_UNPARSED, остальные вызовы хода не выполняются', async () => {
        const createMessage = script({
            stop_reason: 'tool_use',
            content: [use('u1', 'get_balances', {}), use('ans-1', 'give_answer', { blocks: 'ответ' })]
        });
        const result = await post(makeApp({ createMessage }));
        expect(result.events).toEqual([unparsed]);
        expect(createMessage).toHaveBeenCalledTimes(1);
    });

    it('give_answer не проверяется на повтор и не попадает в историю как результат', async () => {
        const createMessage = script(toolTurn(use('u1', 'get_balances', {})), finalTurn());
        await post(makeApp({ createMessage }));
        expect(createMessage.mock.calls.at(-1)[0].messages.some(message => JSON.stringify(message).includes('give_answer'))).toBe(false);
    });

    it('конец хода обычным текстом - текстовый ответ без basis и фильтра', async () => {
        const result = await post(makeApp({ createMessage: script(textTurn('  Расходы на транспорт: **€65**.\n\nВот так.  ')) }));
        expect(result.events).toEqual([{ type: 'answer', blocks: [{ type: 'text', text: 'Расходы на транспорт: **€65**.\n\nВот так.' }], basis: '', history: null }]);
    });

    it('текстовый ответ режется по длине текстового блока и чистится от служебных символов', async () => {
        const result = await post(makeApp({ createMessage: script(textTurn(`а\u0000б${'я'.repeat(2000)}`)) }));
        const [block] = lastEvent(result).blocks;
        expect(block.text).toHaveLength(1500);
        expect(block.text.startsWith('а б')).toBe(true);
    });

    it('конец хода текстом после вызовов данных тоже ответ', async () => {
        const createMessage = script(toolTurn(use('u1', 'get_balances', {})), textTurn('Остатки посчитаны.'));
        const result = await post(makeApp({ createMessage }));
        expect(result.events.map(event => event.type)).toEqual(['step', 'step_done', 'answer']);
        expect(lastEvent(result).blocks[0].text).toBe('Остатки посчитаны.');
    });

    it('конец хода с JSON ответа в тексте - разобранный ответ', async () => {
        const raw = answer({ history: { category: 'Транспорт', account: null, type: 'expense', month: '2026-08' } });
        const result = await post(makeApp({ createMessage: script(jsonTurn(raw)) }));
        expect(lastEvent(result)).toEqual({ type: 'answer', ...raw });
    });

    it('конец хода с пустым текстом - ASK_UNPARSED', async () => {
        expect(lastEvent(await post(makeApp({ createMessage: script(textTurn('')) })))).toEqual(unparsed);
        expect(lastEvent(await post(makeApp({ createMessage: script({ stop_reason: 'end_turn', content: [] }) })))).toEqual(unparsed);
    });

    it('give_answer на последнем запросе тоже принимается (запасной выход)', async () => {
        const turns = [...Array.from({ length: 6 }, (_, index) => toolTurn(use(`u${index}`, 'get_balances', { n: index }))), finalTurn()];
        const result = await post(makeApp({ createMessage: script(...turns) }));
        expect(lastEvent(result).type).toBe('answer');
    });
});

describe('POST /api/ask: ошибки Claude и пределы', () => {
    const unparsed = { type: 'error', code: 'ASK_UNPARSED', message: 'Не получилось ответить. Попробуйте спросить иначе.' };

    it.each([
        ['отказ', { stop_reason: 'refusal', content: [] }],
        ['обрезанный ответ', { ...jsonTurn(), stop_reason: 'max_tokens' }],
        ['пауза', { stop_reason: 'pause_turn', content: [] }],
        ['конец хода без текстового блока', { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '...' }] }],
        ['конец хода с пустым текстом', textTurn('  \n ')],
        ['JSON-объект в тексте без блоков', jsonTurn({ blocks: [], basis: '', history: null })],
        ['give_answer без блоков', finalTurn({ blocks: [], basis: '', history: null })],
        ['give_answer с мусором вместо ответа', finalTurn('ответ')],
        ['give_answer с пустым вводом', finalTurn({})],
        ['give_answer с текстом из пробелов', finalTurn({ blocks: [{ type: 'text', text: '  ' }], basis: '', history: null })],
        ['tool_use без вызовов', { stop_reason: 'tool_use', content: [{ type: 'text', text: 'ок' }] }]
    ])('ASK_UNPARSED: %s', async (_name, message) => {
        const result = await post(makeApp({ createMessage: script(message) }));
        expect(result.status).toBe(200);
        expect(lastEvent(result)).toEqual(unparsed);
        expect(result.text).not.toContain(KEY);
    });

    it('берёт последний текстовый блок после размышления', async () => {
        const turn = { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: 'ага' }, ...jsonTurn().content] };
        expect(lastEvent(await post(makeApp({ createMessage: script(turn) }))).type).toBe('answer');
    });

    it('после 6 раундов инструментов - последний запрос без инструментов, а не ошибка', async () => {
        const turns = [...Array.from({ length: 6 }, (_, index) => toolTurn(use(`u${index}`, 'get_balances', { n: index }))), jsonTurn()];
        const createMessage = script(...turns);
        const result = await post(makeApp({ createMessage }));
        expect(createMessage).toHaveBeenCalledTimes(7);
        expect(lastEvent(result).type).toBe('answer');
        expect(result.events.filter(event => event.type === 'step')).toHaveLength(6);

        const calls = createMessage.mock.calls.map(([params]) => params);
        const forcedParams = calls[6];
        expect(forcedParams.tool_choice).toEqual({ type: 'none' });
        expect(forcedParams.messages.at(-1)).toEqual({
            role: 'system',
            content: 'The tool budget for this question is used up. Answer now from the tool results above. If something could not be computed, say so in the answer.'
        });
        expect(forcedParams.messages.at(-2).role).toBe('user');
        expect(forcedParams.messages.at(-2).content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'u5' });
        // Прежние сообщения не тронуты: ответы модели как есть, результаты по порядку.
        const before = forcedParams.messages.slice(0, -1);
        expect(before).toEqual(calls[5].messages.concat([
            { role: 'assistant', content: turns[5].content },
            { role: 'user', content: [expect.objectContaining({ type: 'tool_result', tool_use_id: 'u5' })] }
        ]));
        expect(before.filter(message => message.role === 'assistant').map(message => message.content)).toEqual(turns.slice(0, 6).map(turn => turn.content));
        // История дописывается: у предыдущих запросов тот же префикс, system и tools те же.
        for (let index = 1; index < calls.length; index += 1) {
            expect(calls[index].messages.slice(0, calls[index - 1].messages.length)).toEqual(calls[index - 1].messages);
            expect(calls[index].system).toBe(calls[0].system);
            expect(calls[index].tools).toEqual(calls[0].tools);
            expect(JSON.stringify(calls[index].tools)).toBe(JSON.stringify(calls[0].tools));
        }
        // До последнего запроса tool_choice не отправляется и служебной реплики нет.
        for (const params of calls.slice(0, 6)) {
            expect(params).not.toHaveProperty('tool_choice');
            expect(params.messages.some(message => message.role === 'system')).toBe(false);
            expect(params.output_config).toEqual({ effort: 'medium' });
        }
        // Формат вывода - только на последнем запросе, остальное без изменений.
        expect(forcedParams.output_config).toEqual({ effort: 'medium', format: { type: 'json_schema', schema: buildAnswerSchema(data) } });
    });

    it('последний запрос: плохой JSON - ASK_UNPARSED', async () => {
        const turns = [...Array.from({ length: 6 }, (_, index) => toolTurn(use(`u${index}`, 'get_balances', { n: index }))),
            { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"blocks":' }] }];
        const createMessage = script(...turns);
        const result = await post(makeApp({ createMessage }));
        expect(createMessage).toHaveBeenCalledTimes(7);
        expect(lastEvent(result)).toEqual({ type: 'error', code: 'ASK_UNPARSED', message: 'Не получилось ответить. Попробуйте спросить иначе.' });

        // На последнем запросе формат вывода гарантирует JSON: обычный текст ответом не считается.
        const plain = script(...turns.slice(0, 6), textTurn('Просто слова'));
        expect(lastEvent(await post(makeApp({ createMessage: plain }))).code).toBe('ASK_UNPARSED');
    });

    it('последний запрос: снова tool_use (запасной выход) - ASK_TOO_COMPLEX, инструменты не выполняются', async () => {
        const createMessage = script(...Array.from({ length: 8 }, (_, index) => toolTurn(use(`u${index}`, 'get_balances', { n: index }))));
        const result = await post(makeApp({ createMessage }));
        expect(createMessage).toHaveBeenCalledTimes(7);
        expect(lastEvent(result)).toEqual({ type: 'error', code: 'ASK_TOO_COMPLEX', message: 'Вопрос оказался слишком сложным. Попробуйте разбить его на части.' });
        expect(result.events.filter(event => event.type === 'step')).toHaveLength(6);
    });

    it('вопрос в 1-2 раунда не отправляет tool_choice', async () => {
        const createMessage = script(toolTurn(use('u1', 'sum_operations', sumInput())), toolTurn(use('u2', 'get_balances', {})), finalTurn());
        const result = await post(makeApp({ createMessage }));
        expect(lastEvent(result).type).toBe('answer');
        for (const [params] of createMessage.mock.calls) {
            expect(params).not.toHaveProperty('tool_choice');
            expect(params.messages.some(message => message.role === 'system')).toBe(false);
        }
    });

    it('седьмой запрос может быть ответом без служебной реплики, если инструментов хватило', async () => {
        const turns = [...Array.from({ length: 5 }, (_, index) => toolTurn(use(`u${index}`, 'get_balances', { n: index }))), finalTurn()];
        const createMessage = script(...turns);
        expect(lastEvent(await post(makeApp({ createMessage }))).type).toBe('answer');
        expect(createMessage.mock.calls.at(-1)[0]).not.toHaveProperty('tool_choice');
    });

    it('молчание дольше 60 секунд (здесь 40 мс) - ASK_TIMEOUT, запрос к Claude отменён', async () => {
        const createMessage = vi.fn(() => new Promise(() => {}));
        const result = await post(makeApp({ createMessage, timeoutMs: 40 }));
        expect(lastEvent(result)).toEqual({ type: 'error', code: 'ASK_TIMEOUT', message: 'Claude не ответил вовремя. Вопрос сохранен, его можно отправить еще раз.' });
        expect(createMessage.mock.calls[0][1].signal.aborted).toBe(true);
    });

    it('таймаут считается на весь вопрос, а не на каждый шаг', async () => {
        let calls = 0;
        const createMessage = vi.fn(async () => {
            calls += 1;
            await new Promise(resolve => setTimeout(resolve, 30));
            return toolTurn(use(`u${calls}`, 'get_balances', {}));
        });
        const result = await post(makeApp({ createMessage, timeoutMs: 100 }));
        expect(lastEvent(result).code).toBe('ASK_TIMEOUT');
        expect(calls).toBeLessThan(7);
    });

    it('таймаут SDK тоже ASK_TIMEOUT', async () => {
        // Тот же экземпляр класса, что и у сервера (CommonJS), а не ESM-копия.
        const { APIConnectionTimeoutError } = createRequire(import.meta.url)('@anthropic-ai/sdk');
        const createMessage = vi.fn(async () => { throw new APIConnectionTimeoutError(); });
        expect(lastEvent(await post(makeApp({ createMessage }))).code).toBe('ASK_TIMEOUT');
    });

    it('429 от Claude - ASK_FAILED с текстом про ограничение', async () => {
        const createMessage = vi.fn(async () => { throw Object.assign(new Error('rate'), { status: 429 }); });
        const result = await post(makeApp({ createMessage }));
        expect(lastEvent(result)).toEqual({ type: 'error', code: 'ASK_FAILED', message: 'Claude временно ограничил запросы. Попробуйте через минуту.' });
    });

    it('другая ошибка - ASK_FAILED без подробностей, в журнале нет ни вопроса, ни тела ошибки', async () => {
        const createMessage = vi.fn(async () => { throw new Error(`401 {"error":"bad key ${KEY}"} ${QUESTION}`); });
        const result = await post(makeApp({ createMessage }));
        expect(lastEvent(result)).toEqual({ type: 'error', code: 'ASK_FAILED', message: 'Не удалось связаться с Claude. Попробуйте еще раз.' });
        expect(result.text).not.toContain(KEY);
        const logged = JSON.stringify(console.error.mock.calls);
        expect(logged).not.toContain(KEY);
        expect(logged).not.toContain('Сравни');
        expect(logged).not.toContain('bad key');
    });

    it('ошибка после нескольких шагов тоже приходит событием в конце потока', async () => {
        let call = 0;
        const createMessage = vi.fn(async () => {
            call += 1;
            if (call === 1) return toolTurn(use('u1', 'get_balances', {}));
            throw new Error('boom');
        });
        const result = await post(makeApp({ createMessage }));
        expect(result.events.map(event => event.type)).toEqual(['step', 'step_done', 'error']);
    });

    it('в журнал не попадают ни вопрос, ни результаты инструментов', async () => {
        const createMessage = script(toolTurn(use('u1', 'sum_operations', sumInput())), finalTurn());
        await post(makeApp({ createMessage }));
        expect(console.error).not.toHaveBeenCalled();
    });
});

describe('POST /api/ask: повторные вызовы', () => {
    it('тот же вызов не выполняется заново: прежний результат с пометкой, второго шага нет', async () => {
        const createMessage = script(
            toolTurn(use('u1', 'sum_operations', sumInput())),
            // тот же ввод, ключи в другом порядке
            toolTurn(use('u2', 'sum_operations', Object.fromEntries(Object.entries(sumInput()).reverse()))),
            finalTurn()
        );
        const result = await post(makeApp({ createMessage }));
        expect(result.events.filter(event => event.type === 'step')).toHaveLength(1);
        expect(lastEvent(result).type).toBe('answer');

        const [first] = createMessage.mock.calls[1][0].messages.at(-1).content;
        const [second] = createMessage.mock.calls[2][0].messages.at(-1).content;
        expect(second).toMatchObject({ type: 'tool_result', tool_use_id: 'u2' });
        expect(second).not.toHaveProperty('is_error');
        expect(JSON.parse(second.content)).toEqual({
            note: 'Same call as before; the result has not changed. Use it instead of calling again.',
            result: JSON.parse(first.content)
        });
    });

    it('другой ввод выполняется', async () => {
        const createMessage = script(
            toolTurn(use('u1', 'sum_operations', sumInput())),
            toolTurn(use('u2', 'sum_operations', sumInput({ from: '2025-06-01', to: '2025-08-31' }))),
            finalTurn()
        );
        const result = await post(makeApp({ createMessage }));
        expect(result.events.filter(event => event.type === 'step')).toHaveLength(2);
        const [second] = createMessage.mock.calls[2][0].messages.at(-1).content;
        expect(JSON.parse(second.content)).toMatchObject({ from: '2025-06-01', total: 20 });
        expect(JSON.parse(second.content)).not.toHaveProperty('note');
    });

    it('дубль внутри одного хода тоже не выполняется; повтор ошибки остаётся ошибкой и валидным JSON', async () => {
        const bad = { group_by: 'nonsense' };
        const createMessage = script(
            toolTurn(use('u1', 'get_balances', {}), use('u2', 'get_balances', {}), use('u3', 'sum_operations', bad)),
            toolTurn(use('u4', 'sum_operations', bad)),
            finalTurn()
        );
        const result = await post(makeApp({ createMessage }));
        expect(result.events.filter(event => event.type === 'step')).toHaveLength(2);
        const [one, two, three] = createMessage.mock.calls[1][0].messages.at(-1).content;
        expect(JSON.parse(two.content).note).toMatch(/^Same call as before/);
        expect(JSON.parse(two.content).result).toEqual(JSON.parse(one.content));
        expect(three.is_error).toBe(true);
        const [repeat] = createMessage.mock.calls[2][0].messages.at(-1).content;
        expect(repeat.is_error).toBe(true);
        expect(JSON.parse(repeat.content)).toEqual({ note: expect.stringMatching(/^Same call as before/), result: three.content });
    });
});

describe('POST /api/ask: журнал', () => {
    const LINE = /^\[ask\] rounds=(\d+) forced=(true|false) tools=(\S+) outcome=(\S+) ms=(\d+)$/;

    it('одна строка на вопрос: раунды, инструменты, исход, время', async () => {
        const log = vi.fn();
        const createMessage = script(
            toolTurn(use('u1', 'sum_operations', sumInput()), use('u2', 'sum_operations', { group_by: 'nonsense' })),
            toolTurn(use('u3', 'sum_operations', sumInput())),
            finalTurn()
        );
        await post(makeApp({ createMessage, log }));
        expect(log).toHaveBeenCalledTimes(1);
        const match = LINE.exec(log.mock.calls[0][0]);
        expect(match).not.toBeNull();
        expect(match.slice(1, 5)).toEqual(['2', 'false', 'sum_operations:ok,sum_operations:error,sum_operations:dup,give_answer', 'answer']);
    });

    it('по умолчанию пишет через console.info', async () => {
        await post(makeApp({ createMessage: script(finalTurn()) }));
        expect(console.info).toHaveBeenCalledTimes(1);
        expect(console.info.mock.calls[0][0]).toMatch(LINE);
        expect(console.info.mock.calls[0][0]).toContain('tools=give_answer outcome=answer');
    });

    it('принудительный ответ и ошибки отражены в исходе', async () => {
        const rounds = Array.from({ length: 6 }, (_, index) => toolTurn(use(`u${index}`, 'get_balances', { n: index })));
        const log = vi.fn();
        await post(makeApp({ createMessage: script(...rounds, { stop_reason: 'end_turn', content: [] }), log }));
        expect(log.mock.calls[0][0]).toMatch(/rounds=6 forced=true tools=(get_balances:ok,){5}get_balances:ok outcome=ASK_UNPARSED ms=\d+$/);

        const failing = vi.fn();
        await post(makeApp({ createMessage: vi.fn(async () => { throw new Error('boom'); }), log: failing }));
        expect(failing.mock.calls[0][0]).toMatch(/rounds=0 forced=false tools=- outcome=ASK_FAILED ms=\d+$/);

        const timeout = vi.fn();
        await post(makeApp({ createMessage: vi.fn(() => new Promise(() => {})), timeoutMs: 30, log: timeout }));
        expect(timeout.mock.calls[0][0]).toMatch(/outcome=ASK_TIMEOUT/);
    });

    it('неизвестный инструмент в журнале - unknown, а не то, что прислала модель', async () => {
        const log = vi.fn();
        await post(makeApp({ createMessage: script(toolTurn(use('u1', 'secret_Транспорт_65', {})), finalTurn()), log }));
        expect(log.mock.calls[0][0]).toContain('tools=unknown:error');
    });

    it('в строке нет ни вопроса, ни сумм, ни названий категорий, ни ввода и результатов инструментов', async () => {
        const log = vi.fn();
        const createMessage = script(
            toolTurn(use('u1', 'sum_operations', sumInput({ company: 'Bolt' })), use('u2', 'find_operations', { query: 'Сравни' })),
            finalTurn(answer({ blocks: [{ type: 'text', text: `Транспорт, Bolt, 3000 ${KEY}` }], basis: 'Сравни' }))
        );
        await post(makeApp({ createMessage, log }));
        const line = log.mock.calls[0][0];
        expect(line).toMatch(LINE);
        for (const fragment of ['Сравни', 'транспорт', 'Транспорт', 'Кафе', 'Зарплата', 'Revolut', 'Bolt', '65', '3000', '2026', KEY]) {
            expect(line).not.toContain(fragment);
        }
        expect(JSON.stringify(console.info.mock.calls)).not.toContain('Сравни');
    });

    it('сбой журнала не ломает ответ', async () => {
        const log = vi.fn(() => { throw new Error('disk'); });
        const result = await post(makeApp({ createMessage: script(finalTurn()), log }));
        expect(lastEvent(result).type).toBe('answer');
    });
});

describe('POST /api/ask: подробный журнал ASK_DEBUG', () => {
    const PREFIX = '[ask:debug] ';
    const debugLines = (log) => log.mock.calls.map(([line]) => line).filter(line => line.startsWith(PREFIX)).map(line => JSON.parse(line.slice(PREFIX.length)));
    const rounds = (log) => debugLines(log).filter(item => 'round' in item);
    const shapeOf = (log) => debugLines(log).find(item => 'request_shape' in item).request_shape;

    // Два раунда: один вызов, затем дубль и ещё один вызов с группировкой; потом ответ.
    const toolUse = (id, input) => ({ type: 'tool_use', id, name: 'sum_operations', input });
    const scenario = () => script(
        toolTurn(toolUse('u1', sumInput())),
        toolTurn(toolUse('u2', sumInput()), toolUse('u3', sumInput({ group_by: 'month', category: null }))),
        { ...jsonTurn(), usage: { input_tokens: 120, output_tokens: 30, cache_read_input_tokens: 100, cache_creation_input_tokens: 0, service_tier: 'standard' } }
    );

    it('по умолчанию (флаг выключен) - только строка итога', async () => {
        const log = vi.fn();
        await post(makeApp({ createMessage: scenario(), log }));
        expect(log).toHaveBeenCalledTimes(1);
        expect(log.mock.calls[0][0]).toMatch(/^\[ask\] /);
    });

    it('флаг берётся из ASK_DEBUG: только точное true', async () => {
        for (const [value, expected] of [['true', 3], ['1', 1], ['', 1]]) {
            vi.stubEnv('ASK_DEBUG', value);
            const log = vi.fn();
            await post(makeApp({ createMessage: script(finalTurn()), log }));
            expect(log).toHaveBeenCalledTimes(expected);
        }
    });

    it('флаг читается один раз за вопрос', async () => {
        const getDebug = vi.fn(() => true);
        await post(makeApp({ createMessage: scenario(), log: vi.fn(), getDebug }));
        expect(getDebug).toHaveBeenCalledTimes(1);
    });

    it('строка на каждый запрос: блоки, текст, расход, вызовы с результатами и дублями', async () => {
        const log = vi.fn();
        await post(makeApp({ createMessage: scenario(), log, getDebug: () => true }));
        const items = rounds(log);
        expect(items).toHaveLength(3);
        expect(log.mock.calls.at(-1)[0]).toMatch(/^\[ask\] rounds=2 /);

        expect(items[0]).toEqual({
            round: 1,
            forced: false,
            stop_reason: 'tool_use',
            blocks: ['thinking(text,signed)', 'tool_use'],
            text_chars: [],
            text_head: null,
            usage: {},
            calls: [{
                name: 'sum_operations',
                input: sumInput(),
                dup: false,
                is_error: false,
                result: { total: 65, count: 2, groups: 0, top: [], note: null }
            }]
        });

        expect(items[1].round).toBe(2);
        expect(items[1].calls.map(call => [call.dup, call.is_error])).toEqual([[true, false], [false, false]]);
        expect(items[1].calls[0].result).toEqual(items[0].calls[0].result);
        expect(items[1].calls[1].input).toEqual(sumInput({ group_by: 'month', category: null }));
        expect(items[1].calls[1].result).toMatchObject({ groups: 2, top: [{ key: '2026-07', total: 40 }, { key: '2026-06', total: 25 }] });
        expect(Object.keys(items[1].calls[1].result.top[0])).toEqual(['key', 'total']);

        expect(items[2]).toMatchObject({
            round: 3,
            forced: false,
            stop_reason: 'end_turn',
            blocks: ['text'],
            usage: { input_tokens: 120, output_tokens: 30, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 },
            calls: [],
            answer_ok: true
        });
        expect(items[2].usage).not.toHaveProperty('service_tier');
        expect(items[2].text_chars).toEqual([JSON.stringify(answer()).length]);
        expect(items[2].text_head).toBe(JSON.stringify(answer()).slice(0, 300));
        expect(items[0]).not.toHaveProperty('answer_ok');
    });

    it('описание блоков размышления и сводки остальных инструментов, ошибка - текстом до 200 знаков', async () => {
        const log = vi.fn();
        const long = 'x'.repeat(300);
        const createMessage = script(
            {
                stop_reason: 'tool_use',
                content: [
                    { type: 'thinking', thinking: '', signature: 'sig' },
                    { type: 'thinking', thinking: 'мысль' },
                    { type: 'text', text: long },
                    use('u1', 'find_operations', { from: '2026-01-01', to: '2026-12-31' }),
                    use('u2', 'get_balances', {}),
                    use('u3', 'get_typical_month', { month: '2026-09' }),
                    use('u4', 'sum_operations', { group_by: 'nonsense' })
                ]
            },
            { stop_reason: 'end_turn', content: [{ type: 'text', text: '  ' }] }
        );
        await post(makeApp({ createMessage, log, getDebug: () => true }));
        const [first, last] = rounds(log);
        expect(first.blocks).toEqual(['thinking(empty,signed)', 'thinking(text,unsigned)', 'text', 'tool_use', 'tool_use', 'tool_use', 'tool_use']);
        expect(first.text_chars).toEqual([300]);
        expect(first.text_head).toBe('x'.repeat(300));
        const [find, balances, typical, bad] = first.calls;
        expect(find.result).toEqual({ total_found: 3, operations: 3 });
        expect(balances.result).toEqual({ accounts: 3 });
        expect(typical.result).toEqual(expect.any(Array));
        expect(typical.result).toContain('month');
        expect(bad).toMatchObject({ is_error: true, dup: false });
        expect(typeof bad.result).toBe('string');
        expect(bad.result.length).toBeLessThanOrEqual(200);
        expect(last).toMatchObject({ stop_reason: 'end_turn', answer_ok: false });
    });

    it('give_answer в журнале: имя, исход, число блоков и длина basis, без ввода', async () => {
        const log = vi.fn();
        const createMessage = script(
            toolTurn(toolUse('u1', sumInput())),
            toolTurn(use('ans-1', 'give_answer', answer()))
        );
        await post(makeApp({ createMessage, log, getDebug: () => true }));
        const items = rounds(log);
        expect(items).toHaveLength(2);
        expect(items[1]).toMatchObject({ round: 2, forced: false, stop_reason: 'tool_use', blocks: ['thinking(text,signed)', 'tool_use'] });
        expect(items[1].calls).toEqual([{ name: 'give_answer', answer_ok: true, blocks: 1, basis_chars: answer().basis.length }]);
        expect(items[1]).not.toHaveProperty('answer_ok');
        expect(log.mock.calls.at(-1)[0]).toMatch(/^\[ask\] rounds=1 forced=false tools=sum_operations:ok,give_answer outcome=answer /);

        const bad = vi.fn();
        await post(makeApp({ createMessage: script(toolTurn(use('ans-2', 'give_answer', { blocks: [] }))), log: bad, getDebug: () => true }));
        expect(rounds(bad)[0].calls).toEqual([{ name: 'give_answer', answer_ok: false, blocks: 0, basis_chars: 0 }]);
        expect(bad.mock.calls.at(-1)[0]).toMatch(/tools=give_answer outcome=ASK_UNPARSED/);
        expect(JSON.stringify(bad.mock.calls)).not.toContain('"input"');
    });

    it('текст головы обрезается до 300 знаков и берётся из последнего текстового блока', async () => {
        const log = vi.fn();
        const text = JSON.stringify(answer({ basis: 'я'.repeat(400) }));
        const createMessage = script({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'первый' }, { type: 'text', text }] });
        await post(makeApp({ createMessage, log, getDebug: () => true }));
        const [item] = rounds(log);
        expect(item.text_chars).toEqual([6, text.length]);
        expect(item.text_head).toHaveLength(300);
        expect(item.text_head).toBe(text.slice(0, 300));
    });

    it('принудительный запрос после 6 раундов: forced и повторы в журнале', async () => {
        const log = vi.fn();
        const same = toolTurn(use('u', 'sum_operations', sumInput()));
        const turns = Array.from({ length: 6 }, (_, index) => ({ ...same, content: [same.content[0], use(`u${index}`, 'sum_operations', sumInput())] }));
        await post(makeApp({ createMessage: script(...turns, jsonTurn()), log, getDebug: () => true }));
        const items = rounds(log);
        expect(items).toHaveLength(7);
        expect(items.map(item => item.forced)).toEqual([false, false, false, false, false, false, true]);
        expect(items.slice(0, 6).map(item => item.calls[0].dup)).toEqual([false, true, true, true, true, true]);
        expect(items[6]).toMatchObject({ round: 7, stop_reason: 'end_turn', answer_ok: true });
    });

    it('форма последнего запроса: результаты стоят под своими tool_use_id', async () => {
        const log = vi.fn();
        const createMessage = script(
            toolTurn(use('u1', 'sum_operations', sumInput())),
            toolTurn(use('u2', 'sum_operations', sumInput()), use('u3', 'get_balances', {})),
            finalTurn()
        );
        await post(makeApp({ createMessage, log, getDebug: () => true }));
        const lastRequest = createMessage.mock.calls.at(-1)[0];
        const shape = shapeOf(log);

        expect(shape.messages).toEqual([
            { role: 'user', content: `string(${QUESTION.length})` },
            { role: 'assistant', content: ['thinking', 'tool_use'] },
            { role: 'user', content: [`tool_result(u1,${lastRequest.messages[2].content[0].content.length})`] },
            { role: 'assistant', content: ['thinking', 'tool_use', 'tool_use'] },
            { role: 'user', content: [expect.stringMatching(/^tool_result\(u2,\d+\)$/), expect.stringMatching(/^tool_result\(u3,\d+\)$/)] }
        ]);
        // Каждый tool_result в форме идёт под тем же id, что tool_use перед ним.
        for (let index = 1; index < shape.messages.length; index += 2) {
            const useIds = lastRequest.messages[index].content.filter(block => block.type === 'tool_use').map(block => block.id);
            const resultIds = shape.messages[index + 1].content.map(label => /^tool_result\(([^,]+),/.exec(label)[1]);
            expect(resultIds).toEqual(useIds);
        }
        expect(shape).toMatchObject({
            tool_choice: null,
            has_output_config_format: false,
            system_chars: lastRequest.system.length,
            tools: lastRequest.tools.map(tool => tool.name)
        });
        expect(shape.tools).toEqual(['sum_operations', 'find_operations', 'get_balances', 'get_typical_month', 'give_answer']);
        // Форма одна на вопрос и идёт перед строкой итога.
        expect(debugLines(log).filter(item => 'request_shape' in item)).toHaveLength(1);
        expect(log.mock.calls.at(-1)[0]).toMatch(/^\[ask\] /);
        expect(log.mock.calls.at(-2)[0]).toMatch(/^\[ask:debug\] \{"request_shape"/);
    });

    it('форма принудительного запроса: tool_choice none и служебная реплика', async () => {
        const log = vi.fn();
        const turns = Array.from({ length: 6 }, (_, index) => toolTurn(use(`u${index}`, 'get_balances', { n: index })));
        await post(makeApp({ createMessage: script(...turns, jsonTurn()), log, getDebug: () => true }));
        const shape = shapeOf(log);
        expect(shape.tool_choice).toEqual({ type: 'none' });
        expect(shape.has_output_config_format).toBe(true);
        expect(shape.messages).toHaveLength(14);
        expect(shape.messages.at(-1)).toEqual({ role: 'system', content: `string(${'The tool budget for this question is used up. Answer now from the tool results above. If something could not be computed, say so in the answer.'.length})` });
        expect(shape.messages.at(-2).content).toEqual([expect.stringMatching(/^tool_result\(u5,\d+\)$/)]);
    });

    it('ошибка Claude: форма запроса всё равно записана', async () => {
        const log = vi.fn();
        await post(makeApp({ createMessage: vi.fn(async () => { throw new Error('boom'); }), log, getDebug: () => true }));
        expect(rounds(log)).toHaveLength(0);
        expect(shapeOf(log).messages).toEqual([{ role: 'user', content: `string(${QUESTION.length})` }]);
    });

    it('сбой журнала не ломает поток и вопрос', async () => {
        const log = vi.fn(() => { throw new Error('disk'); });
        const result = await post(makeApp({ createMessage: scenario(), log, getDebug: () => true }));
        expect(lastEvent(result).type).toBe('answer');
        // Сбой не мешает следующей записи: журнал вызван на каждый запрос, форму и итог.
        expect(log).toHaveBeenCalledTimes(5);
    });
});

describe('POST /api/ask: живой сервер', () => {
    let server;
    afterEach(() => new Promise(resolve => (server ? server.close(resolve) : resolve())));

    const listen = (app) => new Promise((resolve) => {
        server = app.listen(0, () => resolve(server.address().port));
    });

    const open = (port, onData) => {
        const req = http.request({ port, method: 'POST', path: '/api/ask', headers: { 'content-type': 'application/json' } }, (res) => {
            res.setEncoding('utf8');
            res.on('data', onData);
        });
        req.on('error', () => {});
        req.end(JSON.stringify(body()));
        return req;
    };

    const deferred = () => {
        let resolve;
        const promise = new Promise((done) => { resolve = done; });
        return { promise, resolve };
    };

    it('шаг уходит клиенту сразу, пока Claude ещё думает над ответом', async () => {
        const gate = deferred();
        let call = 0;
        const createMessage = vi.fn(async () => {
            call += 1;
            if (call === 1) return toolTurn(use('u1', 'get_balances', {}));
            await gate.promise;
            return finalTurn();
        });
        const port = await listen(makeApp({ createMessage }));
        let received = '';
        const req = open(port, (chunk) => { received += chunk; });

        await vi.waitFor(() => expect(received).toContain('"step_done"'));
        expect(received).toContain('"label":"Остатки по счетам"');
        expect(received).not.toContain('"answer"');

        gate.resolve();
        await vi.waitFor(() => expect(received).toContain('"type":"answer"'));
        req.destroy();
    });

    it('клиент ушёл: запрос к Claude отменён, цикл не идёт дальше и вопрос засчитан один раз', async () => {
        const gate = deferred();
        const createMessage = vi.fn(async () => {
            await gate.promise;
            return toolTurn(use('u1', 'get_balances', {}));
        });
        const port = await listen(makeApp({ createMessage, dailyLimit: 5 }));
        const req = open(port, () => {});

        await vi.waitFor(() => expect(createMessage).toHaveBeenCalledTimes(1));
        const { signal } = createMessage.mock.calls[0][1];
        expect(signal.aborted).toBe(false);

        req.destroy();
        await vi.waitFor(() => expect(signal.aborted).toBe(true));

        // Claude отвечает уже после ухода клиента: следующего запроса быть не должно
        gate.resolve();
        await new Promise(resolve => setTimeout(resolve, 50));
        expect(createMessage).toHaveBeenCalledTimes(1);
        expect(console.error).not.toHaveBeenCalled();
    });

    it('клиент не мешает серверу: после ухода следующий вопрос обрабатывается', async () => {
        const gate = deferred();
        let first = true;
        const createMessage = vi.fn(async () => {
            if (first) {
                first = false;
                await gate.promise;
            }
            return finalTurn();
        });
        const app = makeApp({ createMessage });
        const port = await listen(app);
        const req = open(port, () => {});
        await vi.waitFor(() => expect(createMessage).toHaveBeenCalledTimes(1));
        req.destroy();
        await vi.waitFor(() => expect(createMessage.mock.calls[0][1].signal.aborted).toBe(true));
        expect(lastEvent(await post(app)).type).toBe('answer');
        gate.resolve();
    });
});
