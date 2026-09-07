// @vitest-environment node
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { TIME_ZONE, HOURS, MIN_INTERVAL, inSyncWindow, nextSyncTime } = require('./schedule');

describe('bank reading windows in Europe/Bucharest', () => {
    it('uses the agreed daytime schedule and six elapsed hours between calls', () => {
        expect(TIME_ZONE).toBe('Europe/Bucharest');
        expect(HOURS).toEqual([8, 14, 20]);
        expect(MIN_INTERVAL).toBe(6 * 60 * 60 * 1000);
    });

    it.each([
        ['2026-09-07T04:59:59.999Z', false], // 07:59 local
        ['2026-09-07T05:00:00.000Z', true], // 08:00 local
        ['2026-09-07T05:59:59.999Z', true], // delayed morning trigger
        ['2026-09-07T06:00:00.000Z', false],
        ['2026-09-07T11:00:00.000Z', true], // 14:00 local
        ['2026-09-07T17:00:00.000Z', true], // 20:00 local
        ['2026-09-07T17:59:59.999Z', true],
        ['2026-09-07T18:00:00.000Z', false],
        ['2026-09-07T23:00:00.000Z', false],
        ['2026-01-07T05:00:00.000Z', false], // winter 07:00 local
        ['2026-01-07T06:00:00.000Z', true], // winter 08:00 local
        ['2026-01-07T12:00:00.000Z', true], // winter 14:00 local
        ['2026-01-07T18:00:00.000Z', true], // winter 20:00 local
        ['2026-01-07T19:00:00.000Z', false],
    ])('classifies %s as daytime window=%s', (instant, expected) => {
        expect(inSyncWindow(new Date(instant))).toBe(expected);
    });

    it.each([
        ['2026-09-07T05:00:00.000Z', '2026-09-07T11:00:00.000Z'],
        ['2026-09-07T11:00:00.000Z', '2026-09-07T17:00:00.000Z'],
        ['2026-09-07T17:00:00.000Z', '2026-09-08T05:00:00.000Z'],
        ['2026-09-07T05:37:00.000Z', '2026-09-07T11:37:00.000Z'],
        ['2026-09-07T11:59:59.999Z', '2026-09-07T17:59:59.999Z'],
        ['2026-09-07T06:05:00.000Z', '2026-09-07T17:00:00.000Z'],
        ['2026-09-07T22:00:00.000Z', '2026-09-08T05:00:00.000Z'],
        ['2026-01-07T18:00:00.000Z', '2026-01-08T06:00:00.000Z'],
    ])('next time after %s is %s without an early or night call', (attempt, expected) => {
        const next = nextSyncTime(attempt);
        expect(next.toISOString()).toBe(expected);
        expect(next.getTime() - Date.parse(attempt)).toBeGreaterThanOrEqual(MIN_INTERVAL);
        expect(inSyncWindow(next)).toBe(true);
    });

    it('keeps local 08:00 through the spring clock change', () => {
        const attempt = new Date('2026-03-28T18:00:00.000Z'); // Saturday 20:00 EET
        const next = nextSyncTime(attempt);
        expect(next.toISOString()).toBe('2026-03-29T05:00:00.000Z'); // Sunday 08:00 EEST
        expect(next - attempt).toBe(11 * 60 * 60 * 1000);
        expect(inSyncWindow(new Date('2026-03-29T04:59:59.999Z'))).toBe(false);
        expect(inSyncWindow(next)).toBe(true);
    });

    it('keeps local 08:00 through the autumn clock change', () => {
        const attempt = new Date('2026-10-24T17:00:00.000Z'); // Saturday 20:00 EEST
        const next = nextSyncTime(attempt);
        expect(next.toISOString()).toBe('2026-10-25T06:00:00.000Z'); // Sunday 08:00 EET
        expect(next - attempt).toBe(13 * 60 * 60 * 1000);
        expect(inSyncWindow(new Date('2026-10-25T05:00:00.000Z'))).toBe(false);
        expect(inSyncWindow(next)).toBe(true);
    });
});
