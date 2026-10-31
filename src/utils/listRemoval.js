import { contribution } from './recentInsert';

// Удалённая операция в списках (Последние операции, История) - до того, как
// список придёт с сервера без неё. Строка не пропадает из групп: она остаётся,
// чтобы списку было что плавно свернуть, а сумма дня пересчитывается сразу.
// Какие строки уходят, говорит leavingIds; сворачивает их TransactionList.
//
// Функция чистая: получает группы (`{ дата: { items, dailySum } }`) и
// удаления `{ id, splitId }` (id из DELETE, splitId - если удалена разбитая
// покупка целиком), возвращает группы с поправленной суммой дня и Set id
// уходящих строк. Для разбитой покупки id строки - её splitId (id у
// split_group, как в ответе сервера).
const NO_IDS = new Set();

// Удаление совпадает со строкой: обычная операция - по id, разбитая покупка - по
// splitId. Часть покупки без splitId (удалён один документ) группу целиком не
// задевает: сервер удаляет только эту часть, и состав группы решит список.
function matches(item, { id, splitId }) {
  if (item.type === 'split_group') {
    if (!splitId) return false;
    return String(item.id) === String(splitId) || item.items.some(part => String(part.id) === String(id));
  }
  return String(item.id) === String(id);
}

// Вклад строки в сумму дня: у разбитой покупки - сумма вкладов её частей.
const rowContribution = item => (
  item.type === 'split_group' ? item.items.reduce((sum, part) => sum + contribution(part), 0) : contribution(item)
);

/**
 * @param {Object} groups группы списка `{ дата: { items, dailySum } }`
 * @param {{ id: string, splitId?: string|null }[]} removals удалённые операции
 * @returns {{ groups: Object, leavingIds: Set<string> }} те же группы (тот же
 *   объект, если никто не уходит) с суммой дня без уходящих строк и id уходящих
 */
export function applyListRemovals(groups, removals) {
  if (!removals?.length) return { groups, leavingIds: NO_IDS };
  const leavingIds = new Set();
  const next = {};
  for (const [date, group] of Object.entries(groups)) {
    let dailySum = group.dailySum;
    for (const item of group.items) {
      // Призрак переехавшей правкой строки (listEdit.js): вклад в сумму дня с него
      // уже снят, и уходящей она значится по самому маркеру.
      if (item.movedAway) continue;
      if (!removals.some(removal => matches(item, removal))) continue;
      leavingIds.add(String(item.id));
      dailySum -= rowContribution(item);
    }
    next[date] = dailySum === group.dailySum ? group : { ...group, dailySum };
  }
  if (leavingIds.size === 0) return { groups, leavingIds: NO_IDS };
  return { groups: next, leavingIds };
}
