import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AnimatedMoney from './AnimatedMoney';

const format = value => `€${Math.round(value)}`;

let callbacks;

beforeEach(() => {
  callbacks = [];
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.stubGlobal('requestAnimationFrame', callback => callbacks.push(callback));
  vi.stubGlobal('cancelAnimationFrame', () => { });
});

afterEach(() => vi.unstubAllGlobals());

describe('AnimatedMoney', () => {
  it('renders plain text when nothing is animating', () => {
    const { container } = render(<span data-testid="host"><AnimatedMoney value={50} valueKey="a" format={format} /></span>);
    expect(screen.getByTestId('host').textContent).toBe('€50');
    expect(container.querySelector('[aria-hidden]')).toBeNull();
  });

  it('hides the running digits from screen readers and keeps the final value readable', () => {
    const { rerender } = render(<span data-testid="host"><AnimatedMoney value={0} valueKey="a" format={format} /></span>);
    rerender(<span data-testid="host"><AnimatedMoney value={100} valueKey="a" format={format} /></span>);
    act(() => callbacks.shift()(0));

    const host = screen.getByTestId('host');
    expect(host.querySelector('[aria-hidden="true"]').textContent).toBe('€0');
    expect(host.querySelector('.visually-hidden').textContent).toBe('€100');
  });
});
