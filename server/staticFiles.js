const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');

// Раздача собранного фронтенда (dist) в продакшене.
//
// ETag считается по содержимому файла, а Last-Modified не отправляется
// совсем. Стандартные валидаторы express.static берутся из файловой системы:
// ETag - из размера и времени изменения, Last-Modified - из времени
// изменения. Сборка на Koyeb ставит всем файлам одну и ту же дату
// (1 января 1980), а index.html от сборки к сборке почти никогда не меняет
// размер: в нем меняются только хеши в именах бандлов, а они одной длины. В
// итоге у страницы новой сборки был тот же ETag, что и у прошлой, и на
// вопрос браузера «изменилась ли страница» сервер отвечал 304. Телефон
// оставался на старой оболочке, хотя сервер давно отдавал новую.
function createContentEtag({ readFile = fs.readFileSync } = {}) {
    // Файлы dist до перезапуска процесса не меняются (выкат и есть
    // перезапуск), поэтому хеш каждого считается один раз.
    const cache = new Map();
    return function contentEtag(filePath) {
        if (!cache.has(filePath)) {
            const hash = crypto.createHash('sha1').update(readFile(filePath)).digest('base64url');
            cache.set(filePath, `"${hash}"`);
        }
        return cache.get(filePath);
    };
}

function mountStatic(app, distPath, { contentEtag = createContentEtag() } = {}) {
    const indexPath = path.join(distPath, 'index.html');

    // Hashed assets (JS/CSS) — cache forever (filename changes on each build)
    app.use('/assets', express.static(path.join(distPath, 'assets'), {
        maxAge: '1y',
        immutable: true
    }));

    // All other static files (favicon, etc.) — short cache
    app.use(express.static(distPath, {
        maxAge: '1h',
        lastModified: false,
        setHeaders: (res, filePath) => {
            // Заголовок, выставленный здесь, express.static уже не
            // перезаписывает и по нему же решает, отвечать ли 304.
            res.setHeader('ETag', contentEtag(filePath));
            // index.html и sw.js - no-cache, а не no-store: браузер всё
            // равно сверяется с сервером при каждом заходе, но в ответ
            // получает короткий 304 по ETag вместо файла целиком, а
            // no-store ещё и отключает bfcache в части браузеров.
            // index.html - статичная оболочка без данных пользователя,
            // прятать её от диска незачем.
            //
            // sw.js - по той же причине, но следствия у неё другие:
            // браузер сверяет воркер с сервером при каждом заходе, и
            // час кеша означал бы, что после выката пользователь до часа
            // сидит под старым воркером. Имя файла при этом не
            // хешируется (адрес /sw.js зафиксирован в регистрации), так
            // что отличить новую версию по адресу нельзя.
            if (filePath === indexPath || filePath.endsWith('sw.js')) {
                res.setHeader('Cache-Control', 'no-cache');
            } else if (filePath.endsWith('.html')) {
                // Остальные страницы - банковские (dist/banking): в адресе
                // callback.html лежит одноразовый код авторизации. Роутер
                // банка ставит no-store раньше, но setHeaders express.static
                // срабатывает позже и перезаписал бы его, так что строгие
                // заголовки держим здесь.
                res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
                res.setHeader('Pragma', 'no-cache');
                res.setHeader('Expires', '0');
            }
        }
    }));

    // SPA fallback — index.html всегда с ревалидацией (см. комментарий выше)
    app.get('*', (req, res) => {
        if (fs.existsSync(indexPath)) {
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('ETag', contentEtag(indexPath));
            res.sendFile(indexPath, { lastModified: false });
        } else {
            console.error(`❌ index.html not found in dist: ${indexPath}`);
            res.status(404).send('index.html not found');
        }
    });
}

module.exports = { mountStatic, createContentEtag };
