const fs = require('fs');
const path = require('path');

// Версия сборки для GET /api/version: адрес входного модуля из собранного
// dist/index.html (/assets/index-C07hSNy2.js). Vite кладёт в имя хеш
// содержимого, поэтому адрес меняется с каждой сборкой, у которой изменился
// код, - отдельного номера версии заводить не нужно. Страница в браузере
// сравнивает его со своим собственным входным модулем (src/utils/appUpdate.js).
const DEFAULT_INDEX_PATH = path.resolve(__dirname, '..', 'dist', 'index.html');

// Пара «тег script - его атрибуты» берётся целиком, а порядок атрибутов не
// предполагается: Vite пишет `type="module" crossorigin src="..."`, но
// завязываться на это незачем.
const SCRIPT_TAG = /<script\b[^>]*>/gi;
const TYPE_MODULE = /\btype\s*=\s*["']module["']/i;
const SRC_ASSET = /\bsrc\s*=\s*["'](\/assets\/[^"'\s?#<>]+\.js)["']/i;

function parseBuildVersion(html) {
    if (typeof html !== 'string') return null;
    for (const tag of html.match(SCRIPT_TAG) || []) {
        if (!TYPE_MODULE.test(tag)) continue;
        const src = tag.match(SRC_ASSET);
        if (src) return src[1];
    }
    return null;
}

// Читает версию лениво, при первом запросе, и запоминает найденное: сборка
// лежит на диске неизменной до перезапуска процесса, а выкат и есть
// перезапуск. Пустой результат (нет dist в разработке и тестах, нет скрипта)
// не запоминается: читать файл заново дёшево, а ложный null на всю жизнь
// процесса, если dist появился позже, был бы хуже.
function createBuildVersionReader({ indexPath = DEFAULT_INDEX_PATH, readFile = fs.readFileSync } = {}) {
    let cached = null;
    return function getBuildVersion() {
        if (cached) return cached;
        try {
            cached = parseBuildVersion(readFile(indexPath, 'utf8'));
        } catch {
            // Нет файла - это dev или тест, не ошибка: клиент без версии
            // просто не будет искать обновлений.
            cached = null;
        }
        return cached;
    };
}

module.exports = {
    DEFAULT_INDEX_PATH,
    createBuildVersionReader,
    parseBuildVersion
};
