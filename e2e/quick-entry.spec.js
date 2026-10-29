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

  test('reads a receipt photo, splits it by category and saves the parts', async ({ page }) => {
    await page.clock.setFixedTime(new Date(2026, 9, 12, 12));
    const expenseCategories = [
      { _id: 'cat-1', name: 'Еда', type: 'expense' },
      { _id: 'cat-3', name: 'Дом', type: 'expense' },
      categories[1],
    ];
    await mockApi(page, { categories: expenseCategories, settings: { monthlyLimit: 7000, features: { quickEntry: true } } });

    let receiptRequest;
    await page.route('**/api/quick-entry/receipt', (route) => {
      const request = route.request();
      receiptRequest = { headers: request.headers(), body: request.postDataBuffer() };
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          draft: {
            type: 'expense',
            amount: 40.5,
            account: accounts[0]._id,
            date: '2026-10-11',
            companyId: 'company-1',
            companyName: 'Lidl',
            logoMode: 'auto',
            splits: [{ category: 'Еда', amount: 32.4 }, { category: 'Дом', amount: 8.1 }],
          },
        }),
      });
    });
    const created = [];
    await page.route('**/api/transactions', (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      created.push(route.request().postDataJSON());
      return route.fulfill({ status: 201, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/');
    // Настоящий JPEG: фото проходит через createImageBitmap и canvas браузера
    const jpeg = Buffer.from(await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 32;
      canvas.height = 24;
      const context = canvas.getContext('2d');
      context.fillStyle = '#d33';
      context.fillRect(0, 0, 32, 24);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
      return btoa(String.fromCharCode(...new Uint8Array(await blob.arrayBuffer())));
    }), 'base64');

    await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('button', { name: 'Добавить операцию' }).click();
    const dialog = page.getByRole('dialog', { name: 'Новый расход' });
    await expect(dialog.getByRole('button', { name: 'Сфотографировать чек' })).toBeVisible();

    await dialog.getByLabel('Опишите операцию').fill('с карты');
    await dialog.locator('input[type="file"]').setInputFiles({ name: 'receipt.jpg', mimeType: 'image/jpeg', buffer: jpeg });

    await expect(dialog.getByText('В чеке товары разных категорий, сумма разделена. Проверьте части.')).toBeVisible();
    expect(receiptRequest.headers['content-type']).toBe('image/jpeg');
    expect(receiptRequest.headers['x-quick-entry-today']).toBe('2026-10-12');
    expect(decodeURIComponent(receiptRequest.headers['x-quick-entry-text'])).toBe('с карты');
    expect([...receiptRequest.body.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);

    // Строка с камерой остаётся над разделением, а фото открывается на весь экран
    await expect(dialog.getByLabel('Опишите операцию')).toBeVisible();
    await expect(dialog.getByText('Общая сумма')).toBeVisible();
    await expect(dialog.getByLabel('Категория части 1')).toHaveValue('Еда');
    await expect(dialog.getByLabel('Категория части 2')).toHaveValue('Дом');
    const amounts = dialog.getByPlaceholder('Сумма');
    await expect(amounts).toHaveCount(2);
    await expect(amounts.nth(0)).toHaveValue('32.40');
    await expect(amounts.nth(1)).toHaveValue('8.10');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    await dialog.getByRole('button', { name: 'Открыть фото чека' }).click();
    const preview = page.getByRole('dialog', { name: 'Фото чека' });
    await expect(preview).toBeVisible();
    await expect(preview.getByRole('img')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(preview).toHaveCount(0);
    await expect(dialog).toBeVisible();

    await dialog.getByRole('button', { name: 'Сохранить расход' }).click();
    await expect(dialog).toHaveCount(0);
    expect(created).toHaveLength(1);
    expect(created[0]).toHaveLength(2);
    expect(created[0]).toMatchObject([
      { category: 'Еда', amount: 32.4, companyName: 'Lidl', account: accounts[0]._id, date: '2026-10-11', type: 'expense' },
      { category: 'Дом', amount: 8.1, companyName: 'Lidl', account: accounts[0]._id, date: '2026-10-11', type: 'expense' },
    ]);
    expect(created[0][0].splitId).toBe(created[0][1].splitId);
  });

  test('is absent when the server does not enable it', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('button', { name: 'Добавить операцию' }).click();
    await expect(page.getByRole('dialog', { name: 'Новый расход' })).toBeVisible();
    await expect(page.getByLabel('Опишите операцию')).toHaveCount(0);
  });
});
