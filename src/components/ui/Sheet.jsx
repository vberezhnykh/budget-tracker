// Модальный лист, выезжающий снизу: настройки, форма операции, выбор
// периода. Лист лежит на нижней кромке экрана и занимает всю ширину -
// «карточкой» его делает не рамка, а оставленный сверху просвет. Поэтому
// скруглены только верхние углы: нижние резали бы край экрана.
//
// Все три листа описывали эту конструкцию заново и разошлись в мелочах:
// затемнение под ними было трёх разных цветов (два разных «сланцевых»
// плюс разная прозрачность), у одного не было размытия, у другого -
// скругление 20px вместо 24, у третьего - своя тень. Здесь всё это одно.
//
// Отдельная история - движение. Форма операции просила `slideUp`, но такой
// анимации в проекте не существовало: лист появлялся рывком. Затемнение
// проявляется анимацией `overlayIn` - через цвет и размытие. Обе объявлены
// в index.css и применяются здесь - ко всем листам одинаково.
//
// Прокрутка: скроллится и сам лист (когда содержимое выше экрана), и
// подложка под ним - иначе на коротком экране до нижней части высокой
// формы не добраться. touchAction: 'pan-y' оставляет системе вертикальный
// жест и отбирает горизонтальный, чтобы боковой жест на листе не уходил
// в экран под ним.
//
// А вот страница под листом двигаться не должна. Само по себе это не
// получается: подложка прокручиваема, и когда её содержимое короче экрана,
// браузер передаёт жест дальше - главному экрану. Отсюда две меры:
// overscrollBehavior: 'contain' обрывает эту передачу, а на время жизни
// листа страница фиксируется - см. utils/useBodyScrollLock, тем же
// страница фиксируется на всё время, пока лист открыт.

import { useEffect, useLayoutEffect, useRef } from 'react';
import useBodyScrollLock from '../../utils/useBodyScrollLock';

export default function Sheet({
    ariaLabel,
    onClose,
    maxHeight = '92vh',
    gap = 'var(--space-5)',
    overlayStyle,
    style,
    children,
}) {
    useBodyScrollLock();
    const dialogRef = useRef(null);
    const onCloseRef = useRef(onClose);

    useLayoutEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);

    useEffect(() => {
        const previouslyFocused = document.activeElement;
        const dialog = dialogRef.current;
        const focusableSelector = [
            'button:not([disabled])',
            'input:not([disabled])',
            'select:not([disabled])',
            'textarea:not([disabled])',
            '[href]',
            '[tabindex]:not([tabindex="-1"])',
        ].join(',');
        const getFocusable = () => Array.from(dialog?.querySelectorAll(focusableSelector) || []);

        (getFocusable()[0] || dialog)?.focus();

        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onCloseRef.current?.();
                return;
            }
            if (event.key !== 'Tab') return;

            const focusable = getFocusable();
            if (focusable.length === 0) {
                event.preventDefault();
                dialog?.focus();
                return;
            }
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            } else if (!dialog?.contains(document.activeElement)) {
                event.preventDefault();
                first.focus();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus({ preventScroll: true });
        };
    }, []);

    return (
        <div
            onClick={onClose}
            style={{
                position: 'fixed',
                inset: 0,
                display: 'flex',
                alignItems: 'flex-end',
                justifyContent: 'center',
                zIndex: 1000,
                overflowY: 'auto',
                overflowX: 'hidden',
                overscrollBehavior: 'contain',
                touchAction: 'pan-y',
                WebkitOverflowScrolling: 'touch',
                ...overlayStyle,
            }}
        >
            {/* Затемнение с размытием - отдельный слой рядом с листом, а не
                обёртка вокруг него. Пока лист внутри элемента с
                backdrop-filter выезжал (slideUp), Safari накладывал затемнение
                дважды: экран темнел сильнее нужного и в конце анимации рывком
                светлел. Слой fixed, поэтому не уезжает при прокрутке
                подложки; нажатие на него закрывает лист через onClick
                обёртки. */}
            <div
                aria-hidden="true"
                style={{
                    position: 'fixed',
                    inset: 0,
                    background: 'var(--color-overlay)',
                    backdropFilter: 'blur(8px)',
                    WebkitBackdropFilter: 'blur(8px)',
                    animation: 'overlayIn 0.2s ease-out',
                }}
            />
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-label={ariaLabel}
                tabIndex={-1}
                onClick={(e) => e.stopPropagation()}
                style={{
                    position: 'relative',
                    background: 'var(--color-surface)',
                    width: '100%',
                    maxWidth: '520px',
                    borderRadius: 'var(--radius-xl) var(--radius-xl) 0 0',
                    boxShadow: 'var(--shadow-sheet)',
                    // нижний отступ крупнее: под ним домашний индикатор iOS,
                    // перекрывающий последнюю строку листа
                    padding: 'var(--space-6) var(--space-5) calc(var(--space-6) + env(safe-area-inset-bottom, 0px))',
                    maxHeight,
                    overflowY: 'auto',
                    overflowX: 'hidden',
                    overscrollBehavior: 'contain',
                    display: 'flex',
                    flexDirection: 'column',
                    gap,
                    margin: 0,
                    animation: 'slideUp 0.3s ease-out',
                    touchAction: 'pan-y',
                    ...style,
                }}
            >
                {children}
            </div>
        </div>
    );
}
