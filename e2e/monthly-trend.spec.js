import { test, expect } from '@playwright/test';
import { mockApi } from './fixtures.js';

// The timeline must keep the later months when an earlier month is chosen.
// Browser geometry is needed here: jsdom cannot catch a vanished scroll
// destination or a chart that makes the whole phone page wider.
const monthlyTransactions = [
  ['2025-12', 2400, 900],
  ['2026-01', 3200, 1150],
  ['2026-06', 3000, 1300],
  ['2026-07', 3300, 1650],
  ['2026-08', 3500, 1800],
  ['2026-09', 3600, 720],
].flatMap(([month, income, expense]) => [
  { _id: `${month}-income`, title: 'Зарплата', amount: income, type: 'income', account: 'acc-card-1', date: `${month}-02T12:00:00.000Z`, category: 'Зарплата' },
  { _id: `${month}-expense`, title: 'Покупки', amount: expense, type: 'expense', account: 'acc-card-1', date: `${month}-03T12:00:00.000Z`, category: 'Еда' },
]);

async function openAnalytics(page, width = 390) {
  await page.setViewportSize({ width, height: 1000 });
  await page.clock.setFixedTime(new Date(2026, 8, 12, 12));
  await mockApi(page, { transactions: monthlyTransactions, plannedPayments: [] });
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Основная навигация' })
    .getByRole('button', { name: /Аналитика/ }).click();
  const trend = page.getByRole('region', { name: 'По месяцам', exact: true });
  await expect(trend).toBeVisible();
  // Align above the fixed bottom navigation before visual checks.
  await trend.evaluate(element => element.scrollIntoView({ block: 'start', behavior: 'instant' }));
  return trend;
}

test.describe('Monthly trend navigation (mobile)', () => {
  test('August keeps September available through horizontal scrolling and selection', async ({ page }, testInfo) => {
    const trend = await openAnalytics(page);
    const scroll = trend.getByTestId('monthly-trend-scroll');
    const august = trend.getByRole('button', { name: /^Август 2026:/ });
    const september = trend.getByRole('button', { name: /^Сентябрь 2026:/ });
    const period = page.getByRole('button', { name: /^Период:/ });
    const monthButtons = trend.locator('button[aria-pressed]');
    const monthCount = await monthButtons.count();
    expect(monthCount).toBeGreaterThanOrEqual(11);
    await expect(september).toHaveAttribute('aria-pressed', 'true');
    await expect(september).toHaveAttribute('aria-label', /720,00/);

    await august.click();
    await expect(period).toHaveAccessibleName('Период: Август 2026');
    await expect(august).toHaveAttribute('aria-pressed', 'true');
    await expect(august).toHaveAttribute('aria-label', /1\.800,00/);
    await expect(monthButtons).toHaveCount(monthCount);
    await expect(september).toHaveCount(1);

    const dimensions = await scroll.evaluate(element => ({
      width: element.clientWidth,
      contentWidth: element.scrollWidth,
      overflow: getComputedStyle(element).overflowX,
    }));
    expect(dimensions.contentWidth).toBeGreaterThan(dimensions.width);
    expect(['auto', 'scroll']).toContain(dimensions.overflow);

    // Exercise the actual native scroll surface in both directions; its
    // contents must survive the period change, including the return target.
    await scroll.evaluate(element => element.scrollTo({ left: 0, behavior: 'instant' }));
    await expect.poll(() => scroll.evaluate(element => element.scrollLeft)).toBe(0);
    await scroll.evaluate(element => element.scrollTo({ left: element.scrollWidth, behavior: 'instant' }));
    await expect.poll(() => scroll.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
    await expect(september).toBeInViewport();
    await september.click();
    await expect(period).toHaveAccessibleName('Период: Сентябрь 2026');
    await expect(september).toHaveAttribute('aria-pressed', 'true');
    await expect(monthButtons).toHaveCount(monthCount);

    await trend.evaluate(element => element.scrollIntoView({ block: 'start', behavior: 'instant' }));
    const screenshot = testInfo.outputPath('monthly-trend-september-390.png');
    await trend.screenshot({ path: screenshot, animations: 'disabled' });
    await testInfo.attach('monthly-trend-september-390', { path: screenshot, contentType: 'image/png' });
  });

  test('tapping bars crosses the year boundary and does not truncate the timeline', async ({ page }) => {
    const trend = await openAnalytics(page);
    const period = page.getByRole('button', { name: /^Период:/ });
    const january = trend.getByRole('button', { name: /^Январь 2026:/ });
    const december = trend.getByRole('button', { name: /^Декабрь 2025:/ });
    const september = trend.getByRole('button', { name: /^Сентябрь 2026:/ });
    await january.click();
    await expect(period).toHaveAccessibleName('Период: Январь 2026');

    await december.click();
    await expect(december).toHaveAttribute('aria-pressed', 'true');
    await expect(period).toHaveAccessibleName('Период: Декабрь 2025');
    await expect(september).toHaveCount(1);

    await january.click();
    await expect(january).toHaveAttribute('aria-pressed', 'true');
    await expect(period).toHaveAccessibleName('Период: Январь 2026');

    await trend.getByRole('button', { name: /^Ноябрь 2025:/ }).click();
    await expect(period).toHaveAccessibleName('Период: Ноябрь 2025');
    await expect(september).toHaveCount(1);
  });

  test('year and lifetime filters keep later months reachable within the trend', async ({ page }) => {
    const trend = await openAnalytics(page);
    const period = page.getByRole('button', { name: /^Период:/ });
    await period.click();
    const picker = page.getByRole('dialog', { name: 'Выбор периода' });
    await picker.getByRole('button', { name: 'Год', exact: true }).click();
    await picker.getByRole('button', { name: '2025 год', exact: true }).click();
    await expect(period).toHaveAccessibleName('Период: 2025 год');
    await expect(trend.getByRole('button', { name: /^Сентябрь 2026:/ })).toHaveCount(1);

    await period.click();
    await picker.getByRole('button', { name: 'Всё время', exact: true }).click();
    await expect(period).toHaveAccessibleName('Период: Всё время');
    await trend.getByRole('button', { name: /^Сентябрь 2026:/ }).click();
    await expect(period).toHaveAccessibleName('Период: Сентябрь 2026');
    await expect(trend.getByRole('button', { name: /^Декабрь 2025:/ })).toHaveCount(1);
  });

  test('a 320px phone keeps chart overflow inside its scroll surface', async ({ page }, testInfo) => {
    const trend = await openAnalytics(page, 320);
    const scroll = trend.getByTestId('monthly-trend-scroll');
    const screenshot = testInfo.outputPath('monthly-trend-320.png');
    await trend.screenshot({ path: screenshot, animations: 'disabled' });
    await testInfo.attach('monthly-trend-320', { path: screenshot, contentType: 'image/png' });
    const geometry = await trend.evaluate(element => {
      const box = element.getBoundingClientRect();
      return {
        left: box.left,
        right: box.right,
        viewport: window.innerWidth,
        pageWidth: document.documentElement.scrollWidth,
        cardWidth: element.clientWidth,
        cardScrollWidth: element.scrollWidth,
      };
    });
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(geometry.viewport);
    expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewport);
    expect(geometry.cardScrollWidth).toBeLessThanOrEqual(geometry.cardWidth);
    expect(await scroll.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);

    // Столбец - вся высота графика и не уже пальца: на 320px шесть месяцев
    // делят ширину карточки поровну.
    for (const name of [/^Сентябрь 2026:/, /^Август 2026:/]) {
      const box = await trend.getByRole('button', { name }).boundingBox();
      expect(box.width).toBeGreaterThanOrEqual(32);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(geometry.left);
      expect(box.x + box.width).toBeLessThanOrEqual(geometry.right);
    }
  });

  test('the bars show the limit line, the over-limit colour and the forecast outline', async ({ page }) => {
    const trend = await openAnalytics(page);

    await expect(trend.getByTestId('monthly-trend-limit')).toBeVisible();
    await expect(trend.getByText('лимит €7.000')).toBeVisible();
    // В фикстурах ни один месяц не доходит до лимита €7.000.
    await expect(trend.locator('[data-over-limit]')).toHaveCount(0);
    // Сентябрь - выбранный и идущий: акцентный столбец и контур прогноза за ним.
    await expect(trend.getByRole('button', { name: /^Сентябрь 2026:/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(trend.getByTestId('monthly-trend-ghost')).toBeVisible();
    await expect(trend.getByText(/^Лимит не превышался ни в одном из 5 закрытых\. Средний расход €/)).toBeVisible();
  });
});

test.describe('Analytics screen (mobile)', () => {
  test('pace chart, categories and totals fit a 320px phone and the category opens the history', async ({ page }, testInfo) => {
    await openAnalytics(page, 320);
    await page.evaluate(() => window.scrollTo(0, 0));

    await expect(page.getByRole('heading', { level: 1, name: 'Аналитика' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Темп трат' })).toBeVisible();
    const chart = page.getByRole('img', { name: /^График темпа трат/ });
    await expect(chart).toBeVisible();
    const box = await chart.boundingBox();
    expect(box.width).toBeGreaterThan(200);
    expect(box.height).toBeGreaterThan(100);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
    await expect(page.getByText('Прогноз на 30 сентября')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Категории' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Итоги' })).toBeVisible();

    // Страница не шире экрана ни в одной точке прокрутки.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    const screenshot = testInfo.outputPath('analytics-320.png');
    await page.screenshot({ path: screenshot, fullPage: true, animations: 'disabled' });
    await testInfo.attach('analytics-320', { path: screenshot, contentType: 'image/png' });

    // Нажатие на категорию открывает Историю с фильтром по ней.
    await page.getByRole('button', { name: /^Еда: €/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'История' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Фильтр по категории' }).getByRole('button', { name: 'Еда' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('a month without enough history says so instead of drawing the pace chart', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 1000 });
    await page.clock.setFixedTime(new Date(2026, 8, 12, 12));
    await mockApi(page, { transactions: monthlyTransactions.filter(t => t._id.startsWith('2026-09')), plannedPayments: [] });
    await page.goto('/#analytics');

    await expect(page.getByText('Для сравнения с обычным месяцем нужно хотя бы три полных месяца истории.')).toBeVisible();
    await expect(page.getByRole('img', { name: /^График темпа трат/ })).toHaveCount(0);
  });
});
