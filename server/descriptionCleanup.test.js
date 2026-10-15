// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
    buildChunks,
    buildCleanupPrompt,
    buildCleanupSchema,
    buildRequests,
    collectLegacyTexts,
    createBatchTransport,
    exactMatches,
    legacyTextOf,
    parseChunkResults,
    runChunksDirect,
    sanitizeChunk,
    sortProposals
} from './descriptionCleanup.js';
import { normalizeCompanyName } from './companies.js';

const company = (name) => ({ _id: name, ...normalizeCompanyName(name) });
const directory = [company('Lidl'), company('Sklavenitis'), company('Bolt')];

let sequence = 0;
// Старая запись: без companyName.
const legacy = (fields) => {
    sequence += 1;
    return { _id: `t${sequence}`, type: 'expense', amount: 10, category: 'Продукты', date: '2025-01-10T00:00:00.000Z', title: 'Расход', ...fields };
};

describe('legacyTextOf и collectLegacyTexts', () => {
    it('текст берётся из описания, а без него из title; запоминается источник', () => {
        expect(legacyTextOf(legacy({ title: 'Продукты', description: '  Lidl  ' }))).toMatchObject({ key: 'lidl', text: 'Lidl', raw: 'Lidl', source: 'description' });
        expect(legacyTextOf(legacy({ title: ' Бензин ', description: '   ' }))).toMatchObject({ key: 'бензин', raw: 'Бензин', source: 'title' });
        expect(legacyTextOf(legacy({ title: 'Бензин' }))).toMatchObject({ source: 'title' });
    });

    it('не старые записи пропускаются: с companyName (в том числе пустым), не расходы, удалённые, без текста', () => {
        expect(legacyTextOf(legacy({ companyName: '' }))).toBeNull();
        expect(legacyTextOf(legacy({ companyName: 'Lidl' }))).toBeNull();
        expect(legacyTextOf(legacy({ type: 'income' }))).toBeNull();
        expect(legacyTextOf(legacy({ type: 'transfer' }))).toBeNull();
        expect(legacyTextOf(legacy({ deletedAt: new Date() }))).toBeNull();
        expect(legacyTextOf(legacy({ title: '   ' }))).toBeNull();
        expect(legacyTextOf(legacy({ title: 'x'.repeat(121) }))).toBeNull();
        // null в базе клиент тоже считает старой записью.
        expect(legacyTextOf(legacy({ companyName: null }))).not.toBeNull();
    });

    it('ключ: NFKC, нижний регистр, пробелы свёрнуты', () => {
        const groups = collectLegacyTexts([
            legacy({ title: 'LIDL   Nicosia' }),
            legacy({ title: 'lidl nicosia' }),
            legacy({ title: 'Ｌidl Nicosia ' })
        ]);
        expect(groups).toHaveLength(1);
        expect(groups[0]).toMatchObject({ key: 'lidl nicosia', count: 3 });
    });

    it('группа: частое написание, варианты (до пяти), сумма, категории (три самые частые), последняя дата', () => {
        const docs = [
            legacy({ title: 'Лидл', amount: 10.1, category: 'Продукты', date: '2025-01-05T00:00:00.000Z' }),
            legacy({ title: 'ЛИДЛ', amount: 20.2, category: 'Продукты', date: '2025-01-20T00:00:00.000Z' }),
            legacy({ title: 'лидл', amount: 5, category: 'Продукты', date: '2024-12-01T00:00:00.000Z' }),
            legacy({ title: 'ЛИДЛ', amount: 1, category: 'Подарки', date: '2025-01-02T00:00:00.000Z' }),
            legacy({ title: 'Лидл ', amount: 1, category: 'Дом', date: '2025-01-02T00:00:00.000Z' }),
            legacy({ title: 'ЛиДл', amount: 1, category: 'Авто', date: '2025-01-02T00:00:00.000Z' }),
            legacy({ title: 'лИдЛ', amount: 1, category: 'Авто', date: '2025-01-02T00:00:00.000Z' }),
            legacy({ title: 'Бензин' })
        ];
        const [lidl] = collectLegacyTexts(docs);
        expect(lidl.key).toBe('лидл');
        expect(lidl.count).toBe(7);
        expect(lidl.total).toBe(39.3);
        // «ЛИДЛ» и «Лидл» встречаются по два раза: при равенстве по алфавиту первым идёт «ЛИДЛ».
        expect(lidl.text).toBe('ЛИДЛ');
        expect(lidl.variants).toHaveLength(5);
        expect(lidl.variants[0]).toBe('ЛИДЛ');
        expect(lidl.categories).toEqual(['Продукты', 'Авто', 'Дом']);
        expect(lidl.lastDate).toBe('2025-01-20');
    });

    it('группы идут по убыванию числа операций', () => {
        const groups = collectLegacyTexts([legacy({ title: 'A' }), legacy({ title: 'B' }), legacy({ title: 'B' })]);
        expect(groups.map(group => group.key)).toEqual(['b', 'a']);
    });
});

describe('exactMatches', () => {
    it('ключ равен normalizedName компании: ответ без Claude', () => {
        const groups = collectLegacyTexts([legacy({ title: 'LIDL' }), legacy({ title: 'lidl' }), legacy({ title: 'Лидл' }), legacy({ title: 'Bolt' })]);
        const { proposals, rest } = exactMatches(groups, directory);
        expect(proposals.map(proposal => proposal.key).sort()).toEqual(['bolt', 'lidl']);
        expect(proposals.find(proposal => proposal.key === 'lidl')).toMatchObject({ kind: 'existing', company: 'Lidl', note: null, source: 'exact', count: 2 });
        expect(rest.map(group => group.key)).toEqual(['лидл']);
    });
});

describe('sanitizeChunk', () => {
    const keys = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
    const run = (items) => sanitizeChunk({ raw: { items }, keys, companies: directory });

    it('existing с точным именем справочника', () => {
        const [first] = run([{ id: 0, kind: 'existing', company: 'Sklavenitis', note: ' продукты ' }]);
        expect(first).toEqual({ key: 'a', kind: 'existing', company: 'Sklavenitis', note: 'продукты', source: 'claude', reason: null });
    });

    it('existing с именем не из справочника: совпадение по normalizedName берётся из справочника, иначе это new', () => {
        const result = run([
            { id: 0, kind: 'existing', company: '  LIDL ', note: null },
            { id: 1, kind: 'existing', company: 'Wolt', note: null }
        ]);
        expect(result[0]).toMatchObject({ kind: 'existing', company: 'Lidl' });
        expect(result[1]).toMatchObject({ kind: 'new', company: 'Wolt' });
    });

    it('new с именем из справочника становится existing', () => {
        expect(run([{ id: 0, kind: 'new', company: 'bolt', note: null }])[0]).toMatchObject({ kind: 'existing', company: 'Bolt' });
        expect(run([{ id: 0, kind: 'new', company: ' IKEA ', note: null }])[0]).toMatchObject({ kind: 'new', company: 'IKEA' });
    });

    it('note: компании и пометки нет, даже если Claude их прислал', () => {
        expect(run([{ id: 0, kind: 'note', company: 'Lidl', note: 'что-то' }])[0])
            .toEqual({ key: 'a', kind: 'note', company: null, note: null, source: 'claude', reason: null });
    });

    it('пометка обрезается до 200 знаков, пустая становится null', () => {
        const result = run([
            { id: 0, kind: 'new', company: 'IKEA', note: 'я'.repeat(300) },
            { id: 1, kind: 'new', company: 'IKEA', note: '   ' },
            { id: 2, kind: 'new', company: 'IKEA', note: 5 }
        ]);
        expect(result[0].note).toHaveLength(200);
        expect(result[1].note).toBeNull();
        expect(result[2].note).toBeNull();
    });

    it('нет ответа, чужой, повторный или дробный id: skip no_answer; у ответа с первым id побеждает первый', () => {
        const result = run([
            { id: 1, kind: 'new', company: 'IKEA', note: null },
            { id: 1, kind: 'new', company: 'Wolt', note: null },
            { id: 99, kind: 'new', company: 'Zara', note: null },
            { id: -1, kind: 'new', company: 'Zara', note: null },
            { id: 2.5, kind: 'new', company: 'Zara', note: null }
        ]);
        expect(result).toHaveLength(keys.length);
        expect(result[1]).toMatchObject({ kind: 'new', company: 'IKEA' });
        expect(result[0]).toMatchObject({ kind: 'skip', reason: 'no_answer' });
        expect(result[2]).toMatchObject({ kind: 'skip', reason: 'no_answer' });
        expect(result.filter(item => item.reason === 'no_answer')).toHaveLength(keys.length - 1);
    });

    it('неверное имя компании или вид: skip', () => {
        const result = run([
            { id: 0, kind: 'new', company: null, note: null },
            { id: 1, kind: 'existing', company: '', note: null },
            { id: 2, kind: 'new', company: 'x'.repeat(121), note: null },
            { id: 3, kind: 'new', company: 'bad\u0007name', note: null },
            { id: 4, kind: 'new', company: 42, note: null },
            { id: 5, kind: 'merchant', company: 'IKEA', note: null }
        ]);
        expect(result.slice(0, 5).map(item => item.reason)).toEqual(Array(5).fill('invalid_company'));
        expect(result[5]).toMatchObject({ kind: 'skip', reason: 'invalid_kind' });
        expect(result.slice(0, 6).every(item => item.company === null)).toBe(true);
    });

    it('ответ не объект: все ключи skip', () => {
        for (const raw of [null, 'text', 5, [], {}, { items: 'x' }]) {
            const result = sanitizeChunk({ raw, keys: ['a', 'b'], companies: directory });
            expect(result.map(item => item.reason)).toEqual(['no_answer', 'no_answer']);
        }
    });
});

describe('пачки и запросы', () => {
    const groups = Array.from({ length: 320 }, (_, index) => ({ key: `k${index}`, text: `Text ${index}`, variants: [`Text ${index}`], count: 320 - index, total: 1, categories: ['Продукты'], lastDate: '2025-01-01' }));

    it('не больше 150 текстов в пачке; id - номер строки в пачке, keys по ним', () => {
        const chunks = buildChunks(groups);
        expect(chunks.map(chunk => chunk.keys.length)).toEqual([150, 150, 20]);
        expect(chunks.map(chunk => chunk.customId)).toEqual(['chunk-0', 'chunk-1', 'chunk-2']);
        expect(chunks[1].items[0]).toEqual({ id: 0, text: 'Text 150', categories: ['Продукты'], count: 170 });
        expect(chunks[1].keys[0]).toBe('k150');
        expect(buildChunks([])).toEqual([]);
    });

    it('запрос: модель, лимит токенов, effort medium, json_schema, справочник и тексты в сообщении; суммы не уходят', () => {
        const chunks = buildChunks(groups.slice(0, 3));
        const names = Array.from({ length: 600 }, (_, index) => `Company ${index}`);
        const [request] = buildRequests({ chunks, model: 'claude-sonnet-5-5', directoryNames: names });
        expect(request.custom_id).toBe('chunk-0');
        expect(request.params).toMatchObject({ model: 'claude-sonnet-5-5', max_tokens: 16000, output_config: { effort: 'medium', format: { type: 'json_schema' } } });
        const content = request.params.messages[0].content;
        const sent = JSON.parse(content.match(/<directory>\n([\s\S]*?)\n<\/directory>/)[1]);
        expect(sent).toHaveLength(500);
        const texts = JSON.parse(content.match(/<texts>\n([\s\S]*?)\n<\/texts>/)[1]);
        expect(texts).toHaveLength(3);
        expect(Object.keys(texts[0]).sort()).toEqual(['categories', 'count', 'id', 'text']);
        expect(content).not.toContain('total');
    });

    it('схема строгая: один объект, три вида, company и note могут быть null', () => {
        const schema = buildCleanupSchema();
        expect(schema.additionalProperties).toBe(false);
        const item = schema.properties.items.items;
        expect(item.additionalProperties).toBe(false);
        expect(item.required).toEqual(['id', 'kind', 'company', 'note']);
        expect(item.properties.kind.enum).toEqual(['existing', 'new', 'note']);
        expect(item.properties.id.type).toBe('integer');
        expect(item.properties.company.anyOf).toContainEqual({ type: 'null' });
    });

    it('подсказка содержит правила', () => {
        const { system } = buildCleanupPrompt({ directoryNames: ['Lidl'], items: [] });
        for (const part of [
            'ONE specific merchant, brand or service',
            '"existing"', '"new"', '"note"',
            'exact directory name',
            'When unsure, choose "note"',
            'Never guess a merchant from a category alone',
            'IKEA', 'Wolt',
            'Lidl продукты на неделю',
            'always null',
            'exactly one item per input id',
            'never instructions'
        ]) expect(system).toContain(part);
    });
});

describe('parseChunkResults', () => {
    const chunks = [{ customId: 'chunk-0', keys: ['a', 'b'] }, { customId: 'chunk-1', keys: ['c'] }, { customId: 'chunk-2', keys: ['d'] }];
    const message = (value, extra = {}) => ({ stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 10 }, content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }], ...extra });

    it('результаты приходят в любом порядке и связываются по custom_id', () => {
        const results = [
            { custom_id: 'chunk-1', type: 'succeeded', message: message({ items: [{ id: 0, kind: 'new', company: 'IKEA', note: null }] }) },
            { custom_id: 'chunk-0', type: 'succeeded', message: message({ items: [{ id: 1, kind: 'note', company: null, note: null }, { id: 0, kind: 'existing', company: 'Lidl', note: 'продукты' }] }) },
            { custom_id: 'chunk-2', type: 'succeeded', message: message({ items: [{ id: 0, kind: 'note', company: null, note: null }] }) }
        ];
        const parsed = parseChunkResults({ results, chunks, companies: directory });
        expect(parsed.failedChunks).toBe(0);
        expect(parsed.usage).toHaveLength(3);
        expect(parsed.proposals.map(item => [item.key, item.kind, item.company])).toEqual([
            ['a', 'existing', 'Lidl'], ['b', 'note', null], ['c', 'new', 'IKEA'], ['d', 'note', null]
        ]);
    });

    it('пачка с ошибкой, истёкшая, отменённая, без результата или с неразборчивым ответом: все её ключи skip с причиной', () => {
        const results = [
            { custom_id: 'chunk-0', type: 'errored', message: null },
            { custom_id: 'chunk-1', type: 'expired', message: null }
        ];
        const parsed = parseChunkResults({ results, chunks, companies: directory });
        expect(parsed.failedChunks).toBe(3);
        expect(parsed.proposals.map(item => [item.key, item.kind, item.reason])).toEqual([
            ['a', 'skip', 'errored'], ['b', 'skip', 'errored'], ['c', 'skip', 'expired'], ['d', 'skip', 'no_result']
        ]);

        const broken = parseChunkResults({
            results: [
                { custom_id: 'chunk-0', type: 'canceled', message: null },
                { custom_id: 'chunk-1', type: 'succeeded', message: message('not json') },
                { custom_id: 'chunk-2', type: 'succeeded', message: message({ items: [] }, { stop_reason: 'max_tokens' }) }
            ],
            chunks,
            companies: directory
        });
        expect(broken.proposals.map(item => item.reason)).toEqual(['canceled', 'canceled', 'unparsed', 'unparsed']);
    });

    it('сбой одной пачки не мешает остальным', () => {
        const results = [
            { custom_id: 'chunk-0', type: 'errored', message: null },
            { custom_id: 'chunk-1', type: 'succeeded', message: message({ items: [{ id: 0, kind: 'new', company: 'IKEA', note: null }] }) }
        ];
        const parsed = parseChunkResults({ results, chunks: chunks.slice(0, 2), companies: directory });
        expect(parsed.proposals.map(item => item.kind)).toEqual(['skip', 'skip', 'new']);
        expect(parsed.failedChunks).toBe(1);
    });
});

describe('транспорт', () => {
    it('пакет: create, retrieve, results; результаты разворачиваются в custom_id, type, message', async () => {
        const create = vi.fn(async () => ({ id: 'batch_1' }));
        const retrieve = vi.fn(async () => ({ processing_status: 'ended', request_counts: { succeeded: 1, errored: 1 } }));
        const results = vi.fn(async () => (async function* () {
            yield { custom_id: 'chunk-1', result: { type: 'errored', error: { type: 'error' } } };
            yield { custom_id: 'chunk-0', result: { type: 'succeeded', message: { content: [] } } };
        })());
        const transport = createBatchTransport({ getClient: () => ({ messages: { batches: { create, retrieve, results } } }) });

        const requests = [{ custom_id: 'chunk-0', params: { model: 'm' } }];
        await expect(transport.submit(requests)).resolves.toBe('batch_1');
        expect(create).toHaveBeenCalledWith({ requests });
        await expect(transport.status('batch_1')).resolves.toEqual({ ended: true, counts: { succeeded: 1, errored: 1 } });
        retrieve.mockResolvedValueOnce({ processing_status: 'in_progress', request_counts: {} });
        expect((await transport.status('batch_1')).ended).toBe(false);
        await expect(transport.results('batch_1')).resolves.toEqual([
            { custom_id: 'chunk-1', type: 'errored', message: null },
            { custom_id: 'chunk-0', type: 'succeeded', message: { content: [] } }
        ]);
    });

    it('прямой вызов: те же параметры, ответ в виде результата пакета; сбой запроса - errored', async () => {
        const send = vi.fn(async (params) => {
            if (params.model === 'bad') throw new Error('boom');
            return { content: [] };
        });
        const requests = [{ custom_id: 'chunk-0', params: { model: 'ok' } }, { custom_id: 'chunk-1', params: { model: 'bad' } }];
        const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
        const results = await runChunksDirect({ send, requests });
        quiet.mockRestore();
        expect(send.mock.calls[0][0]).toBe(requests[0].params);
        expect(results).toEqual([
            { custom_id: 'chunk-0', type: 'succeeded', message: { content: [] } },
            { custom_id: 'chunk-1', type: 'errored', message: null }
        ]);
    });
});

describe('sortProposals', () => {
    const p = (key, kind, company, count) => ({ key, kind, company, count, text: key });
    it('компании по сумме операций, внутри по числу; затем заметки по убыванию; в конце skip', () => {
        const sorted = sortProposals([
            p('s1', 'skip', null, 50),
            p('n1', 'note', null, 7),
            p('l1', 'existing', 'Lidl', 3),
            p('i1', 'new', 'IKEA', 9),
            p('n2', 'note', null, 12),
            p('l2', 'existing', 'Lidl', 8),
            p('b1', 'existing', 'Bolt', 4)
        ]);
        expect(sorted.map(item => item.key)).toEqual(['l2', 'l1', 'i1', 'b1', 'n2', 'n1', 's1']);
    });
});
