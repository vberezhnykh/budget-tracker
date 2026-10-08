import { CircleAlert, Info, RotateCw } from 'lucide-react';

// Встроенное сообщение внутри экрана: «данные устарели», ошибка сохранения,
// пояснение к прогнозу. В отличие от тоста не исчезает само и не плавает
// поверх содержимого - это часть страницы.
//
// Тон - это важность, а не цвет:
//   warning - можно жить дальше, но данные не свежие (иконка «обновить»,
//             role="status": читалка скажет об этом, не перебивая);
//   danger  - что-то не сохранилось (role="alert": читается сразу);
//   neutral - просто пояснение.
// Действие справа (например, «Повторить») - небольшая кнопка в цвет текста
// плашки, а не заливная: плашка не должна кричать громче самой причины.

const TONES = {
    warning: {
        background: 'var(--color-warning-soft)',
        color: 'var(--color-warning-text)',
        role: 'status',
        Icon: RotateCw,
    },
    danger: {
        background: 'var(--color-danger-soft)',
        color: 'var(--color-danger-text)',
        role: 'alert',
        Icon: CircleAlert,
    },
    neutral: {
        background: 'var(--color-surface-muted)',
        color: 'var(--color-text-main)',
        role: 'status',
        Icon: Info,
    },
};

export default function InlineAlert({ tone = 'neutral', title, children, action }) {
    const { background, color, role, Icon } = TONES[tone] || TONES.neutral;

    return (
        <div
            role={role}
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-3)',
                padding: 'var(--space-3) var(--space-4)',
                borderRadius: 'var(--radius-md)',
                background,
                color,
                fontSize: 'var(--text-md)',
            }}
        >
            <Icon size={18} aria-hidden="true" />
            <div style={{ flex: 1, minWidth: 0 }}>
                {title != null && <div style={{ fontWeight: 'var(--weight-strong)' }}>{title}</div>}
                {children != null && <div>{children}</div>}
            </div>
            {action && (
                <button
                    type="button"
                    onClick={action.onClick}
                    disabled={action.disabled}
                    style={{
                        flexShrink: 0,
                        minHeight: '44px',
                        padding: '0 var(--space-3)',
                        background: 'transparent',
                        color: 'inherit',
                        border: '1px solid currentColor',
                        borderRadius: 'var(--radius-sm)',
                        font: 'inherit',
                        fontSize: 'var(--text-base)',
                        fontWeight: 'var(--weight-label)',
                        cursor: action.disabled ? 'not-allowed' : 'pointer',
                        opacity: action.disabled ? 0.6 : 1,
                    }}
                >
                    {action.label}
                </button>
            )}
        </div>
    );
}
