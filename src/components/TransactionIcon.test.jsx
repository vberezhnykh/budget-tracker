import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { cleanup, fireEvent, render } from '@testing-library/react';
import TransactionIcon from './TransactionIcon';

const publishableKey = 'pk_test_transaction_icons';
const expense = { type: 'expense', description: 'Wolt', category: 'Продукты' };

// Vitest does not inject imported CSS by default. Use the component's actual
// stylesheet so visibility assertions catch accidentally revealing pending images.
const stylesheet = document.createElement('style');
beforeAll(() => {
  stylesheet.textContent = readFileSync('src/components/TransactionIcon.css', 'utf8');
  document.head.append(stylesheet);
});
afterAll(() => stylesheet.remove());
beforeEach(() => vi.stubEnv('VITE_LOGO_DEV_PUBLISHABLE_KEY', publishableKey));
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('remote transaction icons', () => {
  it('shows the category immediately and requests a hidden, lazy logo with a stable URL', () => {
    const { container, rerender } = render(<TransactionIcon item={expense} />);
    const avatar = container.firstElementChild;
    const logo = container.querySelector('img');
    const url = new URL(logo.src);

    expect(avatar).toHaveAttribute('data-transaction-icon', 'groceries');
    expect(avatar).toHaveAttribute('data-logo-state', 'loading');
    expect(container.querySelector('svg')).toBeVisible();
    expect(logo).not.toBeVisible();
    expect(logo).toHaveAttribute('loading', 'lazy');
    expect(logo).toHaveAttribute('decoding', 'async');
    expect(logo).toHaveAttribute('referrerpolicy', 'origin');
    expect(url.origin).toBe('https://img.logo.dev');
    expect(url.pathname).toBe('/wolt.com');
    expect(url.searchParams.get('token')).toBe(publishableKey);
    expect(url.searchParams.get('fallback')).toBe('404');

    rerender(<TransactionIcon item={{ ...expense, amount: 35, account: 'another-account' }} />);
    expect(container.querySelector('img')).toBe(logo);
    expect(logo.src).toBe(url.href);
  });

  it('replaces the fallback only once the logo loads and keeps the avatar decorative', () => {
    const { container } = render(<TransactionIcon item={expense} />);
    const logo = container.querySelector('img');
    fireEvent.load(logo);

    expect(container.firstElementChild).toHaveAttribute('data-logo-state', 'loaded');
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
    expect(logo).toHaveAttribute('alt', '');
    expect(logo).toBeVisible();
    expect(container.querySelector('svg')).toBeNull();
  });

  it('removes a failed image and retains the category without retrying on unrelated renders', () => {
    const { container, rerender } = render(<TransactionIcon item={expense} />);
    fireEvent.error(container.querySelector('img'));

    expect(container.firstElementChild).toHaveAttribute('data-logo-state', 'error');
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).toBeVisible();
    rerender(<TransactionIcon item={{ ...expense, amount: 50 }} />);
    expect(container.querySelector('img')).toBeNull();
  });

  it('resets failed and loaded states when the visible merchant changes', () => {
    const { container, rerender } = render(<TransactionIcon item={expense} />);
    fireEvent.error(container.querySelector('img'));

    rerender(<TransactionIcon item={{ ...expense, description: 'Zara' }} />);
    const zaraLogo = container.querySelector('img');
    expect(container.firstElementChild).toHaveAttribute('data-logo-state', 'loading');
    expect(new URL(zaraLogo.src).pathname).toBe('/zara.com');
    expect(zaraLogo).not.toBeVisible();
    fireEvent.load(zaraLogo);
    expect(zaraLogo).toBeVisible();

    rerender(<TransactionIcon item={{ ...expense, description: 'McDonald’s' }} />);
    expect(container.querySelector('img')).not.toBe(zaraLogo);
    expect(container.firstElementChild).toHaveAttribute('data-logo-state', 'loading');
    expect(container.querySelector('img')).not.toBeVisible();
    expect(container.querySelector('svg')).toBeVisible();
  });

  it('makes no image request without a valid publishable key, even for a bundled merchant', () => {
    for (const key of [undefined, '', 'invalid-key', 'pk_', 'sk_test_secret']) {
      vi.stubEnv('VITE_LOGO_DEV_PUBLISHABLE_KEY', key);
      const { container, unmount } = render(<TransactionIcon item={expense} />);
      expect(container.firstElementChild).toHaveAttribute('data-logo-state', 'disabled');
      expect(container.firstElementChild).toHaveAttribute('data-transaction-icon', 'groceries');
      expect(container.querySelector('img')).toBeNull();
      expect(container.querySelector('svg')).toBeVisible();
      expect(container.querySelector('[style*="url("]')).toBeNull();
      unmount();
    }
  });

  it('never requests merchant logos for income, transfers, initial balances or split groups', () => {
    for (const type of ['income', 'transfer', 'initial', 'split_group']) {
      const { container, unmount } = render(<TransactionIcon item={{ ...expense, type }} />);
      expect(container.firstElementChild).toHaveAttribute('data-transaction-icon', type);
      expect(container.firstElementChild).toHaveAttribute('data-logo-state', 'disabled');
      expect(container.querySelector('img')).toBeNull();
      expect(container.querySelector('svg')).toBeVisible();
      unmount();
    }
  });
});
