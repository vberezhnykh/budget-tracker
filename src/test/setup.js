import '@testing-library/jest-dom';
import { afterEach } from 'vitest';

// jsdom не реализует прокрутку окна и на каждый вызов пишет «Not implemented»
// в консоль. Переключение вкладок теперь прокручивает страницу к началу
// (utils/useHashScreen), так что без заглушки этим шумом заросли бы все
// тесты приложения. Тесты, которым важен сам вызов, ставят свой spy поверх.
// Серверные тесты идут в окружении node, без window - им заглушка не нужна.
if (typeof window !== 'undefined') {
  window.scrollTo = () => { };

  // Фоновая подгрузка Аналитики стартует в простое браузера (utils/prefetch).
  // В тестах простоя нет, а реальные таймеры сделали бы число запросов
  // зависящим от скорости прогона. Поэтому колбэки копятся в очереди и
  // запускаются только явно: flushIdle() из src/test/idle.js.
  window.__idleQueue = [];
  window.requestIdleCallback = callback => window.__idleQueue.push(callback);
  window.cancelIdleCallback = id => { window.__idleQueue[id - 1] = null; };

  // Выбранная вкладка живёт в location.hash, а jsdom держит один адрес на весь
  // файл тестов: без сброса следующий тест стартовал бы на вкладке, где
  // закончился предыдущий.
  afterEach(() => {
    // Защита от повторной перезагрузки при обновлении (utils/appUpdate) помнит
    // версию в хранилище вкладки; между тестами она не должна переходить.
    try { window.sessionStorage.clear(); } catch { /* хранилище недоступно */ }
    window.__idleQueue.length = 0;
    window.history.replaceState(null, '', '/');
  });
}
