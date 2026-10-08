// Тексты пустой выдачи Истории: описание для «Ничего не нашлось» собирается
// из того, что реально включено, чтобы человек видел, по чему искали.

const TYPE_PHRASES = { income: 'среди доходов', expense: 'среди расходов' };

// Фильтры в том виде, как их держит App: счёт - id, категория - имя,
// тип - 'income' | 'expense' | null.
export function hasActiveFilters({ account, category, type }) {
  return Boolean(account || category || type);
}

// «По запросу «кофе» на счёте «Карта» в категории «Еда» среди расходов
// операций нет. Возможно, мешает фильтр.»
export function describeEmptySearch({ query, accountName, category, type }) {
  const parts = [`По запросу «${String(query).trim()}»`];
  if (accountName) parts.push(`на счёте ${accountName}`);
  if (category) parts.push(`в категории «${category}»`);
  if (TYPE_PHRASES[type]) parts.push(TYPE_PHRASES[type]);
  const filtered = Boolean(accountName || category || TYPE_PHRASES[type]);
  return `${parts.join(' ')} операций нет.${filtered ? ' Возможно, мешает фильтр.' : ''}`;
}
