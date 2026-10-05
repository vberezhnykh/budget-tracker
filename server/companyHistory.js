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
            choices.set(key, { rank, type: 'expense', companyName: name.trim(), logoMode: doc.logoMode, merchantDomain: domain, category: doc.category });
        }
    }
    const term = keyOf(query);
    return [...choices.values()].sort((a, b) => Number(keyOf(b.companyName) === term) - Number(keyOf(a.companyName) === term)
        || a.companyName.localeCompare(b.companyName)).slice(0, 8)
        .map(({ type, companyName, logoMode, merchantDomain, category }) => ({
            type, companyName, logoMode, merchantDomain,
            ...(typeof category === 'string' && category ? { category } : {})
        }));
}

// Обычная категория компании: самая частая, при равенстве - с более свежей
// датой. На вход - строки группировки { _id: { companyId, category }, count, lastDate },
// чтобы одним агрегатом обойтись без запроса на каждую компанию.
function usualCategories(groups) {
    const best = new Map();
    for (const { _id, count, lastDate } of groups) {
        if (!_id?.companyId || typeof _id.category !== 'string' || !_id.category) continue;
        const id = String(_id.companyId);
        const time = new Date(lastDate).getTime() || 0;
        const current = best.get(id);
        if (!current || count > current.count || (count === current.count && time > current.time)) {
            best.set(id, { category: _id.category, count, time });
        }
    }
    return new Map([...best].map(([id, { category }]) => [id, category]));
}

module.exports = { companyHistory, usualCategories };
