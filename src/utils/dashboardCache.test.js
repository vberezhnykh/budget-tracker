import { describe, it, expect, vi } from 'vitest';
import { createDashboardCache } from './dashboardCache';

describe('dashboard cache', () => {
  it('deduplicates pending requests and allows retry after an error', async () => {
    const cache = createDashboardCache();
    const loader = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ total: 12 });
    const first = cache.load('card', loader);
    expect(cache.load('card', loader)).toBe(first);
    await expect(first).rejects.toThrow('offline');
    expect(cache.get('card')).toBeUndefined();
    await cache.load('card', loader);
    expect(loader).toHaveBeenCalledTimes(2);
    expect(cache.get('card').data).toEqual({ total: 12 });
  });

  it('cannot restore old data or discard a new request after invalidation', async () => {
    const cache = createDashboardCache();
    let resolveOld, resolveNew;
    const old = cache.load('card', () => new Promise(resolve => { resolveOld = resolve; }));
    await Promise.resolve();
    cache.clear();
    const current = cache.load('card', () => new Promise(resolve => { resolveNew = resolve; }));
    await Promise.resolve();
    resolveOld({ total: 100 });
    await old;
    expect(cache.get('card')).toBeUndefined();
    expect(cache.load('card', vi.fn())).toBe(current);
    resolveNew({ total: 125 });
    await current;
    expect(cache.get('card').data.total).toBe(125);
    cache.clear();
    expect(cache.snapshot()).toEqual({});
  });

  it('bounds retained summaries', async () => {
    const cache = createDashboardCache(2);
    await cache.load('old', () => 1);
    await cache.load('second', () => 2);
    await cache.load('third', () => 3);
    expect(Object.keys(cache.snapshot())).toEqual(['second', 'third']);
  });
});
