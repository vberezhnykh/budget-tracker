import { afterEach, describe, expect, it, vi } from 'vitest';
import { scheduleIdle } from './prefetch';

describe('scheduleIdle', () => {
  const original = { request: window.requestIdleCallback, cancel: window.cancelIdleCallback };
  afterEach(() => {
    vi.useRealTimers();
    window.requestIdleCallback = original.request;
    window.cancelIdleCallback = original.cancel;
  });

  it('falls back to a short timer without requestIdleCallback and can be cancelled', () => {
    vi.useFakeTimers();
    delete window.requestIdleCallback;
    const fn = vi.fn();
    scheduleIdle(fn);
    vi.advanceTimersByTime(299);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);

    const cancelled = vi.fn();
    const cancel = scheduleIdle(cancelled);
    cancel();
    vi.advanceTimersByTime(1000);
    expect(cancelled).not.toHaveBeenCalled();
  });

  it('uses requestIdleCallback with a timeout and cancels it', () => {
    let callback;
    window.requestIdleCallback = vi.fn((cb) => { callback = cb; return 7; });
    window.cancelIdleCallback = vi.fn();
    const fn = vi.fn();
    const cancel = scheduleIdle(fn);
    expect(window.requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), { timeout: 1500 });
    cancel();
    expect(window.cancelIdleCallback).toHaveBeenCalledWith(7);
    callback();
    expect(fn).not.toHaveBeenCalled();

    scheduleIdle(fn);
    callback();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
