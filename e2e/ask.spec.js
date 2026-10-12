import { test, expect } from '@playwright/test';
import { mockApi } from './fixtures.js';

// «Вопросы к данным»: чат на экране «Аналитика». Сам Claude не нужен - ответ
// /api/ask подставляется здесь, как и остальной API. Браузер нужен затем, что
// jsdom не видит раскладку: поле ввода над нижней панелью, таблица ответа в
// ширину телефона и настоящее чтение потока по частям.

const settings = { monthlyLimit: 7000, features: { ask: true } };

const answer = {
  type: 'answer',
  blocks: [
    { type: 'text', text: 'За январь на еду ушло **€125**, из них продукты — **€120**.' },
    { type: 'table', columns: ['Покупка', 'Сумма'], rows: [['Продукты на неделю', '€120'], ['Кофе', '€5']] },
  ],
  basis: 'Еда, январь 2026',
  history: { category: 'Еда', account: null, type: 'expense', month: '2026-01' },
};

const ndjson = (...events) => events.map((event) => `${JSON.stringify(event)}\n`).join('');

const navigation = (page) => page.getByRole('navigation', { name: 'Основная навигация' });

async function openAnalytics(page) {
  await page.clock.setFixedTime(new Date(2026, 9, 12, 12));
  await mockApi(page, { settings });
  await page.goto('/');
  await navigation(page).getByRole('button', { name: 'Аналитика' }).click();
}

test.describe('Questions to your data (mobile, real browser)', () => {
  test('a suggestion opens the chat, the answer table shows, and «Открыть в Истории» lands on the filtered history', async ({ page }) => {
    let askRequest;
    await openAnalytics(page);
    await page.route('**/api/ask', (route) => {
      askRequest = route.request().postDataJSON();
      return route.fulfill({
        status: 200,
        contentType: 'application/x-ndjson; charset=utf-8',
        body: ndjson({ type: 'step', label: 'Еда, январь 2026' }, { type: 'step_done' }, answer),
      });
    });

    await page.getByRole('button', { name: 'Сколько ушло на кафе?' }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Вопросы к данным' })).toBeVisible();
    expect(new URL(page.url()).hash).toBe('#analytics/ask');
    const log = page.getByRole('log', { name: 'Разговор' });
    await expect(log.getByText('Сколько ушло на кафе?')).toBeVisible();
    const reply = log.getByRole('article', { name: 'Ответ' });
    await expect(reply.getByRole('table')).toBeVisible();
    await expect(reply.getByRole('columnheader', { name: 'Покупка' })).toBeVisible();
    await expect(reply.getByRole('cell', { name: 'Продукты на неделю' })).toBeVisible();
    await expect(reply.locator('strong')).toHaveText(['€125', '€120']);
    await expect(reply.getByText('Посчитано: Еда, январь 2026')).toBeVisible();
    expect(askRequest).toEqual({ messages: [{ role: 'user', text: 'Сколько ушло на кафе?' }], today: '2026-10-12' });

    // Раскладка: страница не шире телефона, поле ввода стоит над нижней панелью
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const composer = await page.getByRole('form', { name: 'Вопрос' }).boundingBox();
    const bar = await navigation(page).boundingBox();
    expect(composer.y + composer.height).toBeLessThanOrEqual(bar.y + 1);
    const tableBox = await reply.getByRole('table').boundingBox();
    expect(tableBox.x + tableBox.width).toBeLessThanOrEqual(390);

    await reply.getByRole('button', { name: 'Открыть в Истории' }).click();

    await expect(navigation(page).getByRole('button', { name: 'История' })).toHaveAttribute('aria-current', 'page');
    expect(new URL(page.url()).hash).toBe('#history');
    await expect(page.getByRole('button', { name: 'Еда', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('Продукты на неделю')).toBeVisible();
    await expect(page.getByText('Пополнение')).toHaveCount(0);
  });

  test('without features.ask the Analytics tab has no entry to the chat', async ({ page }) => {
    await page.clock.setFixedTime(new Date(2026, 9, 12, 12));
    await mockApi(page);
    await page.goto('/');
    await navigation(page).getByRole('button', { name: 'Аналитика' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Аналитика' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Спросить о своих расходах' })).toHaveCount(0);
  });

  test('steps arrive while Claude is still working, and «Остановить» takes the question back', async ({ page }) => {
    // fulfill отдаёт тело целиком, поэтому живой поток подставляется в самой
    // странице: step приходит сразу, остальное - когда тест отпустит.
    await page.addInitScript(() => {
      const realFetch = window.fetch;
      const encoder = new TextEncoder();
      window.__askRequests = 0;
      window.fetch = (input, init) => {
        const url = typeof input === 'string' ? input : input.url;
        if (!url.includes('/api/ask')) return realFetch(input, init);
        window.__askRequests += 1;
        const body = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'step', label: 'Еда, январь 2026' })}\n`));
            window.__askFinish = (text) => {
              controller.enqueue(encoder.encode(text));
              controller.close();
            };
            init?.signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')));
          },
        });
        return Promise.resolve(new Response(body, { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } }));
      };
    });
    await openAnalytics(page);

    await page.getByRole('button', { name: 'Что выросло за месяц?' }).click();
    const status = page.getByRole('log', { name: 'Разговор' }).getByRole('status');
    await expect(status.getByText('Еда, январь 2026')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Вопрос' })).toHaveAttribute('readonly', '');
    await expect(page.getByRole('button', { name: 'Новый разговор' })).toBeDisabled();

    await page.getByRole('button', { name: 'Остановить' }).click();
    await expect(status).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Вопрос' })).toHaveValue('Что выросло за месяц?');
    await expect(page.getByRole('button', { name: 'Спросить' })).toBeEnabled();

    // Заново: на этот раз ответ приходит после шага
    await page.getByRole('button', { name: 'Спросить' }).click();
    await expect(status.getByText('Еда, январь 2026')).toBeVisible();
    await page.evaluate((text) => window.__askFinish(text), ndjson({ type: 'step_done' }, answer));
    await expect(page.getByRole('article', { name: 'Ответ' }).getByRole('table')).toBeVisible();
    await expect(status).toHaveCount(0);
    expect(await page.evaluate(() => window.__askRequests)).toBe(2);
  });

  test('an error shows «Повторить», which asks the same question again', async ({ page }) => {
    await openAnalytics(page);
    let calls = 0;
    await page.route('**/api/ask', (route) => {
      calls += 1;
      const body = calls === 1
        ? ndjson({ type: 'error', code: 'ASK_TIMEOUT', message: 'Claude не ответил вовремя. Вопрос сохранен, его можно отправить еще раз.' })
        : ndjson(answer);
      return route.fulfill({ status: 200, contentType: 'application/x-ndjson; charset=utf-8', body });
    });

    await page.getByRole('button', { name: 'Спросить о своих расходах' }).click();
    await page.getByRole('textbox', { name: 'Вопрос' }).fill('На что ушло больше всего в сентябре?');
    await page.getByRole('button', { name: 'Спросить' }).click();

    const alert = page.getByRole('alert');
    await expect(alert).toContainText('Не получилось ответить. Claude не ответил вовремя.');
    await alert.getByRole('button', { name: 'Повторить' }).click();
    await expect(page.getByRole('article', { name: 'Ответ' })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(calls).toBe(2);
  });
});
