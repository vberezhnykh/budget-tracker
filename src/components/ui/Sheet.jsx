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
// анимации в проекте не существовало: лист появлялся рывком. `fadeIn`
// существовала, но её удалили вместе с неиспользуемым классом
// `.animate-fade-in`. Обе теперь объявлены в index.css и применяются
// здесь - ко всем листам одинаково.
//
// Прокрутка: скроллится и сам лист (когда содержимое выше экрана), и
// подложка под ним - иначе на коротком экране до нижней части высокой
// формы не добраться. touchAction: 'pan-y' оставляет системе вертикальный
// жест и отбирает горизонтальный, чтобы свайп по листу не листал карусель
// счетов под ним.
//
// А вот страница под листом двигаться не должна. Само по себе это не
// получается: подложка прокручиваема, и когда её содержимое короче экрана,
// браузер передаёт жест дальше - главному экрану. Отсюда две меры:
// overscrollBehavior: 'contain' обрывает эту передачу, а на время жизни
// листа страница фиксируется (см. useBodyScrollLock ниже).

import { useEffect } from 'react';

// Фиксация страницы под листом. Одного `overflow: hidden` на body мало:
// в мобильном Safari он не останавливает касание, поэтому страница ещё и
// переводится в position: fixed со сдвигом на текущую прокрутку - так она
// остаётся на месте визуально. При закрытии прокрутка возвращается: без
// этого экран прыгал бы наверх.
//
// Счётчик нужен на случай, когда листов открыто два (выбор периода поверх
// другого листа): фиксировать надо на первом, а возвращать прокрутку - на
// последнем закрытом, иначе второй лист запомнил бы уже обнулённую
// позицию и вернул экран не туда.
let lockCount = 0;
let lockedScrollY = 0;

function useBodyScrollLock() {
    useEffect(() => {
        const { body } = document;
        if (lockCount === 0) {
            lockedScrollY = window.scrollY;
            body.style.overflow = 'hidden';
            body.style.position = 'fixed';
            body.style.width = '100%';
            body.style.top = `-${lockedScrollY}px`;
        }
        lockCount += 1;

        return () => {
            lockCount -= 1;
            if (lockCount === 0) {
                body.style.overflow = '';
                body.style.position = '';
                body.style.width = '';
                body.style.top = '';
                // Чтение offsetHeight заставляет браузер пересчитать
                // раскладку прямо здесь. Без этого страница ещё «сложена»
                // (body только что был вынут из потока), её высота меньше
                // прокрутки, и scrollTo обрезается до нуля - экран прыгает
                // наверх. Заметно это в первую очередь в dev-сборке, где
                // StrictMode монтирует эффект дважды и второй заход
                // считывает уже обнулённую позицию.
                void body.offsetHeight;
                window.scrollTo(0, lockedScrollY);
            }
        };
    }, []);
}

export default function Sheet({
    ariaLabel,
    onClose,
    maxHeight = '92vh',
    gap = '20px',
    overlayStyle,
    style,
    children,
}) {
    useBodyScrollLock();

    return (
        <div
            onClick={onClose}
            style={{
                position: 'fixed',
                inset: 0,
                background: 'var(--color-overlay)',
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)',
                display: 'flex',
                alignItems: 'flex-end',
                justifyContent: 'center',
                zIndex: 1000,
                animation: 'fadeIn 0.2s ease-out',
                overflowY: 'auto',
                overflowX: 'hidden',
                overscrollBehavior: 'contain',
                touchAction: 'pan-y',
                WebkitOverflowScrolling: 'touch',
                ...overlayStyle,
            }}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-label={ariaLabel}
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
                    padding: '24px 20px calc(24px + env(safe-area-inset-bottom, 0px))',
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
