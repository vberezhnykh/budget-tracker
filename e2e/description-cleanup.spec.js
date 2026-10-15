import { test, expect } from '@playwright/test';
import { mockApi } from './fixtures.js';

// «Ещё → Старые описания»: разовая чистка описаний, внесенных до появления
// компаний. Сам Claude и сервер не нужны: /api/description-cleanup подменяется
// состоянием в тесте (старые тексты -> пакет -> готовый список -> применено ->
// отменено). Браузер нужен затем, что jsdom не видит раскладку: переполнение
// по ширине, размер нажатия и залипающую кнопку над нижней панелью.

const settings = { monthlyLimit: 7000, features: { descriptionCleanup: true } };

const proposal = (key, kind, count, extra = {}) => ({
  key,
  text: extra.text || key,
  variants: [extra.text || key],
  count,
  total: count * 10,
  categories: ['Еда'],
  kind,
  company: null,
  note: null,
  source: 'claude',
  reason: null,
  ...extra,
});

const PROPOSALS = [
  proposal('lidl nicosia', 'existing', 12, { text: 'LIDL NICOSIA', variants: ['LIDL NICOSIA', 'Лидл'], company: 'Lidl' }),
  proposal('лидл продукты', 'existing', 8, { text: 'лидл продукты', company: 'Lidl', note: 'продукты' }),
  proposal('икеа', 'new', 5, { text: 'ИКЕА', company: 'IKEA' }),
  proposal('продукты', 'note', 30, { text: 'Продукты' }),
  proposal('бензин', 'note', 4, { text: 'Бензин' }),
  proposal('???', 'skip', 2, { text: '???', reason: 'no_result' }),
];

// 61: сервер считает и тексты без ответа.
const LEGACY = PROPOSALS.reduce((total, item) => total + item.count, 0);

// Состояние сервера. batchDone - пакет Claude закончился: следующее чтение вернет готовый список.
function createServer({ proposals = PROPOSALS } = {}) {
  const legacy = proposals.reduce((total, item) => total + item.count, 0);
  const server = {
    legacyCount: legacy,
    run: null,
    // Последняя применённая чистка, которую еще можно отменить; от последнего прогона не зависит.
    undo: null,
    batchDone: false,
    gets: 0,
    starts: 0,
    applied: [],
    reverts: 0,
  };
  server.snapshot = () => {
    if (server.run?.status === 'submitted' && server.batchDone) {
      server.run = { ...server.run, status: 'ready', readyAt: '2026-10-15T09:00:00.000Z', proposals };
    }
    return { legacyCount: server.legacyCount, legacyTexts: proposals.length, run: server.run, undo: server.undo };
  };
  server.start = () => {
    server.starts += 1;
    server.run = { id: 'run-1', status: 'submitted', createdAt: '2026-10-15T10:00:00.000Z', undoUntil: null, undoExpired: false, stats: {} };
    return { run: server.run };
  };
  server.apply = (keys) => {
    server.applied.push(keys);
    const chosen = proposals.filter(item => keys.includes(item.key));
    const updated = chosen.reduce((total, item) => total + item.count, 0);
    server.legacyCount -= updated;
    server.run = {
      ...server.run,
      status: 'applied',
      appliedAt: '2026-10-15T10:30:00.000Z',
      undoUntil: '2026-11-14T12:00:00.000Z',
      proposals: undefined,
      stats: { apply: { updated, companiesCreated: chosen.some(item => item.kind === 'new') ? 1 : 0, skippedChanged: 0 } },
    };
    server.undo = { runId: server.run.id, appliedAt: server.run.appliedAt, undoUntil: server.run.undoUntil, stats: server.run.stats };
    return { updated, companiesCreated: server.run.stats.apply.companiesCreated, skippedChanged: 0 };
  };
  server.revert = () => {
    server.reverts += 1;
    const restored = server.undo.stats.apply.updated;
    server.legacyCount += restored;
    server.undo = null;
    server.run = { ...server.run, status: 'reverted', revertedAt: '2026-10-15T11:00:00.000Z', undoUntil: null };
    return { restored, companiesDeleted: 1, skippedChanged: 0 };
  };
  return server;
}

async function openMore(page, { server = createServer(), pageSettings = settings, hash = '#more' } = {}) {
  await page.clock.setFixedTime(new Date(2026, 9, 15, 12));
  await mockApi(page, { settings: pageSettings });
  await page.route('**/api/description-cleanup**', (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const method = request.method();
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (method === 'GET' && pathname === '/api/description-cleanup') {
      server.gets += 1;
      return json(server.snapshot());
    }
    if (method === 'POST' && pathname.endsWith('/start')) return json(server.start());
    if (method === 'POST' && pathname.endsWith('/apply')) return json(server.apply(request.postDataJSON().keys));
    if (method === 'POST' && pathname.endsWith('/revert')) return json(server.revert());
    return json({ message: 'unexpected' }, 404);
  });
  await page.goto(`/${hash}`);
  return server;
}

const overflowing = (page) => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);

test.describe('Старые описания (mobile, real browser)', () => {
  test('the row appears in «Ещё» only with the feature on, and shows the count', async ({ page }) => {
    await openMore(page);
    const row = page.getByRole('button', { name: /Старые описания/ });
    await expect(row).toBeVisible();
    await expect(row).toContainText('61 операция без компании');
  });

  test('the row is hidden when the feature is off', async ({ page }) => {
    await openMore(page, { pageSettings: { monthlyLimit: 7000 } });
    await expect(page.getByRole('button', { name: /Корзина/ })).toBeVisible();
    await expect(page.getByText('Старые описания')).toHaveCount(0);
  });

  test('the row is hidden when there is nothing to clean', async ({ page }) => {
    const server = createServer();
    server.legacyCount = 0;
    await openMore(page, { server });
    await expect(page.getByRole('button', { name: /Корзина/ })).toBeVisible();
    await expect(page.getByText('Старые описания')).toHaveCount(0);
  });

  test('start, wait, review, apply with a partial selection, undo', async ({ page }) => {
    const server = await openMore(page);
    await page.getByRole('button', { name: /Старые описания/ }).click();
    expect(new URL(page.url()).hash).toBe('#more/cleanup');

    // Начало: объяснение и «Разобрать».
    await expect(page.getByRole('heading', { level: 1, name: 'Старые описания' })).toBeVisible();
    await expect(page.getByText(/Ничего не изменится, пока вы не просмотрите и не подтвердите список/)).toBeVisible();
    await page.getByRole('button', { name: 'Разобрать' }).click();

    // Пакет у Claude.
    await expect(page.getByText(/Claude разбирает описания\. Обычно это занимает до часа/)).toBeVisible();
    expect(server.starts).toBe(1);

    // Пакет закончился - «Проверить» приносит список.
    server.batchDone = true;
    await page.getByRole('button', { name: 'Проверить' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Компании' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Останутся описанием' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Без ответа' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Компания IKEA' }).getByText('новая')).toBeVisible();
    await expect(page.getByText('останется комментарий: продукты')).toBeVisible();
    await expect(page.getByRole('button', { name: `Применить к ${LEGACY - 2} операциям` })).toBeEnabled();

    // Снимаем один текст компании и одну заметку.
    await page.getByRole('checkbox', { name: /^ИКЕА/ }).uncheck();
    await page.getByRole('checkbox', { name: /^Бензин/ }).uncheck();
    const remaining = LEGACY - 2 - 5 - 4;
    await page.getByRole('button', { name: `Применить к ${remaining} операциям` }).click();
    await expect(page.getByRole('group', { name: 'Подтверждение' })).toContainText(`Изменить ${remaining} операций? Отменить можно до 14 ноября.`);
    await page.getByRole('button', { name: 'Изменить' }).click();

    // Ушли ровно выбранные ключи.
    await expect(page.getByText(/Готово: изменено \d+ операци/)).toBeVisible();
    expect(server.applied).toEqual([['lidl nicosia', 'лидл продукты', 'продукты']]);
    await expect(page.getByText(`Готово: изменено ${remaining} операций.`)).toBeVisible();
    await expect(page.getByText('Отменить можно до 14 ноября.')).toBeVisible();
    await expect(page.getByText(/Осталось \d+ операц.* без компании/)).toBeVisible();

    // Новый разбор не прячет отмену: блок «Прошлая чистка» остается под ожиданием пакета.
    server.batchDone = false;
    await page.getByRole('button', { name: 'Разобрать' }).click();
    await expect(page.getByText(/Claude разбирает описания\. Обычно это занимает до часа/)).toBeVisible();
    const previous = page.getByRole('region', { name: 'Прошлая чистка' });
    await expect(previous).toContainText(`Прошлая чистка: изменено ${remaining} операций. Отменить можно до 14 ноября.`);
    await expect(page.getByRole('button', { name: /^Отменить чистку до 14 ноября$/ })).toBeVisible();

    // Отмена из этого блока, после подтверждения.
    await page.getByRole('button', { name: 'Отменить чистку до 14 ноября' }).click();
    await expect(page.getByText(/Операции, которые вы изменили после чистки, останутся как есть/)).toBeVisible();
    await page.getByRole('button', { name: 'Вернуть' }).click();
    await expect(page.getByText(`Возвращено ${remaining} операций.`)).toBeVisible();
    expect(server.reverts).toBe(1);
    await expect(page.getByRole('region', { name: 'Прошлая чистка' })).toHaveCount(0);
  });

  test('applied state shows the undo date in «Ещё» and on the screen', async ({ page }) => {
    const server = createServer();
    server.legacyCount = 0;
    server.run = {
      id: 'run-1',
      status: 'applied',
      createdAt: '2026-10-14T10:00:00.000Z',
      undoUntil: '2026-11-14T12:00:00.000Z',
      undoExpired: false,
      stats: { apply: { updated: 59, companiesCreated: 2, skippedChanged: 0 } },
    };
    server.undo = { runId: 'run-1', appliedAt: '2026-10-14T11:00:00.000Z', undoUntil: '2026-11-14T12:00:00.000Z', stats: server.run.stats };
    await openMore(page, { server });
    const row = page.getByRole('button', { name: /Старые описания/ });
    await expect(row).toContainText('Можно отменить до 14 ноября');
    await row.click();
    await expect(page.getByText('Готово: изменено 59 операций, добавлено 2 компании.')).toBeVisible();
    await expect(page.getByText('Отменить можно до 14 ноября.')).toBeVisible();
  });

  test('a page opened straight on #more/cleanup reads the state and goes back to «Ещё»', async ({ page }) => {
    const server = createServer();
    server.run = { id: 'run-1', status: 'submitted', createdAt: '2026-10-15T10:00:00.000Z', undoUntil: null, undoExpired: false, stats: {} };
    await openMore(page, { server, hash: '#more/cleanup' });
    await expect(page.getByText(/Claude разбирает описания/)).toBeVisible();
    await page.getByRole('button', { name: /Ещё/ }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: 'Ещё' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Старые описания/ })).toContainText('Claude разбирает описания');
  });

  test('a long review fits the phone: no sideways scroll, big tap targets, the bar never covers the last row', async ({ page }) => {
    const proposals = [
      ...Array.from({ length: 10 }, (_, index) => proposal(`сеть ${index}`, index % 3 === 0 ? 'new' : 'existing', 3 + index, {
        text: `Очень длинное название магазина номер ${index} без пробелов-разделителей-вообще`,
        variants: [`Очень длинное название магазина номер ${index} без пробелов-разделителей-вообще`, `вариант ${index}`],
        company: `Сеть с длинным названием ${index}`,
        note: index % 2 ? 'комментарий к покупке с длинным текстом' : null,
      })),
      ...Array.from({ length: 12 }, (_, index) => proposal(`заметка ${index}`, 'note', 2 + index, { text: `Заметка ${index}` })),
      proposal('хвост', 'skip', 1, { text: 'Хвост списка', reason: 'no_result' }),
    ];
    const server = createServer({ proposals });
    server.run = { id: 'run-1', status: 'submitted', createdAt: '2026-10-15T10:00:00.000Z', undoUntil: null, undoExpired: false, stats: {} };
    server.batchDone = true;
    await openMore(page, { server, hash: '#more/cleanup' });

    await expect(page.getByRole('heading', { level: 2, name: 'Компании' })).toBeVisible();
    expect(await overflowing(page)).toBe(false);

    // Каждая строка с флажком не ниже 44px и умещается в ширину экрана.
    const viewport = page.viewportSize();
    for (const box of await page.getByRole('checkbox').all()) {
      const label = await box.locator('xpath=ancestor::label').boundingBox();
      expect(label.height).toBeGreaterThanOrEqual(44);
      expect(label.x).toBeGreaterThanOrEqual(0);
      expect(label.x + label.width).toBeLessThanOrEqual(viewport.width);
    }
    const toggle = await page.getByRole('button', { name: 'Снять все' }).boundingBox();
    expect(toggle.height).toBeGreaterThanOrEqual(44);

    // Кнопка залипает над нижней панелью даже в начале списка.
    const apply = page.getByRole('button', { name: /^Применить к/ });
    const nav = await page.getByRole('navigation', { name: 'Основная навигация' }).boundingBox();
    const early = await apply.boundingBox();
    expect(early.y + early.height).toBeLessThanOrEqual(nav.y);
    expect(early.height).toBeGreaterThanOrEqual(44);
    // Кнопка «+» выступает над панелью и не должна налезать на кнопку применения.
    const plus = await page.getByRole('button', { name: 'Добавить операцию' }).boundingBox();
    expect(early.y + early.height).toBeLessThanOrEqual(plus.y);

    // В конце прокрутки последняя строка видна целиком и не под панелью с кнопкой.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const last = await page.getByText('Хвост списка').boundingBox();
    const bar = await apply.boundingBox();
    expect(last.y).toBeGreaterThanOrEqual(0);
    expect(last.y + last.height).toBeLessThanOrEqual(bar.y);
    expect(bar.y + bar.height).toBeLessThanOrEqual(nav.y);
    expect(await overflowing(page)).toBe(false);
  });
});
