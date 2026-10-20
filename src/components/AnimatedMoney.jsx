import useAnimatedNumber from '../utils/useAnimatedNumber';
import { formatMoney } from '../utils/money';

// Сумма, которая при обновлении плавно переезжает к новому значению
// (utils/useAnimatedNumber). Вне анимации - обычный текст, ровно такой же, как
// без компонента: тесты и скринридер видят его как раньше. Пока цифры бегут,
// видимая строка скрыта от скринридера, а итоговая сумма лежит рядом
// невидимым текстом - читается всегда окончательное значение.
//
// format - как показать число; передаётся функцией, потому что знак зависит от
// числа на каждом кадре (сальдо может пройти через нуль). valueKey - см.
// useAnimatedNumber: без него анимации нет.
export default function AnimatedMoney({ value, valueKey, format = formatMoney }) {
  const { value: shown, animating } = useAnimatedNumber(value, valueKey);
  if (!animating) return format(value);
  return (
    <>
      <span aria-hidden="true" className="animated-money">{format(shown)}</span>
      <span className="visually-hidden">{format(value)}</span>
    </>
  );
}
