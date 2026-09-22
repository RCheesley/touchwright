import { expect, test, type Page } from '@playwright/test';
import { NO_LIMIT, SPRINT_DURATIONS_MS } from '../../src/drill/limits.js';
import {
  expectedDrillText,
  expectNoAxeViolations,
  gotoApp,
  loadReferenceLayout,
  referenceLadder,
  expectedSprintText,
  sprintPrefix,
} from './helpers.js';

/**
 * Sprint mode in a real browser.
 *
 * Time is faked rather than waited for: `page.clock` freezes the page's own
 * clock, so a thirty second sprint takes no wall time and an untimed one can be
 * pushed an hour into the future between two assertions. Nothing here sleeps.
 *
 * The drill text is worked out the same way the app works it out, from the
 * pinned `?seed=` and the ladder the reference layout generates, so a change to
 * the generator fails these rather than being silently agreed with.
 */

/** Choose a duration and start a sprint with it. */
async function startSprint(page: Page, limitMs: number): Promise<void> {
  await page.locator('#sprint-duration').selectOption(String(limitMs));
  await page.getByRole('button', { name: 'Start sprint' }).click();
}

test('offers every duration the drill layer defines, untimed among them', async ({ page }) => {
  await gotoApp(page);
  await loadReferenceLayout(page);

  const options = page.locator('#sprint-duration option');
  await expect(options).toHaveCount(SPRINT_DURATIONS_MS.length);
  await expect(options.first()).toContainText('Untimed');
  // The setting is stated in visible text, not only implied by which option the
  // control happens to be showing. WCAG 2.2.1.
  await expect(page.locator('#sprint-setting')).toContainText('Current setting: 1 minute');
});

test('the limit is adjustable before the sprint starts, and says what it is', async ({ page }) => {
  await gotoApp(page);
  await loadReferenceLayout(page);

  await page.locator('#sprint-duration').selectOption('30000');
  await expect(page.locator('#sprint-setting')).toContainText('Current setting: 30 seconds');

  await page.locator('#sprint-duration').selectOption(String(NO_LIMIT));
  await expect(page.locator('#sprint-setting')).toContainText('untimed');
  await expect(page.locator('#sprint-setting')).toContainText('never run out');
});

test('the duration control is at least 24 by 24 CSS pixels', async ({ page }) => {
  await gotoApp(page);
  await loadReferenceLayout(page);

  for (const selector of ['#sprint-duration', '#sprint-start']) {
    const box = await page.locator(selector).boundingBox();
    expect(box?.width ?? 0, `${selector} width`).toBeGreaterThanOrEqual(24);
    expect(box?.height ?? 0, `${selector} height`).toBeGreaterThanOrEqual(24);
  }
});

test('runs a sprint across every unlocked key, not one lesson', async ({ page }) => {
  await gotoApp(page);
  await loadReferenceLayout(page);

  // The lesson drill is on screen first, and the sprint replaces it with a
  // different text built from the whole unlocked key set.
  await expect(page.locator('#drill-text')).toHaveText(expectedDrillText());
  await startSprint(page, 30_000);
  await expect(page.locator('#drill-text')).toHaveText(expectedSprintText(30_000));
  await expect(page.locator('#drill-text')).not.toHaveText(expectedDrillText());
});

test('shows a countdown while a timed sprint runs', async ({ page }) => {
  await page.clock.install();
  await gotoApp(page);
  await loadReferenceLayout(page);

  await startSprint(page, 60_000);
  const countdown = page.locator('#sprint-countdown');
  await expect(countdown).toBeVisible();
  await expect(countdown).toHaveText('Time left: 1:00');
  // It is a timer, whose implicit live setting is off: the number changes every
  // second and must never be announced.
  await expect(countdown).toHaveAttribute('role', 'timer');
  await expect(countdown).not.toHaveAttribute('aria-live', /.*/u);

  await page.keyboard.type(sprintPrefix(4, 60_000), { delay: 20 });
  await page.clock.fastForward(20_000);
  await expect(countdown).toHaveText('Time left: 0:40');
});

test('announces time running out politely, and not every second', async ({ page }) => {
  await page.clock.install();
  await gotoApp(page);
  await loadReferenceLayout(page);

  await startSprint(page, 60_000);
  const warning = page.locator('#sprint-warning');
  await expect(warning).toHaveAttribute('aria-live', 'polite');
  await expect(warning).toBeEmpty();

  await page.keyboard.type(sprintPrefix(4, 60_000), { delay: 20 });

  await page.clock.fastForward(30_000);
  await expect(warning).toContainText('30 seconds left');

  // Twenty more seconds pass and the region has moved on once, to the next
  // milestone, rather than having been rewritten twenty times.
  await page.clock.fastForward(20_000);
  await expect(warning).toContainText('10 seconds left');
});

test('a sprint earns no stars and says so, whatever the pace', async ({ page }) => {
  await page.clock.install();
  await gotoApp(page);
  await loadReferenceLayout(page);

  await startSprint(page, 30_000);
  await page.keyboard.type(sprintPrefix(20, 30_000), { delay: 15 });
  await page.clock.fastForward(31_000);

  await expect(page.locator('#drill-result-detail')).toContainText('none, this was not a lesson');
  await expect(page.locator('#ladder-list .ladder-rung').first()).toContainText('no stars yet');
});

test('abandoning a sprint for a lesson leaves no timer running', async ({ page }) => {
  await page.clock.install();
  await gotoApp(page);
  await loadReferenceLayout(page);

  const ladder = referenceLadder();
  const first = ladder[0];
  expect(first, 'the reference ladder should have a first lesson').toBeDefined();

  await startSprint(page, 30_000);
  await page.keyboard.type(sprintPrefix(3, 30_000), { delay: 20 });

  // Abandoned: back to the lesson, which is untimed.
  await page.getByRole('button', { name: `Practise ${first!.name}` }).click();
  await expect(page.locator('#drill-text')).toHaveText(expectedDrillText());
  await expect(page.locator('#sprint-countdown')).toBeHidden();

  await page.getByRole('button', { name: 'Start drill' }).click();
  // Long past the abandoned sprint's limit. The old timer must not be able to
  // reach this drill. Regression 3.
  await page.clock.fastForward(300_000);
  await expect(page.locator('#drill-result')).toBeHidden();

  // And the lesson runs all the way through, which is what used to be
  // impossible: every drill after an abandoned sprint died on its first key.
  await page.keyboard.type(expectedDrillText(), { delay: 20 });
  await expect(page.locator('#drill-result-summary')).toContainText('Drill complete');
});

test('is axe clean with a sprint on screen, and with its result', async ({ page }) => {
  await page.clock.install();
  await gotoApp(page);
  await loadReferenceLayout(page);

  await startSprint(page, 30_000);
  await expectNoAxeViolations(page, 'a running sprint');

  await page.keyboard.type(sprintPrefix(8, 30_000), { delay: 20 });
  await page.clock.fastForward(31_000);
  await expect(page.locator('#drill-result')).toBeVisible();
  await expectNoAxeViolations(page, 'a finished sprint');
});
