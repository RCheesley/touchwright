import { expect, test, type Page } from '@playwright/test';
import { FINGERS } from '../../src/board/types.js';
import { AA_NON_TEXT, AA_TEXT, contrastRatio } from '../../src/ui/contrast.js';
import { expectNoAxeViolations, loadReferenceLayout } from './helpers.js';

/**
 * The board diagram, in a real browser.
 *
 * Colour is declared in the stylesheet and resolved by the cascade, so only a
 * browser can say what a finger colour actually is. Both themes are covered by
 * the two Playwright projects, so every test here runs twice.
 *
 * The accessibility claims being checked are the ones the brief makes acceptance
 * criteria: the SVG is aria-hidden and nothing is available only there, the
 * highlight is not the only way to know which key is next, the legend names each
 * finger in words, finger colours clear 3:1 against the board surface, and cap
 * labels clear AA against their caps.
 */

/**
 * The fill of the cap this label sits on. Defined out here rather than inline so
 * that the branch a missing cap needs lives outside the test body.
 */
function capFillBeside(element: Element): string {
  const cap = element.parentElement?.querySelector('.board-cap');
  if (cap === null || cap === undefined) {
    throw new Error('A cap label was drawn without a cap beside it');
  }
  return getComputedStyle(cap).fill;
}

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

/** One resolved CSS property, whatever element type it belongs to. */
async function style(page: Page, selector: string, property: string): Promise<string> {
  const locator = page.locator(selector).first();
  await expect(locator, `expected ${selector} to be present`).toBeAttached();
  return locator.evaluate(
    (element, name) => getComputedStyle(element).getPropertyValue(name),
    property,
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto('./');
  await loadReferenceLayout(page);
});

test('draws the board once a layout is loaded', async ({ page }) => {
  await expect(page.locator('#board-section')).toBeVisible();
  const caps = page.locator('#board-figure .board-cap');
  await expect(caps).toHaveCount(80);
});

test('hides the diagram from assistive technology', async ({ page }) => {
  const svg = page.locator('#board-figure svg');
  await expect(svg).toHaveAttribute('aria-hidden', 'true');
  await expect(svg).toHaveAttribute('focusable', 'false');
});

test('every finger colour clears the non-text threshold against the board surface', async ({
  page,
}) => {
  const plate = await style(page, '#board-figure .board-plate', 'fill');

  for (const finger of FINGERS) {
    const stroke = await style(
      page,
      `#board-figure .board-key[data-finger="${finger}"] .board-cap`,
      'stroke',
    );
    const ratio = contrastRatio(stroke, plate);
    expect(ratio, `${finger} ${stroke} on the board surface ${plate}`).toBeGreaterThanOrEqual(
      AA_NON_TEXT,
    );

    // And against the cap it outlines, since that is the other side of the line.
    const cap = await style(
      page,
      `#board-figure .board-key[data-finger="${finger}"] .board-cap`,
      'fill',
    );
    expect(
      contrastRatio(stroke, cap),
      `${finger} ${stroke} on its cap ${cap}`,
    ).toBeGreaterThanOrEqual(AA_NON_TEXT);
  }
});

test('the legend swatches clear the same threshold as the board itself', async ({ page }) => {
  for (const finger of FINGERS) {
    const swatch = await style(
      page,
      `#board-legend li[data-finger="${finger}"] .board-legend-swatch`,
      'background-color',
    );
    const behind = await style(
      page,
      `#board-legend li[data-finger="${finger}"]`,
      'background-color',
    );
    expect(
      contrastRatio(swatch, behind),
      `${finger} swatch ${swatch} on ${behind}`,
    ).toBeGreaterThanOrEqual(AA_NON_TEXT);
  }
});

test('cap labels meet AA against their caps, highlighted or not', async ({ page }) => {
  const ordinary = page
    .locator('#board-figure .board-key:not(.board-key-next) .board-label')
    .first();
  await expect(ordinary).toBeAttached();
  const ink = await ordinary.evaluate((element) => getComputedStyle(element).fill);
  const cap = await ordinary.evaluate(capFillBeside);
  expect(contrastRatio(ink, cap), `cap label ${ink} on ${cap}`).toBeGreaterThanOrEqual(AA_TEXT);

  const nextInk = await style(page, '#board-figure .board-key-next .board-label', 'fill');
  const nextCap = await style(page, '#board-figure .board-key-next .board-cap', 'fill');
  expect(
    contrastRatio(nextInk, nextCap),
    `highlighted cap label ${nextInk} on ${nextCap}`,
  ).toBeGreaterThanOrEqual(AA_TEXT);
});

test('the highlight itself is visible against the board surface', async ({ page }) => {
  const plate = await style(page, '#board-figure .board-plate', 'fill');
  const halo = await style(page, '#board-figure .board-halo', 'stroke');
  expect(contrastRatio(halo, plate), `highlight ${halo} on ${plate}`).toBeGreaterThanOrEqual(
    AA_NON_TEXT,
  );
});

test('the text around the board meets AA too', async ({ page }) => {
  await page.locator('#board-key-detail summary').click();

  for (const selector of ['#board-next', '#board-legend li', '#board-key-list li']) {
    const ink = await style(page, selector, 'color');
    const painted = await page.locator(selector).first().evaluate(paintedBackground);
    expect(contrastRatio(ink, painted), `${selector}: ${ink} on ${painted}`).toBeGreaterThanOrEqual(
      AA_TEXT,
    );
  }

  const chipInk = await style(page, '.board-key-list-cap', 'color');
  const chipBackground = await style(page, '.board-key-list-cap', 'background-color');
  expect(
    contrastRatio(chipInk, chipBackground),
    `key list cap ${chipInk} on ${chipBackground}`,
  ).toBeGreaterThanOrEqual(AA_TEXT);
});

test('names every finger in words, not by colour alone', async ({ page }) => {
  const legend = page.locator('#board-legend');
  for (const finger of FINGERS) {
    await expect(legend).toContainText(finger);
  }
  await expect(page.locator('#board-legend li')).toHaveCount(FINGERS.length);
});

test('says which key is highlighted in text, so colour is never the only channel', async ({
  page,
}) => {
  const readout = page.locator('#board-next');
  // The reference layout puts E on the left thumb; that is the fact the
  // highlighted cap shows, and it has to be readable without the picture.
  await expect(readout).toContainText('left thumb, lower arc');
  await expect(readout).toContainText('e');

  const highlighted = page.locator('#board-figure .board-key-next');
  await expect(highlighted).toHaveCount(1);
  await expect(highlighted).toHaveAttribute('data-position', '69');
});

test('states every key the diagram draws in words as well', async ({ page }) => {
  await page.locator('#board-key-detail summary').click();
  const items = page.locator('#board-key-list li');
  await expect(items).toHaveCount(80);

  const list = page.locator('#board-key-list');
  await expect(list).toContainText('left hand, pinky (outer reach), function row');
  await expect(list).toContainText('right thumb, lower arc');
  await expect(list).toContainText('a resting position');
});

test('is axe clean with the board on the page, open list and all', async ({ page }) => {
  await expectNoAxeViolations(page, 'the page with the board rendered');
  await page.locator('#board-key-detail summary').click();
  await expectNoAxeViolations(page, 'the page with every key listed');
});

test('scales instead of forcing the page sideways at 320 CSS pixels', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await expect(page.locator('#board-figure svg')).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'horizontal overflow with the board rendered').toBeLessThanOrEqual(1);

  const width = await page.locator('#board-figure svg').evaluate((element) => {
    const box = element.getBoundingClientRect();
    return box.width;
  });
  expect(width).toBeLessThanOrEqual(320);
});

test('removes the cap transition when reduced motion is asked for', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./');
  await loadReferenceLayout(page);

  const duration = await style(page, '#board-figure .board-cap', 'transition-duration');
  expect(Number.parseFloat(duration), `transition-duration was ${duration}`).toBeLessThanOrEqual(
    0.05,
  );
});
