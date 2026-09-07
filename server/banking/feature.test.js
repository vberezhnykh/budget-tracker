// @vitest-environment node
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { isBankingEnabled } = require('./feature');
const { createBankingService } = require('./service');
afterEach(() => vi.unstubAllEnvs());

describe('Banking is explicitly opt-in', () => {
    it('enables only the exact string true, independently of provider credentials', () => {
        expect(isBankingEnabled({})).toBe(false);
        for (const value of ['', 'false', 'TRUE', '1', ' true ', true, false]) expect(isBankingEnabled({ BANKING_ENABLED: value })).toBe(false);
        expect(isBankingEnabled({ ENABLE_BANKING_APPLICATION_ID: 'configured', ENABLE_BANKING_PRIVATE_KEY: 'configured' })).toBe(false);
        expect(isBankingEnabled({ BANKING_ENABLED: 'true' })).toBe(true);
    });

    it.each([undefined, '', 'false'])('never loads configuration, builds a provider or queries scheduled connections when disabled: %s', async value => {
        vi.stubEnv('BANKING_ENABLED', value);
        const configFactory = vi.fn(), providerFactory = vi.fn(), now = vi.fn();
        const service = createBankingService({ configFactory, providerFactory, now });
        expect(await service.runDueSyncs()).toEqual({ checked: 0 });
        expect(service.kickDueSyncs()).toEqual({ status: 'disabled' });
        const actions = [() => service.status(), () => service.connect('boc', '2026-09-01', 'nonce'),
            () => service.completeAuthorization({ code: 'private', state: 'private', browserNonce: 'private' }),
            () => service.syncConnection('private'), () => service.disconnect('private'),
            () => service.mapAccount('private', 'private'), () => service.listReview(), () => service.resolveReview('private', {})];
        for (const action of actions) await expect(action()).rejects.toMatchObject({ status: 404, code: 'BANKING_DISABLED' });
        expect(configFactory).not.toHaveBeenCalled();
        expect(providerFactory).not.toHaveBeenCalled();
        expect(now).not.toHaveBeenCalled();
    });

    it('reads the switch dynamically and still requires provider configuration when enabled', async () => {
        const configFactory = vi.fn(() => null), providerFactory = vi.fn();
        const service = createBankingService({ configFactory, providerFactory });
        vi.stubEnv('BANKING_ENABLED', 'false');
        await expect(service.syncConnection('id')).rejects.toMatchObject({ code: 'BANKING_DISABLED' });
        vi.stubEnv('BANKING_ENABLED', 'true');
        await expect(service.syncConnection('id')).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
        expect(configFactory).toHaveBeenCalledTimes(1);
        expect(providerFactory).not.toHaveBeenCalled();
    });
});
