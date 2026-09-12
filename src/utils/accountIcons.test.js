import { describe, expect, it } from 'vitest';
import { ACCOUNT_ICON_OPTIONS, resolveAccountIcon } from './accountIcons';

describe('account icon compatibility', () => {
  it('keeps every supported saved icon ID', () => {
    for (const { id } of ACCOUNT_ICON_OPTIONS) expect(resolveAccountIcon(id, 'cash')).toBe(id);
  });

  it.each([
    ['💳', 'credit-card'], ['💵', 'banknote'], ['🏠', 'house'],
    ['🏦', 'landmark'], ['🗄️', 'vault'], ['🔒', 'lock-keyhole'],
  ])('maps the stored emoji %s to %s without requiring a migration', (legacy, expected) => {
    expect(resolveAccountIcon(legacy)).toBe(expected);
  });

  it('uses the account type when an icon is missing or unknown', () => {
    expect(resolveAccountIcon(undefined, 'cash')).toBe('banknote');
    expect(resolveAccountIcon('custom old emoji', 'card')).toBe('credit-card');
    expect(resolveAccountIcon('toString', 'card')).toBe('credit-card');
  });
});
