import { test, expect } from '@playwright/test';
import { mockApi, accounts, manyAccounts } from './fixtures.js';

// Переход на вкладку нижней навигации.
const goToTab = (page, name) => page
  .getByRole('navigation', { name: 'Основная навигация' })
  .getByRole('button', { name, exact: true })
  .click();

// Настройки живут за строкой «Счета, категории и лимит» на экране «Ещё».
async function openSettings(page) {
  await goToTab(page, 'Ещё');
  await page.getByRole('button', { name: /Счета, категории и лимит/ }).click();
}

// Real-browser smoke suite. Three real bugs shipped this month and every one
// was found by a human on a phone, never by the (jsdom-based) unit suite:
//
//   1. A <style> element rendered as the carousel's first child shifted
//      every container.children[i] index, so swiping jumped to the wrong
//      account.
//   2. The drawer's travel distance was derived from window.innerHeight
//      while its resting position came from a `calc(88vh - ...)` CSS
//      transform. On iOS Safari those differ, so the sheet came to rest in
//      the wrong place.
//   3. Adding a drag grip to the account rows pushed the name/type text into
//      wrapping, because no flex item declared minWidth: 0.
//
// jsdom performs no layout - offsetWidth/offsetLeft/getBoundingClientRect are
// always zero, vh never resolves, and scrolling never happens (scrollLeft is
// permanently clamped to 0). None of the above is visible from jsdom, no
// matter how disciplined the unit tests are. This suite runs the real app
// (via Vite's dev server) in a real Chromium engine under a mobile viewport,
// with every /api/** call stubbed (see ./fixtures.js) so no backend/MongoDB
// is required.

test.describe('Budget Tracker smoke (mobile, real browser)', () => {
  test('slow startup shows a skeleton, but switching accounts keeps the monthly limit bar visible', async ({ page }) => {
    await mockApi(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    let summaryRequests = 0;
    await page.route('**/api/stats/dashboard?*', async route => {
      summaryRequests += 1;
      await gate;
      await route.fallback();
    });
    await page.goto('/');
    const startup = page.getByRole('status', { name: 'Загрузка приложения…' });
    await expect(startup).toBeVisible();
    await expect(startup.locator(':scope > [aria-hidden="true"]')).toHaveCSS('animation-name', 'none');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    release();
    await expect(startup).toHaveCount(0);
    const carousel = page.getByTestId('month-carousel');
    const original = await carousel.elementHandle();
    // Clicking an offscreen account may scroll the page as well as its rail.
    // Compare document positions so that scroll is not mistaken for layout shift.
    const documentTop = locator => locator.evaluate(el => el.getBoundingClientRect().top + window.scrollY);
    // Веб-шрифт может догрузиться уже после замера и поменять высоту строк
    // над каруселью. Это не тот сдвиг, который ловит тест, поэтому меряем
    // после загрузки шрифтов.
    await page.evaluate(() => document.fonts.ready);
    const before = await documentTop(carousel);

    await page.getByRole('button', { name: /^Тинькофф:/ }).click();
    const summary = page.getByRole('status', { name: 'Загрузка итогов…' });
    await expect(summary).toHaveCount(0);
    await expect(carousel).toBeVisible();
    expect(summaryRequests).toBe(1);
    expect(await original.evaluate(el => el === document.querySelector('[data-testid="month-carousel"]'))).toBe(true);
    expect(Math.abs(await documentTop(carousel) - before)).toBeLessThan(2);
  });

  test('renders the app: header and total-capital slide are visible', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');

    await expect(page.getByText('BudgetTracker')).toBeVisible();
    const container = page.getByTestId('balance-carousel');
    await expect(container).toBeVisible();
    await expect(page.getByText('Общий капитал')).toBeVisible();
  });

  test('carousel selects the exact slide scrolled to, not just the last one', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');
    await expect(page.getByText('BudgetTracker')).toBeVisible();

    const container = page.getByTestId('balance-carousel');
    await container.waitFor();
    await expect(container.locator('[data-carousel-slide]')).toHaveCount(accounts.length + 1);

    // Slide order: total capital (0), then one slide per account in fixture
    // order - Тинькофф(1), Сбербанк(2), Наличные(3), the long-named wallet(4).
    // Index 2 is deliberately NOT the last slide: the shipped bug (a stray
    // <style> child shifting every container.children[i] lookup) manifested
    // as every real swipe landing on whatever slide happened to be last,
    // regardless of where the user actually stopped - so a test that only
    // ever checks the last slide could never have caught it.
    const targetIndex = 2;
    const targetAccountName = accounts[targetIndex - 1].name;
    const lastAccountName = accounts[accounts.length - 1].name;

    // A real, native scroll - not a click, which sets the filter directly
    // in the app's click handler and never touches the geometry-dependent
    // code at all. scrollTo lands close to the slide's centre using the
    // slide's real, rendered offsetLeft/offsetWidth, and the browser's own
    // `scroll-snap-type: x mandatory` then pulls the container the rest of
    // the way to the exact snap point - all real layout, impossible in jsdom.
    await container.evaluate((el, idx) => {
      const slides = Array.from(el.querySelectorAll('[data-carousel-slide]'));
      const slide = slides[idx];
      const target = slide.offsetLeft + slide.offsetWidth / 2 - el.clientWidth / 2;
      el.scrollTo({ left: target, behavior: 'instant' });
    }, targetIndex);

    // The app only commits a filter once scroll events stop arriving for
    // ~120ms (see scheduleCarouselSettle in src/App.jsx).
    await page.waitForTimeout(500);

    // Выбранный счёт отмечен текущей точкой-индикатором (aria-current) и на
    // самом слайде (aria-pressed): ровно тот, до которого доехали, а не
    // последний.
    await expect(page.getByRole('button', { name: `Показать ${targetAccountName}` })).toHaveAttribute('aria-current', 'true');
    await expect(page.getByRole('button', { name: `Показать ${lastAccountName}` })).toHaveAttribute('aria-current', 'false');
    await expect(page.getByRole('button', { name: new RegExp(`^${targetAccountName}:`) })).toHaveAttribute('aria-pressed', 'true');
  });

  test('each carousel slide is a hard scroll-snap stop (one slide per swipe)', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');
    await expect(page.getByText('BudgetTracker')).toBeVisible();

    const container = page.getByTestId('balance-carousel');
    await container.waitFor();
    const slideEls = container.locator('[data-carousel-slide]');
    const count = await slideEls.count();
    expect(count).toBe(accounts.length + 1);

    // `scroll-snap-stop: always` is what stops a single fast flick from
    // sailing past several slides before the browser's momentum decays -
    // without it, a hard swipe can skip straight to a slide well past the
    // adjacent one. Headless Chromium's touch/fling synthesis (tried here
    // via CDP Input.dispatchTouchEvent and Input.synthesizeScrollGesture)
    // does not reliably reproduce real hardware momentum, so rather than
    // build a flaky simulated "swipe", this asserts the real, browser-
    // computed style that implements the guarantee - getComputedStyle here
    // reflects actual CSS cascade/parsing from a real rendering engine, not
    // jsdom's limited CSSStyleDeclaration stub.
    for (let i = 0; i < count; i++) {
      const stop = await slideEls.nth(i).evaluate((el) => getComputedStyle(el).scrollSnapStop);
      expect(stop).toBe('always');
    }
  });

  test('account rows stay on one line in the accounts modal', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');
    await expect(page.getByText('BudgetTracker')).toBeVisible();

    await openSettings(page);

    // The name/type divs both set white-space: nowrap, so removing
    // minWidth: 0 can never make this text break onto a visible second
    // line - nowrap forbids that outright. What actually happens without
    // minWidth: 0 is that the flex item refuses to shrink below its
    // content's natural width, so a long name overflows sideways past the
    // row's right edge (verified by reproducing the mutation below: the
    // rendered name element's width jumped from ~120px, matching every
    // other row, to ~360px, well past the 298px-wide row). Every row's
    // name element staying within its own row's right edge is exactly the
    // rendered-geometry signal for "one line, not spilling out" in this
    // component; a hardcoded row height wouldn't catch the actual failure
    // mode here, since the row's height never changes.
    const one = accounts[0].name;
    const row0 = page.locator(`[aria-label="Изменить порядок: ${one}"]`).locator('xpath=../..');
    const rowBox0 = await row0.boundingBox();
    for (const acc of accounts) {
      const grip = page.locator(`[aria-label="Изменить порядок: ${acc.name}"]`);
      const row = grip.locator('xpath=../..');
      const nameEl = grip.locator('xpath=../div/div[1]');
      await expect(nameEl).toBeVisible();
      const rowBox = await row.boundingBox();
      const nameBox = await nameEl.boundingBox();

      // Every row is the same width in this layout - pin that assumption
      // down too, since it's what makes "stays within the row" meaningful.
      expect(Math.abs(rowBox.width - rowBox0.width)).toBeLessThanOrEqual(2);
      expect(nameBox.x + nameBox.width).toBeLessThanOrEqual(rowBox.x + rowBox.width + 2);
    }
  });

  test('carousel dot hit areas tile without overlapping', async ({ page }) => {
    // The dots' hit areas were enlarged to 40x40px (from a visual 6px dot in
    // a 22px footprint) via a negative margin on all sides, to keep the
    // row's own size unchanged. That works vertically (no vertical
    // neighbours to overlap), but horizontally it made adjacent 40px boxes
    // overlap by 18px - and in the overlap, the later sibling in DOM order
    // wins pointer events, so tapping slightly right of a dot's visible
    // centre selected the *next* account instead. This asserts, from real
    // rendered geometry, that adjacent dots' hit boxes never overlap and
    // that every dot's own visible marker sits inside its own hit box.
    await mockApi(page);
    await page.goto('/');
    await expect(page.getByText('BudgetTracker')).toBeVisible();

    const dots = page.locator('button[aria-label^="Показать"]');
    const count = await dots.count();
    expect(count).toBe(accounts.length + 1);

    const boxes = [];
    for (let i = 0; i < count; i++) {
      const box = await dots.nth(i).boundingBox();
      expect(box).not.toBeNull();
      boxes.push(box);

      // The visible marker must fall inside its own button's box - not
      // pulled outside it by the hit-area enlargement.
      const markerBox = await dots.nth(i).locator('span').boundingBox();
      expect(markerBox).not.toBeNull();
      expect(markerBox.x).toBeGreaterThanOrEqual(box.x);
      expect(markerBox.y).toBeGreaterThanOrEqual(box.y);
      expect(markerBox.x + markerBox.width).toBeLessThanOrEqual(box.x + box.width);
      expect(markerBox.y + markerBox.height).toBeLessThanOrEqual(box.y + box.height);
    }

    // Adjacent dots (in DOM order) must not overlap horizontally when on the
    // same row - an overlap means the later sibling's box paints over the
    // earlier sibling's visible dot, so pointer events in the shared region
    // always resolve to the later one, regardless of which dot the user
    // actually meant to tap.
    for (let i = 0; i < boxes.length - 1; i++) {
      const a = boxes[i];
      const b = boxes[i + 1];
      const sameRow = Math.abs(a.y - b.y) < 1;
      if (sameRow) {
        expect(a.x + a.width).toBeLessThanOrEqual(b.x + 0.5);
      }
    }
  });

  test('carousel dots stay on one row when there are many accounts', async ({ page }) => {
    // With eight accounts the row of fixed 40px hit boxes no longer fit a
    // phone's width and wrapped onto a second line (reported from a real
    // device: "точек из-за счетов стало много, перенеслись на другую
    // строку"). The boxes now shrink instead of wrapping. Only real layout
    // can show this: jsdom neither measures the 40px boxes against the
    // viewport nor performs flex line-breaking at all.
    await mockApi(page, { accounts: manyAccounts });
    await page.goto('/');
    await expect(page.getByText('BudgetTracker')).toBeVisible();

    const dots = page.locator('button[aria-label^="Показать"]');
    const count = await dots.count();
    expect(count).toBe(manyAccounts.length + 1);

    const viewport = page.viewportSize();
    // Measure the row in one frame: font loading or a page scroll between
    // separate boundingBox calls must not look like wrapped indicators.
    const boxes = await dots.evaluateAll(buttons => buttons.map(button => {
      const box = button.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    }));

    // One row: every dot shares the first one's vertical position, and the
    // whole row fits inside the viewport.
    for (const box of boxes) {
      expect(Math.abs(box.y - boxes[0].y)).toBeLessThanOrEqual(1);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 0.5);
    }

    // Shrinking must not reintroduce the overlap the sibling test above
    // guards against, and the hit boxes must stay tappable rather than
    // collapsing to the 6px visual dot.
    for (let i = 0; i < boxes.length; i++) {
      expect(boxes[i].width).toBeGreaterThanOrEqual(20);
      expect(boxes[i].height).toBeGreaterThanOrEqual(40);
      if (i < boxes.length - 1) {
        expect(boxes[i].x + boxes[i].width).toBeLessThanOrEqual(boxes[i + 1].x + 0.5);
      }
    }

    // Each dot still selects its own account - shrunken boxes must stay
    // aligned with the slide they stand for.
    await dots.nth(3).click();
    await expect(dots.nth(3)).toHaveAttribute('aria-current', 'true');
    await expect(page.getByRole('button', { name: `Показать ${manyAccounts[2].name}` })).toHaveAttribute('aria-current', 'true');
  });

  test('quick-action buttons (income/expense/transfer) sit on one row, fit the viewport, and are not text-clipped', async ({ page }) => {
    // These three buttons used to be a full-width transfer button stacked
    // above an income/expense row. They were merged onto a single row of
    // three equal-width buttons to reclaim vertical space. jsdom can't see
    // whether the shorter "⇄ Перевод" label actually fits at 1/3 width on a
    // real 390px phone, whether the row overflows the page, or whether all
    // three end up the same height - only real layout can, hence this test.
    await mockApi(page);
    await page.goto('/');
    await expect(page.getByText('BudgetTracker')).toBeVisible();

    const income = page.getByRole('button', { name: 'Добавить доход' });
    const expense = page.getByRole('button', { name: 'Добавить расход' });
    const transfer = page.getByRole('button', { name: 'Добавить перевод' });

    const buttons = [income, expense, transfer];
    const boxes = [];
    for (const button of buttons) {
      await expect(button).toBeVisible();
      const box = await button.boundingBox();
      expect(box).not.toBeNull();
      boxes.push(box);
    }

    // All three sit on the same row - their vertical centres line up, within
    // a couple of pixels (allowing for sub-pixel rounding differences
    // between the filled and the tinted quick-action tones).
    const centres = boxes.map((box) => box.y + box.height / 2);
    for (const centre of centres) {
      expect(Math.abs(centre - centres[0])).toBeLessThanOrEqual(2);
    }

    // None of the three overflows the page horizontally.
    const viewport = page.viewportSize();
    for (const box of boxes) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    }

    // None of the three labels is clipped - scrollWidth (the content's real,
    // unclipped width) must not exceed clientWidth (the box actually
    // rendered). This is exactly the kind of narrow-viewport label-overflow
    // defect jsdom cannot see, since it never performs real text layout.
    for (const button of buttons) {
      const { scrollWidth, clientWidth } = await button.evaluate((el) => ({
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    }
  });

  test('the period trigger replaces the header month row and its sheet is reachable and tappable', async ({ page }) => {
    // The month arrow row and the Месяц/Год/Всё время toggle were replaced
    // by a single period control that opens a bottom sheet (CoinKeeper's
    // pattern); it now lives in the summary card's label («Расход за
    // сентябрь ⌄») instead of a row of its own. The header must no longer
    // carry any month control, and the
    // sheet's month cells must be finger-sized and fit the viewport - none
    // of which jsdom can measure, since it lays nothing out.
    await mockApi(page);
    await page.goto('/');
    await expect(page.getByText('BudgetTracker')).toBeVisible();

    // No month arrows anywhere any more.
    await expect(page.getByRole('button', { name: '←', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '→', exact: true })).toHaveCount(0);

    const chip = page.getByRole('button', { name: /^Период:/ });
    await expect(chip).toBeVisible();

    // The trigger lives in <main>, not the header card - the header is now
    // purely balance/identity chrome.
    const ancestry = await chip.evaluate((el) => ({
      insideHeader: !!el.closest('header'),
      insideMain: !!el.closest('main'),
    }));
    expect(ancestry.insideHeader).toBe(false);
    expect(ancestry.insideMain).toBe(true);

    // Текстовая кнопка в подписи: сам текст мелкий, но площадь нажатия
    // добирается padding'ом до размера под палец.
    const chipBox = await chip.boundingBox();
    expect(chipBox.height).toBeGreaterThanOrEqual(36);

    await chip.click();
    const sheet = page.getByRole('dialog', { name: 'Выбор периода' });
    await expect(sheet).toBeVisible();

    // Every month cell is finger-sized and inside the viewport.
    const viewport = page.viewportSize();
    const monthCells = sheet.getByTestId('period-month');
    const count = await monthCells.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const box = await monthCells.nth(i).boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(40);
      expect(box.x).toBeGreaterThanOrEqual(-0.5);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 0.5);
    }

    // Picking a month closes the sheet and relabels the chip.
    await sheet.getByRole('button', { name: 'Декабрь' }).click();
    await expect(sheet).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Период: Декабрь 2025' })).toBeVisible();
  });

  test('an open sheet freezes the page under it', async ({ page }) => {
    // С открытым листом страница под ним продолжала двигаться: подложка
    // листа сама прокручиваема, и когда её содержимое короче экрана (лист
    // не выше 92vh), браузер передаёт жест дальше - главному экрану. Замок
    // был только у формы операции; у настроек и выбора периода его не было
    // вовсе, а пальцем пользователь чаще всего попадает именно в просвет
    // над листом.
    //
    // Сам симптом здесь не воспроизводится: он проявляется на касании в
    // мобильном Safari, а Chromium в headless ни через page.mouse, ни
    // через CDP Input.synthesizeScrollGesture страницу под подложкой не
    // двигает (та же причина, по которой соседний тест про scroll-snap
    // проверяет вычисленный стиль, а не свайп). Поэтому проверяется сам
    // механизм: страница на время жизни листа переводится в
    // position: fixed со сдвигом на текущую прокрутку - именно это её и
    // держит - и возвращается в исходное состояние при закрытии.
    await mockApi(page, { accounts: manyAccounts });
    await page.goto('/');
    await expect(page.getByText('BudgetTracker')).toBeVisible();

    const bodyState = () => page.evaluate(() => ({
      position: document.body.style.position,
      overflow: document.body.style.overflow,
      top: document.body.style.top,
    }));

    // До открытия страница обычная.
    const free = await bodyState();
    expect(free.position).toBe('');
    expect(free.overflow).not.toBe('hidden');

    // Настройки открываются с экрана «Ещё», где уже нет ни выбора периода, ни
    // быстрых действий Обзора, - поэтому они последние в списке.
    for (const open of [
      () => page.getByRole('button', { name: /^Период:/ }).click(),
      () => page.getByRole('button', { name: 'Добавить расход' }).click(),
      () => openSettings(page),
    ]) {
      await open();
      await expect(page.getByRole('dialog').first()).toBeVisible();

      const locked = await bodyState();
      expect(locked.position).toBe('fixed');
      expect(locked.overflow).toBe('hidden');
      // Сдвиг равен минус текущей прокрутке. В тесте она нулевая (клик по
      // элементу шапки сам подтягивает страницу наверх), а CSSOM
      // нормализует "-0px" в "0px" - отсюда допуск на знак.
      expect(locked.top).toMatch(/^-?\d+px$/);

      // Подложка не отдаёт жест странице, даже когда сама прокрутиться не
      // может: лист ниже экрана, прокручивать ей нечего.
      const contain = await page.getByRole('dialog').first().evaluate(
        (el) => getComputedStyle(el.parentElement).overscrollBehaviorY
      );
      expect(contain).toBe('contain');

      await page.mouse.click(200, 40);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await page.waitForTimeout(200);

      // Закрылся - и не оставил страницу приколоченной.
      const released = await bodyState();
      expect(released.position).toBe('');
      expect(released.top).toBe('');
      expect(released.overflow).not.toBe('hidden');
    }
  });

  test('экран Истории не листается целиком: список едет в своём контейнере над нижней панелью', async ({ page }) => {
    // Раньше история была шторкой, которая запирала страницу под собой (замок
    // body). Теперь это экран: он занимает высоту окна над нижней панелью, а
    // листается только список внутри него. Это геометрия, jsdom её не видит.
    const transactions = Array.from({ length: 60 }, (_, index) => ({
      _id: `h-${String(index).padStart(3, '0')}`, title: `Покупка ${index}`, amount: 10,
      type: 'expense', account: 'acc-card-1', date: '2026-01-05T00:00:00Z', category: 'Еда',
    }));
    await page.clock.setFixedTime(new Date('2026-01-15T12:00:00Z'));
    await mockApi(page, { transactions });
    await page.goto('/');
    await expect(page.getByText('BudgetTracker')).toBeVisible();
    await goToTab(page, 'История');

    const scroll = page.getByTestId('history-scroll');
    await expect(scroll.getByRole('button', { name: /^Покупка \d+,/ }).first()).toBeVisible();
    const nav = page.getByRole('navigation', { name: 'Основная навигация' });

    // Страница под экраном стоит: документ не выше окна.
    const page_ = await page.evaluate(() => ({
      scrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
      bodyPosition: document.body.style.position,
    }));
    expect(page_.scrollHeight).toBeLessThanOrEqual(page_.innerHeight);
    // Замка шторки больше нет: body никто не приколачивает.
    expect(page_.bodyPosition).toBe('');

    // Список прокручивается сам и заканчивается над нижней панелью.
    expect(await scroll.evaluate((el) => getComputedStyle(el).overflowY)).toBe('auto');
    expect(await scroll.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    const scrollBox = await scroll.boundingBox();
    const navBox = await nav.boundingBox();
    expect(scrollBox.y + scrollBox.height).toBeLessThanOrEqual(navBox.y + 0.5);

    // Шапка со строкой поиска остаётся на месте, пока список едет.
    const search = page.getByPlaceholder(/Поиск/);
    const searchTop = (await search.boundingBox()).y;
    await scroll.evaluate((el) => { el.scrollTop = 300; });
    expect(await scroll.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    expect((await search.boundingBox()).y).toBeCloseTo(searchTop, 0);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test('карточка сводки - лента месяцев: листается и держит выбранный месяц', async ({ page }) => {
    // Месяцы листаются той же каруселью со снапом, что и счета в шапке
    // (utils/useSnapCarousel.js). Проверять это можно только в реальном
    // движке: в jsdom нет ни раскладки, ни настоящей прокрутки, а весь смысл
    // здесь именно в ней - карточки едут за пальцем, а не «жест меняет
    // данные».
    await mockApi(page, { accounts: manyAccounts });
    await page.goto('/');
    await expect(page.getByText('BudgetTracker')).toBeVisible();

    const carousel = page.getByTestId('month-carousel');
    const slides = carousel.locator('[data-carousel-slide]');
    await expect(slides.first()).toBeVisible();
    const count = await slides.count();
    expect(count).toBeGreaterThan(1);

    const chip = page.getByRole('button', { name: /^Период:/ });
    // Название месяца берём из имени кнопки («Период: Сентябрь 2026»), а не
    // из её текста: текст теперь фраза («Расход за сентябрь»).
    const monthWord = async () => (await chip.getAttribute('aria-label')).replace('Период: ', '').split(' ')[0];
    const startMonth = await monthWord();

    // Лента открывается на выбранном месяце, а не на первом слайде: он
    // самый старый, и увидеть при запуске ноябрь позапрошлого года вместо
    // текущего месяца было бы неожиданно.
    const startScroll = await carousel.evaluate((el) => el.scrollLeft);
    expect(startScroll).toBeGreaterThan(0);

    // Каждый слайд - жёсткая остановка: один свайп = один месяц, а не
    // пролёт через полгода по инерции.
    for (let i = 0; i < count; i++) {
      const stop = await slides.nth(i).evaluate((el) => getComputedStyle(el).scrollSnapStop);
      expect(stop).toBe('always');
    }

    // Прокрутка на слайд назад - и выбранный месяц меняется сам, без нажатий.
    await carousel.evaluate((el) => {
      const slide = el.querySelector('[data-carousel-slide]');
      el.scrollBy({ left: -(slide.offsetWidth + 12), behavior: 'instant' });
    });
    await page.waitForTimeout(500);
    const afterMonth = await monthWord();
    expect(afterMonth).not.toBe(startMonth);

    // Месяц называет подпись каждой карточки, но кнопка выбора периода в
    // ленте одна - у активной. Соседи показывают свой месяц обычным
    // текстом, иначе на карточке, которая ещё не выбрана, было бы две
    // кнопки, спорящие с жестом выбора.
    await expect(carousel.getByRole('button', { name: /^Период:/ })).toHaveCount(1);
    await expect(slides.filter({ hasText: /Расход за / })).toHaveCount(count);
    await expect(slides.filter({ has: chip })).toHaveCount(1);

    // Обратный путь: месяц, выбранный в чипе, подтягивает ленту к себе.
    await chip.click();
    const sheet = page.getByRole('dialog', { name: 'Выбор периода' });
    await sheet.getByRole('button', { name: startMonth }).click();
    await page.waitForTimeout(600);
    await expect(chip).toHaveText(new RegExp(startMonth, 'i'));
    expect(await carousel.evaluate((el) => el.scrollLeft)).toBe(startScroll);
  });

  test('знак суммы не отрывается от числа в карточке сводки', async ({ page }) => {
    // «+» висел на строке один, а сумма уезжала под него: строка ломалась
    // ровно по пробелу между знаком и числом. Под сумму в этих боксах
    // остаётся ~93px, а прежним кеглем «+€8.649,42» занимал 89 - то есть
    // помещалось это на одном телефоне и не помещалось на другом, где шрифт
    // чуть шире. Поэтому сумма здесь заведомо длиннее той, что была на
    // скриншоте: «+€28.649,42» прежним кеглем требовал 99px и не влезал
    // никак - на нём тест и падает, если убрать перенос и уменьшенный кегль.
    // jsdom такого не покажет: он не переносит строки, потому что их не
    // измеряет.
    const now = new Date();
    const inThisMonth = (day) => new Date(Date.UTC(now.getFullYear(), now.getMonth(), day)).toISOString();
    await mockApi(page, {
      accounts: manyAccounts,
      transactions: [
        { _id: 'w1', title: 'Зарплата', amount: 28649.42, type: 'income', account: 'acc-card-1', date: inThisMonth(1), category: 'Зарплата' },
        { _id: 'w2', title: 'Аренда', amount: 5760.09, type: 'expense', account: 'acc-card-1', date: inThisMonth(2), category: 'Еда' },
      ],
    });
    await page.goto('/');
    await expect(page.getByText('BudgetTracker')).toBeVisible();

    // Выбранная карточка - единственная, где расход и доход остались
    // кнопками-фильтрами (у соседних месяцев это просто текст).
    const activeCard = page.locator('[data-carousel-slide]').filter({ has: page.locator('button[aria-label^="Доход:"]') });
    await expect(activeCard).toHaveCount(1);

    for (const label of ['Доход', 'Сальдо']) {
      const value = activeCard.locator(`div:text-is("${label}") + div`);
      await expect(value).toBeVisible();

      const box = await value.evaluate((el) => {
        const cs = getComputedStyle(el);
        return {
          text: el.textContent.trim(),
          height: el.getBoundingClientRect().height,
          lineHeight: parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2,
          overflows: el.scrollWidth > el.clientWidth,
        };
      });

      // Знак на месте, строка одна, и в бокс она влезает целиком.
      expect(box.text.startsWith('+€')).toBe(true);
      expect(box.height).toBeLessThan(box.lineHeight * 1.6);
      expect(box.overflows).toBe(false);
    }
  });

  test('bottom navigation is pinned to the bottom edge, finger-sized, and never covers the end of a screen', async ({ page }) => {
    // Панель fixed: из потока она выпала и может закрыть хвост страницы, а
    // jsdom не знает ни про fixed, ни про раскладку. Проверяется по
    // реальной геометрии на каждом экране, у которого страница листается.
    await mockApi(page);
    await page.goto('/');
    await expect(page.getByText('BudgetTracker')).toBeVisible();

    const nav = page.getByRole('navigation', { name: 'Основная навигация' });
    await expect(nav).toBeVisible();

    const viewport = page.viewportSize();
    const navBox = await nav.boundingBox();
    // Прижата к нижнему краю и на всю ширину, высота - 64px плюс (возможный)
    // отступ под системную полосу.
    expect(navBox.x).toBeCloseTo(0, 0);
    expect(navBox.width).toBeCloseTo(viewport.width, 0);
    expect(navBox.y + navBox.height).toBeCloseTo(viewport.height, 0);
    expect(navBox.height).toBeGreaterThanOrEqual(64);

    // Все ячейки под палец.
    for (const name of ['Обзор', 'История', 'Аналитика', 'Ещё']) {
      const box = await nav.getByRole('button', { name, exact: true }).boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(40);
      expect(box.width).toBeGreaterThanOrEqual(40);
    }

    // Кнопка добавления 56x56 и приподнята над верхней гранью панели.
    const add = await nav.getByRole('button', { name: 'Добавить операцию' }).boundingBox();
    expect(add.width).toBeCloseTo(56, 0);
    expect(add.height).toBeCloseTo(56, 0);
    expect(add.y).toBeLessThan(navBox.y);

    // Текущая вкладка отмечена.
    await expect(nav.getByRole('button', { name: 'Обзор', exact: true })).toHaveAttribute('aria-current', 'page');

    // Пролистанная до конца страница заканчивается выше панели - на Обзоре и
    // на «Ещё».
    const lastContentBottom = (selector) => page.evaluate((sel) => {
      window.scrollTo(0, document.body.scrollHeight);
      const nodes = document.querySelectorAll(sel);
      return nodes[nodes.length - 1].getBoundingClientRect().bottom;
    }, selector);
    expect(await lastContentBottom('main .glass-panel')).toBeLessThanOrEqual((await nav.boundingBox()).y + 0.5);

    await nav.getByRole('button', { name: 'Ещё', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Ещё' })).toBeVisible();
    expect(await lastContentBottom('main button')).toBeLessThanOrEqual((await nav.boundingBox()).y + 0.5);

    // Переключение вкладок меняет экран, а период остаётся.
    await nav.getByRole('button', { name: 'Аналитика', exact: true }).click();
    await expect(page.getByRole('button', { name: /^Период:/ })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Аналитика', exact: true })).toHaveAttribute('aria-current', 'page');
    // Новая вкладка открывается с начала страницы.
    expect(await page.evaluate(() => window.scrollY)).toBe(0);

    // The fixtures only carry transactions from an earlier month, so the
    // current month is genuinely empty - the tab must say so rather than
    // render nothing at all.
    await expect(page.getByText('За выбранный период трат нет')).toBeVisible();

    // Widening the range from the chip fills the same tab with category bars.
    await page.getByRole('button', { name: /^Период:/ }).click();
    await page.getByRole('dialog', { name: 'Выбор периода' }).getByRole('button', { name: 'Всё время' }).click();
    await expect(page.getByText('Расходы по категориям')).toBeVisible();

    await nav.getByRole('button', { name: 'Обзор', exact: true }).click();
    await expect(page.getByText('Расходы по категориям')).toHaveCount(0);
  });

  test('switching tabs writes the hash without piling up history, and manual hash changes and back/forward move between screens', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');
    await expect(page.getByText('BudgetTracker')).toBeVisible();
    const nav = page.getByRole('navigation', { name: 'Основная навигация' });
    const current = (name) => expect(nav.getByRole('button', { name, exact: true })).toHaveAttribute('aria-current', 'page');
    const entries = () => page.evaluate(() => history.length);
    const startEntries = await entries();

    await nav.getByRole('button', { name: 'История', exact: true }).click();
    await expect(page).toHaveURL(/#history$/);
    await nav.getByRole('button', { name: 'Аналитика', exact: true }).click();
    await expect(page).toHaveURL(/#analytics$/);
    await nav.getByRole('button', { name: 'Ещё', exact: true }).click();
    await expect(page).toHaveURL(/#more$/);
    await nav.getByRole('button', { name: 'Обзор', exact: true }).click();
    await expect(page).not.toHaveURL(/#/);
    // Вкладки не копятся в истории браузера.
    expect(await entries()).toBe(startEntries);

    // Хэш, выставленный снаружи (ссылка, адресная строка), переключает экран...
    await page.evaluate(() => { location.hash = '#analytics'; });
    await current('Аналитика');
    await expect(page.getByText(/Расходы по категориям|За выбранный период трат нет/)).toBeVisible();
    await page.evaluate(() => { location.hash = '#more'; });
    await current('Ещё');
    await expect(page.getByRole('heading', { level: 1, name: 'Ещё' })).toBeVisible();

    // ...а жесты «назад» и «вперёд» ходят по этим записям, и экран следует.
    await page.goBack();
    await current('Аналитика');
    await page.goBack();
    await current('Обзор');
    await expect(page.getByTestId('balance-carousel')).toBeVisible();
    await page.goForward();
    await current('Аналитика');

    // Обновление страницы остаётся на той же вкладке.
    await page.reload();
    await current('Аналитика');
  });
});
