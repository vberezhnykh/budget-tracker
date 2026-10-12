import { test, expect } from '@playwright/test';
import { mockApi } from './fixtures.js';

// Обновление приложения при возвращении из фона (src/utils/appUpdate.js).
//
// В e2e идёт dev-сервер Vite: у него нет хешированных /assets/index-*.js, и
// приложение считает, что своей версии у него нет, - то есть вообще не
// проверяет обновления. Чтобы проверить настоящее поведение в настоящем
// браузере, страницу «собираем» сами: в отданный HTML добавляется пустой
// модуль /assets/index-OLD.js, как будто страница загружена из сборки OLD, а
// /api/version отвечает заданной версией.
//
// Возвращение из фона эмулируется событием visibilitychange: страница в
// тесте и так видима, поэтому достаточно его бросить.

const CURRENT = '/assets/index-OLD.js';

async function openAsBuild(page, serverVersion) {
  await mockApi(page);
  // Позже зарегистрированный роут важнее: перекрывает версию из mockApi.
  await page.route('**/api/version', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ version: serverVersion }),
  }));
  await page.route(`**${CURRENT}`, route => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
  await page.route('**/', async (route) => {
    if (route.request().resourceType() !== 'document') return route.fallback();
    const response = await route.fetch();
    const html = (await response.text()).replace('</head>', `<script type="module" src="${CURRENT}"></script></head>`);
    return route.fulfill({ response, body: html });
  });
  await page.goto('/');
  await expect(page.getByTestId('accounts-row')).toBeVisible();
  // Метка живёт до перезагрузки: по её исчезновению видно, что страница
  // загрузилась заново.
  await page.evaluate(() => { window.__beforeReload = true; });
}

const returnFromBackground = page => page.evaluate(() => {
  document.dispatchEvent(new Event('visibilitychange'));
});

const survived = page => page.evaluate(() => window.__beforeReload === true);

test.describe('Обновление при возвращении из фона (mobile, real browser)', () => {
  test('перезагружает страницу, когда сервер отдаёт другую сборку', async ({ page }) => {
    await openAsBuild(page, '/assets/index-NEW.js');

    const reloaded = page.waitForEvent('load');
    await returnFromBackground(page);
    await reloaded;

    await expect(page.getByTestId('accounts-row')).toBeVisible();
    expect(await survived(page)).toBe(false);
  });

  test('не трогает страницу, если сборка та же', async ({ page }) => {
    await openAsBuild(page, CURRENT);

    const versionAsked = page.waitForRequest('**/api/version');
    await returnFromBackground(page);
    await versionAsked;

    await expect(page.getByText('Доступна новая версия')).toHaveCount(0);
    expect(await survived(page)).toBe(true);
  });

  test('при открытой форме показывает плашку, оставляя форму на месте, и обновляет по нажатию', async ({ page }) => {
    await openAsBuild(page, '/assets/index-NEW.js');
    await page.getByRole('button', { name: 'Добавить операцию' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await returnFromBackground(page);

    const toast = page.getByRole('status').filter({ hasText: 'Доступна новая версия' });
    await expect(toast).toBeVisible();
    await expect(dialog).toBeVisible();
    expect(await survived(page)).toBe(true);

    // Плашка лежит поверх листа, и кнопка нажимается (Playwright проверяет,
    // что на неё не наложен другой элемент).
    const reloaded = page.waitForEvent('load');
    await toast.getByRole('button', { name: 'Обновить' }).click();
    await reloaded;
    expect(await survived(page)).toBe(false);
  });

  test('после закрытия формы с ожидающим обновлением перезагружается сам', async ({ page }) => {
    await openAsBuild(page, '/assets/index-NEW.js');
    await page.getByRole('button', { name: 'Добавить операцию' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await returnFromBackground(page);
    await expect(page.getByText('Доступна новая версия')).toBeVisible();

    const reloaded = page.waitForEvent('load');
    await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await reloaded;
    expect(await survived(page)).toBe(false);
  });
});
