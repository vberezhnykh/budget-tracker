import { test, expect } from '@playwright/test';
import { manyAccounts, mockApi } from './fixtures.js';

const dotAccounts = manyAccounts.slice(0, 7);

async function openAccounts(page, width) {
  await page.setViewportSize({ width, height: 900 });
  await page.clock.setFixedTime(new Date(2026, 8, 12, 12));
  await mockApi(page, { accounts: dotAccounts, plannedPayments: [] });
  await page.goto('/');
  const dots = page.locator('button[aria-label^="Показать"]');
  await expect(dots).toHaveCount(8);
  await expect(dots.first()).toHaveAttribute('aria-current', 'true');
  return {
    dots,
    row: dots.first().locator('..'),
    carousel: page.getByTestId('balance-carousel'),
  };
}

async function markerGeometry(dots) {
  return dots.evaluateAll(buttons => buttons.map(button => {
    const target = button.getBoundingClientRect();
    const marker = button.querySelector('.account-carousel-dot').getBoundingClientRect();
    return {
      width: marker.width,
      height: marker.height,
      centerX: marker.x + marker.width / 2 - target.x,
      centerY: marker.y + marker.height / 2 - target.y,
    };
  }));
}

async function expectSelected(page, dots, carousel, index) {
  await expect(dots).toHaveCount(8);
  await expect(page.locator('button[aria-label^="Показать"][aria-current="true"]')).toHaveCount(1);
  await expect(dots.nth(index)).toHaveAttribute('aria-current', 'true');
  await expect(carousel.locator('[data-carousel-slide][aria-current="true"]')).toHaveCount(1);
  await expect(carousel.locator('[data-carousel-slide]').nth(index)).toHaveAttribute('aria-current', 'true');
  await expect.poll(() => carousel.evaluate((element, targetIndex) => {
    const slide = element.querySelectorAll('[data-carousel-slide]')[targetIndex];
    const viewport = element.getBoundingClientRect();
    const target = slide.getBoundingClientRect();
    return Math.abs(target.x + target.width / 2 - (viewport.x + viewport.width / 2));
  }, index)).toBeLessThanOrEqual(1);
  const title = page.getByText(/^Список операций/);
  if (index > 0) await expect(title).toContainText(dotAccounts[index - 1].name);
  else await expect(title).toHaveText('Список операций');
}

async function attachRow(row, testInfo, name) {
  const path = testInfo.outputPath(`${name}.png`);
  const png = await row.screenshot({ path });
  await testInfo.attach(name, { path, contentType: 'image/png' });
  return png;
}

// Compare the same indicator row within this run, without a platform-specific
// golden image. A trail left after changing selection changes real pixels even
// when DOM attributes are correct. Small antialiasing differences are tolerated.
async function changedPixelFraction(page, before, after) {
  return page.evaluate(async encoded => {
    const read = async source => {
      const image = new Image();
      image.src = `data:image/png;base64,${source}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      return { width: image.width, height: image.height, pixels: context.getImageData(0, 0, image.width, image.height).data };
    };
    const [a, b] = await Promise.all(encoded.map(read));
    if (a.width !== b.width || a.height !== b.height) return 1;
    let changed = 0;
    for (let index = 0; index < a.pixels.length; index += 4) {
      if ([0, 1, 2, 3].some(channel => Math.abs(a.pixels[index + channel] - b.pixels[index + channel]) > 12)) changed++;
    }
    return changed / (a.width * a.height);
  }, [before.toString('base64'), after.toString('base64')]);
}

test.describe('Account indicator rendering (mobile)', () => {
  test('eight indicators keep their geometry and repaint cleanly after every account at 320px', async ({ page }, testInfo) => {
    const { dots, row, carousel } = await openAccounts(page, 320);
    const initialGeometry = await markerGeometry(dots);
    const before = await attachRow(row, testInfo, 'indicators-before-roundtrip');
    const targets = await dots.evaluateAll(buttons => buttons.map(button => {
      const box = button.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    }));
    for (let index = 0; index < targets.length; index++) {
      const target = targets[index];
      expect(target.x).toBeGreaterThanOrEqual(0);
      expect(target.x + target.width).toBeLessThanOrEqual(320);
      expect(target.y).toBeCloseTo(targets[0].y, 1);
      expect(target.width).toBeGreaterThanOrEqual(20);
      expect(target.height).toBeGreaterThanOrEqual(40);
      if (index > 0) expect(targets[index - 1].x + targets[index - 1].width).toBeLessThanOrEqual(target.x + 0.5);
    }

    for (const index of [1, 2, 3, 4, 5, 6, 7, 0]) {
      await dots.nth(index).click();
      await expectSelected(page, dots, carousel, index);
      const currentGeometry = await markerGeometry(dots);
      for (let marker = 0; marker < initialGeometry.length; marker++) {
        for (const key of ['width', 'height', 'centerX', 'centerY']) {
          expect(currentGeometry[marker][key]).toBeCloseTo(initialGeometry[marker][key], 1);
        }
      }
    }
    const after = await attachRow(row, testInfo, 'indicators-after-roundtrip');
    expect(await changedPixelFraction(page, before, after)).toBeLessThan(0.002);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  });

  test('native carousel scrolling updates one indicator and vertical scrolling preserves its rendered state', async ({ page }, testInfo) => {
    const { dots, row, carousel } = await openAccounts(page, 390);
    for (const index of [3, 6, 1]) {
      await carousel.evaluate((element, targetIndex) => {
        const slide = element.querySelectorAll('[data-carousel-slide]')[targetIndex];
        element.scrollTo({ left: slide.offsetLeft + slide.offsetWidth / 2 - element.clientWidth / 2, behavior: 'instant' });
      }, index);
      await expectSelected(page, dots, carousel, index);
    }

    const before = await attachRow(row, testInfo, 'indicators-before-vertical-scroll');
    const originalScroll = await page.evaluate(() => window.scrollY);
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(originalScroll);
    await page.evaluate(top => window.scrollTo({ top, behavior: 'instant' }), originalScroll);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(originalScroll);
    await expectSelected(page, dots, carousel, 1);
    const after = await attachRow(row, testInfo, 'indicators-after-vertical-scroll');
    expect(await changedPixelFraction(page, before, after)).toBeLessThan(0.002);
  });
});
