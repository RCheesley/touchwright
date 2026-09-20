/**
 * Drill text generation.
 *
 * The centre of this file is the exhaustive check: for every lesson of the
 * reference ladder, across many seeds, every character of the generated text is
 * a character that lesson can type. That is the acceptance criterion the whole
 * module exists for, and the one the prototype failed — its prose reached for an
 * exclamation mark its ladder never taught.
 *
 * Maltron is a trademark of PCD Maltron Ltd and the layout is used here only as
 * test data.
 */

import { describe, expect, it } from 'vitest';
import { GLOVE80 } from '../../src/board/glove80.js';
import { parseMoErgoLayout, parseMoErgoLayoutText } from '../../src/keymap/moergo.js';
import { generateLadder, type Lesson } from '../../src/ladder/index.js';
import {
  DEFAULT_WORD_COUNT,
  DRILL_SENTENCES,
  DRILL_WORDS,
  DrillTextError,
  drillAlphabet,
  drillProsePool,
  drillTextKind,
  drillWordPool,
  generateDrillText,
} from '../../src/drill/text.js';
import { readReferenceLayout } from '../fixtures/index.js';

const fixtureText = readReferenceLayout();

function referenceLadder(): readonly Lesson[] {
  return generateLadder(parseMoErgoLayoutText(fixtureText, { board: GLOVE80 }), GLOVE80);
}

const LADDER = referenceLadder();

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

describe('every lesson of the reference ladder', () => {
  it('has the thirteen lessons the ladder documents', () => {
    expect(LADDER.map((lesson) => lesson.id)).toEqual([
      'home',
      'thumb',
      'lu',
      'cm',
      'wg',
      'yp',
      'bv',
      'kj',
      'xqz',
      'punct',
      'symbols',
      'caps',
      'prose',
    ]);
  });

  it('only ever generates characters the lesson can type', () => {
    for (const lesson of LADDER) {
      const allowed = drillAlphabet(lesson);
      for (const seed of SEEDS) {
        for (const words of [1, 4, DEFAULT_WORD_COUNT, 40]) {
          const text = generateDrillText(lesson, { seed, words });
          const untypable = [...text].filter((character) => !allowed.has(character));
          expect(untypable, `${lesson.id} seed ${seed} words ${words}: ${text}`).toEqual([]);
        }
      }
    }
  });

  it('never generates an empty drill, padding or doubled spaces', () => {
    for (const lesson of LADDER) {
      for (const seed of SEEDS) {
        const text = generateDrillText(lesson, { seed });
        expect(text.length, lesson.id).toBeGreaterThan(0);
        expect(text.trim()).toBe(text);
        expect(text).not.toMatch(/\s\s/);
      }
    }
  });

  it('generates text every character of which is in the cumulative key set, not just the alphabet', () => {
    // A tighter statement of the same rule: for the stages that add no capitals,
    // the alphabet is exactly the lesson's keys, so the text is checked against
    // the ladder's own output rather than against anything this module derived.
    for (const lesson of LADDER) {
      if (lesson.stage === 'capitals') continue;
      const keys = new Set(lesson.keys);
      for (const seed of SEEDS) {
        for (const character of generateDrillText(lesson, { seed })) {
          expect(keys.has(character), `${lesson.id} cannot type ${JSON.stringify(character)}`).toBe(
            true,
          );
        }
      }
    }
  });
});

describe('the earliest lessons', () => {
  it('finds real words in the first lesson rather than an empty pool', () => {
    // Worth pinning: anisfdthor plus space looks impoverished and is not.
    const pool = drillWordPool(lessonById('home'));
    expect(pool.length).toBeGreaterThan(100);
    expect(pool).toContain('that');
    expect(pool).toContain('north');
    expect(pool).toContain('station');
    expect(pool).not.toContain('the');
  });

  it('leads the first two lessons with a cluster group', () => {
    for (const id of ['home', 'thumb']) {
      const lesson = lessonById(id);
      expect(drillTextKind(lesson)).toBe('words');
      const groups = generateDrillText(lesson, { seed: 5 }).split(' ');
      const pool = new Set(drillWordPool(lesson));
      const clusters = groups.filter((group) => !pool.has(group));
      expect(clusters.length, groups.join(' ')).toBeGreaterThan(0);
    }
  });

  it('falls back to clusters when the pool is too thin to drill words', () => {
    const lesson = madeUpLesson('at ');
    expect(drillWordPool(lesson)).toEqual(['at']);
    expect(drillTextKind(lesson)).toBe('clusters');
    const text = generateDrillText(lesson, { seed: 1, words: 6 });
    expect(text.split(' ')).toHaveLength(6);
    expect(text).toMatch(/^[at ]+$/);
  });

  it('builds clusters from the common bigrams the key set can type', () => {
    const lesson = madeUpLesson('theran ');
    const text = generateDrillText(lesson, { seed: 3, words: 30 });
    const pairs = new Set<string>();
    for (const cluster of text.split(' ')) {
      for (let index = 0; index + 1 < cluster.length; index += 1) {
        pairs.add(cluster.slice(index, index + 2));
      }
    }
    // th, he, an, er, re, at are all in the bigram table and typable here.
    expect(
      [...pairs].filter((pair) => ['th', 'he', 'an', 'er', 're', 'at'].includes(pair)).length,
    ).toBeGreaterThan(3);
  });

  it('produces something typeable for a single letter and a space', () => {
    const text = generateDrillText(madeUpLesson('a '), { seed: 1, words: 3 });
    expect(text).toMatch(/^[a ]+$/);
    expect(text.length).toBeGreaterThan(0);
  });

  it('runs the groups together when the layout has not unlocked a space', () => {
    const text = generateDrillText(madeUpLesson('anisfdthor'), { seed: 2, words: 4 });
    expect(text).not.toContain(' ');
    expect(text).toMatch(/^[anisfdthor]+$/);
  });
});

describe('determinism', () => {
  it('gives the same text for the same seed and lesson', () => {
    for (const lesson of LADDER) {
      for (const seed of SEEDS) {
        expect(generateDrillText(lesson, { seed })).toBe(generateDrillText(lesson, { seed }));
      }
    }
  });

  it('gives different text for different seeds', () => {
    const lesson = lessonById('cm');
    const texts = new Set(SEEDS.map((seed) => generateDrillText(lesson, { seed })));
    expect(texts.size).toBeGreaterThan(SEEDS.length - 2);
  });

  it('is reproducible without a seed, from the lesson id', () => {
    for (const lesson of LADDER) {
      expect(generateDrillText(lesson)).toBe(generateDrillText(lesson));
    }
    // Two lessons with the same key set and different ids must not collide.
    const first = madeUpLesson('anisfdthor ', { id: 'first' });
    const second = madeUpLesson('anisfdthor ', { id: 'second' });
    expect(generateDrillText(first)).not.toBe(generateDrillText(second));
  });

  it('does not depend on the ladder object identity, only on its content', () => {
    const rebuilt = generateLadder(
      parseMoErgoLayout(JSON.parse(fixtureText), { board: GLOVE80 }),
      GLOVE80,
    );
    for (const [index, lesson] of LADDER.entries()) {
      const other = rebuilt[index];
      expect(other).toBeDefined();
      expect(generateDrillText(other!, { seed: 11 })).toBe(generateDrillText(lesson, { seed: 11 }));
    }
  });
});

describe('capitals', () => {
  it('appear at the capitals stage', () => {
    const text = generateDrillText(lessonById('caps'), { seed: 4, words: 20 });
    expect(text).toMatch(/[A-Z]/);
  });

  it('appear in no earlier lesson, at any seed', () => {
    for (const lesson of LADDER) {
      if (lesson.stage === 'capitals') continue;
      for (const seed of SEEDS) {
        expect(generateDrillText(lesson, { seed }), lesson.id).not.toMatch(/[A-Z]/);
      }
    }
  });

  it('are only capitals of letters the lesson has met', () => {
    const lesson = lessonById('caps');
    const met = new Set(lesson.keys);
    for (const seed of SEEDS) {
      for (const character of generateDrillText(lesson, { seed, words: 30 })) {
        if (/[A-Z]/.test(character)) expect(met.has(character.toLowerCase())).toBe(true);
      }
    }
  });
});

describe('punctuation', () => {
  it('appears in no lesson before the one that introduces it', () => {
    const before = LADDER.slice(
      0,
      LADDER.findIndex((lesson) => lesson.id === 'punct'),
    );
    expect(before).toHaveLength(9);
    for (const lesson of before) {
      for (const seed of SEEDS) {
        for (const words of [4, DEFAULT_WORD_COUNT, 40]) {
          expect(generateDrillText(lesson, { seed, words }), lesson.id).toMatch(/^[a-z ]+$/);
        }
      }
    }
  });

  it('appears once the punctuation lesson has introduced it', () => {
    const lesson = lessonById('punct');
    const texts = SEEDS.map((seed) => generateDrillText(lesson, { seed, words: 20 }));
    expect(texts.some((text) => text.includes('.'))).toBe(true);
    expect(texts.every((text) => /^[a-z .,'\-;/]+$/.test(text))).toBe(true);
  });

  it('uses only the marks the lesson bound, never one it did not', () => {
    // The reference punctuation lesson binds no colon, question mark or bang.
    for (const lesson of LADDER.slice(LADDER.findIndex((entry) => entry.id === 'punct'))) {
      for (const seed of SEEDS) {
        const text = generateDrillText(lesson, { seed, words: 30 });
        expect(text, lesson.id).not.toMatch(/[:?!"()]/);
      }
    }
  });
});

describe('prose', () => {
  it('is real sentences at the prose stage', () => {
    const lesson = lessonById('prose');
    expect(drillTextKind(lesson)).toBe('prose');
    const text = generateDrillText(lesson, { seed: 6 });
    const expected = drillProsePool(lesson);
    for (const sentence of text.split(/(?<=\.)\s/)) {
      expect(expected).toContain(sentence);
    }
  });

  it('never reaches for the exclamation mark the prototype shipped', () => {
    // Regression in spirit: the prototype's "How vexingly quick daft zebras
    // jump!" needs shift and the 1 key, which no lesson of this ladder unlocks.
    expect(DRILL_SENTENCES).toContain('How vexingly quick daft zebras jump!');
    const lesson = lessonById('prose');
    expect(drillProsePool(lesson).some((sentence) => sentence.includes('!'))).toBe(false);
    for (const seed of SEEDS) {
      expect(generateDrillText(lesson, { seed, words: 60 })).not.toContain('!');
    }
  });

  it('falls back to words when the layout binds no punctuation for a sentence', () => {
    // A letters-only layout at the prose stage still has the sentences that use
    // no punctuation, so prose survives; strip those and it must degrade rather
    // than throw.
    const lesson = madeUpLesson('anisfdthorelucmwgypbvkjxqz ', { stage: 'prose' });
    expect(drillProsePool(lesson).length).toBeGreaterThan(0);
    expect(drillTextKind(lesson)).toBe('prose');
    expect(generateDrillText(lesson, { seed: 1 })).toMatch(/^[a-z ]+$/);

    const thin = madeUpLesson('anis ', { stage: 'prose' });
    expect(drillProsePool(thin)).toEqual([]);
    expect(drillTextKind(thin)).toBe('clusters');
    expect(generateDrillText(thin, { seed: 1 })).toMatch(/^[anis ]+$/);
  });
});

describe('the new keys a lesson introduces', () => {
  it('drills the digits and symbols no word contains', () => {
    const lesson = lessonById('symbols');
    for (const seed of SEEDS) {
      const text = generateDrillText(lesson, { seed, words: 20 });
      expect(/[0-9]/.test(text), `${lesson.id} seed ${seed}: ${text}`).toBe(true);
    }
  });

  it('prefers words using the new letters when there are enough of them', () => {
    const lesson = lessonById('cm');
    const text = generateDrillText(lesson, { seed: 8, words: 20 });
    const groups = text.split(' ');
    const fresh = groups.filter((group) => group.includes('c') || group.includes('m'));
    expect(fresh.length / groups.length).toBeGreaterThan(0.3);
  });
});

describe('the options', () => {
  it('hits the requested number of groups for a word drill', () => {
    const lesson = lessonById('bv');
    for (const words of [1, 2, 5, 12, 30]) {
      expect(generateDrillText(lesson, { seed: 1, words }).split(' ')).toHaveLength(words);
    }
  });

  it('rejects a word count that is not a positive integer', () => {
    const lesson = lessonById('cm');
    for (const words of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => generateDrillText(lesson, { words })).toThrow(RangeError);
    }
  });

  it('rejects a seed that is not an integer', () => {
    const lesson = lessonById('cm');
    for (const seed of [1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => generateDrillText(lesson, { seed })).toThrow(RangeError);
    }
  });

  it('accepts a negative seed, deterministically', () => {
    const lesson = lessonById('cm');
    expect(generateDrillText(lesson, { seed: -7 })).toBe(generateDrillText(lesson, { seed: -7 }));
  });
});

describe('a lesson that admits nothing', () => {
  it('throws rather than returning an empty string', () => {
    const empty: Lesson = {
      id: 'empty',
      name: 'Empty',
      blurb: 'No keys at all.',
      addedKeys: [],
      keys: [],
      stage: 'keys',
    };
    expect(() => generateDrillText(empty)).toThrow(DrillTextError);
    expect(() => generateDrillText(empty)).toThrow(/has no keys/);
  });

  it('throws when the only key is a space, so there is nothing to type', () => {
    expect(() => generateDrillText(madeUpLesson(' '))).toThrow(DrillTextError);
  });

  it('throws with a cause when the failure came from further in', () => {
    try {
      generateDrillText(madeUpLesson(' '));
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(DrillTextError);
      expect((error as DrillTextError).cause).toBeInstanceOf(DrillTextError);
    }
  });

  it('rejects a lesson whose key is not a single character', () => {
    const lesson = madeUpLesson('ab ');
    const broken: Lesson = { ...lesson, keys: ['ab', ' '] };
    expect(() => generateDrillText(broken)).toThrow(/not one character/);
  });
});

describe('the data', () => {
  it('is a sorted, deduplicated pool of lower case words', () => {
    expect(DRILL_WORDS.length).toBeGreaterThan(1000);
    expect(new Set(DRILL_WORDS).size).toBe(DRILL_WORDS.length);
    expect([...DRILL_WORDS].sort()).toEqual([...DRILL_WORDS]);
    for (const word of DRILL_WORDS) expect(word).toMatch(/^[a-z]{2,}$/);
  });

  it('holds sentences that are not padded', () => {
    for (const sentence of DRILL_SENTENCES) {
      expect(sentence.trim()).toBe(sentence);
      expect(sentence).not.toMatch(/\s\s/);
    }
  });
});
