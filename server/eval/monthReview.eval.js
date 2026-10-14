// Оценка «Разбора месяца» на настоящем Claude и детерминированных данных.
//
//   node server/eval/monthReview.eval.js [--only 2026-09,2026-08] [--repeat N] [--out dir] [--model id] [--effort low|medium|high|xhigh|max] [--dry]
//
// Роутер тот же, что в приложении (createMonthReviewRouter), база - временный
// mongod с fixtures.js (там же месячный лимит 3500), «сегодня» - 2026-10-13.
// Перед каждым прогоном сохранённые разборы стираются, поэтому каждый раз идёт
// настоящая генерация. Факты считает тот же buildMonthFacts, что и сервер;
// проверяется текст, который написал Claude. --dry печатает только факты и
// не обращается к Claude.

const express = require('express');
const request = require('supertest');
const { createMonthReviewRouter, defaultLoadContext, buildMonthFacts, findUnknownNumbers, DEFAULT_MODEL } = require('../monthReview');
const { TODAY } = require('./fixtures');
const { startEvalDb, clearMonthReviews } = require('./db');
const {
    costOf, sumUsage, getApiKey, createTimedSender, formatEuro,
    parseArgs, average, usd, mdTable, writeReport
} = require('./common');

const MONTH_TIMEOUT_MS = 120_000;
const DEFAULT_MONTHS = ['2026-09', '2026-08', '2026-05', '2026-03', '2025-12'];
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_HEADLINE = 80;

// --- Ключевые факты месяца --------------------------------------------------------------

const signed = (value) => (value > 0 ? `+${value}` : String(value));
const pct = (value) => (value === null ? 'нет' : `${signed(value)}%`);

// Что стоит увидеть глазами: итоги, три главные категории, разовые крупные покупки, регулярные платежи.
function summarizeFacts(facts) {
    const { expense, income, limit } = facts;
    const lines = [
        `расход ${formatEuro(expense.total)} при обычных ${formatEuro(expense.typical)} (${pct(expense.diff_pct)}), операций ${expense.count}`,
        `доход ${formatEuro(income.total)} при обычных ${formatEuro(income.typical)} (${pct(income.diff_pct)})`,
        limit ? `лимит ${formatEuro(limit.amount)}: потрачено ${limit.used_pct}%, остаток ${formatEuro(limit.left)}` : 'лимита нет',
        `категории по |diff|: ${facts.categories.slice(0, 3).map(c => `${c.name} ${formatEuro(c.total)} (обычно ${formatEuro(c.typical)}, ${pct(c.diff_pct)}, месяцев с тратами ${c.months_with_spending}/${facts.reference_months_count})`).join('; ') || '-'}`
    ];
    const oneOff = facts.largest.filter(item => item.one_off);
    lines.push(`разовые крупные: ${oneOff.map(item => `${item.company || '(без компании)'} ${formatEuro(item.amount)} [${item.category}, ${item.date}${item.description ? `, ${item.description}` : ''}]`).join('; ') || '-'}`);
    const { changed, missing } = facts.recurring;
    lines.push(`регулярные, изменились: ${changed.map(item => `${item.company} ${formatEuro(item.previous_amount)} -> ${formatEuro(item.amount)} (${pct(item.diff_pct)})`).join('; ') || '-'}`);
    lines.push(`регулярные, не прошли: ${missing.map(item => `${item.company} ${formatEuro(item.usual_amount)} (последний ${item.last_date})`).join('; ') || '-'}`);
    return lines;
}

// --- Проверки ----------------------------------------------------------------------------------

// required: без них прогон считается проваленным; остальные только отмечаются.
function gradeReview({ facts, status, review, attempts }) {
    const text = review ? [review.headline, ...review.points.map(point => point.text)].join('\n').toLowerCase() : '';
    const checks = [
        { label: 'ответ 200 с разбором', required: true, ok: status === 200 && Boolean(review) },
        { label: 'один запрос без повтора', required: true, ok: attempts === 1 },
        { label: '2-4 пункта', required: true, ok: Boolean(review) && review.points.length >= 2 && review.points.length <= 4 },
        { label: `заголовок до ${MAX_HEADLINE} знаков`, required: false, ok: Boolean(review) && review.headline.length <= MAX_HEADLINE }
    ];
    const top = facts.categories[0];
    if (top) checks.push({ label: `названа главная категория (${top.name})`, required: false, ok: text.includes(top.name.toLowerCase()) });
    for (const item of [...facts.recurring.changed, ...facts.recurring.missing]) {
        checks.push({ label: `названа компания ${item.company}`, required: false, ok: text.includes(item.company.toLowerCase()) });
    }
    return checks;
}

// --- Прогон ----------------------------------------------------------------------------------------

// Текст первого ответа Claude, чтобы увидеть, какие числа были чужими до повтора.
function textOf(response) {
    const block = Array.isArray(response?.content) ? response.content.find(item => item?.type === 'text') : null;
    return typeof block?.text === 'string' ? block.text : null;
}

function firstUnknownNumbers(text, facts) {
    try {
        const parsed = JSON.parse(text);
        const all = [parsed.headline, ...(Array.isArray(parsed.points) ? parsed.points.map(point => point?.text) : [])].join('\n');
        return findUnknownNumbers(all, facts);
    } catch {
        return [];
    }
}

async function runMonth({ month, facts, app, sender, responses, model, lines }) {
    await clearMonthReviews();
    sender.reset();
    responses.length = 0;
    lines.length = 0;
    const startedAt = Date.now();
    const res = await request(app).post('/api/month-review').send({ month, today: TODAY });
    const wallMs = Date.now() - startedAt;

    const calls = sender.calls;
    const review = res.status === 200 ? res.body.review : null;
    const attempts = calls.length;
    const checks = gradeReview({ facts, status: res.status, review, attempts });
    return {
        month,
        status: res.status,
        error: res.status === 200 ? null : res.body,
        stale: res.body?.stale ?? null,
        review,
        attempts,
        unknownFirst: responses[0] ? firstUnknownNumbers(responses[0], facts) : [],
        checks,
        pass: checks.filter(check => check.required).every(check => check.ok),
        optionalMissed: checks.filter(check => !check.required && !check.ok).length,
        facts,
        log: lines.at(-1) || null,
        perRequest: calls.map(call => ({ model: call.model, ms: call.ms, stop_reason: call.stop_reason, usage: call.usage, error: call.error })),
        wallMs,
        usage: sumUsage(calls.map(call => call.usage)),
        cost: calls.reduce((sum, call) => sum + costOf(call.model || model, call.usage), 0)
    };
}

// --- Отчёт -------------------------------------------------------------------------------------------

function buildSummary(records) {
    return {
        runs: records.length,
        pass: records.filter(record => record.pass).length,
        retries: records.filter(record => record.attempts > 1).length,
        optionalMissed: records.reduce((total, record) => total + record.optionalMissed, 0),
        totalCost: records.reduce((total, record) => total + record.cost, 0),
        avgMs: average(records.map(record => record.wallMs))
    };
}

function renderMarkdown({ args, model, records, summary }) {
    const lines = [];
    lines.push('# Оценка «Разбора месяца»', '');
    lines.push(`Модель: ${model}. Effort: ${args.effort ?? 'как в приложении'}. Сегодня: ${TODAY}. Прогонов на месяц: ${args.repeat}.`, '');
    lines.push(`Итого: pass ${summary.pass} из ${summary.runs}; повторов (attempts > 1): ${summary.retries}; необязательных проверок не сошлось: ${summary.optionalMissed}. ` +
        `Стоимость ${usd(summary.totalCost)}, среднее время ${(summary.avgMs / 1000).toFixed(1)} с.`, '');
    lines.push(mdTable(
        ['месяц', 'итог', 'статус', 'attempts', 'чужие числа (1-й ответ)', 'мс', 'in', 'out', '$'],
        records.map(record => [
            record.month, record.pass ? 'pass' : 'fail', record.status, record.attempts,
            record.unknownFirst.length > 0 ? record.unknownFirst.join(', ') : '-', record.wallMs,
            record.usage.input_tokens, record.usage.output_tokens, record.cost.toFixed(4)
        ])
    ), '');

    for (const record of records) {
        lines.push(`## ${record.month}: ${record.pass ? 'pass' : 'fail'}`, '');
        lines.push('Факты:', ...summarizeFacts(record.facts).map(line => `- ${line}`), '');
        if (record.error) lines.push(`Ошибка: ${record.error.code} ${record.error.message}`, '');
        if (record.review) {
            lines.push(`Заголовок: ${record.review.headline}`, '');
            lines.push('Пункты:', ...record.review.points.map(point => `- ${point.text}${point.category ? ` [${point.category}]` : ''}`), '');
        }
        lines.push(`Запросов к Claude: ${record.attempts}. Чужие числа в первом ответе: ${record.unknownFirst.length > 0 ? record.unknownFirst.join(', ') : 'нет'}. ` +
            `${record.wallMs} мс. Токены: in ${record.usage.input_tokens}, out ${record.usage.output_tokens}. ${usd(record.cost)}.`, '');
        lines.push(mdTable(['проверка', 'обяз.', 'итог'], record.checks.map(check => [check.label, check.required ? 'да' : 'нет', check.ok ? 'ok' : 'нет'])), '');
    }
    return lines.join('\n');
}

// --- main ------------------------------------------------------------------------------------------------

async function main() {
    const args = parseArgs();
    const model = args.model || process.env.MONTH_REVIEW_MODEL || DEFAULT_MODEL;
    const months = args.only ? [...args.only] : DEFAULT_MONTHS;
    const invalid = months.filter(month => !MONTH_PATTERN.test(month));
    if (invalid.length > 0) {
        console.error(`Месяц в формате YYYY-MM, получено: ${invalid.join(', ')}`);
        process.exit(1);
    }

    const db = await startEvalDb();
    try {
        // Те же запросы к базе, что у роутера: факты считаются из того, что видит приложение.
        const context = await defaultLoadContext();
        const factsByMonth = new Map(months.map(month => [month, buildMonthFacts({ ...context, month, today: TODAY })]));
        const earliest = context.docs.reduce((min, t) => (!min || t.date < min ? t.date : min), null);
        console.log(`Данные: ${context.docs.length} операций, лимит ${context.monthlyLimit}, с ${earliest ? earliest.toISOString().slice(0, 10) : '-'}.`);

        if (args.dry) {
            for (const [month, facts] of factsByMonth) {
                console.log(`\n${month}${facts ? ` (${facts.month_label}, эталон: ${facts.reference_months.join(', ')})` : ''}`);
                console.log(facts ? summarizeFacts(facts).map(line => `  ${line}`).join('\n') : '  нет фактов: месяц не разбирается');
            }
            return;
        }
        const missing = months.filter(month => !factsByMonth.get(month));
        if (missing.length > 0) {
            console.error(`Для этих месяцев нет фактов (не законченный месяц или мало истории): ${missing.join(', ')}`);
            process.exit(1);
        }

        const sender = createTimedSender({ effort: args.effort });
        const responses = [];
        const lines = [];
        const app = express();
        app.use(express.json());
        app.use('/api/month-review', createMonthReviewRouter({
            // Обёртка запоминает текст каждого ответа: по первому видно, какие числа были чужими.
            createMessage: async (params, options) => {
                const response = await sender.createMessage(params, options);
                responses.push(textOf(response));
                return response;
            },
            getApiKey,
            getModel: () => model,
            rateLimiter: () => true,
            dailyLimit: 1e6,
            timeoutMs: MONTH_TIMEOUT_MS,
            log: (line) => lines.push(line)
        }));

        const records = [];
        const total = months.length * args.repeat;
        let index = 0;
        for (let run = 1; run <= args.repeat; run += 1) {
            for (const month of months) {
                index += 1;
                const record = await runMonth({ month, facts: factsByMonth.get(month), app, sender, responses, model, lines });
                record.run = run;
                records.push(record);
                console.log(`[${index}/${total}] ${month}: ${record.pass ? 'pass' : 'fail'}, запросов ${record.attempts}, ${(record.wallMs / 1000).toFixed(1)} с, ${usd(record.cost)}${record.error ? `, ошибка ${record.error.code}` : ''}`);
            }
        }

        const summary = buildSummary(records);
        writeReport({
            outDir: args.out,
            name: 'month',
            json: { createdAt: new Date().toISOString(), model, today: TODAY, args: { only: args.only ? [...args.only] : null, repeat: args.repeat, effort: args.effort }, summary, records },
            markdown: renderMarkdown({ args, model, records, summary })
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

module.exports = { summarizeFacts, gradeReview };
