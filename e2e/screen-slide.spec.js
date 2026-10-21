import { test, expect } from '@playwright/test';
import { mockApi } from './fixtures.js';

// Смена экрана выездом сбоку: новый экран едет поверх старого, нижняя панель
// стоит на месте. Это View Transitions API (Chromium его поддерживает так же,
// как Safari 18+), поэтому проверяем в настоящем браузере: jsdom ни переходов,
// ни раскладки не видит. Направление читаем у самого перехода: заглушка вокруг
// document.startViewTransition записывает, с каким data-nav-direction его
// запустили.

const nav = page => page.getByRole('navigation', { name: 'Основная навигация' });
const goTo = (page, name) => nav(page).getByRole('button', { name, exact: true }).click();

const settings = { monthlyLimit: 7000, features: { ask: true } };

// Журнал запусков перехода: направление на <html> в момент вызова.
const recordTransitions = page => page.addInitScript(() => {
  window.__transitions = [];
  const original = Document.prototype.startViewTransition;
  if (!original) return;
  Document.prototype.startViewTransition = function startViewTransition(update) {
    window.__transitions.push(document.documentElement.dataset.navDirection ?? null);
    return original.call(this, update);
  };
});
const transitions = page => page.evaluate(() => window.__transitions);

// Анимация нового снимка запущена: переход дошёл до показа. Ждём её, а не
// фиксированную паузу, чтобы тест не зависел от скорости прогона.
const newScreenAnimation = page => page.waitForFunction(() => document.getAnimations()
  .some(animation => animation.effect?.pseudoElement === '::view-transition-new(root)'));

// Останавливает все анимации на заданной отметке. Дальше экран стоит ровно в
// этом кадре, и его можно мерить и снимать.
const freezeAt = (page, ms) => page.evaluate((time) => {
  document.getAnimations().forEach((animation) => { animation.pause(); animation.currentTime = time; });
}, ms);

// Положение нового снимка по горизонтали (px от своего места) в текущем кадре.
const newScreenOffset = page => page.evaluate(() => {
  const { transform } = getComputedStyle(document.documentElement, '::view-transition-new(root)');
  return new DOMMatrixReadOnly(transform).m41;
});

const settle = page => page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running')
  && !document.documentElement.dataset.navDirection);

test.describe('Screen slide (mobile, real browser)', () => {
  test('a tab to the right slides in from the right edge, a tab to the left from the left edge', async ({ page }) => {
    await recordTransitions(page);
    await mockApi(page);
    await page.goto('/');
    await expect(page.getByTestId('accounts-row')).toBeVisible();
    await settle(page);
    const width = page.viewportSize().width;

    await goTo(page, 'История');
    await newScreenAnimation(page);
    expect(await page.evaluate(() => document.documentElement.dataset.navDirection)).toBe('forward');
    await freezeAt(page, 0);
    expect(await newScreenOffset(page)).toBeCloseTo(width, 0);
    await freezeAt(page, 140);
    const middle = await newScreenOffset(page);
    expect(middle).toBeGreaterThan(0);
    expect(middle).toBeLessThan(width);
    await page.evaluate(() => document.getAnimations().forEach(animation => animation.finish()));
    await settle(page);
    // По окончании атрибут снят, чтобы он не влиял на следующий переход.
    expect(await page.evaluate(() => document.documentElement.dataset.navDirection)).toBeUndefined();

    await goTo(page, 'Обзор');
    await newScreenAnimation(page);
    expect(await page.evaluate(() => document.documentElement.dataset.navDirection)).toBe('back');
    await freezeAt(page, 0);
    expect(await newScreenOffset(page)).toBeCloseTo(-width, 0);
    await page.evaluate(() => document.getAnimations().forEach(animation => animation.finish()));
    await settle(page);

    expect(await transitions(page)).toEqual(['forward', 'back']);
  });

  test('the bottom navigation does not move before, during and after the slide, and stays above the sliding screen', async ({ page }) => {
    await recordTransitions(page);
    await mockApi(page);
    await page.goto('/');
    await expect(page.getByTestId('accounts-row')).toBeVisible();
    await settle(page);
    const before = await nav(page).boundingBox();

    await goTo(page, 'Аналитика');
    await newScreenAnimation(page);
    await freezeAt(page, 100);
    expect(await nav(page).boundingBox()).toEqual(before);

    // Панель живёт в своей группе перехода, и ни одна анимация не двигает её.
    const animated = await page.evaluate(() => document.getAnimations()
      .map(animation => animation.effect?.pseudoElement)
      .filter(Boolean));
    expect(animated).toContain('::view-transition-new(root)');
    expect(animated.filter(name => name.includes('bottom-nav'))).toEqual([]);
    expect(animated.filter(name => name.startsWith('::view-transition-group'))).toEqual([]);

    // Своё имя у панели - причина, по которой она не едет вместе с экраном и
    // лежит над ним: именованные группы рисуются поверх корня.
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('nav[aria-label="Основная навигация"]')).viewTransitionName)).toBe('bottom-nav');

    await page.evaluate(() => document.getAnimations().forEach(animation => animation.finish()));
    await settle(page);
    expect(await nav(page).boundingBox()).toEqual(before);
  });

  test('opening an inner screen slides in from the right, the in-app back button slides the tab in from the left', async ({ page }) => {
    await recordTransitions(page);
    await mockApi(page);
    await page.goto('/');
    await expect(page.getByTestId('accounts-row')).toBeVisible();
    await goTo(page, 'Ещё');
    await expect(page.getByRole('heading', { level: 1, name: 'Ещё' })).toBeVisible();
    await settle(page);

    await page.getByRole('button', { name: /Категории/ }).click();
    await expect(page.getByRole('heading', { name: 'Категории' })).toBeVisible();
    await settle(page);

    await page.getByRole('main').getByRole('button', { name: 'Ещё', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Ещё' })).toBeVisible();
    await settle(page);

    // «Обзор» -> «Ещё», открытие, возврат.
    expect(await transitions(page)).toEqual(['forward', 'forward', 'back']);
  });

  test('from an inner screen a tab tap goes by tab order, and «Ещё» itself counts as back', async ({ page }) => {
    await recordTransitions(page);
    await mockApi(page);
    await page.goto('/#more');
    await expect(page.getByRole('heading', { level: 1, name: 'Ещё' })).toBeVisible();
    await page.getByRole('button', { name: /Категории/ }).click();
    await expect(page.getByRole('heading', { name: 'Категории' })).toBeVisible();
    await settle(page);

    await goTo(page, 'Ещё');
    await expect(page.getByRole('heading', { level: 1, name: 'Ещё' })).toBeVisible();
    await settle(page);
    await page.getByRole('button', { name: /Категории/ }).click();
    await expect(page.getByRole('heading', { name: 'Категории' })).toBeVisible();
    await settle(page);
    await goTo(page, 'История');
    await expect(page.getByTestId('history-scroll')).toBeVisible();
    await settle(page);

    expect(await transitions(page)).toEqual(['forward', 'back', 'forward', 'back']);
  });

  test('the chat under «Аналитика» opens from the right and closes to the left', async ({ page }) => {
    await recordTransitions(page);
    await page.clock.setFixedTime(new Date(2026, 9, 12, 12));
    await mockApi(page, { settings });
    await page.route('**/api/ask', route => route.fulfill({
      status: 200,
      contentType: 'application/x-ndjson; charset=utf-8',
      body: `${JSON.stringify({ type: 'step', label: 'Еда' })}\n`,
    }));
    await page.goto('/#analytics');
    await page.getByRole('button', { name: 'Сколько ушло на кафе?' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Вопросы к данным' })).toBeVisible();
    await settle(page);
    expect(new URL(page.url()).hash).toBe('#analytics/ask');

    await page.getByRole('main').getByRole('button', { name: 'Аналитика', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Вопросы к данным' })).toHaveCount(0);
    await settle(page);

    expect(await transitions(page)).toEqual(['forward', 'back']);
  });

  test('the system Back and an edited hash do not start a transition: Safari has its own swipe animation', async ({ page }) => {
    await recordTransitions(page);
    await mockApi(page);
    await page.goto('/#more');
    await page.getByRole('button', { name: /Категории/ }).click();
    await expect(page.getByRole('heading', { name: 'Категории' })).toBeVisible();
    await settle(page);
    const started = (await transitions(page)).length;

    await page.goBack();
    await expect(page.getByRole('heading', { level: 1, name: 'Ещё' })).toBeVisible();
    await page.evaluate(() => { location.hash = '#history'; });
    await expect(page.getByTestId('history-scroll')).toBeVisible();
    await page.waitForTimeout(300);

    expect((await transitions(page)).length).toBe(started);
    expect(await page.evaluate(() => document.getAnimations().some(animation => animation.effect?.pseudoElement))).toBe(false);
  });

  test('reduced motion switches screens at once, without a view transition', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await recordTransitions(page);
    await mockApi(page);
    await page.goto('/');
    await expect(page.getByTestId('accounts-row')).toBeVisible();

    await goTo(page, 'История');
    await expect(page.getByTestId('history-scroll')).toBeVisible();
    await goTo(page, 'Ещё');
    await page.getByRole('button', { name: /Категории/ }).click();
    await expect(page.getByRole('heading', { name: 'Категории' })).toBeVisible();

    expect(await transitions(page)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.dataset.navDirection)).toBeUndefined();
  });

  test('the incoming screen keeps its restored scroll position and the page background is opaque', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-02T12:00:00Z'));
    const purchase = (id, date) => ({ _id: id, title: id, amount: 10, type: 'expense', account: 'acc-card-1', date, category: 'Еда' });
    await mockApi(page, { transactions: [
      ...Array.from({ length: 40 }, (_, i) => purchase(`oct-${i}`, '2026-10-01')),
      ...Array.from({ length: 40 }, (_, i) => purchase(`sep-${i}`, '2026-09-30')),
    ] });
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Период: Октябрь 2026' })).toBeVisible();
    await goTo(page, 'История');
    const scroll = page.getByTestId('history-scroll');
    await expect(scroll).toBeVisible();
    await settle(page);
    await scroll.evaluate((el) => { el.scrollTop = 300; });
    await expect.poll(() => scroll.evaluate(el => el.scrollTop)).toBeGreaterThan(250);
    const saved = await scroll.evaluate(el => el.scrollTop);

    await goTo(page, 'Обзор');
    await settle(page);
    await goTo(page, 'История');
    await newScreenAnimation(page);
    // Живой новый экран уже стоит на сохранённом месте, пока он ещё выезжает.
    expect(await scroll.evaluate(el => el.scrollTop)).toBeCloseTo(saved, 0);
    await settle(page);
    expect(await scroll.evaluate(el => el.scrollTop)).toBeCloseTo(saved, 0);

    // Фон страницы непрозрачный: под выезжающим снимком не просвечивает старый.
    const background = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
    expect(background).not.toBe('rgba(0, 0, 0, 0)');
  });
});
