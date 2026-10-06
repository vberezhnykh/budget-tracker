// Сегментный переключатель: одна из нескольких взаимоисключающих ячеек на
// общей подложке. До него тип операции в форме (Расход/Доход/Перевод) и
// охват периода (Месяц/Год/Всё время) рисовали одно и то же вручную, и
// только у второго было aria-pressed.
//
// Что действительно разное, остаётся за вызовом: подложка (background) и
// зазор между ячейками - через style, плотность ячеек - через size:
//   md - форма операции (padding 8px, кегль md);
//   lg - выбор периода: ячейки повыше, палец попадает увереннее.

const SIZES = {
    md: { padding: 'var(--space-2)', fontSize: 'var(--text-md)' },
    lg: { padding: 'var(--space-3) var(--space-2)', fontSize: 'var(--text-base)' },
};

export default function SegmentedControl({ options, value, onChange, ariaLabel, size = 'md', style }) {
    return (
        <div
            role="group"
            aria-label={ariaLabel}
            style={{ display: 'flex', padding: 'var(--space-1)', borderRadius: 'var(--radius-md)', ...style }}
        >
            {options.map(option => {
                const active = value === option.id;
                return (
                    <button
                        key={option.id}
                        type="button"
                        aria-pressed={active}
                        onClick={() => onChange(option.id)}
                        style={{
                            flex: 1,
                            border: 'none',
                            borderRadius: 'var(--radius-sm)',
                            background: active ? 'var(--color-surface)' : 'transparent',
                            color: active ? 'var(--color-primary)' : 'var(--color-text-muted)',
                            fontWeight: 'var(--weight-label)',
                            cursor: 'pointer',
                            transition: 'all 0.2s',
                            boxShadow: active ? 'var(--shadow-segment)' : 'none',
                            ...SIZES[size],
                        }}
                    >
                        {option.label}
                    </button>
                );
            })}
        </div>
    );
}
