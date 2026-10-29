import { test, expect } from '@playwright/test';
import { accounts, mockApi } from './fixtures.js';

// Графики «Доходы и расходы» и «Деньги в наличии» на Аналитике. Нужен
// настоящий браузер: геометрия на узком телефоне и цифры, которые сервер
// считает из полной истории (фикстуры собирают ответ теми же функциями).
const chartAccounts = [
  ...accounts,
  { _id: 'acc-deposit', name: 'Депозиты', type: 'card', icon: '🏦', isDefault: false, order: 4, excludeFromTotal: true },
];

const chartTransactions = [
  { _id: 'start', title: 'Стартовый баланс', amount: 1000, type: 'initial', account: 'acc-card-1', date: '2025-11-10T12:00:00.000Z', category: 'Другое' },
  ...[
    ['2025-12', 2400, 900],
    ['2026-01', 3200, 1150],
    ['2026-06', 3000, 1300],
    ['2026-07', 3300, 1650],
    ['2026-08', 3500, 1800],
    ['2026-09', 3600, 720],
  ].flatMap(([month, income, expense]) => [
    { _id: `${month}-income`, title: 'Зарплата', amount: income, type: 'income', account: 'acc-card-1', date: `${month}-02T12:00:00.000Z`, category: 'Зарплата' },
    { _id: `${month}-expense`, title: 'Покупки', amount: expense, type: 'expense', account: 'acc-card-1', date: `${month}-03T12:00:00.000Z`, category: 'Еда' },
  ]),
  // Перевод между счетами капитала его не меняет, перевод на вклад - уменьшает.
  { _id: 'to-cash', title: 'Снятие', amount: 200, type: 'transfer', account: 'acc-card-1', toAccount: 'acc-cash', date: '2026-07-10T12:00:00.000Z', category: 'Перевод' },
  { _id: 'to-deposit', title: 'На вклад', amount: 500, type: 'transfer', account: 'acc-card-1', toAccount: 'acc-deposit', date: '2026-08-10T12:00:00.000Z', category: 'Перевод' },
];

async function openAnalytics(page, width = 390) {
  await page.setViewportSize({ width, height: 1000 });
  await page.clock.setFixedTime(new Date(2026, 8, 12, 12));
  await mockApi(page, { accounts: chartAccounts, transactions: chartTransactions });
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Основная навигация' })
    .getByRole('button', { name: /Аналитика/ }).click();
  const flows = page.getByRole('region', { name: 'Доходы и расходы' });
  const balance = page.getByRole('region', { name: 'Деньги в наличии' });
  await expect(flows).toBeVisible();
  await expect(balance).toBeVisible();
  return { flows, balance };
}

test.describe('Доходы, расходы и деньги в наличии (mobile)', () => {
  test('цифры выбранного месяца и выбор месяца нажатием', async ({ page }, testInfo) => {
    const { flows, balance } = await openAnalytics(page);
    const period = page.getByRole('button', { name: /^Период:/ });

    await expect(flows.getByRole('button', { name: /^Сентябрь 2026:/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(flows.getByText('+€3.600', { exact: true })).toBeVisible();
    await expect(flows.getByText('−€720', { exact: true })).toBeVisible();
    await expect(flows.getByText('+€2.880', { exact: true })).toBeVisible();
    await expect(flows.getByText('Сальдо', { exact: true })).toBeVisible();
    await expect(flows.getByRole('button', { name: /^Июль 2026:/ })).toHaveAttribute('aria-label', 'Июль 2026: доход €3.300,00, расход €1.650,00');

    // 1000 стартовых + доходы - расходы - 500 на вклад; снятие наличных
    // капитал не меняет.
    await expect(balance.getByText('€11.980,00')).toBeVisible();
    await expect(balance.getByText(/^сейчас/)).toHaveText('сейчас · +€2.880,00 за месяц');
    await expect(balance.getByRole('button', { name: /^Июль 2026:/ })).toHaveAttribute('aria-label', 'Июль 2026: остаток €7.900,00');
    // Месяцы без операций держат остаток предыдущего.
    await expect(balance.getByRole('button', { name: /^Март 2026:/ })).toHaveAttribute('aria-label', 'Март 2026: остаток €4.550,00');

    await balance.getByRole('button', { name: /^Август 2026:/ }).click();
    await expect(period).toHaveAccessibleName('Период: Август 2026');
    await expect(balance.getByText('€9.100,00')).toBeVisible();
    await expect(balance.getByText(/^на конец/)).toHaveText('на конец августа 2026 · +€1.200,00 за месяц');
    await expect(flows.getByRole('button', { name: /^Август 2026:/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(flows.getByText('+€1.700', { exact: true })).toBeVisible();

    for (const [name, region] of [['flows', flows], ['balance', balance]]) {
      await region.evaluate(element => element.scrollIntoView({ block: 'start', behavior: 'instant' }));
      const screenshot = testInfo.outputPath(`${name}-390.png`);
      await region.screenshot({ path: screenshot, animations: 'disabled' });
      await testInfo.attach(`${name}-390`, { path: screenshot, contentType: 'image/png' });
    }
  });

  test('на телефоне 320px графики не шире экрана', async ({ page }, testInfo) => {
    const { flows, balance } = await openAnalytics(page, 320);
    for (const [name, region] of [['flows', flows], ['balance', balance]]) {
      await region.evaluate(element => element.scrollIntoView({ block: 'start', behavior: 'instant' }));
      const screenshot = testInfo.outputPath(`${name}-320.png`);
      await region.screenshot({ path: screenshot, animations: 'disabled' });
      await testInfo.attach(`${name}-320`, { path: screenshot, contentType: 'image/png' });
      const geometry = await region.evaluate(element => {
        const box = element.getBoundingClientRect();
        return { left: box.left, right: box.right, viewport: window.innerWidth, cardWidth: element.clientWidth, cardScrollWidth: element.scrollWidth };
      });
      expect(geometry.left).toBeGreaterThanOrEqual(0);
      expect(geometry.right).toBeLessThanOrEqual(geometry.viewport);
      expect(geometry.cardScrollWidth).toBeLessThanOrEqual(geometry.cardWidth);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  });

  test('выбор месяца не прячет экран за скелетоном, пока грузятся итоги', async ({ page }) => {
    const { balance } = await openAnalytics(page);
    // Итоги августа отвечают медленно, чтобы ожидание было видно.
    let releaseAugust;
    const augustHeld = new Promise(resolve => { releaseAugust = resolve; });
    await page.route('**/api/stats/dashboard**', async route => {
      if (new URL(route.request().url()).searchParams.get('month') !== '2026-08') return route.fallback();
      await augustHeld;
      return route.fallback();
    });
    const flowsTitle = page.getByRole('heading', { name: 'Доходы и расходы' });
    await expect(flowsTitle).toBeVisible();

    await balance.getByRole('button', { name: /^Август 2026:/ }).click();
    await expect(page.getByRole('button', { name: /^Период:/ })).toHaveAccessibleName('Период: Август 2026');
    await expect(balance.getByText('€9.100,00')).toBeVisible();
    // Прежние итоги остаются на месте, без скелетона и размытия.
    await expect(page.getByLabel('Загрузка итогов…')).toHaveCount(0);
    await expect(flowsTitle).toBeVisible();
    await expect(page.getByTestId('account-summary')).toHaveAttribute('aria-busy', 'false');

    releaseAugust();
    // Итоги месяца приходят отдельным ответом: категории августа - его.
    await expect(page.getByRole('button', { name: /^Еда: €1\.800,00/ })).toBeVisible();
  });

  test('нажатый график стоит на месте, когда блоки над ним меняют высоту', async ({ page }) => {
    // Как в Safari: без встроенного scroll anchoring браузера.
    await page.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        const style = document.createElement('style');
        style.textContent = '* { overflow-anchor: none !important; }';
        document.head.append(style);
      });
    });
    // В августе трат в пяти категориях, в сентябре - в одной: список
    // категорий над графиками меняет высоту.
    const extra = ['Кафе', 'Транспорт', 'Дом', 'Здоровье'].map((category, index) => ({
      _id: `aug-${index}`, title: category, amount: 50 + index, type: 'expense', account: 'acc-card-1', date: '2026-08-04T12:00:00.000Z', category,
    }));
    await page.setViewportSize({ width: 390, height: 800 });
    await page.clock.setFixedTime(new Date(2026, 8, 12, 12));
    await mockApi(page, { accounts: chartAccounts, transactions: [...chartTransactions, ...extra] });
    let releaseAugust;
    const augustHeld = new Promise(resolve => { releaseAugust = resolve; });
    await page.route('**/api/stats/dashboard**', async route => {
      if (new URL(route.request().url()).searchParams.get('month') !== '2026-08') return route.fallback();
      await augustHeld;
      return route.fallback();
    });
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Основная навигация' })
      .getByRole('button', { name: /Аналитика/ }).click();
    const flows = page.getByRole('region', { name: 'Доходы и расходы' });
    await flows.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
    // Наезд экрана вкладки (View Transition) должен закончиться: пока он
    // идёт, нажатие попадает в его снимок, а не в кнопку.
    await page.waitForFunction(() => document.getAnimations().length === 0);
    const august = flows.getByRole('button', { name: /^Август 2026:/ });
    const box = await august.boundingBox();
    const before = box.y;

    // Нажатие мышью в точку: click() локатора сам прокрутил бы страницу.
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.getByRole('button', { name: /^Период:/ })).toHaveAccessibleName('Период: Август 2026');
    releaseAugust();
    await expect(page.getByRole('button', { name: /^Кафе: €/ })).toBeVisible();
    // Допуск 0.5px - тот же, что у holdScrollAnchor: он докручивает страницу
    // лишь от этой разницы, а дробная высота строк выше графика оставляет её.
    await expect.poll(async () => Math.abs((await august.boundingBox()).y - before)).toBeLessThanOrEqual(0.5);
  });

  test('у выбранного на Обзоре счёта - его остаток', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 1000 });
    await page.clock.setFixedTime(new Date(2026, 8, 12, 12));
    await mockApi(page, { accounts: chartAccounts, transactions: chartTransactions });
    await page.goto('/');
    await page.getByRole('button', { name: /^Наличные: / }).click();
    await page.getByRole('navigation', { name: 'Основная навигация' })
      .getByRole('button', { name: /Аналитика/ }).click();

    const balance = page.getByRole('region', { name: 'Остаток счёта' });
    await expect(balance).toBeVisible();
    await expect(balance.getByText('€200,00')).toBeVisible();
    // До первой операции по счёту остатка нет.
    await expect(balance.getByRole('button', { name: /^Июнь 2026:/ })).toHaveAttribute('aria-label', 'Июнь 2026: операций ещё не было');
    await expect(page.getByRole('region', { name: 'Деньги в наличии' })).toHaveCount(0);
  });
});
