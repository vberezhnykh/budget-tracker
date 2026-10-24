// Держит элемент на том же месте экрана, пока содержимое над ним меняет
// высоту. Нужен Safari: там нет scroll anchoring, и при выборе месяца на
// графике страница уезжала - над графиками меняется число строк в категориях
// и сам темп трат, причём дважды: сразу и когда придут итоги нового месяца.
//
// Каждый кадр сверяем положение элемента с исходным и докручиваем страницу на
// разницу - до отрисовки, поэтому сдвига не видно. Держим, пока пользователь
// сам не тронет экран, или до таймаута; новый вызов отменяет прежний.

const HOLD_MS = 6000;
const STOP_EVENTS = ['touchstart', 'wheel', 'mousedown'];

let stopCurrent = null;

export default function holdScrollAnchor(element, { timeout = HOLD_MS } = {}) {
    stopCurrent?.();
    if (!element?.isConnected || typeof requestAnimationFrame !== 'function') return;
    const startTop = element.getBoundingClientRect().top;
    const started = performance.now();
    let frame = 0;

    const stop = () => {
        cancelAnimationFrame(frame);
        STOP_EVENTS.forEach(type => window.removeEventListener(type, stop, { capture: true }));
        if (stopCurrent === stop) stopCurrent = null;
    };
    const tick = now => {
        if (!element.isConnected || now - started > timeout) {
            stop();
            return;
        }
        const delta = element.getBoundingClientRect().top - startTop;
        if (Math.abs(delta) >= 0.5) window.scrollBy(0, delta);
        frame = requestAnimationFrame(tick);
    };

    STOP_EVENTS.forEach(type => window.addEventListener(type, stop, { capture: true, passive: true }));
    frame = requestAnimationFrame(tick);
    stopCurrent = stop;
}
