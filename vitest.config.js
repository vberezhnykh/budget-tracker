import { defineConfig, configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
    // The Playwright smoke suite lives under e2e/ and is run separately via
    // `npm run test:e2e` (see playwright.config.js) - it needs a real
    // browser, not jsdom, so it must never be picked up by `vitest run`.
    exclude: [...configDefaults.exclude, 'e2e/**'],
    // Поднимает одну MongoDB на весь прогон и отдаёт её URI тестам роутов
    // (server/test/harness.js). Один инстанс, а не по одному на файл: шесть
    // mongod'ов рядом с jsdom-сьютами делали прогон флаки. В CI, где база
    // уже поднята сервис-контейнером, ничего не поднимает.
    globalSetup: './server/test/globalSetup.js',
    // Дефолтные 5 секунд рассчитаны на быстрый тест, а сьюты фронтенда на
    // jsdom с user-event идут по 1.5-4 секунды каждый и без всякой нагрузки.
    // Когда рядом в других воркерах пошли тесты роутов, самые тяжёлые из них
    // стали упираться в лимит - и падал каждый раз другой, что и выдаёт
    // нехватку времени, а не ошибку. Запас, а не маскировка: зависший тест
    // по-прежнему падает, просто на десять секунд позже.
    testTimeout: 15_000,
  }
})
