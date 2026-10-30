import { test, expect } from '@playwright/test';
import { mockPhase2Api, transactions } from './fixtures.js';

// Удаление и «Отменить» в «Последних операциях»: удалённая строка (или день,
// если она одна) сворачивается сразу, не дожидаясь ленты, и остаётся
// свёрнутой, а при отмене растёт обратно с голубой подсветкой на всю ширину
// карточки. Раскладку и анимации jsdom не считает - проверяем в настоящем
// браузере.

const nav = page => page.getByRole('navigation', { name: 'Основная навигация' });

const data = () => [
  ...transactions,
  { _id: 'tx-5', title: 'Хлеб', amount: 3, type: 'expense', account: 'acc-cash', date: '2026-01-06T00:00:00Z', category: 'Еда' },
];

// Страница с Обзором; ответ ленты (limit=5) после первого же удаления держится,
// пока тест не вызовет release(). Каждый release() открывает текущие ворота и
// ставит новые.
async function open(page) {
  await page.clock.setFixedTime(new Date(2026, 0, 10, 12));
  await mockPhase2Api(page, { transactions: data() });
  await page.goto('/');
  const region = page.getByRole('region', { name: 'Последние операции' });
  await expect(region.getByText('Продукты на неделю')).toBeVisible();
  // Размеры меряются до и после: шрифт, догрузившийся между ними, сдвинул бы их.
  await page.evaluate(() => document.fonts.ready);
  const gate = { open: null, held: 0, wait: null };
  const arm = () => { gate.wait = new Promise(resolve => { gate.open = resolve; }); };
  arm();
  await page.route('**/api/history?*limit=5*', async route => {
    gate.held += 1;
    await gate.wait;
    await route.fallback();
  });
  const release = () => { gate.open(); arm(); };
  return { region, gate, release };
}

async function deleteRow(page, region, name) {
  await region.getByRole('button', { name }).click();
  const dialog = page.getByRole('dialog', { name: 'Редактировать' });
  await dialog.getByRole('button', { name: 'Удалить операцию' }).click();
  await expect(page.getByRole('button', { name: 'Отменить' })).toBeVisible();
}

const height = locator => locator.evaluate(el => el.getBoundingClientRect().height);
// От начала страницы, а не окна: пока блок свёрнут, страница короче и браузер
// может сдвинуть прокрутку, а положение блока в документе от этого не зависит.
const top = locator => locator.evaluate(el => el.getBoundingClientRect().top + window.scrollY);
const settle = page => page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished.catch(() => null))));

test.describe('Deleting and undoing in «Последние операции» (mobile, real browser)', () => {
  test('collapses the row at once and for good, lowers the day sum, and lets the late list unmount it without a jump', async ({ page }) => {
    const { region, gate, release } = await open(page);
    const coffee = region.locator('[data-history-item="tx-3"]');
    const bread = region.locator('[data-history-item="tx-5"]');
    const day = region.locator('[data-history-date="2026-01-06"]');
    await expect(day).toContainText('−€8,00');
    await coffee.evaluate(el => { window.__coffee = el; });
    const naturalHeight = await height(coffee);
    expect(naturalHeight).toBeGreaterThan(40);

    await deleteRow(page, region, /Кофе/);
    await expect.poll(() => gate.held).toBeGreaterThan(0);

    // Лента держится, а строка схлопнулась до нуля (и не исчезла из DOM).
    await expect.poll(() => height(coffee)).toBe(0);
    expect(await coffee.evaluate(el => el === window.__coffee)).toBe(true);
    await expect(day).toContainText('−€3,00');
    // Недоступна: inert, фокус не берёт.
    expect(await coffee.evaluate(el => el.inert)).toBe(true);
    expect(await coffee.evaluate(el => {
      const button = el.querySelector('button');
      button.focus();
      return document.activeElement === button;
    })).toBe(false);
    // Остаётся свёрнутой после конца анимации.
    await settle(page);
    expect(await height(coffee)).toBe(0);
    expect(await coffee.evaluate(el => getComputedStyle(el).overflow)).toBe('hidden');
    // Нет линии-разделителя на краю карточки: оставшаяся строка дня первая.
    expect(await bread.evaluate(el => getComputedStyle(el).borderTopWidth)).toBe('0px');

    // Пришёл настоящий список: строка размонтируется, остальное не двигается.
    const breadTop = await top(bread);
    const regionHeight = await height(region);
    release();
    await expect(region.locator('[data-history-item="tx-3"]')).toHaveCount(0);
    await page.waitForTimeout(300);
    expect(await top(bread)).toBeCloseTo(breadTop, 0);
    expect(await height(region)).toBeCloseTo(regionHeight, 0);
    await expect(day).toContainText('−€3,00');
  });

  test('collapses a whole day when its only row is deleted, and brings it back with the tint on Undo', async ({ page }) => {
    const { region, gate, release } = await open(page);
    const day = region.locator('[data-history-date="2026-01-07"]');
    const next = region.locator('[data-history-date="2026-01-06"]');
    await day.evaluate(el => { window.__day = el; });
    const dayHeight = await height(day);
    const nextTop = await top(next);

    await deleteRow(page, region, /Пополнение/);
    await expect.poll(() => gate.held).toBeGreaterThan(0);

    await expect.poll(() => height(day)).toBe(0);
    expect(await day.evaluate(el => el === window.__day && el.inert)).toBe(true);
    // Нижний день встал на место удалённого: ушли и день, и зазор.
    await settle(page);
    const gap = await day.evaluate(el => parseFloat(getComputedStyle(el.parentElement).rowGap));
    expect(gap).toBeGreaterThan(0);
    expect(await top(next)).toBeCloseTo(nextTop - dayHeight - gap, 0);

    // Отмена до прихода ленты: тот же блок вырастает, строка светится на всю карточку.
    await page.getByRole('button', { name: 'Отменить' }).click();
    await expect.poll(() => day.evaluate(() => document.getAnimations().some(a => a.animationName === 'tx-fresh-tint'))).toBe(true);
    const tint = await day.evaluate(el => {
      const row = el.querySelector('[data-history-item]');
      const glow = row.parentElement.querySelector('.tx-fresh-glow');
      const card = el.lastElementChild;
      return { glow: glow.getBoundingClientRect().width, card: card.getBoundingClientRect().width, row: row.getBoundingClientRect().width };
    });
    expect(tint.glow).toBeCloseTo(tint.card, 0);
    expect(tint.glow).toBeGreaterThan(tint.row);
    await settle(page);
    expect(await height(day)).toBeCloseTo(dayHeight, 0);
    expect(await top(next)).toBeCloseTo(nextTop, 0);
    expect(await day.evaluate(el => el === window.__day || !el.inert)).toBe(true);
    await expect(day).toContainText('Пополнение');

    release();
    await page.waitForTimeout(300);
    await expect(region.getByText('Пополнение')).toHaveCount(1);
    expect(await top(next)).toBeCloseTo(nextTop, 0);
  });

  test('puts the row back from the restore response, with the tint, when the list without it had already arrived', async ({ page }) => {
    const { region, gate, release } = await open(page);
    const day = region.locator('[data-history-date="2026-01-06"]');
    const order = () => day.locator('[data-history-item]').evaluateAll(rows => rows.map(row => row.dataset.historyItem));
    const orderBefore = await order();
    expect(orderBefore).toEqual(['tx-5', 'tx-3']);

    await deleteRow(page, region, /Кофе/);
    await expect.poll(() => gate.held).toBeGreaterThan(0);
    release();
    await expect(region.locator('[data-history-item="tx-3"]')).toHaveCount(0);
    await expect(day).toContainText('−€3,00');
    const held = gate.held;

    await page.getByRole('button', { name: 'Отменить' }).click();

    // Лента после восстановления снова держится, а строка уже на месте.
    await expect.poll(() => gate.held).toBeGreaterThan(held);
    const coffee = region.locator('[data-history-item="tx-3"]');
    await expect(coffee).toBeVisible();
    await expect(day).toContainText('−€8,00');
    expect(await coffee.evaluate(el => el.parentElement.classList.contains('tx-fresh'))).toBe(true);
    expect(await page.evaluate(() => document.getAnimations().some(a => a.animationName === 'tx-fresh-tint'))).toBe(true);
    await settle(page);
    expect(await height(coffee)).toBeGreaterThan(40);
    // Строка встала на своё место в серверном порядке дня (id по убыванию).
    expect(await order()).toEqual(orderBefore);

    await coffee.evaluate(el => { window.__coffee = el; });
    release();
    await page.waitForTimeout(300);
    await expect(region.locator('[data-history-item="tx-3"]')).toHaveCount(1);
    expect(await coffee.evaluate(el => el === window.__coffee)).toBe(true);
  });

  test('hides and shows rows without any height animation for reduced motion, keeping the tint', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const { region, gate, release } = await open(page);
    const coffee = region.locator('[data-history-item="tx-3"]');

    await deleteRow(page, region, /Кофе/);
    await expect.poll(() => gate.held).toBeGreaterThan(0);

    expect(await height(coffee)).toBe(0);
    // Ни одной анимации высоты (Web Animations) - только CSS-анимации.
    expect(await page.evaluate(() => document.getAnimations().filter(a => !a.animationName && a.effect?.getKeyframes?.().some(k => 'height' in k)).length)).toBe(0);

    await page.getByRole('button', { name: 'Отменить' }).click();
    await expect.poll(() => height(coffee)).toBeGreaterThan(40);
    expect(await coffee.evaluate(el => el.parentElement.classList.contains('tx-fresh'))).toBe(true);
    expect(await page.evaluate(() => document.getAnimations().filter(a => !a.animationName && a.effect?.getKeyframes?.().some(k => 'height' in k)).length)).toBe(0);
    expect(await page.evaluate(() => document.getAnimations().some(a => a.animationName === 'tx-fresh-tint'))).toBe(true);
    release();
    await expect(region.locator('[data-history-item="tx-3"]')).toHaveCount(1);
  });
});

test.describe('Deleting in History (mobile, real browser)', () => {
  test('collapses the row in the History list as well', async ({ page }) => {
    await page.clock.setFixedTime(new Date(2026, 0, 10, 12));
    await mockPhase2Api(page, { transactions: data() });
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Последние операции' }).getByText('Продукты на неделю')).toBeVisible();
    await nav(page).getByRole('button', { name: 'История' }).click();
    const timeline = page.locator('[data-history-month="2026-01"]');
    const coffee = timeline.locator('[data-history-item="tx-3"]');
    await expect(coffee).toBeVisible();
    const day = timeline.locator('[data-history-date="2026-01-06"]');
    await expect(day).toContainText('−€8,00');

    let release;
    const gate = new Promise(resolve => { release = resolve; });
    let held = 0;
    await page.route('**/api/history?*all=1*', async route => {
      held += 1;
      await gate;
      await route.fallback();
    });
    await coffee.getByRole('button', { name: /Кофе/ }).click();
    await page.getByRole('dialog', { name: 'Редактировать' }).getByRole('button', { name: 'Удалить операцию' }).click();
    await expect.poll(() => held).toBeGreaterThan(0);

    await expect.poll(() => coffee.evaluate(el => el.getBoundingClientRect().height)).toBe(0);
    await expect(day).toContainText('−€3,00');
    release();
    await expect(timeline.locator('[data-history-item="tx-3"]')).toHaveCount(0);
    await expect(day).toContainText('−€3,00');
  });
});
