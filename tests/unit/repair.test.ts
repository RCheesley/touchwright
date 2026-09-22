/**
 * Repair drills.
 *
 * The centre of this file is the exhaustive check: for every lesson of the
 * reference ladder, across many seeds and several sets of weak keys, the text
 * contains every weak key it was given and contains nothing but weak keys,
 * anchors and the separator. Those two together are the feature — a repair drill
 * that quietly drops a key looks fine and repairs nothing.
 *
 * Maltron is a trademark of PCD Maltron Ltd and the layout is used here only as
 * test data.
 */

import { describe, expect, it } from 'vitest';
import { GLOVE80 } from '../../src/board/glove80.js';
import { parseMoErgoLayoutText } from '../../src/keymap/moergo.js';
import { generateLadder, type Lesson } from '../../src/ladder/index.js';
import {
  DEFAULT_REPAIR_GROUP_COUNT,
  MAX_REPAIR_ANCHORS,
  RepairDrillError,
  generateRepairText,
  repairAnchors,
} from '../../src/drill/repair.js';
import { readReferenceLayout } from '../fixtures/index.js';

const LADDER: readonly Lesson[] = generateLadder(
  parseMoErgoLayoutText(readReferenceLayout(), { board: GLOVE80 }),
  GLOVE80,
);

function lessonById(id: string): Lesson {
  const lesson = LADDER.find((candidate) => candidate.id === id);
  if (lesson === undefined) throw new Error(`the reference ladder has no lesson "${id}"`);
  return lesson;
}

/** A lesson that is not from the ladder, for the degenerate cases. */
function madeUpLesson(keys: string, overrides?: Partial<Lesson>): Lesson {
  return {
    id: 'made-up',
    name: 'Made up',
    blurb: 'Not from a real layout.',
    addedKeys: [...keys],
    keys: [...keys],
    stage: 'keys',
    ...overrides,
  };
}

const SEEDS = [0, 1, 2, 3, 7, 42, 99, 1234, 65535, 2 ** 31 - 1];

/** The keys of a lesson that a weak-key selection could plausibly name. */
function drillableKeys(lesson: Lesson): readonly string[] {
  return lesson.keys.filter((key) => key.trim() !== '');
}

describe('every lesson of the reference ladder', () => {
  it('drills every weak key it is given, and nothing outside the lesson', () => {
    for (const lesson of LADDER) {
      const keys = drillableKeys(lesson);
      const allowed = new Set(lesson.keys.flatMap((key) => [key, key.toUpperCase()]));

      // The first, the last and a spread of the lesson's own keys: whatever a
      // selection came back with, the drill has to cover it.
      const selections: readonly (readonly string[])[] = [
        keys.slice(0, 1),
        keys.slice(-1),
        keys.filter((_, index) => index % 3 === 0).slice(0, 6),
      ];

      for (const weakKeys of selections) {
        if (weakKeys.length === 0) continue;
        for (const seed of SEEDS) {
          const text = generateRepairText(lesson, weakKeys, { seed });

          expect(text).not.toBe('');
          for (const key of weakKeys) {
            expect(
              text.includes(key),
              `lesson ${lesson.id} seed ${seed} never drilled ${JSON.stringify(key)}: ${text}`,
            ).toBe(true);
          }
          for (const character of text) {
            expect(
              allowed.has(character) || character === ' ',
              `lesson ${lesson.id} seed ${seed} produced ${JSON.stringify(character)}: ${text}`,
            ).toBe(true);
          }
        }
      }
    }
  });

  it('uses nothing but the weak keys, their anchors and the separator', () => {
    for (const lesson of LADDER) {
      const weakKeys = drillableKeys(lesson).slice(-2);
      if (weakKeys.length === 0) continue;

      const anchors = repairAnchors(lesson, weakKeys);
      const permitted = new Set([...weakKeys, ...anchors, ' ']);

      for (const seed of SEEDS) {
        for (const character of generateRepairText(lesson, weakKeys, { seed })) {
          expect(
            permitted.has(character),
            `lesson ${lesson.id} reached for ${JSON.stringify(character)}, which is neither weak nor an anchor`,
          ).toBe(true);
        }
      }
    }
  });

  it('never pads, and never doubles a space', () => {
    for (const lesson of LADDER) {
      const weakKeys = drillableKeys(lesson).slice(0, 3);
      if (weakKeys.length === 0) continue;
      for (const seed of SEEDS) {
        const text = generateRepairText(lesson, weakKeys, { seed });
        expect(text.trim()).toBe(text);
        expect(text).not.toMatch(/\s\s/u);
      }
    }
  });
});

describe('mixing the weak keys with anchors', () => {
  const lesson = lessonById('yp');

  it('anchors against the lesson’s resting keys, never against a weak one', () => {
    const anchors = repairAnchors(lesson, ['p']);

    expect(anchors.length).toBeGreaterThan(0);
    expect(anchors.length).toBeLessThanOrEqual(MAX_REPAIR_ANCHORS);
    expect(anchors).not.toContain('p');
    expect(anchors).not.toContain(' ');
    // The home lesson comes first in the ladder, so the front of the cumulative
    // key set is the position the hands are resting in.
    const home = new Set(lessonById('home').keys);
    for (const anchor of anchors) expect(home.has(anchor)).toBe(true);
  });

  it('reads like typing rather than like mashing', () => {
    const anchors = new Set(repairAnchors(lesson, ['p']));

    for (const seed of SEEDS) {
      const text = generateRepairText(lesson, ['p'], { seed });
      const anchored = [...text].filter((character) => anchors.has(character));

      // More anchor presses than weak ones: the weak key is set among keys the
      // learner already has, which is the point of the exercise.
      expect(anchored.length).toBeGreaterThan([...text].filter((c) => c === 'p').length);
      // And never a doubled weak key, which trains a different skill.
      expect(text).not.toContain('pp');
    }
  });

  it('takes anchors from the caller when it is given them', () => {
    const text = generateRepairText(lesson, ['p'], { seed: 7, anchors: ['a', 's'] });
    for (const character of text) {
      expect(['p', 'a', 's', ' ']).toContain(character);
    }
  });

  it('falls back to the weak keys when a lesson has nothing steady left', () => {
    // Every key of this lesson is weak, so there is nothing to anchor against.
    const tiny = madeUpLesson('ab');
    expect(repairAnchors(tiny, ['a', 'b'])).toEqual([]);

    const text = generateRepairText(tiny, ['a', 'b'], { seed: 3 });
    expect(text).toContain('a');
    expect(text).toContain('b');
    expect(text.replace(/[ab]/gu, '')).toBe('');
  });

  it('runs the groups together when the lesson has no space', () => {
    const noSpace = madeUpLesson('asdfp');
    const text = generateRepairText(noSpace, ['p'], { seed: 1 });
    expect(text).not.toContain(' ');
    expect(text).toContain('p');
  });
});

describe('length and determinism', () => {
  const lesson = lessonById('punct');

  it('gives the same text for the same seed, and a different one for another', () => {
    const first = generateRepairText(lesson, ['p', ','], { seed: 42 });
    expect(generateRepairText(lesson, ['p', ','], { seed: 42 })).toBe(first);
    expect(generateRepairText(lesson, ['p', ','], { seed: 43 })).not.toBe(first);
  });

  it('is reproducible without a seed, and varies with the keys asked for', () => {
    expect(generateRepairText(lesson, ['p'])).toBe(generateRepairText(lesson, ['p']));
    expect(generateRepairText(lesson, ['p'])).not.toBe(generateRepairText(lesson, [',']));
  });

  it('asks for the group count it was given', () => {
    const text = generateRepairText(lesson, ['p'], { seed: 5, words: 4 });
    expect(text.split(' ')).toHaveLength(4);

    const standard = generateRepairText(lesson, ['p'], { seed: 5 });
    expect(standard.split(' ')).toHaveLength(DEFAULT_REPAIR_GROUP_COUNT);
  });

  it('overshoots a short request rather than dropping a key', () => {
    const weakKeys = ['p', ',', 'y', 'b'];
    const text = generateRepairText(lesson, weakKeys, { seed: 9, words: 1 });

    expect(text.split(' ').length).toBeGreaterThanOrEqual(weakKeys.length);
    for (const key of weakKeys) expect(text).toContain(key);
  });

  it('refuses a length or a seed that is not a number it can use', () => {
    expect(() => generateRepairText(lesson, ['p'], { words: 0 })).toThrow(RangeError);
    expect(() => generateRepairText(lesson, ['p'], { words: 2.5 })).toThrow(RangeError);
    expect(() => generateRepairText(lesson, ['p'], { seed: 1.5 })).toThrow(RangeError);
  });
});

describe('refusing what it cannot honestly drill', () => {
  const lesson = lessonById('yp');

  it('refuses an empty weak-key list rather than building an ordinary drill', () => {
    expect(() => generateRepairText(lesson, [])).toThrow(RepairDrillError);
    expect(() => generateRepairText(lesson, [])).toThrow(/repair nothing/u);
  });

  it('names the key when the lesson cannot type it', () => {
    // z arrives five lessons later; a selection naming it here is a caller bug.
    expect(() => generateRepairText(lesson, ['p', 'z'])).toThrow(RepairDrillError);
    expect(() => generateRepairText(lesson, ['p', 'z'])).toThrow(/"z"/u);
    expect(() => generateRepairText(lesson, ['p', 'z'])).toThrow(/cannot type/u);
  });

  it('refuses whitespace and anything that is not one key', () => {
    expect(() => generateRepairText(lesson, [' '])).toThrow(/whitespace/u);
    expect(() => generateRepairText(lesson, ['ap'])).toThrow(/not a single key/u);
    expect(() => generateRepairText(lesson, [''])).toThrow(RepairDrillError);
  });

  it('collapses a key listed twice, because that asks for nothing new', () => {
    expect(generateRepairText(lesson, ['p', 'p'], { seed: 4 })).toBe(
      generateRepairText(lesson, ['p'], { seed: 4 }),
    );
  });

  it('refuses anchors that are missing, untypable, weak, or an empty list', () => {
    expect(() => generateRepairText(lesson, ['p'], { anchors: [] })).toThrow(/empty anchor list/u);
    expect(() => generateRepairText(lesson, ['p'], { anchors: ['z'] })).toThrow(/cannot type/u);
    expect(() => generateRepairText(lesson, ['p'], { anchors: ['p'] })).toThrow(
      /both an anchor and a weak key/u,
    );
    expect(() => generateRepairText(lesson, ['p'], { anchors: [' '] })).toThrow(RepairDrillError);
  });

  it('throws with the original error attached when the lesson itself is unusable', () => {
    const empty = madeUpLesson('');
    let thrown: unknown;
    try {
      generateRepairText(empty, ['p']);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(RepairDrillError);
    expect((thrown as RepairDrillError).cause).toBeInstanceOf(Error);
  });
});
