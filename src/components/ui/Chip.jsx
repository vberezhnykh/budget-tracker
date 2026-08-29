// Переключаемый элемент выбора: категория и счёт в форме операции, фильтр
// по категории в шторке, месяц и год в выборе периода. Раньше каждый из них
// заново расписывал одни и те же четыре тернарника - рамка, фон, цвет
// текста, насыщенность - и они успели разойтись: где-то невыбранный чип
// белый, где-то серый, где-то выбранный залит фирменным, где-то только
// подсвечен.
//
// Здесь эти расхождения зафиксированы как три тона. Они не выдуманы под
// будущее, а сняты с того, что уже есть на экранах:
//
//   soft  - выбор внутри формы: подсветка, а не заливка. Форма и так пёстрая,
//           залитые чипы в ней спорят с кнопкой «Сохранить».
//   solid - фильтр в шторке: залит фирменным. Он один на всю ленту и должен
//           читаться как «сейчас включено», а не как «можно нажать».
//   quiet - ячейка периода: невыбранная лежит на подложке и остаётся
//           обычным читаемым текстом, потому что их там два десятка сразу.
//
// Форма (`shape`) отделена от тона: чип с текстом - «таблетка», а плитка
// счёта в форме - прямоугольник со скруглением из шкалы.

const TONES = {
    soft: {
        on: { borderColor: 'var(--color-primary)', background: 'var(--color-primary-soft)', color: 'var(--color-primary)', fontWeight: '600' },
        off: { borderColor: 'var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-muted)', fontWeight: 'normal' },
    },
    solid: {
        on: { borderColor: 'var(--color-primary)', background: 'var(--color-primary)', color: 'var(--color-text-inverse)', fontWeight: '600' },
        off: { borderColor: 'var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-muted)', fontWeight: '600' },
    },
    quiet: {
        on: { borderColor: 'var(--color-primary)', background: 'var(--color-primary-tint)', color: 'var(--color-primary)', fontWeight: '700' },
        off: { borderColor: 'var(--color-border)', background: 'var(--color-surface-muted)', color: 'var(--color-text-main)', fontWeight: '500' },
    },
};

const SHAPES = {
    pill: 'var(--radius-pill)',
    block: 'var(--radius-md)',
};

export default function Chip({
    selected = false,
    tone = 'soft',
    shape = 'pill',
    style,
    children,
    ...props
}) {
    return (
        <button
            type="button"
            {...props}
            // Чип - это переключатель, а не обычная кнопка: состояние
            // «включено» должно быть видно и без глаз. Явно переданный
            // aria-pressed (как у ячеек периода) остаётся за вызовом.
            aria-pressed={props['aria-pressed'] ?? selected}
            style={{
                borderRadius: SHAPES[shape],
                border: '1px solid',
                fontSize: 'var(--text-base)',
                cursor: 'pointer',
                transition: 'all 0.2s',
                ...TONES[tone][selected ? 'on' : 'off'],
                ...style,
            }}
        >
            {children}
        </button>
    );
}
