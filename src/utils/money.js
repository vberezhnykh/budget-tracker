// Единый вид суммы в интерфейсе: «€1.846,20» - немецкий формат чисел, знак
// евро перед числом, а минус - настоящий «−» (U+2212), и стоит он перед
// евро: «−€24,90». Дефис-минус из toLocaleString в узкой строке списка
// слишком короткий и слипается с цифрами.
//
// sign - что делать со знаком:
//   'none'  - модуль без знака (сумма операции, у которой смысл несёт цвет);
//   'auto'  - «+» у положительного, «−» у отрицательного, у нуля ничего;
//   'minus' - всегда «−», кроме нуля (расход, чья сумма хранится положительной).

const MINUS = '−';

const numberFormat = new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});

export function formatMoney(value, { sign = 'none' } = {}) {
    const number = Number(value);
    // Округляем до копеек заранее: -0.004 после форматирования - это «0,00»,
    // а знак у «нуля» быть не должен.
    const cents = Number.isFinite(number) ? Math.round(Math.abs(number) * 100) : 0;
    const text = `€${numberFormat.format(cents / 100)}`;
    if (cents === 0 || sign === 'none') return text;
    if (sign === 'minus') return `${MINUS}${text}`;
    if (sign === 'auto') return `${number > 0 ? '+' : MINUS}${text}`;
    return text;
}
