import { test, expect } from '@playwright/test';
import { mockApi, transactions, accounts, categories } from './fixtures.js';

// Плавность коротких загрузок: подмена скелетона данными и бегущие цифры.
// jsdom анимаций и раскладки не считает, поэтому проверяем в настоящем
// браузере: что экраны вкладок появляются сразу, без анимации (общее
// проявление экрана владелец отклонил: от него уставали глаза), что после
// проявления блоков не остается ни прозрачности, ни transform (иначе
// position: fixed и sticky внутри поехали бы), и что цифры бегут только при
// обновлении той же величины.

const nav = page => page.getByRole('navigation', { name: 'Основная навигация' });
const goTo = (page, name) => nav(page).getByRole('button', { name, exact: true }).click();

const purchase = (id, date, title = id) => ({
  _id: id, title, amount: 10, type: 'expense', account: 'acc-card-1', date, category: 'Еда',
});

// Все корни анимации экрана закончили и вернулись к обычному виду.
const settled = page => page.evaluate(() => [...document.querySelectorAll('.fade-in')]
  .every(el => {
    const style = getComputedStyle(el);
    return style.opacity === '1' && style.transform === 'none';
  }));

test.describe('Motion on short loads (mobile, real browser)', () => {
  test('a tab switch shows the incoming screen at once, without touching the bottom nav', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-02T12:00:00Z'));
    await mockApi(page, { transactions: [
      ...Array.from({ length: 10 }, (_, i) => purchase(`oct-${i}`, '2026-10-01', `Октябрь ${i}`)),
      ...Array.from({ length: 20 }, (_, i) => purchase(`sep-${i}`, '2026-09-30', `Сентябрь ${i}`)),
    ] });
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Период: Октябрь 2026' })).toBeVisible();
    await expect.poll(() => settled(page)).toBe(true);

    const navigation = nav(page);
    const before = await navigation.boundingBox();
    await goTo(page, 'История');

    // Экран вкладки не анимируется, панель стоит на месте.
    const root = page.getByTestId('history-scroll').locator('xpath=..');
    expect(await root.evaluate(el => getComputedStyle(el).animationName)).toBe('none');
    expect(await navigation.boundingBox()).toEqual(before);
    await expect(page.getByText('Октябрь 0', { exact: true })).toBeVisible();

    // После проявления списка экран в обычном виде: transform: none не держит
    // containing block для fixed (нижняя панель) и не ломает sticky заголовков.
    await expect.poll(() => settled(page)).toBe(true);
    expect(await navigation.boundingBox()).toEqual(before);
    expect(await root.evaluate(el => getComputedStyle(el).transform)).toBe('none');

    const scroll = page.getByTestId('history-scroll');
    await scroll.evaluate(el => { el.scrollTop += 150; });
    const heading = page.locator('[data-history-month="2026-10"] [data-testid="history-month-heading"]');
    await expect.poll(async () => Math.abs((await heading.boundingBox()).y - (await scroll.boundingBox()).y)).toBeLessThan(2);
    const saved = await scroll.evaluate(el => el.scrollTop);

    // Вернулись на вкладку: положение списка то же, а во время появления экрана тоже.
    await goTo(page, 'Обзор');
    await goTo(page, 'История');
    await expect.poll(() => scroll.evaluate(el => el.scrollTop)).toBeCloseTo(saved, 0);
    await expect.poll(() => settled(page)).toBe(true);
    await expect.poll(async () => Math.abs((await heading.boundingBox()).y - (await scroll.boundingBox()).y)).toBeLessThan(2);
    expect(await navigation.boundingBox()).toEqual(before);
  });

  test('inner screens under «Ещё» open at once, without a fade', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');
    await goTo(page, 'Ещё');
    await page.getByRole('button', { name: /Категории/ }).click();
    await expect(page.getByRole('heading', { name: 'Категории' })).toBeVisible();
    const root = page.getByRole('heading', { name: 'Категории' }).locator('xpath=ancestor::main/*[1]');
    expect(await root.evaluate(el => getComputedStyle(el).animationName)).toBe('none');
    await expect.poll(() => settled(page)).toBe(true);
  });

  // test.use({ reducedMotion }) в этой сборке Chromium не доходит до страницы,
  // поэтому настройка включается явно через emulateMedia.
  test('reduced motion turns every fade off', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mockApi(page);
    await page.goto('/');
    // «Последние операции» на Обзоре при запуске сменяют скелетон и получают
    // класс проявления: на нем и проверяем, что анимации нет.
    await expect(page.locator('.fade-in').first()).toBeAttached();
    const names = await page.evaluate(() => [...document.querySelectorAll('.fade-in')]
      .map(el => getComputedStyle(el).animationName));
    expect(names.length).toBeGreaterThan(0);
    expect(names.every(name => name === 'none')).toBe(true);
  });

  test('a new operation makes the totals run to the new value, while the label already carries the final one', async ({ page }) => {
    await page.clock.setFixedTime(new Date(2026, 0, 10, 12));
    const data = structuredClone(transactions);
    await mockApi(page, { transactions: data });
    await page.route('**/api/transactions', (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      const body = route.request().postDataJSON();
      data.push({ _id: 'tx-new', title: 'Такси', amount: body.amount, type: 'expense', account: accounts[0]._id, date: '2026-01-10T00:00:00Z', category: categories[0].name });
      return route.fulfill({ status: 201, contentType: 'application/json', body: '{}' });
    });
    await page.goto('/');

    const expense = page.getByRole('button', { name: /^Расход: / });
    await expect(expense).toHaveAccessibleName(/Расход: €125,00/);
    // Первый показ без анимации: сразу итоговое значение, без дубля текста.
    await expect(expense.locator('[data-account-value]')).toHaveText('€125,00');
    await expect(expense.locator('.visually-hidden')).toHaveCount(0);

    // Пишем в странице, какие тексты проходило число, пока шла анимация.
    await page.evaluate(() => {
      window.__seen = new Set();
      const target = document.querySelector('button[aria-label^="Расход: "] [data-account-value]');
      const read = () => window.__seen.add(target.textContent);
      new MutationObserver(read).observe(target, { childList: true, subtree: true, characterData: true });
      read();
    });

    await nav(page).getByRole('button', { name: 'Добавить операцию' }).click();
    const dialog = page.getByRole('dialog', { name: 'Новый расход' });
    await dialog.locator('#transaction-amount').fill('875');
    // Нажатие на категорию сразу после открытия листа под нагрузкой
    // параллельных прогонов изредка не доходит до формы. Жмем, пока категория
    // не станет выбранной; по уже выбранной повторно не жмем.
    const category = dialog.getByRole('button', { name: categories[0].name, exact: true });
    await expect(async () => {
      if (await category.getAttribute('aria-pressed') !== 'true') await category.click();
      await expect(category).toHaveAttribute('aria-pressed', 'true', { timeout: 500 });
    }).toPass();
    await dialog.getByRole('button', { name: accounts[0].name, exact: true }).click();
    await dialog.getByRole('button', { name: 'Сохранить расход' }).click();
    await expect(dialog).toHaveCount(0);

    await expect(expense).toHaveAccessibleName(/Расход: €1\.000,00/);
    await expect(expense.locator('[data-account-value]')).toHaveText('€1.000,00');
    const seen = await page.evaluate(() => [...window.__seen]);
    const intermediate = seen.filter(text => !['€125,00', '€1.000,00'].includes(text.replace(/\s/g, '')));
    expect(intermediate.length).toBeGreaterThan(0);
    // Анимация доиграла: дубля для скринридера не осталось.
    await expect(expense.locator('.visually-hidden')).toHaveCount(0);
  });

  test('switching the month shows the other month at once, without running digits', async ({ page }) => {
    await page.clock.setFixedTime(new Date(2026, 0, 10, 12));
    await mockApi(page);
    await page.goto('/');
    const expense = page.getByRole('button', { name: /^Расход: / });
    await expect(expense).toHaveAccessibleName(/Расход: €125,00/);

    await page.evaluate(() => {
      window.__seen = new Set();
      const target = document.querySelector('button[aria-label^="Расход: "] [data-account-value]');
      new MutationObserver(() => window.__seen.add(target.textContent)).observe(target, { childList: true, subtree: true, characterData: true });
    });
    await page.getByRole('button', { name: 'Период: Январь 2026' }).click();
    await page.getByRole('dialog', { name: 'Выбор периода' }).getByRole('button', { name: 'Декабрь', exact: true }).click();
    await expect(expense).toHaveAccessibleName(/Расход: €0,00/);
    await page.waitForTimeout(500);
    const seen = await page.evaluate(() => [...window.__seen]);
    expect(seen.every(text => ['€125,00', '€0,00'].includes(text))).toBe(true);
    await expect(expense.locator('.visually-hidden')).toHaveCount(0);
  });
});
