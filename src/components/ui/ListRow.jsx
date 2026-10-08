import { ChevronRight } from 'lucide-react';

// Строка сгруппированного списка: настройки, меню «Ещё», строки счетов.
// Слева плитка или иконка, по центру название с необязательной подписью,
// справа значение и шеврон.
//
// Тег выбирается по назначению строки, а не по виду: с href это ссылка, с
// onClick - кнопка, без обоих - обычный div (строка только показывает
// данные). Нажимается вся строка целиком, а не одна её часть, поэтому
// интерактивный элемент и есть контейнер строки; вложенных кнопок внутри
// него быть не должно. Высота не меньше 44px - минимум для пальца.
//
// divider рисует линию под строкой. Последней строке группы её не ставят,
// поэтому это параметр вызова, а не :last-child в CSS: инлайн-стилем
// псевдоклассы не задать.

export default function ListRow({
    leading,
    title,
    subtitle,
    trailing,
    chevron = false,
    href,
    onClick,
    divider = false,
    style,
    ...props
}) {
    const interactive = Boolean(href || onClick);
    const Tag = href ? 'a' : onClick ? 'button' : 'div';

    const base = {
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        padding: 'var(--space-3) 0',
        minHeight: '44px',
        width: '100%',
        boxSizing: 'border-box',
        // Сброс браузерного вида кнопки и ссылки: строка должна выглядеть
        // одинаково в любом из трёх тегов. Линия divider задаётся после
        // сброса border, иначе он её снесёт.
        border: 'none',
        borderBottom: divider ? '1px solid var(--color-border-subtle)' : 'none',
        background: 'transparent',
        color: 'var(--color-text-main)',
        font: 'inherit',
        textAlign: 'left',
        textDecoration: 'none',
        cursor: interactive ? 'pointer' : 'default',
    };

    const linkProps = href ? { href } : { type: 'button', onClick };

    return (
        <Tag {...(interactive ? linkProps : {})} {...props} style={{ ...base, ...style }}>
            {leading != null && (
                <span style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>{leading}</span>
            )}
            <span style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-label)' }}>{title}</span>
                {subtitle != null && (
                    <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-text)', color: 'var(--color-text-muted)' }}>
                        {subtitle}
                    </span>
                )}
            </span>
            {trailing != null && (
                <span style={{ display: 'flex', alignItems: 'center', flexShrink: 0, marginLeft: 'auto', textAlign: 'right' }}>
                    {trailing}
                </span>
            )}
            {chevron && <ChevronRight size={18} aria-hidden="true" color="var(--color-text-subtle)" />}
        </Tag>
    );
}
