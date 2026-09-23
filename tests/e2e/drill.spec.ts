import { expect, test, type Page } from '@playwright/test';
import { AA_NON_TEXT, AA_TEXT, contrastRatio } from '../../src/ui/contrast.js';
import {
  expectNoAxeViolations,
  loadReferenceLayout,
  expectedDrillText,
  expectedKeyDescription,
  gotoApp,
  drillPrefix,
  drillCharAt,
  expectedKeyFinger,
  wrongKeyFor,
} from './helpers.js';

/**
 * The drill surface, in a real browser.
 *
 * Two of the prototype's failures can only be measured here. Regression 6 needs a
 * layout engine, because whether a word straddles two lines is a fact about
 * client rects and not about markup. Regression 8 needs a cascade, because only a
 * browser says what colour a button actually ends up. Both themes are covered by
 * the two Playwright projects, so everything here runs twice.
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

async function style(page: Page, selector: string, property: string): Promise<string> {
  const locator = page.locator(selector).first();
  await expect(locator, `expected ${selector} to be present`).toBeAttached();
  return locator.evaluate(
    (element, name) => getComputedStyle(element).getPropertyValue(name),
    property,
  );
}

/** One rect per line box, so a word on two lines reports two distinct tops. */
async function wordLines(page: Page): Promise<{ word: string; lines: number }[]> {
  return page.locator('#drill-text .drill-word').evaluateAll((elements) =>
    elements.map((element) => ({
      word: element.textContent,
      lines: new Set([...element.getClientRects()].map((rect) => Math.round(rect.top))).size,
    })),
  );
}

/** How many lines the whole paragraph takes, measured the same way. */
async function paragraphLines(page: Page): Promise<number> {
  return page
    .locator('#drill-text .drill-char')
    .evaluateAll(
      (elements) =>
        new Set(elements.map((element) => Math.round(element.getBoundingClientRect().top))).size,
    );
}

async function startDrill(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Start drill' }).click();
  await expect(page.locator('#drill-surface')).toHaveAttribute('data-captured', 'true');
}

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
  await loadReferenceLayout(page);
  await expect(page.locator('#drill-section')).toBeVisible();
});

test('takes printable keys with no input element anywhere on the surface', async ({ page }) => {
  await expect(page.locator('#drill-section').locator('input, textarea')).toHaveCount(0);
  await startDrill(page);

  await page.keyboard.type(drillPrefix(3));

  const marks = page.locator('#drill-text .drill-char');
  await expect(marks.nth(0)).toHaveAttribute('data-mark', 'correct');
  await expect(marks.nth(1)).toHaveAttribute('data-mark', 'correct');
  await expect(marks.nth(2)).toHaveAttribute('data-mark', 'correct');
  await expect(marks.nth(3)).toHaveAttribute('data-mark', 'pending');
  await expect(marks.nth(3)).toHaveAttribute('data-cursor', 'true');
});

test('distinguishes correct, wrong and pending by decoration, not only by colour', async ({
  page,
}) => {
  await startDrill(page);
  await page.keyboard.type(drillPrefix(1));
  await page.keyboard.type(wrongKeyFor(drillCharAt(1)));

  const decoration = async (mark: string, property: string): Promise<string> =>
    style(page, `#drill-text .drill-char[data-mark="${mark}"]`, property);

  // Correct is underlined, wrong is underlined differently, pending is not
  // underlined at all: three states, three shapes, before colour is considered.
  expect(await decoration('correct', 'text-decoration-line')).toContain('underline');
  expect(await decoration('correct', 'text-decoration-style')).toBe('solid');
  expect(await decoration('wrong', 'text-decoration-line')).toContain('underline');
  expect(await decoration('wrong', 'text-decoration-style')).toBe('wavy');
  expect(Number.parseInt(await decoration('wrong', 'font-weight'), 10)).toBeGreaterThanOrEqual(700);
  expect(await decoration('pending', 'text-decoration-line')).toBe('none');

  // And the colours are still distinct, because reinforcement is not redundancy.
  const inks = await Promise.all(
    ['correct', 'wrong', 'pending'].map((mark) => decoration(mark, 'color')),
  );
  expect(new Set(inks).size).toBe(3);
});

test('every character on the drill surface meets AA against the surface', async ({ page }) => {
  await startDrill(page);
  await page.keyboard.type(drillPrefix(1) + wrongKeyFor(drillCharAt(1)));

  for (const mark of ['correct', 'wrong', 'pending']) {
    const selector = `#drill-text .drill-char[data-mark="${mark}"]:not([data-cursor])`;
    const ink = await style(page, selector, 'color');
    const behind = await page.locator(selector).first().evaluate(paintedBackground);
    expect(contrastRatio(ink, behind), `${mark} text ${ink} on ${behind}`).toBeGreaterThanOrEqual(
      AA_TEXT,
    );
  }

  const cursorInk = await style(page, '#drill-text .drill-char[data-cursor="true"]', 'color');
  const cursorBackground = await style(
    page,
    '#drill-text .drill-char[data-cursor="true"]',
    'background-color',
  );
  expect(
    contrastRatio(cursorInk, cursorBackground),
    `the cursor ${cursorInk} on ${cursorBackground}`,
  ).toBeGreaterThanOrEqual(AA_TEXT);
});

test('names the next key in words, and only then highlights it on the board', async ({ page }) => {
  await startDrill(page);

  // The readout is the primary channel: hand, finger and row, in words.
  await expect(page.locator('#drill-next')).toContainText(
    expectedKeyDescription([...expectedDrillText()][0] ?? 'a'),
  );
  // The board says the same thing in text, and the highlight follows it.
  await expect(page.locator('#board-next')).toContainText(
    expectedKeyDescription([...expectedDrillText()][0] ?? 'a'),
  );
  const highlighted = page.locator('#board-figure .board-key-next');
  await expect(highlighted).toHaveCount(1);
  await expect(highlighted).toHaveAttribute('data-finger', expectedKeyFinger(drillCharAt(0)));

  await page.keyboard.type(drillPrefix(1));
  await expect(page.locator('#drill-next')).toContainText(expectedKeyDescription(drillCharAt(1)));
  await expect(page.locator('#board-figure .board-key-next')).toHaveAttribute(
    'data-finger',
    expectedKeyFinger(drillCharAt(1)),
  );
});

test('gives the surface an accessible name and a description naming the next key', async ({
  page,
}) => {
  await startDrill(page);
  const surface = page.locator('#drill-surface');
  await expect(surface).toHaveAttribute('aria-label', 'Drill text');

  const description = await surface.evaluate((element) => {
    const ids = (element.getAttribute('aria-describedby') ?? '').split(/\s+/);
    return ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
  });

  expect(description).toContain(expectedKeyDescription(drillCharAt(0)));
  // How to escape is part of the description, and it is visible text as well.
  expect(description).toContain('Escape');
  await expect(page.locator('#drill-escape')).toBeVisible();
});

test('shows the result at the end, with the next step named', async ({ page }) => {
  await startDrill(page);
  await page.keyboard.type(expectedDrillText(), { delay: 20 });

  const result = page.locator('#drill-result');
  await expect(result).toBeVisible();
  await expect(page.locator('#drill-result-summary')).toContainText('Drill complete');
  await expect(page.locator('#drill-result-summary')).toContainText('words per minute');
  await expect(page.locator('#drill-result-detail')).toContainText('stars of 3');
  await expect(page.locator('#drill-result-why')).not.toBeEmpty();
  // The next step's own words, from scoring, on a real button.
  await expect(page.locator('#drill-continue')).not.toBeEmpty();

  const ink = await style(page, '#drill-result-summary', 'color');
  const behind = await page.locator('#drill-result-summary').evaluate(paintedBackground);
  expect(contrastRatio(ink, behind), `result ${ink} on ${behind}`).toBeGreaterThanOrEqual(AA_TEXT);
});

/**
 * Regression 8. The prototype shipped an outline button that rendered white on
 * white, because a theme rule outranked the button's own colour. The maths is
 * unit-tested; this is the half only a browser can answer.
 */
test('both button variants meet AA against their real backgrounds', async ({ page }) => {
  for (const selector of ['.button-solid', '.button-outline']) {
    const locator = page.locator(selector).first();
    await expect(locator, `${selector} is not on the page to measure`).toBeVisible();

    const ink = await locator.evaluate((element) => getComputedStyle(element).color);
    const background = await locator.evaluate(paintedBackground);
    expect(
      contrastRatio(ink, background),
      `${selector}: ${ink} on ${background}`,
    ).toBeGreaterThanOrEqual(AA_TEXT);

    // The exact shape of the original bug, stated directly.
    expect(contrastRatio(ink, background), `${selector} is invisible`).toBeGreaterThan(1.5);

    // And its edge has to be findable against whatever is behind the button.
    const border = await locator.evaluate((element) => getComputedStyle(element).borderTopColor);
    const behind = await locator.evaluate(
      (element) => getComputedStyle(element.parentElement ?? document.body).backgroundColor,
    );
    expect(
      contrastRatio(border, behind),
      `${selector} border ${border} on ${behind}`,
    ).toBeGreaterThanOrEqual(AA_NON_TEXT);
  }
});

/**
 * Regression 6. Measured from client rects at each width, because the failure was
 * a word broken across two lines and that is not visible in the markup.
 */
test('keeps every word on one line at 320 CSS pixels', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await startDrill(page);

  // The check is only worth anything if the paragraph actually wraps here.
  expect(await paragraphLines(page), 'the drill text fits on one line at 320px').toBeGreaterThan(1);

  const words = await wordLines(page);
  expect(words.length).toBeGreaterThan(1);
  for (const { word, lines } of words) {
    expect(lines, `"${word}" was broken across ${lines} lines at 320 CSS pixels`).toBe(1);
  }

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'horizontal overflow with the drill on the page').toBeLessThanOrEqual(1);
});

test('keeps every word on one line at 600 and 1200 CSS pixels', async ({ page }) => {
  for (const width of [600, 1200]) {
    await page.setViewportSize({ width, height: 800 });
    await gotoApp(page);
    await loadReferenceLayout(page);
    await startDrill(page);

    const words = await wordLines(page);
    expect(words.length).toBeGreaterThan(1);
    for (const { word, lines } of words) {
      expect(lines, `"${word}" was broken across ${lines} lines at ${width} CSS pixels`).toBe(1);
    }
  }
});

test('is axe clean with the drill running and with the result showing', async ({ page }) => {
  await expectNoAxeViolations(page, 'the page with the drill surface ready');
  await startDrill(page);
  await page.keyboard.type(drillPrefix(3));
  await expectNoAxeViolations(page, 'the page with a drill in progress');

  await page.keyboard.type(expectedDrillText().slice(3), { delay: 20 });
  await expect(page.locator('#drill-result')).toBeVisible();
  await expectNoAxeViolations(page, 'the page with a result showing');
});

test('animates nothing on the drill surface when reduced motion is asked for', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await gotoApp(page);
  await loadReferenceLayout(page);
  await startDrill(page);
  await page.keyboard.type('a');

  const moving = await page.locator('#drill-section *').evaluateAll((elements) =>
    elements
      .map((element) => {
        const computed = getComputedStyle(element);
        return {
          what: `${element.tagName.toLowerCase()}#${element.id}.${[...element.classList].join('.')}`,
          transition: Math.max(
            ...computed.transitionDuration.split(',').map((value) => Number.parseFloat(value) || 0),
          ),
          animation: Math.max(
            ...computed.animationDuration.split(',').map((value) => Number.parseFloat(value) || 0),
          ),
        };
      })
      .filter((entry) => entry.transition > 0.05 || entry.animation > 0.05),
  );

  expect(moving, 'these still move under prefers-reduced-motion').toEqual([]);

  // And a mark lands at once even without that media query, because a fading
  // character lags the typist and drops its own contrast while it fades.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const duration = await style(page, '#drill-text .drill-char', 'transition-duration');
  expect(Number.parseFloat(duration), `transition-duration was ${duration}`).toBeLessThanOrEqual(
    0.05,
  );
});

test('the keyboard takes the same offer the button shows, not a fresh drill', async ({ page }) => {
  // The result card can offer the next lesson or a repair drill. Pressing a key
  // to continue used to go straight to "start this drill again", which silently
  // threw that offer away -- a button saying one thing and the keyboard doing
  // another is the same failure as a button that lies.
  await startDrill(page);
  await page.keyboard.type(expectedDrillText(), { delay: 15 });
  await expect(page.locator('#drill-result')).toBeVisible();

  // Typed cleanly and briskly, so this earns the advance rather than a repair.
  await expect(page.locator('#drill-continue')).toContainText('Start');
  const firstDrill = await page.locator('#drill-text').innerText();

  // Past the grace period that stops an overrun keystroke skipping the result
  // before it has been read -- regression 4, which refuses the key until then.
  await page.waitForTimeout(600);

  // Any key continues. It must do what the button says.
  await page.keyboard.press('Enter');
  await expect(page.locator('#drill-result')).toBeHidden();

  // The next lesson was offered, so the text must be the next lesson's.
  await expect(page.locator('#drill-text')).not.toHaveText(firstDrill);
});
