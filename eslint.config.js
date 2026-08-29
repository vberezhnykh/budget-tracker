import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
    },
  },
  // Бэкенд - тоже .js, но другой рантайм: Node и CommonJS. Без этого блока
  // на него распространялись browser-глобали и sourceType: 'module' из
  // блока выше, и весь server/** был красным - require, module и process
  // читались как необъявленные переменные.
  {
    files: ['server/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
  },
  // Тесты сервера, в отличие от самого сервера, написаны на ES-модулях:
  // их исполняет vitest, а не Node напрямую, и import из 'vitest' в них
  // обязателен. Возвращаем им sourceType: 'module' поверх блока выше.
  // server/test/ - обвязка этих тестов, она живёт по тем же правилам,
  // но в имени файла .test. нет (иначе vitest счёл бы её сьютом).
  {
    files: ['server/**/*.test.js', 'server/test/**/*.js'],
    languageOptions: {
      sourceType: 'module',
    },
  },
  // Service worker живёт в своей области видимости: ни window, ни document
  // там нет, зато есть self, caches и clients. Раньше это описывалось
  // комментарием /* eslint-env serviceworker */ в самом файле, но плоский
  // конфиг такие комментарии больше не читает.
  {
    files: ['public/sw.js'],
    languageOptions: {
      globals: {
        ...globals.serviceworker,
      },
    },
  },
  // Тесты с докблоком @vitest-environment node внутри src/: браузерных
  // глобалей у них нет, зато есть node-овские (fs, Buffer). Файлы
  // перечислены поимённо, а не шаблоном: остальные сьюты в src/ идут в
  // jsdom, и подмена окружения им бы навредила.
  {
    files: ['src/pwa.test.js'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  // Конфиги в корне и Playwright-сьют исполняются Node, но остаются
  // ES-модулями: им нужны только node-глобали (process.env в
  // playwright.config.js), а не смена sourceType.
  {
    files: ['*.config.js', 'e2e/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
])
