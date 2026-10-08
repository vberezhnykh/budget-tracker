import { test, expect } from '@playwright/test';
import { accounts, categories, mockPhase2Api } from './fixtures.js';

test.describe('Navigation, transfers and trash (mobile)', () => {
  test('transfer account chips list every account, swap on conflict and via the swap button', async ({ page }) => {
    await mockPhase2Api(page);
    await page.goto('/');
    // Быстрой кнопки «Перевод» на Обзоре больше нет: «+» в нижней панели,
    // затем тип «Перевод» внутри формы.
    await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('button', { name: 'Добавить операцию' }).click();
    await page.getByRole('group', { name: 'Тип операции' }).getByRole('button', { name: 'Перевод' }).click();
    const from = page.getByRole('group', { name: 'Откуда', exact: true });
    const to = page.getByRole('group', { name: 'Куда', exact: true });
    const selected = group => group.locator('button[aria-pressed="true"]');
    await expect(from.getByRole('button')).toHaveCount(accounts.length);
    await expect(to.getByRole('button')).toHaveCount(accounts.length);
    const fromName = (await selected(from).textContent()).trim();
    const toName = (await selected(to).textContent()).trim();
    expect(fromName).not.toBe(toName);

    await page.getByRole('button', { name: 'Поменять счета местами' }).click();
    await expect(selected(from)).toHaveText(toName);
    await expect(selected(to)).toHaveText(fromName);

    // выбор в "Откуда" счёта, уже стоящего в "Куда", меняет стороны местами
    await from.getByRole('button', { name: fromName, exact: true }).click();
    await expect(selected(from)).toHaveText(fromName);
    await expect(selected(to)).toHaveText(toName);
  });

  test('five navigation cells fit at 320px and persisted trash restores after reload', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.clock.setFixedTime(new Date(2026, 8, 5, 12));
    const deleted = { _id: 'deleted-expense', __v: 0, title: 'Удалённый расход', amount: 45, type: 'expense', account: accounts[0]._id, category: categories[0].name, date: '2026-09-02T00:00:00.000Z' };
    const purged = { _id: 'purged-expense', __v: 0, title: 'Лишний расход', amount: 12, type: 'expense', account: accounts[0]._id, category: categories[0].name, date: '2026-09-01T00:00:00.000Z' };
    const state = await mockPhase2Api(page, {
      trash: [
        { id: deleted._id, deletionBatchId: 'batch-deleted', deletedAt: '2026-09-04T10:00:00.000Z', count: 1, transactions: [deleted] },
        { id: purged._id, deletionBatchId: 'batch-purged', deletedAt: '2026-09-03T10:00:00.000Z', count: 1, transactions: [purged] },
      ],
    });
    await page.goto('/');
    await expect(page.getByTestId('accounts-row')).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('accounts-row')).toBeVisible();

    const nav = page.getByRole('navigation', { name: 'Основная навигация' });
    // Четыре вкладки и кнопка добавления по центру.
    await expect(nav.getByRole('button')).toHaveCount(5);
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

    // Корзина - строка на экране «Ещё» с числом групп, внутренний экран.
    await nav.getByRole('button', { name: 'Ещё' }).click();
    await expect(page.getByRole('button', { name: /^Корзина/ })).toHaveText(/2$/);
    await page.getByRole('button', { name: /^Корзина/ }).click();
    await expect(page).toHaveURL(/#more\/trash$/);
    const trash = page.getByRole('main');
    await expect(trash.getByText('Удалённый расход')).toBeVisible();
    const trashScreenshot = testInfo.outputPath('trash-320.png');
    await page.waitForTimeout(400);
    await page.screenshot({ path: trashScreenshot, animations: 'disabled' });
    await testInfo.attach('trash-320', { path: trashScreenshot, contentType: 'image/png' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    await trash.locator('article', { hasText: 'Удалённый расход' }).getByRole('button', { name: 'Восстановить' }).click();
    await expect(trash.getByText('Удалённый расход')).toHaveCount(0);
    expect(state.transactions.some(transaction => transaction._id === deleted._id)).toBe(true);

    // Удаление навсегда подтверждается в карточке: без системного окна
    // (Playwright закрыл бы его отказом, и корзина осталась бы нетронутой).
    page.on('dialog', dialog => dialog.dismiss());
    const card = trash.locator('article', { hasText: 'Лишний расход' });
    await card.getByRole('button', { name: /^Удалить навсегда/ }).click();
    expect(state.trash).toHaveLength(1);
    await card.getByRole('group', { name: /^Подтверждение удаления/ }).getByRole('button', { name: 'Удалить' }).click();
    await expect(trash.getByText('Корзина пуста')).toBeVisible();
    expect(state.trash).toHaveLength(0);
  });
});
