import { test, expect } from '@playwright/test';
import { accounts, categories, mockPhase2Api } from './fixtures.js';

test.describe('Navigation, transfers and trash (mobile)', () => {
  test('transfer account options exclude the opposite side and still allow swapping', async ({ page }) => {
    await mockPhase2Api(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Добавить перевод' }).click();
    const from = page.getByLabel('Откуда', { exact: true });
    const to = page.getByLabel('Куда', { exact: true });
    const fromId = await from.inputValue();
    const toId = await to.inputValue();
    expect(fromId).not.toBe(toId);
    await expect(from.locator(`option[value="${toId}"]`)).toHaveCount(0);
    await expect(to.locator(`option[value="${fromId}"]`)).toHaveCount(0);
    await page.getByRole('button', { name: 'Поменять счета местами' }).click();
    await expect(from).toHaveValue(toId);
    await expect(to).toHaveValue(fromId);
    await expect(from.locator(`option[value="${fromId}"]`)).toHaveCount(0);
    await expect(to.locator(`option[value="${toId}"]`)).toHaveCount(0);
  });

  test('two navigation tabs fit at 320px and persisted trash restores after reload', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.clock.setFixedTime(new Date(2026, 8, 5, 12));
    const deleted = { _id: 'deleted-expense', __v: 0, title: 'Удалённый расход', amount: 45, type: 'expense', account: accounts[0]._id, category: categories[0].name, date: '2026-09-02T00:00:00.000Z' };
    const state = await mockPhase2Api(page, {
      trash: [{ id: deleted._id, deletionBatchId: 'batch-deleted', deletedAt: '2026-09-04T10:00:00.000Z', count: 1, transactions: [deleted] }],
    });
    await page.goto('/');
    await expect(page.getByText('BudgetTracker')).toBeVisible();
    await page.reload();
    await expect(page.getByText('BudgetTracker')).toBeVisible();

    const nav = page.getByRole('navigation', { name: 'Основная навигация' });
    await expect(nav.getByRole('button')).toHaveCount(2);
    await expect(nav.getByRole('button', { name: /Платежи/ })).toHaveCount(0);
    const geometry = await nav.evaluate((element) => ({
      left: element.getBoundingClientRect().left,
      right: element.getBoundingClientRect().right,
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      buttons: Array.from(element.querySelectorAll('button')).map(button => {
        const box = button.getBoundingClientRect();
        return { left: box.left, right: box.right, scrollWidth: button.scrollWidth, clientWidth: button.clientWidth };
      }),
    }));
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
    for (const button of geometry.buttons) {
      expect(button.left).toBeGreaterThanOrEqual(geometry.left);
      expect(button.right).toBeLessThanOrEqual(geometry.right);
      expect(button.scrollWidth).toBeLessThanOrEqual(button.clientWidth);
    }

    await page.getByTitle('Настройки').click();
    await page.getByRole('button', { name: /Корзина операций/ }).click();
    const trashDialog = page.getByRole('dialog', { name: 'Корзина операций' });
    await expect(trashDialog.getByText('Удалённый расход')).toBeVisible();
    const trashScreenshot = testInfo.outputPath('trash-320.png');
    await page.waitForTimeout(400);
    await page.screenshot({ path: trashScreenshot, animations: 'disabled' });
    await testInfo.attach('trash-320', { path: trashScreenshot, contentType: 'image/png' });
    await trashDialog.getByRole('button', { name: 'Восстановить' }).click();
    await expect(trashDialog.getByText('Корзина пуста.')).toBeVisible();
    expect(state.trash).toHaveLength(0);
    expect(state.transactions.some(transaction => transaction._id === deleted._id)).toBe(true);
  });
});
