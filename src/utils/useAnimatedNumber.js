import { useEffect, useState } from 'react';

// Число плавно переезжает от прежнего значения к новому: сумма на Обзоре после
// сохранения операции меняется на глазах, а не вспыхивает другой цифрой.
// Показывается число, которое надо отформатировать на каждом кадре
// (AnimatedMoney делает это через formatMoney); итоговое значение остаётся
// за вызывающим - в aria-label и в тексте для скринридера.

export const TWEEN_DURATION_MS = 350;

// Быстро в начале и мягко в конце: цифры не должны «разгоняться» к финишу.
const easeOut = progress => 1 - (1 - progress) ** 3;

// Анимация нужна не везде: без matchMedia или requestAnimationFrame (тесты в
// jsdom, редкие встроенные браузеры) и при «уменьшить движение» число
// сразу получает итоговое значение. Условие проверяется на каждый запуск, а
// не один раз: настройку в системе могут поменять при открытом приложении.
function canAnimate() {
  if (typeof window === 'undefined') return false;
  if (typeof window.requestAnimationFrame !== 'function' || typeof window.cancelAnimationFrame !== 'function') return false;
  if (typeof window.matchMedia !== 'function') return false;
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// value - целевое число. key - личность величины: «расход за октябрь по всем
// счетам». Пока key тот же, новое value - обновление той же цифры, и она
// плавно едет. Сменился key (другой месяц, другой счёт) или key пуст - это уже
// другое число, и оно появляется сразу. Пустой key вызывающий передаёт, пока
// итоги не готовы: они появятся после ожидания, и бежать к ним от значения-
// заглушки было бы неправдой.
// Возвращает { value, animating }: value - что показать сейчас.
export default function useAnimatedNumber(value, key) {
  // seen* - что было на прошлом рендере. tween - идущая анимация (from -> to)
  // и текущее число shown. Всё в одном состоянии, чтобы решение «анимировать
  // или нет» принималось в том же рендере, где пришло новое значение: иначе
  // на один кадр мелькнуло бы итоговое число, а потом откатилось к началу.
  const [state, setState] = useState({ seenValue: value, seenKey: key, tween: null, shown: value });

  if (state.seenValue !== value || state.seenKey !== key) {
    const comparable = key != null && key === state.seenKey
      && Number.isFinite(value) && Number.isFinite(state.seenValue);
    // Новая цель пришла посреди анимации - едем дальше от того числа, которое
    // сейчас на экране, а не прыгаем к прежней цели.
    const from = state.tween ? state.shown : state.seenValue;
    const tween = comparable && from !== value && canAnimate() ? { from, to: value } : null;
    setState({ seenValue: value, seenKey: key, tween, shown: tween ? from : value });
  }

  const tween = state.tween;
  useEffect(() => {
    if (!tween) return undefined;
    let frame = 0;
    let start = null;
    const step = now => {
      // Начало отсчёта - первый кадр, а не момент запуска эффекта: кадр
      // приходит позже, и первые миллисекунды иначе съелись бы впустую.
      if (start === null) start = now;
      const progress = Math.min((now - start) / TWEEN_DURATION_MS, 1);
      if (progress >= 1) {
        setState(current => (current.tween === tween ? { ...current, tween: null, shown: tween.to } : current));
        return;
      }
      const shown = tween.from + (tween.to - tween.from) * easeOut(progress);
      setState(current => (current.tween === tween ? { ...current, shown } : current));
      frame = window.requestAnimationFrame(step);
    };
    frame = window.requestAnimationFrame(step);
    // Уход экрана или новая цель: кадр снимается, чтобы не трогать
    // размонтированный компонент и не гонять два цикла разом.
    return () => window.cancelAnimationFrame(frame);
  }, [tween]);

  return { value: tween ? state.shown : value, animating: tween !== null };
}
