import { expect, test } from '@playwright/test';
import { expectNoAxeViolations, loadReferenceLayout, REFERENCE_LAYOUT_PATH } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await page.goto('./');
});

test('reaches a usable page with no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await expect(page.getByRole('heading', { level: 1, name: 'Touchwright' })).toBeVisible();
  await expect(page.locator('#layout-file')).toBeVisible();
  expect(errors).toEqual([]);
});

test('reads the reference layout and says what it found', async ({ page }) => {
  await loadReferenceLayout(page);

  const summary = page.locator('#summary-list');
  await expect(summary).toContainText('macOS Maltron');
  await expect(summary).toContainText('en-GB-mac');
  await expect(summary).toContainText('a n i s f d t h o r');
  // The point of the layout, stated in words rather than shown only in colour.
  await expect(summary).toContainText('left thumb, lower arc');
  await expect(page.locator('#layout-error')).toBeHidden();
});

test('reports a file it cannot read without losing the page', async ({ page }) => {
  await page.setInputFiles('#layout-file', {
    name: 'broken.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{ not json'),
  });

  const error = page.getByRole('alert');
  await expect(error).toBeVisible();
  await expect(error).toContainText('not valid JSON');
  await expect(page.locator('#summary')).toBeHidden();

  // And it recovers: a good file after a bad one still works.
  await page.setInputFiles('#layout-file', REFERENCE_LAYOUT_PATH);
  await expect(page.locator('#summary')).toBeVisible();
  await expect(error).toBeHidden();
});

test('refuses a layout for a different keyboard, naming the problem', async ({ page }) => {
  await page.setInputFiles('#layout-file', {
    name: 'other.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({ keyboard: 'somethingelse', locale: 'en-GB-mac', layers: [[]] }),
    ),
  });
  await expect(page.getByRole('alert')).toContainText('somethingelse');
});

test('is axe clean before and after loading a layout', async ({ page }) => {
  await expectNoAxeViolations(page, 'the empty load page');
  await loadReferenceLayout(page);
  await expectNoAxeViolations(page, 'the page with a layout loaded');
});

test('can be driven from the keyboard alone', async ({ page }) => {
  // The skip link is the first thing focus reaches, as it must be.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();

  await page.keyboard.press('Tab');
  await expect(page.locator('#layout-file')).toBeFocused();
});

test('shows a visible focus ring on the file input', async ({ page }) => {
  await page.locator('#layout-file').focus();
  const outlineWidth = await page
    .locator('#layout-file')
    .evaluate((element) => getComputedStyle(element).outlineWidth);
  expect(Number.parseFloat(outlineWidth)).toBeGreaterThanOrEqual(2);
});
