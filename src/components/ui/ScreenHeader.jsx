import { ChevronLeft } from 'lucide-react';

// Шапка экрана. Два вида:
//
//   - вложенный экран (передан onBack): сверху ряд с кнопкой «назад» -
//     шеврон и видимая подпись, куда вернёмся («Ещё»), справа действия;
//     ниже заголовок. Подпись видимая, а не только aria-label: человек
//     должен видеть, куда его вернёт, до нажатия;
//   - экран вкладки (onBack нет): один ряд - заголовок слева, действия
//     справа. Возвращаться некуда, поэтому кнопки «назад» нет.
//
// Заголовок - всегда <h1>: на экране он один, и по нему читалка понимает,
// где человек находится.

const backButtonStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 'var(--space-1)',
    minHeight: '44px',
    padding: '0 var(--space-3) 0 0',
    background: 'transparent',
    border: 'none',
    color: 'var(--color-primary)',
    font: 'inherit',
    fontSize: 'var(--text-xl)',
    fontWeight: 'var(--weight-label)',
    cursor: 'pointer',
};

const titleStyle = {
    margin: 0,
    fontSize: 'var(--text-title)',
    fontWeight: 'var(--weight-strong)',
    lineHeight: 1.2,
};

export default function ScreenHeader({ title, onBack, backLabel, actions }) {
    if (!onBack) {
        return (
            <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', minHeight: '44px' }}>
                <h1 style={titleStyle}>{title}</h1>
                {actions != null && <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>{actions}</div>}
            </header>
        );
    }

    return (
        <header style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
                <button type="button" onClick={onBack} style={backButtonStyle}>
                    <ChevronLeft size={20} aria-hidden="true" />
                    {backLabel}
                </button>
                {actions != null && <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>{actions}</div>}
            </div>
            <h1 style={titleStyle}>{title}</h1>
        </header>
    );
}
