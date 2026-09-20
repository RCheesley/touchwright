/**
 * The English frequency data the ladder is ordered by.
 *
 * The values are rounded published figures, so these tests pin the shape and the
 * relative order rather than individual decimals: a refinement of the data should
 * not break the suite, but a table that has lost a letter, gained a zero or
 * stopped summing to about a hundred should.
 */

import { describe, expect, it } from 'vitest';
import {
  BIGRAM_FREQUENCY,
  bigramFrequency,
  LETTER_FREQUENCY,
  letterFrequency,
  pairingWeight,
  PROSE_PUNCTUATION,
  prosePunctuationRank,
  topBigrams,
} from '../../src/ladder/frequency.js';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz';

describe('the letter frequency table', () => {
  it('covers all 26 letters exactly once and sums to about a hundred', () => {
    expect(Object.keys(LETTER_FREQUENCY).sort().join('')).toBe(ALPHABET);
    const total = Object.values(LETTER_FREQUENCY).reduce((sum, value) => sum + value, 0);
    expect(total).toBeGreaterThan(99);
    expect(total).toBeLessThan(101);
  });

  it('holds no zero, because a letter English never used would not be in the table', () => {
    for (const [letter, frequency] of Object.entries(LETTER_FREQUENCY)) {
      expect(frequency, `${letter} is not positive`).toBeGreaterThan(0);
    }
  });

  it('ranks the letters the way English does', () => {
    const ranked = [...ALPHABET].sort(
      (a, b) => (LETTER_FREQUENCY[b] ?? 0) - (LETTER_FREQUENCY[a] ?? 0),
    );
    expect(ranked.slice(0, 11).join('')).toBe('etaoinshrdl');
    expect(ranked.slice(-5).join('')).toBe('kjxqz');
  });

  it('is case insensitive, because a capital is the same key', () => {
    expect(letterFrequency('E')).toBe(letterFrequency('e'));
  });

  it('reports a character it does not cover as absent, not as zero', () => {
    expect(letterFrequency('.')).toBeUndefined();
    expect(letterFrequency('7')).toBeUndefined();
    expect(letterFrequency(' ')).toBeUndefined();
  });

  it('throws on something that is not one character, rather than calling it absent', () => {
    expect(() => letterFrequency('ab')).toThrow(RangeError);
    expect(() => letterFrequency('')).toThrow(/exactly one character/);
  });
});

describe('the bigram table', () => {
  it('holds two-letter keys with positive values only', () => {
    for (const [bigram, frequency] of Object.entries(BIGRAM_FREQUENCY)) {
      expect(bigram, `${bigram} is not two lower-case letters`).toMatch(/^[a-z]{2}$/);
      expect(frequency, `${bigram} is not positive`).toBeGreaterThan(0);
    }
  });

  it('puts the famous pairs in the famous order', () => {
    expect(bigramFrequency('th')).toBeGreaterThan(bigramFrequency('he') ?? 0);
    expect(bigramFrequency('he')).toBeGreaterThan(bigramFrequency('in') ?? 0);
    expect(bigramFrequency('in')).toBeGreaterThan(bigramFrequency('er') ?? 0);
  });

  it('is case insensitive and reports an unlisted pair as absent', () => {
    expect(bigramFrequency('TH')).toBe(bigramFrequency('th'));
    // Rare, not impossible: absent from a table of common pairs.
    expect(bigramFrequency('qz')).toBeUndefined();
  });

  it('throws on anything that is not a pair', () => {
    expect(() => bigramFrequency('t')).toThrow(RangeError);
    expect(() => bigramFrequency('the')).toThrow(/exactly two characters/);
  });
});

describe('how much a key adds to what is already known', () => {
  it('weighs a letter by the common pairs it makes with the known set', () => {
    // H against T is worth the whole of "th" plus "ha", "hi", "ho" and so on; H
    // against Z is worth nothing the table lists.
    expect(pairingWeight('h', ['t'])).toBeGreaterThan(pairingWeight('h', ['z']));
  });

  it('counts a pair in both directions and a doubled letter once', () => {
    const both = pairingWeight('h', ['t']);
    expect(both).toBe((bigramFrequency('ht') ?? 0) + (bigramFrequency('th') ?? 0));
    expect(pairingWeight('l', [])).toBe(bigramFrequency('ll'));
  });

  it('grows as the known set grows, and never shrinks', () => {
    const small = pairingWeight('e', ['t', 'h']);
    const large = pairingWeight('e', ['t', 'h', 'r', 's', 'a']);
    expect(large).toBeGreaterThanOrEqual(small);
  });

  it('is zero for a key that is not a letter, rather than throwing', () => {
    expect(pairingWeight('.', ['a', 'e'])).toBe(0);
  });

  it('throws when asked about more than one character', () => {
    expect(() => pairingWeight('th', ['a'])).toThrow(RangeError);
  });
});

describe('the punctuation rank', () => {
  it('is a rank, with the full stop and comma first', () => {
    expect(prosePunctuationRank('.')).toBe(0);
    expect(prosePunctuationRank(',')).toBe(1);
    expect(prosePunctuationRank("'")).toBeLessThan(prosePunctuationRank(';') ?? Infinity);
  });

  it('lists no letter, no digit and nothing twice', () => {
    expect(new Set(PROSE_PUNCTUATION).size).toBe(PROSE_PUNCTUATION.length);
    for (const mark of PROSE_PUNCTUATION) {
      expect(mark, `${mark} is not a single mark`).toHaveLength(1);
      expect(mark).not.toMatch(/[\p{L}\p{N}]/u);
    }
  });

  it('reports a mark prose does not use as absent', () => {
    expect(prosePunctuationRank('`')).toBeUndefined();
    expect(prosePunctuationRank('\\')).toBeUndefined();
    expect(prosePunctuationRank('=')).toBeUndefined();
  });
});

describe('the bigrams a key set can type', () => {
  it('returns only pairs both of whose letters are allowed', () => {
    const allowed = [...'anisfdthore'];
    for (const { bigram } of topBigrams(allowed)) {
      for (const letter of bigram) {
        expect(allowed, `${bigram} uses ${letter}`).toContain(letter);
      }
    }
  });

  it('puts the most common pair first, and honours a limit', () => {
    const top = topBigrams([...'anisfdthore'], 3);
    expect(top).toHaveLength(3);
    expect(top[0]?.bigram).toBe('th');
    expect(top[0]!.frequency).toBeGreaterThanOrEqual(top[1]!.frequency);
    expect(top[1]!.frequency).toBeGreaterThanOrEqual(top[2]!.frequency);
  });

  it('grows as the key set grows', () => {
    const early = topBigrams([...'anisfdthor']);
    const later = topBigrams([...'anisfdthorelu']);
    expect(later.length).toBeGreaterThan(early.length);
  });

  it('is empty for a key set with nothing to pair, and never lies about it', () => {
    expect(topBigrams([])).toEqual([]);
    expect(topBigrams([...".,';"])).toEqual([]);
    expect(topBigrams([...'anisfdthore'], 0)).toEqual([]);
  });

  it('is deterministic and case insensitive', () => {
    expect(topBigrams([...'THE'])).toEqual(topBigrams([...'the']));
    expect(topBigrams([...'the'])).toEqual(topBigrams([...'eht']));
  });

  it('refuses a limit that is not a whole count', () => {
    expect(() => topBigrams([...'the'], -1)).toThrow(RangeError);
    expect(() => topBigrams([...'the'], 1.5)).toThrow(/non-negative integer/);
  });
});
