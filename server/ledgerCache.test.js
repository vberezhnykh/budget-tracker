// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    SOFT_TTL_MS, RELOAD_DEBOUNCE_MS,
    createLedgerCache, fingerprintLedger, isLedgerCacheEnabled, docsByDateDesc
} from './ledgerCache.js';

const MINUTE = 60 * 1000;

// Загрузчик, которым управляет тест: каждый вызов - отдельный промис, который
// тест завершает сам, в нужный момент.
function controlledLoader() {
    const calls = [];
    const load = vi.fn(() => new Promise((resolve, reject) => {
        calls.push({ resolve: data => resolve(data), reject });
    }));
    return { load, calls };
}

const data = (label) => ({ docs: [{ _id: label }], accounts: [{ _id: `acc-${label}` }] });

function makeCache(options = {}) {
    const clock = { time: 1_000_000 };
    const logger = { warn: vi.fn() };
    const loader = options.load ? { load: options.load, calls: [] } : controlledLoader();
    const cache = createLedgerCache({
        load: loader.load,
        now: () => clock.time,
        logger,
        ...options.cache
    });
    return { cache, clock, logger, ...loader };
}

// Выполняет отложенные задачи промисов: фейковые таймеры их не трогают, но
// цепочка then внутри кэша состоит из нескольких шагов.
const flush = () => new Promise(resolve => setImmediate(resolve));

describe('createLedgerCache', () => {
    beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); });
    afterEach(() => { vi.useRealTimers(); });

    it('делит одну загрузку между одновременными читателями', async () => {
        const { cache, load, calls } = makeCache();

        const first = cache.get();
        const second = cache.get();
        const third = cache.get();
        await flush();
        expect(load).toHaveBeenCalledTimes(1);
        calls[0].resolve(data('a'));
        const results = await Promise.all([first, second, third]);

        expect(results.map(r => r.state)).toEqual(['miss', 'miss', 'miss']);
        expect(results[0].snapshot).toBe(results[1].snapshot);
        expect(results[0].snapshot.docs).toEqual([{ _id: 'a' }]);
    });

    it('после загрузки отдаёт снимок из памяти и не читает базу', async () => {
        const { cache, load, calls } = makeCache();
        const pending = cache.get();
        await flush();
        calls[0].resolve(data('a'));
        const { snapshot } = await pending;

        const again = await cache.get();

        expect(again.state).toBe('hit');
        expect(again.snapshot).toBe(snapshot);
        expect(load).toHaveBeenCalledTimes(1);
        expect(snapshot).toEqual({
            version: expect.any(Number), loadedAt: 1_000_000, docs: [{ _id: 'a' }], accounts: [{ _id: 'acc-a' }]
        });
    });

    it('invalidate растит версию и выбрасывает снимок', async () => {
        const { cache, calls } = makeCache();
        const first = cache.get();
        await flush();
        calls[0].resolve(data('a'));
        const { snapshot: before } = await first;
        const versionBefore = cache.getVersion();

        cache.invalidate();

        expect(cache.getVersion()).toBeGreaterThan(versionBefore);
        expect(cache.peek()).toBeNull();
        const second = cache.get();
        await flush();
        calls[1].resolve(data('b'));
        const { snapshot: after, state } = await second;
        expect(state).toBe('miss');
        expect(after.docs).toEqual([{ _id: 'b' }]);
        expect(after.version).toBeGreaterThan(before.version);
    });

    it('загрузка, начатая до записи, не ставит свой результат на место снимка', async () => {
        const { cache, load, calls } = makeCache();
        const racing = cache.get();
        await flush();

        // Запись случилась, пока шла первая загрузка.
        cache.invalidate();
        // Читатель после записи не присоединяется к старой загрузке.
        const afterWrite = cache.get();
        await flush();
        expect(load).toHaveBeenCalledTimes(2);

        calls[1].resolve(data('fresh'));
        calls[0].resolve(data('stale'));
        const [oldResult, newResult] = await Promise.all([racing, afterWrite]);

        // Старому вызывающему результат отдаётся, но в кэше его нет.
        expect(oldResult.snapshot.docs).toEqual([{ _id: 'stale' }]);
        expect(newResult.snapshot.docs).toEqual([{ _id: 'fresh' }]);
        expect(cache.peek()).toBe(newResult.snapshot);
        expect((await cache.get()).snapshot.docs).toEqual([{ _id: 'fresh' }]);
    });

    it('опоздавшая старая загрузка не затирает уже готовый новый снимок', async () => {
        const { cache, calls } = makeCache();
        const racing = cache.get();
        await flush();
        cache.invalidate();
        const afterWrite = cache.get();
        await flush();

        calls[1].resolve(data('fresh'));
        await afterWrite;
        calls[0].resolve(data('stale'));
        await racing;

        expect(cache.peek().docs).toEqual([{ _id: 'fresh' }]);
    });

    it('после SOFT_TTL отдаёт снимок как устаревший и обновляет его в фоне', async () => {
        const { cache, clock, load, calls } = makeCache();
        const first = cache.get();
        await flush();
        calls[0].resolve(data('a'));
        const { snapshot: old } = await first;

        clock.time += SOFT_TTL_MS + 1;
        const stale = await cache.get();
        expect(stale.state).toBe('stale');
        expect(stale.snapshot).toBe(old);
        // Второй читатель не запускает вторую загрузку.
        expect((await cache.get()).state).toBe('stale');
        await flush();
        expect(load).toHaveBeenCalledTimes(2);

        calls[1].resolve(data('b'));
        await flush();
        const fresh = await cache.get();
        expect(fresh.state).toBe('hit');
        expect(fresh.snapshot.docs).toEqual([{ _id: 'b' }]);
        // Данные изменились: версия новая, ответы по прежнему снимку не подойдут.
        expect(fresh.snapshot.version).toBeGreaterThan(old.version);
    });

    it('до SOFT_TTL снимок свежий', async () => {
        const { cache, clock, load, calls } = makeCache();
        const first = cache.get();
        await flush();
        calls[0].resolve(data('a'));
        await first;

        clock.time += SOFT_TTL_MS - 1;

        expect((await cache.get()).state).toBe('hit');
        expect(load).toHaveBeenCalledTimes(1);
    });

    it('устаревший снимок отдается сразу при любом возрасте, читатель не ждет базу', async () => {
        const { cache, clock, load, calls } = makeCache();
        const first = cache.get();
        await flush();
        calls[0].resolve(data('a'));
        const { snapshot: old } = await first;

        // Сутки простоя: раньше уже час заставлял ждать синхронную загрузку.
        clock.time += 24 * 60 * MINUTE;
        // Загрузка еще не завершена (calls[1] не выполнен) - ответ все равно готов.
        const stale = await cache.get();

        expect(stale.state).toBe('stale');
        expect(stale.snapshot).toBe(old);
        await flush();
        expect(load).toHaveBeenCalledTimes(2);
    });

    describe('фоновое обновление по возрасту сравнивает данные', () => {
        async function agedCache() {
            const made = makeCache();
            const first = made.cache.get();
            await flush();
            made.calls[0].resolve(data('a'));
            const { snapshot } = await first;
            made.clock.time += SOFT_TTL_MS + 1;
            return { ...made, snapshot };
        }

        it('те же данные: версия и снимок остаются, обновляется только отметка свежести', async () => {
            const { cache, clock, calls, snapshot } = await agedCache();
            const versionBefore = cache.getVersion();
            const sortedBefore = docsByDateDesc(snapshot);

            await cache.get();
            await flush();
            calls[1].resolve(data('a'));
            await flush();

            expect(cache.getVersion()).toBe(versionBefore);
            const again = await cache.get();
            expect(again.state).toBe('hit');
            expect(again.snapshot).toBe(snapshot);
            expect(again.snapshot.version).toBe(snapshot.version);
            expect(again.snapshot.loadedAt).toBe(clock.time);
            // Запомненная сортировка истории не пропала.
            expect(docsByDateDesc(again.snapshot)).toBe(sortedBefore);
        });

        it('те же данные: готовые ответы responseMemo остаются действительными', async () => {
            const { createResponseMemo } = await import('./responseMemo.js');
            const memo = createResponseMemo();
            const { cache, calls } = await agedCache();
            const compute = vi.fn(() => '{"total":1}');
            const key = { month: '2026-08' };
            memo.getJson('dashboard', key, cache.peek().version, compute);

            await cache.get();
            await flush();
            calls[1].resolve(data('a'));
            await flush();
            memo.getJson('dashboard', key, (await cache.get()).snapshot.version, compute);

            expect(compute).toHaveBeenCalledTimes(1);
        });

        it('изменились данные: версия растет, готовые ответы пересчитываются', async () => {
            const { createResponseMemo } = await import('./responseMemo.js');
            const memo = createResponseMemo();
            const { cache, calls, snapshot } = await agedCache();
            const compute = vi.fn(() => '{"total":1}');
            const key = { month: '2026-08' };
            memo.getJson('dashboard', key, snapshot.version, compute);

            await cache.get();
            await flush();
            calls[1].resolve({ docs: [{ _id: 'a', amount: 5 }], accounts: [{ _id: 'acc-a' }] });
            await flush();
            const fresh = (await cache.get()).snapshot;
            memo.getJson('dashboard', key, fresh.version, compute);

            expect(fresh.version).toBeGreaterThan(snapshot.version);
            expect(compute).toHaveBeenCalledTimes(2);
        });

        it('правка скриптом вне сервера (только значение поля) подхватывается после обновления', async () => {
            // Документ тот же, _id и число документов те же, меняется одна сумма:
            // ни счетчик, ни максимальный _id этого бы не увидели.
            const made = makeCache();
            const first = made.cache.get();
            await flush();
            made.calls[0].resolve({ docs: [{ _id: 'x1', amount: 100 }, { _id: 'x2', amount: 200 }], accounts: [{ _id: 'acc' }] });
            await first;

            made.clock.time += SOFT_TTL_MS + 1;
            const stale = await made.cache.get();
            expect(stale.state).toBe('stale');
            expect(stale.snapshot.docs[0].amount).toBe(100);
            await flush();
            made.calls[1].resolve({ docs: [{ _id: 'x1', amount: 150 }, { _id: 'x2', amount: 200 }], accounts: [{ _id: 'acc' }] });
            await flush();

            // Следующий читатель видит правку.
            const next = await made.cache.get();
            expect(next.state).toBe('hit');
            expect(next.snapshot.docs[0].amount).toBe(150);
        });

        it('изменение только в счетах тоже считается изменением', async () => {
            const { cache, calls, snapshot } = await agedCache();

            await cache.get();
            await flush();
            calls[1].resolve({ docs: [{ _id: 'a' }], accounts: [{ _id: 'acc-a', excludeFromTotal: true }] });
            await flush();

            expect(cache.peek().version).toBeGreaterThan(snapshot.version);
            expect(cache.peek().accounts[0].excludeFromTotal).toBe(true);
        });

        it('сравнение не зависит от порядка документов', async () => {
            const made = makeCache();
            const first = made.cache.get();
            await flush();
            made.calls[0].resolve({ docs: [{ _id: 'x1' }, { _id: 'x2' }], accounts: [] });
            const { snapshot } = await first;

            made.clock.time += SOFT_TTL_MS + 1;
            await made.cache.get();
            await flush();
            made.calls[1].resolve({ docs: [{ _id: 'x2' }, { _id: 'x1' }], accounts: [] });
            await flush();

            expect(made.cache.peek()).toBe(snapshot);
        });

        it('изменение только в категориях или только в настройках тоже считается изменением', async () => {
            const full = (overrides = {}) => ({
                docs: [{ _id: 'a' }], accounts: [{ _id: 'acc-a' }],
                categories: [{ _id: 'c1', name: 'Еда', order: 1 }], settings: { monthlyLimit: 5000, integrityError: null },
                ...overrides
            });
            const made = makeCache();
            const first = made.cache.get();
            await flush();
            made.calls[0].resolve(full());
            const { snapshot } = await first;
            expect(snapshot.categories).toEqual([{ _id: 'c1', name: 'Еда', order: 1 }]);
            expect(snapshot.settings).toEqual({ monthlyLimit: 5000, integrityError: null });

            made.clock.time += SOFT_TTL_MS + 1;
            await made.cache.get();
            await flush();
            made.calls[1].resolve(full({ categories: [{ _id: 'c1', name: 'Еда', order: 2 }] }));
            await flush();
            const afterCategory = made.cache.peek();
            expect(afterCategory.version).toBeGreaterThan(snapshot.version);

            made.clock.time += SOFT_TTL_MS + 1;
            await made.cache.get();
            await flush();
            made.calls[2].resolve(full({ categories: [{ _id: 'c1', name: 'Еда', order: 2 }], settings: { monthlyLimit: 6000, integrityError: null } }));
            await flush();
            expect(made.cache.peek().version).toBeGreaterThan(afterCategory.version);
            expect(made.cache.peek().settings.monthlyLimit).toBe(6000);
        });

        it('сообщает подписчикам только о фоновом обновлении, принесшем другие данные', async () => {
            const { cache, clock, calls } = await agedCache();
            const listener = vi.fn();
            const unsubscribe = cache.onRefreshChanged(listener);

            // Те же данные: тишина.
            await cache.get();
            await flush();
            calls[1].resolve(data('a'));
            await flush();
            expect(listener).not.toHaveBeenCalled();

            // Другие данные: один вызов, и снимок в нём уже новый.
            clock.time += SOFT_TTL_MS + 1;
            await cache.get();
            await flush();
            calls[2].resolve(data('b'));
            await flush();
            expect(listener).toHaveBeenCalledTimes(1);
            expect(listener.mock.calls[0][0]).toBe(cache.peek());
            expect(listener.mock.calls[0][0].docs).toEqual([{ _id: 'b' }]);

            // После отписки не вызывается.
            unsubscribe();
            clock.time += SOFT_TTL_MS + 1;
            await cache.get();
            await flush();
            calls[3].resolve(data('c'));
            await flush();
            expect(listener).toHaveBeenCalledTimes(1);
        });

        it('обычная запись и загрузка с нуля подписчиков не будят: прогрев после записи не нужен', async () => {
            const { cache, calls } = await agedCache();
            const listener = vi.fn();
            cache.onRefreshChanged(listener);

            cache.invalidate({ reload: false });
            const reading = cache.get();
            await flush();
            calls[1].resolve(data('z'));
            await reading;

            expect(listener).not.toHaveBeenCalled();
        });

        it('ошибка подписчика не ломает обновление', async () => {
            const { cache, calls, logger } = await agedCache();
            cache.onRefreshChanged(() => { throw new Error('boom'); });

            await cache.get();
            await flush();
            calls[1].resolve(data('b'));
            await flush();

            expect(cache.peek().docs).toEqual([{ _id: 'b' }]);
            expect(logger.warn).toHaveBeenCalled();
        });

        it('запись во время обновления: его результат не ставится, версия записи сохраняется', async () => {
            const { cache, calls } = await agedCache();

            await cache.get();
            await flush();
            cache.invalidate({ reload: false });
            const versionAfterWrite = cache.getVersion();
            // Обновление, начатое до записи, возвращает те же данные, что и были.
            calls[1].resolve(data('a'));
            await flush();

            expect(cache.peek()).toBeNull();
            expect(cache.getVersion()).toBe(versionAfterWrite);
        });
    });

    it('ошибка фоновой перезагрузки по возрасту не ломает устаревший снимок и пишется в лог раз', async () => {
        const { cache, clock, logger, calls } = makeCache();
        const first = cache.get();
        await flush();
        calls[0].resolve(data('a'));
        await first;

        clock.time += SOFT_TTL_MS + 1;
        await cache.get();
        await flush();
        calls[1].reject(new Error('atlas down'));
        await flush();
        await cache.get();
        await flush();
        calls[2].reject(new Error('atlas down'));
        await flush();

        expect(logger.warn).toHaveBeenCalledTimes(1);
        // В логе виден возраст снимка, который продолжает отдаваться.
        expect(logger.warn.mock.calls[0][0]).toMatch(/Снимок отдается устаревшим \(10 мин\)/);
        expect((await cache.get()).snapshot.docs).toEqual([{ _id: 'a' }]);
    });

    it('ошибка загрузки доходит до читателя, и следующий вызов пробует снова', async () => {
        const { cache, load, calls } = makeCache();
        const failing = cache.get();
        await flush();
        calls[0].reject(new Error('boom'));
        await expect(failing).rejects.toThrow('boom');

        const retry = cache.get();
        await flush();
        expect(load).toHaveBeenCalledTimes(2);
        calls[1].resolve(data('a'));
        expect((await retry).snapshot.docs).toEqual([{ _id: 'a' }]);
    });

    it('LEDGER_CACHE=off: каждый вызов читает базу, ничего не запоминая', async () => {
        const load = vi.fn(async () => data('x'));
        const { cache } = makeCache({ load, cache: { isEnabled: () => false } });

        const first = await cache.get();
        const second = await cache.get();

        expect(load).toHaveBeenCalledTimes(2);
        expect(first.state).toBe('off');
        expect(first.snapshot).not.toBe(second.snapshot);
        expect(cache.peek()).toBeNull();
        expect(cache.isEnabled()).toBe(false);
        // Запись при выключенном кэше фоновую загрузку не запускает.
        cache.invalidate();
        await vi.advanceTimersByTimeAsync(RELOAD_DEBOUNCE_MS * 5);
        expect(load).toHaveBeenCalledTimes(2);
    });

    it('isLedgerCacheEnabled читает переменную окружения', () => {
        expect(isLedgerCacheEnabled({})).toBe(true);
        expect(isLedgerCacheEnabled({ LEDGER_CACHE: '' })).toBe(true);
        expect(isLedgerCacheEnabled({ LEDGER_CACHE: 'on' })).toBe(true);
        expect(isLedgerCacheEnabled({ LEDGER_CACHE: 'off' })).toBe(false);
        expect(isLedgerCacheEnabled({ LEDGER_CACHE: ' OFF ' })).toBe(false);
    });

    describe('фоновая перезагрузка после записи', () => {
        async function usedCache() {
            const made = makeCache();
            const first = made.cache.get();
            await flush();
            made.calls[0].resolve(data('a'));
            await first;
            return made;
        }

        it('ждёт паузу и объединяет серию записей в одну загрузку', async () => {
            const { cache, load, calls } = await usedCache();

            cache.invalidate();
            await vi.advanceTimersByTimeAsync(RELOAD_DEBOUNCE_MS - 50);
            cache.invalidate();
            await vi.advanceTimersByTimeAsync(RELOAD_DEBOUNCE_MS - 50);
            cache.invalidate();
            // Каждая запись откладывает загрузку заново.
            expect(load).toHaveBeenCalledTimes(1);

            await vi.advanceTimersByTimeAsync(RELOAD_DEBOUNCE_MS);
            expect(load).toHaveBeenCalledTimes(2);
            calls[1].resolve(data('b'));
            await flush();

            // Читатель находит уже тёплый снимок.
            const warmed = await cache.get();
            expect(warmed.state).toBe('hit');
            expect(warmed.snapshot.docs).toEqual([{ _id: 'b' }]);
            expect(load).toHaveBeenCalledTimes(2);
        });

        it('читатель, пришедший раньше таймера, делит загрузку с фоновой', async () => {
            const { cache, load, calls } = await usedCache();
            cache.invalidate();

            const reader = cache.get();
            await flush();
            await vi.advanceTimersByTimeAsync(RELOAD_DEBOUNCE_MS * 2);
            expect(load).toHaveBeenCalledTimes(2);
            calls[1].resolve(data('b'));

            expect((await reader).snapshot.docs).toEqual([{ _id: 'b' }]);
            expect(load).toHaveBeenCalledTimes(2);
        });

        it('не запускается, если кэшем ещё никто не пользовался', async () => {
            const { cache, load } = makeCache();

            cache.invalidate();
            await vi.advanceTimersByTimeAsync(RELOAD_DEBOUNCE_MS * 5);

            expect(load).not.toHaveBeenCalled();
        });

        it('не запускается при invalidate({ reload: false })', async () => {
            const { cache, load } = await usedCache();

            cache.invalidate({ reload: false });
            await vi.advanceTimersByTimeAsync(RELOAD_DEBOUNCE_MS * 5);

            expect(load).toHaveBeenCalledTimes(1);
        });

        it('откладывается, пока открыта транзакция, и идёт после её завершения', async () => {
            const { cache, load, calls } = await usedCache();

            cache.holdReload();
            cache.invalidate();
            await vi.advanceTimersByTimeAsync(RELOAD_DEBOUNCE_MS * 5);
            expect(load).toHaveBeenCalledTimes(1);

            cache.invalidate({ reload: false });
            cache.releaseReload();
            await vi.advanceTimersByTimeAsync(RELOAD_DEBOUNCE_MS + 1);
            expect(load).toHaveBeenCalledTimes(2);
            calls[1].resolve(data('b'));
            await flush();
            expect(cache.peek().docs).toEqual([{ _id: 'b' }]);
        });

        it('ошибка фоновой загрузки не бросается наружу', async () => {
            const { cache, logger, calls } = await usedCache();

            cache.invalidate();
            await vi.advanceTimersByTimeAsync(RELOAD_DEBOUNCE_MS + 1);
            calls[1].reject(new Error('atlas down'));
            await flush();

            expect(logger.warn).toHaveBeenCalledTimes(1);
            expect(cache.peek()).toBeNull();
        });
    });

    describe('warm', () => {
        it('загружает снимок заранее, и первый читатель получает hit', async () => {
            const { cache, load, calls } = makeCache();

            const warming = cache.warm();
            await flush();
            calls[0].resolve(data('a'));
            await warming;

            expect((await cache.get()).state).toBe('hit');
            expect(load).toHaveBeenCalledTimes(1);
        });

        it('глотает ошибку и пишет её в лог', async () => {
            const { cache, logger, calls } = makeCache();

            const warming = cache.warm();
            await flush();
            calls[0].reject(new Error('atlas down'));

            await expect(warming).resolves.toBeUndefined();
            expect(logger.warn).toHaveBeenCalledTimes(1);
        });

        it('при выключенном кэше ничего не грузит', async () => {
            const load = vi.fn(async () => data('x'));
            const { cache } = makeCache({ load, cache: { isEnabled: () => false } });

            await cache.warm();

            expect(load).not.toHaveBeenCalled();
        });
    });

    it('reset возвращает кэш в исходное состояние и обесценивает идущую загрузку', async () => {
        const { cache, calls } = makeCache();
        const pending = cache.get();
        await flush();

        cache.reset();
        calls[0].resolve(data('a'));
        await pending;

        expect(cache.peek()).toBeNull();
    });
});

describe('fingerprintLedger', () => {
    it('одинаковый для одинаковых данных и разный при любой правке', () => {
        const base = { docs: [{ _id: 'a', amount: 1 }, { _id: 'b', amount: 2 }], accounts: [{ _id: 'c', order: 1 }] };

        expect(fingerprintLedger({ docs: [...base.docs], accounts: [...base.accounts] })).toBe(fingerprintLedger(base));
        expect(fingerprintLedger({ ...base, docs: [{ _id: 'a', amount: 1 }, { _id: 'b', amount: 3 }] })).not.toBe(fingerprintLedger(base));
        expect(fingerprintLedger({ ...base, docs: base.docs.slice(0, 1) })).not.toBe(fingerprintLedger(base));
        expect(fingerprintLedger({ ...base, accounts: [{ _id: 'c', order: 2 }] })).not.toBe(fingerprintLedger(base));
        // Категории и настройки входят в отпечаток.
        const catalog = { ...base, categories: [{ _id: 'k', name: 'Еда', order: 1 }], settings: { monthlyLimit: 7000, integrityError: null } };
        expect(fingerprintLedger({ ...catalog, categories: [{ _id: 'k', name: 'Еда', order: 1 }] })).toBe(fingerprintLedger(catalog));
        expect(fingerprintLedger({ ...catalog, categories: [{ _id: 'k', name: 'Еда', order: 2 }] })).not.toBe(fingerprintLedger(catalog));
        expect(fingerprintLedger({ ...catalog, categories: [] })).not.toBe(fingerprintLedger(catalog));
        expect(fingerprintLedger({ ...catalog, settings: { monthlyLimit: 8000, integrityError: null } })).not.toBe(fingerprintLedger(catalog));
        expect(fingerprintLedger({ ...catalog, settings: { monthlyLimit: null, integrityError: 'несколько наборов' } })).not.toBe(fingerprintLedger(catalog));
        // Документ, перешедший из операций в счета, - не то же самое.
        expect(fingerprintLedger({ docs: [], accounts: [{ _id: 'a' }] })).not.toBe(fingerprintLedger({ docs: [{ _id: 'a' }], accounts: [] }));
    });
});

describe('docsByDateDesc', () => {
    const id = (n) => `65f0c0ffee0123456789ab${String(n).padStart(2, '0')}`;
    const doc = (n, date) => ({ _id: id(n), date });

    it('сортирует по дате по убыванию, а при равной дате - по _id по убыванию', () => {
        const docs = [
            doc(1, new Date('2026-03-01T00:00:00Z')),
            doc(5, new Date('2026-03-03T00:00:00Z')),
            doc(3, new Date('2026-03-03T00:00:00Z')),
            doc(9, new Date('2026-03-02T00:00:00Z'))
        ];

        const sorted = docsByDateDesc({ docs });

        expect(sorted.map(d => d._id)).toEqual([id(5), id(3), id(9), id(1)]);
    });

    it('кладёт документы без даты в конец, как база при сортировке по убыванию', () => {
        const docs = [doc(1, undefined), doc(2, new Date('2026-03-01T00:00:00Z')), doc(3, undefined)];

        expect(docsByDateDesc({ docs }).map(d => d._id)).toEqual([id(2), id(3), id(1)]);
    });

    it('не меняет снимок и запоминает результат на снимок', () => {
        const docs = [doc(1, new Date('2026-03-01T00:00:00Z')), doc(2, new Date('2026-03-02T00:00:00Z'))];
        const snapshot = Object.freeze({ docs: Object.freeze(docs) });

        const first = docsByDateDesc(snapshot);

        expect(first).not.toBe(snapshot.docs);
        expect(docs.map(d => d._id)).toEqual([id(1), id(2)]);
        expect(docsByDateDesc(snapshot)).toBe(first);
    });
});
