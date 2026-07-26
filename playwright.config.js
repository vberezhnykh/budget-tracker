import { defineConfig, devices } from '@playwright/test';

// Real-browser smoke suite for the layout/geometry bugs unit tests structurally
// cannot see (jsdom never lays anything out - see e2e/smoke.spec.js for the
// full rationale). Kept entirely separate from vitest: no backend, no
// MongoDB, just Vite's own dev server with every /api/** call stubbed via
// page.route (see e2e/fixtures.js).
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173',
    // Every bug this suite targets was mobile-only, so the whole suite runs
    // under a real mobile viewport/touch profile rather than desktop chrome.
    // The iPhone 13 device preset defaults to webkit, but only Chromium is
    // installed in this environment (per the task, download Chromium only),
    // so browserName is pinned explicitly, overriding that default.
    ...devices['iPhone 13'],
    browserName: 'chromium',
  },
  webServer: {
    command: 'npm run dev -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
