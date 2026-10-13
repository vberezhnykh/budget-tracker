// Оценка «Вопросов к данным» на настоящем Claude и детерминированных данных.
//
//   node server/eval/ask.eval.js [--only id1,id2] [--repeat N] [--out dir] [--model id] [--dry]
//
// Роутер тот же, что в приложении (createAskRouter), база - временный mongod
// с fixtures.js, «сегодня» - 2026-10-13. Ожидаемые числа считаются теми же
// функциями askTools, которыми пользуется модель, с вводом, какой дал бы
// идеальный вызов: если ответ расходится с ними, виновата модель или подсказка,
// а не арифметика. --dry считает и печатает ожидания, не обращаясь к Claude.

const express = require('express');
const request = require('supertest');
const { createAskRouter, DEFAULT_MODEL } = require('../ask');
const { sumOperations, findOperations, getBalances, getTypicalMonth } = require('../askTools');
const { TODAY } = require('./fixtures');
const { startEvalDb, loadAskData } = require('./db');
const {
    costOf, sumUsage, getApiKey, createTimedSender, extractNumbers, matchAmount, formatEuro,
    parseArgs, average, median, usd, mdTable, writeReport
} = require('./common');

const ASK_TIMEOUT_MS = 120_000;

// --- Ожидаемые значения ---------------------------------------------------------------

function must(outcome, what) {
    if (!outcome.ok) throw new Error(`${what}: ${outcome.error}`);
    return outcome.result;
}

// Ввод sum_operations целиком: схема строгая, все ключи обязательны.
const sum = (data, input) => must(sumOperations({ type: 'expense', category: null, account: null, company: null, group_by: 'none', ...input }, data), `sum ${JSON.stringify(input)}`);
const find = (data, input) => must(findOperations({ type: null, category: null, account: null, text: null, sort: 'date_desc', limit: null, ...input }, data), `find ${JSON.stringify(input)}`);

const amount = (label, value, extra = {}) => ({ label, kind: 'amount', value, ...extra });
const text = (label, any, extra = {}) => ({ label, kind: 'text', any, ...extra });

const CAFE = 'Кафе и досуг';
const MONTHS_GENITIVE = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTH_STEMS = [['январ'], ['феврал'], ['март'], ['апрел'], ['май', 'мая'], ['июн'], ['июл'], ['август'], ['сентябр'], ['октябр'], ['ноябр'], ['декабр']];

// --- Кейсы -------------------------------------------------------------------------------
//
// checks(data) возвращает массив проверок (одна группа) или
// { alternatives: [{ name, checks }] }: кейс проходит, если полностью сошлась любая группа.

const CASES = [
    {
        id: 'sep_top',
        question: 'На что ушло больше всего в сентябре?',
        checks: (data) => {
            const result = sum(data, { from: '2026-09-01', to: '2026-09-30', group_by: 'category' });
            const top = result.groups[0];
            return [
                text(`категория: ${top.key}`, [top.key]),
                amount(`сумма: ${top.key}`, top.total),
                amount('все расходы за сентябрь', result.total, { optional: true })
            ];
        }
    },
    {
        id: 'sep_cafe',
        question: 'Сколько ушло на кафе в сентябре?',
        checks: (data) => [amount('кафе, сентябрь 2026', sum(data, { from: '2026-09-01', to: '2026-09-30', category: CAFE }).total)]
    },
    {
        id: 'sep_cafe_followup',
        // Реплика ассистента такая, какую собрал бы интерфейс из прошлого ответа.
        messages: (data) => [
            { role: 'user', text: 'Сколько ушло на кафе в сентябре?' },
            { role: 'assistant', text: `На кафе и досуг в сентябре 2026 ушло ${formatEuro(sum(data, { from: '2026-09-01', to: '2026-09-30', category: CAFE }).total)}.` },
            { role: 'user', text: 'А в августе?' }
        ],
        checks: (data) => [amount('кафе, август 2026', sum(data, { from: '2026-08-01', to: '2026-08-31', category: CAFE }).total)]
    },
    {
        id: 'summer_vs_last',
        question: 'Сколько я потратил этим летом по сравнению с прошлым?',
        checks: (data) => [
            amount('расходы, лето 2026', sum(data, { from: '2026-06-01', to: '2026-08-31' }).total),
            amount('расходы, лето 2025', sum(data, { from: '2025-06-01', to: '2025-08-31' }).total)
        ]
    },
    {
        id: 'vacation_summer',
        question: 'Сколько ушло на отпуск этим летом против прошлого лета?',
        checks: (data) => [
            amount('отпуск, лето 2026', sum(data, { from: '2026-06-01', to: '2026-08-31', category: 'Отпуск' }).total),
            amount('отпуск, лето 2025', sum(data, { from: '2025-06-01', to: '2025-08-31', category: 'Отпуск' }).total)
        ]
    },
    {
        id: 'largest_2026',
        question: 'Какие были самые крупные покупки в этом году?',
        checks: (data) => find(data, { from: '2026-01-01', to: TODAY, type: 'expense', sort: 'amount_desc', limit: 5 }).operations
            .map((op, index) => amount(`#${index + 1}: ${op.company} ${op.date}`, op.amount, { optional: index >= 3 }))
    },
    {
        id: 'balances',
        question: 'Покажи остатки по счетам',
        checks: (data) => {
            const result = must(getBalances({}, data), 'get_balances');
            return [
                ...result.accounts.filter(account => Math.abs(account.balance) >= 0.01).map(account => amount(`остаток: ${account.name}`, Math.abs(account.balance))),
                amount('всего (без депозита)', Math.abs(result.total))
            ];
        }
    },
    {
        id: 'cash',
        question: 'Сколько у меня наличных?',
        checks: (data) => {
            const result = must(getBalances({}, data), 'get_balances');
            const account = result.accounts.find(item => item.name === 'Наличные').balance;
            const groups = [{ name: 'счёт «Наличные»', checks: [amount('наличные (счёт)', account)] }];
            if (Math.abs(result.by_type.cash - account) > 0.011) groups.push({ name: 'by_type.cash', checks: [amount('наличные (by_type)', result.by_type.cash)] });
            return { alternatives: groups };
        }
    },
    {
        id: 'income_2025',
        question: 'Сколько я заработал за прошлый год?',
        checks: (data) => [
            amount('доходы 2025', sum(data, { from: '2025-01-01', to: '2025-12-31', type: 'income' }).total),
            amount('только зарплата 2025', sum(data, { from: '2025-01-01', to: '2025-12-31', type: 'income', category: 'Зарплата' }).total, { optional: true })
        ]
    },
    {
        id: 'groceries_q3',
        question: 'Покажи расходы на продукты по месяцам с июля по сентябрь',
        checks: (data) => sum(data, { from: '2026-07-01', to: '2026-09-30', category: 'Продукты', group_by: 'month' }).groups
            .sort((a, b) => a.key.localeCompare(b.key))
            .map(group => amount(`продукты ${group.key}`, group.total))
    },
    {
        id: 'taxi_2026',
        question: 'Сколько я потратил на такси в этом году?',
        checks: (data) => {
            const range = { from: '2026-01-01', to: TODAY };
            const bolt = sum(data, { ...range, company: 'Bolt' }).total;
            const uber = sum(data, { ...range, company: 'Uber' }).total;
            return {
                alternatives: [
                    { name: 'A: категория Транспорт', checks: [amount('Транспорт 2026', sum(data, { ...range, category: 'Транспорт' }).total)] },
                    { name: 'B: Bolt и Uber по отдельности', checks: [amount('Bolt 2026', bolt), amount('Uber 2026', uber)] },
                    { name: 'C: сумма Bolt и Uber', checks: [amount('Bolt + Uber 2026', Math.round((bolt + uber) * 100) / 100)] }
                ]
            };
        }
    },
    {
        id: 'auto_2026',
        question: 'Сколько ушло на машину в этом году?',
        checks: (data) => [amount('Авто 2026', sum(data, { from: '2026-01-01', to: TODAY, category: 'Авто' }).total)]
    },
    {
        id: 'lidl_aug',
        question: 'Сколько я потратил в Lidl в августе?',
        checks: (data) => [amount('Lidl, август 2026', sum(data, { from: '2026-08-01', to: '2026-08-31', company: 'Lidl' }).total)]
    },
    {
        id: 'starbucks_last',
        question: 'Когда я последний раз был в Starbucks и сколько потратил?',
        checks: (data) => {
            const op = find(data, { from: '2024-01-01', to: TODAY, text: 'Starbucks', limit: 1 }).operations[0];
            const [year, month, day] = op.date.split('-').map(Number);
            return [
                amount(`сумма (${op.date})`, op.amount),
                text(`дата ${op.date}`, [op.date, `${day} ${MONTHS_GENITIVE[month - 1]}`, `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.${year}`])
            ];
        }
    },
    {
        id: 'pace_oct',
        question: 'Укладываюсь ли я в обычный темп трат в этом месяце?',
        checks: (data) => {
            const result = must(getTypicalMonth({ month: '2026-10', category: null }, data), 'get_typical_month');
            if (!result.available) throw new Error('get_typical_month: недоступен');
            return [
                amount('потрачено к сегодняшнему дню', result.spent_so_far),
                amount('обычно к этому дню', result.typical_by_this_day),
                amount('прогноз на конец месяца', result.forecast_month_end ?? 0, { optional: true })
            ];
        }
    },
    {
        id: 'housing_2025',
        question: 'Сколько ушло на жилье за прошлый год?',
        checks: (data) => [amount('Жилье 2025', sum(data, { from: '2025-01-01', to: '2025-12-31', category: 'Жилье' }).total)]
    },
    {
        id: 'top_month_2026',
        question: 'В каком месяце этого года я потратил больше всего?',
        checks: (data) => {
            const top = sum(data, { from: '2026-01-01', to: TODAY, group_by: 'month' }).groups[0];
            return [
                text(`месяц: ${top.key}`, MONTH_STEMS[Number(top.key.slice(5, 7)) - 1]),
                amount(`расходы ${top.key}`, top.total)
            ];
        }
    },
    {
        id: 'last_week',
        question: 'Сколько я потратил за прошлую неделю?',
        checks: (data) => ({
            alternatives: [
                { name: 'A: пн-вс, 5-11 октября', checks: [amount('5-11 октября', sum(data, { from: '2026-10-05', to: '2026-10-11' }).total)] },
                { name: 'B: последние 7 дней, 6-12 октября', checks: [amount('6-12 октября', sum(data, { from: '2026-10-06', to: '2026-10-12' }).total)] },
                { name: 'C: 6-13 октября', checks: [amount('6-13 октября', sum(data, { from: '2026-10-06', to: TODAY }).total)] }
            ]
        })
    },
    {
        id: 'cafe_sep_vs_aug',
        question: 'Сравни расходы на кафе в сентябре и августе',
        checks: (data) => [
            amount('кафе, сентябрь 2026', sum(data, { from: '2026-09-01', to: '2026-09-30', category: CAFE }).total),
            amount('кафе, август 2026', sum(data, { from: '2026-08-01', to: '2026-08-31', category: CAFE }).total)
        ]
    },
    {
        id: 'before_data',
        question: 'Сколько я потратил на рестораны в январе 2024?',
        // Данные начинаются 2024-10-01: честный ответ - «операций нет», без выдуманных сумм.
        checks: () => [
            text('сказано, что данных нет', ['нет данных', 'нет операций', 'раньше', 'начинаются', 'не было', 'первая операция', 'ранняя операция', 'записей нет', 'нет записей', 'только с']),
            { label: 'нет сумм в ответе', kind: 'no_amounts' }
        ]
    }
];

// --- Оценка ответа ------------------------------------------------------------------------

const OK_STATUSES = new Set(['exact', 'rounded', 'ok']);

// Похоже ли на сумму: знак евро, «12 евро» или число с копейками. Годы и даты не считаются.
const looksLikeAmount = (answerText) => /€|\d\s*(?:евро|eur)\b|\d[.,]\d{2}(?!\d)/iu.test(answerText);

function gradeGroup(checks, answerText, numbers) {
    const lower = answerText.toLowerCase();
    return checks.map((check) => {
        let status;
        if (check.kind === 'amount') status = matchAmount(check.value, numbers);
        else if (check.kind === 'text') status = check.any.some(needle => lower.includes(needle.toLowerCase())) ? 'ok' : 'missing';
        else status = looksLikeAmount(answerText) ? 'missing' : 'ok';
        return {
            label: check.label,
            kind: check.kind,
            expected: check.kind === 'amount' ? check.value : (check.any ?? null),
            status,
            ok: OK_STATUSES.has(status),
            optional: Boolean(check.optional)
        };
    });
}

function normalizeGroups(checksResult) {
    return Array.isArray(checksResult) ? [{ name: 'main', checks: checksResult }] : checksResult.alternatives;
}

// pass: сошлась хотя бы одна группа; partial: часть обязательных проверок; fail: ничего.
function gradeCase(groups, answerText) {
    const numbers = extractNumbers(answerText);
    const graded = groups.map((group) => {
        const results = gradeGroup(group.checks, answerText, numbers);
        const required = results.filter(result => !result.optional);
        const passed = required.filter(result => result.ok).length;
        return { name: group.name, results, passed, required: required.length, complete: passed === required.length };
    });
    const matched = graded.filter(group => group.complete).map(group => group.name);
    const best = graded.find(group => group.complete) || [...graded].sort((a, b) => b.passed / (b.required || 1) - a.passed / (a.required || 1))[0];
    let status = 'fail';
    if (matched.length > 0) status = 'pass';
    else if (best && best.passed > 0) status = 'partial';
    return { status, matched, selected: best, groups: graded };
}

// --- Разбор ответа сервера ------------------------------------------------------------------

function parseNdjson(body) {
    const events = [];
    for (const line of String(body).split('\n')) {
        if (!line.trim()) continue;
        try {
            events.push(JSON.parse(line));
        } catch {
            events.push({ type: 'unparsed_line', line: line.slice(0, 200) });
        }
    }
    return events;
}

function parseLog(lines) {
    const rounds = [];
    let requestShape = null;
    let summary = null;
    for (const line of lines) {
        if (line.startsWith('[ask:debug] ')) {
            try {
                const entry = JSON.parse(line.slice('[ask:debug] '.length));
                if (entry.request_shape) requestShape = entry.request_shape;
                else rounds.push(entry);
            } catch {
                // битая строка журнала не должна ронять оценку
            }
        } else if (line.startsWith('[ask] ')) {
            const match = /rounds=(\d+) forced=(true|false) tools=(\S*) outcome=(\S+) ms=(\d+)/.exec(line);
            if (match) summary = { rounds: Number(match[1]), forced: match[2] === 'true', tools: match[3], outcome: match[4], serverMs: Number(match[5]) };
        }
    }
    return { rounds, requestShape, summary };
}

function compactInput(input) {
    const parts = Object.entries(input || {}).filter(([, value]) => value !== null && value !== undefined).map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`);
    return parts.join(', ');
}

function answerTextOf(answer) {
    if (!answer) return '';
    const parts = [];
    for (const block of answer.blocks || []) {
        if (block.type === 'text') parts.push(block.text);
        if (block.type === 'table') {
            parts.push((block.columns || []).join(' | '));
            for (const row of block.rows || []) parts.push(row.join(' | '));
        }
    }
    return parts.join('\n');
}

// --- Прогон одного вопроса -----------------------------------------------------------------

async function runCase(testCase, { app, sender, data, model }) {
    const messages = typeof testCase.messages === 'function'
        ? testCase.messages(data)
        : (testCase.messages || [{ role: 'user', text: testCase.question }]);
    const lines = [];
    sender.reset();
    app.locals.log = (line) => lines.push(line);

    const startedAt = Date.now();
    const response = await request(app)
        .post('/api/ask')
        .send({ messages, today: TODAY })
        .buffer(true)
        .parse((res, callback) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', chunk => { body += chunk; });
            res.on('end', () => callback(null, body));
        });
    const wallMs = Date.now() - startedAt;

    const events = parseNdjson(response.body);
    const answerEvent = events.find(event => event.type === 'answer') || null;
    let errorEvent = events.find(event => event.type === 'error') || null;
    if (response.status !== 200 && !errorEvent) {
        let parsed = null;
        try { parsed = JSON.parse(response.body); } catch { /* не JSON */ }
        errorEvent = { type: 'error', code: parsed?.code || `HTTP_${response.status}`, message: parsed?.message || String(response.body).slice(0, 200) };
    }
    const { rounds, requestShape, summary } = parseLog(lines);

    const toolCalls = rounds.flatMap(round => (round.calls || []).map(call => ({
        round: round.round,
        name: call.name,
        input: call.name === 'give_answer' ? null : compactInput(call.input),
        dup: Boolean(call.dup),
        is_error: Boolean(call.is_error),
        result: call.result ?? null
    })));

    const usages = sender.calls.map(call => call.usage);
    const usage = sumUsage(usages);
    const cost = sender.calls.reduce((total, call) => total + costOf(call.model || model, call.usage), 0);

    const answerText = answerTextOf(answerEvent);
    const groups = normalizeGroups(testCase.checks(data));
    const grade = answerEvent ? gradeCase(groups, answerText) : { ...gradeCase(groups, ''), status: 'fail' };

    return {
        id: testCase.id,
        question: messages.at(-1).text,
        messages,
        status: grade.status,
        matchedGroups: grade.matched,
        selectedGroup: grade.selected?.name,
        groups: grade.groups,
        answerText,
        basis: answerEvent?.basis ?? null,
        history: answerEvent?.history ?? null,
        steps: events.filter(event => event.type === 'step').map(event => event.label),
        error: errorEvent ? { code: errorEvent.code, message: errorEvent.message } : null,
        rounds: summary?.rounds ?? null,
        forced: summary?.forced ?? null,
        outcome: summary?.outcome ?? null,
        toolCalls,
        duplicateCalls: toolCalls.filter(call => call.dup).length,
        errorCalls: toolCalls.filter(call => call.is_error).length,
        requests: sender.calls.length,
        requestShape,
        perRequest: sender.calls.map(call => ({ model: call.model, ms: call.ms, stop_reason: call.stop_reason, usage: call.usage, error: call.error })),
        wallMs,
        usage,
        cost
    };
}

// --- Отчёт -------------------------------------------------------------------------------------

function buildSummary(records) {
    const done = records.filter(record => record.requests > 0);
    const cacheRead = records.reduce((total, record) => total + record.usage.cache_read_input_tokens, 0);
    const promptTokens = records.reduce((total, record) => total + record.usage.input_tokens + record.usage.cache_read_input_tokens + record.usage.cache_creation_input_tokens, 0);
    return {
        runs: records.length,
        pass: records.filter(record => record.status === 'pass').length,
        partial: records.filter(record => record.status === 'partial').length,
        fail: records.filter(record => record.status === 'fail').length,
        totalCost: records.reduce((total, record) => total + record.cost, 0),
        avgMs: average(done.map(record => record.wallMs)),
        medianMs: median(done.map(record => record.wallMs)),
        avgRounds: average(records.filter(record => record.rounds !== null).map(record => record.rounds)),
        cacheReadRatio: promptTokens > 0 ? cacheRead / promptTokens : 0,
        forcedRuns: records.filter(record => record.forced).length
    };
}

function renderMarkdown({ args, model, records, summary }) {
    const lines = [];
    lines.push(`# Оценка «Вопросов к данным»`, '');
    lines.push(`Модель: ${model}. Сегодня: ${TODAY}. Прогонов на кейс: ${args.repeat}. Кейсов: ${new Set(records.map(record => record.id)).size}.`, '');
    lines.push(`Итого: pass ${summary.pass} / partial ${summary.partial} / fail ${summary.fail} из ${summary.runs}. Стоимость ${usd(summary.totalCost)}. ` +
        `Время: среднее ${(summary.avgMs / 1000).toFixed(1)} с, медиана ${(summary.medianMs / 1000).toFixed(1)} с. ` +
        `Раундов в среднем ${summary.avgRounds.toFixed(2)} (принудительный последний: ${summary.forcedRuns}). Доля чтения из кэша ${(summary.cacheReadRatio * 100).toFixed(0)}%.`, '');
    lines.push(mdTable(
        ['кейс', 'итог', 'раунды', 'forced', 'вызовов', 'дубли/ошибки', 'запросов', 'мс', 'in', 'out', 'cache r', 'cache w', '$'],
        records.map(record => [
            record.id, record.status + (record.matchedGroups.length > 0 && record.matchedGroups[0] !== 'main' ? ` (${record.matchedGroups.map(name => name.split(':')[0]).join(',')})` : ''),
            record.rounds ?? '-', record.forced ?? '-',
            record.toolCalls.filter(call => call.name !== 'give_answer').length, `${record.duplicateCalls}/${record.errorCalls}`, record.requests, record.wallMs,
            record.usage.input_tokens, record.usage.output_tokens, record.usage.cache_read_input_tokens, record.usage.cache_creation_input_tokens, record.cost.toFixed(4)
        ])
    ), '');

    for (const record of records) {
        lines.push(`## ${record.id}: ${record.status}`, '');
        lines.push(`Вопрос: ${record.question}`, '');
        if (record.error) lines.push(`Ошибка: ${record.error.code} ${record.error.message}`, '');
        lines.push(mdTable(['проверка', 'ожидалось', 'итог', 'обяз.'], (record.groups.find(group => group.name === record.selectedGroup) || record.groups[0]).results
            .map(result => [result.label, Array.isArray(result.expected) ? result.expected.join(' / ') : result.expected, result.status, result.optional ? 'нет' : 'да'])), '');
        if (record.groups.length > 1) lines.push(`Группы: ${record.groups.map(group => `${group.name} ${group.complete ? '✓' : `${group.passed}/${group.required}`}`).join('; ')}`, '');
        lines.push('Ответ:', '', ...record.answerText.split('\n').map(line => `> ${line}`), '');
        lines.push(`Основание: ${record.basis ?? '-'}. Фильтр истории: ${JSON.stringify(record.history)}`, '');
        lines.push('Вызовы:', ...record.toolCalls.map(call => `- r${call.round} ${call.name}(${call.input ?? ''})${call.dup ? ' [дубль]' : ''}${call.is_error ? ' [ошибка]' : ''}`), '');
    }
    return lines.join('\n');
}

// --- Сухой прогон ------------------------------------------------------------------------------

function printDry(data, cases) {
    const rows = [];
    // Живой человек не уходит в минус по наличным: проверяем минимум остатка по ходу времени.
    const cashId = data.accounts.find(account => account.type === 'cash').id;
    let running = 0;
    let lowest = { balance: Infinity, date: null };
    for (const t of [...data.transactions].sort((a, b) => a.date.localeCompare(b.date))) {
        running += t.accountFlows[cashId] || 0;
        if (running < lowest.balance) lowest = { balance: running, date: t.date };
    }
    rows.push(`санити: наличные, минимум остатка ${Math.round(lowest.balance * 100) / 100} (${lowest.date}); операций ${data.transactions.length}`, '');
    for (const testCase of cases) {
        const groups = normalizeGroups(testCase.checks(data));
        const messages = typeof testCase.messages === 'function' ? testCase.messages(data) : null;
        rows.push(`${testCase.id}${messages ? `  [assistant: ${messages[1].text}]` : ''}`);
        for (const group of groups) {
            const prefix = groups.length > 1 || group.name !== 'main' ? `  (${group.name})` : '';
            for (const check of group.checks) {
                const value = check.kind === 'amount' ? check.value : (check.kind === 'text' ? `текст ${JSON.stringify(check.any)}` : 'без сумм');
                rows.push(`  ${prefix}${prefix ? ' ' : ''}${check.label}${check.optional ? ' (опц.)' : ''}: ${value}`);
            }
        }
    }
    console.log(rows.join('\n'));
}

// --- main -----------------------------------------------------------------------------------------

async function main() {
    const args = parseArgs();
    const model = args.model || DEFAULT_MODEL;
    const cases = args.only ? CASES.filter(testCase => args.only.has(testCase.id)) : CASES;
    if (args.only) {
        const unknown = [...args.only].filter(id => !CASES.some(testCase => testCase.id === id));
        if (unknown.length > 0) {
            console.error(`Неизвестные кейсы: ${unknown.join(', ')}. Есть: ${CASES.map(testCase => testCase.id).join(', ')}`);
            process.exit(1);
        }
    }

    const db = await startEvalDb();
    try {
        const data = await loadAskData(TODAY);
        console.log(`Данные: ${data.transactions.length} операций, ${data.accounts.length} счетов, с ${data.earliest}.`);

        if (args.dry) {
            printDry(data, cases);
            return;
        }

        const sender = createTimedSender();
        const app = express();
        app.use(express.json());
        app.use('/api/ask', createAskRouter({
            createMessage: sender.createMessage,
            getApiKey,
            getModel: () => model,
            getDebug: () => true,
            // Журнал роутера собирается по запросу: после каждого вопроса его разбирает runCase.
            log: (line) => app.locals.log?.(line),
            rateLimiter: () => true,
            dailyLimit: 1e6,
            timeoutMs: ASK_TIMEOUT_MS
        }));

        const records = [];
        let index = 0;
        const total = cases.length * args.repeat;
        // Последовательно: следующий вопрос получает prompt cache предыдущего.
        for (let run = 1; run <= args.repeat; run += 1) {
            for (const testCase of cases) {
                index += 1;
                let record;
                try {
                    record = await runCase(testCase, { app, sender, data, model });
                } catch (error) {
                    record = {
                        id: testCase.id, question: testCase.question || '', messages: [], status: 'fail', matchedGroups: [], selectedGroup: undefined, groups: [],
                        answerText: '', basis: null, history: null, steps: [], error: { code: 'EVAL_EXCEPTION', message: String(error?.message || error).slice(0, 300) },
                        rounds: null, forced: null, outcome: null, toolCalls: [], duplicateCalls: 0, errorCalls: 0, requests: sender.calls.length, requestShape: null,
                        perRequest: sender.calls, wallMs: 0, usage: sumUsage(sender.calls.map(call => call.usage)),
                        cost: sender.calls.reduce((sum, call) => sum + costOf(call.model || model, call.usage), 0)
                    };
                }
                record.run = run;
                records.push(record);
                console.log(`[${index}/${total}] ${record.id}: ${record.status}, раундов ${record.rounds ?? '-'}, ${(record.wallMs / 1000).toFixed(1)} с, ${usd(record.cost)}${record.error ? `, ошибка ${record.error.code}` : ''}`);
            }
        }

        // Пустая группа (исключение до проверок) в отчёте выглядит как кейс без проверок.
        for (const record of records) if (record.groups.length === 0) record.groups = [{ name: 'main', results: [], passed: 0, required: 0, complete: false }];
        const summary = buildSummary(records);
        writeReport({
            outDir: args.out,
            name: 'ask',
            json: { createdAt: new Date().toISOString(), model, today: TODAY, args: { only: args.only ? [...args.only] : null, repeat: args.repeat }, summary, records },
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

module.exports = { CASES, gradeCase, normalizeGroups };
