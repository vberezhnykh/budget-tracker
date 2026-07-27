import { test, expect } from '@playwright/test';
import { mockApi, accounts } from './fixtures.js';

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

    const chip = page.getByText(/Счет:/);
    await expect(chip).toContainText(targetAccountName);
    await expect(chip).not.toContainText(lastAccountName);
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

  test('drawer closes flush, leaving only the real peek strip visible', async ({ page }) => {
    // Simulate the iOS Safari large-vs-small viewport mismatch that caused
    // this bug: window.innerHeight here is deliberately set far from the
    // viewport's actual height, while CSS `vh` units still resolve against
    // the real viewport (a real browser has no way to make JS innerHeight
    // and CSS vh disagree otherwise - that discrepancy is iOS-specific
    // toolbar behavior Chromium doesn't reproduce on its own). Correct code
    // derives travel from the sheet's own rendered offsetHeight and must be
    // unaffected by this override; buggy code derived travel from
    // window.innerHeight * 0.88 and would rest in the wrong place.
    await page.addInitScript(() => {
      Object.defineProperty(window, 'innerHeight', { configurable: true, get: () => 400 });
    });
    await mockApi(page);
    await page.goto('/');
    await expect(page.getByText('BudgetTracker')).toBeVisible();

    const handle = page.getByRole('button', { name: /список операций/ });
    await expect(handle).toBeVisible();

    const drag = async (totalDeltaY, steps = 8, stepDelayMs = 15) => {
      const box = await handle.boundingBox();
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      for (let i = 1; i <= steps; i++) {
        await page.mouse.move(x, y + (totalDeltaY * i) / steps);
        await page.waitForTimeout(stepDelayMs);
      }
      await page.mouse.up();
    };

    // Drag open (finger moves up), then drag closed (finger moves down) -
    // exercising the same imperative drag path as a real touch drag, since
    // mouse input generates the same pointerdown/move/up events this
    // handle listens for.
    await drag(-400);
    await expect(handle).toHaveAttribute('aria-expanded', 'true');
    // Let the open snap-transition finish before dragging closed.
    await page.waitForTimeout(400);

    await drag(500);
    await expect(handle).toHaveAttribute('aria-expanded', 'false');
    await page.waitForTimeout(400);

    // A drag that *commits* (crosses the open/closed threshold, as both
    // drags above did) flips the `expanded` prop, which makes React
    // re-render and reapply the component's own declarative
    // `translateY(calc(88vh - ...))` string over whatever getTravel()
    // wrote imperatively during the drag - so a getTravel() bug can never
    // survive into the rendered position after a committed drag; the CSS
    // is always what's left standing regardless of which JS formula ran.
    // The one place the raw getTravel() pixel value survives into the
    // final rendered transform is a drag that *fails* to commit: the sheet
    // "springs back" to the state it started in, setExpanded is called
    // with an unchanged value, React bails out of re-rendering (same
    // props), and the imperative style from the drag is never overwritten.
    // A small, slow nudge on the (currently collapsed) handle - well under
    // both the 25%-of-travel and velocity commit thresholds - reproduces
    // exactly that: the sheet springs back down to "collapsed", but the
    // position it rests at is whatever getTravel() computed, buggy or not.
    await drag(-60, 10, 40);
    await expect(handle).toHaveAttribute('aria-expanded', 'false');
    await page.waitForTimeout(400);

    // Measure the intended peek strip from real rendered geometry - the
    // handle and edge-guard elements' own boundingBox heights - rather than
    // importing PEEK_HEIGHT from the component. Importing the app's own
    // constant would make this test move in lockstep with the very bug it's
    // supposed to catch.
    const sheet = page.getByTestId('transactions-drawer');
    const sheetChildren = sheet.locator(':scope > div');
    const handleHeight = (await sheetChildren.nth(0).boundingBox()).height;
    const edgeGuardHeight = (await sheetChildren.nth(1).boundingBox()).height;
    const expectedPeek = handleHeight + edgeGuardHeight;

    const viewport = page.viewportSize();
    const sheetBox = await sheet.boundingBox();
    const visiblePeek = viewport.height - sheetBox.y;

    expect(Math.abs(visiblePeek - expectedPeek)).toBeLessThanOrEqual(3);
  });

  test('account rows stay on one line in the accounts modal', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');
    await expect(page.getByText('BudgetTracker')).toBeVisible();

    await page.getByTitle('Управление счетами').click();

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

  test('quick-action buttons (income/expense/transfer) sit on one row, fit the viewport, and are not text-clipped', async ({ page }) => {
    // These three buttons used to be a full-width transfer button stacked
    // above an income/expense row. They were merged onto a single row of
    // three equal-width buttons to reclaim vertical space. jsdom can't see
    // whether the shorter "⇄ Обмен" label actually fits at 1/3 width on a
    // real 390px phone, whether the row overflows the page, or whether all
    // three end up the same height - only real layout can, hence this test.
    await mockApi(page);
    await page.goto('/');
    await expect(page.getByText('BudgetTracker')).toBeVisible();

    const income = page.getByRole('button', { name: /\+ Доход/i });
    const expense = page.getByRole('button', { name: /- Расход/i });
    const transfer = page.getByRole('button', { name: /⇄ Обмен/i });

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
    // between the glass-panel and btn-primary classes).
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

  test('month navigation lives in the header, not main, and its arrows keep a 40x40 tap target', async ({ page }) => {
    // The month row was moved from its own block in <main> into the header
    // card (as global chrome - the selected month filters both the stats
    // panel and the drawer's transaction list, so it isn't scoped to
    // either one) so it shares the header's existing padding instead of
    // adding its own separate block to the page. Shrinking the arrow
    // glyphs must still not shrink their tappable area, since they are the
    // only way to change month. jsdom can't measure real rendered box
    // sizes or DOM ancestry against real layout, hence a real-browser
    // check here.
    await mockApi(page);
    await page.goto('/');
    await expect(page.getByText('BudgetTracker')).toBeVisible();

    const prevButton = page.getByRole('button', { name: '←', exact: true });
    const nextButton = page.getByRole('button', { name: '→', exact: true });
    await expect(prevButton).toBeVisible();
    await expect(nextButton).toBeVisible();

    // The row must render inside <header>, not <main> - this is the change
    // itself, not an incidental detail, so assert ancestry directly rather
    // than just trusting visual position.
    const ancestry = await prevButton.evaluate((el) => ({
      insideHeader: !!el.closest('header'),
      insideMain: !!el.closest('main'),
    }));
    expect(ancestry.insideHeader).toBe(true);
    expect(ancestry.insideMain).toBe(false);

    const prevBox = await prevButton.boundingBox();
    const nextBox = await nextButton.boundingBox();
    expect(prevBox).not.toBeNull();
    expect(nextBox).not.toBeNull();

    // Tap targets must stay finger-sized even though the glyph shrank.
    for (const box of [prevBox, nextBox]) {
      expect(box.width).toBeGreaterThanOrEqual(40);
      expect(box.height).toBeGreaterThanOrEqual(40);
    }

    // The two arrows sit at opposite ends of the row with the month name
    // between them, so a correctly-laid-out row has no overlap risk - but
    // a prior fix elsewhere in this app enlarged a tap target with a
    // negative margin and caused adjacent targets to overlap by 18px, so
    // this is verified by measurement rather than assumed.
    expect(prevBox.x + prevBox.width).toBeLessThanOrEqual(nextBox.x);

    const heading = page.locator('h2', { hasText: /\d{4}/ });
    await expect(heading).toBeVisible();
    const headingBox = await heading.boundingBox();
    expect(headingBox).not.toBeNull();

    // Neither arrow box overlaps the centred month heading.
    expect(prevBox.x + prevBox.width).toBeLessThanOrEqual(headingBox.x + 0.5);
    expect(headingBox.x + headingBox.width).toBeLessThanOrEqual(nextBox.x + 0.5);
  });

  test('range tabs and the Аналитика button share one row in the stats panel', async ({ page }) => {
    // The tab group (Месяц/Год/Всё время) and the "Аналитика ->" button
    // were already a single flex row with justifyContent: 'space-between',
    // but flexWrap: 'wrap' plus their combined natural width meant they
    // wrapped onto two lines at a 390px viewport, costing an extra row of
    // vertical space. Their paddings/gap were tightened so all four
    // controls fit on one line without touching the row's structure or the
    // wrap safety net. jsdom performs no real text/flex layout, so it can
    // never see the wrap - only real rendered geometry can.
    await mockApi(page);
    await page.goto('/');
    await expect(page.getByText('BudgetTracker')).toBeVisible();

    const monthTab = page.getByRole('button', { name: 'Месяц', exact: true });
    const yearTab = page.getByRole('button', { name: 'Год', exact: true });
    const lifetimeTab = page.getByRole('button', { name: 'Всё время', exact: true });
    const analyticsBtn = page.getByRole('button', { name: /Аналитика/ });

    const controls = [monthTab, yearTab, lifetimeTab, analyticsBtn];
    const boxes = [];
    for (const control of controls) {
      await expect(control).toBeVisible();
      const box = await control.boundingBox();
      expect(box).not.toBeNull();
      boxes.push(box);
    }

    // All four share the same row - their vertical centres line up, within
    // a couple of pixels. This is the assertion that would have caught the
    // pre-fix wrap: with the original wider paddings the tab group and the
    // button land on two visibly different rows here.
    const centres = boxes.map((box) => box.y + box.height / 2);
    for (const centre of centres) {
      expect(Math.abs(centre - centres[0])).toBeLessThanOrEqual(2);
    }

    // None of the four controls overflows the stats panel horizontally.
    const panelBox = await monthTab.evaluate((el) => {
      const panel = el.closest('.glass-panel');
      const rect = panel.getBoundingClientRect();
      return { x: rect.x, right: rect.x + rect.width };
    });
    for (const box of boxes) {
      expect(box.x).toBeGreaterThanOrEqual(panelBox.x - 0.5);
      expect(box.x + box.width).toBeLessThanOrEqual(panelBox.right + 0.5);
    }
  });
});
