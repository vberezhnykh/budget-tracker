// Пустое состояние: список без записей, экран до первой операции. Иконка
// в плитке, короткий заголовок, одно-два предложения пояснения и, если есть
// что предложить, действие под ними. Блок по центру и узкий (около 300px):
// длинная строка пояснения на экране телефона читается хуже короткой.

export default function EmptyState({ icon, title, description, actions }) {
    return (
        <div
            style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                textAlign: 'center',
                gap: 'var(--space-3)',
                padding: 'var(--space-8) var(--space-4)',
            }}
        >
            {icon != null && (
                <div
                    aria-hidden="true"
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: '56px',
                        height: '56px',
                        borderRadius: 'var(--radius-lg)',
                        background: 'var(--color-surface)',
                        color: 'var(--color-text-muted)',
                    }}
                >
                    {icon}
                </div>
            )}
            <div style={{ maxWidth: '300px', display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                <div style={{ fontSize: '1.05rem', fontWeight: 'var(--weight-strong)' }}>{title}</div>
                {description != null && (
                    <div style={{ fontSize: 'var(--text-md)', color: 'var(--color-text-muted)' }}>{description}</div>
                )}
            </div>
            {actions != null && (
                <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 'var(--space-2)' }}>{actions}</div>
            )}
        </div>
    );
}
