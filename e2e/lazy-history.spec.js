import { test, expect } from '@playwright/test';
import { mockApi } from './fixtures.js';

test('history loads another page near the bottom of the mobile drawer', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-24T12:00:00Z'));
  const transactions = Array.from({ length: 85 }, (_, index) => ({
    _id: String(index).padStart(3, '0'), title: `Покупка ${index}`, amount: 10,
    type: 'expense', account: 'acc-card-1', date: '2026-09-20', category: 'Еда',
  }));
  const requested = [];
  page.on('request', request => requested.push(request.url()));
  await mockApi(page, { transactions });
  await page.goto('/');
  await page.getByRole('button', { name: 'Открыть список операций' }).click();
  const drawer = page.getByTestId('transactions-drawer');
  const rows = drawer.getByRole('button', { name: /^Покупка \d+,/ });
  await expect(rows).toHaveCount(40);
  await drawer.getByTestId('history-scroll').evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(rows).toHaveCount(80);
  await expect(drawer.getByText('-850.00€')).toHaveCount(1);
  expect(requested.some(url => new URL(url).pathname === '/api/transactions')).toBe(false);
  expect(requested.some(url => new URL(url).searchParams.has('cursor'))).toBe(true);
});
