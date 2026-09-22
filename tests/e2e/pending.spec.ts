import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  DRILL_SEED,
  REFERENCE_LAYOUT_PATH,
  drillPrefix,
  expectedDrillText,
  expectedKeyDescription,
  gotoApp,
  loadReferenceLayout,
  referenceLadder,
} from './helpers.js';
import { sprintLesson, sprintWordCount } from '../../src/drill/sprint.js';
import { generateDrillText } from '../../src/drill/text.js';
import type { Page } from '@playwright/test';

/**
 * The text a sprint will drill, worked out the way the app works it out: the
 * pinned seed, and the whole key set unlocked so far. With no saved progress
 * that is the first rung, so this is the ladder's first lesson's keys rather
 * than its text.
 */
function expectedSprintText(limitMs: number): string {
  return generateDrillText(sprintLesson(referenceLadder(), 0), {
    seed: DRILL_SEED,
    words: sprintWordCount(limitMs),
  });
}

function sprintPrefix(count: number, limitMs: number): string {
  return [...expectedSprintText(limitMs)].slice(0, count).join('');
}

/**
 * Tab forward until the element with this id has focus, returning every stop on
 * the way so a failure says where focus actually went. Out here rather than in a
 * test body because it is a loop, and because every caller needs the same bound.
 */
async function tabUntil(page: Page, id: string, limit = 8): Promise<readonly string[]> {
  const stops: string[] = [];
  for (let tabs = 0; tabs < limit && stops.at(-1) !== id; tabs += 1) {
    await page.keyboard.press('Tab');
    stops.push(await page.evaluate(() => document.activeElement?.id ?? 'unnamed'));
  }
  return stops;
}

/** The rungs of the generated ladder, in order. */
function rungs(page: Page) {
  return page.locator('#ladder-list .ladder-rung');
}

/** Type the whole drill through cleanly, at a pace worth three stars. */
async function earnThreeStars(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Start drill' }).click();
  // A delay, so the drill has a measurable pace rather than an unmeasurable one.
  await page.keyboard.type(expectedDrillText(), { delay: 20 });
  await expect(page.locator('#drill-result')).toBeVisible();
  await expect(rungs(page).first()).toContainText('3 stars of 3');
}

/**
 * The end-to-end journeys the brief requires, named now so they are tracked, and
 * marked fixme until the features they cover exist. Each one is filled in as its
 * feature lands.
 *
 * The three the drill surface unblocked are live. The rest still have no
 * assertions by design -- there is nothing yet to assert against -- so the rule
 * that looks for them is turned off here and nowhere else.
 */
/* eslint-disable playwright/expect-expect */

test.describe('the trainer journeys', () => {
  test('completes a lesson from start to finish', async ({ page }) => {
    await gotoApp(page);
    await loadReferenceLayout(page);

    await page.getByRole('button', { name: 'Start drill' }).click();
    await expect(page.locator('#drill-next')).toContainText(
      expectedKeyDescription([...expectedDrillText()][0] ?? 'a'),
    );

    // A delay, so the drill has a measurable pace rather than an unmeasurable one.
    await page.keyboard.type(expectedDrillText(), { delay: 20 });

    await expect(page.locator('#drill-result')).toBeVisible();
    await expect(page.locator('#drill-result-summary')).toContainText('Drill complete');
    await expect(page.locator('#drill-result-detail')).toContainText('words per minute');
    // Every character was typed correctly, so the whole text is marked correct.
    await expect(page.locator('#drill-text .drill-char[data-mark="correct"]')).toHaveCount(
      [...expectedDrillText()].length,
    );
    await expect(page.locator('#drill-text .drill-char[data-mark="wrong"]')).toHaveCount(0);
    // And the next step is named, in scoring's words, on a button.
    await expect(page.locator('#drill-continue')).not.toBeEmpty();
  });

  test('earns two stars and advances to the next lesson', async ({ page }) => {
    await gotoApp(page);
    await loadReferenceLayout(page);

    const ladder = referenceLadder();
    const first = ladder[0];
    const second = ladder[1];
    expect(first, 'the reference ladder should have a first lesson').toBeDefined();
    expect(second, 'the reference ladder should have a second lesson').toBeDefined();

    // The ladder starts with only the first rung reachable.
    const rungs = page.locator('#ladder-list li');
    await expect(rungs.first()).toContainText(first!.name);

    await page.getByRole('button', { name: 'Start drill' }).click();
    // Typed correctly and briskly: well past the two-star thresholds, which are
    // 95 per cent accuracy at 18 words per minute.
    await page.keyboard.type(expectedDrillText(), { delay: 15 });

    await expect(page.locator('#drill-result')).toBeVisible();
    await expect(page.locator('#drill-result-detail')).toContainText('stars of 3');

    // Two stars or better names the next rung, on the button and in the reason.
    const advance = page.locator('#drill-continue');
    await expect(advance).toContainText(second!.name);
    await expect(page.locator('#drill-result-why')).not.toBeEmpty();

    // And taking it actually moves the drill on to that lesson, rather than
    // restarting this one under a button that named the next.
    await advance.click();
    await expect(page.locator('#drill-text')).toHaveText(expectedDrillText(1));
    await expect(page.locator('#drill-text')).not.toHaveText(expectedDrillText(0));
  });

  test.fixme('builds a repair drill from exactly the keys that were missed', () => {});

  test('runs a sprint to its limit, and offers an untimed option', async ({ page }) => {
    // The page's own clock is faked, so a thirty second sprint costs no wall
    // time and an untimed one can be pushed an hour ahead between assertions.
    await page.clock.install();
    await gotoApp(page);
    await loadReferenceLayout(page);

    // The limit is adjustable before the sprint starts, and the setting is
    // stated in visible text rather than only shown as a selected option.
    await page.locator('#sprint-duration').selectOption('30000');
    await expect(page.locator('#sprint-setting')).toContainText('Current setting: 30 seconds');
    await page.getByRole('button', { name: 'Start sprint' }).click();

    // A sprint runs across every unlocked key, so it is not the lesson's text.
    await expect(page.locator('#drill-text')).toHaveText(expectedSprintText(30_000));
    await expect(page.locator('#sprint-countdown')).toHaveText('Time left: 0:30');

    await page.keyboard.type(sprintPrefix(12, 30_000), { delay: 20 });
    await page.clock.fastForward(31_000);

    // It ran to its limit, and the result says it was a sprint rather than a
    // lesson: different wording, and the kind of drill named outright.
    await expect(page.locator('#drill-result')).toBeVisible();
    await expect(page.locator('#drill-result-summary')).toContainText('Sprint over, time up');
    await expect(page.locator('#drill-result-detail')).toContainText(
      'sprint across every unlocked key',
    );
    await expect(page.locator('#drill-result-detail')).toContainText('the time limit ran out');

    // And the untimed option is genuinely untimed.
    await page.locator('#sprint-duration').selectOption('0');
    await expect(page.locator('#sprint-setting')).toContainText('untimed');
    await page.getByRole('button', { name: 'Start sprint' }).click();
    await expect(page.locator('#sprint-countdown')).toContainText('no time limit');

    await page.keyboard.type(sprintPrefix(4, 0), { delay: 20 });
    // An hour later, with no keystroke in between, it has still not expired.
    await page.clock.fastForward('01:00:00');
    await expect(page.locator('#drill-result')).toBeHidden();
    await expect(page.locator('#sprint-countdown')).toContainText('no time limit');

    // And it is still typeable after all that time, rather than quietly dead.
    await page.keyboard.type(sprintPrefix(8, 0).slice(4), { delay: 20 });
    await expect(page.locator('#drill-text .drill-char[data-mark="correct"]')).toHaveCount(8);
  });

  test('keeps progress across a reload', async ({ page }) => {
    await gotoApp(page);
    await loadReferenceLayout(page);
    await earnThreeStars(page);

    await page.reload();

    // The layout is a file on the learner's own disk, so it is chosen again. The
    // progress is not chosen again: it is simply still there.
    await loadReferenceLayout(page);

    await expect(rungs(page).first()).toContainText('3 stars of 3');
    await expect(rungs(page).nth(1)).not.toHaveAttribute('data-state', 'locked');
    await expect(page.locator('#stats-summary')).not.toContainText('Nothing recorded yet');
    // The per-key statistics came back too, grouped by finger and row.
    await expect(page.locator('#stats-weak')).toContainText('finger');
  });

  test('exports progress, clears storage, and imports it back', async ({ page }) => {
    await gotoApp(page);
    await loadReferenceLayout(page);
    await earnThreeStars(page);

    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export progress' }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(/^touchwright-progress-\d{4}-\d{2}-\d{2}\.json$/);

    const saved = join(mkdtempSync(join(tmpdir(), 'touchwright-e2e-')), 'progress.json');
    await download.saveAs(saved);

    // Clearing takes two deliberate goes, because it cannot be undone.
    await page.getByRole('button', { name: 'Clear saved progress' }).click();
    await page.getByRole('button', { name: 'Really clear saved progress' }).click();
    await page.reload();
    await loadReferenceLayout(page);
    await expect(rungs(page).first()).toContainText('no stars yet');
    await expect(rungs(page).nth(1)).toHaveAttribute('data-state', 'locked');

    await page.locator('#progress-import').setInputFiles(saved);

    await expect(page.locator('#progress-status')).toContainText('Imported progress.json');
    await expect(rungs(page).first()).toContainText('3 stars of 3');
    await expect(rungs(page).nth(1)).not.toHaveAttribute('data-state', 'locked');
    await expect(page.locator('#progress-error')).toBeHidden();

    // And the import was saved as well as applied, so it survives the next reload.
    await page.reload();
    await loadReferenceLayout(page);
    await expect(rungs(page).first()).toContainText('3 stars of 3');
  });

  test('completes a drill without ever touching the mouse', async ({ page }) => {
    await gotoApp(page);
    // Choosing the file is the one step a test cannot do with keystrokes; from
    // here on nothing but the keyboard is used, and no click is ever issued.
    await page.locator('#layout-file').setInputFiles(REFERENCE_LAYOUT_PATH);
    await expect(page.locator('#drill-section')).toBeVisible();

    // Tab through the page to the start button. The skip link comes first, as it
    // must, and the drill is reachable from there without a single click.
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('#layout-file')).toBeFocused();

    const stops = await tabUntil(page, 'drill-start');
    expect(stops.at(-1), `tab stops after the file input were ${stops.join(', ')}`).toBe(
      'drill-start',
    );
    await page.keyboard.press('Enter');

    await expect(page.locator('#drill-surface')).toBeFocused();
    await expect(page.locator('#drill-surface')).toHaveAttribute('data-captured', 'true');

    await page.keyboard.type(expectedDrillText(), { delay: 20 });

    await expect(page.locator('#drill-result')).toBeVisible();
    await expect(page.locator('#drill-result-summary')).toContainText('Drill complete');
  });

  test('releases keyboard capture on Escape and restores tab navigation', async ({ page }) => {
    await gotoApp(page);
    await loadReferenceLayout(page);
    await page.getByRole('button', { name: 'Start drill' }).click();

    await page.keyboard.type(drillPrefix(3));
    await expect(page.locator('#drill-surface')).toHaveAttribute('data-captured', 'true');
    await expect(page.locator('#drill-text .drill-char[data-mark="correct"]')).toHaveCount(3);

    await page.keyboard.press('Escape');

    // Released, said so in visible text, and focus is on a real control.
    await expect(page.locator('#drill-surface')).toHaveAttribute('data-captured', 'false');
    await expect(page.locator('#drill-capture')).toContainText('Keyboard released');
    await expect(page.locator('#drill-capture')).toContainText('Tab');
    await expect(page.locator('#drill-start')).toBeFocused();

    // Tab moves through the page as usual, from there onwards.
    await page.keyboard.press('Tab');
    await expect(page.locator('#drill-reset')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('#drill-surface')).toBeFocused();
    // Shift+Tab goes back the other way, so focus is not one-directional either.
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('#drill-reset')).toBeFocused();

    // And while the keyboard is released, printable keys do not reach the drill.
    await page.keyboard.press('t');
    await expect(page.locator('#drill-text .drill-char[data-mark="correct"]')).toHaveCount(3);

    // The drill is still exactly where it was, and resuming carries on from there.
    await page.locator('#drill-start').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#drill-surface')).toHaveAttribute('data-captured', 'true');
    await page.keyboard.type(' ');
    await expect(page.locator('#drill-text .drill-char[data-mark="correct"]')).toHaveCount(4);
  });

  test.fixme('announces the current word and the result, but not every keystroke', () => {});
});
