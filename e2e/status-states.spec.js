import { test, expect } from '@playwright/test';
import { mockApi } from './fixtures.js';

// Экраны ошибок и сообщения поверх интерфейса: вход, «данные не загрузились»,
// полоса «не удалось обновить» и тосты. Размеры и положение мерим в настоящем
// браузере - jsdom вёрстки не считает.

const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const goToTab = (page, name) => page
  .getByRole('navigation', { name: 'Основная навигация' })
  .getByRole('button', { name, exact: true })
  .click();

const box = async locator => {
  const result = await locator.boundingBox();
  expect(result).not.toBeNull();
  return result;
};

test.describe('Error and status states (mobile, real browser)', () => {
  test('login: card, 50px field, 54px button; a wrong password turns the border red and shows the alert line', async ({ page }) => {
    await mockApi(page);
    await page.route('**/api/accounts', route => json(route, 401, { message: 'Не авторизован' }));
    await page.route('**/api/login', route => json(route, 401, { message: 'Неверный пароль' }));
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1, name: 'Бюджет' })).toBeVisible();
    await expect(page.getByText('Введите пароль, чтобы продолжить')).toBeVisible();
    const field = page.getByLabel('Пароль');
    const button = page.getByRole('button', { name: 'Войти' });
    expect((await box(field)).height).toBe(50);
    expect((await box(button)).height).toBe(54);

    await field.fill('wrong');
    await button.click();
    await expect(page.getByRole('alert')).toHaveText('Неверный пароль');
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    // Браузер округляет вычисленную толщину до физического пикселя (на DPR 1
    // это 1px), поэтому проверяем заданную толщину и то, что цвет рамки красный.
    expect(await field.evaluate(el => el.style.border)).toContain('1.5px');
    const colors = await field.evaluate(el => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--color-danger)';
      document.body.append(probe);
      const danger = getComputedStyle(probe).color;
      probe.remove();
      return { border: getComputedStyle(el).borderTopColor, danger };
    });
    expect(colors.border).toBe(colors.danger);
  });

  test('failed first load: card with the reason, retry loads the app', async ({ page }) => {
    await mockApi(page);
    let offline = true;
    await page.route('**/api/accounts', route => (offline ? route.abort() : route.fallback()));
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Не удалось загрузить данные' })).toBeVisible();
    await expect(page.getByText(/Операции хранятся на сервере и никуда не пропали/)).toBeVisible();
    await expect(page.getByText(/^Последняя попытка в \d{2}:\d{2}$/)).toBeVisible();

    offline = false;
    await page.getByRole('button', { name: 'Повторить' }).click();
    await expect(page.getByTestId('accounts-row')).toBeVisible();
  });

  test('sync strip sits at the top of <main> and --status-strip-height equals its height', async ({ page }) => {
    await mockApi(page);
    let offline = false;
    await page.route('**/api/accounts', route => (offline ? route.abort() : route.fallback()));
    await page.goto('/');
    await expect(page.getByTestId('accounts-row')).toBeVisible();

    const main = page.getByRole('main');
    expect(await main.evaluate(el => el.style.getPropertyValue('--status-strip-height'))).toBe('0px');

    offline = true;
    await goToTab(page, 'Ещё');
    await page.getByRole('button', { name: 'Обновить', exact: true }).click();
    const strip = main.getByText(/^Не удалось обновить\. Показаны данные на /);
    await expect(strip).toBeVisible();

    const measured = await main.evaluate(el => {
      const wrapper = el.firstElementChild;
      return { variable: el.style.getPropertyValue('--status-strip-height'), height: wrapper.getBoundingClientRect().height };
    });
    expect(Number.parseFloat(measured.variable)).toBeGreaterThan(0);
    expect(Math.abs(Number.parseFloat(measured.variable) - measured.height)).toBeLessThanOrEqual(1);

    offline = false;
    await main.getByRole('button', { name: 'Повторить' }).click();
    await expect(strip).toHaveCount(0);
    expect(await main.evaluate(el => el.style.getPropertyValue('--status-strip-height'))).toBe('0px');
  });

  test('an error toast floats above the bottom navigation and closes', async ({ page }) => {
    await mockApi(page);
    await page.route('**/api/logout', route => json(route, 500, {}));
    await page.goto('/');
    await expect(page.getByTestId('accounts-row')).toBeVisible();

    await goToTab(page, 'Ещё');
    await page.getByRole('button', { name: 'Выйти' }).click();
    const toast = page.getByRole('alert');
    await expect(toast).toHaveText(/Не удалось выйти/);

    const nav = page.getByRole('navigation', { name: 'Основная навигация' });
    const toastBox = await box(toast);
    expect(toastBox.y + toastBox.height).toBeLessThanOrEqual((await box(nav)).y);

    await toast.getByRole('button', { name: 'Закрыть' }).click();
    await expect(toast).toHaveCount(0);
  });
});
