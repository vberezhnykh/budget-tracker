import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useAnimatedNumber, { TWEEN_DURATION_MS } from './useAnimatedNumber';

// Свой requestAnimationFrame: кадры идут только по команде advance(ms), время
// задаётся тестом. Реальные таймеры и fake timers не нужны.
let frames;
let nextId;
let clock;
let reduceMotion;

const advance = ms => {
  clock += ms;
  const due = [...frames.entries()];
  frames.clear();
  act(() => { due.forEach(([, callback]) => callback(clock)); });
};

beforeEach(() => {
  frames = new Map();
  nextId = 1;
  clock = 1000;
  reduceMotion = false;
  vi.stubGlobal('matchMedia', query => ({ matches: reduceMotion && query.includes('prefers-reduced-motion'), media: query }));
  vi.stubGlobal('requestAnimationFrame', callback => { frames.set(nextId, callback); return nextId++; });
  vi.stubGlobal('cancelAnimationFrame', id => { frames.delete(id); });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const render = (value, key) => renderHook(({ value, key }) => useAnimatedNumber(value, key), { initialProps: { value, key } });

describe('useAnimatedNumber', () => {
  it('on first render shows the final value without animating', () => {
    const { result } = render(100, 'month');
    expect(result.current).toEqual({ value: 100, animating: false });
    expect(frames.size).toBe(0);
  });

  it('tweens to the new value when the same figure changes', () => {
    const { result, rerender } = render(100, 'month');
    rerender({ value: 200, key: 'month' });

    // Сразу после смены на экране ещё прежнее число, а не итоговое.
    expect(result.current).toEqual({ value: 100, animating: true });

    advance(0);
    advance(TWEEN_DURATION_MS / 2);
    expect(result.current.animating).toBe(true);
    expect(result.current.value).toBeGreaterThan(100);
    expect(result.current.value).toBeLessThan(200);
    // Ease-out: к середине пути пройдено больше половины.
    expect(result.current.value).toBeGreaterThan(150);

    advance(TWEEN_DURATION_MS);
    expect(result.current).toEqual({ value: 200, animating: false });
    expect(frames.size).toBe(0);
  });

  it('does not tween when the key changes (another month or account)', () => {
    const { result, rerender } = render(100, 'october');
    rerender({ value: 500, key: 'november' });
    expect(result.current).toEqual({ value: 500, animating: false });
    expect(frames.size).toBe(0);
  });

  it('does not tween while there is no key, nor on the first update after it appears', () => {
    const { result, rerender } = render(0, null);
    rerender({ value: 300, key: null });
    expect(result.current).toEqual({ value: 300, animating: false });

    // Ключ появился вместе с новым числом (итоги стали готовы): это не обновление.
    rerender({ value: 400, key: 'month' });
    expect(result.current).toEqual({ value: 400, animating: false });

    // А вот следующее изменение при том же ключе - обновление.
    rerender({ value: 450, key: 'month' });
    expect(result.current.animating).toBe(true);
  });

  it('shows the final value at once when reduced motion is requested', () => {
    reduceMotion = true;
    const { result, rerender } = render(100, 'month');
    rerender({ value: 200, key: 'month' });
    expect(result.current).toEqual({ value: 200, animating: false });
    expect(frames.size).toBe(0);
  });

  it('shows the final value at once without matchMedia or requestAnimationFrame', () => {
    vi.stubGlobal('matchMedia', undefined);
    const withoutMatchMedia = render(100, 'month');
    withoutMatchMedia.rerender({ value: 200, key: 'month' });
    expect(withoutMatchMedia.result.current).toEqual({ value: 200, animating: false });

    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    vi.stubGlobal('requestAnimationFrame', undefined);
    const withoutFrames = render(100, 'month');
    withoutFrames.rerender({ value: 200, key: 'month' });
    expect(withoutFrames.result.current).toEqual({ value: 200, animating: false });
  });

  it('continues from the displayed number when a new target arrives mid-tween', () => {
    const { result, rerender } = render(0, 'month');
    rerender({ value: 100, key: 'month' });
    advance(0);
    advance(TWEEN_DURATION_MS / 2);
    const midway = result.current.value;
    expect(midway).toBeGreaterThan(0);

    rerender({ value: 0, key: 'month' });
    // Не прыгнуло ни к старой цели, ни к началу - стоит там, где было.
    expect(result.current).toEqual({ value: midway, animating: true });
    // Старый цикл кадров снят, остался один.
    expect(frames.size).toBe(1);

    advance(0);
    advance(TWEEN_DURATION_MS * 2);
    expect(result.current).toEqual({ value: 0, animating: false });
  });

  it('cancels the pending frame on unmount', () => {
    const { rerender, unmount } = render(100, 'month');
    rerender({ value: 200, key: 'month' });
    expect(frames.size).toBe(1);
    unmount();
    expect(frames.size).toBe(0);
  });
});
