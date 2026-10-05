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
                gap: scrollAlways ? '8px' : '12px',
                overflowX: scrolls ? 'auto' : 'visible',
                paddingBottom: scrolls ? '8px' : '0'
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
                        gap: '8px',
                        minWidth: scrolls && !scrollAlways ? '120px' : 'auto',
                        padding: scrollAlways ? '10px 12px' : '12px',
                        fontWeight: '600',
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
