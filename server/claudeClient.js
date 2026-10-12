// Общая часть серверных функций на Claude: ввод фразой, чтение чека, вопросы
// к данным. Здесь только то, что у них одинаково: проверка ключа, клиент
// Anthropic, «сегодня» от браузера, перевод ошибок Claude в три вида и
// допуск запроса (ключ, частота с одного адреса, дневной потолок).
// Промпты, схемы и разбор ответа у каждой функции свои.

const Anthropic = require('@anthropic-ai/sdk');

const DAY_MS = 24 * 60 * 60 * 1000;

function isApiKeyConfigured(env = process.env) {
    return typeof env.ANTHROPIC_API_KEY === 'string' && env.ANTHROPIC_API_KEY.trim() !== '';
}

// «Сегодня» присылает браузер: у сервера свой часовой пояс, а «вчера» человек
// считает от своей даты. Поэтому дата - настоящий день календаря, не только
// строка нужной формы.
function parseDay(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const [year, month, day] = value.split('-').map(Number);
    const time = Date.UTC(year, month - 1, day);
    const date = new Date(time);
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return time;
}

// Клиент создаётся при первом запросе: ключ могли задать уже после старта
// модуля, а без ключа роутер до Claude всё равно не доходит. createMessage
// подменяет вызов целиком (тесты).
function createClaudeSender({ createMessage, getApiKey }) {
    let client = null;
    let clientKey = null;
    return createMessage || ((params, options) => {
        const apiKey = getApiKey();
        if (!client || clientKey !== apiKey) {
            client = new Anthropic({ apiKey, maxRetries: 1 });
            clientKey = apiKey;
        }
        return client.messages.create(params, options);
    });
}

const isRateLimitError = (error) => error instanceof Anthropic.RateLimitError || error?.status === 429;
const isTimeoutError = (error) => error instanceof Anthropic.APIConnectionTimeoutError;

// Что случилось с запросом, в трёх видах: вышло время (свой таймер или таймаут
// SDK), Claude ограничил частоту, всё остальное. Что ответить человеку и каким
// кодом, решает вызывающий.
function classifyClaudeError(error, { aborted = false } = {}) {
    if (aborted || isTimeoutError(error)) return 'timeout';
    if (isRateLimitError(error)) return 'rate_limit';
    return 'failed';
}

// Допуск запроса к Claude. admit проверяет ключ, частоту с одного адреса и
// дневной потолок и сам отвечает отказом (возвращает false); count учитывает
// запрос, который дошёл до Claude. Дневные счётчики дешёвые: в памяти, по
// суткам UTC. После перезапуска они обнуляются, а потолок расходов всё равно
// задаёт лимит в Anthropic Console. У каждого kind счётчик свой: чек дороже
// фразы, и его лимит не должен съедать фразы.
function createClaudeGate({ getApiKey, rateLimiter, now = () => Date.now(), codes }) {
    const usage = {};
    const slot = (kind) => {
        const day = Math.floor(now() / DAY_MS);
        if (!usage[kind] || usage[kind].day !== day) usage[kind] = { day, count: 0 };
        return usage[kind];
    };

    return {
        admit(req, res, { kind, limit, unavailable, limited }) {
            const apiKey = getApiKey();
            if (typeof apiKey !== 'string' || apiKey.trim() === '') {
                res.status(503).json({ code: codes.unavailable, message: unavailable });
                return false;
            }
            if (!rateLimiter(req.ip || req.socket?.remoteAddress || 'unknown')) {
                res.set('Retry-After', '60').status(429).json({ code: codes.rateLimited, message: 'Слишком много запросов. Попробуйте через минуту.' });
                return false;
            }
            if (slot(kind).count >= limit) {
                res.status(429).json({ code: codes.rateLimited, message: limited });
                return false;
            }
            return true;
        },
        count(kind) {
            slot(kind).count += 1;
        }
    };
}

module.exports = {
    DAY_MS,
    isApiKeyConfigured,
    parseDay,
    createClaudeSender,
    isRateLimitError,
    isTimeoutError,
    classifyClaudeError,
    createClaudeGate
};
