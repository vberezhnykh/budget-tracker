import { test, expect } from '@playwright/test';
import { manyAccounts, mockApi } from './fixtures.js';

// Лента счетов на Обзоре при восьми счетах на самой узкой ширине (320px).
// Раньше здесь проверялись точки-индикаторы карусели: их ряд переставал
// помещаться в ширину и переносился. Теперь точек нет, а карточки идут в один
// ряд с горизонтальной прокруткой - проверяем, что они действительно в один
// ряд, не растягивают страницу и что выбор нажатием работает у каждой, в том
// числе у тех, что видны не сразу.
const WIDTH = 320;
const cardCount = manyAccounts.length + 1;

test('eight accounts fit in one scrollable row at 320px, and a tap selects each card', async ({ page }) => {
  await page.setViewportSize({ width: WIDTH, height: 700 });
  await page.clock.setFixedTime(new Date(2026, 8, 12, 12));
  await mockApi(page, { accounts: manyAccounts, plannedPayments: [] });
  await page.goto('/');

  const row = page.getByTestId('accounts-row');
  const cards = row.getByRole('button');
  await expect(cards).toHaveCount(cardCount);
  await expect(cards.first()).toHaveAttribute('aria-pressed', 'true');

  // Один ряд: у всех карточек один верх и одна высота, а страница не
  // стала шире экрана - горизонтально едет только сама лента.
  const geometry = await cards.evaluateAll(buttons => buttons.map(button => {
    const box = button.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  }));
  for (const box of geometry) {
    expect(Math.abs(box.y - geometry[0].y)).toBeLessThanOrEqual(1);
    expect(box.width).toBeGreaterThanOrEqual(140);
  }
  // Карточки не налезают друг на друга.
  for (let index = 1; index < geometry.length; index++) {
    expect(geometry[index - 1].x + geometry[index - 1].width).toBeLessThanOrEqual(geometry[index].x + 0.5);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(WIDTH);
  const scrollable = await row.evaluate(element => element.scrollWidth > element.clientWidth);
  expect(scrollable).toBe(true);

  // Выбор нажатием по каждой карточке: ровно она выбрана, и после выбора она
  // целиком в видимой области ленты (Playwright подводит её под палец, а
  // приложение - в видимую область при программной смене).
  for (const index of [1, 4, 8, 3, 0]) {
    await cards.nth(index).click();
    await expect(cards.nth(index)).toHaveAttribute('aria-pressed', 'true');
    await expect(row.locator('button[aria-pressed="true"]')).toHaveCount(1);
    const inView = await cards.nth(index).evaluate(button => {
      const box = button.getBoundingClientRect();
      const rowBox = button.parentElement.getBoundingClientRect();
      return box.left >= rowBox.left - 1 && box.right <= rowBox.right + 1;
    });
    expect(inView).toBe(true);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(WIDTH);
});
