import { test, expect } from '@playwright/test';
import { mockApi, accounts, categories } from './fixtures.js';

// Ввод операции фразой: сервер отвечает черновиком, форма заполняется, и
// сохраняется только то, что человек видит в полях. Сам Claude не нужен -
// ответ /api/quick-entry подставляется здесь, как и остальной API.

const draft = {
  type: 'expense',
  amount: 3.5,
  category: categories[0].name,
  account: accounts[0]._id,
  date: '2026-10-11',
  description: 'латте',
  companyId: '',
  companyName: 'Старбакс',
  logoMode: 'auto',
};

test.describe('Quick entry by phrase (mobile, real browser)', () => {
  test('fills the new-operation form from a phrase and saves what is shown', async ({ page }) => {
    await page.clock.setFixedTime(new Date(2026, 9, 12, 12));
    await mockApi(page, { settings: { monthlyLimit: 7000, features: { quickEntry: true } } });

    let phraseRequest;
    await page.route('**/api/quick-entry', (route) => {
      phraseRequest = route.request().postDataJSON();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ draft }) });
    });
    const created = [];
    await page.route('**/api/transactions', (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      created.push(route.request().postDataJSON());
      return route.fulfill({ status: 201, contentType: 'application/json', body: '{}' });
    });
    // Новая компания при сохранении уходит в справочник
    await page.route('**/api/companies', (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ _id: 'company-1', __v: 0, name: 'Старбакс', logoMode: 'auto' }),
      });
    });

    await page.goto('/');
    await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('button', { name: 'Добавить операцию' }).click();
    const dialog = page.getByRole('dialog', { name: 'Новый расход' });
    await expect(dialog).toBeVisible();

    const phrase = dialog.getByLabel('Опишите операцию');
    const fill = dialog.getByRole('button', { name: 'Заполнить' });
    await expect(fill).toBeDisabled();
    await phrase.fill('кофе 3.50 старбакс вчера с карты');
    await expect(fill).toBeEnabled();
    await fill.click();

    await expect(dialog.getByText('Заполнено по фразе. Проверьте поля.')).toBeVisible();
    expect(phraseRequest).toEqual({ text: 'кофе 3.50 старбакс вчера с карты', today: '2026-10-12' });
    await expect(dialog.locator('#transaction-amount')).toHaveValue('3,5');
    await expect(dialog.getByRole('button', { name: categories[0].name, exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(dialog.getByRole('button', { name: accounts[0].name, exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(dialog.getByRole('button', { name: 'Вчера', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    await dialog.getByRole('button', { name: 'Сохранить расход' }).click();
    await expect(dialog).toHaveCount(0);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      type: 'expense',
      amount: 3.5,
      category: categories[0].name,
      account: accounts[0]._id,
      date: '2026-10-11',
      description: 'латте',
      companyId: 'company-1',
      companyName: 'Старбакс',
    });
  });

  test('is absent when the server does not enable it', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('button', { name: 'Добавить операцию' }).click();
    await expect(page.getByRole('dialog', { name: 'Новый расход' })).toBeVisible();
    await expect(page.getByLabel('Опишите операцию')).toHaveCount(0);
  });
});
