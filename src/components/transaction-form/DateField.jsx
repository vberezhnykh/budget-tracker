import { useEffect, useRef, useState } from 'react';
import Chip from '../ui/Chip';
import { FORM_CHIP_STYLE } from './chipStyle';
import Field, { FormLabel } from '../ui/Field';
import { MIN_DATE, toLocalDateInput } from '../../utils/period';

// 'YYYY-MM-DD' -> «5 окт.»; год добавляем только для чужого года
const formatShortDate = (value) => {
    const [y, m, d] = value.split('-').map(Number);
    if (!y || !m || !d) return value;
    return new Date(y, m - 1, d).toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'short',
        ...(y !== new Date().getFullYear() ? { year: 'numeric' } : {}),
    });
};

// Дата: быстрые чипы вместо крупного поля - почти всегда нужна сегодняшняя
// или вчерашняя дата. value - 'YYYY-MM-DD'.
export default function DateField({ value, onChange }) {
    const today = toLocalDateInput();
    const yesterdayDate = new Date();
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterday = toLocalDateInput(yesterdayDate);
    const showYesterday = yesterday >= MIN_DATE;

    // «Другая…»: нативное поле даты открывается по нажатию, а у операции со
    // старой датой видно сразу - иначе дату не увидеть и не поправить.
    const [customOpen, setCustomOpen] = useState(false);
    const [focusTick, setFocusTick] = useState(0);
    const inputRef = useRef(null);
    const isCustom = value !== today && !(showYesterday && value === yesterday);
    const showInput = customOpen || isCustom;
    const pick = (date) => {
        setCustomOpen(false);
        onChange(date);
    };
    const openCustom = () => {
        setCustomOpen(true);
        setFocusTick(t => t + 1);
    };
    useEffect(() => {
        if (!focusTick) return;
        const input = inputRef.current;
        if (!input) return;
        input.focus();
        try { input.showPicker?.(); } catch { /* пикер доступен не везде */ }
    }, [focusTick]);

    return (
        <div>
            <FormLabel htmlFor="transaction-date">Дата</FormLabel>
            <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                <Chip
                    shape="block"
                    selected={!showInput && value === today}
                    onClick={() => pick(today)}
                    style={FORM_CHIP_STYLE}
                >
                    Сегодня
                </Chip>
                {showYesterday && (
                    <Chip
                        shape="block"
                        selected={!showInput && value === yesterday}
                        onClick={() => pick(yesterday)}
                        style={FORM_CHIP_STYLE}
                    >
                        Вчера
                    </Chip>
                )}
                <Chip
                    shape="block"
                    selected={showInput}
                    onClick={openCustom}
                    style={FORM_CHIP_STYLE}
                >
                    {showInput && value ? formatShortDate(value) : 'Другая…'}
                </Chip>
            </div>
            {showInput && (
                <Field
                    id="transaction-date"
                    ref={inputRef}
                    type="date"
                    tone="outline"
                    value={value}
                    min={MIN_DATE}
                    max={today}
                    onChange={e => onChange(e.target.value)}
                    style={{
                        width: '100%',
                        minHeight: '48px',
                        display: 'block',
                        margin: 'var(--space-3) 0 0',
                        // родное оформление поля даты в iOS/Safari
                        // сбивается только этими четырьмя строками
                        fontFamily: 'inherit',
                        colorScheme: 'light',
                        WebkitAppearance: 'none',
                        appearance: 'none'
                    }}
                />
            )}
        </div>
    );
}
