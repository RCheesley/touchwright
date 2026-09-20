import { expect, test } from '@playwright/test';
import { loadReferenceLayout } from './helpers.js';

/**
 * WCAG 1.4.10 asks for no horizontal scrolling at 320 CSS pixels, and 1.4.4 for
 * usability at 400 per cent zoom, which is the same measurement from the other
 * side.
 */
const WIDTHS = [320, 600, 1280];

for (const width of WIDTHS) {
  test(`does not scroll horizontally at ${width} CSS pixels`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/');
    await loadReferenceLayout(page);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(1);
  });
}

test('keeps a readable side gutter at 320 CSS pixels', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/');
  const box = await page.getByRole('heading', { level: 1 }).boundingBox();
  expect(box?.x ?? 0).toBeGreaterThanOrEqual(8);
});
