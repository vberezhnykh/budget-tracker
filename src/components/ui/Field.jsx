// Поле ввода. До этого компонента в проекте было 14 полей в четырёх
// файлах, и каждое повторяло одну и ту же обвязку заново: рамка, радиус,
// снятый outline, цвет текста, box-sizing. Расходились они при этом не по
// смыслу, а случайно - где-то радиус md, где-то lg, где-то забыт
// boxSizing.
//
// Здесь разделено то, что действительно разное, и то, что просто
// повторялось:
//
//   tone - на какой поверхности поле лежит. Это про внешний вид рамки и
//          фона, и вариантов ровно три, все три реально встречаются.
//   size - насколько поле крупное: пара «отступы + кегль».
//
// Всё остальное (ширина, место под иконку слева, выравнивание) остаётся
// на месте вызова через style: это не роль поля, а особенность конкретного
// экрана, и прятать её в примитив значило бы плодить пропсы под каждый
// частный случай.
//
// Шрифт намеренно не задаётся: у <input> он не наследуется от body, и в
// этом интерфейсе поля всегда рисовались системным шрифтом. Отдельные
// поля просят fontFamily: 'inherit' сами (см. поле даты) - это их
// осознанное отличие, а не недосмотр.

const TONES = {
    // Поле на белой карточке: заметная рамка, своего фона нет.
    outline: {
        border: '1px solid var(--color-border-strong)',
    },
    // Поле на белом, но частью более крупного блока - рамка тише.
    muted: {
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
    },
    // Утопленное поле: фон темнее подложки, рамка тихая.
    sunken: {
        background: 'var(--color-surface-sunken)',
        border: '1px solid var(--color-border)',
    },
};

const SIZES = {
    sm: { padding: '6px 10px', fontSize: 'var(--text-base)' },
    md: { padding: '10px 14px', fontSize: 'var(--text-base)' },
    lg: { padding: '12px 14px', fontSize: 'var(--text-lg)' },
    // Крупное поле формы операции: сумма, дата, комментарий.
    xl: { padding: '16px', fontSize: 'var(--text-3xl)', fontWeight: '700' },
};

export default function Field({ tone = 'outline', size = 'md', radius, style, ...props }) {
    return (
        <input
            {...props}
            style={{
                borderRadius: radius || (size === 'xl' ? 'var(--radius-lg)' : 'var(--radius-md)'),
                color: 'var(--color-text-main)',
                outline: 'none',
                boxSizing: 'border-box',
                ...TONES[tone],
                ...SIZES[size],
                ...style,
            }}
        />
    );
}
