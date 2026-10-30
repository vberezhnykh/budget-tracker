import { test, expect } from '@playwright/test';
import { mockApi, transactions, accounts, categories } from './fixtures.js';

// «Последние операции» сразу после записи: новая строка видна, как только
// закрылась форма, не дожидаясь ответа ленты, появляется плавно, с голубой
// подсветкой на всю ширину карточки дня, а настоящий список подменяет её на
// месте. Раскладку и анимации jsdom не считает - проверяем в настоящем
// браузере.

const nav = page => page.getByRole('navigation', { name: 'Основная навигация' });

test.describe('Recent operations right after a write (mobile, real browser)', () => {
  test('shows the new row at once with a full-width tint, then swaps it for the server row in place', async ({ page }) => {
    await page.clock.setFixedTime(new Date(2026, 0, 10, 12));
    const data = [...transactions];
    await mockApi(page, { transactions: data });
    await page.route('**/api/transactions', (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      const body = route.request().postDataJSON();
      const saved = { _id: 'tx-new', ...body, title: body.title || 'Обед в кафе' };
      data.push(saved);
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(saved) });
    });
    await page.goto('/');
    const region = page.getByRole('region', { name: 'Последние операции' });
    await expect(region.getByText('Продукты на неделю')).toBeVisible();

    await nav(page).getByRole('button', { name: 'Добавить операцию' }).click();
    const dialog = page.getByRole('dialog', { name: 'Новый расход' });
    await dialog.locator('#transaction-amount').fill('45');
    const choose = async name => {
      const button = dialog.getByRole('button', { name, exact: true });
      await expect(async () => {
        if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click();
        await expect(button).toHaveAttribute('aria-pressed', 'true', { timeout: 500 });
      }).toPass();
    };
    await choose(categories[0].name);
    await choose(accounts[0].name);
    await dialog.getByLabel('Комментарий').fill('Обед в кафе');

    // Ответ ленты после записи держим: строка должна быть и без него.
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    let held = 0;
    await page.route('**/api/history?*limit=5*', async route => {
      held += 1;
      await gate;
      await route.fallback();
    });
    await dialog.getByRole('button', { name: 'Сохранить расход' }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => held).toBeGreaterThan(0);

    const row = region.locator('[data-history-item="tx-new"]');
    await expect(row).toBeVisible();
    await expect(row).toContainText('Обед в кафе');
    await row.evaluate(el => { window.__inserted = el; });

    // Строка первая в своём дне, день над прежними.
    const day = region.locator('[data-history-date="2026-01-10"]');
    await expect(day).toBeVisible();
    await expect(day.locator('[data-history-item]').first()).toHaveAttribute('data-history-item', 'tx-new');
    await expect(day).toContainText('−€45,00');

    // Подсветка: обёртка строки, чей светящийся слой шире строки на отступы
    // карточки и совпадает с шириной самой карточки.
    const tint = await row.evaluate(el => {
      const wrapper = el.parentElement;
      const card = el.closest('[data-history-date]').lastElementChild;
      const glow = wrapper.querySelector('.tx-fresh-glow');
      return {
        isWrapper: wrapper.classList.contains('tx-fresh'),
        tintWidth: glow.getBoundingClientRect().width,
        cardWidth: card.getBoundingClientRect().width,
        rowWidth: el.getBoundingClientRect().width,
        cardOverflow: getComputedStyle(card).overflow,
        animations: document.getAnimations().map(a => a.animationName).filter(Boolean),
      };
    });
    expect(tint.isWrapper).toBe(true);
    expect(tint.tintWidth).toBeCloseTo(tint.cardWidth, 0);
    expect(tint.tintWidth).toBeGreaterThan(tint.rowWidth);
    expect(tint.cardOverflow).toBe('hidden');
    expect(tint.animations).toContain('tx-fresh-tint');

    // Рост закончился на естественной высоте.
    await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished.catch(() => null))));
    expect((await row.boundingBox()).height).toBeGreaterThan(40);
    const naturalHeight = (await row.boundingBox()).height;

    // Пришёл настоящий список: та же строка на месте, ничего не сдвинулось и не
    // проигрывается заново.
    const before = await region.boundingBox();
    release();
    await expect.poll(() => page.evaluate(() => document.querySelectorAll('[data-history-item="tx-new"]').length)).toBe(1);
    await page.waitForTimeout(300);
    expect(await row.evaluate(el => el === window.__inserted)).toBe(true);
    expect((await row.boundingBox()).height).toBeCloseTo(naturalHeight, 0);
    expect(await page.evaluate(() => document.getAnimations().filter(a => a.animationName === 'tx-fresh-tint' && a.currentTime < 100).length)).toBe(0);
    expect((await region.boundingBox()).height).toBeCloseTo(before.height, 0);
    await expect(region.getByText('Обед в кафе')).toHaveCount(1);
  });
});
