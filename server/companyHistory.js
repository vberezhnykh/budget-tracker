const { normalizeMerchantDomain } = require('./merchantDomain');

const keyOf = value => String(value || '').normalize('NFKC').toLowerCase().trim()
    .replace(/\s+/gu, ' ').replace(/\s*&\s*/gu, ' & ').trim();

// Return at most eight distinct explicit logo choices, not the ledger.
// Порядок: точное совпадение имени, затем число трат в выбранной категории,
// затем общее число трат, затем свежесть. Ранжировать надо здесь: после среза
// до восьми клиент уже не увидит самые частые компании.
function companyHistory(docs, companies, query = '', category = '') {
    const saved = new Set(companies.map(company => keyOf(company.name)));
    const choices = new Map();
    const stats = new Map();
    for (const doc of docs) {
        if (doc.type !== 'expense' || doc.deletedAt || !['domain', 'category'].includes(doc.logoMode)) continue;
        const name = doc.companyName === undefined ? doc.description : doc.companyName;
        const key = keyOf(name);
        if (!key || saved.has(key) || !key.includes(keyOf(query))) continue;
        const iso = new Date(doc.date).toISOString();
        const stat = stats.get(key) || stats.set(key, { usage: {}, lastUsed: '' }).get(key);
        if (typeof doc.category === 'string' && doc.category) stat.usage[doc.category] = (stat.usage[doc.category] || 0) + 1;
        if (iso > stat.lastUsed) stat.lastUsed = iso;
        const domain = doc.logoMode === 'domain' ? normalizeMerchantDomain(doc.merchantDomain) : '';
        if (doc.logoMode === 'domain' && !domain) continue;
        const rank = `${iso}:${doc._id}`;
        if (!choices.has(key) || rank > choices.get(key).rank) {
            choices.set(key, { rank, type: 'expense', companyName: name.trim(), logoMode: doc.logoMode, merchantDomain: domain, category: doc.category });
        }
    }
    const term = keyOf(query);
    const total = usage => Object.values(usage).reduce((sum, count) => sum + count, 0);
    return [...choices].map(([key, choice]) => ({ ...choice, ...stats.get(key) }))
        .sort((a, b) => Number(keyOf(b.companyName) === term) - Number(keyOf(a.companyName) === term)
            || (category ? (b.usage[category] || 0) - (a.usage[category] || 0) : 0)
            || total(b.usage) - total(a.usage)
            || b.lastUsed.localeCompare(a.lastUsed)
            || a.companyName.localeCompare(b.companyName)).slice(0, 8)
        .map(({ type, companyName, logoMode, merchantDomain, category, usage, lastUsed }) => ({
            type, companyName, logoMode, merchantDomain,
            ...(typeof category === 'string' && category ? { category } : {}),
            usage, lastUsed
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

// Использование компаний: { категория: число трат } и дата последней траты.
// Вход тот же, что у usualCategories; нет трат - нет записи в результате.
function companyUsage(groups) {
    const result = new Map();
    for (const { _id, count, lastDate } of groups) {
        if (!_id?.companyId) continue;
        const id = String(_id.companyId);
        const entry = result.get(id) || result.set(id, { usage: {}, lastUsed: '' }).get(id);
        if (typeof _id.category === 'string' && _id.category) entry.usage[_id.category] = (entry.usage[_id.category] || 0) + count;
        const time = new Date(lastDate);
        if (!Number.isNaN(time.getTime()) && time.toISOString() > entry.lastUsed) entry.lastUsed = time.toISOString();
    }
    return result;
}

module.exports = { companyHistory, companyUsage, usualCategories };
