export const DASHBOARD_FRESH_MS = 60_000;

// Per-App, memory-only cache. Clearing also invalidates pending reads: a
// response from before a write/logout must never repopulate the cache.
export function createDashboardCache(maxEntries = 24) {
  const values = new Map();
  const pending = new Map();
  let version = 0;
  return {
    get version() { return version; },
    get: key => values.get(key),
    snapshot: () => Object.fromEntries(values),
    clear() {
      version += 1;
      values.clear();
      pending.clear();
    },
    load(key, loader) {
      if (pending.has(key)) return pending.get(key);
      const epoch = version;
      const promise = Promise.resolve().then(loader).then(data => {
        if (epoch === version) {
          values.delete(key);
          values.set(key, { data, updatedAt: Date.now() });
          while (values.size > maxEntries) values.delete(values.keys().next().value);
        }
        return data;
      }).finally(() => {
        if (pending.get(key) === promise) pending.delete(key);
      });
      pending.set(key, promise);
      return promise;
    },
  };
}
