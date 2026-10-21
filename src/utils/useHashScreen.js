import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

// Экран живёт в location.hash. Вкладки: `#history`, `#analytics`, `#more`;
// Обзор - без хэша вовсе. Внутренние экраны лежат под своей вкладкой: под «Ещё»
// - `#more/accounts`, `#more/categories`, `#more/trash`, `#more/cleanup`, под «Аналитикой» -
// `#analytics/ask` (вопросы к данным). Так обновление страницы возвращает на тот
// же экран, а ссылку на него можно открыть напрямую.
const TAB_SCREENS = ['history', 'analytics', 'more'];
const INNER_SCREENS = {
  more: ['accounts', 'categories', 'trash', 'cleanup'],
  analytics: ['ask'],
};

// Метка в history.state: эту запись создало приложение (openInner), поэтому
// «назад» из внутреннего экрана - это history.back() к записи, из которой
// он был открыт. У записи без метки (страницу открыли сразу на
// `#more/accounts` или перезагрузили) предыдущая запись может вообще
// принадлежать другому сайту, и history.back() увёл бы из приложения.
const PUSHED_MARK = 'budgetInnerPushed';

// Маршрут - строка вида `overview`, `more`, `more/accounts`, `analytics/ask`. Из
// неё же выводятся вкладка и внутренний экран, поэтому состояние хука одно и
// сравнивается как примитив. Внутренний экран годится только под своей
// вкладкой: `#history/accounts` - просто «История».
const readRoute = () => {
  const [tab, inner] = window.location.hash.replace(/^#/, '').split('/');
  if (!TAB_SCREENS.includes(tab)) return 'overview';
  return INNER_SCREENS[tab]?.includes(inner) ? `${tab}/${inner}` : tab;
};

// Вкладка, под которой лежит внутренний экран; имена экранов не повторяются.
const tabOfInner = (name) => TAB_SCREENS.find((tab) => INNER_SCREENS[tab]?.includes(name));

// Порядок вкладок слева направо, как в нижней панели: от него зависит, с какой
// стороны выезжает новый экран.
const TAB_ORDER = ['overview', ...TAB_SCREENS];
const tabRank = (route) => TAB_ORDER.indexOf(route.split('/')[0]);

// С какой стороны выезжает экран при переходе from -> to: 'forward' - справа,
// 'back' - слева. Вкладка правее текущей - вперёд, левее - назад. Внутренний
// экран считается своей вкладкой, поэтому в рамках одной вкладки вперёд - это
// только открытие внутреннего экрана; всё остальное (закрытие, тап по «Ещё»,
// пока открыт внутренний экран «Ещё») - назад.
export const navDirection = (from, to) => {
  const delta = tabRank(to) - tabRank(from);
  if (delta !== 0) return delta > 0 ? 'forward' : 'back';
  return to.includes('/') && !from.includes('/') ? 'forward' : 'back';
};

// Сколько ждать popstate после history.back(), прежде чем забыть, что «назад»
// запросило само приложение. Без срока метка могла бы дожить до чужого
// popstate (жеста Safari) и анимировать его второй раз.
const BACK_MARK_TTL_MS = 1000;

// Выезд экрана делает View Transitions API (Safari 18+, Chromium): браузер
// сам держит снимок старого экрана под новым, и два экрана в DOM не нужны.
// Без API (jsdom, старый Safari) и при «уменьшении движения» экран меняется
// сразу, как и раньше.
const canAnimate = () => typeof document !== 'undefined'
  && typeof document.startViewTransition === 'function'
  && !(typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

const hashOf = (route) => (route === 'overview' ? '' : `#${route}`);

const isPushedByApp = () => Boolean(window.history.state?.[PUSHED_MARK]);

// Без метки запись считается «чужой»: replaceState её сбрасывает, а остальные
// поля state (если их кто-то положил) остаются.
const stateWith = (pushed) => {
  const { [PUSHED_MARK]: _drop, ...rest } = window.history.state || {};
  return pushed ? { ...rest, [PUSHED_MARK]: true } : rest;
};

// Переключение вкладок пишет хэш через replaceState, а не присваиванием
// location.hash: вкладки - это не «страницы», и десять переключений не
// должны оставить десять записей, по которым потом листает жест «назад».
// Запись в историю добавляет только открытие внутреннего экрана (openInner):
// системное «назад» должно закрывать его, а не уводить с вкладки.
//
// replaceState и pushState события hashchange не вызывают, поэтому состояние
// ставится напрямую. Слушатели popstate и hashchange нужны тому, что пришло
// снаружи: жест «назад», хэш поправили руками в адресной строке или перешли
// по ссылке с другим хэшем.
//
// Возвращает { screen, inner, setScreen, openInner, closeInner }: screen -
// вкладка (у внутреннего экрана это его вкладка, она и подсвечена), inner -
// имя внутреннего экрана или null.
//
// Переходы, которые начало приложение (вкладка, открытие и закрытие внутреннего
// экрана), идут через view transition: направление в
// `<html data-nav-direction>` читает index.css. Всё, что пришло снаружи, не
// анимируется: у жеста «назад» в Safari своя анимация, и две подряд выглядели
// бы дёрганьем.
export default function useHashScreen() {
  const [route, setRoute] = useState(readRoute);
  const previousRoute = useRef(route);
  // Куда приложение направляется сейчас. Состояние обновится только внутри
  // перехода (браузер сначала снимает старый экран), поэтому направление
  // считается от этого маршрута, а не от route: при двух быстрых нажатиях
  // второе должно отталкиваться от первого.
  const targetRoute = useRef(route);
  const activeTransition = useRef(null);
  // «Назад» запросило приложение (closeInner), и popstate, который за ним
  // придёт, надо анимировать.
  const backRequested = useRef(false);
  const backTimer = useRef(null);

  const clearBackRequest = useCallback(() => {
    backRequested.current = false;
    clearTimeout(backTimer.current);
  }, []);

  // Показывает маршрут targetRoute.current. Внутри перехода его читают заново,
  // а не берут замкнутое значение: если новое нажатие пропустило старый переход
  // (API так и делает), колбэк старого всё равно выполнится, и он не должен
  // откатить экран назад.
  const showTarget = useCallback((direction) => {
    if (direction && canAnimate()) {
      const root = document.documentElement;
      root.dataset.navDirection = direction;
      let transition;
      try {
        transition = document.startViewTransition(() => {
          flushSync(() => setRoute(targetRoute.current));
        });
      } catch {
        delete root.dataset.navDirection;
        setRoute(targetRoute.current);
        return;
      }
      // Направление снимается, когда переход закончился или был пропущен. Новый
      // переход к этому времени мог уже поставить своё направление, его трогать
      // нельзя.
      activeTransition.current = transition;
      const release = () => {
        if (activeTransition.current !== transition) return;
        activeTransition.current = null;
        delete root.dataset.navDirection;
      };
      transition?.finished?.then(release, release);
      return;
    }
    setRoute(targetRoute.current);
  }, []);

  // Единственное место, где приложение меняет маршрут: direction - null, если
  // анимировать не нужно.
  const goTo = useCallback((next, direction) => {
    const changed = targetRoute.current !== next;
    targetRoute.current = next;
    showTarget(changed ? direction : null);
  }, [showTarget]);

  // Метка живёт в history.state и переживает перезагрузку, а вот «предыдущая
  // запись» после неё - уже не та, из которой экран открывали. Поэтому при
  // загрузке метка снимается: после обновления страницы «назад» из внутреннего
  // экрана заменяет хэш на `#more`, а не листает историю.
  useEffect(() => {
    if (isPushedByApp()) {
      window.history.replaceState(stateWith(false), '', window.location.href);
    }
  }, []);

  // Маршрут уже равен целевому - значит, его поставило приложение: за
  // popstate после history.back() сразу идёт hashchange, и без этой проверки он
  // обновил бы экран до того, как браузер снял старый.
  useEffect(() => {
    const follow = (direction) => {
      const next = readRoute();
      if (next === targetRoute.current) return;
      targetRoute.current = next;
      showTarget(direction);
    };
    const onPopState = () => {
      const wasRequested = backRequested.current;
      clearBackRequest();
      follow(wasRequested ? 'back' : null);
    };
    const onHashChange = () => follow(null);
    window.addEventListener('popstate', onPopState);
    window.addEventListener('hashchange', onHashChange);
    return () => {
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('hashchange', onHashChange);
      clearTimeout(backTimer.current);
      if (activeTransition.current) {
        activeTransition.current = null;
        delete document.documentElement.dataset.navDirection;
      }
    };
  }, [showTarget, clearBackRequest]);

  // Прокрутка к началу - по факту смены экрана, а не в setScreen: так она
  // срабатывает и на переход, пришедший через popstate или hashchange. Новый
  // экран должен открываться с начала, а не с позиции, оставшейся от прошлого.
  useEffect(() => {
    if (previousRoute.current === route) return;
    previousRoute.current = route;
    window.scrollTo(0, 0);
  }, [route]);

  const replaceRoute = useCallback((next, direction) => {
    const { pathname, search } = window.location;
    window.history.replaceState(stateWith(false), '', `${pathname}${search}${hashOf(next)}`);
    goTo(next, direction);
  }, [goTo]);

  // Любая вкладка, в том числе «Ещё» из внутреннего экрана, заменяет текущую
  // запись: внутренний экран при этом закрывается без шага «назад».
  const setScreen = useCallback((next) => {
    const target = TAB_SCREENS.includes(next) ? next : 'overview';
    replaceRoute(target, navDirection(targetRoute.current, target));
  }, [replaceRoute]);

  const openInner = useCallback((name) => {
    const tab = tabOfInner(name);
    if (!tab) return;
    const next = `${tab}/${name}`;
    if (readRoute() === next) return;
    const { pathname, search } = window.location;
    window.history.pushState(stateWith(true), '', `${pathname}${search}${hashOf(next)}`);
    goTo(next, 'forward');
  }, [goTo]);

  const closeInner = useCallback(() => {
    if (isPushedByApp()) {
      // Состояние обновит popstate; метка нужна, чтобы он выехал анимацией, а
      // не прошёл как чужой.
      clearBackRequest();
      backRequested.current = true;
      backTimer.current = setTimeout(() => { backRequested.current = false; }, BACK_MARK_TTL_MS);
      window.history.back();
    } else {
      // Назад - на вкладку, под которой лежал экран (страницу открыли сразу
      // на нём). Без внутреннего экрана - на «Ещё», как и раньше.
      const [tab] = readRoute().split('/');
      replaceRoute(INNER_SCREENS[tab] ? tab : 'more', 'back');
    }
  }, [replaceRoute, clearBackRequest]);

  const [screen, inner = null] = route.split('/');
  return { screen, inner, setScreen, openInner, closeInner };
}
