import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

export const REFERENCE_LAYOUT_PATH = join(
  process.cwd(),
  'tests',
  'fixtures',
  'macos-maltron.glove80.json',
);

/** Fails with the offending nodes listed, so a violation is actionable. */
export async function expectNoAxeViolations(page: Page, context: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();

  const summary = results.violations.map(
    (violation) =>
      `${violation.id} (${violation.impact ?? 'unknown'}): ${violation.help}\n` +
      violation.nodes.map((node) => `    ${node.target.join(' ')}`).join('\n'),
  );

  expect(summary, `axe violations on ${context}`).toEqual([]);
}

export async function loadReferenceLayout(page: Page): Promise<void> {
  await page.setInputFiles('#layout-file', REFERENCE_LAYOUT_PATH);
  await expect(page.locator('#summary')).toBeVisible();
}
