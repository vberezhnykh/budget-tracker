import { normalizeMerchantDomain } from './merchantDomain';

function normalizeDescription(value) {
  if (typeof value !== 'string') return '';
  return value.normalize('NFKC').toLowerCase().trim()
    .replace(/\s+/gu, ' ').replace(/\s*&\s*/gu, ' & ').trim();
}

// A previous explicit choice is stronger evidence than a later automatic
// lookup. Match the whole description so similarly named shops stay distinct.
export function getHistoricalLogoChoice(transactions, description) {
  const normalizedDescription = normalizeDescription(description);
  if (!normalizedDescription || !Array.isArray(transactions)) return null;

  let latest = null;
  for (const transaction of transactions) {
    if (transaction?.type !== 'expense' || transaction.deletedAt != null
      || normalizeDescription(transaction.description) !== normalizedDescription) continue;
    const logoMode = transaction.logoMode;
    if (logoMode !== 'domain' && logoMode !== 'category') continue;
    const merchantDomain = logoMode === 'domain' ? normalizeMerchantDomain(transaction.merchantDomain) : '';
    if (logoMode === 'domain' && !merchantDomain) continue;
    const date = new Date(transaction.date).getTime();
    if (transaction.date == null || !Number.isFinite(date)) continue;

    const id = String(transaction.id ?? transaction._id ?? '');
    // Mongo IDs order transactions on the same date. When IDs are absent or
    // equal, the choice itself provides a stable last tie-break without sorting
    // or mutating the history array supplied by the application.
    const choiceKey = `${logoMode}:${merchantDomain}`;
    if (!latest || date > latest.date || (date === latest.date
      && (id > latest.id || (id === latest.id && choiceKey > latest.choiceKey)))) {
      latest = { date, id, choiceKey, logoMode, merchantDomain };
    }
  }

  return latest ? { logoMode: latest.logoMode, merchantDomain: latest.merchantDomain } : null;
}
