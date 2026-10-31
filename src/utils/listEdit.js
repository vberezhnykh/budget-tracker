import {
  buildSplitGroup, compareIds, contribution, insertRecentTransaction, isDocument, matchesAccount, toListItems,
} from './recentInsert';

// Изменённая операция в списках (Последние операции, История) - до того, как
// список придёт с сервера уже с правкой. Ответ PUT - сохранённый документ в том
// же виде, что у POST, поэтому строку строим тем же путём (recentInsert.js), а
// здесь решаем, что с ней делать в текущих группах: поправить на месте,
// переставить в другой день или убрать.
//
// Функция чистая: получает группы (`{ дата: { items, dailySum } }`) и правки
// `{ id, saved, seq }` в порядке применения, а возвращает новые группы (входные
// и их строки не меняются; нетронутые дни - те же объекты) и три набора id:
// - editedIds (id -> seq): строки, поправленные на месте; список подсвечивает их,
//   а смена seq у той же строки перезапускает подсветку;
// - freshIds: строки, выросшие на новом месте (другой день или раньше не
//   видимые) - появляются как только что сохранённые;
// - leavingIds: всегда пустой. Строка, ушедшая в другой день, остаётся на
//   старом месте призраком `{ ...строка, movedAway: true }` (тот же id и индекс):
//   список сворачивает её по этому маркеру, а настоящий список потом просто
//   уберёт её. Сумма дня при этом уже без неё, и applyListRemovals призраков
//   не трогает.
//
// Где точная копия серверной логики невозможна (фильтр `type:` по типу счёта
// требует справочника счетов) или правка касается части разбитой покупки не
// на месте, ничего не меняется - список доедет обычным обновлением.
export const NO_EDITS = new Map();
const NO_IDS = new Set();

const byDateDesc = (a, b) => b.localeCompare(a);

// Где в группах лежит строка с этим id: обычная (не призрак) или часть разбитой
// покупки. partIndex === -1 у обычной строки.
function locate(groups, id) {
  for (const [date, group] of Object.entries(groups)) {
    for (let index = 0; index < group.items.length; index += 1) {
      const item = group.items[index];
      if (item.type === 'split_group') {
        const partIndex = item.items.findIndex(part => String(part.id) === id);
        if (partIndex !== -1) return { date, index, partIndex };
      } else if (!item.movedAway && String(item.id) === id) {
        return { date, index, partIndex: -1 };
      }
    }
  }
  return null;
}

/**
 * @param {Object} groups группы списка `{ дата: { items, dailySum } }`
 * @param {{ id: string, saved: Object, seq: number }[]} edits правки: ответ PUT
 *   и порядковый номер правки
 * @param {{ month: string, account?: string|null, category?: string|null,
 *   type?: string|null, limit?: number }} query параметры списка: месяц-потолок
 *   'YYYY-MM', фильтры счёта, категории и типа, число строк
 * @returns {{ groups: Object, editedIds: Map<string, number>, freshIds: Set<string>,
 *   leavingIds: Set<string> }} те же группы (тот же объект) и пустые константы,
 *   если ничего не изменилось
 */
export function applyListEdits(groups, edits, { month, account = null, category = null, type = null, limit = Infinity }) {
  const unchanged = { groups, editedIds: NO_EDITS, freshIds: NO_IDS, leavingIds: NO_IDS };
  if (!edits?.length) return unchanged;
  // Фильтр по типу счёта требует справочника счетов; список обновится запросом.
  if (account && account.startsWith('type:')) return unchanged;

  let work = groups;
  const editedIds = new Map();
  const freshIds = new Set();

  // День подменяется целиком новым объектом: входной день и его массив не
  // трогаем, а у нетронутых дней остаётся прежний объект.
  const setDay = (date, items, dailySum) => {
    if (work === groups) work = { ...groups };
    work[date] = { ...work[date], items, dailySum };
  };

  // Строка проходит условия списка: месяц-потолок, счёт, категория и тип.
  const belongs = item => Boolean(item.date) && item.date.slice(0, 7) <= month
    && (!account || matchesAccount(item, account))
    && (!category || item.category === category)
    && (!type || item.type === type);

  // Строки без призраков за limit отбрасываются: страница на сервере режет по
  // числу настоящих строк. Призраки остаются там, где были, вместе со своими днями.
  const trim = () => {
    if (!Number.isFinite(limit)) return;
    let shown = 0;
    for (const date of Object.keys(work).sort(byDateDesc)) {
      const items = work[date].items;
      const kept = items.filter(item => item.movedAway || ++shown <= limit);
      if (kept.length === items.length) continue;
      if (kept.length === 0) {
        if (work === groups) work = { ...groups };
        delete work[date];
      } else {
        setDay(date, kept, work[date].dailySum);
      }
    }
  };

  // Ставит строку на её серверное место. false - место за пределами списка.
  const place = (next, id) => {
    const date = next.date;
    const day = work[date];
    // В этот день строка уже "уходила" (правили туда-сюда до ответа ленты): два
    // блока с одним id в одном дне нельзя, поэтому призрак оживает на своём
    // месте и растет заново - как строка, чьё удаление отменили.
    const ghostAt = day ? day.items.findIndex(item => item.movedAway && String(item.id) === id) : -1;
    if (ghostAt !== -1) {
      const items = day.items.slice();
      items[ghostAt] = next;
      setDay(date, items, day.dailySum + contribution(next));
      return true;
    }
    // Серверный порядок: даты по убыванию, внутри дня - по убыванию id. Позиция
    // считается по строкам без призраков: они уже не занимают места на странице.
    const rows = Object.keys(work).sort(byDateDesc)
      .flatMap(rowDate => work[rowDate].items.filter(item => !item.movedAway).map(item => ({ date: rowDate, item })));
    let at = rows.findIndex(row => row.date < date || (row.date === date && compareIds(row.item.id, next.id) < 0));
    if (at === -1) at = rows.length;
    if (at >= limit) return false;
    const items = day ? day.items.slice() : [];
    const before = rows[at];
    let position = 0;
    if (before && before.date === date) {
      position = items.indexOf(before.item);
    } else {
      // Позже всех настоящих строк своего дня (призраки, если они есть, - за ней).
      items.forEach((item, index) => { if (!item.movedAway) position = index + 1; });
    }
    items.splice(position, 0, next);
    // Сумма дня сервера охватывает весь день, а не показанные строки, поэтому к
    // ней прибавляется только вклад строки.
    setDay(date, items, (day?.dailySum ?? 0) + contribution(next));
    trim();
    return true;
  };

  for (const { saved, seq } of edits) {
    if (!isDocument(saved)) continue;
    const next = toListItems([saved])[0];
    const id = String(saved._id);
    const found = locate(work, id);

    if (!found) {
      // Строки в списке не было (и призрака в её дне нет - это проверит place).
      // Часть разбитой покупки одна не вставляется: состав группы решит список.
      if (!belongs(next) || next.splitId) continue;
      const ghostDay = work[next.date];
      if (ghostDay?.items.some(item => item.movedAway && String(item.id) === id)) {
        if (place(next, id)) freshIds.add(id);
        continue;
      }
      const result = insertRecentTransaction(work, saved, { month, account, limit });
      if (result.id === null) continue;
      work = result.groups;
      freshIds.add(id);
      continue;
    }

    const { date, index, partIndex } = found;
    const day = work[date];
    const old = day.items[index];

    if (partIndex !== -1) {
      // Часть разбитой покупки: правка по месту, если день, группа и фильтры те же.
      if (next.splitId !== old.id || next.date !== date || !belongs(next)) continue;
      const parts = old.items.slice();
      const oldPart = parts[partIndex];
      parts[partIndex] = next;
      const items = day.items.slice();
      items[index] = { ...buildSplitGroup(parts), id: old.id };
      setDay(date, items, day.dailySum + contribution(next) - contribution(oldPart));
      editedIds.set(id, seq);
      continue;
    }

    // Обычная строка с splitId - не то, что отдаёт форма: пусть решает сервер.
    if (next.splitId) continue;

    if (belongs(next) && next.date === date) {
      const items = day.items.slice();
      items[index] = next;
      setDay(date, items, day.dailySum + contribution(next) - contribution(old));
      editedIds.set(id, seq);
      continue;
    }

    // Строка уходит с этого места: остается призраком, который список свернет.
    const items = day.items.slice();
    items[index] = { ...old, movedAway: true };
    setDay(date, items, day.dailySum - contribution(old));
    editedIds.delete(id);
    freshIds.delete(id);
    if (belongs(next) && place(next, id)) freshIds.add(id);
  }

  if (work === groups) return unchanged;
  return {
    groups: work,
    editedIds: editedIds.size > 0 ? editedIds : NO_EDITS,
    freshIds: freshIds.size > 0 ? freshIds : NO_IDS,
    leavingIds: NO_IDS,
  };
}
