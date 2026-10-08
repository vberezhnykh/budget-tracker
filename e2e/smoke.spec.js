import { test, expect } from '@playwright/test';
import { mockApi, accounts, manyAccounts } from './fixtures.js';

// Переход на вкладку нижней навигации.
const goToTab = (page, name) => page
  .getByRole('navigation', { name: 'Основная навигация' })
  .getByRole('button', { name, exact: true })
  .click();

// Настройки живут строками на экране «Ещё»: Счета, Категории, Корзина, Лимит.
async function openMoreRow(page, name) {
  await goToTab(page, 'Ещё');
  await page.getByRole('button', { name }).click();
}

// Real-browser smoke suite. Three real bugs shipped this month and every one
// was found by a human on a phone, never by the (jsdom-based) unit suite:
//
//   1. A <style> element rendered as the account carousel's first child
//      shifted every container.children[i] index, so swiping jumped to the
//      wrong account. (The carousel is gone - accounts are a plain row of
//      tap-to-select cards - but the lesson stands: selection is checked
//      against the real rendered row.)
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
    const summaryFrame = page.getByTestId('account-summary');
    const bar = page.getByTestId('limit-bar');
    await expect(bar).toBeVisible();
    const original = await summaryFrame.elementHandle();
    // Clicking an offscreen account may scroll the page as well as its row.
    // Compare document positions so that scroll is not mistaken for layout shift.
    const documentTop = locator => locator.evaluate(el => el.getBoundingClientRect().top + window.scrollY);
    // Веб-шрифт может догрузиться уже после замера и поменять высоту строк
    // над карточкой. Это не тот сдвиг, который ловит тест, поэтому меряем
    // после загрузки шрифтов.
    await page.evaluate(() => document.fonts.ready);
    const before = await documentTop(summaryFrame);

    await page.getByRole('button', { name: /^Тинькофф:/ }).click();
    const summary = page.getByRole('status', { name: 'Загрузка итогов…' });
    await expect(summary).toHaveCount(0);
    await expect(bar).toBeVisible();
    expect(summaryRequests).toBe(1);
    expect(await original.evaluate(el => el === document.querySelector('[data-testid="account-summary"]'))).toBe(true);
    expect(Math.abs(await documentTop(summaryFrame) - before)).toBeLessThan(2);
  });

  test('renders the app: period title, summary card and the «Все счета» card are visible; no app name', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');

    await expect(page.getByRole('button', { name: /^Период:/ })).toBeVisible();
    await expect(page.getByText('BudgetTracker')).toHaveCount(0);
    await expect(page.getByText(/^Обновлено /)).toBeVisible();
    await expect(page.getByTestId('limit-bar')).toBeVisible();
    const total = page.getByRole('button', { name: /^Все счета:/ });
    await expect(total).toBeVisible();
    await expect(total).toHaveAttribute('aria-pressed', 'true');
    // Секции экрана по порядку: счета, затем последние операции.
    const accountsTop = (await page.getByRole('heading', { level: 2, name: 'Счета' }).boundingBox()).y;
    const recentTop = (await page.getByRole('heading', { level: 2, name: 'Последние операции' }).boundingBox()).y;
    expect(accountsTop).toBeLessThan(recentTop);
  });

  test('scrolling the accounts row never changes the selection; a tap selects exactly the tapped card', async ({ page }) => {
    // Раньше осевшая прокрутка карусели выбирала ближайший счёт (и ловился баг,
    // при котором выбирался всегда последний). Теперь лента листается
    // свободно, а выбор делает только нажатие. Прокрутка здесь настоящая:
    // jsdom её не знает.
    await mockApi(page, { accounts: manyAccounts });
    await page.goto('/');
    const row = page.getByTestId('accounts-row');
    await expect(row).toBeVisible();
    const cards = row.getByRole('button');
    await expect(cards).toHaveCount(manyAccounts.length + 1);

    await row.evaluate(el => el.scrollTo({ left: el.scrollWidth, behavior: 'instant' }));
    await page.waitForTimeout(500);
    await expect(row.locator('button[aria-pressed="true"]')).toHaveCount(1);
    await expect(cards.first()).toHaveAttribute('aria-pressed', 'true');

    // Нажатие не в последнюю карточку и не в первую: выбирается именно она.
    const target = manyAccounts[2];
    const last = manyAccounts[manyAccounts.length - 1];
    await page.getByRole('button', { name: new RegExp(`^${target.name}:`) }).click();
    await expect(page.getByRole('button', { name: new RegExp(`^${target.name}:`) })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: new RegExp(`^${last.name}:`) })).toHaveAttribute('aria-pressed', 'false');
    await expect(row.locator('button[aria-pressed="true"]')).toHaveCount(1);

    // Дальнейшая прокрутка выбор не двигает.
    await row.evaluate(el => el.scrollTo({ left: 0, behavior: 'instant' }));
    await page.waitForTimeout(500);
    await expect(page.getByRole('button', { name: new RegExp(`^${target.name}:`) })).toHaveAttribute('aria-pressed', 'true');
  });

  test('the accounts row is free-scrolling (no snap, no scrollbar) and bleeds to the right screen edge', async ({ page }) => {
    // «Прокручивается без привязки и без полосы, выходит к правому краю
    // экрана» - свойства раскладки, которые видит только настоящий движок.
    await mockApi(page, { accounts: manyAccounts });
    await page.goto('/');
    const row = page.getByTestId('accounts-row');
    await expect(row).toBeVisible();

    const geometry = await row.evaluate(el => {
      const style = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      return {
        overflowX: style.overflowX,
        snap: style.scrollSnapType,
        scrollbarWidth: style.scrollbarWidth,
        right: box.right,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      };
    });
    expect(geometry.overflowX).toBe('auto');
    expect(geometry.snap).toBe('none');
    expect(geometry.scrollbarWidth).toBe('none');
    expect(geometry.scrollWidth).toBeGreaterThan(geometry.clientWidth);
    expect(geometry.right).toBeCloseTo(page.viewportSize().width, 0);
    // Лента не растягивает страницу вширь.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test('account rows stay inside the row on the accounts screen', async ({ page }) => {
    // Название счёта и баланс не должны вылезать за правый край строки:
    // элементы flex-строки без minWidth: 0 отказываются сжиматься ниже
    // ширины своего содержимого, и длинное название уезжает вбок (так было с
    // ручкой перетаскивания, добавленной к строкам счетов). Строка может
    // перенести название на вторую строку, но выйти за край не вправе.
    await page.setViewportSize({ width: 320, height: 700 });
    await mockApi(page);
    await page.goto('/');
    await expect(page.getByTestId('accounts-row')).toBeVisible();

    await openMoreRow(page, /^Счета/);
    await expect(page.getByRole('heading', { level: 1, name: 'Счета' })).toBeVisible();

    const main = page.getByRole('main');
    const row0 = main.getByRole('button', { name: `Переместить: ${accounts[0].name}` }).locator('xpath=..');
    const rowBox0 = await row0.boundingBox();
    for (const acc of accounts) {
      const row = main.getByRole('button', { name: `Переместить: ${acc.name}` }).locator('xpath=..');
      await expect(row).toBeVisible();
      const rowBox = await row.boundingBox();
      const nameBox = await row.getByText(acc.name, { exact: true }).first().boundingBox();
      const balanceBox = await row.getByText(/€/).last().boundingBox();

      // Все строки одной ширины - на этом допущении и держится «в пределах строки».
      expect(Math.abs(rowBox.width - rowBox0.width)).toBeLessThanOrEqual(2);
      expect(nameBox.x + nameBox.width).toBeLessThanOrEqual(rowBox.x + rowBox.width + 2);
      expect(balanceBox.x + balanceBox.width).toBeLessThanOrEqual(rowBox.x + rowBox.width + 2);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test('the overview has no quick-action buttons: adding goes through the «+» in the bottom navigation', async ({ page }) => {
    // Три быстрые кнопки «Доход / Расход / Перевод» заменила «+» в нижней
    // панели. Заодно проверяем раскладку экрана на самой узкой ширине: ни одна
    // секция не должна растягивать страницу вширь.
    await page.setViewportSize({ width: 320, height: 700 });
    await mockApi(page);
    await page.goto('/');
    await expect(page.getByTestId('accounts-row')).toBeVisible();

    for (const name of ['Добавить доход', 'Добавить расход', 'Добавить перевод']) {
      await expect(page.getByRole('button', { name })).toHaveCount(0);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    // Число расхода и подпись «из лимита» помещаются в карточку.
    const hero = page.getByTestId('account-summary');
    const heroBox = await hero.boundingBox();
    const figure = await page.getByRole('button', { name: /^Расход: / }).boundingBox();
    expect(figure.x).toBeGreaterThanOrEqual(heroBox.x);
    expect(figure.x + figure.width).toBeLessThanOrEqual(heroBox.x + heroBox.width + 0.5);

    await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('button', { name: 'Добавить операцию' }).click();
    await expect(page.getByRole('dialog', { name: 'Новый расход' })).toBeVisible();
  });

  test('the period title replaces the header month row and its sheet is reachable and tappable', async ({ page }) => {
    // The month arrow row and the Месяц/Год/Всё время toggle were replaced
    // by a single period control that opens a bottom sheet (CoinKeeper's
    // pattern); on the overview it is the screen title («Октябрь ⌄») in the
    // header row. The sheet's month cells must be finger-sized and fit the
    // viewport - none of which jsdom can measure, since it lays nothing out.
    await mockApi(page);
    await page.goto('/');
    await expect(page.getByTestId('accounts-row')).toBeVisible();

    // No month arrows anywhere any more.
    await expect(page.getByRole('button', { name: '←', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '→', exact: true })).toHaveCount(0);

    const chip = page.getByRole('button', { name: /^Период:/ });
    await expect(chip).toBeVisible();

    // Заголовок экрана - кнопка высотой не меньше 44px и крупным шрифтом.
    const chipBox = await chip.boundingBox();
    expect(chipBox.height).toBeGreaterThanOrEqual(44);
    expect(await chip.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(24);
    expect(await chip.evaluate((el) => !!el.closest('main'))).toBe(true);

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
    await expect(page.getByTestId('accounts-row')).toBeVisible();

    const bodyState = () => page.evaluate(() => ({
      position: document.body.style.position,
      overflow: document.body.style.overflow,
      top: document.body.style.top,
    }));

    // До открытия страница обычная.
    const free = await bodyState();
    expect(free.position).toBe('');
    expect(free.overflow).not.toBe('hidden');

    // Листы настроек открываются с «Ещё», где уже нет ни выбора периода, ни
    // ленты счетов Обзора, - поэтому они последние в списке.
    for (const open of [
      () => page.getByRole('button', { name: /^Период:/ }).click(),
      () => page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('button', { name: 'Добавить операцию' }).click(),
      () => openMoreRow(page, /^Лимит трат/),
      async () => {
        await openMoreRow(page, /^Счета/);
        await page.getByRole('button', { name: 'Добавить счёт' }).click();
      },
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
    await expect(page.getByTestId('accounts-row')).toBeVisible();
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

  test('знак суммы не отрывается от числа в карточке сводки', async ({ page }) => {
    // «+» висел на строке один, а сумма уезжала под него: строка ломалась
    // ровно по пробелу между знаком и числом. Сумма здесь заведомо длинная:
    // «+€28.649,42» должна остаться одной строкой в половине карточки, и на
    // самой узкой ширине тоже. jsdom такого не покажет: он не переносит
    // строки, потому что их не измеряет.
    await page.setViewportSize({ width: 320, height: 700 });
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
    await expect(page.getByTestId('accounts-row')).toBeVisible();

    const activeCard = page.getByTestId('account-summary');
    await expect(activeCard.locator('button[aria-label^="Доход:"]')).toHaveCount(1);

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
    await expect(page.getByTestId('accounts-row')).toBeVisible();

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
    await expect(page.getByText(/Распределение по категориям появится/)).toBeVisible();

    // Widening the range from the chip fills the same tab with category bars.
    await page.getByRole('button', { name: /^Период:/ }).click();
    await page.getByRole('dialog', { name: 'Выбор периода' }).getByRole('button', { name: 'Всё время' }).click();
    await expect(page.getByRole('heading', { name: 'Категории' })).toBeVisible();

    await nav.getByRole('button', { name: 'Обзор', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Категории' })).toHaveCount(0);
  });

  test('switching tabs writes the hash without piling up history, and manual hash changes and back/forward move between screens', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');
    await expect(page.getByTestId('accounts-row')).toBeVisible();
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
    await expect(page.getByRole('heading', { name: 'Категории' }).or(page.getByText('За выбранный период трат нет'))).toBeVisible();
    await page.evaluate(() => { location.hash = '#more'; });
    await current('Ещё');
    await expect(page.getByRole('heading', { level: 1, name: 'Ещё' })).toBeVisible();

    // ...а жесты «назад» и «вперёд» ходят по этим записям, и экран следует.
    await page.goBack();
    await current('Аналитика');
    await page.goBack();
    await current('Обзор');
    await expect(page.getByTestId('accounts-row')).toBeVisible();
    await page.goForward();
    await current('Аналитика');

    // Обновление страницы остаётся на той же вкладке.
    await page.reload();
    await current('Аналитика');
  });

  test('inner screens open through history: Back closes them, a reload opens them directly', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');
    await expect(page.getByTestId('accounts-row')).toBeVisible();
    const nav = page.getByRole('navigation', { name: 'Основная навигация' });
    const more = nav.getByRole('button', { name: 'Ещё', exact: true });
    const entries = () => page.evaluate(() => history.length);
    const startEntries = await entries();

    // «Настроить» на Обзоре кладёт экран счетов в историю, «назад» возвращает на Обзор.
    await page.getByRole('region', { name: 'Счета' }).getByRole('button', { name: 'Настроить' }).click();
    await expect(page).toHaveURL(/#more\/accounts$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Счета' })).toBeVisible();
    await expect(more).toHaveAttribute('aria-current', 'page');
    expect(await entries()).toBe(startEntries + 1);
    await page.goBack();
    await expect(page.getByTestId('accounts-row')).toBeVisible();
    await expect(page).not.toHaveURL(/#/);
    await page.goForward();
    await expect(page.getByRole('heading', { level: 1, name: 'Счета' })).toBeVisible();
    await page.goBack();

    // Из «Ещё»: вкладка ложится в запись заменой, экран - новой записью.
    await goToTab(page, 'Ещё');
    await page.getByRole('button', { name: /^Категории/ }).click();
    await expect(page).toHaveURL(/#more\/categories$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Категории' })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/#more$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Ещё' })).toBeVisible();

    // Кнопка «назад» в шапке экрана - тот же путь по истории.
    await page.getByRole('button', { name: /^Корзина/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Корзина' })).toBeVisible();
    await page.getByRole('main').getByRole('button', { name: 'Ещё', exact: true }).click();
    await expect(page).toHaveURL(/#more$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Ещё' })).toBeVisible();

    // Нажатие на вкладку внизу уводит с внутреннего экрана без новой записи.
    await page.getByRole('button', { name: /^Категории/ }).click();
    const before = await entries();
    await goToTab(page, 'История');
    await expect(page).toHaveURL(/#history$/);
    expect(await entries()).toBe(before);

    // Обновление страницы на внутреннем экране открывает его сразу; «назад» в
    // шапке заменяет хэш на #more и не уводит из приложения.
    await page.goto('/#more/categories');
    await expect(page.getByRole('heading', { level: 1, name: 'Категории' })).toBeVisible();
    await expect(more).toHaveAttribute('aria-current', 'page');
    const afterLoad = await entries();
    await page.getByRole('main').getByRole('button', { name: 'Ещё', exact: true }).click();
    await expect(page).toHaveURL(/#more$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Ещё' })).toBeVisible();
    expect(await entries()).toBe(afterLoad);
  });
});
