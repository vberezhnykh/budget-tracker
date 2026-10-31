import { transformTransactions } from './finance';

// Только что сохранённая операция в списке «Последние операции» - до того, как
// список придёт с сервера. Ответ POST /api/transactions - сырой документ (или
// массив документов у разбитой покупки), а список строит сервер: приводит
// документы (server/transform.js), склеивает части покупки в split_group и
// считает сумму дня (server/periodStats.js), режет страницу и сортирует
// (server/history.js). Здесь то же самое сделано на одной операции, чтобы
// настоящий список, придя, подменил строку на такую же, а не сдвинул соседние.
//
// Функция чистая и ничего не знает про запрос: получает текущие группы
// (`{ дата: { items, dailySum } }`), сохранённый ответ и параметры запроса
// списка, а возвращает новые группы. Где точная копия серверной логики
// невозможна (фильтр `type:` по типу счёта требует справочника счетов),
// операция не вставляется - список доедет обычным обновлением.

// Дата документа ключом 'YYYY-MM-DD' - как toDateKey на сервере: в JSON дата
// приходит ISO-строкой, и берётся её UTC-часть.
const dateKeyOf = raw => (typeof raw === 'string' ? raw.slice(0, 10) : '');

// Сырой документ -> элемент списка. Приведение берётся общее с остальным
// клиентом (utils/finance), а идентификаторы и дата подготавливаются так, как
// их видит серверный transformTransactions: id и companyId - строками.
export function toListItems(docs) {
  const prepared = docs.map(doc => ({
    ...doc,
    _id: String(doc._id),
    ...(doc.companyId ? { companyId: String(doc.companyId) } : {}),
    date: dateKeyOf(doc.date),
  }));
  return transformTransactions(prepared);
}

// Операция совпадает со счётом запроса: сам счёт или получатель перевода
// (matchesAccount на сервере). Фильтр по типу счёта сюда не доходит.
export const matchesAccount = (item, account) => (
  item.type === 'transfer' ? item.account === account || item.toAccount === account : item.account === account
);

// Вклад операции в сумму дня: без стартового баланса, переводов и помеченных
// «не в статистику» - то же правило, что у dailySum на сервере.
export const contribution = item => (
  item.type !== 'initial' && item.type !== 'transfer' && !item.excludeFromStats ? item.visualAmount : 0
);

// Части покупки -> одна строка split_group, как её собирает computePeriodData.
export function buildSplitGroup(parts) {
  const first = parts[0];
  const group = {
    id: first.splitId,
    type: 'split_group',
    date: first.date,
    description: (first.description || '').split(' (')[0],
    account: first.account,
    visualAmount: parts.reduce((sum, part) => sum + part.visualAmount, 0),
    items: parts,
  };
  // Общие название, комментарий и логотип - если их знают все части (блок
  // «склейки» после группировки в computePeriodData).
  if (parts.some(part => typeof part.companyName === 'string')) {
    const sameCompany = parts.every(part => typeof part.companyName === 'string' && part.companyName === first.companyName);
    group.companyName = sameCompany ? first.companyName : '';
    group.description = parts.every(part => (part.description || '') === (first.description || ''))
      ? (first.description || '') : '';
    if (group.companyName) {
      const sameLogo = parts.every(part => (part.logoMode || 'auto') === (first.logoMode || 'auto')
        && (part.merchantDomain || '') === (first.merchantDomain || ''));
      group.logoMode = sameLogo ? (first.logoMode || 'auto') : 'category';
      if (sameLogo && first.merchantDomain) group.merchantDomain = first.merchantDomain;
    }
  }
  return group;
}

// Идентификаторы, уже лежащие в группах: строки и части разбитых покупок.
function presentIds(groups) {
  const ids = new Set();
  for (const group of Object.values(groups)) {
    for (const item of group.items) {
      ids.add(String(item.id));
      for (const part of item.items || []) ids.add(String(part.id));
    }
  }
  return ids;
}

// Порядок строк внутри дня на сервере - по убыванию id как строки.
export const compareIds = (a, b) => String(a).localeCompare(String(b));

// Ответ не в виде полного документа (пустой, без _id, суммы или типа) - не из
// чего строить строку: лучше дождаться списка, чем показать «€NaN».
export const isDocument = doc => Boolean(doc) && typeof doc === 'object' && doc._id != null
  && typeof doc.type === 'string' && Number.isFinite(parseFloat(doc.amount));

/**
 * Вставляет сохранённую операцию в группы списка последних операций.
 *
 * @param {Object} groups текущие группы `{ дата: { items, dailySum } }`
 * @param {Object|Object[]} saved ответ POST: документ или массив документов
 * @param {{ month: string, account?: string|null, limit?: number }} query
 *   параметры запроса списка: месяц-потолок 'YYYY-MM', фильтр счёта, число строк
 * @returns {{ groups: Object, id: string|null }} новые группы и id вставленной
 *   строки; `id: null` и те же `groups`, если вставлять не нужно или нельзя.
 */
export function insertRecentTransaction(groups, saved, { month, account = null, limit = 5 }) {
  const unchanged = { groups, id: null };
  const docs = Array.isArray(saved) ? saved : [saved];
  if (docs.length === 0 || !docs.every(isDocument)) return unchanged;
  // Фильтр по типу счёта требует справочника счетов; список обновится запросом.
  if (account && account.startsWith('type:')) return unchanged;

  let parts = toListItems(docs);
  const date = parts[0].date;
  if (!date || parts.some(part => part.date !== date)) return unchanged;
  // Лента в «непрерывном» режиме не заглядывает в месяцы позже запрошенного.
  if (date.slice(0, 7) > month) return unchanged;

  // Покупка с splitId - всегда одна группа; части с разными splitId или часть
  // без него в одном ответе - не то, что отдаёт форма, это пусть решает сервер.
  const splitId = parts[0].splitId;
  if (docs.length > 1 && !splitId) return unchanged;
  if (parts.some(part => part.splitId !== splitId)) return unchanged;

  // Сервер сначала отбирает операции по счёту, потом склеивает части: у
  // группы остаются только подходящие части.
  if (account) parts = parts.filter(part => matchesAccount(part, account));
  if (parts.length === 0) return unchanged;

  const entry = splitId ? buildSplitGroup(parts) : parts[0];
  // Сервер уже отдал эту операцию (список пришёл позже записи) - вставлять нечего.
  const present = presentIds(groups);
  if (present.has(String(entry.id)) || parts.some(part => present.has(String(part.id)))) return unchanged;

  // Плоский список строк в порядке показа: даты по убыванию, внутри дня -
  // как лежат (их порядок пришёл с сервера).
  const rows = Object.keys(groups).sort((a, b) => b.localeCompare(a))
    .flatMap(rowDate => groups[rowDate].items.map(item => ({ date: rowDate, item })));
  // Строка встаёт перед первой, которая в серверном порядке идёт после неё:
  // с более ранней датой или с тем же днём и меньшим id. Свежая операция
  // обычно первая в своём дне (ObjectId растёт, а `split_...` старше любого
  // ObjectId), но если в этот день уже есть разбитая покупка, она остаётся
  // выше - так же, как в ответе сервера.
  let at = rows.findIndex(row => row.date < date || (row.date === date && compareIds(row.item.id, entry.id) < 0));
  if (at === -1) at = rows.length;
  // Срез страницы: строка за её границей на экран не попадёт, а значит и
  // сумму дня менять не надо - она придёт с запросом.
  if (at >= limit) return unchanged;

  const visible = [...rows.slice(0, at), { date, item: entry }, ...rows.slice(at)].slice(0, limit);
  const next = {};
  for (const row of visible) {
    if (!next[row.date]) next[row.date] = { items: [], dailySum: groups[row.date]?.dailySum ?? 0 };
    next[row.date].items.push(row.item);
  }
  // Сумма дня сервера охватывает весь день, а не показанные строки, поэтому к
  // ней прибавляется только вклад новой операции.
  next[date].dailySum += parts.reduce((sum, part) => sum + contribution(part), 0);

  return { groups: next, id: String(entry.id) };
}
