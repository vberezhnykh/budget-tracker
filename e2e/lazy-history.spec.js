import { test, expect } from '@playwright/test';
import { mockApi } from './fixtures.js';

const goTo = (page, name) => page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('button', { name, exact: true }).click();
const dayBefore = (from, days) => new Date(from.getTime() - days * 86400000).toISOString().slice(0, 10);
const purchases = (count, perDay = 1) => Array.from({ length: count }, (_, index) => ({
  _id: String(index).padStart(5, '0'), title: `Покупка ${index}`, amount: 10, type: 'expense',
  account: 'acc-card-1', date: dayBefore(new Date('2026-09-20T00:00:00Z'), Math.floor(index / perDay)), category: 'Еда',
}));
const rowsOf = page => page.getByRole('button', { name: /^Покупка \d+,/ });
// Запросы списка Истории (блок «Последние операции» на Обзоре ходит с limit=5).
const trackHistory = page => {
  const requested = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname === '/api/history' && url.searchParams.get('limit') !== '5') requested.push(url);
  });
  return requested;
};

test('history loads the whole list in one request and reveals older days locally while scrolling', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-24T12:00:00Z'));
  const requested = [];
  page.on('request', request => requested.push(request.url()));
  await mockApi(page, { transactions: purchases(300) });
  await page.goto('/');
  await goTo(page, 'История');
  const rows = rowsOf(page);
  await expect(rows.first()).toBeVisible();
  // В DOM только окно (~60 строк), а не все 300.
  const first = await rows.count();
  expect(first).toBeGreaterThanOrEqual(50);
  expect(first).toBeLessThan(100);
  const scroll = page.getByTestId('history-scroll');
  await expect.poll(async () => {
    await scroll.evaluate(element => { element.scrollTop = element.scrollHeight; });
    return rows.count();
  }).toBe(300);
  expect(requested.some(url => new URL(url).pathname === '/api/transactions')).toBe(false);
  const history = requested.map(url => new URL(url)).filter(url => url.pathname === '/api/history' && url.searchParams.get('limit') !== '5');
  expect(history).toHaveLength(1);
  expect(history[0].searchParams.get('all')).toBe('1');
  expect(history[0].searchParams.has('cursor')).toBe(false);
});

test('switching the filter A -> B -> A asks for A only once', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-01-15T12:00:00Z'));
  await mockApi(page);
  const requested = trackHistory(page);
  await page.goto('/');
  await goTo(page, 'История');
  await expect(page.getByText('Продукты на неделю', { exact: true })).toBeVisible();
  expect(requested).toHaveLength(1);
  const accounts = page.getByRole('group', { name: 'Фильтр по счёту' });

  await accounts.getByRole('button', { name: 'Наличные' }).click();
  await expect(page.getByText('Кофе', { exact: true })).toBeVisible();
  await expect(page.getByText('Продукты на неделю', { exact: true })).toHaveCount(0);
  expect(requested).toHaveLength(2);

  // Назад к «Все счета» и снова на «Наличные»: оба списка уже в памяти.
  await accounts.getByRole('button', { name: 'Все счета' }).click();
  await expect(page.getByText('Продукты на неделю', { exact: true })).toBeVisible();
  await accounts.getByRole('button', { name: 'Наличные' }).click();
  await expect(page.getByText('Кофе', { exact: true })).toBeVisible();
  await expect(page.getByText('Продукты на неделю', { exact: true })).toHaveCount(0);
  expect(requested).toHaveLength(2);
});

test('after editing an operation the list stays on screen and the change appears', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-01-15T12:00:00Z'));
  const transactions = [
    { _id: 'tx-1', title: 'Зарплата', amount: 3000, type: 'income', account: 'acc-card-1', date: '2026-01-01T00:00:00Z', category: 'Зарплата' },
    { _id: 'tx-2', title: 'Продукты', amount: 120, type: 'expense', account: 'acc-card-1', date: '2026-01-05T00:00:00Z', category: 'Еда' },
  ];
  await mockApi(page, { transactions });
  await page.route('**/api/transactions/tx-2', route => {
    if (route.request().method() !== 'PUT') return route.fallback();
    Object.assign(transactions[1], { amount: 77 });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(transactions[1]) });
  });
  await page.goto('/');
  await goTo(page, 'История');
  await page.getByRole('button', { name: /^Продукты,/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Редактировать' });
  await dialog.locator('#transaction-amount').fill('77');
  // Обновленный список придет не сразу: запросы Истории ждут, пока тест их не отпустит.
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let held = 0;
  await page.route('**/api/history?*', async route => {
    held += 1;
    await gate;
    await route.fallback();
  });
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => held).toBeGreaterThan(0);
  // Прежние строки на месте, скелетона нет.
  await expect(page.getByText('Продукты', { exact: true })).toBeVisible();
  await expect(page.getByText('Зарплата', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('status', { name: 'Загрузка операций…' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /−€77,00$/ })).toHaveCount(0);
  release();
  await expect(page.getByRole('button', { name: /^Продукты, .*−€77,00$/ })).toBeVisible();
  await expect(page.getByText('Продукты', { exact: true })).toBeVisible();
  await expect(page.getByRole('status', { name: 'Загрузка операций…' })).toHaveCount(0);
});

test('with ~2000 operations History opens fast, renders only a window and has no horizontal overflow', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-24T12:00:00Z'));
  await mockApi(page, { transactions: purchases(2000, 3) });
  await page.goto('/');
  await expect(page.getByTestId('accounts-row')).toBeVisible();
  const started = performance.now();
  await goTo(page, 'История');
  await expect(rowsOf(page).first()).toBeVisible({ timeout: 2000 });
  expect(performance.now() - started).toBeLessThan(2000);
  const rendered = await page.locator('[data-history-item]').count();
  expect(rendered).toBeGreaterThan(0);
  expect(rendered).toBeLessThan(200);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const scroll = page.getByTestId('history-scroll');
  expect(await scroll.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
});
