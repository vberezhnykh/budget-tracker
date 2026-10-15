// Роутер «Разовой чистки старых описаний» (логика и запросы к Claude - в
// descriptionCleanup.js). Ход один: start собирает старые тексты и отправляет
// их Claude пакетом, GET / проверяет пакет и отдаёт готовые предложения,
// apply применяет выбранные, revert отменяет применённое в течение undoDays.
//
// Предложения хранятся в models/DescriptionCleanup.js. Перед записью в
// операции туда же кладётся копия изменяемых полей (до и после): отмена
// возвращает поле, только если операцию с тех пор не меняли.

const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { createClientErrorRateLimiter } = require('./operational');
const { isApiKeyConfigured, createClaudeGate, DAY_MS } = require('./claudeClient');
const { activeTransactionFilter } = require('./ledgerState');
const { normalizeCompanyName } = require('./companies');
const { normalizeMerchantDomain } = require('./merchantDomain');
const cleanup = require('./descriptionCleanup');

const GATE_KIND = 'description_cleanup';
const DAILY_STARTS = 3;
const RATE_WINDOW_MS = 60 * 1000;
// Запуск без номера пакета (сервер упал между созданием записи и отправкой) считается сорвавшимся через это время.
const ORPHAN_AFTER_MS = 5 * 60 * 1000;
const WRITE_BATCH = 1000;
// Поля операции, которые чистка может менять.
const FIELDS = ['description', 'companyId', 'companyName', 'logoMode', 'merchantDomain'];

const isEnabled = isApiKeyConfigured;

const iso = (value) => (value ? new Date(value).toISOString() : null);
const text = (value) => (value === undefined || value === null ? null : String(value));

// Старые записи: расходы без строки companyName. null в базе клиент тоже считает старой записью.
const legacyFilter = () => activeTransactionFilter({ type: 'expense', companyName: { $not: { $type: 'string' } } });

async function loadLegacyDocs() {
    const Transaction = require('./models/Transaction');
    return Transaction.find(legacyFilter())
        .select('title description category amount date type companyName companyId logoMode merchantDomain deletedAt')
        .lean();
}

const snapshot = (doc) => Object.fromEntries(FIELDS.map(field => [field, text(doc[field])]));

// Что изменится у одной операции: { before, after } только с изменёнными
// полями (null - поля нет) или null, если менять нечего. proposal - решение по
// её тексту, company - компания из справочника (для existing и new).
function planUpdate({ doc, legacy, proposal, company }) {
    const before = snapshot(doc);
    const after = { ...before };
    if (proposal.kind === 'note') {
        // '' - «без компании» у новых записей. Текст не должен пропасть из строки:
        // для такой записи интерфейс показывает категорию, а текст - как комментарий.
        after.companyName = '';
        if (legacy.source === 'title') after.description = legacy.raw;
    } else {
        after.companyId = String(company._id);
        after.companyName = company.name;
        // Ручной выбор иконки (сайт или категория) сохраняется.
        const manual = (doc.logoMode === 'domain' && normalizeMerchantDomain(doc.merchantDomain)) || doc.logoMode === 'category';
        if (!manual) {
            after.logoMode = company.logoMode || 'auto';
            after.merchantDomain = company.logoMode === 'domain' ? text(company.merchantDomain) : null;
        }
        // Остаток после названия компании (или ничего) заменяет описание, если текст был в нём.
        if (legacy.source === 'description') after.description = proposal.note || null;
        else if (proposal.note) after.description = proposal.note;
    }
    const changed = FIELDS.filter(field => before[field] !== after[field]);
    if (changed.length === 0) return null;
    return {
        before: Object.fromEntries(changed.map(field => [field, before[field]])),
        after: Object.fromEntries(changed.map(field => [field, after[field]]))
    };
}

// Значения полей -> обновление Mongo: строка пишется, null убирает поле.
function updateOf(values) {
    const set = {};
    const unset = {};
    for (const [field, value] of Object.entries(values)) {
        if (value === null) unset[field] = '';
        else set[field] = value;
    }
    return { ...(Object.keys(set).length > 0 ? { $set: set } : {}), ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}) };
}

async function writeUpdates(operations) {
    const Transaction = require('./models/Transaction');
    let modified = 0;
    for (let start = 0; start < operations.length; start += WRITE_BATCH) {
        const result = await Transaction.bulkWrite(operations.slice(start, start + WRITE_BATCH), { ordered: false });
        modified += result.modifiedCount || 0;
    }
    return modified;
}

// --- Представление ------------------------------------------------------------------------

const proposalOf = (proposal) => ({
    key: proposal.key,
    text: proposal.text,
    variants: proposal.variants || [],
    count: proposal.count,
    total: proposal.total,
    categories: proposal.categories || [],
    kind: proposal.kind,
    company: proposal.company ?? null,
    note: proposal.note ?? null,
    source: proposal.source,
    reason: proposal.reason ?? null
});

function summaryOf(run, { withProposals = false } = {}) {
    return {
        id: String(run._id),
        status: run.status,
        model: run.model,
        createdAt: iso(run.createdAt),
        readyAt: iso(run.readyAt),
        appliedAt: iso(run.appliedAt),
        undoUntil: iso(run.undoUntil),
        undoExpired: Boolean(run.undoExpired),
        revertedAt: iso(run.revertedAt),
        failReason: run.failReason ?? null,
        stats: run.stats || {},
        ...(withProposals ? { proposals: cleanup.sortProposals(run.proposals || []).map(proposalOf) } : {})
    };
}

const FAILED = { status: 500, code: 'DESCRIPTION_CLEANUP_FAILED', message: 'Не удалось выполнить чистку. Попробуйте позже.' };

function createDescriptionCleanupRouter({
    getApiKey = () => process.env.ANTHROPIC_API_KEY,
    getModel = () => process.env.DESCRIPTION_CLEANUP_MODEL || cleanup.DEFAULT_MODEL,
    getTransport,
    rateLimiter = createClientErrorRateLimiter({ windowMs: RATE_WINDOW_MS, maxRequests: 10 }),
    dailyLimit = DAILY_STARTS,
    now = () => Date.now(),
    undoDays = 30,
    log = (line) => console.info(line)
} = {}) {
    const router = express.Router();
    const gate = createClaudeGate({
        getApiKey,
        rateLimiter,
        now,
        codes: { unavailable: 'DESCRIPTION_CLEANUP_UNAVAILABLE', rateLimited: 'DESCRIPTION_CLEANUP_RATE_LIMITED' }
    });

    let defaultTransport = null;
    const transport = () => {
        if (getTransport) return getTransport();
        if (!defaultTransport) {
            let client = null;
            let clientKey = null;
            defaultTransport = cleanup.createBatchTransport({
                getClient: () => {
                    const apiKey = getApiKey();
                    if (!client || clientKey !== apiKey) {
                        client = new Anthropic({ apiKey, maxRetries: 1 });
                        clientKey = apiKey;
                    }
                    return client;
                }
            });
        }
        return defaultTransport;
    };

    // Один запуск, применение или отмена за раз: клик дважды не должен платить дважды.
    let busy = false;

    const models = () => ({
        Run: require('./models/DescriptionCleanup'),
        Company: require('./models/Company'),
        Transaction: require('./models/Transaction')
    });

    // Одна строка в журнал на запрос: действие, исход, число текстов и время. Сами тексты не пишутся.
    const reply = (res, startedAt, action, texts, status, body, outcome) => {
        try {
            log(`[description-cleanup] action=${action} outcome=${outcome} texts=${texts} ms=${Math.max(0, Date.now() - startedAt)}`);
        } catch {
            // журнал не должен ломать ответ
        }
        return res.status(status).json(body);
    };
    const fail = (res, startedAt, action, texts, failure = FAILED) =>
        reply(res, startedAt, action, texts, failure.status, { code: failure.code, message: failure.message }, failure.code);

    router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

    // Срок отмены вышел: копию операций больше не держим.
    async function expireUndo(run) {
        const { Run } = models();
        if (run.status !== 'applied' || run.undoExpired || !run.undoUntil || new Date(run.undoUntil).getTime() > now()) return run;
        await Run.updateOne({ _id: run._id, status: 'applied' }, { $set: { backup: [], undoExpired: true } });
        return { ...run, backup: [], undoExpired: true };
    }

    // Пакет Claude мог закончиться: один раз спрашиваем его состояние (без ожидания)
    // и, если он готов, превращаем ответы в предложения.
    async function settleSubmitted(run) {
        const { Run, Company } = models();
        if (!run.batchId) {
            if (now() - new Date(run.createdAt).getTime() > ORPHAN_AFTER_MS) {
                await Run.updateOne({ _id: run._id, status: 'submitted' }, { $set: { status: 'failed', failReason: 'not_submitted' } });
                return { ...run, status: 'failed', failReason: 'not_submitted' };
            }
            return run;
        }
        if (!isApiKeyConfigured({ ANTHROPIC_API_KEY: getApiKey() })) return run;
        try {
            const state = await transport().status(run.batchId);
            if (!state.ended) return run;
            const results = await transport().results(run.batchId);
            const companies = await Company.find().lean();
            const parsed = cleanup.parseChunkResults({ results, chunks: run.chunks || [], companies });
            const answers = new Map(parsed.proposals.map(proposal => [proposal.key, proposal]));
            const proposals = run.proposals.map(stored => (answers.has(stored.key) ? { ...stored, ...answers.get(stored.key) } : stored));
            const usable = proposals.some(proposal => proposal.kind !== 'skip');
            const sum = (key) => parsed.usage.reduce((total, usage) => total + (usage?.[key] || 0), 0);
            const patch = {
                status: usable ? 'ready' : 'failed',
                readyAt: new Date(now()),
                proposals,
                failReason: usable ? null : 'no_usable_answers',
                stats: { ...(run.stats || {}), failedChunks: parsed.failedChunks, inputTokens: sum('input_tokens'), outputTokens: sum('output_tokens') }
            };
            await Run.updateOne({ _id: run._id, status: 'submitted' }, { $set: patch });
            const fresh = await Run.findById(run._id).lean();
            return fresh || { ...run, ...patch };
        } catch (error) {
            console.error('[description-cleanup] не удалось получить результаты пакета:', error?.name, error?.status);
            return run;
        }
    }

    // --- GET / ------------------------------------------------------------------------------------

    router.get('/', async (req, res) => {
        const startedAt = Date.now();
        try {
            const { Run } = models();
            const groups = cleanup.collectLegacyTexts(await loadLegacyDocs());
            let run = await Run.findOne().sort({ createdAt: -1 }).lean();
            if (run && run.status === 'submitted') run = await settleSubmitted(run);
            if (run) run = await expireUndo(run);
            return reply(res, startedAt, 'status', groups.length, 200, {
                legacyCount: groups.reduce((total, group) => total + group.count, 0),
                legacyTexts: groups.length,
                run: run ? summaryOf(run, { withProposals: run.status === 'ready' }) : null
            }, run ? run.status : 'no_run');
        } catch (error) {
            console.error('[description-cleanup] не удалось загрузить состояние:', error?.name);
            return fail(res, startedAt, 'status', 0);
        }
    });

    // --- POST /start ---------------------------------------------------------------------------------

    router.post('/start', async (req, res) => {
        const startedAt = Date.now();
        // gate отвечает сам; ответ нужно залогировать, поэтому ему подставляется перехватчик.
        const denied = { headers: {} };
        const probe = {
            set(name, value) { denied.headers[name] = value; return this; },
            status(code) { denied.status = code; return this; },
            json(payload) { denied.body = payload; return this; }
        };
        if (!gate.admit(req, probe, {
            kind: GATE_KIND,
            limit: dailyLimit,
            unavailable: 'Чистка описаний не настроена.',
            limited: 'Дневной лимит запусков чистки исчерпан.'
        })) {
            res.set(denied.headers);
            return reply(res, startedAt, 'start', 0, denied.status, denied.body, denied.body.code);
        }
        if (busy) {
            return fail(res, startedAt, 'start', 0, { status: 409, code: 'DESCRIPTION_CLEANUP_BUSY', message: 'Чистка уже выполняется.' });
        }
        busy = true;
        let texts = 0;
        try {
            const { Run, Company } = models();
            const active = await Run.exists({ status: { $in: ['submitted', 'ready'] } });
            if (active) {
                return fail(res, startedAt, 'start', 0, { status: 409, code: 'DESCRIPTION_CLEANUP_ACTIVE', message: 'Предыдущая чистка ещё не закончена: примените её или дождитесь результата.' });
            }
            const groups = cleanup.collectLegacyTexts(await loadLegacyDocs());
            texts = groups.length;
            if (groups.length === 0) return reply(res, startedAt, 'start', 0, 200, { nothing: true }, 'nothing');

            const companies = await Company.find().sort({ normalizedName: 1 }).lean();
            const { proposals: exact, rest } = cleanup.exactMatches(groups, companies);
            const model = getModel();
            const chunks = cleanup.buildChunks(rest);
            const createdAt = new Date(now());
            const run = await Run.create({
                status: rest.length === 0 ? 'ready' : 'submitted',
                model,
                chunks: chunks.map(chunk => ({ customId: chunk.customId, keys: chunk.keys })),
                proposals: [
                    ...exact,
                    ...rest.map(group => ({ ...cleanup.proposalBase(group), kind: 'skip', company: null, note: null, source: 'claude', reason: 'pending' }))
                ],
                createdAt,
                readyAt: rest.length === 0 ? createdAt : undefined,
                stats: { texts: groups.length, exact: exact.length, claude: rest.length, chunks: chunks.length }
            });

            if (rest.length > 0) {
                try {
                    const requests = cleanup.buildRequests({ chunks, model, directoryNames: companies.map(company => company.name) });
                    const batchId = await transport().submit(requests);
                    gate.count(GATE_KIND);
                    await Run.updateOne({ _id: run._id }, { $set: { batchId } });
                    run.batchId = batchId;
                } catch (error) {
                    console.error('[description-cleanup] пакет не отправлен:', error?.name, error?.status);
                    await Run.updateOne({ _id: run._id }, { $set: { status: 'failed', failReason: 'submit_failed' } });
                    return fail(res, startedAt, 'start', texts, { status: 502, code: 'DESCRIPTION_CLEANUP_SUBMIT_FAILED', message: 'Не удалось отправить тексты в Claude. Попробуйте позже.' });
                }
            }
            const plain = run.toObject();
            return reply(res, startedAt, 'start', texts, 200, { run: summaryOf(plain, { withProposals: plain.status === 'ready' }) }, plain.status);
        } catch (error) {
            console.error('[description-cleanup] не удалось запустить чистку:', error?.name);
            return fail(res, startedAt, 'start', texts);
        } finally {
            busy = false;
        }
    });

    // --- POST /apply -------------------------------------------------------------------------------------

    router.post('/apply', async (req, res) => {
        const startedAt = Date.now();
        const keys = req.body && Array.isArray(req.body.keys) ? req.body.keys : null;
        if (!keys || keys.length === 0 || keys.length > 20000 || keys.some(key => typeof key !== 'string')) {
            return fail(res, startedAt, 'apply', 0, { status: 400, code: 'DESCRIPTION_CLEANUP_KEYS_INVALID', message: 'Выберите тексты для применения.' });
        }
        if (busy) {
            return fail(res, startedAt, 'apply', 0, { status: 409, code: 'DESCRIPTION_CLEANUP_BUSY', message: 'Чистка уже выполняется.' });
        }
        busy = true;
        let texts = 0;
        try {
            const { Run, Company } = models();
            const run = await Run.findOne({ status: 'ready' }).lean();
            if (!run) {
                return fail(res, startedAt, 'apply', 0, { status: 409, code: 'DESCRIPTION_CLEANUP_NOT_READY', message: 'Нет готовых предложений для применения.' });
            }
            const wanted = new Set(keys);
            const accepted = new Map(run.proposals.filter(proposal => wanted.has(proposal.key) && cleanup.KINDS.includes(proposal.kind)).map(proposal => [proposal.key, proposal]));
            texts = accepted.size;
            if (accepted.size === 0) {
                return fail(res, startedAt, 'apply', 0, { status: 400, code: 'DESCRIPTION_CLEANUP_KEYS_INVALID', message: 'Среди выбранных текстов нет подходящих для применения.' });
            }

            // Компании: находим по normalizedName или создаём; созданные запоминаем для отмены.
            await Company.init();
            const companyByKey = new Map();
            const createdIds = [];
            const companyFor = async (proposal) => {
                const normalized = normalizeCompanyName(proposal.company);
                if (!normalized) return null;
                if (companyByKey.has(normalized.normalizedName)) return companyByKey.get(normalized.normalizedName);
                let company = await Company.findOne({ normalizedName: normalized.normalizedName }).lean();
                if (!company) {
                    try {
                        company = (await Company.create({ ...normalized, logoMode: 'auto' })).toObject();
                        createdIds.push(company._id);
                    } catch (error) {
                        if (error.code !== 11000) throw error;
                        company = await Company.findOne({ normalizedName: normalized.normalizedName }).lean();
                    }
                }
                companyByKey.set(normalized.normalizedName, company);
                return company;
            };

            // Строки берём заново: изменённые после предложения (появилась компания, другой текст) не совпадут и не тронутся.
            const plans = [];
            for (const doc of await loadLegacyDocs()) {
                const legacy = cleanup.legacyTextOf(doc);
                const proposal = legacy && accepted.get(legacy.key);
                if (!proposal) continue;
                const company = proposal.kind === 'note' ? null : await companyFor(proposal);
                if (proposal.kind !== 'note' && !company) continue;
                const change = planUpdate({ doc, legacy, proposal, company });
                if (change) plans.push({ txId: doc._id, ...change });
            }
            const expected = [...accepted.values()].reduce((total, proposal) => total + proposal.count, 0);

            // Копия и статус записываются до изменения операций: если запись прервётся на середине, отмена работает.
            const appliedAt = new Date(now());
            const claimed = await Run.findOneAndUpdate({ _id: run._id, status: 'ready' }, {
                $set: {
                    status: 'applied',
                    appliedAt,
                    undoUntil: new Date(now() + undoDays * DAY_MS),
                    undoExpired: false,
                    backup: plans.map(plan => ({ txId: plan.txId, before: plan.before, after: plan.after })),
                    createdCompanyIds: createdIds
                }
            });
            if (!claimed) {
                return fail(res, startedAt, 'apply', texts, { status: 409, code: 'DESCRIPTION_CLEANUP_NOT_READY', message: 'Нет готовых предложений для применения.' });
            }
            const updated = await writeUpdates(plans.map(plan => ({
                updateOne: { filter: { _id: plan.txId, ...legacyFilter() }, update: updateOf(plan.after) }
            })));
            const counts = { updated, companiesCreated: createdIds.length, skippedChanged: Math.max(0, expected - updated) };
            await Run.updateOne({ _id: run._id }, { $set: { 'stats.apply': counts } });
            return reply(res, startedAt, 'apply', texts, 200, counts, 'applied');
        } catch (error) {
            console.error('[description-cleanup] не удалось применить:', error?.name, error?.code);
            return fail(res, startedAt, 'apply', texts);
        } finally {
            busy = false;
        }
    });

    // --- POST /revert -------------------------------------------------------------------------------------

    router.post('/revert', async (req, res) => {
        const startedAt = Date.now();
        if (busy) {
            return fail(res, startedAt, 'revert', 0, { status: 409, code: 'DESCRIPTION_CLEANUP_BUSY', message: 'Чистка уже выполняется.' });
        }
        busy = true;
        let texts = 0;
        try {
            const { Run, Company, Transaction } = models();
            let run = await Run.findOne({ status: 'applied' }).sort({ appliedAt: -1 }).lean();
            if (run) run = await expireUndo(run);
            if (!run) {
                return fail(res, startedAt, 'revert', 0, { status: 409, code: 'DESCRIPTION_CLEANUP_NOT_APPLIED', message: 'Нет применённой чистки для отмены.' });
            }
            if (run.undoExpired || !Array.isArray(run.backup) || run.backup.length === 0) {
                return fail(res, startedAt, 'revert', 0, { status: 410, code: 'DESCRIPTION_CLEANUP_UNDO_EXPIRED', message: 'Срок отмены вышел.' });
            }
            texts = run.backup.length;

            const current = new Map((await Transaction.find({ _id: { $in: run.backup.map(entry => entry.txId) } }).lean()).map(doc => [String(doc._id), doc]));
            const operations = [];
            let skippedChanged = 0;
            for (const entry of run.backup) {
                const doc = current.get(String(entry.txId));
                const unchanged = doc && Object.entries(entry.after).every(([field, value]) => text(doc[field]) === value);
                if (!unchanged) { skippedChanged += 1; continue; }
                operations.push({ updateOne: { filter: { _id: entry.txId }, update: updateOf(entry.before) } });
            }
            const restored = await writeUpdates(operations);

            // Созданные чисткой компании удаляются, если на них больше никто не ссылается (корзина тоже считается).
            let companiesDeleted = 0;
            for (const id of run.createdCompanyIds || []) {
                if (await Transaction.exists({ companyId: id })) continue;
                companiesDeleted += (await Company.deleteOne({ _id: id })).deletedCount || 0;
            }
            const counts = { restored, companiesDeleted, skippedChanged };
            await Run.updateOne({ _id: run._id }, { $set: { status: 'reverted', revertedAt: new Date(now()), backup: [], 'stats.revert': counts } });
            return reply(res, startedAt, 'revert', texts, 200, counts, 'reverted');
        } catch (error) {
            console.error('[description-cleanup] не удалось отменить:', error?.name, error?.code);
            return fail(res, startedAt, 'revert', texts);
        } finally {
            busy = false;
        }
    });

    return router;
}

module.exports = { createDescriptionCleanupRouter, isDescriptionCleanupEnabled: isEnabled, loadLegacyDocs, planUpdate, FIELDS };
