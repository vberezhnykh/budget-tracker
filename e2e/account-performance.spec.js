import { test, expect } from '@playwright/test';
import { mockApi } from './fixtures.js';

test('account limit bars and visited analytics work with subsequent summary requests blocked', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-01-15T12:00:00Z'));
  await mockApi(page);
  const requested = [];
  page.on('request', r => requested.push(new URL(r.url()).pathname));
  await page.goto('/');
  await expect(page.getByTestId('accounts-row')).toBeVisible();
  // The Vite dev app uses StrictMode, which replays the initial effect.
  const referencePaths = ['/api/accounts', '/api/categories', '/api/settings'];
  const initialReads = Object.fromEntries(referencePaths.map(path => [path, requested.filter(p => p === path).length]));
  const skeleton = page.getByRole('status', { name: 'Загрузка итогов…' });
  const summaries = () => requested.filter(path => path === '/api/stats/dashboard').length;
  for (const [name, amount] of [['Наличные', '5,00'], ['Тинькофф', '120,00'], ['Все счета', '125,00']]) {
    await page.getByRole('button', { name: new RegExp(`^${name}: −?€`) }).click();
    await expect(page.getByRole('button', { name: `Расход: €${amount}`, exact: false })).toBeVisible();
    await expect(skeleton).toHaveCount(0);
  }
  expect(summaries()).toBe(1);
  // Счета переключаются на Обзоре (лента карточек), а аналитика лежит на
  // своей вкладке: к ней ходим туда и обратно через нижнюю навигацию.
  const nav = page.getByRole('navigation', { name: 'Основная навигация' });
  const goTo = name => nav.getByRole('button', { name, exact: true }).click();
  await goTo('Аналитика');
  await expect(page.getByRole('heading', { name: 'Категории' })).toBeVisible();
  await goTo('Обзор');
  await page.getByRole('button', { name: /^Наличные: −?€/ }).click();
  await goTo('Аналитика');
  await expect(page.getByRole('heading', { name: 'Категории' })).toBeVisible();
  await expect(skeleton).toHaveCount(0);
  const before = summaries();
  // Any accidental cache miss now fails rather than passing on fast localhost.
  await page.route('**/api/stats/dashboard?*', route => route.abort());
  for (const name of ['Все счета', 'Наличные']) {
    await goTo('Обзор');
    await page.getByRole('button', { name: new RegExp(`^${name}: −?€`) }).click();
    await expect(page.getByRole('button', { name: /^Расход:/ })).toBeVisible();
    await expect(skeleton).toHaveCount(0);
    await goTo('Аналитика');
    await expect(page.getByRole('heading', { name: 'Категории' })).toBeVisible();
    await expect(skeleton).toHaveCount(0);
  }
  expect(summaries()).toBe(before);
  for (const path of referencePaths) {
    expect(requested.filter(p => p === path)).toHaveLength(initialReads[path]);
  }
});
