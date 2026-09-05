import { test, expect } from '@playwright/test';
import { accounts, categories, mockPhase2Api, transactions } from './fixtures.js';

test.describe('Upcoming payments and trash (mobile)', () => {
  test('a plan leaves the balance unchanged until payment and renders the payment flow', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 1000 });
    await page.clock.setFixedTime(new Date(2026, 8, 5, 12));
    const state = await mockPhase2Api(page);
    await page.goto('/');
    const totalSlide = page.getByRole('button', { name: /^Общий капитал:/ });
    await expect(totalSlide).toBeVisible();
    const balanceBefore = await totalSlide.getAttribute('aria-label');

    await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('button', { name: /Платежи/ }).click();
    await expect(page.getByTestId('planned-payments-view')).toBeVisible();
    const paymentsScreenshot = testInfo.outputPath('planned-payments-390.png');
    await page.waitForTimeout(400);
    await page.screenshot({ path: paymentsScreenshot, animations: 'disabled' });
    await testInfo.attach('planned-payments-390', { path: paymentsScreenshot, contentType: 'image/png' });

    await page.getByRole('button', { name: '+ Добавить' }).click();
    const createDialog = page.getByRole('dialog', { name: 'Добавить предстоящий платёж' });
    await createDialog.getByPlaceholder('Например, аренда').fill('Страховка');
    await createDialog.getByLabel('Плановая сумма, €').fill('100');
    await createDialog.getByLabel('Дата платежа').fill('2026-09-25');
    await createDialog.getByRole('button', { name: 'Сохранить' }).click();
    await expect(page.getByText('Страховка', { exact: true })).toBeVisible();
    expect(state.transactions).toHaveLength(transactions.length);
    expect(await totalSlide.getAttribute('aria-label')).toBe(balanceBefore);

    const insuranceCard = page.getByText('Страховка', { exact: true }).locator('xpath=ancestor::article');
    await insuranceCard.getByRole('button', { name: 'Оплатить' }).click();
    const payDialog = page.getByRole('dialog', { name: 'Оплатить: Страховка' });
    await expect(payDialog.getByLabel('Дата факта')).toHaveValue('2026-09-05');
    const payScreenshot = testInfo.outputPath('planned-payment-pay-form-390.png');
    await page.waitForTimeout(400);
    await page.screenshot({ path: payScreenshot, animations: 'disabled' });
    await testInfo.attach('planned-payment-pay-form-390', { path: payScreenshot, contentType: 'image/png' });
    await payDialog.getByRole('button', { name: 'Создать расход и оплатить' }).click();

    await expect(page.getByRole('button', { name: /Завершённые/ })).toBeVisible();
    expect(state.transactions).toHaveLength(transactions.length + 1);
    expect(state.plannedPayments.find(payment => payment.title === 'Страховка').status).toBe('paid');
    await expect(totalSlide).not.toHaveAttribute('aria-label', balanceBefore);
  });

  test('three navigation tabs fit at 320px and persisted trash restores after reload', async ({ page }, testInfo) => {
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
