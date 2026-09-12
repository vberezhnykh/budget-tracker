import { normalizeMerchantDomain } from './merchantDomain';

export const companyKey = value => typeof value === 'string'
  ? value.normalize('NFKC').trim().toLowerCase().replace(/\s+/gu, ' ').replace(/\s*&\s*/gu, ' & ').trim()
  : '';

export function getCompanySuggestions(companies, transactions, query = '') {
  const saved = new Map((companies || []).map(company => [companyKey(company.name), { ...company, source: 'saved' }]));
  const history = new Map();
  for (const transaction of transactions || []) {
    if (transaction?.type !== 'expense' || transaction.deletedAt) continue;
    const name = transaction.companyName === undefined ? transaction.description : transaction.companyName;
    const key = companyKey(name);
    if (!key || saved.has(key) || !['domain', 'category'].includes(transaction.logoMode)) continue;
    const domain = transaction.logoMode === 'domain' ? normalizeMerchantDomain(transaction.merchantDomain) : '';
    if (transaction.logoMode === 'domain' && !domain) continue;
    const rank = `${transaction.date || ''}:${transaction.id || transaction._id || ''}`;
    if (!history.has(key) || rank > history.get(key).rank) {
      history.set(key, { name: name.trim(), logoMode: transaction.logoMode, merchantDomain: domain, rank, source: 'history' });
    }
  }
  const term = companyKey(query);
  return [...saved.values(), ...history.values()]
    .filter(company => !term || companyKey(company.name).includes(term))
    .sort((a, b) => Number(companyKey(b.name) === term) - Number(companyKey(a.name) === term)
      || Number(b.source === 'saved') - Number(a.source === 'saved') || a.name.localeCompare(b.name))
    .slice(0, 8);
}

async function readCompanyResponse(response) {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(body?.message || 'Не удалось сохранить компанию. Попробуйте ещё раз.');
    error.status = response.status;
    error.body = body;
    throw error;
  }
  if (!body?._id) throw new Error('Сервер не вернул сохранённую компанию. Попробуйте ещё раз.');
  return body;
}

// Saving a registry entry never rewrites transactions. Each transaction keeps
// the selected fields as its own snapshot, alongside the company reference.
export async function saveCompanySelection(item, { request = fetch, logoChanged = false } = {}) {
  if (item.type !== 'expense' || !item.companyName?.trim()) return item;
  if (item.companyId && !logoChanged) return item;
  const choice = { name: item.companyName.trim(), logoMode: item.logoMode || 'auto', merchantDomain: item.merchantDomain || '' };
  const update = company => request(`/api/companies/${encodeURIComponent(company._id)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...choice, name: company.name, __v: company.__v }),
  }).then(readCompanyResponse);
  let company;
  if (item.companyId) {
    const response = await request('/api/companies');
    const companies = response.ok ? await response.json() : null;
    const current = Array.isArray(companies) && companies.find(company => company._id === item.companyId);
    if (!current) throw new Error('Не удалось найти компанию. Выберите её заново.');
    company = await update(current);
  } else {
    try {
      company = await readCompanyResponse(await request('/api/companies', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(choice),
      }));
    } catch (error) {
      if (error.status !== 409 || error.body?.code !== 'COMPANY_EXISTS' || !error.body.company?._id) throw error;
      company = logoChanged ? await update(error.body.company) : error.body.company;
    }
  }
  return { ...item, companyId: company._id, companyName: item.companyId ? item.companyName : company.name, logoMode: company.logoMode, merchantDomain: company.merchantDomain || '' };
}
