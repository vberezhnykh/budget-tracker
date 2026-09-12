// The browser only sends the hostname to our API and to Logo.dev. Never use a
// user-supplied URL as an image source or a fetch target.
export function normalizeMerchantDomain(value) {
  if (typeof value !== 'string') return '';
  const input = value.trim();
  if (!input || input.length > 500 || /\s/.test(input)) return '';
  try {
    const url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return '';
    const host = url.hostname.toLowerCase();
    if (host.length > 253 || !host.includes('.') || /^\d+(?:\.\d+){3}$/.test(host)
      || /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|example|onion)$/.test(host)) return '';
    const labels = host.split('.');
    if (!labels.every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
      || !/^(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/.test(labels.at(-1))) return '';
    return host;
  } catch { return ''; }
}
