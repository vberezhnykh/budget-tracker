import { formatMoney } from '../../utils/money';
import { toLocalDateInput } from '../../utils/period';

// Подсказка под суммой в форме нового расхода: сколько останется от
// месячного лимита после этой траты. Чистая функция - всё, от чего зависит
// ответ, приходит параметрами (в том числе «сегодня»), поэтому правила
// проверяются без рендера формы.
//
// Подсказки нет (null), если она была бы неправдой или бессмысленна:
//   - не расход (доходы и переводы лимит не трогают);
//   - правка существующей операции (она уже входит в расход месяца, и
//     вычитать её второй раз нельзя);
//   - расход «не в статистике» (в расход месяца он не попадает);
//   - дата не в текущем месяце (monthExpense - расход именно текущего);
//   - лимит не задан или негоден, либо расход месяца неизвестен.
//
// Остаток считается с копейками, округлёнными заранее: -0.0000001 после
// вычитаний не должен превращаться в «лимит превышен».
export function getLimitHint({
    type,
    isEditing = false,
    excludeFromStats = false,
    date,
    monthlyLimit,
    monthExpense,
    amount,
    today = toLocalDateInput(),
}) {
    if (type !== 'expense' || isEditing || excludeFromStats) return null;
    if (typeof date !== 'string' || date.slice(0, 7) !== today.slice(0, 7)) return null;
    if (!Number.isFinite(monthlyLimit) || monthlyLimit <= 0) return null;
    if (!Number.isFinite(monthExpense)) return null;

    // Пустое, нечисловое и отрицательное поле - это ноль, а не ошибка
    const typed = parseFloat(amount);
    const entered = Number.isFinite(typed) && typed > 0 ? typed : 0;
    const remaining = Math.round((monthlyLimit - monthExpense - entered) * 100) / 100;

    if (remaining >= 0) {
        return { exceeded: false, text: `После него можно потратить ${formatMoney(remaining)}` };
    }
    return { exceeded: true, text: `Лимит будет превышен на ${formatMoney(-remaining)}` };
}
