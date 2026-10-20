import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import useFadeIn from './useFadeIn';

describe('useFadeIn', () => {
  it('gives no class to a block that opened with data already there', () => {
    const { result, rerender } = renderHook(({ waiting }) => useFadeIn(waiting), { initialProps: { waiting: false } });
    expect(result.current).toBe('');
    rerender({ waiting: false });
    expect(result.current).toBe('');
  });

  it('gives the class once the skeleton is replaced, and keeps it through refreshes', () => {
    const { result, rerender } = renderHook(({ waiting }) => useFadeIn(waiting), { initialProps: { waiting: true } });
    expect(result.current).toBe('');
    rerender({ waiting: false });
    expect(result.current).toBe('fade-in');
    // Перерисовка с теми же данными класс не меняет - анимация не стартует заново.
    rerender({ waiting: false });
    expect(result.current).toBe('fade-in');
  });

  it('plays again after a new wait (another account), but not before it', () => {
    const { result, rerender } = renderHook(({ waiting }) => useFadeIn(waiting), { initialProps: { waiting: false } });
    rerender({ waiting: true });
    expect(result.current).toBe('');
    rerender({ waiting: false });
    expect(result.current).toBe('fade-in');
  });

  it('returns the flat variant on request', () => {
    const { result, rerender } = renderHook(({ waiting }) => useFadeIn(waiting, { flat: true }), { initialProps: { waiting: true } });
    rerender({ waiting: false });
    expect(result.current).toBe('fade-in fade-in--flat');
  });
});
