// Откладывает фоновую работу на «тихое» время, чтобы она не мешала отрисовке и
// вводу. Возвращает функцию отмены: после нее fn не вызовется.
// Без requestIdleCallback (Safari) - короткий setTimeout.
export const IDLE_TIMEOUT_MS = 1500;
export const IDLE_FALLBACK_MS = 300;

export function scheduleIdle(fn, { timeout = IDLE_TIMEOUT_MS, fallbackDelay = IDLE_FALLBACK_MS } = {}) {
  let cancelled = false;
  const run = () => {
    if (!cancelled) fn();
  };
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(run, { timeout });
    return () => {
      cancelled = true;
      if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(id);
    };
  }
  const id = setTimeout(run, fallbackDelay);
  return () => {
    cancelled = true;
    clearTimeout(id);
  };
}
