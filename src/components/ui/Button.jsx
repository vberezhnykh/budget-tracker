// Кнопка с текстовой подписью (иногда с иконкой перед ней): «Сохранить»,
// «Отменить», «Удалить навсегда», «Повторить». Раньше каждая такая кнопка
// заново расписывала отступы, кегль, скругление и фон - одни брали класс
// btn-primary, другие рисовали серую или красную подложку вручную, - и
// главное действие выглядело по-разному на соседних экранах: где-то с
// тенью и подъёмом при наведении, где-то плоским, у одних отступ 8px, у
// других 12px. Здесь всё это собрано в одном месте.
//
// Тон - это роль действия, а не цвет:
//
//   primary   - главное действие экрана или диалога: сохранить, добавить,
//               повторить загрузку. На экране оно одно.
//   secondary - второстепенное рядом с главным: отмена, «Изменить», «Банки…».
//               Лежит на серой подложке и не спорит с заливкой.
//   soft      - лёгкое акцентное действие: «Отменить» в плашке удаления,
//               «Перевод». Подсвечено фирменным, но не залито.
//   danger    - необратимое или разрушающее: удалить, выйти.
//   text      - действие-ссылка без подложки и отступов («Сбросить»). Цвет
//               можно переопределить через style, если он несёт смысл.
//
// Размер задаёт высоту нажатия, а не важность:
//
//   sm - действия внутри карточек и строк списка (36px).
//   md - умолчание: диалоги и экраны (44px).
//   lg - главная строка отправки формы операции (52px).
//
// Тон text обнуляет отступы и минимальную высоту, поэтому в итоговом
// стиле он идёт после размера. Состояния :hover, :active, :disabled и
// :focus-visible инлайном не задать, они описаны в index.css по классу
// ui-button. `style` остаётся для раскладки: flex, alignSelf, margin.

const SIZES = {
    sm: { padding: 'var(--space-2) var(--space-3)', fontSize: 'var(--text-base)', minHeight: '36px' },
    md: { padding: 'var(--space-3) var(--space-4)', fontSize: 'var(--text-md)', minHeight: '44px' },
    lg: { padding: 'var(--space-4)', fontSize: 'var(--text-2xl)', minHeight: '52px' },
};

const TONES = {
    primary: {
        background: 'var(--color-primary-gradient)',
        color: 'var(--color-text-inverse)',
        boxShadow: 'var(--shadow-primary)',
    },
    secondary: { background: 'var(--color-surface-inset)', color: 'var(--color-text-main)' },
    soft: { background: 'var(--color-primary-tint)', color: 'var(--color-primary)' },
    danger: { background: 'var(--color-danger-soft)', color: 'var(--color-danger)' },
    text: { background: 'transparent', color: 'var(--color-primary)', padding: 0, minHeight: 'auto' },
};

export default function Button({
    tone = 'primary',
    size = 'md',
    block = false,
    type = 'button',
    className,
    style,
    children,
    ...props
}) {
    return (
        <button
            type={type}
            className={className ? `ui-button ${className}` : 'ui-button'}
            {...props}
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 'var(--space-1-5)',
                border: 'none',
                borderRadius: 'var(--radius-md)',
                fontWeight: 'var(--weight-strong)',
                fontFamily: 'inherit',
                cursor: 'pointer',
                transition: 'filter 0.2s ease, opacity 0.2s ease, transform 0.1s ease',
                ...(block ? { width: '100%' } : null),
                ...SIZES[size],
                ...TONES[tone],
                ...style,
            }}
        >
            {children}
        </button>
    );
}
