import { getPreviousMonth } from './monthNames';
import { formatDayMonth } from './period';

// Карточка «Итоги сентября» на Обзоре: чистая логика видимости и ключ
// запоминания «скрыто», без React, чтобы границы условий проверялись
// юнит-тестами, а не кликами. Сам текст пишет сервер (server/monthReview.js).
//
// Карточка нужна в начале нового месяца, пока итоги прошлого ещё свежи, и
// только на «Обзоре» этого месяца без выбранного счёта: разбор про весь бюджет
// семьи, а не про один счёт.

// Последний день месяца, в который карточка ещё показывается.
export const MONTH_REVIEW_LAST_DAY = 10;

const DISMISSED_PREFIX = 'monthReview:dismissed:';

// Месяц, про который пишется разбор: предыдущий к месяцу сегодняшней даты
// ('YYYY-MM-DD'). Январь даёт декабрь прошлого года.
export const reviewMonthFor = (today) => getPreviousMonth(today.slice(0, 7));

// «сентября» - название месяца в родительном падеже строчными, для подписи
// «Итоги сентября». Intl со стилем day+month сам склоняет месяц, число отбрасываем.
export const monthGenitive = (month) => formatDayMonth(month, 1).replace(/^\d+\s+/, '');

export function shouldShowMonthReview({ enabled, today, timeRange, selectedMonth, selectedAccount, dismissed }) {
  if (enabled !== true || dismissed) return false;
  if (typeof today !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return false;
  if (timeRange !== 'month' || selectedMonth !== today.slice(0, 7)) return false;
  if (selectedAccount) return false;
  return Number(today.slice(8, 10)) <= MONTH_REVIEW_LAST_DAY;
}

// --- Запоминание «скрыто» на этом устройстве -----------------------------------------
// Хранилище может быть недоступно (приватное окно, запрет сайта): тогда оно
// молча считается пустым, а «скрыть» держится до конца сеанса в состоянии React.

export const dismissedKey = (month) => `${DISMISSED_PREFIX}${month}`;

export function readDismissed(month) {
  try {
    return window.localStorage.getItem(dismissedKey(month)) === '1';
  } catch {
    return false;
  }
}

export function writeDismissed(month) {
  try {
    window.localStorage.setItem(dismissedKey(month), '1');
  } catch {
    // не записалось - карточка скрыта до перезагрузки
  }
}
