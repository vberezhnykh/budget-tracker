// Подсказка, которую можно нажать, чтобы подставить текст: подсказки
// комментария в форме операции, вопросы-подсказки на «Аналитике». В отличие
// от Chip это не переключатель, а обычная кнопка: у неё нет «выбрано», поэтому
// нет и aria-pressed. Раньше подсказки в форме и в «Вопросах к данным» были
// нарисованы вручную и разошлись цветом текста, фоном и скруглением; здесь
// их вид один - серая «таблетка» в рамке, заметно тише чипов выбора.
//
// `style` остаётся для раскладки (flex, maxWidth, обрезка длинного текста) и
// накладывается последним; остальные свойства уходят в button.

export default function HintChip({ style, children, ...props }) {
    return (
        <button
            type="button"
            {...props}
            style={{
                minHeight: '36px',
                padding: '0 var(--space-3)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-pill)',
                background: 'var(--color-surface-muted)',
                color: 'var(--color-text-main)',
                font: 'inherit',
                fontSize: 'var(--text-sm)',
                cursor: 'pointer',
                ...style,
            }}
        >
            {children}
        </button>
    );
}
