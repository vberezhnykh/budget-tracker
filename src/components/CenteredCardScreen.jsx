// Экран из одной белой карточки по центру серой страницы: вход, «данные не
// загрузились», запасной экран ErrorBoundary. У всех трёх один и тот же
// каркас (плитка с иконкой, заголовок, пояснение, кнопка под ними), поэтому
// он собран здесь, а не повторён в каждом файле.
//
// Плитка бывает двух видов: primary (фирменная, на входе - это «приложение»)
// и muted (серая, на экранах ошибок - значок не должен кричать). Размер
// плитки задаёт вызывающий: вход рисуется 48px, ошибки 56px.
// Скругление карточки 28px - оно есть только у этих экранов, общего токена
// на него нет.

const TILES = {
    primary: { background: 'var(--color-primary)', color: 'var(--color-text-inverse)' },
    muted: { background: 'var(--color-surface-muted)', color: 'var(--color-text-muted)' },
};

export default function CenteredCardScreen({
    icon,
    tileTone = 'muted',
    tileSize = 56,
    title,
    children,
    role,
}) {
    return (
        <div
            style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                minHeight: '100vh',
                boxSizing: 'border-box',
                padding: 'var(--space-5)',
            }}
        >
            <div
                role={role}
                style={{
                    width: '100%',
                    maxWidth: '380px',
                    boxSizing: 'border-box',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 'var(--space-4)',
                    padding: 'var(--space-6)',
                    background: 'var(--color-surface)',
                    borderRadius: '28px',
                    textAlign: 'center',
                }}
            >
                <div
                    aria-hidden="true"
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: `${tileSize}px`,
                        height: `${tileSize}px`,
                        borderRadius: 'var(--radius-lg)',
                        ...TILES[tileTone],
                    }}
                >
                    {icon}
                </div>
                <h1 style={{ margin: 0, fontSize: 'var(--text-3xl)', fontWeight: 'var(--weight-strong)', color: 'var(--color-text-main)' }}>
                    {title}
                </h1>
                {children}
            </div>
        </div>
    );
}
