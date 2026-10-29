import { useEffect, useRef } from 'react';
import { Check, Minus } from 'lucide-react';

// Флажок: настоящий <input type="checkbox"> плюс нарисованный квадрат. Родной
// флажок на iPhone и в десктопных браузерах выглядит по-разному и не
// перекрашивается под цвета приложения (accent-color красит только галочку), а
// собственная кнопка с role="checkbox" теряет клавиатуру и родное «частично».
// Поэтому input остаётся в разметке - он и держит фокус, пробел, aria и
// indeterminate, - но невидим и лежит поверх квадрата, а вид рисует соседний
// span.
//
// Три состояния:
//   выключен  - белый квадрат с рамкой;
//   включён   - фирменная заливка с белой галочкой;
//   mixed     - та же заливка с белым минусом: у общего флажка блока выбрана
//               часть вариантов. На input это indeterminate, и читалка
//               называет такой флажок «частично».
//
// Кольцо фокуса рисует index.css (.ui-checkbox-input:focus-visible), потому
// что псевдоклассы инлайном не задать. Предназначен для строки-label: нажатие
// на подпись нажимает и флажок, поэтому свою подпись компонент не несёт.
// `style` относится к обёртке (поля и выравнивание), остальные props - к input.

const SIZE = '22px';

export default function Checkbox({ checked = false, mixed = false, onChange, style, ...props }) {
    const inputRef = useRef(null);
    useEffect(() => {
        if (inputRef.current) inputRef.current.indeterminate = mixed;
    }, [mixed]);

    const on = checked || mixed;
    const Icon = mixed ? Minus : Check;

    return (
        <span style={{ position: 'relative', display: 'inline-flex', flex: `0 0 ${SIZE}`, width: SIZE, height: SIZE, ...style }}>
            <input
                {...props}
                ref={inputRef}
                type="checkbox"
                className="ui-checkbox-input"
                checked={checked}
                onChange={onChange}
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', margin: 0, opacity: 0, cursor: 'pointer' }}
            />
            <span
                aria-hidden="true"
                className="ui-checkbox-box"
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: SIZE,
                    height: SIZE,
                    boxSizing: 'border-box',
                    borderRadius: '7px',
                    border: `1.5px solid ${on ? 'var(--color-primary)' : 'var(--color-control-off)'}`,
                    background: on ? 'var(--color-primary)' : 'var(--color-surface)',
                    color: 'var(--color-text-inverse)',
                    transition: 'background 0.15s ease, border-color 0.15s ease',
                }}
            >
                {on && <Icon size={14} strokeWidth={3} />}
            </span>
        </span>
    );
}
