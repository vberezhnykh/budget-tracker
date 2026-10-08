import { useCallback, useEffect, useRef, useState } from 'react';

// Экран живёт в location.hash. Вкладки: `#history`, `#analytics`, `#more`;
// Обзор - без хэша вовсе. Внутренние экраны лежат под вкладкой «Ещё»:
// `#more/accounts`, `#more/categories`, `#more/trash`. Так обновление
// страницы возвращает на тот же экран, а ссылку на него можно открыть
// напрямую.
const TAB_SCREENS = ['history', 'analytics', 'more'];
const INNER_SCREENS = ['accounts', 'categories', 'trash'];

// Метка в history.state: эту запись создало приложение (openInner), поэтому
// «назад» из внутреннего экрана - это history.back() к записи, из которой
// он был открыт. У записи без метки (страницу открыли сразу на
// `#more/accounts` или перезагрузили) предыдущая запись может вообще
// принадлежать другому сайту, и history.back() увёл бы из приложения.
const PUSHED_MARK = 'budgetInnerPushed';

// Маршрут - строка вида `overview`, `more`, `more/accounts`. Из неё же
// выводятся вкладка и внутренний экран, поэтому состояние хука одно и
// сравнивается как примитив.
const readRoute = () => {
  const [tab, inner] = window.location.hash.replace(/^#/, '').split('/');
  if (!TAB_SCREENS.includes(tab)) return 'overview';
  return tab === 'more' && INNER_SCREENS.includes(inner) ? `more/${inner}` : tab;
};

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
// вкладка (у внутреннего экрана это 'more', он подсвечивает «Ещё»), inner -
// имя внутреннего экрана или null.
export default function useHashScreen() {
  const [route, setRoute] = useState(readRoute);
  const previousRoute = useRef(route);

  // Метка живёт в history.state и переживает перезагрузку, а вот «предыдущая
  // запись» после неё - уже не та, из которой экран открывали. Поэтому при
  // загрузке метка снимается: после обновления страницы «назад» из внутреннего
  // экрана заменяет хэш на `#more`, а не листает историю.
  useEffect(() => {
    if (isPushedByApp()) {
      window.history.replaceState(stateWith(false), '', window.location.href);
    }
  }, []);

  useEffect(() => {
    const sync = () => setRoute(readRoute());
    window.addEventListener('popstate', sync);
    window.addEventListener('hashchange', sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener('hashchange', sync);
    };
  }, []);

  // Прокрутка к началу - по факту смены экрана, а не в setScreen: так она
  // срабатывает и на переход, пришедший через popstate или hashchange. Новый
  // экран должен открываться с начала, а не с позиции, оставшейся от прошлого.
  useEffect(() => {
    if (previousRoute.current === route) return;
    previousRoute.current = route;
    window.scrollTo(0, 0);
  }, [route]);

  const replaceRoute = useCallback((next) => {
    const { pathname, search } = window.location;
    window.history.replaceState(stateWith(false), '', `${pathname}${search}${hashOf(next)}`);
    setRoute(next);
  }, []);

  // Любая вкладка, в том числе «Ещё» из внутреннего экрана, заменяет текущую
  // запись: внутренний экран при этом закрывается без шага «назад».
  const setScreen = useCallback((next) => {
    replaceRoute(TAB_SCREENS.includes(next) ? next : 'overview');
  }, [replaceRoute]);

  const openInner = useCallback((name) => {
    if (!INNER_SCREENS.includes(name)) return;
    const next = `more/${name}`;
    if (readRoute() === next) return;
    const { pathname, search } = window.location;
    window.history.pushState(stateWith(true), '', `${pathname}${search}${hashOf(next)}`);
    setRoute(next);
  }, []);

  const closeInner = useCallback(() => {
    if (isPushedByApp()) {
      // Состояние обновит popstate.
      window.history.back();
    } else {
      replaceRoute('more');
    }
  }, [replaceRoute]);

  const [screen, inner = null] = route.split('/');
  return { screen, inner, setScreen, openInner, closeInner };
}
