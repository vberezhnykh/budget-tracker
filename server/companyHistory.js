const { normalizeMerchantDomain } = require('./merchantDomain');

const keyOf = value => String(value || '').normalize('NFKC').toLowerCase().trim()
    .replace(/\s+/gu, ' ').replace(/\s*&\s*/gu, ' & ').trim();

// Return at most eight distinct explicit logo choices, not the ledger.
function companyHistory(docs, companies, query = '') {
    const saved = new Set(companies.map(company => keyOf(company.name)));
    const choices = new Map();
    for (const doc of docs) {
        if (doc.type !== 'expense' || doc.deletedAt || !['domain', 'category'].includes(doc.logoMode)) continue;
        const name = doc.companyName === undefined ? doc.description : doc.companyName;
        const key = keyOf(name);
        if (!key || saved.has(key) || !key.includes(keyOf(query))) continue;
        const domain = doc.logoMode === 'domain' ? normalizeMerchantDomain(doc.merchantDomain) : '';
        if (doc.logoMode === 'domain' && !domain) continue;
        const rank = `${new Date(doc.date).toISOString()}:${doc._id}`;
        if (!choices.has(key) || rank > choices.get(key).rank) {
            choices.set(key, { rank, type: 'expense', companyName: name.trim(), logoMode: doc.logoMode, merchantDomain: domain });
        }
    }
    const term = keyOf(query);
    return [...choices.values()].sort((a, b) => Number(keyOf(b.companyName) === term) - Number(keyOf(a.companyName) === term)
        || a.companyName.localeCompare(b.companyName)).slice(0, 8)
        .map(({ type, companyName, logoMode, merchantDomain }) => ({ type, companyName, logoMode, merchantDomain }));
}

module.exports = { companyHistory };
