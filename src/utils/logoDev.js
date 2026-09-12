import { getTransactionBrandName } from './transactionIcons';

// A verified domain avoids ambiguous name-search hits for known brands.
// These still load from Logo.dev; no local merchant artwork is imported.
const BRAND_DOMAINS = {
  wolt: 'wolt.com', zara: 'zara.com', mcdonalds: 'mcdonalds.com',
  openai: 'openai.com', google: 'google.com', lidl: 'lidl.com',
  ikea: 'ikea.com', netflix: 'netflix.com', spotify: 'spotify.com',
};

export function getTransactionLogoUrl(item, key = import.meta.env.VITE_LOGO_DEV_PUBLISHABLE_KEY) {
  const token = typeof key === 'string' ? key.trim() : '';
  // Never send a secret key or issue failing requests before configuration.
  if (!/^pk_[a-zA-Z0-9_-]+$/.test(token)) return null;
  const name = getTransactionBrandName(item);
  if (!name) return null;

  const params = new URLSearchParams({
    token, size: '80', format: 'webp', theme: 'light', fallback: '404',
  });
  // A stable URL lets the browser reuse Logo.dev's normal HTTP cache across
  // rows, searches and app visits. No cache-busting timestamps or downloads.
  const domain = Object.hasOwn(BRAND_DOMAINS, name) ? BRAND_DOMAINS[name] : null;
  const path = domain || `name/${encodeURIComponent(name)}`;
  return `https://img.logo.dev/${path}?${params}`;
}
