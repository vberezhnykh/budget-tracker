import { useEffect, useRef } from 'react';
import AccountIcon from '../AccountIcon';
import Chip from '../ui/Chip';

// Ряд чипов счетов: общий для списания/зачисления и для сторон перевода.
// scrollAlways - в узкой строке перевода чипы не сжимаются, а прокручиваются.
// Остальные props (role, aria-label) уходят на сам ряд.
export default function AccountPicker({ accounts, value, onChange, scrollAlways = false, ...props }) {
    const scrolls = scrollAlways || accounts.length > 3;
    const rowRef = useRef(null);
    // Выбранный счёт может оказаться за краем прокрутки - подводим его в
    // видимую часть при открытии формы
    useEffect(() => {
        const row = rowRef.current;
        const chip = row?.querySelector('[aria-pressed="true"]');
        if (row && chip && scrolls) row.scrollLeft = Math.max(0, chip.offsetLeft - row.offsetLeft - 8);
    }, [scrolls]);
    return (
        <div
            {...props}
            ref={rowRef}
            style={{
                display: 'flex',
                gap: scrollAlways ? 'var(--space-2)' : 'var(--space-3)',
                overflowX: scrolls ? 'auto' : 'visible',
                paddingBottom: scrolls ? 'var(--space-2)' : '0'
            }}
        >
            {accounts.map(acc => (
                <Chip
                    key={acc._id}
                    shape="block"
                    selected={value === acc._id}
                    onClick={() => onChange(acc._id)}
                    style={{
                        flex: scrolls ? '0 0 auto' : 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 'var(--space-2)',
                        minWidth: scrolls && !scrollAlways ? '120px' : 'auto',
                        minHeight: '48px',
                        padding: scrollAlways ? 'var(--space-3) var(--space-3)' : 'var(--space-3)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                    }}
                >
                    <AccountIcon icon={acc.icon} type={acc.type} size={18} />
                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{acc.name}</span>
                </Chip>
            ))}
        </div>
    );
}
