import '@testing-library/jest-dom';
import { afterEach } from 'vitest';

// jsdom не реализует прокрутку окна и на каждый вызов пишет «Not implemented»
// в консоль. Переключение вкладок теперь прокручивает страницу к началу
// (utils/useHashScreen), так что без заглушки этим шумом заросли бы все
// тесты приложения. Тесты, которым важен сам вызов, ставят свой spy поверх.
// Серверные тесты идут в окружении node, без window - им заглушка не нужна.
if (typeof window !== 'undefined') {
  window.scrollTo = () => { };

  // Выбранная вкладка живёт в location.hash, а jsdom держит один адрес на весь
  // файл тестов: без сброса следующий тест стартовал бы на вкладке, где
  // закончился предыдущий.
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });
}
