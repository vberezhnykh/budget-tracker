// @vitest-environment node

import { describe, it, expect, vi } from 'vitest';
import { createResponseMemo, sendJson, GROUP_LIMITS } from './responseMemo.js';

describe('responseMemo', () => {
    it('считает ответ один раз на ключ и версию снимка', () => {
        const memo = createResponseMemo();
        const compute = vi.fn(() => '{"a":1}');

        expect(memo.getJson('dashboard', { month: '2026-08' }, 1, compute)).toBe('{"a":1}');
        expect(memo.getJson('dashboard', { month: '2026-08' }, 1, compute)).toBe('{"a":1}');

        expect(compute).toHaveBeenCalledTimes(1);
        expect(memo.stats()).toEqual({ hits: 1, misses: 1, computes: 1 });
    });

    it('разные параметры - разные ответы', () => {
        const memo = createResponseMemo();
        const compute = vi.fn(() => 'x');

        memo.getJson('dashboard', { month: '2026-08', account: null }, 1, compute);
        memo.getJson('dashboard', { month: '2026-08', account: 'type:card' }, 1, compute);
        memo.getJson('history', { month: '2026-08', account: null }, 1, compute);

        expect(compute).toHaveBeenCalledTimes(3);
    });

    it('ответ старой версии снимка не отдаётся никогда', () => {
        const memo = createResponseMemo();
        memo.getJson('dashboard', { m: 1 }, 1, () => 'old');

        expect(memo.getJson('dashboard', { m: 1 }, 2, () => 'new')).toBe('new');
        // Старая запись вытеснена новой версией, а не лежит рядом.
        expect(memo.size()).toBe(1);
        expect(memo.getJson('dashboard', { m: 1 }, 2, () => 'unused')).toBe('new');
    });

    it('запрос со снимком старее уже виденного считается, но не запоминается', () => {
        const memo = createResponseMemo();
        memo.getJson('dashboard', { m: 1 }, 5, () => 'fresh');
        const compute = vi.fn(() => 'late');

        expect(memo.getJson('dashboard', { m: 2 }, 4, compute)).toBe('late');
        expect(memo.getJson('dashboard', { m: 2 }, 4, compute)).toBe('late');

        expect(compute).toHaveBeenCalledTimes(2);
        expect(memo.size()).toBe(1);
        expect(memo.getJson('dashboard', { m: 1 }, 5, () => 'unused')).toBe('fresh');
    });

    it('держит предел группы и вытесняет самую давнюю по обращению запись', () => {
        const memo = createResponseMemo({ limits: { history: 3 } });
        for (const key of ['a', 'b', 'c']) memo.getJson('history', { key }, 1, () => key);
        // Обращение к «a» делает её свежей, поэтому вытеснена будет «b».
        memo.getJson('history', { key: 'a' }, 1, () => 'unused');

        memo.getJson('history', { key: 'd' }, 1, () => 'd');

        expect(memo.sizeOf('history')).toBe(3);
        const compute = vi.fn(() => 'recomputed');
        expect(memo.getJson('history', { key: 'a' }, 1, compute)).toBe('a');
        expect(memo.getJson('history', { key: 'c' }, 1, compute)).toBe('c');
        expect(memo.getJson('history', { key: 'd' }, 1, compute)).toBe('d');
        expect(memo.getJson('history', { key: 'b' }, 1, compute)).toBe('recomputed');
    });

    it('история и сводка вытесняют друг друга отдельно, суммарно не больше 40', () => {
        const memo = createResponseMemo();
        for (let i = 0; i < 100; i += 1) memo.getJson('history', { i }, 1, () => 'h');
        for (let i = 0; i < 100; i += 1) memo.getJson('dashboard', { i }, 1, () => 'd');

        expect(memo.sizeOf('history')).toBe(GROUP_LIMITS.history);
        expect(memo.sizeOf('dashboard')).toBe(GROUP_LIMITS.dashboard);
        expect(memo.size()).toBeLessThanOrEqual(40);
    });

    it('неизвестную группу отвергает', () => {
        expect(() => createResponseMemo().getJson('nope', {}, 1, () => 'x')).toThrow(/группа/);
    });
});

describe('sendJson', () => {
    it('ставит Content-Type, как res.json, и отправляет строку', () => {
        const headers = {};
        const res = {
            get: name => headers[name],
            set: (name, value) => { headers[name] = value; },
            send: vi.fn(body => body)
        };

        sendJson(res, '{"a":1}');

        expect(headers['Content-Type']).toBe('application/json');
        expect(res.send).toHaveBeenCalledWith('{"a":1}');
    });

    it('не перетирает уже выставленный Content-Type', () => {
        const headers = { 'Content-Type': 'application/problem+json' };
        const res = { get: name => headers[name], set: vi.fn(), send: vi.fn() };

        sendJson(res, '{}');

        expect(res.set).not.toHaveBeenCalled();
    });
});
