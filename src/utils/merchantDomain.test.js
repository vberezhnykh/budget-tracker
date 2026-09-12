import { describe, expect, it } from 'vitest';
import { normalizeMerchantDomain } from './merchantDomain';

describe('manual company website', () => {
  it('accepts a pasted website and stores only its normalized hostname', () => {
    expect(normalizeMerchantDomain(' https://WOLT.com/en/discover?city=1#top ')).toBe('wolt.com');
    expect(normalizeMerchantDomain('wolt.com/en')).toBe('wolt.com');
    expect(normalizeMerchantDomain('https://пример.рф')).toBe('xn--e1afmkfd.xn--p1ai');
  });

  it('rejects local addresses, credentials, ports and malformed input', () => {
    for (const value of ['', 'Chop Chop', 'localhost', '127.0.0.1', '0x7f000001', '[::1]',
      'company.local', 'company.test', 'https://user:pass@wolt.com', 'wolt.com:5000',
      'javascript:alert(1)', 'https://-bad.com', `https://${'a'.repeat(64)}.com`, null]) {
      expect(normalizeMerchantDomain(value), String(value)).toBe('');
    }
  });
});
