// Standalone Enable Banking probe. No application imports, database or file writes.
// Contract: https://enablebanking.com/docs/api/reference/
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const API = 'https://api.enablebanking.com';
const MAX_PAGES = 4;
const MAX_ACCOUNTS = 5;
const MAX_ROWS = 2000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
class TrialError extends Error {}
const fail = message => { throw new TrialError(message); };
const safeText = value => String(value || '').replace(/[\p{Cc}\p{Cf}]/gu, ' ').slice(0, 70);
const HELP = `Enable Banking: пробное чтение без импорта и сохранения данных.
  node server/banking-trial.js --config <file.json> --check
  node server/banking-trial.js --config <file.json> --connect [--callback-file <new-file>]
Config: applicationId, privateKeyPath, redirectUrl (HTTPS, без query/hash), country, bank.
privateKeyPath разрешается относительно config. bank — точное имя из Enable Banking.
--check: только приложение и доступность personal/AIS банка.
--connect: согласие до 1 часа; последние 7 дней, максимум 5 EUR-счетов и 4 страницы/счёт.
Callback вводится скрыто в TTY. Иначе после появления ссылки сохраните конечный URL
в новый --callback-file (ожидание до 10 минут); файл читает CLI, удалите его после пробы.
Сессия API закрывается после чтения. Привязка счетов в Control Panel сохраняется.
Суммы входящих/исходящих движений могут включать переводы между своими счетами.`;

function parseArgs(args) {
    if (args.length === 0 || (args.length === 1 && ['--help', '-h'].includes(args[0]))) return { help: true };
    const result = {};
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (['--check', '--connect'].includes(arg)) {
            if (result.mode) fail('Выберите только один режим: --check или --connect.');
            result.mode = arg.slice(2);
        } else if (['--config', '--callback-file'].includes(arg)) {
            const key = arg === '--config' ? 'config' : 'callbackFile';
            if (result[key] || !args[i + 1] || args[i + 1].startsWith('--')) fail('Некорректные аргументы CLI.');
            result[key] = args[++i];
        } else fail('Неизвестный аргумент CLI. Используйте --help.');
    }
    if (!result.mode || !result.config || (result.callbackFile && result.mode !== 'connect')) fail('Нужны --config и один режим; --callback-file допустим только с --connect.');
    return result;
}

function loadConfig(filename) {
    let config;
    try { config = JSON.parse(fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, '')); } catch { fail('Не удалось прочитать JSON-конфигурацию.'); }
    if (!config || typeof config.applicationId !== 'string' || !UUID.test(config.applicationId) || typeof config.country !== 'string' || !/^[A-Z]{2}$/.test(config.country)
        || typeof config.bank !== 'string' || !config.bank.trim() || config.bank.length > 150
        || typeof config.privateKeyPath !== 'string' || !config.privateKeyPath) fail('Проверьте обязательные поля конфигурации.');
    let redirect;
    try { redirect = new URL(config.redirectUrl); } catch { fail('Некорректный redirectUrl.'); }
    if (redirect.protocol !== 'https:' || redirect.username || redirect.password || redirect.search || redirect.hash) fail('redirectUrl должен быть HTTPS без credentials, query и fragment.');
    let privateKey;
    try { privateKey = crypto.createPrivateKey(fs.readFileSync(path.resolve(path.dirname(filename), config.privateKeyPath))); }
    catch { fail('Не удалось прочитать приватный RSA-ключ.'); }
    if (privateKey.asymmetricKeyType !== 'rsa' || privateKey.asymmetricKeyDetails.modulusLength < 2048) fail('Нужен приватный RSA-ключ не короче 2048 бит.');
    return { ...config, privateKey };
}

function createJwt(config, now = Date.now()) {
    const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const iat = Math.floor(now / 1000);
    const unsigned = `${encode({ typ: 'JWT', alg: 'RS256', kid: config.applicationId })}.${encode({ iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat, exp: iat + 300 })}`;
    return `${unsigned}.${crypto.sign('RSA-SHA256', Buffer.from(unsigned), config.privateKey).toString('base64url')}`;
}

function createApi(config, fetchImpl = fetch, now = Date.now) {
    return async (endpoint, method = 'GET', body) => {
        if (!endpoint.startsWith('/') || endpoint.startsWith('//')) fail('Некорректный путь API.');
        let response;
        try {
            response = await fetchImpl(`${API}${endpoint}`, {
                method, redirect: 'error', signal: AbortSignal.timeout(30_000),
                headers: { Authorization: `Bearer ${createJwt(config, now())}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
                ...(body ? { body: JSON.stringify(body) } : {})
            });
        } catch { fail('Запрос Enable Banking не завершён: сеть или тайм-аут.'); }
        // Never expose upstream bodies, request URLs or error messages: they may carry secrets.
        if (!response.ok) fail(`Enable Banking: HTTP ${Number(response.status) || 0}. Подробности доступны в Control Panel.`);
        if (response.status === 204) return {};
        try {
            const raw = await response.text();
            if (raw.length > 2_000_000) fail('Слишком большой ответ API.');
            return JSON.parse(raw);
        } catch { fail('Enable Banking вернул некорректный ответ.'); }
    };
}

function createCallbackValidator(redirectUrl, state, expiresAt, now = Date.now) {
    let consumed = false;
    return raw => {
        if (consumed) fail('Callback уже использован.');
        consumed = true;
        if (now() >= expiresAt) fail('Время ожидания авторизации истекло.');
        let url;
        try { url = new URL(String(raw).trim()); } catch { fail('Некорректный callback URL.'); }
        const expected = new URL(redirectUrl);
        if (url.origin !== expected.origin || url.pathname !== expected.pathname || url.username || url.password || url.hash) fail('Callback не соответствует зарегистрированному адресу.');
        const allowed = new Set(['state', 'code', 'error', 'error_description', 'error_uri']);
        for (const key of url.searchParams.keys()) {
            if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) fail('Некорректные параметры callback.');
        }
        const received = url.searchParams.get('state') || '';
        const hash = value => crypto.createHash('sha256').update(value).digest();
        if (!crypto.timingSafeEqual(hash(received), hash(state))) fail('State callback не совпадает.');
        if (url.searchParams.has('error')) fail('Банк не подтвердил доступ или авторизация отменена.');
        const code = url.searchParams.get('code');
        if (!code || code.length > 8192) fail('В callback отсутствует корректный код авторизации.');
        return code;
    };
}

function hiddenCallback(deadline) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) fail('Для этого терминала используйте --callback-file.');
    process.stdout.write('Вставьте конечный callback URL и нажмите Enter (ввод скрыт): ');
    return new Promise((resolve, reject) => {
        let value = '';
        const wasRaw = process.stdin.isRaw;
        readline.emitKeypressEvents(process.stdin);
        const finish = (error = null) => {
            clearTimeout(timer);
            process.stdin.removeListener('keypress', onKey);
            process.stdin.setRawMode(Boolean(wasRaw));
            process.stdin.pause();
            process.stdout.write('\n');
            if (error) reject(error); else resolve(value);
        };
        const onKey = (char, key = {}) => {
            if (key.ctrl && ['c', 'd'].includes(key.name)) return finish(new TrialError('Авторизация прервана.'));
            if (['return', 'enter'].includes(key.name)) return finish();
            if (key.name === 'backspace') value = value.slice(0, -1);
            else if (!key.ctrl && !key.meta && char && !/[\p{Cc}]/u.test(char)) value += char;
            if (value.length > 16384) finish(new TrialError('Слишком длинный callback URL.'));
        };
        const timer = setTimeout(() => finish(new TrialError('Время ожидания авторизации истекло.')), Math.max(1, deadline - Date.now()));
        process.stdin.setRawMode(true);
        process.stdin.on('keypress', onKey);
        process.stdin.resume();
    });
}

async function callbackFromFile(filename, deadline) {
    while (Date.now() < deadline) {
        try {
            const stat = fs.statSync(filename);
            if (!stat.isFile() || stat.size > 16384) fail('Некорректный файл callback.');
            const raw = fs.readFileSync(filename, 'utf8').trim();
            if (raw) return raw;
        } catch (error) { if (error.code !== 'ENOENT') fail('Не удалось прочитать файл callback.'); }
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    fail('Время ожидания файла callback истекло.');
}

async function readTransactions(api, accountId, now) {
    const to = new Date(now).toISOString().slice(0, 10);
    const from = new Date(Date.parse(`${to}T00:00:00Z`) - 6 * 86400_000).toISOString().slice(0, 10);
    const summary = { count: 0, skipped: 0, duplicates: 0, debitCents: 0, creditCents: 0, samples: [], truncated: false };
    const cursors = new Set(), references = new Set();
    let cursor, total = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
        const query = new URLSearchParams({ date_from: from, date_to: to, transaction_status: 'BOOK' });
        if (cursor) query.set('continuation_key', cursor);
        const data = await api(`/accounts/${accountId}/transactions?${query}`);
        if (!Array.isArray(data?.transactions)) fail('Некорректный список операций.');
        for (const row of data.transactions) {
            if (++total > MAX_ROWS) { summary.truncated = true; break; }
            const amount = row?.transaction_amount;
            const date = row?.booking_date;
            const bookedAt = Date.parse(`${date}T00:00:00Z`);
            const cents = Math.round(Number(amount?.amount) * 100);
            if (row?.status !== 'BOOK' || amount?.currency !== 'EUR' || !['DBIT', 'CRDT'].includes(row.credit_debit_indicator)
                || !/^\d{4}-\d{2}-\d{2}$/.test(date || '') || date < from || date > to
                || !Number.isFinite(bookedAt) || new Date(bookedAt).toISOString().slice(0, 10) !== date
                || !/^\d+(\.\d{1,2})?$/.test(String(amount?.amount)) || !Number.isSafeInteger(cents) || cents <= 0) { summary.skipped++; continue; }
            if (row.entry_reference && references.has(row.entry_reference)) { summary.duplicates++; continue; }
            if (row.entry_reference) references.add(row.entry_reference);
            summary.count++;
            const debit = row.credit_debit_indicator === 'DBIT';
            if (!Number.isSafeInteger(summary[debit ? 'debitCents' : 'creditCents'] + cents)) fail('Суммы операций превышают безопасную точность.');
            summary[debit ? 'debitCents' : 'creditCents'] += cents;
            if (summary.samples.length < 5) summary.samples.push(`${date} ${debit ? '−' : '+'}${(cents / 100).toFixed(2)} EUR ${safeText((debit ? row.creditor : row.debtor)?.name)}`.trim());
        }
        cursor = data.continuation_key;
        if (!cursor || summary.truncated) break;
        if (typeof cursor !== 'string' || cursor.length > 8192 || cursors.has(cursor)) fail('Некорректная или повторяющаяся страница операций.');
        cursors.add(cursor);
        if (page === MAX_PAGES - 1) summary.truncated = true;
    }
    return summary;
}

async function runTrial(config, { mode = 'check', fetchImpl, output = console.log, readCallback = hiddenCallback, now = Date.now } = {}) {
    if (!['check', 'connect'].includes(mode)) fail('Неизвестный режим.');
    const api = createApi(config, fetchImpl, now);
    const application = await api('/application');
    const banks = await api(`/aspsps?${new URLSearchParams({ country: config.country, psu_type: 'personal', service: 'AIS' })}`);
    const matches = banks?.aspsps?.filter(bank => bank.name === config.bank && bank.country === config.country && bank.psu_types?.includes('personal'));
    if (matches?.length !== 1) fail('Точное имя personal/AIS банка не найдено однозначно. Проверьте bank и country.');
    if (!application?.redirect_urls?.includes(config.redirectUrl)) fail('redirectUrl не зарегистрирован у приложения.');
    output(`Приложение ${application.active ? 'активно' : 'не активно; привяжите собственные счета в Control Panel'}. Банк: ${safeText(config.bank)} (${config.country}), personal/AIS найден.`);
    if (mode === 'check') return { active: application.active === true };
    if (application.active !== true) fail('Сначала активируйте приложение привязкой собственных счетов.');
    const maximum = matches[0].maximum_consent_validity;
    if (!Number.isInteger(maximum) || maximum < 1) fail('Банк не сообщил допустимый срок согласия.');
    const expiresAt = now() + Math.min(3600, maximum) * 1000;
    const deadline = Math.min(expiresAt, now() + 600_000);
    const state = crypto.randomBytes(32).toString('base64url');
    const validate = createCallbackValidator(config.redirectUrl, state, deadline, now);
    const auth = await api('/auth', 'POST', { access: { valid_until: new Date(expiresAt).toISOString(), transactions: true, balances: false }, aspsp: { name: config.bank, country: config.country }, psu_type: 'personal', state, redirect_url: config.redirectUrl });
    let authUrl;
    try { authUrl = new URL(auth?.url); } catch { fail('API не вернул ссылку авторизации.'); }
    if (authUrl.origin !== 'https://auth.enablebanking.com' || authUrl.username || authUrl.password) fail('Неожиданный адрес авторизации.');
    output(`Откройте ссылку в браузере и подтвердите доступ: ${authUrl.href}`);
    const code = validate(await readCallback(deadline));
    let sessionId;
    try {
        const session = await api('/sessions', 'POST', { code });
        if (!UUID.test(session?.session_id)) fail('API не вернул корректную сессию.');
        sessionId = session.session_id;
        if (!Array.isArray(session.accounts)) fail('API не вернул список счетов.');
        const accounts = session.accounts.filter(account => account.currency === 'EUR' && UUID.test(account.uid));
        output(`Доступно счетов: ${session.accounts.length}; читаемых EUR: ${accounts.length}.`);
        if (!session.accounts.length) output('Список пуст: проверьте, что выбранные счета привязаны к приложению в Control Panel.');
        if (accounts.length > MAX_ACCOUNTS) output(`Проба ограничена первыми ${MAX_ACCOUNTS} EUR-счетами.`);
        for (const [index, account] of accounts.slice(0, MAX_ACCOUNTS).entries()) {
            const result = await readTransactions(api, account.uid, now());
            output(`Счёт ${index + 1}: BOOK/EUR ${result.count}; исходящие ${(result.debitCents / 100).toFixed(2)} EUR, входящие ${(result.creditCents / 100).toFixed(2)} EUR; пропущено ${result.skipped}, дубли ${result.duplicates}${result.truncated ? '; показана часть данных (лимит пробы)' : ''}.`);
            result.samples.forEach(line => output(`  ${line}`));
        }
    } finally {
        if (sessionId) {
            try { await api(`/sessions/${sessionId}`, 'DELETE'); output('Пробная сессия API закрыта. Данные не импортированы и не сохранены.'); }
            catch { fail('Не удалось подтвердить закрытие сессии API; отзовите доступ в Control Panel. Запрошенный срок сессии — не более часа.'); }
        }
    }
}

async function main(args = process.argv.slice(2)) {
    const options = parseArgs(args);
    if (options.help) return console.log(HELP);
    if (options.callbackFile && fs.existsSync(options.callbackFile)) fail('Файл callback уже существует. Укажите новый путь для этой пробы.');
    if (options.mode === 'connect' && !options.callbackFile && !process.stdin.isTTY) fail('Для этого терминала используйте --callback-file.');
    return runTrial(loadConfig(options.config), { mode: options.mode, ...(options.callbackFile ? { readCallback: deadline => callbackFromFile(options.callbackFile, deadline) } : {}) });
}

if (require.main === module) main().catch(error => { console.error(error instanceof TrialError ? error.message : 'Проба не выполнена из-за локальной ошибки.'); process.exitCode = 1; });
module.exports = { TrialError, parseArgs, loadConfig, createJwt, createApi, createCallbackValidator, readTransactions, runTrial, main, MAX_PAGES };
