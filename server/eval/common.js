// Общее для оценок ask.eval.js и quickEntry.eval.js: цены, ключ, замер
// запросов к Claude, разбор чисел из русского текста, аргументы и отчёты.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Anthropic = require('@anthropic-ai/sdk');

// $ за 1M токенов.
const PRICES = {
    'claude-sonnet-5-5': { input: 2, output: 10, cache_read: 0.20, cache_write: 2.50 },
    'claude-haiku-5-5': { input: 0.10, output: 0.50, cache_read: 0.01, cache_write: 0.125 }
};

const USAGE_KEYS = ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'];

function costOf(model, usage) {
    const price = PRICES[model];
    // Неизвестная модель (--model с чужим id): цена нам неизвестна, лучше 0, чем выдуманная цифра.
    if (!price || !usage) return 0;
    return ((usage.input_tokens || 0) * price.input
        + (usage.output_tokens || 0) * price.output
        + (usage.cache_read_input_tokens || 0) * price.cache_read
        + (usage.cache_creation_input_tokens || 0) * price.cache_write) / 1e6;
}

function sumUsage(usages) {
    const total = Object.fromEntries(USAGE_KEYS.map(key => [key, 0]));
    for (const usage of usages) {
        for (const key of USAGE_KEYS) total[key] += usage?.[key] || 0;
    }
    return total;
}

// Ключ читается из окружения и нигде не печатается: ни сам, ни в ошибках.
function getApiKey() {
    const key = process.env.BUDGET_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
    if (typeof key !== 'string' || key.trim() === '') {
        console.error('Не задан ключ Anthropic: установите BUDGET_ANTHROPIC_API_KEY (или ANTHROPIC_API_KEY).');
        process.exit(1);
    }
    return key;
}

// Настоящий клиент Anthropic, который запоминает каждый запрос: модель, время,
// расход токенов и причину остановки. createMessage передаётся в роутеры как
// есть, поэтому они работают так же, как в приложении.
//
// effort (--effort) перекрывает output_config.effort каждого запроса; format
// и остальное в output_config остаются как есть.
function createTimedSender({ effort = null } = {}) {
    let client = null;
    const state = { calls: [] };
    const createMessage = async (params, options) => {
        client ||= new Anthropic({ apiKey: getApiKey(), maxRetries: 1 });
        const startedAt = Date.now();
        const sent = effort ? { ...params, output_config: { ...params.output_config, effort } } : params;
        try {
            const response = await client.messages.create(sent, options);
            state.calls.push({ model: params.model, ms: Date.now() - startedAt, usage: response?.usage || null, stop_reason: response?.stop_reason ?? null });
            return response;
        } catch (error) {
            // Только имя и статус: тело ошибки Anthropic может повторять запрос.
            state.calls.push({ model: params.model, ms: Date.now() - startedAt, usage: null, stop_reason: null, error: `${error?.name} ${error?.status ?? ''}`.trim() });
            throw error;
        }
    };
    return {
        createMessage,
        get calls() { return state.calls; },
        reset() { state.calls = []; }
    };
}

// --- Числа из русского текста ----------------------------------------------------

const SPACE = '[ \\u00A0\\u202F\\u2009]';
const NUMBER_PATTERN = new RegExp([
    // 1.234,50 (точка как разделитель тысяч)
    '\\d{1,3}(?:\\.\\d{3})+,\\d+',
    // 1 234,50 / 1 234 567
    `\\d{1,3}(?:${SPACE}\\d{3})+(?:[.,]\\d+)?`,
    // 412 / 1234.5 / 12,5
    '\\d+(?:[.,]\\d+)?'
].join('|'), 'gu');

// Числа из текста ответа (по модулю). Даты вроде «2026» и «13 октября» тоже
// попадут в список: проверяется только, что ожидаемое число там есть.
function extractNumbers(text) {
    const numbers = [];
    for (const [token] of String(text ?? '').matchAll(NUMBER_PATTERN)) {
        const compact = token.replace(new RegExp(SPACE, 'gu'), '');
        const value = /^\d{1,3}(?:\.\d{3})+,\d+$/.test(compact)
            ? Number(compact.replace(/\./g, '').replace(',', '.'))
            : Number(compact.replace(',', '.'));
        if (Number.isFinite(value)) numbers.push(value);
        // «412 1 234» без знака валюты между ними неотличимо от «412 1234»:
        // обычные пробелы между группами дополнительно читаются как отдельные числа.
        if (token.includes(' ') && /^\d{1,3}(?: \d{3})+/.test(token)) {
            for (const part of token.split(' ')) {
                const partValue = Number(part.replace(',', '.'));
                if (Number.isFinite(partValue)) numbers.push(partValue);
            }
        }
    }
    return numbers;
}

// exact: совпало до цента; rounded: до целого евро (ответ без копеек); missing.
function matchAmount(expected, numbers) {
    if (numbers.some(n => Math.abs(n - expected) <= 0.011)) return 'exact';
    if (numbers.some(n => Math.abs(n - expected) <= 0.5 || n === Math.round(expected))) return 'rounded';
    return 'missing';
}

// «€1 234,50» без копеек, если их нет.
function formatEuro(value) {
    const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
    const [whole, fraction] = Math.abs(rounded).toFixed(2).split('.');
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return `${rounded < 0 ? '-' : ''}€${grouped}${fraction === '00' ? '' : `,${fraction}`}`;
}

// --- Аргументы ---------------------------------------------------------------------

// --only a,b  --repeat N  --out dir  --model id  --effort low|medium|high|xhigh|max  --dry
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

function parseArgs(argv = process.argv.slice(2)) {
    const args = { only: null, repeat: 1, out: process.env.EVAL_OUT_DIR || path.join(os.tmpdir(), 'budget-eval'), model: null, effort: null, dry: false };
    for (let index = 0; index < argv.length; index += 1) {
        const [flag, inline] = argv[index].split(/=(.*)/s);
        const value = () => (inline !== undefined ? inline : argv[++index]);
        switch (flag) {
            case '--only': args.only = new Set(String(value() || '').split(',').map(item => item.trim()).filter(Boolean)); break;
            case '--repeat': args.repeat = Math.max(1, Number.parseInt(value(), 10) || 1); break;
            case '--out': args.out = path.resolve(String(value())); break;
            case '--model': args.model = String(value() || '') || null; break;
            case '--effort': {
                const effort = String(value() || '');
                if (!EFFORTS.includes(effort)) {
                    console.error(`--effort: одно из ${EFFORTS.join(', ')}`);
                    process.exit(1);
                }
                args.effort = effort;
                break;
            }
            case '--dry': args.dry = true; break;
            default:
                console.error(`Неизвестный аргумент: ${flag}`);
                process.exit(1);
        }
    }
    return args;
}

// --- Статистика и отчёты -------------------------------------------------------------

const average = (values) => (values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);
function median(values) {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const usd = (value) => `$${value.toFixed(4)}`;
const escapeCell = (value) => String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

// Markdown-таблица из заголовков и строк.
function mdTable(headers, rows) {
    return [
        `| ${headers.join(' | ')} |`,
        `| ${headers.map(() => '---').join(' | ')} |`,
        ...rows.map(row => `| ${row.map(escapeCell).join(' | ')} |`)
    ].join('\n');
}

// <out>/<name>-<timestamp>.json (всё подробно) и .md (сводка и разбор по кейсам);
// сводка печатается в stdout.
function writeReport({ outDir, name, json, markdown }) {
    fs.mkdirSync(outDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const base = path.join(outDir, `${name}-${stamp}`);
    fs.writeFileSync(`${base}.json`, JSON.stringify(json, null, 2));
    fs.writeFileSync(`${base}.md`, markdown);
    console.log(markdown);
    console.log(`\nОтчёт: ${base}.json\n       ${base}.md`);
    return base;
}

module.exports = {
    PRICES,
    costOf,
    sumUsage,
    getApiKey,
    createTimedSender,
    extractNumbers,
    matchAmount,
    formatEuro,
    parseArgs,
    average,
    median,
    usd,
    mdTable,
    writeReport
};
