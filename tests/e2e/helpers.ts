import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { GLOVE80 } from '../../src/board/index.js';
import { generateDrillText } from '../../src/drill/text.js';
import { parseMoErgoLayoutText } from '../../src/keymap/moergo.js';
import { generateLadder, type Lesson } from '../../src/ladder/index.js';
import { describeKey, indexKeys } from '../../src/board/types.js';

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
  await page.locator('#layout-file').setInputFiles(REFERENCE_LAYOUT_PATH);
  await expect(page.locator('#summary')).toBeVisible();
}

/**
 * Drill text is generated per lesson and seeded from the clock, so the page is
 * opened with the seed pinned and the suite works out the same text the app
 * will. Hard-coding a sentence here would only hold until the generator changed,
 * and reading it back off the page would make the tests agree with whatever was
 * rendered rather than with what should have been.
 */
export const DRILL_SEED = 20260921;

/** Matches DRILL_WORDS in src/ui/load-form.ts. */
const DRILL_WORDS = 12;

let cachedLessons: readonly Lesson[] | undefined;

export function referenceLadder(): readonly Lesson[] {
  if (cachedLessons === undefined) {
    const keymap = parseMoErgoLayoutText(readFileSync(REFERENCE_LAYOUT_PATH, 'utf8'), {
      board: GLOVE80,
    });
    cachedLessons = generateLadder(keymap, GLOVE80);
  }
  return cachedLessons;
}

/** The text the app will drill for a lesson, given the pinned seed. */
export function expectedDrillText(lessonIndex = 0): string {
  const lesson = referenceLadder()[lessonIndex];
  if (lesson === undefined) {
    throw new RangeError(`The reference ladder has no lesson at index ${lessonIndex}`);
  }
  return generateDrillText(lesson, { seed: DRILL_SEED, words: DRILL_WORDS });
}

/** Opens the app with the drill seed pinned, so the drill is reproducible. */
export async function gotoApp(page: Page): Promise<void> {
  await page.goto(`./?seed=${String(DRILL_SEED)}`);
}

/** How the app will describe the key that types a character, in words. */
export function expectedKeyDescription(character: string): string {
  const keymap = parseMoErgoLayoutText(readFileSync(REFERENCE_LAYOUT_PATH, 'utf8'), {
    board: GLOVE80,
  });
  const position = keymap.charToPosition.get(character);
  if (position === undefined) {
    throw new RangeError(`The reference layout does not bind ${JSON.stringify(character)}`);
  }
  const key = indexKeys(GLOVE80).get(position);
  if (key === undefined) {
    throw new RangeError(`The board has no key at position ${String(position)}`);
  }
  return describeKey(key);
}

/** The first `count` characters of the drill, which typing correctly requires. */
export function drillPrefix(count: number, lessonIndex = 0): string {
  return [...expectedDrillText(lessonIndex)].slice(0, count).join('');
}

/** The character at a position in the drill. */
export function drillCharAt(index: number, lessonIndex = 0): string {
  const character = [...expectedDrillText(lessonIndex)][index];
  if (character === undefined) {
    throw new RangeError(`The drill has no character at index ${String(index)}`);
  }
  return character;
}

/** Which finger owns the key that types a character. */
export function expectedKeyFinger(character: string): string {
  const keymap = parseMoErgoLayoutText(readFileSync(REFERENCE_LAYOUT_PATH, 'utf8'), {
    board: GLOVE80,
  });
  const position = keymap.charToPosition.get(character);
  if (position === undefined) {
    throw new RangeError(`The reference layout does not bind ${JSON.stringify(character)}`);
  }
  const key = indexKeys(GLOVE80).get(position);
  if (key === undefined) {
    throw new RangeError(`The board has no key at position ${String(position)}`);
  }
  return key.finger;
}

/** A typeable character that is deliberately NOT the one expected next. */
export function wrongKeyFor(character: string): string {
  const candidate = ['z', 'q', 'x', 'j'].find((option) => option !== character);
  if (candidate === undefined) throw new Error('No wrong key available');
  return candidate;
}

/** Which hand the key that types a character belongs to. */
export function expectedKeyHand(character: string): string {
  const keymap = parseMoErgoLayoutText(readFileSync(REFERENCE_LAYOUT_PATH, 'utf8'), {
    board: GLOVE80,
  });
  const position = keymap.charToPosition.get(character);
  if (position === undefined) {
    throw new RangeError(`The reference layout does not bind ${JSON.stringify(character)}`);
  }
  const key = indexKeys(GLOVE80).get(position);
  if (key === undefined) {
    throw new RangeError(`The board has no key at position ${String(position)}`);
  }
  return key.hand;
}
