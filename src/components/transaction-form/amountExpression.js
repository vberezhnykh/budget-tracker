// Выражение в поле суммы: «100−30», «12,5×3», «90÷3+5». Чистые функции без
// React: форма только вызывает их и рисует результат.
//
// Операторы хранятся в строке сразу «красивыми» символами и без пробелов:
// пробел вокруг оператора ломал бы Backspace (первое нажатие стирало бы
// пробел, и казалось, что ничего не произошло).

const OPERATORS = '+−×÷';
const OPERATOR_RE = /[+−×÷]/;

// Что набирают на разных клавиатурах вместо нужного знака. Системная
// клавиатура iOS с inputMode="decimal" знаков действий не даёт, но с
// внешней клавиатуры или из буфера они приходят в любом виде.
const OPERATOR_ALIASES = {
    '-': '−', '–': '−',
    '*': '×', x: '×', X: '×', 'х': '×',
    '/': '÷', ':': '÷',
};

export const AMOUNT_ERROR_TEXT = {
    divideByZero: 'На ноль делить нельзя',
    notPositive: 'Сумма должна быть больше нуля',
    invalid: 'Не получается разобрать сумму',
};

const isOperator = char => OPERATORS.includes(char);

// Приводит ввод к допустимому алфавиту: цифры, разделитель и четыре знака.
export function sanitizeAmountInput(raw) {
    let result = '';
    for (const original of String(raw ?? '')) {
        const char = OPERATOR_ALIASES[original] ?? original;
        if (isOperator(char)) {
            // Знак в начале не нужен, а несколько подряд - опечатка:
            // остаётся последний («100+−30» значит «100−30»).
            if (result === '') continue;
            result = isOperator(result.at(-1)) ? result.slice(0, -1) + char : result + char;
        } else if (/[0-9.,]/.test(char)) {
            result += char;
        }
    }
    return result;
}

export function hasOperator(text) {
    return OPERATOR_RE.test(String(text ?? ''));
}

// Копейки: 10÷3 должно быть 3,33, а не 3.3333333333333335. Поправка 1e-8
// нужна, чтобы 1,005 не терялось на float (1.005 * 100 = 100.49999...) и
// округлялось до 1,01, как ждёт человек; модуль - чтобы минус округлялся
// симметрично, а не «к плюсу».
const toCents = number => (Math.sign(number) * Math.round(Math.abs(number) * 100 + 1e-8)) / 100 || 0;

// Число из операнда: «12,5» и «12.5» одинаково, но один разделитель на число.
// null - в операнде нет цифр (пусто или одна запятая), 'invalid' - не разобрать.
function parseOperand(text) {
    if (!/[0-9]/.test(text)) return text === '' || /^[.,]$/.test(text) ? null : 'invalid';
    if (!/^[0-9]*[.,]?[0-9]*$/.test(text)) return 'invalid';
    return Number(text.replace(',', '.'));
}

// { value, isExpression, error }
//   value - число с точностью до копеек или null (пусто, не разобрать, деление
//     на ноль). Исключение - итог выражения не больше нуля: он остаётся
//     числом, чтобы форма могла показать, что именно получилось.
//   isExpression - между двумя числами есть действие; «100−» ещё не выражение.
//   error - 'invalid' | 'divideByZero' | 'notPositive' | null. У простого числа
//     ошибки нет даже при нуле: это обычное «сумма пока не годится», и кнопка
//     сохранения неактивна, как раньше.
export function evaluateAmount(text) {
    const source = String(text ?? '');
    const failure = error => ({ value: null, isExpression: false, error });
    if (source === '') return failure(null);

    // Чётные места - операнды, нечётные - знаки между ними.
    const parts = source.split(/([+−×÷])/);
    const operands = [];
    const operators = [];
    for (let i = 0; i < parts.length; i += 2) {
        const parsed = parseOperand(parts[i]);
        if (parsed === 'invalid') return failure('invalid');
        if (parsed === null) {
            // Пустой хвост («100−» или «100−,») - ещё не набрано, его
            // отбрасываем вместе со знаком; пустое посередине - мусор.
            if (i === parts.length - 1 && operands.length > 0) break;
            if (parts.length === 1) return failure(null);
            return failure('invalid');
        }
        operands.push(parsed);
        if (i + 1 < parts.length) operators.push(parts[i + 1]);
    }
    // Знак без правого операнда отброшен вместе с хвостом
    operators.length = operands.length - 1;

    if (operands.length === 1) return { value: toCents(operands[0]), isExpression: false, error: null };

    // Сначала × и ÷, потом + и −: слагаемые копим в terms.
    const terms = [operands[0]];
    const signs = [];
    for (let i = 0; i < operators.length; i++) {
        const operator = operators[i];
        const operand = operands[i + 1];
        if (operator === '×') {
            terms[terms.length - 1] *= operand;
        } else if (operator === '÷') {
            if (operand === 0) return { value: null, isExpression: true, error: 'divideByZero' };
            terms[terms.length - 1] /= operand;
        } else {
            signs.push(operator);
            terms.push(operand);
        }
    }
    const total = terms.reduce((sum, term, i) => (i === 0 ? term : signs[i - 1] === '+' ? sum + term : sum - term));
    const value = toCents(total);
    return { value, isExpression: true, error: value > 0 ? null : 'notPositive' };
}

// Нажатие кнопки действия: знак заменяет прежний, а висящий разделитель
// («100,») убирается, чтобы не остаться «100,+».
export function appendOperator(text, operator) {
    let result = String(text ?? '');
    if (result === '') return result;
    if (isOperator(result.at(-1))) result = result.slice(0, -1);
    else if (/[.,]$/.test(result)) result = result.slice(0, -1);
    return result === '' ? result : result + operator;
}

// Итог обратно в поле: десятичная запятая, как набирает русская клавиатура.
export function formatAmountForInput(value) {
    return String(toCents(Number(value))).replace('.', ',');
}
