import { useCallback, useEffect, useRef } from 'react';

// Общая механика горизонтальной карусели со снапом: по ней листаются и счета
// в шапке, и месяцы в карточке сводки. Ровно из-за этой механики в проекте
// уже случилось три бага (см. комментарии в e2e/smoke.spec.js), поэтому
// второй её копии быть не должно.
//
// Что здесь важного:
//
// 1. Слайды ищутся по data-carousel-slide, а не по container.children -
//    случайный посторонний ребёнок (когда-то это был <style>) иначе сдвигает
//    все индексы на единицу.
// 2. Выбор фиксируется не на каждом событии прокрутки, а когда они перестали
//    приходить: свайп через несколько слайдов не должен по очереди выбирать
//    каждый промежуточный.
// 3. Прокрутка, которую запустили мы сами (нажатие на слайд или изменение
//    выбора снаружи), помечается флагом: у неё точка назначения уже известна,
//    и позволить осевшей прокрутке переопределить её - значит иногда
//    промахиваться мимо цели.
// 4. Ближайший слайд ищется по настоящим offsetLeft/offsetWidth, а не по
//    «предполагаемой ширине слайда»: ширины могут отличаться, а в jsdom они
//    вообще нулевые - там мы честно ничего не выбираем.

const SETTLE_DELAY_MS = 120;

export default function useSnapCarousel({ onSettle }) {
    const containerRef = useRef(null);
    // Индекс, к которому нас просили прокрутиться, пока прокручивать было
    // нечего: на первом рендере экран занят «Загрузка...», карусели в дереве
    // ещё нет, а эффект синхронизации уже отработал.
    const pendingIndexRef = useRef(null);
    const rafRef = useRef(null);
    const settleTimeoutRef = useRef(null);
    const programmaticRef = useRef(false);
    const syncedIndexRef = useRef(0);
    // onSettle пересоздаётся на каждый рендер вызывающего компонента, а
    // подписки и таймеры ниже перезапускаться от этого не должны. Обновляем
    // ссылку в эффекте, а не прямо в рендере: во время рендера ref трогать
    // нельзя, и React об этом справедливо ругается.
    const onSettleRef = useRef(onSettle);
    useEffect(() => {
        onSettleRef.current = onSettle;
    });

    const getSlideElements = useCallback(() => {
        const container = containerRef.current;
        if (!container) return [];
        return Array.from(container.querySelectorAll('[data-carousel-slide]'));
    }, []);

    const commitSettledSlide = useCallback(() => {
        settleTimeoutRef.current = null;
        const wasProgrammatic = programmaticRef.current;
        programmaticRef.current = false;
        if (wasProgrammatic) return;

        const container = containerRef.current;
        const slideEls = getSlideElements();
        if (!container || !slideEls.length) return;

        const containerCenter = container.scrollLeft + container.clientWidth / 2;
        let nearestIndex = -1;
        let nearestDistance = Infinity;
        let hasLayout = false;
        slideEls.forEach((el, i) => {
            if (el.offsetWidth > 0 || el.offsetLeft > 0) hasLayout = true;
            const center = el.offsetLeft + el.offsetWidth / 2;
            const distance = Math.abs(center - containerCenter);
            if (distance < nearestDistance) {
                nearestDistance = distance;
                nearestIndex = i;
            }
        });
        if (!hasLayout || nearestIndex === -1) return;

        syncedIndexRef.current = nearestIndex;
        onSettleRef.current?.(nearestIndex);
    }, [getSlideElements]);

    const scheduleSettle = useCallback(() => {
        if (settleTimeoutRef.current) clearTimeout(settleTimeoutRef.current);
        settleTimeoutRef.current = setTimeout(commitSettledSlide, SETTLE_DELAY_MS);
    }, [commitSettledSlide]);

    const handleScroll = useCallback(() => {
        if (rafRef.current) return;
        rafRef.current = requestAnimationFrame(() => {
            rafRef.current = null;
            scheduleSettle();
        });
    }, [scheduleSettle]);

    // Прокрутить к слайду самим. skipIfSynced - для синхронизации с внешним
    // выбором: если мы уже приводили карусель к этому слайду, второй раз
    // дёргать её незачем.
    const scrollToIndex = useCallback((index, { skipIfSynced = false } = {}) => {
        if (skipIfSynced && index === syncedIndexRef.current) return;
        syncedIndexRef.current = index;
        const slideEl = getSlideElements()[index];
        if (!slideEl) {
            // Карусели ещё нет в дереве - запомним, куда встать, и сделаем
            // это, когда контейнер появится (см. setContainer).
            pendingIndexRef.current = index;
            return;
        }
        programmaticRef.current = true;
        // Флаг обязан сняться, даже если прокрутки не случится вовсе -
        // например, слайд уже по центру.
        scheduleSettle();
        // jsdom не реализует scrollIntoView - зовём осторожно.
        slideEl.scrollIntoView?.({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }, [getSlideElements, scheduleSettle]);

    // Контейнер вешается через callback-ref, а не через обычный: карусель
    // может появиться позже первого рендера (пока грузятся данные) и заново -
    // при переключении вкладок. В обоих случаях она рождается с нулевой
    // прокруткой, и её надо сразу поставить на выбранный слайд, иначе экран
    // показывает первый месяц истории, а чип периода - совсем другой.
    // Прыжком, без анимации: анимировать появление ленты не из чего.
    const setContainer = useCallback((el) => {
        containerRef.current = el;
        if (!el) return;
        const index = pendingIndexRef.current ?? syncedIndexRef.current;
        pendingIndexRef.current = null;
        if (!index) return;
        const slideEl = getSlideElements()[index];
        if (!slideEl) return;
        // Флаг «прокрутку двигаем мы» здесь не нужен, в отличие от плавной
        // прокрутки: прыжок сразу попадает в цель, и осевшая прокрутка
        // выберет ровно тот слайд, на который мы встали. Зато лишний
        // взведённый флаг проглотил бы следующее движение пальцем.
        slideEl.scrollIntoView?.({ behavior: 'auto', inline: 'center', block: 'nearest' });
    }, [getSlideElements]);

    useEffect(() => () => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        if (settleTimeoutRef.current) clearTimeout(settleTimeoutRef.current);
    }, []);

    return { setContainer, handleScroll, scrollToIndex, getSlideElements };
}
