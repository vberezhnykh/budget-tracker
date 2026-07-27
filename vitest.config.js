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
  }
})
