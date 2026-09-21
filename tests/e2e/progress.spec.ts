import { mkdtempSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Download, type Page } from '@playwright/test';
import {
  expectNoAxeViolations,
  loadReferenceLayout,
  REFERENCE_LAYOUT_PATH,
  expectedDrillText,
  gotoApp,
  drillPrefix,
  drillCharAt,
  expectedKeyFinger,
  expectedKeyHand,
  wrongKeyFor,
} from './helpers.js';

/**
 * The ladder, the statistics, and export and import, in a real browser, in both
 * themes.
 *
 * What is here rather than in the functional suite: the download itself, which no
 * amount of jsdom will produce; axe over the new views; target sizes and focus
 * rings, which need computed styles; and the journeys that cross a reload or a
 * second browser context.
 */

const DATED_EXPORT = /^touchwright-progress-\d{4}-\d{2}-\d{2}\.json$/;

/** Start the drill and type it through cleanly, at a pace worth three stars. */
async function earnThreeStars(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Start drill' }).click();
  // A delay, so the drill has a measurable pace rather than an unmeasurable one.
  await page.keyboard.type(expectedDrillText(), { delay: 20 });
  await expect(page.locator('#drill-result')).toBeVisible();
  await expect(page.locator('#drill-result-detail')).toContainText('3 stars of 3');
}

function firstRung(page: Page) {
  return page.locator('#ladder-list .ladder-rung').first();
}

/** Click export and hand back the download the browser produced. */
async function exportProgress(page: Page): Promise<Download> {
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export progress' }).click();
  return downloading;
}

test.describe('the ladder', () => {
  test('shows every lesson, which are unlocked, and the stars earned', async ({ page }) => {
    await gotoApp(page);
    await loadReferenceLayout(page);

    const rungs = page.locator('#ladder-list .ladder-rung');
    await expect(rungs).toHaveCount(13);
    await expect(rungs.first()).toContainText('Home keys');
    await expect(rungs.first()).toContainText('no stars yet');
    await expect(rungs.first()).toHaveAttribute('data-state', 'current');

    // A locked rung says what unlocks it, which is the only channel that works
    // for someone who cannot see that its edge is dashed.
    await expect(rungs.nth(1)).toHaveAttribute('data-state', 'locked');
    await expect(rungs.nth(1)).toContainText('Earn 2 stars on Home keys');
    await expect(page.locator('#ladder-list button')).toHaveCount(1);

    await earnThreeStars(page);

    await expect(firstRung(page)).toContainText('3 stars of 3');
    await expect(rungs.nth(1)).not.toHaveAttribute('data-state', 'locked');
    await expect(page.locator('#ladder-list button')).toHaveCount(2);
  });

  test('returns to an earlier lesson from the ladder', async ({ page }) => {
    await gotoApp(page);
    await loadReferenceLayout(page);
    await earnThreeStars(page);

    // Move on to the rung that has just unlocked, then come back down.
    await page.getByRole('button', { name: 'Practise The left thumb' }).click();
    await expect(page.locator('#ladder-current')).toContainText('The left thumb');
    await expect(page.locator('#ladder-list .ladder-rung').nth(1)).toHaveAttribute(
      'data-state',
      'current',
    );

    await page.getByRole('button', { name: 'Practise Home keys' }).click();
    await expect(page.locator('#ladder-current')).toContainText('Home keys');
    await expect(firstRung(page)).toHaveAttribute('data-state', 'current');
    // Choosing a lesson leaves focus on a control that can be used straight away.
    await expect(page.locator('#drill-start')).toBeFocused();
  });

  test('keeps every control at least 24 by 24 CSS pixels', async ({ page }) => {
    await gotoApp(page);
    await loadReferenceLayout(page);

    const small = await page
      .locator('#ladder-section button, #progress-section button, #progress-section input')
      .evaluateAll((elements) =>
        elements
          .map((element) => {
            const box = element.getBoundingClientRect();
            return { what: element.id || element.textContent, w: box.width, h: box.height };
          })
          .filter((entry) => entry.w < 24 || entry.h < 24),
      );
    expect(small, 'these controls are below the 24 by 24 minimum').toEqual([]);
  });

  test('shows a visible focus ring on a ladder button', async ({ page }) => {
    await gotoApp(page);
    await loadReferenceLayout(page);

    const practise = page.getByRole('button', { name: 'Practise Home keys again' });
    await practise.focus();
    const width = await practise.evaluate((element) => getComputedStyle(element).outlineWidth);
    expect(Number.parseFloat(width)).toBeGreaterThanOrEqual(2);
  });
});

test.describe('the statistics', () => {
  test('groups the keys that slip by finger and row, in words as well as colour', async ({
    page,
  }) => {
    await gotoApp(page);
    await loadReferenceLayout(page);
    await page.getByRole('button', { name: 'Start drill' }).click();

    // Type the drill, fumbling the third key four times before getting it right.
    // Which key that is depends on the generated drill, so what it is called and
    // which finger owns it are both derived rather than assumed -- the point of
    // the test is that the report names a finger, a row and the key itself.
    const fumbled = drillCharAt(2);
    await page.keyboard.type(drillPrefix(2), { delay: 20 });
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await page.keyboard.press(wrongKeyFor(fumbled));
      await page.keyboard.press('Backspace');
    }
    await page.keyboard.type(expectedDrillText().slice(2), { delay: 20 });
    await expect(page.locator('#drill-result')).toBeVisible();

    const weak = page.locator('#stats-weak');
    await expect(weak).toContainText(`${expectedKeyHand(fumbled)} ${expectedKeyFinger(fumbled)}`);
    await expect(weak).toContainText('presses missed');
    await expect(weak).toContainText(`“${fumbled}”`);

    // The band is a word, and the bar next to it is decoration with the same
    // number written out beside it.
    const band = weak.locator('.stats-band').first();
    await expect(band).not.toBeEmpty();
    await expect(weak.locator('.stats-bar').first()).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('#stats-summary')).toContainText('finger');
  });

  test('says plainly that nothing has been recorded before anything has', async ({ page }) => {
    await gotoApp(page);
    await loadReferenceLayout(page);

    await expect(page.locator('#stats-summary')).toContainText('Nothing recorded yet');
    await expect(page.locator('#stats-weak')).toContainText('Finish a drill');
  });
});

test.describe('keeping progress', () => {
  test('downloads an export even when the page is served from a subpath', async ({ page }) => {
    await gotoApp(page);
    await loadReferenceLayout(page);
    await earnThreeStars(page);

    // The deployed site lives at /touchwright/, so anything the export resolves
    // relative to the page would point at the wrong place. Pushing a deeper path
    // reproduces that without a second server: an object URL does not care.
    await page.evaluate(() => {
      history.replaceState(null, '', 'touchwright/deep/page');
    });
    expect(new URL(page.url()).pathname).toContain('/touchwright/deep/');

    const download = await exportProgress(page);
    expect(download.suggestedFilename()).toMatch(DATED_EXPORT);

    const saved = join(mkdtempSync(join(tmpdir(), 'touchwright-')), 'progress.json');
    await download.saveAs(saved);
    const parsed = JSON.parse(await readFile(saved, 'utf8')) as { stars: Record<string, number> };
    expect(parsed.stars['home']).toBe(3);
    await expect(page.locator('#progress-status')).toContainText('Exported');
  });

  test('imports an exported file into a fresh browser', async ({ page, browser }) => {
    await gotoApp(page);
    await loadReferenceLayout(page);
    await earnThreeStars(page);

    const download = await exportProgress(page);
    const saved = join(mkdtempSync(join(tmpdir(), 'touchwright-')), 'progress.json');
    await download.saveAs(saved);

    // A separate context is a separate browser as far as storage is concerned:
    // nothing is shared, so this is the "new machine" case.
    const fresh = await browser.newContext();
    try {
      const other = await fresh.newPage();
      await other.goto(page.url().replace(/[^/]*$/, ''));
      await other.locator('#layout-file').setInputFiles(REFERENCE_LAYOUT_PATH);
      await expect(other.locator('#ladder-list .ladder-rung').first()).toContainText(
        'no stars yet',
      );

      await other.locator('#progress-import').setInputFiles(saved);
      await expect(other.locator('#progress-status')).toContainText('Imported progress.json');
      await expect(other.locator('#ladder-list .ladder-rung').first()).toContainText(
        '3 stars of 3',
      );

      // And it is saved in that browser too, so its own next reload keeps it.
      await other.reload();
      await other.locator('#layout-file').setInputFiles(REFERENCE_LAYOUT_PATH);
      await expect(other.locator('#ladder-list .ladder-rung').first()).toContainText(
        '3 stars of 3',
      );
    } finally {
      await fresh.close();
    }
  });

  test('reports what a partly unreadable import dropped, rather than refusing it', async ({
    page,
  }) => {
    await gotoApp(page);
    await loadReferenceLayout(page);

    await page.locator('#progress-import').setInputFiles({
      name: 'partial.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          version: 99,
          lesson: 1,
          xp: 140,
          stars: { home: 3 },
          keyStats: {
            cp112: { hits: 9, misses: 3, totalMs: 900, samples: 9 },
            'not-a-key': { hits: 4, misses: 1, totalMs: 0, samples: 0 },
          },
        }),
      ),
    });

    // Kept: the usable parts arrived.
    await expect(page.locator('#progress-status')).toContainText('Imported partial.json');
    await expect(firstRung(page)).toContainText('3 stars of 3');
    await expect(page.locator('#stats-totals')).toContainText('140 XP');

    // And dropped: named item by item, not silently lost.
    const report = page.locator('#progress-report');
    await expect(report).toBeVisible();
    await expect(report).toContainText('version 99');
    await expect(report).toContainText('not-a-key');
    await expect(page.locator('#progress-error')).toBeHidden();
  });

  test('refuses a file that is not JSON, and keeps the progress it has', async ({ page }) => {
    await gotoApp(page);
    await loadReferenceLayout(page);
    await earnThreeStars(page);

    await page.locator('#progress-import').setInputFiles({
      name: 'broken.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{ not json'),
    });

    const error = page.locator('#progress-error');
    await expect(error).toBeVisible();
    await expect(error).toContainText('not valid JSON');
    // Nothing was lost by trying.
    await expect(firstRung(page)).toContainText('3 stars of 3');
  });

  test('clears saved progress only after a second, deliberate go', async ({ page }) => {
    await gotoApp(page);
    await loadReferenceLayout(page);
    await earnThreeStars(page);

    const clear = page.getByRole('button', { name: 'Clear saved progress' });
    await clear.click();
    await expect(page.locator('#progress-status')).toContainText('cannot be undone');
    // Armed, not done.
    await expect(firstRung(page)).toContainText('3 stars of 3');

    await page.getByRole('button', { name: 'Really clear saved progress' }).click();
    await expect(page.locator('#progress-status')).toContainText('cleared');
    await expect(firstRung(page)).toContainText('no stars yet');
    await expect(page.locator('#stats-summary')).toContainText('Nothing recorded yet');
  });
});

test.describe('the accessibility of the new views', () => {
  test('is axe clean with the ladder, the statistics and a result on the page', async ({
    page,
  }) => {
    await gotoApp(page);
    await loadReferenceLayout(page);
    await expectNoAxeViolations(page, 'the ladder and statistics before any drill');

    await earnThreeStars(page);
    await expectNoAxeViolations(page, 'the ladder and statistics after a drill');
  });

  test('animates nothing in these views when reduced motion is asked for', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await gotoApp(page);
    await loadReferenceLayout(page);
    await earnThreeStars(page);

    const moving = await page
      .locator('#ladder-section *, #stats-section *, #progress-section *')
      .evaluateAll((elements) =>
        elements
          .map((element) => {
            const computed = getComputedStyle(element);
            const longest = (value: string): number =>
              Math.max(...value.split(',').map((part) => Number.parseFloat(part) || 0));
            return {
              what: `${element.tagName.toLowerCase()}#${element.id}.${[...element.classList].join('.')}`,
              transition: longest(computed.transitionDuration),
              animation: longest(computed.animationDuration),
            };
          })
          .filter((entry) => entry.transition > 0.05 || entry.animation > 0.05),
      );

    expect(moving, 'these still move under prefers-reduced-motion').toEqual([]);
  });

  test('drives the ladder and the export controls from the keyboard alone', async ({ page }) => {
    await gotoApp(page);
    // Choosing the layout file is the one step a test cannot do with keystrokes.
    await page.locator('#layout-file').setInputFiles(REFERENCE_LAYOUT_PATH);
    await expect(page.locator('#ladder-section')).toBeVisible();

    // The ladder button takes focus and is activated by Enter, which is all a
    // keyboard learner needs to drop back to an earlier lesson.
    const practise = page.getByRole('button', { name: 'Practise Home keys again' });
    await practise.focus();
    await expect(practise).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#ladder-current')).toContainText('Home keys');
    await expect(page.locator('#drill-start')).toBeFocused();

    // Export, clear and import are three consecutive tab stops, in that order.
    await page.locator('#progress-export').focus();
    await page.keyboard.press('Tab');
    await expect(page.locator('#progress-clear')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('#progress-import')).toBeFocused();

    // Shift+Tab goes back the other way, so focus is not one-directional either.
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('#progress-clear')).toBeFocused();
  });
});
