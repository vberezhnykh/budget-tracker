// @vitest-environment node
//
// Роут «Разовой чистки старых описаний» на настоящей базе. Claude подменён
// транспортом: он запоминает отправленные запросы и отдаёт заранее заданные
// ответы, как это сделал бы пакет. Роутер поднят на маленьком приложении (без
// входа); за входом и ключом в настоящем приложении следят последние тесты.

import express from 'express';
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectTestDb, disconnectTestDb, clearCollections, loginAgent, tx, DB_HOOK_TIMEOUT } from './test/harness.js';
import { createDescriptionCleanupRouter } from './descriptionCleanupRouter.js';

const KEY = 'sk-ant-test-secret-1234567890';
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-10-05T12:00:00Z');

let app;
let Transaction;
let Company;
let DescriptionCleanup;

beforeAll(async () => {
    app = await connectTestDb('routes-description-cleanup');
    Transaction = mongoose.model('Transaction');
    Company = mongoose.model('Company');
    DescriptionCleanup = mongoose.model('DescriptionCleanup');
}, DB_HOOK_TIMEOUT);

afterAll(disconnectTestDb, DB_HOOK_TIMEOUT);

afterEach(() => {
    vi.unstubAllEnvs();
});

// Что Claude отвечает по тексту (ключ - текст в нижнем регистре). Чего здесь нет, остаётся без ответа.
const ANSWERS = {
    'лидл продукты на неделю': { kind: 'existing', company: 'Lidl', note: 'продукты на неделю' },
    'вольт кофе': { kind: 'new', company: 'Wolt', note: 'кофе' },
    'вольт': { kind: 'new', company: 'Wolt', note: null },
    'болт такси': { kind: 'existing', company: 'Bolt', note: 'такси' },
    'продукты': { kind: 'note', company: null, note: null },
    'обед': { kind: 'note', company: null, note: null }
};

const textsOf = (request) => JSON.parse(request.params.messages[0].content.match(/<texts>\n([\s\S]*?)\n<\/texts>/)[1]);

// Результаты пакета для отправленных запросов: ответ по таблице, в обратном порядке (пакет порядка не обещает).
function resultsFor(requests, answers = ANSWERS) {
    const usage = { input_tokens: 1000, output_tokens: 200 };
    return requests.map((req) => {
        const items = textsOf(req).filter(item => answers[item.text.toLowerCase()]).map(item => ({ id: item.id, ...answers[item.text.toLowerCase()] }));
        return { custom_id: req.custom_id, type: 'succeeded', message: { stop_reason: 'end_turn', usage, content: [{ type: 'text', text: JSON.stringify({ items }) }] } };
    }).reverse();
}

function fakeTransport() {
    const transport = { requests: [], ended: false, canned: null };
    transport.submit = vi.fn(async (requests) => { transport.requests = requests; return 'batch_1'; });
    transport.status = vi.fn(async () => ({ ended: transport.ended, counts: {} }));
    transport.results = vi.fn(async () => transport.canned ?? resultsFor(transport.requests));
    return transport;
}

function setup(options = {}) {
    const clock = { now: NOW };
    const transport = fakeTransport();
    const lines = [];
    const mini = express();
    mini.use(express.json());
    mini.use('/api/description-cleanup', createDescriptionCleanupRouter({
        getApiKey: () => KEY,
        getTransport: () => transport,
        rateLimiter: () => true,
        now: () => clock.now,
        log: (line) => lines.push(line),
        ...options
    }));
    return {
        clock, transport, lines,
        get: () => request(mini).get('/api/description-cleanup'),
        start: () => request(mini).post('/api/description-cleanup/start'),
        apply: (keys) => request(mini).post('/api/description-cleanup/apply').send({ keys }),
        revert: () => request(mini).post('/api/description-cleanup/revert')
    };
}

// Старые записи (без companyName) и несколько обычных, которые чистка трогать не должна.
async function seed() {
    await Company.create([
        { name: 'Lidl', logoMode: 'auto' },
        { name: 'Bolt', logoMode: 'domain', merchantDomain: 'bolt.eu' }
    ]);
    await Transaction.create([
        tx({ title: 'LIDL', amount: 10 }),                                                   // точное совпадение, текст в title
        tx({ title: 'Продукты', description: 'lidl ', amount: 20 }),                          // точное совпадение, текст в описании
        tx({ title: 'Лидл продукты на неделю', amount: 30 }),
        tx({ title: 'Лидл продукты на неделю', amount: 5, logoMode: 'category' }),            // ручной выбор иконки
        tx({ title: 'Расход', description: 'Вольт кофе', amount: 4 }),                        // текст в описании
        tx({ title: 'Вольт', amount: 15, logoMode: 'domain', merchantDomain: 'wolt.com' }),   // ручной выбор иконки
        tx({ title: 'Болт такси', amount: 12 }),
        tx({ title: 'Продукты', amount: 40, category: 'Продукты' }),
        tx({ title: 'Кафе', description: 'Обед', amount: 9 }),                                // заметка, текст в описании
        tx({ title: 'Странный текст', amount: 1 }),                                           // Claude не ответил
        tx({ title: 'Новая запись', companyName: '', amount: 3 }),                            // не старая
        tx({ title: 'Lidl', companyName: 'Lidl', amount: 3 }),                                // не старая
        tx({ title: 'Зарплата', type: 'income', category: 'Зарплата', amount: 100 }),        // не расход
        tx({ title: 'Удалённый', deletedAt: new Date('2026-10-01T00:00:00Z'), amount: 7 })    // в корзине
    ]);
}

beforeEach(async () => {
    await clearCollections();
    await seed();
});

const byTitle = async (title, description) => Transaction.findOne({ title, ...(description === undefined ? {} : { description }) }).lean();

// Запуск и получение готовых предложений; возвращает { ctx, ready }.
async function readyRun(options) {
    const ctx = setup(options);
    await ctx.start();
    ctx.transport.ended = true;
    const status = await ctx.get();
    expect(status.body.run.status).toBe('ready');
    return { ctx, ready: status.body.run };
}

const ALL_KEYS = ['lidl', 'лидл продукты на неделю', 'вольт кофе', 'вольт', 'болт такси', 'продукты', 'обед'];

describe('запуск и ход пакета', () => {
    it('start отправляет пакет, GET дожидается его и отдаёт предложения', async () => {
        const ctx = setup();
        const started = await ctx.start();

        expect(started.status).toBe(200);
        expect(started.headers['cache-control']).toBe('no-store');
        expect(started.body.run).toMatchObject({ status: 'submitted', stats: { texts: 8, exact: 1, claude: 7, chunks: 1 } });
        expect(started.body.run.proposals).toBeUndefined();
        expect(ctx.transport.submit).toHaveBeenCalledTimes(1);
        const [req] = ctx.transport.requests;
        expect(req.custom_id).toBe('chunk-0');
        expect(req.params).toMatchObject({ model: 'claude-sonnet-5-5', max_tokens: 16000, output_config: { effort: 'medium' } });
        // Справочник и тексты без сумм; точное совпадение (lidl) в Claude не уходит.
        const content = req.params.messages[0].content;
        expect(JSON.parse(content.match(/<directory>\n([\s\S]*?)\n<\/directory>/)[1]).sort()).toEqual(['Bolt', 'Lidl']);
        expect(textsOf(req).map(item => item.text.toLowerCase())).not.toContain('lidl');
        expect(textsOf(req)).toHaveLength(7);
        const stored = await DescriptionCleanup.findOne().lean();
        expect(stored).toMatchObject({ status: 'submitted', batchId: 'batch_1', model: 'claude-sonnet-5-5' });
        expect(stored.chunks).toHaveLength(1);
        expect(stored.chunks[0].keys).toHaveLength(7);

        // Пакет ещё идёт: состояние спрашивается один раз, результаты не берутся.
        const waiting = await ctx.get();
        expect(waiting.body).toMatchObject({ legacyCount: 10, legacyTexts: 8, run: { status: 'submitted' } });
        expect(ctx.transport.status).toHaveBeenCalledTimes(1);
        expect(ctx.transport.results).not.toHaveBeenCalled();

        ctx.transport.ended = true;
        const done = await ctx.get();
        expect(done.body.run).toMatchObject({ status: 'ready', stats: { failedChunks: 0, inputTokens: 1000, outputTokens: 200 } });
        expect(done.body.run.readyAt).toBe(new Date(NOW).toISOString());
        const kinds = done.body.run.proposals.map(item => [item.key, item.kind, item.company, item.note, item.source]);
        expect(kinds).toEqual([
            // Lidl: 2 + 2 операции, Wolt: 2, Bolt: 1; затем заметки, затем без ответа.
            ['lidl', 'existing', 'Lidl', null, 'exact'],
            ['лидл продукты на неделю', 'existing', 'Lidl', 'продукты на неделю', 'claude'],
            ['вольт', 'new', 'Wolt', null, 'claude'],
            ['вольт кофе', 'new', 'Wolt', 'кофе', 'claude'],
            ['болт такси', 'existing', 'Bolt', 'такси', 'claude'],
            ['обед', 'note', null, null, 'claude'],
            ['продукты', 'note', null, null, 'claude'],
            ['странный текст', 'skip', null, null, 'claude']
        ]);
        expect(done.body.run.proposals.at(-1)).toMatchObject({ reason: 'no_answer', count: 1 });
        expect(done.body.run.proposals[0]).toMatchObject({ count: 2, total: 30, categories: ['Продукты'] });

        // Готовый прогон читается повторно без обращений к Claude.
        await ctx.get();
        expect(ctx.transport.results).toHaveBeenCalledTimes(1);

        expect(ctx.lines.every(line => /^\[description-cleanup\] action=(start|status) outcome=\S+ texts=\d+ ms=\d+$/.test(line))).toBe(true);
        expect(ctx.lines[0]).toMatch(/^\[description-cleanup\] action=start outcome=submitted texts=8 ms=\d+$/);
        expect(ctx.lines.join('\n')).not.toMatch(/Лидл|Вольт|lidl/i);
    });

    it('если все тексты совпали со справочником, прогон готов сразу и Claude не вызывается', async () => {
        await clearCollections();
        await Company.create({ name: 'Lidl', logoMode: 'auto' });
        await Transaction.create([tx({ title: 'LIDL' }), tx({ title: 'lidl', amount: 5 })]);
        const ctx = setup();
        const res = await ctx.start();

        expect(res.status).toBe(200);
        expect(res.body.run.status).toBe('ready');
        expect(res.body.run.proposals).toEqual([expect.objectContaining({ key: 'lidl', kind: 'existing', company: 'Lidl', source: 'exact', count: 2 })]);
        expect(ctx.transport.submit).not.toHaveBeenCalled();
        expect(ctx.lines[0]).toContain('action=start outcome=ready texts=1');
    });

    it('нет старых текстов: nothing, прогон не создаётся', async () => {
        await clearCollections();
        await Transaction.create([tx({ title: 'Новая', companyName: '' })]);
        const ctx = setup();
        const res = await ctx.start();
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ nothing: true });
        expect(await DescriptionCleanup.countDocuments()).toBe(0);
        expect(ctx.transport.submit).not.toHaveBeenCalled();
    });

    it('второй start при submitted и при ready - 409', async () => {
        const ctx = setup();
        await ctx.start();
        const second = await ctx.start();
        expect(second.status).toBe(409);
        expect(second.body.code).toBe('DESCRIPTION_CLEANUP_ACTIVE');

        ctx.transport.ended = true;
        await ctx.get();
        expect((await ctx.start()).status).toBe(409);
        expect(ctx.transport.submit).toHaveBeenCalledTimes(1);
        expect(await DescriptionCleanup.countDocuments()).toBe(1);
        expect(ctx.lines.at(-1)).toContain('action=start outcome=DESCRIPTION_CLEANUP_ACTIVE texts=0');
    });

    it('пачка с ошибкой даёт skip у своих текстов; если полезных ответов нет совсем - failed', async () => {
        const ctx = setup();
        await ctx.start();
        ctx.transport.ended = true;
        ctx.transport.canned = [{ custom_id: 'chunk-0', type: 'errored', message: null }];
        const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
        const done = await ctx.get();
        quiet.mockRestore();
        // Точное совпадение осталось, поэтому прогон полезен: ready, остальное skip.
        expect(done.body.run).toMatchObject({ status: 'ready', stats: { failedChunks: 1 } });
        expect(done.body.run.proposals.filter(item => item.kind === 'skip')).toHaveLength(7);
        expect(done.body.run.proposals.filter(item => item.kind === 'skip').every(item => item.reason === 'errored')).toBe(true);

        // Без точных совпадений и без ответов прогон не нужен.
        await clearCollections();
        await Transaction.create([tx({ title: 'Продукты' })]);
        const other = setup();
        await other.start();
        other.transport.ended = true;
        other.transport.canned = [{ custom_id: 'chunk-0', type: 'expired', message: null }];
        const failed = await other.get();
        expect(failed.body.run).toMatchObject({ status: 'failed', failReason: 'no_usable_answers' });
        expect((await other.start()).status).toBe(200);
    });

    it('пакет не отправился: 502, прогон failed, новый запуск возможен', async () => {
        const ctx = setup();
        ctx.transport.submit.mockRejectedValueOnce(new Error('network'));
        const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
        const res = await ctx.start();
        quiet.mockRestore();
        expect(res.status).toBe(502);
        expect(res.body.code).toBe('DESCRIPTION_CLEANUP_SUBMIT_FAILED');
        expect(await DescriptionCleanup.findOne().lean()).toMatchObject({ status: 'failed', failReason: 'submit_failed' });
        expect((await ctx.start()).status).toBe(200);
    });

    it('без ключа - 503 и ничего не создаётся', async () => {
        const ctx = setup({ getApiKey: () => '  ' });
        const res = await ctx.start();
        expect(res.status).toBe(503);
        expect(res.body.code).toBe('DESCRIPTION_CLEANUP_UNAVAILABLE');
        expect(await DescriptionCleanup.countDocuments()).toBe(0);
        expect(ctx.lines[0]).toContain('action=start outcome=DESCRIPTION_CLEANUP_UNAVAILABLE');
        // Состояние читать можно и без ключа.
        expect((await ctx.get()).status).toBe(200);
    });

    it('суточный лимит запусков - 429', async () => {
        const ctx = setup({ dailyLimit: 1 });
        await ctx.start();
        await DescriptionCleanup.updateMany({}, { $set: { status: 'failed' } });
        const res = await ctx.start();
        expect(res.status).toBe(429);
        expect(res.body.code).toBe('DESCRIPTION_CLEANUP_RATE_LIMITED');
    });
});

describe('POST /apply', () => {
    it('existing, new и note: компании, иконки и описание', async () => {
        const { ctx, ready } = await readyRun();
        expect(ready.proposals.filter(item => ['existing', 'new', 'note'].includes(item.kind))).toHaveLength(7);
        const res = await ctx.apply(ALL_KEYS);

        // Операций: LIDL, lidl, 2 x Лидл..., Вольт кофе, Вольт, Болт такси, Продукты, Обед = 9.
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ updated: 9, companiesCreated: 1, skippedChanged: 0 });
        const lidl = await Company.findOne({ name: 'Lidl' }).lean();
        const bolt = await Company.findOne({ name: 'Bolt' }).lean();
        const wolt = await Company.findOne({ name: 'Wolt' }).lean();
        expect(wolt).toMatchObject({ normalizedName: 'wolt', logoMode: 'auto' });
        expect(await Company.countDocuments()).toBe(3);

        // Точное совпадение, текст в title: компания, описание не появляется.
        const exactTitle = await byTitle('LIDL');
        expect(exactTitle).toMatchObject({ companyName: 'Lidl', logoMode: 'auto', title: 'LIDL' });
        expect(String(exactTitle.companyId)).toBe(String(lidl._id));
        expect(exactTitle.description).toBeUndefined();
        // Текст был в описании: описание убирается.
        const movedDescription = await Transaction.findOne({ title: 'Продукты', companyName: 'Lidl' }).lean();
        expect(movedDescription.description).toBeUndefined();

        // Остаток при тексте в title: описание = остаток, иконка из компании.
        const withNote = await Transaction.findOne({ title: 'Лидл продукты на неделю', logoMode: 'auto' }).lean();
        expect(withNote).toMatchObject({ companyName: 'Lidl', description: 'продукты на неделю' });
        // Остаток при тексте в описании заменяет описание.
        const wolt1 = await byTitle('Расход');
        expect(wolt1).toMatchObject({ companyName: 'Wolt', description: 'кофе', logoMode: 'auto' });
        expect(String(wolt1.companyId)).toBe(String(wolt._id));
        // Иконка компании с сайтом переходит в операцию.
        const taxi = await byTitle('Болт такси');
        expect(taxi).toMatchObject({ companyName: 'Bolt', description: 'такси', logoMode: 'domain', merchantDomain: 'bolt.eu' });
        expect(String(taxi.companyId)).toBe(String(bolt._id));

        // Заметки: «без компании», текст остаётся виден в описании.
        const noteFromTitle = await byTitle('Продукты', 'Продукты');
        expect(noteFromTitle).toMatchObject({ companyName: '', description: 'Продукты' });
        expect(noteFromTitle.companyId).toBeUndefined();
        const noteFromDescription = await byTitle('Кафе');
        expect(noteFromDescription).toMatchObject({ companyName: '', description: 'Обед' });

        // Без ответа и не старые записи не тронуты.
        expect((await byTitle('Странный текст')).companyName).toBeUndefined();
        expect((await byTitle('Зарплата')).companyName).toBeUndefined();
        expect((await byTitle('Удалённый')).companyName).toBeUndefined();
        expect((await byTitle('Новая запись')).companyName).toBe('');

        const run = await DescriptionCleanup.findOne().lean();
        expect(run).toMatchObject({ status: 'applied', stats: { apply: { updated: 9, companiesCreated: 1, skippedChanged: 0 } } });
        expect(run.appliedAt.getTime()).toBe(NOW);
        expect(run.undoUntil.getTime()).toBe(NOW + 30 * DAY);
        expect(run.backup).toHaveLength(9);
        expect(run.createdCompanyIds.map(String)).toEqual([String(wolt._id)]);
        // В копии только изменённые поля: у заметки companyName и description.
        const noteBackup = run.backup.find(entry => String(entry.txId) === String(noteFromTitle._id));
        expect(noteBackup.before).toEqual({ companyName: null, description: null });
        expect(noteBackup.after).toEqual({ companyName: '', description: 'Продукты' });
        expect(ctx.lines.at(-1)).toMatch(/action=apply outcome=applied texts=7 ms=\d+$/);
    });

    it('ручной выбор иконки (сайт или категория) сохраняется', async () => {
        const { ctx } = await readyRun();
        await ctx.apply(ALL_KEYS);
        const domain = await byTitle('Вольт');
        expect(domain).toMatchObject({ companyName: 'Wolt', logoMode: 'domain', merchantDomain: 'wolt.com' });
        const category = await Transaction.findOne({ title: 'Лидл продукты на неделю', logoMode: 'category' }).lean();
        expect(category).toMatchObject({ companyName: 'Lidl', logoMode: 'category', description: 'продукты на неделю' });
        expect(category.merchantDomain).toBeUndefined();
    });

    it('применяются только выбранные тексты', async () => {
        const { ctx } = await readyRun();
        const res = await ctx.apply(['вольт', 'продукты', 'странный текст', 'нет такого']);
        // «странный текст» - skip, «нет такого» - не предложение: обе не принимаются.
        expect(res.body).toEqual({ updated: 2, companiesCreated: 1, skippedChanged: 0 });
        expect((await byTitle('Болт такси')).companyName).toBeUndefined();
        expect((await byTitle('LIDL')).companyName).toBeUndefined();
    });

    it('строка, изменённая между предложением и применением, пропускается', async () => {
        const { ctx } = await readyRun();
        // Человек уже назначил компанию, а у другой записи поправил текст.
        await Transaction.updateOne({ title: 'Болт такси' }, { $set: { companyName: 'Bolt' } });
        await Transaction.updateOne({ title: 'Вольт' }, { $set: { title: 'Вольт Маркет' } });
        const res = await ctx.apply(ALL_KEYS);

        expect(res.body).toEqual({ updated: 7, companiesCreated: 1, skippedChanged: 2 });
        const bolt = await byTitle('Болт такси');
        expect(bolt.description).toBeUndefined();
        expect(bolt.companyId).toBeUndefined();
        expect((await byTitle('Вольт Маркет')).companyName).toBeUndefined();
    });

    it('нет готового прогона или неверные ключи', async () => {
        const ctx = setup();
        const none = await ctx.apply(['вольт']);
        expect(none.status).toBe(409);
        expect(none.body.code).toBe('DESCRIPTION_CLEANUP_NOT_READY');

        await ctx.start();
        ctx.transport.ended = true;
        await ctx.get();
        for (const keys of [undefined, [], 'вольт', [5], ['странный текст'], ['нет такого']]) {
            const res = await ctx.apply(keys);
            expect(res.status, JSON.stringify(keys)).toBe(400);
            expect(res.body.code).toBe('DESCRIPTION_CLEANUP_KEYS_INVALID');
        }
        expect((await DescriptionCleanup.findOne().lean()).status).toBe('ready');
        expect(await Company.countDocuments()).toBe(2);
    });

    it('повторное применение невозможно', async () => {
        const { ctx } = await readyRun();
        expect((await ctx.apply(ALL_KEYS)).status).toBe(200);
        const again = await ctx.apply(ALL_KEYS);
        expect(again.status).toBe(409);
        expect(again.body.code).toBe('DESCRIPTION_CLEANUP_NOT_READY');
    });
});

describe('POST /revert', () => {
    const snapshotOf = async () => Transaction.find().sort({ _id: 1 }).select('-__v').lean();

    it('возвращает прежние значения и удаляет созданные компании, на которые никто не ссылается', async () => {
        const before = await snapshotOf();
        const { ctx } = await readyRun();
        await ctx.apply(ALL_KEYS);
        expect(await Company.countDocuments()).toBe(3);

        const res = await ctx.revert();
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ restored: 9, companiesDeleted: 1, skippedChanged: 0 });
        expect(await snapshotOf()).toEqual(before);
        expect(await Company.findOne({ name: 'Wolt' })).toBeNull();
        expect(await Company.countDocuments()).toBe(2);
        const run = await DescriptionCleanup.findOne().lean();
        expect(run).toMatchObject({ status: 'reverted' });
        expect(run.backup).toEqual([]);
        expect(ctx.lines.at(-1)).toMatch(/action=revert outcome=reverted texts=9 ms=\d+$/);

        // После отмены можно начать заново, а повторная отмена невозможна.
        expect((await ctx.revert()).status).toBe(409);
        expect((await ctx.start()).status).toBe(200);
    });

    it('созданная компания, на которую уже ссылаются, остаётся', async () => {
        const { ctx } = await readyRun();
        await ctx.apply(ALL_KEYS);
        const wolt = await Company.findOne({ name: 'Wolt' }).lean();
        await Transaction.create(tx({ title: 'Новая покупка', companyName: 'Wolt', companyId: wolt._id }));

        const res = await ctx.revert();
        expect(res.body).toEqual({ restored: 9, companiesDeleted: 0, skippedChanged: 0 });
        expect(await Company.findOne({ name: 'Wolt' })).not.toBeNull();
    });

    it('строки, изменённые после применения, не откатываются', async () => {
        const { ctx } = await readyRun();
        await ctx.apply(ALL_KEYS);
        // Одну поправили вручную, другую удалили насовсем.
        await Transaction.updateOne({ title: 'Болт такси' }, { $set: { description: 'ночью' } });
        await Transaction.deleteOne({ title: 'LIDL' });

        const res = await ctx.revert();
        expect(res.body).toMatchObject({ restored: 7, skippedChanged: 2 });
        const taxi = await byTitle('Болт такси');
        expect(taxi).toMatchObject({ companyName: 'Bolt', description: 'ночью' });
        expect((await byTitle('Вольт')).companyName).toBeUndefined();
    });

    it('срок отмены: после undoUntil копия стирается и отмена возвращает 410', async () => {
        const { ctx } = await readyRun();
        await ctx.apply(ALL_KEYS);

        ctx.clock.now = NOW + 29 * DAY;
        const early = await ctx.get();
        expect(early.body.run).toMatchObject({ status: 'applied', undoExpired: false });
        expect((await DescriptionCleanup.findOne().lean()).backup).toHaveLength(9);

        ctx.clock.now = NOW + 30 * DAY + 1000;
        const late = await ctx.get();
        expect(late.body.run).toMatchObject({ status: 'applied', undoExpired: true });
        expect(late.body.run.proposals).toBeUndefined();
        const stored = await DescriptionCleanup.findOne().lean();
        expect(stored.backup).toEqual([]);
        expect(stored.undoExpired).toBe(true);

        const res = await ctx.revert();
        expect(res.status).toBe(410);
        expect(res.body.code).toBe('DESCRIPTION_CLEANUP_UNDO_EXPIRED');
        expect((await byTitle('Вольт')).companyName).toBe('Wolt');
    });

    it('срок вышел, а GET не вызывали: отмена тоже отказывает', async () => {
        const { ctx } = await readyRun();
        await ctx.apply(ALL_KEYS);
        ctx.clock.now = NOW + 31 * DAY;
        expect((await ctx.revert()).status).toBe(410);
    });

    it('без применённой чистки - 409', async () => {
        const res = await setup().revert();
        expect(res.status).toBe(409);
        expect(res.body.code).toBe('DESCRIPTION_CLEANUP_NOT_APPLIED');
    });
});

describe('в настоящем приложении', () => {
    it('без входа - 401', async () => {
        for (const [method, path] of [['get', ''], ['post', '/start'], ['post', '/apply'], ['post', '/revert']]) {
            const res = await request(app)[method](`/api/description-cleanup${path}`);
            expect(res.status, path).toBe(401);
        }
    });

    it('после входа без ключа Anthropic - 503, с ключом чистка включена в настройках', async () => {
        const agent = await loginAgent(app);
        vi.stubEnv('ANTHROPIC_API_KEY', '');
        const info = vi.spyOn(console, 'info').mockImplementation(() => {});
        const res = await agent.post('/api/description-cleanup/start');
        info.mockRestore();
        expect(res.status).toBe(503);
        expect(res.body.code).toBe('DESCRIPTION_CLEANUP_UNAVAILABLE');
        expect((await agent.get('/api/settings')).body.features.descriptionCleanup).toBe(false);

        vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
        expect((await agent.get('/api/settings')).body.features.descriptionCleanup).toBe(true);
    });
});
