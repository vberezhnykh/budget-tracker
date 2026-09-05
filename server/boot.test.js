import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import {
    DEFAULT_PORT,
    closeHttpServer,
    loadServerEnv,
    parsePort,
    serverEnvPath,
    START_CANCELLED,
    startAfterDependencies
} from './boot.js';

describe('boot helpers', () => {
    it('resolves the environment file from the server module directory', () => {
        expect(serverEnvPath('C:/repo/server')).toBe(path.join('C:/repo/server', '.env'));

        const dotenv = { config: vi.fn(() => ({ parsed: {} })) };
        loadServerEnv(dotenv, 'C:/repo/server');
        expect(dotenv.config).toHaveBeenCalledWith({ path: path.join('C:/repo/server', '.env') });
    });

    it('uses port 5000 by default and rejects invalid values', () => {
        expect(parsePort()).toBe(DEFAULT_PORT);
        expect(parsePort('5001')).toBe(5001);
        for (const value of ['abc', '0', '-1', '65536', '1.5']) {
            expect(() => parsePort(value)).toThrow(/PORT/);
        }
    });

    it('connects and seeds before it asks the HTTP server to listen', async () => {
        const calls = [];
        const server = { close: vi.fn(callback => callback()) };
        const result = await startAfterDependencies({
            connect: async () => calls.push('connect'),
            seed: async () => calls.push('seed'),
            listen: () => { calls.push('listen'); return server; }
        });

        expect(result).toBe(server);
        expect(calls).toEqual(['connect', 'seed', 'listen']);
    });

    it('does not listen when connect fails', async () => {
        const listen = vi.fn();
        await expect(startAfterDependencies({
            connect: async () => { throw new Error('mongo down'); },
            seed: vi.fn(),
            listen
        })).rejects.toThrow('mongo down');
        expect(listen).not.toHaveBeenCalled();
    });

    it('does not listen when shutdown is requested during connect or seed', async () => {
        const listen = vi.fn();
        const onCancelled = vi.fn(async () => {});
        let cancelled = false;
        await expect(startAfterDependencies({
            connect: async () => { cancelled = true; },
            seed: vi.fn(),
            listen,
            isCancelled: () => cancelled,
            onCancelled
        })).rejects.toThrow(START_CANCELLED);
        expect(listen).not.toHaveBeenCalled();
        expect(onCancelled).toHaveBeenCalledTimes(1);

        cancelled = false;
        await expect(startAfterDependencies({
            connect: vi.fn(),
            seed: async () => { cancelled = true; },
            listen,
            isCancelled: () => cancelled,
            onCancelled
        })).rejects.toThrow(START_CANCELLED);
        expect(listen).not.toHaveBeenCalled();
        expect(onCancelled).toHaveBeenCalledTimes(2);
    });

    it('closes the server if shutdown arrives while listen is resolving', async () => {
        let cancelled = false;
        const server = { close: vi.fn(callback => callback()) };
        const closeServer = vi.fn(async value => value.close(() => {}));
        const onCancelled = vi.fn(async () => {});
        await expect(startAfterDependencies({
            connect: vi.fn(),
            seed: vi.fn(),
            listen: async () => { cancelled = true; return server; },
            isCancelled: () => cancelled,
            closeServer,
            onCancelled
        })).rejects.toThrow(START_CANCELLED);
        expect(closeServer).toHaveBeenCalledWith(server);
        expect(onCancelled).toHaveBeenCalledTimes(1);
    });

    it('closes an HTTP server through its callback', async () => {
        const server = { close: vi.fn(callback => callback()) };
        await closeHttpServer(server);
        expect(server.close).toHaveBeenCalledTimes(1);
    });

    it('forces close after the graceful shutdown deadline', async () => {
        const closeAllConnections = vi.fn();
        const server = { close: vi.fn(() => {}), closeAllConnections };
        await expect(closeHttpServer(server, { timeoutMs: 5 })).rejects.toThrow(/срок закрытия/);
        expect(closeAllConnections).toHaveBeenCalledTimes(1);
    });
});
