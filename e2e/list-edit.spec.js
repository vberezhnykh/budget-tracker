import { test, expect } from '@playwright/test';
import { mockPhase2Api, transactions } from './fixtures.js';

// Правка операции в «Последних операциях»: строка сразу показывает новую сумму
// и голубую подсветку на всю ширину карточки, не дожидаясь ответа ленты, а
// пришедшая лента подменяет её на месте, не сдвигая соседние. Раскладку и
// анимации jsdom не считает - проверяем в настоящем браузере.

const data = () => [
  ...transactions,
  { _id: 'tx-5', title: 'Хлеб', amount: 3, type: 'expense', account: 'acc-cash', date: '2026-01-06T00:00:00Z', category: 'Еда' },
];

// Дожидается конца всех идущих анимаций и переходов.
const settle = page => page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished.catch(() => null))));

// Страница с Обзором и мок PUT; ответ ленты (limit=5) после правки держится,
// пока тест не вызовет release().
async function open(page) {
  await page.clock.setFixedTime(new Date(2026, 0, 10, 12));
  const state = await mockPhase2Api(page, { transactions: data() });
  await page.route('**/api/transactions/*', async (route) => {
    const request = route.request();
    if (request.method() !== 'PUT') return route.fallback();
    const id = new URL(request.url()).pathname.split('/').pop();
    const target = state.transactions.find(item => item._id === id);
    const { id: _id, date, ...fields } = request.postDataJSON();
    Object.assign(target, fields, { __v: (target.__v ?? 0) + 1, ...(date ? { date: date.length === 10 ? `${date}T00:00:00.000Z` : date } : {}) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(target) });
  });
  await page.goto('/');
  const region = page.getByRole('region', { name: 'Последние операции' });
  await expect(region.getByText('Продукты на неделю')).toBeVisible();
  // Размеры меряются до и после: шрифт, догрузившийся между ними, сдвинул бы их,
  // как и проявление ленты (.fade-in с подъемом на несколько пикселей).
  await page.evaluate(() => document.fonts.ready);
  await settle(page);
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

const top = locator => locator.evaluate(el => el.getBoundingClientRect().top + window.scrollY);
const height = locator => locator.evaluate(el => el.getBoundingClientRect().height);

test.describe('Editing in «Последние операции» (mobile, real browser)', () => {
  test('shows the new amount and a full-width tint at once, then lets the late list swap the row in place without moving anything', async ({ page }) => {
    const { region, gate, release } = await open(page);
    const coffee = region.locator('[data-history-item="tx-3"]');
    const bread = region.locator('[data-history-item="tx-5"]');
    const day = region.locator('[data-history-date="2026-01-06"]');
    await expect(day).toContainText('−€8,00');
    await coffee.evaluate(el => { window.__coffee = el; });

    await coffee.getByRole('button', { name: /Кофе/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Редактировать' });
    await dialog.locator('#transaction-amount').fill('45');
    await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => gate.held).toBeGreaterThan(0);

    // Лента держится, а строка уже с новой суммой, сумма дня пересчитана.
    await expect(coffee).toContainText('−€45,00');
    await expect(day).toContainText('−€48,00');
    expect(await coffee.evaluate(el => el === window.__coffee)).toBe(true);

    // Подсветка: слой шире строки и совпадает по ширине с карточкой дня.
    const tint = await coffee.evaluate(el => {
      const glow = el.parentElement.querySelector('.tx-fresh-glow');
      const card = el.closest('[data-history-date]').lastElementChild;
      return {
        isWrapper: el.parentElement.classList.contains('tx-fresh'),
        glow: glow ? glow.getBoundingClientRect().width : 0,
        card: card.getBoundingClientRect().width,
        row: el.getBoundingClientRect().width,
        cardOverflow: getComputedStyle(card).overflow,
        animations: document.getAnimations().map(a => a.animationName).filter(Boolean),
      };
    });
    expect(tint.isWrapper).toBe(true);
    expect(tint.glow).toBeCloseTo(tint.card, 0);
    expect(tint.glow).toBeGreaterThan(tint.row);
    expect(tint.cardOverflow).toBe('hidden');
    expect(tint.animations).toContain('tx-fresh-tint');

    // Сумма не меняет высоту строки: ничего не сдвинулось и после ленты.
    await settle(page);
    const breadTop = await top(bread);
    const coffeeHeight = await height(coffee);
    const regionHeight = await height(region);
    release();
    await page.waitForTimeout(300);
    await expect(coffee).toContainText('−€45,00');
    await expect(region.locator('[data-history-item="tx-3"]')).toHaveCount(1);
    expect(await coffee.evaluate(el => el === window.__coffee)).toBe(true);
    expect(await top(bread)).toBeCloseTo(breadTop, 0);
    expect(await height(coffee)).toBeCloseTo(coffeeHeight, 0);
    expect(await height(region)).toBeCloseTo(regionHeight, 0);
    await expect(day).toContainText('−€48,00');
    // Подсветка не проигрывается заново, когда пришла лента.
    expect(await page.evaluate(() => document.getAnimations().filter(a => a.animationName === 'tx-fresh-tint' && a.currentTime < 100).length)).toBe(0);
  });

  test('changes the row height smoothly when the title wraps onto more lines, and keeps it when the list lands', async ({ page }) => {
    const { region, release } = await open(page);
    const coffee = region.locator('[data-history-item="tx-3"]');
    const day = region.locator('[data-history-date="2026-01-06"]');
    const naturalHeight = await height(coffee);

    await coffee.getByRole('button', { name: /Кофе/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Редактировать' });
    await dialog.getByLabel('Комментарий').fill('Латте с овсяным молоком и двойной порцией карамельного сиропа с корицей');
    // Запись анимаций высоты: они длятся 240 мс, и после проверки их уже не поймать.
    await page.evaluate(() => {
      window.__heightAnimations = [];
      const original = Element.prototype.animate;
      Element.prototype.animate = function animate(keyframes, options) {
        if (Array.isArray(keyframes) && keyframes.some(frame => 'height' in frame)) window.__heightAnimations.push({ keyframes, options });
        return original.call(this, keyframes, options);
      };
    });
    await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(dialog).toHaveCount(0);

    await expect(coffee).toContainText('Латте с овсяным молоком и двойной порцией карамельного сиропа с корицей');
    // Высота менялась анимацией Web Animations на 240 мс, а не скачком.
    const heightAnimations = await page.evaluate(() => window.__heightAnimations);
    expect(heightAnimations).toHaveLength(1);
    expect(heightAnimations[0].options.duration).toBe(240);
    expect(heightAnimations[0].keyframes[0].height).not.toBe(heightAnimations[0].keyframes[1].height);
    expect(heightAnimations[0].keyframes[0].height).toBe(`${naturalHeight}px`);
    await settle(page);
    const grown = await height(coffee);
    expect(grown).toBeGreaterThan(naturalHeight + 5);
    expect(await coffee.evaluate(el => getComputedStyle(el).overflow)).not.toBe('hidden');
    release();
    await page.waitForTimeout(300);
    expect(await height(coffee)).toBeCloseTo(grown, 0);
    await expect(day).toContainText('Латте с овсяным молоком и двойной порцией карамельного сиропа с корицей');
  });

  test('does not animate the height for reduced motion, keeping the tint', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const { region, gate, release } = await open(page);
    const coffee = region.locator('[data-history-item="tx-3"]');

    await coffee.getByRole('button', { name: /Кофе/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Редактировать' });
    await dialog.getByLabel('Комментарий').fill('Латте с овсяным молоком и двойной порцией карамельного сиропа с корицей');
    await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => gate.held).toBeGreaterThan(0);

    await expect(coffee).toContainText('Латте с овсяным молоком и двойной порцией карамельного сиропа с корицей');
    expect(await page.evaluate(() => document.getAnimations().filter(a => !a.animationName && a.effect?.getKeyframes?.().some(k => 'height' in k)).length)).toBe(0);
    expect(await coffee.evaluate(el => el.parentElement.classList.contains('tx-fresh'))).toBe(true);
    expect(await page.evaluate(() => document.getAnimations().some(a => a.animationName === 'tx-fresh-tint'))).toBe(true);
    release();
    await expect(region.locator('[data-history-item="tx-3"]')).toHaveCount(1);
  });
});
