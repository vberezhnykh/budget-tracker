import { test, expect } from '@playwright/test';
import { mockApi } from './fixtures.js';

const goTo = (page, name) => page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('button', { name, exact: true }).click();
const dashboardUrl = '**/api/stats/dashboard?*';

test.describe('background prefetch', () => {
  test('analytics data is read in the background, so the tab opens without a skeleton', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-01-15T12:00:00Z'));
    await mockApi(page);
    const analyticsRequests = [];
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.pathname === '/api/stats/dashboard' && url.searchParams.get('analytics') === '1') analyticsRequests.push(url);
    });
    await page.goto('/');
    await expect(page.getByTestId('accounts-row')).toBeVisible();
    // Аналитика не открывалась, а запрос за ее данными уже ушел.
    await expect.poll(() => analyticsRequests.length).toBeGreaterThan(0);

    // Любой новый запрос итогов теперь идет 2 секунды: если вкладка полезет в
    // сеть вместо подготовленных данных, скелетон будет виден.
    await page.route(dashboardUrl, async route => {
      await new Promise(resolve => setTimeout(resolve, 2000));
      await route.fallback();
    });
    await goTo(page, 'Аналитика');
    await expect(page.getByRole('heading', { name: 'Категории' })).toBeVisible({ timeout: 1000 });
    await expect(page.getByRole('status', { name: 'Загрузка итогов…' })).toHaveCount(0);
    await expect(page.getByTestId('account-summary')).not.toHaveAttribute('aria-busy', 'true');
  });

  test('after adding an expense, history keeps the previous rows until the fresh page arrives', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-01-15T12:00:00Z'));
    const transactions = [
      { _id: 'tx-1', title: 'Зарплата', amount: 3000, type: 'income', account: 'acc-card-1', date: '2026-01-01T00:00:00Z', category: 'Зарплата' },
      { _id: 'tx-2', title: 'Продукты', amount: 120, type: 'expense', account: 'acc-card-1', date: '2026-01-05T00:00:00Z', category: 'Еда' },
    ];
    await mockApi(page, { transactions });
    await page.route('**/api/transactions', route => {
      if (route.request().method() !== 'POST') return route.fallback();
      const body = route.request().postDataJSON();
      transactions.push({ _id: 'tx-new', ...body, title: body.title || 'Обед в кафе' });
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ _id: 'tx-new' }) });
    });
    await page.goto('/');
    await expect(page.getByTestId('accounts-row')).toBeVisible();

    await goTo(page, 'История');
    await expect(page.getByText('Продукты', { exact: true })).toBeVisible();
    await goTo(page, 'Обзор');

    await goTo(page, 'Добавить операцию');
    const dialog = page.getByRole('dialog', { name: 'Новый расход' });
    await dialog.locator('#transaction-amount').fill('45');
    // Категория и счет могут подставиться формой сами, поэтому нажимаем, только
    // если выбор еще не сделан (повторное нажатие снимает его).
    const choose = async name => {
      const button = dialog.getByRole('button', { name, exact: true });
      await expect(async () => {
        if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click();
        await expect(button).toHaveAttribute('aria-pressed', 'true', { timeout: 500 });
      }).toPass();
    };
    await choose('Еда');
    await choose('Тинькофф');
    await dialog.getByLabel('Комментарий').fill('Обед в кафе');
    // Первая страница после записи придет не сразу: запросы Истории с этого
    // момента ждут, пока тест их не отпустит.
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    let held = 0;
    await page.route('**/api/history?*', async route => {
      held += 1;
      await gate;
      await route.fallback();
    });
    await dialog.getByRole('button', { name: 'Сохранить расход' }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => held).toBeGreaterThan(0);
    await goTo(page, 'История');
    const skeleton = page.getByRole('status', { name: 'Загрузка операций…' });
    // Прежние строки на месте, скелетона нет, новой строки пока нет.
    await expect(page.getByText('Продукты', { exact: true })).toBeVisible();
    await expect(skeleton).toHaveCount(0);
    await expect(page.getByText('Обед в кафе')).toHaveCount(0);
    release();
    await expect(page.getByText('Обед в кафе')).toBeVisible();
    await expect(page.getByText('Продукты', { exact: true })).toBeVisible();
    await expect(skeleton).toHaveCount(0);
  });
});
