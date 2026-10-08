import { formatMoney } from './money';
import { isLimitUsable } from './paceChart';
import { pluralForm } from './plural';

// «в 1 месяце / в 2 месяцах»: после «в» предложный падеж.
const MONTH_FORMS = ['месяце', 'месяцах', 'месяцах'];

// Подпись под графиком (только для месячного вида): сколько из закрытых
// месяцев ушло за лимит и сколько в среднем тратится. Берутся те же месяцы,
// что помещаются на экран, - закрытые, то есть раньше идущего. null, если
// закрытых месяцев нет и считать нечего.
export function getTrendCaption(series, { limit, currentMonth, visible }) {
    const closed = series.slice(-visible).filter(month => month.month < currentMonth);
    if (closed.length === 0) return null;

    const average = closed.reduce((sum, month) => sum + month.expense, 0) / closed.length;
    const averageText = `Средний расход ${formatMoney(average, { whole: true })}.`;
    if (!isLimitUsable(limit)) return averageText;

    const over = closed.filter(month => month.expense > limit).length;
    const limitText = over === 0
        ? `Лимит не превышался ни в одном из ${closed.length} закрытых.`
        : `Лимит превышен в ${over} ${pluralForm(over, MONTH_FORMS)} из ${closed.length} закрытых.`;
    return `${limitText} ${averageText}`;
}
