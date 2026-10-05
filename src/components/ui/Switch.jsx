// Тумблер «включено / выключено». Раньше таких было два, оба - <div> с
// onClick: с клавиатуры до них не добраться, а скринридер не знал, что это
// переключатель. Здесь это <button role="switch">: Tab/Space/Enter работают
// сами, а подпись внутри кнопки становится её доступным именем.
//
// Тон задаёт и цвет акцента, и раскладку - так сложилось на двух экранах:
//
//   primary  - «Разделить на несколько категорий»: дорожка слева, подпись
//              справа, строка на подложке. Включённое - обычное действие.
//   negative - «Не считать в статистике»: подпись слева, дорожка справа,
//              красный акцент во включённом виде - настройка выводит
//              операцию из учёта и не должна быть незаметной.
//
// Размеры дорожки и ручки у тонов разные (20 и 22px высотой) - оставлены
// как были, чтобы вид экранов не поменялся.

const TONES = {
    primary: {
        row: () => ({
            gap: '12px',
            padding: '12px',
            background: 'var(--color-surface-sunken)',
            border: '1px solid var(--color-border-subtle)',
        }),
        trackFirst: true,
        track: { width: 40, height: 20, thumb: 16, travel: 20, onColor: 'var(--color-primary)', transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)' },
        label: on => ({ fontWeight: '500', color: on ? 'var(--color-text-main)' : 'var(--color-text-muted)', fontSize: 'var(--text-md)' }),
    },
    negative: {
        row: on => ({
            justifyContent: 'space-between',
            padding: '10px 14px',
            border: '1px solid',
            borderColor: on ? 'var(--color-danger-border)' : 'var(--color-border)',
            background: on ? 'var(--color-danger-faint)' : 'var(--color-surface)',
            userSelect: 'none',
        }),
        trackFirst: false,
        track: { width: 40, height: 22, thumb: 18, travel: 18, onColor: 'var(--color-negative)', transition: 'all 0.2s' },
        label: on => ({ color: on ? 'var(--color-negative)' : 'var(--color-text-muted)', fontSize: 'var(--text-base)' }),
    },
};

export default function Switch({ checked, onChange, label, tone = 'primary', style }) {
    const t = TONES[tone];
    const { width, height, thumb, travel, onColor, transition } = t.track;
    const track = (
        <span
            aria-hidden="true"
            style={{
                display: 'block',
                flexShrink: 0,
                position: 'relative',
                width: `${width}px`,
                height: `${height}px`,
                background: checked ? onColor : 'var(--color-control-off)',
                borderRadius: 'var(--radius-pill)',
                transition,
            }}
        >
            <span style={{
                display: 'block',
                position: 'absolute',
                top: '2px',
                left: checked ? `${2 + travel}px` : '2px',
                width: `${thumb}px`,
                height: `${thumb}px`,
                background: 'var(--color-surface)',
                borderRadius: '50%',
                transition,
                boxShadow: 'var(--shadow-thumb)',
            }} />
        </span>
    );
    const text = <span style={t.label(checked)}>{label}</span>;
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            onClick={() => onChange(!checked)}
            style={{
                display: 'flex',
                alignItems: 'center',
                width: '100%',
                textAlign: 'left',
                font: 'inherit',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
                transition: 'all 0.2s',
                ...t.row(checked),
                ...style,
            }}
        >
            {t.trackFirst ? <>{track}{text}</> : <>{text}{track}</>}
        </button>
    );
}
