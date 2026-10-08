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

test('jumping to an unloaded month allows scrolling back into newer pages without moving visible rows', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-02T12:00:00Z'));
  await mockApi(page, { transactions: [
    ...Array.from({ length: 60 }, (_, i) => purchase(`oct-${String(i).padStart(3, '0')}`, '2026-10-01', `Октябрь ${i}`)),
    ...Array.from({ length: 60 }, (_, i) => purchase(`sep-${String(i).padStart(3, '0')}`, '2026-09-30', `Сентябрь ${i}`)),
  ] });
  await page.goto('/');
  await goTo(page, 'История');
  const scroll = page.getByTestId('history-scroll');
  await expect(page.getByText('Октябрь 59', { exact: true })).toBeVisible();
  await chooseHistoryMonth(page, 'Сентябрь');
  const row = page.getByText('Сентябрь 59', { exact: true });
  await expect(row).toBeVisible();
  // Move upwards into the top prefetch zone. This must fetch the adjacent
  // (oldest) October page, preserving the position of the September rows.
  await scroll.evaluate(el => { el.scrollTop -= 20; });
  const before = (await row.boundingBox()).y;
  await expect(page.getByText('Октябрь 0', { exact: true })).toHaveCount(1);
  await expect.poll(async () => Math.abs((await row.boundingBox()).y - before)).toBeLessThan(2);
  await expect(page.getByText('Октябрь 59', { exact: true })).toHaveCount(0);
  const octoberAnchor = page.getByText('Октябрь 39', { exact: true });
  await scroll.evaluate(el => { el.scrollTop = 0; });
  const octoberBefore = (await octoberAnchor.boundingBox()).y;
  await expect(page.getByText('Октябрь 59', { exact: true })).toHaveCount(1);
  await expect.poll(async () => Math.abs((await octoberAnchor.boundingBox()).y - octoberBefore)).toBeLessThan(2);
  await expect(page.getByText('Сентябрь 59', { exact: true })).toHaveCount(1);
});
