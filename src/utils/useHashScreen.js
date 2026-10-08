import { useCallback, useEffect, useRef, useState } from 'react';

// Экран вкладки живёт в location.hash: `#history`, `#analytics`, `#more`;
// Обзор - без хэша вовсе. Так обновление страницы возвращает на ту же
// вкладку, а ссылку на неё можно открыть напрямую.
const TAB_SCREENS = ['history', 'analytics', 'more'];

const readScreen = () => {
  const name = window.location.hash.replace(/^#/, '');
  return TAB_SCREENS.includes(name) ? name : 'overview';
};

// Переключение вкладок пишет хэш через replaceState, а не присваиванием
// location.hash: вкладки - это не «страницы», и десять переключений не
// должны оставить десять записей, по которым потом листает жест «назад».
// История браузера нужна внутренним экранам и листам (следующие этапы), и
// копить в ней вкладки значит мешать им.
//
// replaceState событие hashchange не вызывает, поэтому состояние ставится
// напрямую; слушатель hashchange нужен тому, что пришло снаружи: хэш
// поправили руками в адресной строке или перешли по ссылке с другим хэшем.
export default function useHashScreen() {
  const [screen, setScreenState] = useState(readScreen);
  const previousScreen = useRef(screen);

  useEffect(() => {
    const onHashChange = () => setScreenState(readScreen());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Прокрутка к началу - по факту смены экрана, а не в setScreen: так она
  // срабатывает и на переход, пришедший через hashchange. Новая вкладка
  // должна открываться с начала, а не с позиции, оставшейся от прошлой.
  useEffect(() => {
    if (previousScreen.current === screen) return;
    previousScreen.current = screen;
    window.scrollTo(0, 0);
  }, [screen]);

  const setScreen = useCallback((next) => {
    const target = TAB_SCREENS.includes(next) ? next : 'overview';
    const { pathname, search } = window.location;
    window.history.replaceState(window.history.state, '', `${pathname}${search}${target === 'overview' ? '' : `#${target}`}`);
    setScreenState(target);
  }, []);

  return [screen, setScreen];
}
