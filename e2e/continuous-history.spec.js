import { test, expect } from '@playwright/test';
import { mockApi } from './fixtures.js';

const purchase = (id, date, title = id) => ({
  _id: id, title, amount: 10, type: 'expense', account: 'acc-card-1', date, category: 'Еда',
});
const goTo = (page, name) => page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('button', { name, exact: true }).click();
const chooseHistoryMonth = async (page, month) => {
  await page.getByTestId('history-scroll').getByRole('button', { name: /^Месяц истории:/ }).first().click();
  const picker = page.getByRole('dialog', { name: 'Переход к месяцу' });
  await picker.getByRole('button', { name: month, exact: true }).click();
  await expect(picker).not.toBeVisible();
};

test('adjacent months share a sticky timeline, keep the dashboard period and restore scroll', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-02T12:00:00Z'));
  await mockApi(page, { transactions: [
    ...Array.from({ length: 10 }, (_, i) => purchase(`oct-${i}`, '2026-10-01', `Октябрь ${i}`)),
    ...Array.from({ length: 20 }, (_, i) => purchase(`sep-${i}`, '2026-09-30', `Сентябрь ${i}`)),
  ] });
  await page.goto('/');
  await goTo(page, 'История');
  const scroll = page.getByTestId('history-scroll');
  await expect(page.getByText('Октябрь 0', { exact: true })).toHaveCount(1);
  await expect(page.getByText('Сентябрь 0', { exact: true })).toHaveCount(1);
  await chooseHistoryMonth(page, 'Сентябрь');
  await scroll.evaluate(el => { el.scrollTop += 120; });
  const heading = page.locator('[data-history-month="2026-09"] [data-testid="history-month-heading"]');
  await expect.poll(async () => Math.abs((await heading.boundingBox()).y - (await scroll.boundingBox()).y)).toBeLessThan(2);
  const saved = await scroll.evaluate(el => el.scrollTop);
  // Ушли на Обзор и вернулись: экран Истории размонтирован, но положение
  // списка хранит App, и оно возвращается.
  await goTo(page, 'Обзор');
  await expect(page.getByRole('button', { name: 'Период: Октябрь 2026' })).toBeVisible();
  await goTo(page, 'История');
  await expect.poll(() => scroll.evaluate(el => el.scrollTop)).toBeCloseTo(saved, 0);
  // A deliberate dashboard month change overrides the remembered position.
  await goTo(page, 'Обзор');
  await page.getByRole('button', { name: 'Период: Октябрь 2026' }).click();
  await page.getByRole('dialog', { name: 'Выбор периода' }).getByRole('button', { name: 'Сентябрь', exact: true }).click();
  await goTo(page, 'История');
  await expect.poll(async () => Math.abs((await heading.boundingBox()).y - (await scroll.boundingBox()).y)).toBeLessThan(2);
  await expect.poll(() => scroll.evaluate(el => el.scrollTop)).not.toBeCloseTo(saved, 0);
});

// Вся лента приходит одним запросом: прыжок к месяцу и подгрузка новых дней
// при прокрутке вверх - это перестановка окна на клиенте, без сети.
test('jumping to a month and scrolling up reveal newer rows locally, keeping the visible rows in place', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-02T12:00:00Z'));
  await mockApi(page, { transactions: [
    ...Array.from({ length: 60 }, (_, i) => purchase(`oct-${String(i).padStart(3, '0')}`, '2026-10-01', `Октябрь ${i}`)),
    ...Array.from({ length: 60 }, (_, i) => purchase(`sep-${String(i).padStart(3, '0')}`, '2026-09-30', `Сентябрь ${i}`)),
  ] });
  const requested = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname === '/api/history' && url.searchParams.get('limit') !== '5') requested.push(url);
  });
  await page.goto('/');
  await goTo(page, 'История');
  const scroll = page.getByTestId('history-scroll');
  await expect(page.getByText('Октябрь 59', { exact: true })).toBeVisible();
  // В DOM только окно: сентябрь за его пределами.
  await expect(page.getByText('Сентябрь 59', { exact: true })).toHaveCount(0);
  expect(requested).toHaveLength(1);
  expect(requested[0].searchParams.get('all')).toBe('1');
  expect(requested[0].searchParams.has('month')).toBe(false);

  await chooseHistoryMonth(page, 'Сентябрь');
  const row = page.getByText('Сентябрь 55', { exact: true });
  await expect(row).toBeVisible();
  await expect(page.getByText('Октябрь 0', { exact: true })).toHaveCount(0);
  expect(requested).toHaveLength(1);

  // Вниз, затем немного вверх: у начала списка сверху открываются более новые
  // дни, а видимые строки остаются там, где были.
  const scrollTo = top => scroll.evaluate((el, value) => new Promise(resolve => {
    el.scrollTop = value;
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }), top);
  await scrollTo(300);
  const before = (await row.boundingBox()).y;
  await scrollTo(100);
  await expect(page.getByText('Октябрь 0', { exact: true })).toHaveCount(1);
  // Строка сместилась ровно на те 200px, что пролистали вверх: новые дни её не сдвинули.
  await expect.poll(async () => Math.abs((await row.boundingBox()).y - (before + 200))).toBeLessThan(2);
  expect(requested).toHaveLength(1);
});

test('the «Показать более новые» button opens newer rows when the list is too short to scroll', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-02T12:00:00Z'));
  await mockApi(page, { transactions: [
    ...Array.from({ length: 60 }, (_, i) => purchase(`oct-${String(i).padStart(3, '0')}`, '2026-10-01', `Октябрь ${i}`)),
    purchase('sep-1', '2026-09-30', 'Единственная сентябрьская'),
  ] });
  await page.goto('/');
  await goTo(page, 'История');
  await chooseHistoryMonth(page, 'Сентябрь');
  const row = page.getByText('Единственная сентябрьская', { exact: true });
  await expect(row).toBeVisible();
  await expect(page.getByText('Октябрь 0', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Показать более новые' }).click();
  await expect(page.getByText('Октябрь 0', { exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Показать более новые' })).toHaveCount(0);
  // Под строкой мало содержимого, и точное место удержать нельзя, но строка
  // остаётся на экране, а не уезжает за его край.
  await expect(row).toBeInViewport();
});
