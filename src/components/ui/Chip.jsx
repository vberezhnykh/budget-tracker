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
//           залитые чипы в ней спорят с кнопкой «Сохранить». Невыбранный -
//           белый с заметной рамкой, выбранный - фирменная подложка и рамка
//           полуторной толщины (1px рамка + 0.5px тени внутрь: размер чипа
//           от выбора не меняется).
//   solid - фильтр в шторке: залит фирменным. Он один на всю ленту и должен
//           читаться как «сейчас включено», а не как «можно нажать».
//   quiet - ячейка периода: невыбранная лежит на подложке и остаётся
//           обычным читаемым текстом, потому что их там два десятка сразу.
//
// Насыщенность во всех тонах одна и та же: выбранный чип - label, невыбранный -
// text (см. правило в index.css): вес дополняет заливку, а не заменяет её.
//
// Форма (`shape`) отделена от тона: чип с текстом - «таблетка», а плитка
// счёта в форме - прямоугольник со скруглением из шкалы.

const TONES = {
    soft: {
        on: { borderColor: 'var(--color-primary)', background: 'var(--color-primary-tint)', color: 'var(--color-primary)', fontWeight: 'var(--weight-label)', boxShadow: 'inset 0 0 0 0.5px var(--color-primary)' },
        off: { borderColor: 'var(--color-border-strong)', background: 'var(--color-surface)', color: 'var(--color-text-main)', fontWeight: 'var(--weight-text)' },
    },
    solid: {
        on: { borderColor: 'var(--color-primary)', background: 'var(--color-primary)', color: 'var(--color-text-inverse)', fontWeight: 'var(--weight-label)' },
        off: { borderColor: 'var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-muted)', fontWeight: 'var(--weight-text)' },
    },
    quiet: {
        on: { borderColor: 'var(--color-primary)', background: 'var(--color-primary-tint)', color: 'var(--color-primary)', fontWeight: 'var(--weight-label)' },
        off: { borderColor: 'var(--color-border)', background: 'var(--color-surface-muted)', color: 'var(--color-text-main)', fontWeight: 'var(--weight-text)' },
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
