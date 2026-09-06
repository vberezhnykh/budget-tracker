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
const accountCurrency = value => typeof value === 'string' && /^[A-Z]{3}$/.test(value) ? value : null;
const DECIMAL_SCALE = 10n ** 18n;
function parseDecimal(value) {
    // The API specifies decimal strings. Never coerce through Number or round.
    if (typeof value !== 'string' || !/^\d{1,30}(\.\d{1,18})?$/.test(value)) return null;
    const [whole, fraction = ''] = value.split('.');
    const units = BigInt(whole) * DECIMAL_SCALE + BigInt(fraction.padEnd(18, '0'));
    return units > 0n ? units : null;
}
function formatDecimal(units) {
    const fraction = (units % DECIMAL_SCALE).toString().padStart(18, '0').replace(/0+$/, '').padEnd(2, '0');
    return `${units / DECIMAL_SCALE}.${fraction}`;
}
const HELP = `Enable Banking: пробное чтение без импорта и сохранения данных.
  node server/banking-trial.js --config <file.json> --check
  node server/banking-trial.js --config <file.json> --connect [--callback-file <new-file>]
Config: applicationId, privateKeyPath, redirectUrl (HTTPS, без query/hash), country, bank.
privateKeyPath разрешается относительно config. bank — точное имя из Enable Banking.
--check: только приложение и доступность personal/AIS банка.
--connect: согласие до 1 часа; последние 7 дней, максимум 5 счетов и 4 страницы/счёт.
Итоги раздельно по исходным валютам, без конвертации. Точность сумм: до 18 знаков.
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
    const summary = { count: 0, skipped: 0, skipReasons: { status: 0, date: 0, currency: 0, amount: 0, indicator: 0 }, duplicates: 0, byCurrency: {}, samples: [], truncated: false };
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
            const currency = accountCurrency(amount?.currency);
            const date = row?.booking_date ?? row?.transaction_date ?? row?.value_date;
            const dateLabel = row?.booking_date != null ? '' : row?.transaction_date != null ? ' (дата операции)' : ' (дата валютирования)';
            const bookedAt = Date.parse(`${date}T00:00:00Z`);
            const units = parseDecimal(amount?.amount);
            const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date || '') && date >= from && date <= to
                && Number.isFinite(bookedAt) && new Date(bookedAt).toISOString().slice(0, 10) === date;
            const skipReason = row?.status !== 'BOOK' ? 'status'
                : !currency || currency === 'XXX' ? 'currency'
                : !['DBIT', 'CRDT'].includes(row.credit_debit_indicator) ? 'indicator'
                : !validDate ? 'date' : units === null ? 'amount' : null;
            if (skipReason) { summary.skipped++; summary.skipReasons[skipReason]++; continue; }
            const reference = typeof row.entry_reference === 'string' && row.entry_reference ? row.entry_reference : null;
            if (reference && references.has(reference)) { summary.duplicates++; continue; }
            if (reference) references.add(reference);
            summary.count++;
            const debit = row.credit_debit_indicator === 'DBIT';
            const totals = summary.byCurrency[currency] ||= { count: 0, debit: 0n, credit: 0n };
            totals.count++;
            totals[debit ? 'debit' : 'credit'] += units;
            if (summary.samples.length < 5) summary.samples.push(`${date}${dateLabel} ${debit ? '−' : '+'}${formatDecimal(units)} ${currency} ${safeText((debit ? row.creditor : row.debtor)?.name)}`.trim());
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
    if (!['https://auth.enablebanking.com', 'https://tilisy.enablebanking.com'].includes(authUrl.origin) || authUrl.username || authUrl.password) fail('Неожиданный адрес авторизации.');
    output(`Откройте ссылку в браузере и подтвердите доступ: ${authUrl.href}`);
    const code = validate(await readCallback(deadline));
    let sessionId;
    try {
        const session = await api('/sessions', 'POST', { code });
        if (!UUID.test(session?.session_id)) fail('API не вернул корректную сессию.');
        sessionId = session.session_id;
        if (!Array.isArray(session.accounts)) fail('API не вернул список счетов.');
        // Some responses contain only UUIDs. Account currency is descriptive;
        // transaction amounts are grouped strictly by their own currency.
        const normalized = session.accounts.map(account => ({
            uid: typeof account === 'string' ? account : account?.uid,
            currency: accountCurrency(account?.currency)
        }));
        const idAbsent = account => account.uid === undefined || account.uid === null || account.uid === '';
        const missing = normalized.filter(idAbsent).length;
        const invalid = normalized.filter(account => !idAbsent(account) && !UUID.test(account.uid)).length;
        const accounts = normalized.filter(account => UUID.test(account.uid));
        output(`Доступно счетов: ${session.accounts.length}; без доступного ID: ${missing + invalid} (ID отсутствует: ${missing}, неверный формат ID: ${invalid}); кандидатов для чтения: ${accounts.length}.`);
        if (!session.accounts.length) output('Список пуст: проверьте, что выбранные счета привязаны к приложению в Control Panel.');
        if (accounts.length > MAX_ACCOUNTS) output(`Проба ограничена первыми ${MAX_ACCOUNTS} счетами, включая запросы реквизитов.`);
        let readAccounts = 0;
        for (const [index, account] of accounts.slice(0, MAX_ACCOUNTS).entries()) {
            if (!account.currency) {
                const details = await api(`/accounts/${account.uid}/details`);
                if (!details || typeof details !== 'object' || Array.isArray(details)) fail('API не вернул корректные реквизиты счёта.');
                account.currency = accountCurrency(details.currency);
            }
            const currencyLabel = account.currency === 'XXX' ? 'XXX — не указана/мультивалютный' : account.currency || 'не указана';
            output(`Счёт ${index + 1}: валюта ${currencyLabel}; итоги раздельно по валютам операций, без конвертации.`);
            const result = await readTransactions(api, account.uid, now());
            readAccounts++;
            output(`Счёт ${index + 1}: проведённых операций ${result.count}; пропущено ${result.skipped}, дубли ${result.duplicates}${result.truncated ? '; показана часть данных (лимит пробы)' : ''}.`);
            if (result.skipped) output(`  Причины пропуска: статус ${result.skipReasons.status}, дата ${result.skipReasons.date}, валюта ${result.skipReasons.currency}, сумма ${result.skipReasons.amount}, направление ${result.skipReasons.indicator}.`);
            for (const [currency, totals] of Object.entries(result.byCurrency)) output(`  ${currency}: операций ${totals.count}; исходящие ${formatDecimal(totals.debit)} ${currency}, входящие ${formatDecimal(totals.credit)} ${currency}.`);
            result.samples.forEach(line => output(`  ${line}`));
        }
        if (readAccounts === 0) fail('Проверка чтения не выполнена: среди выбранных счетов нет доступного ID. Сверьте диагностику счетов выше.');
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
module.exports = { TrialError, parseArgs, loadConfig, createJwt, createApi, createCallbackValidator, parseDecimal, formatDecimal, readTransactions, runTrial, main, MAX_PAGES };
