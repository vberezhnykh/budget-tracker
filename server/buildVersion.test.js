import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createBuildVersionReader, parseBuildVersion } from './buildVersion.js';

// Так выглядит dist/index.html после vite build: скрипт входа с type=module,
// рядом - modulepreload и стили, которые версией быть не должны.
const BUILT_HTML = `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <title>BudgetPro</title>
    <script type="module" crossorigin src="/assets/index-C07hSNy2.js"></script>
    <link rel="modulepreload" crossorigin href="/assets/vendor-AbCd1234.js">
    <link rel="stylesheet" crossorigin href="/assets/index-Zz9.css">
  </head>
  <body><div id="root"></div></body>
</html>`;

describe('parseBuildVersion', () => {
    it('берёт адрес входного модуля из собранной страницы', () => {
        expect(parseBuildVersion(BUILT_HTML)).toBe('/assets/index-C07hSNy2.js');
    });

    it('не зависит от порядка атрибутов и вида кавычек', () => {
        expect(parseBuildVersion(`<script src='/assets/a-1.js' crossorigin type='module'></script>`)).toBe('/assets/a-1.js');
    });

    it('игнорирует скрипты не из /assets и не module', () => {
        expect(parseBuildVersion('<script type="module" src="/src/main.jsx"></script>')).toBeNull();
        expect(parseBuildVersion('<script src="/assets/legacy-1.js"></script>')).toBeNull();
        expect(parseBuildVersion('<script type="module">import "/assets/x.js"</script>')).toBeNull();
    });

    it('возвращает null без скрипта и на нестроковом вводе', () => {
        expect(parseBuildVersion('<html></html>')).toBeNull();
        expect(parseBuildVersion('')).toBeNull();
        expect(parseBuildVersion(undefined)).toBeNull();
    });
});

describe('createBuildVersionReader', () => {
    let dir;
    afterEach(() => {
        if (dir) fs.rmSync(dir, { recursive: true, force: true });
        dir = undefined;
    });

    it('читает версию из фикстуры на диске', () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'build-version-'));
        const indexPath = path.join(dir, 'index.html');
        fs.writeFileSync(indexPath, BUILT_HTML);

        expect(createBuildVersionReader({ indexPath })()).toBe('/assets/index-C07hSNy2.js');
    });

    it('без dist возвращает null, а не падает', () => {
        const indexPath = path.join(os.tmpdir(), 'no-such-dir-build-version', 'index.html');

        expect(createBuildVersionReader({ indexPath })()).toBeNull();
    });

    it('читает файл один раз, пока версия найдена', () => {
        const readFile = vi.fn(() => BUILT_HTML);
        const getVersion = createBuildVersionReader({ indexPath: 'x', readFile });

        getVersion();
        getVersion();

        expect(readFile).toHaveBeenCalledTimes(1);
    });

    it('не запоминает пустой результат: появившийся позже dist подхватывается', () => {
        const readFile = vi.fn()
            .mockImplementationOnce(() => { throw new Error('ENOENT'); })
            .mockImplementation(() => BUILT_HTML);
        const getVersion = createBuildVersionReader({ indexPath: 'x', readFile });

        expect(getVersion()).toBeNull();
        expect(getVersion()).toBe('/assets/index-C07hSNy2.js');
    });
});
