import { test, expect } from '@playwright/test';
import { mockApi, categories } from './fixtures.js';

// «Где» в форме расхода: строка после категории и лист выбора компании. Лист -
// второй вид внутри листа формы, форма под ним скрыта. Прокрутка и раскладка
// в jsdom не считаются, поэтому проверяем в настоящем браузере.

const companies = [
  { _id: 'company-1', __v: 0, name: 'Lidl', logoMode: 'category', category: categories[0].name, usage: { [categories[0].name]: 48 }, lastUsed: '2026-10-10' },
  { _id: 'company-2', __v: 0, name: 'Alphamega', logoMode: 'category', category: categories[0].name, usage: { [categories[0].name]: 9 }, lastUsed: '2026-10-09' },
];

async function openForm(page) {
  await page.clock.setFixedTime(new Date(2026, 9, 12, 12));
  await mockApi(page, { settings: { monthlyLimit: 7000 } });
  await page.route('**/api/companies', (route) => (route.request().method() === 'GET'
    ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(companies) })
    : route.fallback()));
  await page.route('**/api/companies/history?*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('button', { name: 'Добавить операцию' }).click();
  const dialog = page.getByRole('dialog', { name: 'Новый расход' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe('«Где» in the expense form (mobile, real browser)', () => {
  test('goes after the category, suggests places for it and picks one in a tap', async ({ page }) => {
    const dialog = await openForm(page);
    await dialog.locator('#transaction-amount').fill('12');
    await dialog.getByRole('button', { name: categories[0].name, exact: true }).click();

    const places = dialog.getByRole('group', { name: `Частые места для категории «${categories[0].name}»` });
    await expect(places.getByRole('button')).toHaveText(['Lidl', 'Alphamega']);
    // порядок на экране: категория, «Где», «Списать с»
    const top = async (text) => (await dialog.getByText(text, { exact: true }).boundingBox()).y;
    expect(await top('Категория')).toBeLessThan(await top('Где'));
    expect(await top('Где')).toBeLessThan(await top('Списать с'));
    // ряд мест не переносится и не растягивает страницу
    const box = await places.boundingBox();
    expect(box.height).toBeLessThan(60);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    await places.getByRole('button', { name: 'Alphamega' }).click();
    await expect(places.getByRole('button', { name: 'Alphamega' })).toHaveAttribute('aria-pressed', 'true');
    await expect(dialog.getByRole('button', { name: /Alphamega.*Сменить/ })).toBeVisible();
  });

  test('opens the sheet over the form, keeps the form scroll and returns with «Готово»', async ({ page }) => {
    const dialog = await openForm(page);
    await dialog.locator('#transaction-amount').fill('12');
    await dialog.getByRole('button', { name: categories[0].name, exact: true }).click();
    await dialog.getByLabel('Комментарий').fill('на неделю');

    // Форма выше экрана: прокручиваем лист и открываем «Где» без автопрокрутки
    await dialog.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    const before = await dialog.evaluate((element) => element.scrollTop);
    expect(before).toBeGreaterThan(0);
    await dialog.getByRole('button', { name: /Магазин или сервис/ }).evaluate((element) => element.click());

    const where = page.getByRole('dialog', { name: 'Где' });
    await expect(where.getByRole('heading', { name: 'Где' })).toBeVisible();
    await expect(where.getByLabel('Компания')).toBeFocused();
    await expect(where.getByRole('button', { name: 'Готово' })).toBeInViewport();
    expect(await where.evaluate((element) => element.scrollTop)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    await where.getByLabel('Компания').fill('Li');
    await expect(where.getByRole('button', { name: /Lidl.*48 операций/ })).toBeVisible();
    await expect(where.getByRole('button', { name: 'Новая компания «Li»' })).toBeVisible();
    await where.getByRole('button', { name: /Lidl/ }).click();

    const form = page.getByRole('dialog', { name: 'Новый расход' });
    await expect(form).toBeVisible();
    await expect(form.getByLabel('Комментарий')).toHaveValue('на неделю');
    await expect(form.locator('#transaction-amount')).toHaveValue('12');
    await expect(form.getByRole('button', { name: /Lidl.*Сменить/ })).toBeVisible();
    // прокрутка формы вернулась на прежнее место
    expect(await form.evaluate((element) => element.scrollTop)).toBe(before);
  });

  test('separates split parts into select + amount rows that fit the screen', async ({ page }) => {
    const dialog = await openForm(page);
    await dialog.locator('#transaction-amount').fill('40,5');
    // Пока поле суммы в фокусе, под ним ряд калькулятора и кнопки ниже сдвинуты:
    // уводим фокус, чтобы клик по «Разделить» не промахнулся
    await dialog.locator('#transaction-amount').blur();
    await dialog.getByRole('button', { name: 'Разделить' }).click();
    await expect(dialog.getByText('Общая сумма')).toBeVisible();

    await dialog.getByLabel('Категория части 1').selectOption(categories[0].name);
    await dialog.getByLabel('Сумма части 1').fill('30');
    await expect(dialog.getByRole('status')).toContainText('Осталось распределить');
    await expect(dialog.getByRole('status')).toContainText('€10,50');
    // выбранную категорию другой части не предлагаем
    await expect(dialog.getByLabel('Категория части 2').locator('option', { hasText: categories[0].name })).toHaveCount(0);

    const select = await dialog.getByLabel('Категория части 1').locator('xpath=..').boundingBox();
    const amount = await dialog.getByLabel('Сумма части 1').locator('xpath=..').boundingBox();
    expect(select.height).toBeCloseTo(48, 0);
    expect(amount.width).toBeCloseTo(112, 0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    // в разделении «Где» остаётся
    await expect(dialog.getByText('Где', { exact: true })).toBeVisible();
  });
});
