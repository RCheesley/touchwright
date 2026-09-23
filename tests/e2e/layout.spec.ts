/**
 * The page has to be usable, not merely correct.
 *
 * These exist because it was neither: the board sat 770 pixels above the text
 * being typed, so a learner could see where the next key was or what they were
 * meant to type, but never both; and the sprint, the ladder and the statistics
 * were far enough down a five-thousand-pixel page that nobody found them.
 */

import { expect, test, type Page } from '@playwright/test';
import { gotoApp, loadReferenceLayout } from './helpers.js';

async function box(page: Page, selector: string): Promise<{ top: number; bottom: number }> {
  const found = await page.locator(selector).boundingBox();
  expect(found, `${selector} should be on the page`).not.toBeNull();
  return { top: found!.y, bottom: found!.y + found!.height };
}

test.describe('on a desktop-sized window', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('shows the board and the text being typed at the same time', async ({ page }) => {
    await gotoApp(page);
    await loadReferenceLayout(page);

    const board = await box(page, '#board-figure');
    const text = await box(page, '#drill-text');

    // Both inside one viewport height of each other, measured from whichever
    // starts first to whichever ends last.
    const spread = Math.max(board.bottom, text.bottom) - Math.min(board.top, text.top);
    expect(spread, 'the board and the drill text must fit on screen together').toBeLessThanOrEqual(
      900,
    );
  });

  test('puts the board beside the drill rather than above it', async ({ page }) => {
    await gotoApp(page);
    await loadReferenceLayout(page);

    const board = await page.locator('#board-figure').boundingBox();
    const text = await page.locator('#drill-text').boundingBox();
    expect(board).not.toBeNull();
    expect(text).not.toBeNull();
    expect(text!.x, 'the drill should sit to the side of the board').toBeGreaterThan(board!.x);
  });

  test('offers a way to every section once a layout is loaded', async ({ page }) => {
    await gotoApp(page);
    await expect(page.locator('#section-nav')).toBeHidden();

    await loadReferenceLayout(page);
    const nav = page.locator('#section-nav');
    await expect(nav).toBeVisible();

    for (const target of [
      '#drill-section',
      '#sprint-section',
      '#ladder-section',
      '#stats-section',
    ]) {
      const link = nav.locator(`a[href="${target}"]`);
      await expect(link).toBeVisible();
      await link.click();
      await expect(page.locator(target)).toBeInViewport();
    }
  });

  test('keeps the whole page within a few screens', async ({ page }) => {
    await gotoApp(page);
    await loadReferenceLayout(page);

    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    // It was over five thousand. This is a ceiling, not a target.
    expect(height, 'the page should not be an endless scroll').toBeLessThan(4200);
  });
});

test.describe('on a narrow window', () => {
  test.use({ viewport: { width: 380, height: 800 } });

  test('stacks rather than squeezing, and never scrolls sideways', async ({ page }) => {
    await gotoApp(page);
    await loadReferenceLayout(page);

    const board = await page.locator('#board-figure').boundingBox();
    const text = await page.locator('#drill-text').boundingBox();
    expect(board).not.toBeNull();
    expect(text).not.toBeNull();
    // Stacked, which is one below the other rather than side by side. Measured
    // vertically, not by left edges: the drill text sits inside a padded surface
    // so its box starts a little in from the board's.
    expect(text!.y, 'the drill should be below the board, not beside it').toBeGreaterThan(
      board!.y + board!.height,
    );

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('the section navigation wraps instead of overflowing', async ({ page }) => {
    await gotoApp(page);
    await loadReferenceLayout(page);
    const nav = await page.locator('#section-nav').boundingBox();
    expect(nav).not.toBeNull();
    expect(nav!.width).toBeLessThanOrEqual(380);
  });
});
