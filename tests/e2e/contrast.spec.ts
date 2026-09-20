import { expect, test, type Page } from '@playwright/test';
import { contrastRatio, AA_NON_TEXT, AA_TEXT } from '../../src/ui/contrast.js';
import { loadReferenceLayout } from './helpers.js';

/**
 * Regression 8. The prototype shipped an outline button that rendered white on
 * white, because a theme rule outranked the button's own colour. Only a browser
 * resolves the cascade and custom properties, so the check has to live here.
 *
 * Both themes are covered by the two Playwright projects, so each of these runs
 * twice.
 */

/** Walks up for the nearest ancestor that actually paints a background. */
function paintedBackground(element: Element): string {
  let node: Element | null = element;
  while (node !== null) {
    const colour = getComputedStyle(node).backgroundColor;
    const transparent =
      colour === '' || colour === 'transparent' || colour.startsWith('rgba(0, 0, 0, 0)');
    if (!transparent) return colour;
    node = node.parentElement;
  }
  return getComputedStyle(document.body).backgroundColor;
}

async function measure(
  page: Page,
  selector: string,
): Promise<{ foreground: string; background: string; ratio: number }> {
  const locator = page.locator(selector).first();
  await expect(locator, `expected ${selector} to be present`).toBeAttached();

  const foreground = await locator.evaluate((element) => getComputedStyle(element).color);
  const background = await locator.evaluate(paintedBackground);
  return { foreground, background, ratio: contrastRatio(foreground, background) };
}

test('body text meets AA against its background', async ({ page }) => {
  await page.goto('./');
  const { foreground, background, ratio } = await measure(page, 'body');
  expect(ratio, `body text ${foreground} on ${background}`).toBeGreaterThanOrEqual(AA_TEXT);
});

test('the tagline and colophon meet AA despite being muted', async ({ page }) => {
  await page.goto('./');
  for (const selector of ['.tagline', '.colophon p']) {
    const { foreground, background, ratio } = await measure(page, selector);
    expect(ratio, `${selector}: ${foreground} on ${background}`).toBeGreaterThanOrEqual(AA_TEXT);
  }
});

test('the error message meets AA, because it is the one thing that must be read', async ({
  page,
}) => {
  await page.goto('./');
  await page.locator('#layout-file').setInputFiles({
    name: 'broken.json',
    mimeType: 'application/json',
    buffer: Buffer.from('nope'),
  });
  await expect(page.getByRole('alert')).toBeVisible();

  const { foreground, background, ratio } = await measure(page, '#layout-error');
  expect(ratio, `error text ${foreground} on ${background}`).toBeGreaterThanOrEqual(AA_TEXT);
});

test('the summary terms meet AA after a layout loads', async ({ page }) => {
  await page.goto('./');
  await loadReferenceLayout(page);
  const { foreground, background, ratio } = await measure(page, '#summary-list dt');
  expect(ratio, `summary term ${foreground} on ${background}`).toBeGreaterThanOrEqual(AA_TEXT);
});

test('the focus ring meets the non-text threshold against its surroundings', async ({ page }) => {
  await page.goto('./');
  const input = page.locator('#layout-file');
  await input.focus();

  const ring = await input.evaluate((element) => getComputedStyle(element).outlineColor);
  const surround = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(contrastRatio(ring, surround), `focus ring ${ring} on ${surround}`).toBeGreaterThanOrEqual(
    AA_NON_TEXT,
  );
});

test('no foreground ever matches its own background', async ({ page }) => {
  // The shape of the original bug, stated directly.
  await page.goto('./');
  await loadReferenceLayout(page);

  for (const selector of [
    'body',
    'h1',
    'h2',
    '.tagline',
    '.colophon p',
    '#summary-list dt',
    '#summary-list dd',
  ]) {
    const { foreground, background, ratio } = await measure(page, selector);
    expect(ratio, `${selector} is invisible: ${foreground} on ${background}`).toBeGreaterThan(1.5);
  }
});
