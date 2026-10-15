// Оценка «Чистки старых описаний» на настоящем Claude и детерминированных данных.
//
//   node server/eval/descriptionCleanup.eval.js [--repeat N] [--out dir] [--model id] [--effort low|medium|high|xhigh|max] [--dry]
//
// База - временный mongod с cleanupFixtures.js: расходы с октября 2024 по
// январь 2025 стали старыми записями (текст в title, иногда в описании), а
// для сорока с лишним текстов известен правильный ответ. Дальше всё как на
// сервере: сбор текстов, точные совпадения со справочником, пачки, проверка
// ответа. Отличие одно: запросы идут обычным Messages API, а не Batch API
// (пакет дешевле вдвое, но ждать его часами в оценке незачем); параметры
// запроса те же. Оценивается вид ответа (existing / new / note) и название
// компании без учёта регистра; остаток после названия только печатается.
// --dry печатает собранные тексты с ожидаемыми ответами и в Claude не ходит.

const {
    DEFAULT_MODEL, buildCleanupPrompt, collectLegacyTexts, exactMatches, buildChunks, buildRequests, runChunksDirect, parseChunkResults
} = require('../descriptionCleanup');
const { loadLegacyDocs } = require('../descriptionCleanupRouter');
const { buildCleanupFixtures, FROM, TO } = require('./cleanupFixtures');
const { startEvalDb } = require('./db');
const {
    costOf, sumUsage, getApiKey, createTimedSender,
    parseArgs, average, usd, mdTable, writeReport
} = require('./common');

const REQUEST_TIMEOUT_MS = 180_000;
const KIND_LABELS = ['existing', 'new', 'note'];

const same = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();

// Совпал ли ответ с ожидаемым: вид и (для компаний) название.
function grade(expected, got) {
    if (!got || got.kind === 'skip') return { ok: false, got: got ? `skip (${got.reason})` : 'нет ответа' };
    const label = got.company ? `${got.kind}: ${got.company}` : got.kind;
    const ok = got.kind === expected.kind && (expected.kind === 'note' || same(got.company, expected.company));
    return { ok, got: label };
}

const expectedLabel = (expected) => (expected.company ? `${expected.kind}: ${expected.company}` : expected.kind);

// Один проход: точные совпадения + ответы Claude по всем пачкам.
async function runOnce({ groups, companies, model, sender, effort }) {
    sender.reset();
    const { proposals: exact, rest } = exactMatches(groups, companies);
    const chunks = buildChunks(rest);
    const startedAt = Date.now();
    const requests = buildRequests({ chunks, model, directoryNames: companies.map(company => company.name) });
    const results = await runChunksDirect({ send: sender.createMessage, requests, timeoutMs: REQUEST_TIMEOUT_MS });
    const parsed = parseChunkResults({ results, chunks, companies });
    const wallMs = Date.now() - startedAt;
    const calls = sender.calls;
    return {
        proposals: [...exact, ...parsed.proposals],
        exactCount: exact.length,
        claudeCount: rest.length,
        chunks: chunks.length,
        failedChunks: parsed.failedChunks,
        wallMs,
        effort,
        usage: sumUsage(calls.map(call => call.usage)),
        cost: calls.reduce((sum, call) => sum + costOf(call.model || model, call.usage), 0),
        perRequest: calls.map(call => ({ ms: call.ms, stop_reason: call.stop_reason, usage: call.usage, error: call.error }))
    };
}

function scoreRun(run, groups, expected) {
    const byKey = new Map(run.proposals.map(proposal => [proposal.key, proposal]));
    return groups.map((group) => {
        const want = expected.get(group.key);
        const got = byKey.get(group.key);
        const verdict = want ? grade(want, got) : { ok: null, got: got?.kind || '-' };
        return {
            key: group.key, text: group.text, count: group.count, want, got: got || null,
            source: got?.source || null, ok: verdict.ok, gotLabel: verdict.got
        };
    });
}

const percent = (part, whole) => (whole > 0 ? `${((part / whole) * 100).toFixed(1)}% (${part}/${whole})` : '-');

function summarize(scored) {
    const known = scored.filter(row => row.want);
    const claude = known.filter(row => row.source !== 'exact');
    const perKind = KIND_LABELS.map((kind) => {
        const rows = claude.filter(row => row.want.kind === kind);
        return { kind, total: rows.length, ok: rows.filter(row => row.ok).length };
    });
    const part = (rows) => {
        const own = rows.filter(row => row.source !== 'exact');
        return { total: rows.length, ok: rows.filter(row => row.ok).length, claudeTotal: own.length, claudeOk: own.filter(row => row.ok).length };
    };
    return {
        heldOut: part(known.filter(row => row.want.heldOut)),
        rest: part(known.filter(row => !row.want.heldOut)),
        total: known.length,
        ok: known.filter(row => row.ok).length,
        claudeTotal: claude.length,
        claudeOk: claude.filter(row => row.ok).length,
        exact: known.filter(row => row.source === 'exact').length,
        unexpected: scored.filter(row => !row.want).map(row => row.text),
        perKind
    };
}

function renderMarkdown({ args, model, runs, groups }) {
    const lines = [];
    lines.push('# Оценка «Чистки старых описаний»', '');
    lines.push(`Модель: ${model}. Effort: ${args.effort ?? 'как в приложении (medium)'}. Данные: расходы ${FROM} .. ${TO} как старые записи. Прогонов: ${runs.length}. Запросы - Messages API (в приложении - Batch API, цена вдвое ниже).`, '');
    const first = runs[0];
    lines.push(`Уникальных текстов: ${groups.length}, операций: ${groups.reduce((sum, group) => sum + group.count, 0)}. Точных совпадений со справочником (без Claude): ${first.run.exactCount}. Ушло в Claude: ${first.run.claudeCount} текстов в ${first.run.chunks} пачке(ах).`, '');

    runs.forEach(({ run, summary }, index) => {
        lines.push(`## Прогон ${index + 1}`, '');
        lines.push(`Точность по ответам Claude: ${percent(summary.claudeOk, summary.claudeTotal)}. Вместе с точными совпадениями: ${percent(summary.ok, summary.total)}.`);
        lines.push(`Пачек с ошибкой: ${run.failedChunks}. Время ${(run.wallMs / 1000).toFixed(1)} с. Токены: in ${run.usage.input_tokens}, out ${run.usage.output_tokens}. Стоимость ${usd(run.cost)} (Batch API - вдвое меньше).`, '');
        lines.push(`Отложенные тексты (нет в подсказке): Claude ${percent(summary.heldOut.claudeOk, summary.heldOut.claudeTotal)}, вместе с точными ${percent(summary.heldOut.ok, summary.heldOut.total)}. Остальные: Claude ${percent(summary.rest.claudeOk, summary.rest.claudeTotal)}, вместе с точными ${percent(summary.rest.ok, summary.rest.total)}.`, '');
        lines.push(mdTable(['ожидалось', 'верно'], summary.perKind.map(item => [item.kind, percent(item.ok, item.total)])), '');
    });

    const mismatches = new Map();
    for (const { scored } of runs) {
        for (const row of scored.filter(item => item.want && item.ok === false)) {
            const entry = mismatches.get(row.key) || { row, wrong: 0, answers: new Set() };
            entry.wrong += 1;
            entry.answers.add(row.gotLabel);
            mismatches.set(row.key, entry);
        }
    }
    lines.push('## Расхождения', '');
    lines.push(mismatches.size === 0 ? 'Нет.' : mdTable(
        ['текст', 'отложенный', 'ожидалось', 'ответ Claude', 'прогонов с ошибкой'],
        [...mismatches.values()].map(({ row, wrong, answers }) => [row.text, row.want.heldOut ? (row.want.hard ? 'да, трудный' : 'да') : 'нет', expectedLabel(row.want), [...answers].join(' / '), `${wrong} из ${runs.length}`])
    ), '');

    const last = runs.at(-1);
    lines.push('## Все тексты (последний прогон)', '');
    lines.push(mdTable(
        ['текст', 'отложенный', 'операций', 'ожидалось', 'ответ', 'источник', 'остаток', 'итог'],
        last.scored.map(row => [
            row.text, row.want?.heldOut ? 'да' : '', row.count, row.want ? expectedLabel(row.want) : '-', row.gotLabel, row.source || '-',
            row.got?.note || '', row.ok === null ? '?' : row.ok ? 'ok' : 'НЕТ'
        ])
    ), '');
    if (runs.some(({ summary }) => summary.unexpected.length > 0)) {
        lines.push(`Тексты без ожидаемого ответа: ${runs[0].summary.unexpected.join(', ')}`, '');
    }
    return lines.join('\n');
}

async function main() {
    const args = parseArgs();
    const model = args.model || process.env.DESCRIPTION_CLEANUP_MODEL || DEFAULT_MODEL;
    if (!args.dry) getApiKey();
    const fixtures = buildCleanupFixtures();
    const db = await startEvalDb({ fixtures });
    try {
        const Company = require('../models/Company');
        // Те же запросы к базе, что у роутера.
        const docs = await loadLegacyDocs();
        const companies = await Company.find().sort({ normalizedName: 1 }).lean();
        const groups = collectLegacyTexts(docs);
        const { proposals: exact, rest } = exactMatches(groups, companies);
        console.log(`Данные: ${docs.length} старых операций, ${groups.length} уникальных текстов, справочник ${companies.length} компаний; точных совпадений ${exact.length}, в Claude ${rest.length}.`);

        // Отложенные тексты не должны встречаться в подсказке: иначе они не отложены.
        const { system } = buildCleanupPrompt({ directoryNames: [], items: [] });
        const leaked = [...fixtures.expected.values()].filter(item => item.heldOut && system.toLowerCase().includes(item.text.toLowerCase()));
        if (leaked.length > 0) {
            console.error(`Отложенные тексты есть в подсказке: ${leaked.map(item => item.text).join(', ')}`);
            process.exit(1);
        }

        if (args.dry) {
            const rows = groups.map(group => [
                group.text, group.count, group.categories.join(', '),
                exact.some(proposal => proposal.key === group.key) ? 'точное' : 'Claude',
                fixtures.expected.has(group.key) ? expectedLabel(fixtures.expected.get(group.key)) : '?'
            ]);
            console.log(mdTable(['текст', 'операций', 'категории', 'кто отвечает', 'ожидается'], rows));
            const missing = groups.filter(group => !fixtures.expected.has(group.key));
            if (missing.length > 0) console.log(`\nБез ожидаемого ответа: ${missing.map(group => group.text).join(', ')}`);
            const unused = [...fixtures.expected.values()].filter(item => item.origin === 'list' && !groups.some(group => fixtures.expected.get(group.key) === item));
            if (unused.length > 0) console.log(`\nТексты списка, которых нет в данных: ${unused.map(item => item.text).join(', ')}`);
            return;
        }

        const sender = createTimedSender({ effort: args.effort });
        const runs = [];
        for (let index = 1; index <= args.repeat; index += 1) {
            const run = await runOnce({ groups, companies, model, sender, effort: args.effort });
            const scored = scoreRun(run, groups, fixtures.expected);
            const summary = summarize(scored);
            runs.push({ run, scored, summary });
            console.log(`[${index}/${args.repeat}] Claude ${summary.claudeOk}/${summary.claudeTotal} (отложенные ${summary.heldOut.claudeOk}/${summary.heldOut.claudeTotal}), всего ${summary.ok}/${summary.total}, ${(run.wallMs / 1000).toFixed(1)} с, ${usd(run.cost)}${run.failedChunks ? `, пачек с ошибкой ${run.failedChunks}` : ''}`);
        }

        writeReport({
            outDir: args.out,
            name: 'cleanup',
            json: {
                createdAt: new Date().toISOString(), model, args: { repeat: args.repeat, effort: args.effort },
                totals: { cost: runs.reduce((sum, item) => sum + item.run.cost, 0), avgMs: average(runs.map(item => item.run.wallMs)) },
                runs: runs.map(({ run, scored, summary }) => ({
                    ...run,
                    proposals: undefined,
                    summary,
                    rows: scored.map(row => ({ text: row.text, count: row.count, expected: row.want || null, got: row.got ? { kind: row.got.kind, company: row.got.company, note: row.got.note, source: row.got.source, reason: row.got.reason } : null, ok: row.ok }))
                }))
            },
            markdown: renderMarkdown({ args, model, runs, groups })
        });
    } finally {
        await db.stop();
    }
}

if (require.main === module) {
    main().then(() => process.exit(0), (error) => {
        console.error('Оценка не удалась:', error?.message || error);
        process.exit(1);
    });
}

module.exports = { grade, summarize, scoreRun };
