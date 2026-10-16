// Окно по списку дней Истории.
//
// Сервер отдаёт всю ленту сразу, но в DOM нужна только её часть: тысячи строк
// на телефоне делают экран тяжёлым. Окно - это диапазон дней внутри списка,
// заданный датами границ, а не индексами: после фонового обновления в списке
// могут появиться или исчезнуть дни, и окно по датам не съезжает.
//
// days - [{ date, count }] от новых дней к старым (см. listDays), count - число
// строк в дне: размер окна считается строками, а не днями, потому что в одном
// дне бывает и одна операция, и сорок.
//
// Окно: { newest, oldest }. newest === null - верхней границы нет (окно
// начинается с самого нового дня, в том числе с будущих); oldest === null -
// нижней границы нет (окно доходит до самого старого). Пустая строка в newest -
// окно целиком ниже всех дней (якорь старше любых данных).

export const WINDOW_ROWS = 60;

// Группы ответа сервера -> дни от новых к старым.
export function listDays(groups) {
  return Object.keys(groups || {}).sort().reverse().map(date => ({ date, count: groups[date]?.items?.length || 0 }));
}

// Границы окна -> индексы [start, end) в days.
export function resolveWindow(window, days) {
  let start = 0;
  let end = days.length;
  if (window?.newest !== null && window?.newest !== undefined) {
    start = days.findIndex(day => day.date <= window.newest);
    if (start === -1) start = days.length;
  }
  if (window?.oldest !== null && window?.oldest !== undefined) {
    end = days.length;
    while (end > start && days[end - 1].date < window.oldest) end -= 1;
  }
  return { start, end: Math.max(start, end) };
}

// Индексы -> окно с границами-датами.
function fromRange(days, start, end) {
  return {
    newest: start <= 0 ? null : days[start]?.date ?? '',
    oldest: end >= days.length ? null : days[end - 1].date,
  };
}

// Окно с якорем в месяце: от самого нового дня этого месяца (или ближайшего
// более старого, если в месяце операций нет) и ~rows строк вниз. Месяц новее
// всех данных - окно с самого верха. Без месяца (поиск) - тоже с верха.
export function windowFor(days, month, rows = WINDOW_ROWS) {
  let start = 0;
  if (month) {
    start = days.findIndex(day => day.date.slice(0, 7) <= month);
    if (start === -1) start = days.length;
  }
  let end = start;
  let count = 0;
  while (end < days.length && count < rows) {
    count += days[end].count;
    end += 1;
  }
  return fromRange(days, start, end);
}

// Дальше в прошлое: ещё ~rows строк под окном.
export function extendOlder(window, days, rows = WINDOW_ROWS) {
  const { start, end } = resolveWindow(window, days);
  let next = end;
  let count = 0;
  while (next < days.length && count < rows) {
    count += days[next].count;
    next += 1;
  }
  return fromRange(days, start, next);
}

// К новым дням: ещё ~rows строк над окном.
export function extendNewer(window, days, rows = WINDOW_ROWS) {
  const { start, end } = resolveWindow(window, days);
  let next = Math.min(start, days.length);
  let count = 0;
  while (next > 0 && count < rows) {
    next -= 1;
    count += days[next].count;
  }
  return fromRange(days, next, end);
}

// Что показывать и есть ли что дозагрузить с каждой стороны.
export function sliceWindow(window, days) {
  const { start, end } = resolveWindow(window, days);
  return { days: days.slice(start, end), start, hasNewer: start > 0, hasOlder: end < days.length };
}
