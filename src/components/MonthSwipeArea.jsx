import { useRef } from 'react';
import { MIN_MONTH, getCurrentMonth } from '../utils/period';

// Листание месяцев горизонтальным свайпом по карточке со сводкой. До этого
// сменить месяц можно было только через чип периода - три касания (открыть
// лист, найти месяц, выбрать) там, где на телефоне ожидается одно движение.
//
// Свайп влево двигает вперёд по времени, вправо - назад: карточка ведёт себя
// как лента месяцев, где следующий лежит справа.
//
// Границы те же, что и у выпадающего списка (см. utils/period.js): раньше
// MIN_MONTH данных нет, позже текущего месяца - будущее. На краю свайп
// просто не срабатывает.

// Порог: ниже - это дрожание пальца при нажатии, а не листание. Отдельно
// требуем, чтобы движение было явно горизонтальным (в полтора раза больше
// вертикального), иначе прокрутка страницы пальцем по карточке через раз
// перескакивала бы месяц.
const SWIPE_MIN_DISTANCE = 48;
const SWIPE_HORIZONTAL_RATIO = 1.5;

const shiftMonth = (month, delta) => {
    const [year, m] = month.split('-').map(Number);
    const date = new Date(Date.UTC(year, m - 1 + delta, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
};

export default function MonthSwipeArea({ enabled, selectedMonth, onSelectMonth, children, className, style }) {
    const gestureRef = useRef(null);
    // Свайп заканчивается там же, где лежит кнопка (кольцо расхода
    // переключает фильтр по расходам), и браузер после жеста присылает по
    // ней обычный click. Флаг гасит именно этот щелчок, чтобы листание
    // месяца не включало заодно фильтр.
    const swipedRef = useRef(false);

    const handlePointerDown = (e) => {
        if (!enabled) return;
        gestureRef.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    };

    const handlePointerUp = (e) => {
        const start = gestureRef.current;
        gestureRef.current = null;
        if (!enabled || !start || start.id !== e.pointerId) return;

        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        if (Math.abs(dx) < SWIPE_MIN_DISTANCE) return;
        if (Math.abs(dx) < Math.abs(dy) * SWIPE_HORIZONTAL_RATIO) return;

        const next = shiftMonth(selectedMonth, dx < 0 ? 1 : -1);
        if (next < MIN_MONTH || next > getCurrentMonth()) return;

        swipedRef.current = true;
        onSelectMonth(next);
    };

    const handlePointerCancel = () => {
        gestureRef.current = null;
    };

    const handleClickCapture = (e) => {
        if (!swipedRef.current) return;
        swipedRef.current = false;
        e.preventDefault();
        e.stopPropagation();
    };

    return (
        <div
            className={className}
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            onClickCapture={handleClickCapture}
            // Вертикальный жест остаётся системе - страница должна
            // прокручиваться пальцем и по карточке тоже.
            style={{ touchAction: 'pan-y', ...style }}
        >
            {children}
        </div>
    );
}
