// Числа из русского текста: «€1.234,50», «€7.000», «1 234,50 €», «1234.5», «12,5%».
//
// Нужен двум местам: оценке на тестовых данных (eval/common.js ищет в ответе
// ожидаемые числа) и «Разбору месяца» (monthReview.js сверяет каждое число
// текста с фактами). Правило разбора одно, чтобы оценка и сервер читали текст
// одинаково.

// Разделители тысяч: обычный пробел, NBSP, узкий NBSP, тонкий пробел.
const SPACE = '[ \\u00A0\\u202F\\u2009]';
const NUMBER_PATTERN = new RegExp([
    // 1.234,50 (точка как разделитель тысяч)
    '\\d{1,3}(?:\\.\\d{3})+,\\d+',
    // 7.000 / 1.234.567 (точка как разделитель тысяч, без копеек)
    '\\d{1,3}(?:\\.\\d{3})+(?!\\d)',
    // 1 234,50 / 1 234 567
    `\\d{1,3}(?:${SPACE}\\d{3})+(?:[.,]\\d+)?`,
    // 412 / 1234.5 / 12,5
    '\\d+(?:[.,]\\d+)?'
].join('|'), 'gu');

// Числа из текста с запасным прочтением. value - основное прочтение (для
// «7.000» это 7000: в русском тексте запятая - десятичная, точка - тысячи).
// Запасных прочтений два вида, оба необязательные:
// - parts - другое прочтение для «412 1 234» (обычные пробелы между группами):
//   без знака валюты между ними это могут быть и отдельные числа. Для остальных
//   parts равно null;
// - alt - десятичное прочтение «1.210» (одна группа из трёх цифр после точки,
//   без запятой): 1,21. У остальных чисел поля alt нет.
function readNumbers(text) {
    const readings = [];
    for (const [token] of String(text ?? '').matchAll(NUMBER_PATTERN)) {
        const compact = token.replace(new RegExp(SPACE, 'gu'), '');
        const dotThousands = /^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(compact);
        const value = dotThousands
            ? Number(compact.replace(/\./g, '').replace(',', '.'))
            : Number(compact.replace(',', '.'));
        if (!Number.isFinite(value)) continue;
        let parts = null;
        if (token.includes(' ') && /^\d{1,3}(?: \d{3})+/.test(token)) {
            parts = token.split(' ').map(part => Number(part.replace(',', '.'))).filter(Number.isFinite);
        }
        const reading = { value, parts };
        if (/^\d{1,3}\.\d{3}$/.test(compact)) reading.alt = Number(compact);
        readings.push(reading);
    }
    return readings;
}

// Числа из текста ответа (по модулю: знак минус из ответа не читается).
// Даты вроде «2026» и «13 октября» тоже попадут в список: вызывающий сам
// решает, какие числа допустимы. Оба прочтения «412 1 234» идут в список;
// «1.210» читается как 1210 (десятичное прочтение alt сюда не входит).
function extractNumbers(text) {
    return readNumbers(text).flatMap(({ value, parts }) => (parts ? [value, ...parts] : [value]));
}

module.exports = { extractNumbers, readNumbers };
