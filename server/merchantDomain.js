const { domainToASCII } = require('node:url');

const PRIVATE_SUFFIXES = new Set([
    'localhost', 'local', 'internal', 'lan', 'home', 'test', 'invalid', 'example', 'onion'
]);

// Persist a company hostname, never an arbitrary image URL. The image host is
// chosen by the application; schemes, paths, credentials and local names have
// no place in this field. International domains may use their ASCII IDN form.
function normalizeMerchantDomain(raw) {
    if (typeof raw !== 'string') return null;
    const domain = raw.trim().toLowerCase();
    if (domain.length > 253 || !/^[a-z0-9.-]+$/.test(domain)) return null;
    const labels = domain.split('.');
    if (labels.length < 2 || labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
        return null;
    }
    const suffix = labels.at(-1);
    if (PRIVATE_SUFFIXES.has(suffix) || !/^(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/.test(suffix)) return null;
    if (domainToASCII(domain) !== domain) return null;
    return domain;
}

module.exports = { normalizeMerchantDomain };
