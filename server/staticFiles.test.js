import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import request from 'supertest';
import { describe, it, expect, afterEach } from 'vitest';
import { mountStatic } from './staticFiles.js';

// Две сборки, как их видит Koyeb: страницы одной длины (меняются только хеши
// в именах бандлов) и с одной и той же датой изменения 1 января 1980.
const BUILD_DATE = new Date('1980-01-01T00:00:01Z');
const pageOf = hash => `<!doctype html><script type="module" src="/assets/index-${hash}.js"></script>`;

const dirs = [];

function makeDist(hash) {
    const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'dist-'));
    dirs.push(dist);
    fs.mkdirSync(path.join(dist, 'assets'));
    const files = { 'index.html': pageOf(hash), 'sw.js': `// ${hash}`, 'icon.svg': '<svg/>' };
    for (const [name, content] of Object.entries(files)) {
        const file = path.join(dist, name);
        fs.writeFileSync(file, content);
        fs.utimesSync(file, BUILD_DATE, BUILD_DATE);
    }
    return dist;
}

function appFor(dist) {
    const app = express();
    mountStatic(app, dist);
    return app;
}

afterEach(() => {
    while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true });
});

describe('mountStatic', () => {
    it('gives a page of a new build of the same size and date a different ETag', async () => {
        const oldBuild = appFor(makeDist('AAAAAAAA'));
        const newBuild = appFor(makeDist('BBBBBBBB'));

        for (const url of ['/', '/index.html', '/history', '/sw.js']) {
            const before = await request(oldBuild).get(url);
            const after = await request(newBuild).get(url);
            expect(before.headers.etag).toBeTruthy();
            expect(after.headers.etag).not.toBe(before.headers.etag);
            expect(after.headers['last-modified']).toBeUndefined();

            // Телефон со старой оболочкой спрашивает «изменилась ли?» и
            // получает новую страницу целиком, а не 304.
            const revalidated = await request(newBuild).get(url)
                .set('If-None-Match', before.headers.etag)
                .set('If-Modified-Since', BUILD_DATE.toUTCString());
            expect(revalidated.status).toBe(200);
        }
    });

    it('still answers 304 when the page has not changed', async () => {
        const app = appFor(makeDist('AAAAAAAA'));
        for (const url of ['/', '/index.html', '/sw.js', '/icon.svg']) {
            const first = await request(app).get(url);
            const second = await request(app).get(url).set('If-None-Match', first.headers.etag);
            expect(second.status).toBe(304);
        }
    });

    it('keeps revalidation for the shell and the worker', async () => {
        const app = appFor(makeDist('AAAAAAAA'));
        expect((await request(app).get('/')).headers['cache-control']).toBe('no-cache');
        expect((await request(app).get('/index.html')).headers['cache-control']).toBe('no-cache');
        expect((await request(app).get('/sw.js')).headers['cache-control']).toBe('no-cache');
        expect((await request(app).get('/icon.svg')).headers['cache-control']).toBe('public, max-age=3600');
    });
});
