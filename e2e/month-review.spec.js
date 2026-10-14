import { test, expect } from '@playwright/test';
import { mockApi } from './fixtures.js';

// «Итоги сентября» на Обзоре в первые дни нового месяца. Сам Claude не нужен -
// ответ /api/month-review подставляется здесь, как и остальной API. Браузер
// нужен затем, что jsdom не видит раскладку (размер нажатия, место карточки на
// экране) и не хранит «скрыто» между перезагрузками.

const settings = { monthlyLimit: 7000, features: { monthReview: true } };

const review = {
  headline: 'Сентябрь: на €210 больше обычного',
  points: [
    { text: 'Расходы составили €1 210 при обычных €1 000.', category: null },
    { text: 'Продукты на €120 больше обычного.', category: 'Еда' },
  ],
};

const payload = { month: '2026-09', review, generatedAt: '2026-10-01T08:00:00.000Z', stale: false };

// Запросы к /api/month-review копятся в requests (тело разобрано).
async function openOverview(page, { day, settings: pageSettings = settings, response = payload } = {}) {
  const requests = [];
  await page.clock.setFixedTime(new Date(2026, 9, day, 12));
  await mockApi(page, { settings: pageSettings });
  await page.route('**/api/month-review', (route) => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) });
  });
  await page.goto('/');
  await expect(page.getByTestId('accounts-row')).toBeVisible();
  return requests;
}

test.describe('Month review card (mobile, real browser)', () => {
  test('on day 5 the card appears under the hero, above «Счета», and the request carries the reviewed month and today', async ({ page }) => {
    const requests = await openOverview(page, { day: 5 });

    const card = page.getByRole('region', { name: review.headline });
    await expect(card).toBeVisible();
    await expect(card.getByText('Итоги сентября')).toBeVisible();
    await expect(card.getByText('Расходы составили €1 210 при обычных €1 000.')).toBeVisible();
    await expect(card.getByRole('button', { name: /Продукты на €120 больше обычного/ })).toBeVisible();
    expect(requests).toEqual([{ month: '2026-09', today: '2026-10-05' }]);

    // Раскладка: ниже главной карточки, выше «Счетов», в ширину телефона, нажатия не меньше 44px
    const cardBox = await card.boundingBox();
    const hero = await page.getByText('Расход за октябрь').boundingBox();
    const accountsHeading = await page.getByRole('heading', { name: 'Счета' }).boundingBox();
    expect(cardBox.y).toBeGreaterThan(hero.y);
    expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(accountsHeading.y);
    expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const close = await card.getByRole('button', { name: 'Скрыть итоги месяца' }).boundingBox();
    expect(close.width).toBeGreaterThanOrEqual(44);
    expect(close.height).toBeGreaterThanOrEqual(44);
    const row = await card.getByRole('button', { name: /Продукты на €120/ }).boundingBox();
    expect(row.height).toBeGreaterThanOrEqual(44);
    // Крестик в правом верхнем углу карточки
    expect(close.x + close.width).toBeLessThanOrEqual(cardBox.x + cardBox.width);
    expect(close.y).toBeLessThan(cardBox.y + 24);
  });

  test('tapping a point with a category opens History filtered by that category and expenses', async ({ page }) => {
    await openOverview(page, { day: 5 });

    await page.getByRole('button', { name: /Продукты на €120 больше обычного/ }).click();

    const nav = page.getByRole('navigation', { name: 'Основная навигация' });
    await expect(nav.getByRole('button', { name: 'История' })).toHaveAttribute('aria-current', 'page');
    expect(new URL(page.url()).hash).toBe('#history');
    await expect(page.getByRole('button', { name: 'Еда', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('Тип: Расходы')).toBeVisible();
    await expect(page.getByText('Продукты на неделю')).toBeVisible();
    await expect(page.getByText('Пополнение')).toHaveCount(0);
  });

  test('a point without a category is plain text', async ({ page }) => {
    await openOverview(page, { day: 5 });

    const card = page.getByRole('region', { name: review.headline });
    await expect(card.getByText('Расходы составили €1 210 при обычных €1 000.')).toBeVisible();
    await expect(card.getByRole('button', { name: /Расходы составили/ })).toHaveCount(0);
  });

  test('dismissing hides the card and it stays hidden after a reload without asking again', async ({ page }) => {
    const requests = await openOverview(page, { day: 5 });
    const card = page.getByRole('region', { name: review.headline });
    await expect(card).toBeVisible();

    await card.getByRole('button', { name: 'Скрыть итоги месяца' }).click();
    await expect(card).toHaveCount(0);

    await page.reload();
    await expect(page.getByTestId('accounts-row')).toBeVisible();
    await expect(page.getByRole('region', { name: review.headline })).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('monthReview:dismissed:2026-09'))).toBe('1');
    expect(requests).toHaveLength(1);
  });

  test('switching tabs back and forth does not ask again', async ({ page }) => {
    const requests = await openOverview(page, { day: 5 });
    const nav = page.getByRole('navigation', { name: 'Основная навигация' });
    await expect(page.getByRole('region', { name: review.headline })).toBeVisible();

    await nav.getByRole('button', { name: 'Аналитика' }).click();
    await nav.getByRole('button', { name: 'Обзор' }).click();

    await expect(page.getByRole('region', { name: review.headline })).toBeVisible();
    expect(requests).toHaveLength(1);
  });

  test('a review that could not be written leaves no card', async ({ page }) => {
    await openOverview(page, { day: 5, response: { month: '2026-09', review: null, reason: 'not_enough_history' } });
    await expect(page.getByRole('heading', { name: 'Счета' })).toBeVisible();
    await expect(page.getByTestId('month-review-card')).toHaveCount(0);
  });

  test('on day 11 there is no request and no card', async ({ page }) => {
    const requests = await openOverview(page, { day: 11 });

    await expect(page.getByRole('heading', { name: 'Счета' })).toBeVisible();
    await expect(page.getByTestId('month-review-card')).toHaveCount(0);
    expect(requests).toHaveLength(0);
  });

  test('without features.monthReview there is no request and no card', async ({ page }) => {
    const requests = await openOverview(page, { day: 5, settings: { monthlyLimit: 7000 } });

    await expect(page.getByRole('heading', { name: 'Счета' })).toBeVisible();
    await expect(page.getByTestId('month-review-card')).toHaveCount(0);
    expect(requests).toHaveLength(0);
  });
});
