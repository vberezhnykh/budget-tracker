// @vitest-environment node
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { classifyClaudeError, createClaudeGate, createClaudeSender, isApiKeyConfigured, parseDay } from './claudeClient.js';

const Anthropic = createRequire(import.meta.url)('@anthropic-ai/sdk');

const fakeResponse = () => {
    const res = { status: vi.fn(() => res), json: vi.fn(() => res), set: vi.fn(() => res) };
    return res;
};

describe('isApiKeyConfigured', () => {
    it('нужен непустой ключ', () => {
        expect(isApiKeyConfigured({})).toBe(false);
        expect(isApiKeyConfigured({ ANTHROPIC_API_KEY: ' ' })).toBe(false);
        expect(isApiKeyConfigured({ ANTHROPIC_API_KEY: 'sk-ant-1' })).toBe(true);
    });
});

describe('parseDay', () => {
    it('настоящий день календаря', () => {
        expect(parseDay('2026-10-12')).toBe(Date.UTC(2026, 9, 12));
        expect(parseDay('2024-02-29')).not.toBeNull();
        expect(parseDay('2026-02-29')).toBeNull();
        expect(parseDay('2026-13-01')).toBeNull();
        expect(parseDay('2026-1-1')).toBeNull();
        expect(parseDay(20261012)).toBeNull();
    });
});

describe('classifyClaudeError', () => {
    it('время, ограничение частоты, остальное', () => {
        expect(classifyClaudeError(new Anthropic.APIConnectionTimeoutError())).toBe('timeout');
        expect(classifyClaudeError(new Error('abort'), { aborted: true })).toBe('timeout');
        expect(classifyClaudeError(Object.assign(new Error('rate'), { status: 429 }))).toBe('rate_limit');
        expect(classifyClaudeError(new Error('boom'))).toBe('failed');
        expect(classifyClaudeError(undefined)).toBe('failed');
    });
});

describe('createClaudeSender', () => {
    it('подменённый createMessage используется как есть', () => {
        const createMessage = vi.fn();
        expect(createClaudeSender({ createMessage, getApiKey: () => 'k' })).toBe(createMessage);
    });
});

describe('createClaudeGate', () => {
    const codes = { unavailable: 'X_UNAVAILABLE', rateLimited: 'X_LIMITED' };
    const options = { kind: 'a', limit: 1, unavailable: 'нет ключа', limited: 'лимит' };

    it('ключ, частота и дневной потолок; счёт отдельный у каждого вида', () => {
        let time = Date.UTC(2026, 9, 12, 23, 0);
        const gate = createClaudeGate({ getApiKey: () => 'k', rateLimiter: () => true, now: () => time, codes });
        const req = { ip: '1.1.1.1' };

        expect(gate.admit(req, fakeResponse(), options)).toBe(true);
        gate.count('a');
        const res = fakeResponse();
        expect(gate.admit(req, res, options)).toBe(false);
        expect(res.status).toHaveBeenCalledWith(429);
        expect(res.json).toHaveBeenCalledWith({ code: 'X_LIMITED', message: 'лимит' });
        // Другой вид не задет
        expect(gate.admit(req, fakeResponse(), { ...options, kind: 'b' })).toBe(true);
        time = Date.UTC(2026, 9, 13, 0, 1);
        expect(gate.admit(req, fakeResponse(), options)).toBe(true);
    });

    it('без ключа 503, при частых запросах 429 с Retry-After', () => {
        const noKey = fakeResponse();
        expect(createClaudeGate({ getApiKey: () => '', rateLimiter: () => true, codes }).admit({}, noKey, options)).toBe(false);
        expect(noKey.status).toHaveBeenCalledWith(503);
        expect(noKey.json).toHaveBeenCalledWith({ code: 'X_UNAVAILABLE', message: 'нет ключа' });

        const busy = fakeResponse();
        expect(createClaudeGate({ getApiKey: () => 'k', rateLimiter: () => false, codes }).admit({}, busy, options)).toBe(false);
        expect(busy.set).toHaveBeenCalledWith('Retry-After', '60');
        expect(busy.status).toHaveBeenCalledWith(429);
    });
});
