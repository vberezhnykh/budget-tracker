// Кнопка без подписи: карандаш, корзина, шестерёнка, крестик закрытия.
// Таких в проекте девять, и все девять заново описывали одно и то же -
// flex-центрирование содержимого, снятую рамку, размер, курсор. Из-за
// этого они и разъехались: у строки счёта карандаш и корзина были
// заданного кегля, у строки категории - браузерного умолчания, то есть
// заметно мельче, хотя это те же самые действия в том же списке.
//
// Размер задаётся одним числом: квадратная кнопка получает его как
// минимальный размер (содержимое может быть шире), круглая - как жёсткие
// ширину и высоту. Пальцу нужно не меньше 36px, поэтому это и умолчание.
//
// Тон - это роль действия, а не цвет: danger у корзины, primary у
// подтверждения, neutral у закрытия и отмены, ghost там, где кнопка
// лежит внутри строки списка и своей подложки иметь не должна.

const TONES = {
    ghost: { background: 'transparent' },
    neutral: { background: 'var(--color-surface-sunken)', color: 'var(--color-text-muted)' },
    primary: { background: 'var(--color-primary-tint)', color: 'var(--color-primary)' },
    danger: { background: 'var(--color-danger-soft)', color: 'var(--color-danger)' },
};

export default function IconButton({
    tone = 'ghost',
    size = 36,
    round = false,
    style,
    children,
    ...props
}) {
    return (
        <button
            type="button"
            {...props}
            style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                border: 'none',
                cursor: 'pointer',
                fontSize: 'var(--text-xl)',
                ...(round
                    ? { width: `${size}px`, height: `${size}px`, borderRadius: '50%', padding: 0 }
                    : { minWidth: `${size}px`, minHeight: `${size}px`, borderRadius: 'var(--radius-md)', padding: '8px' }),
                ...TONES[tone],
                ...style,
            }}
        >
            {children}
        </button>
    );
}
