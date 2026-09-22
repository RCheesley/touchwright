/**
 * Weak keys, grouped by finger and row.
 *
 * The grouping is the thing this project exists to do, so it is tested as a pure
 * function against the reference layout rather than through a rendered view: what
 * matters is that the diagnosis is right and that it is stated in words, not what
 * the markup around it looks like.
 *
 * Positions used here come from the reference layout, macOS Maltron on a Glove80,
 * and they are the ones the ladder's own test pins: `p` is the left ring finger's
 * upper row, `.` is the same finger's lower row, `m` is the right index finger's
 * upper row, `q` is the left pinky's upper row and `e` is on the left thumb.
 */

import { describe, expect, it } from 'vitest';
import { GLOVE80 } from '../../src/board/index.js';
import { parseMoErgoLayoutText } from '../../src/keymap/moergo.js';
import {
  fingerLabel,
  InvalidThresholdsError,
  rowLabel,
  selectWeakKeys,
  summariseKeyStats,
  weakKeyCharacters,
  WEAK_KEY_THRESHOLDS,
  type FingerGroup,
  type RowGroup,
} from '../../src/stats/keystats.js';
import { keyStatId, type KeyStat } from '../../src/stats/storage.js';
import { readReferenceLayout } from '../fixtures/index.js';

const keymap = parseMoErgoLayoutText(readReferenceLayout(), { board: GLOVE80 });

/** `[hits, misses, totalMs, samples]`, keyed by character for readability. */
type Entry = readonly [number, number, number?, number?];

function statsFor(entries: Readonly<Record<string, Entry>>): Record<string, KeyStat> {
  const built: Record<string, KeyStat> = {};
  for (const [character, [hits, misses, totalMs, samples]] of Object.entries(entries)) {
    built[keyStatId(character)] = {
      hits,
      misses,
      totalMs: totalMs ?? 0,
      samples: samples ?? 0,
    };
  }
  return built;
}

function report(entries: Readonly<Record<string, Entry>>) {
  return summariseKeyStats({ keyStats: statsFor(entries), keymap, board: GLOVE80 });
}

function finger(groups: readonly FingerGroup[], hand: string, name: string): FingerGroup {
  const found = groups.find((group) => group.hand === hand && group.finger === name);
  if (found === undefined) {
    throw new Error(
      `no group for the ${hand} ${name}; got ${groups.map((group) => group.label).join(', ')}`,
    );
  }
  return found;
}

function row(group: FingerGroup, name: string): RowGroup {
  const found = group.rows.find((candidate) => candidate.row === name);
  if (found === undefined) {
    throw new Error(
      `${group.label} has no ${name} row; got ${group.rows.map((r) => r.row).join(', ')}`,
    );
  }
  return found;
}

describe('grouping weak keys by finger and row', () => {
  it("splits one finger's keys by the row it was reaching for", () => {
    // The left ring finger presses p in the upper row and . in the lower one.
    const grouped = report({ p: [5, 5], '.': [10, 0] });
    const ring = finger(grouped.fingers, 'left', 'ring');

    expect(ring.rows.map((group) => group.row)).toEqual(['upper', 'lower']);
    expect(row(ring, 'upper').keys.map((key) => key.character)).toEqual(['p']);
    expect(row(ring, 'lower').keys.map((key) => key.character)).toEqual(['.']);

    // The whole hand's numbers roll up, and the two rows are told apart.
    expect(ring.attempts).toBe(20);
    expect(ring.misses).toBe(5);
    expect(row(ring, 'upper').severity).toBe('weak');
    expect(row(ring, 'lower').severity).toBe('steady');
  });

  it('names hand, finger and row in words rather than only showing a character', () => {
    const grouped = report({ p: [5, 5] });
    const ring = finger(grouped.fingers, 'left', 'ring');
    const upper = row(ring, 'upper');

    expect(ring.label).toBe('left ring finger');
    expect(upper.rowLabel).toBe('upper row');
    expect(upper.label).toBe('left ring finger, upper row');
    expect(upper.standaloneSummary).toContain('left ring finger, upper row');
    expect(upper.summary).toBe('upper row: 5 of 10 presses missed, 50%');

    // And the individual key still carries describeKey's own wording, so this
    // module and the drill readout can never disagree about a position.
    expect(upper.keys[0]?.description).toBe('left hand, ring, upper row');
    expect(upper.keys[0]?.summary).toBe('“p”, 5 of 10 presses missed, 50%');
  });

  it('puts the finger that needs work before the ones that do not', () => {
    const grouped = report({ p: [5, 5], m: [20, 0] });

    expect(grouped.fingers[0]?.label).toBe('left ring finger');
    expect(grouped.fingers[0]?.severity).toBe('weak');
    expect(finger(grouped.fingers, 'right', 'index').severity).toBe('steady');

    // And the filtered view names the row, not just the finger.
    expect(grouped.weakest.map((group) => group.label)).toEqual(['left ring finger, upper row']);
  });

  it('orders the rows of one finger worst first, whichever row that is', () => {
    // The lower row is the worse of the two here, so it leads despite sitting
    // below the upper row on the board.
    const grouped = report({ p: [19, 1], '.': [5, 5] });
    const ring = finger(grouped.fingers, 'left', 'ring');
    expect(ring.rows.map((group) => group.row)).toEqual(['lower', 'upper']);
  });

  it('gives a thumb a cluster rather than a row, because it has no row', () => {
    const grouped = report({ e: [8, 2] });
    const thumb = finger(grouped.fingers, 'left', 'thumb');

    expect(thumb.label).toBe('left thumb');
    expect(thumb.rows[0]?.rowLabel).toBe('thumb cluster');
    expect(thumb.rows[0]?.label).toBe('left thumb, thumb cluster');
    expect(thumb.rows[0]?.keys[0]?.description).toBe('left thumb, lower arc');
  });

  it('bands a key and its group by miss rate, in three words', () => {
    const steady = report({ p: [20, 0] });
    expect(finger(steady.fingers, 'left', 'ring').severity).toBe('steady');

    const watch = report({ p: [9, 1] });
    expect(finger(watch.fingers, 'left', 'ring').severity).toBe('watch');

    const weak = report({ p: [8, 2] });
    expect(finger(weak.fingers, 'left', 'ring').severity).toBe('weak');
  });

  it('refuses to draw a conclusion from too few presses', () => {
    // Half the presses missed, but only two of them: noise, not a diagnosis.
    const grouped = report({ p: [1, 1] });
    const key = finger(grouped.fingers, 'left', 'ring').rows[0]?.keys[0];

    expect(key?.missRate).toBe(0.5);
    expect(key?.measured).toBe(false);
    expect(key?.severity).toBe('steady');
    expect(grouped.keysPressed).toBe(1);
    expect(grouped.keysMeasured).toBe(0);
    expect(grouped.summary).toContain('too few');
  });

  it('reports the mean time only when something was actually sampled', () => {
    const sampled = report({ p: [4, 0, 800, 4] });
    expect(sampled.fingers[0]?.rows[0]?.keys[0]?.meanMs).toBe(200);

    // A pause for a cup of tea is not a timing sample, so a key can have hits
    // and no samples. Absent is not zero.
    const unsampled = report({ p: [4, 0, 0, 0] });
    expect(unsampled.fingers[0]?.rows[0]?.keys[0]?.meanMs).toBeNull();
  });

  it('counts totals and accuracy over every key, placed or not', () => {
    const grouped = report({ p: [8, 2], m: [10, 0], '☃': [3, 1] });

    expect(grouped.totalHits).toBe(21);
    expect(grouped.totalMisses).toBe(3);
    expect(grouped.totalAttempts).toBe(24);
    expect(grouped.accuracy).toBeCloseTo(21 / 24);
    expect(grouped.keysPressed).toBe(3);
  });

  it('keeps statistics for a key this layout does not bind, rather than dropping them', () => {
    // A learner who changes layout still owns these numbers, and a total that
    // quietly went short would be worse than saying so.
    const grouped = report({ p: [8, 2], '☃': [3, 1] });

    expect(grouped.unplaced.map((key) => key.character)).toEqual(['☃']);
    expect(grouped.unplaced[0]?.label).toBe('“☃”');
    expect(grouped.unplaced[0]?.attempts).toBe(4);
    for (const group of grouped.fingers) {
      for (const rowGroup of group.rows) {
        expect(rowGroup.keys.map((key) => key.character)).not.toContain('☃');
      }
    }
  });

  it('names a space in words, because a blank reads as nothing', () => {
    const grouped = report({ ' ': [18, 2] });
    const keys = grouped.fingers.flatMap((group) => group.rows.flatMap((r) => r.keys));
    expect(keys[0]?.label).toBe('space');
    expect(keys[0]?.summary).toBe('space, 2 of 20 presses missed, 10%');
  });

  it('says that nothing has been recorded when nothing has', () => {
    const grouped = report({});

    expect(grouped.fingers).toEqual([]);
    expect(grouped.weakest).toEqual([]);
    expect(grouped.totalAttempts).toBe(0);
    expect(grouped.accuracy).toBe(0);
    expect(grouped.summary).toBe('Nothing recorded yet. Type a drill and this fills in.');
  });

  it('says so when enough was typed and nothing needs work', () => {
    const grouped = report({ p: [20, 0], m: [20, 0] });
    expect(grouped.weakest).toEqual([]);
    expect(grouped.summary).toContain('no finger and row needs work');
  });

  it('names the worst finger and row in the summary sentence', () => {
    const grouped = report({ p: [5, 5], m: [20, 0] });
    expect(grouped.summary).toContain('left ring finger, upper row');
  });

  it('throws on a statistics id it cannot read rather than skipping it', () => {
    // Storage already drops unreadable ids with a warning, so anything reaching
    // here is meant to be canonical: a silent skip would hide a corrupt store.
    expect(() =>
      summariseKeyStats({
        keyStats: { 'not-a-key-id': { hits: 1, misses: 0, totalMs: 0, samples: 0 } },
        keymap,
        board: GLOVE80,
      }),
    ).toThrow(/Not a key-stat id/);
  });

  it('refuses thresholds that are not usable, rather than guessing', () => {
    const keyStats = statsFor({ p: [8, 2] });
    for (const thresholds of [
      { ...WEAK_KEY_THRESHOLDS, minAttempts: 0 },
      { ...WEAK_KEY_THRESHOLDS, watchMissRate: 5 },
      { ...WEAK_KEY_THRESHOLDS, weakMissRate: Number.NaN },
      { ...WEAK_KEY_THRESHOLDS, watchMissRate: 0.5, weakMissRate: 0.2 },
    ]) {
      expect(() => summariseKeyStats({ keyStats, keymap, board: GLOVE80, thresholds })).toThrow(
        InvalidThresholdsError,
      );
    }
  });

  it('counts the keys that are clean, so a learner is told what is working', () => {
    const grouped = report({ p: [8, 2], m: [20, 0], q: [1, 0] });
    // q has too few presses to count either way.
    expect(grouped.keysMeasured).toBe(2);
    expect(grouped.keysClean).toBe(1);
  });
});

describe('the words the grouping is stated in', () => {
  it('labels every row, and calls the thumb a cluster', () => {
    expect(rowLabel('home')).toBe('home row');
    expect(rowLabel('number')).toBe('number row');
    expect(rowLabel('thumb')).toBe('thumb cluster');
  });

  it('labels a finger by hand, and never says "thumb finger"', () => {
    expect(fingerLabel('left', 'ring')).toBe('left ring finger');
    expect(fingerLabel('right', 'thumb')).toBe('right thumb');
  });
});

describe('selecting the keys a repair drill should be built from', () => {
  it('flattens the grouping into a list, worst first', () => {
    // p is missed half the time, m one press in five, . not at all.
    const grouped = report({ p: [5, 5], m: [16, 4], '.': [20, 0] });
    expect(weakKeyCharacters(grouped)).toEqual(['p', 'm']);
    expect(selectWeakKeys(grouped)[0]?.summary).toBe('“p”, 5 of 10 presses missed, 50%');
  });

  it('does not call a key weak on the strength of one miss', () => {
    // One miss of three presses is half the miss rate of p above and still not
    // a conclusion: WEAK_KEY_THRESHOLDS.minAttempts is four.
    const grouped = report({ q: [2, 1], p: [5, 5] });
    expect(WEAK_KEY_THRESHOLDS.minAttempts).toBe(4);
    expect(weakKeyCharacters(grouped)).toEqual(['p']);

    // A fourth press is the point at which it becomes evidence.
    expect(weakKeyCharacters(report({ q: [3, 1] }))).toEqual(['q']);
  });

  it('leaves the keys that are only worth watching out unless asked', () => {
    // m is missed one press in ten: worth watching, not worth a repair drill.
    const grouped = report({ p: [5, 5], m: [18, 2] });
    expect(weakKeyCharacters(grouped)).toEqual(['p']);
    expect(weakKeyCharacters(grouped, { includeWatch: true })).toEqual(['p', 'm']);
  });

  it('takes the worst few when a caller has only so much room', () => {
    const grouped = report({ p: [1, 9], m: [5, 5], q: [8, 2] });
    expect(weakKeyCharacters(grouped, { limit: 2 })).toEqual(['p', 'm']);
    expect(weakKeyCharacters(grouped, { limit: 0 })).toEqual([]);
  });

  it('is stable when two keys are as bad as each other', () => {
    const grouped = report({ m: [5, 5], p: [5, 5] });
    expect(weakKeyCharacters(grouped)).toEqual(['m', 'p']);
  });

  it('refuses a limit it cannot use rather than guessing one', () => {
    const grouped = report({ p: [5, 5] });
    expect(() => selectWeakKeys(grouped, { limit: -1 })).toThrow(RangeError);
    expect(() => selectWeakKeys(grouped, { limit: 1.5 })).toThrow(RangeError);
  });

  it('never offers a key this layout cannot place', () => {
    // A statistic carried over from another layout has no finger and no row, so
    // it is reported in `unplaced` and never lands in a drill.
    const grouped = report({ '€': [1, 9], p: [5, 5] });
    expect(grouped.unplaced.map((key) => key.character)).toEqual(['€']);
    expect(weakKeyCharacters(grouped)).toEqual(['p']);
  });
});
