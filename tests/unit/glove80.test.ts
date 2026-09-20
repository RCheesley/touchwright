/**
 * Pins the Glove80 geometry.
 *
 * This is the most expensive knowledge in the project: it was measured from the
 * MoErgo Layout Editor's render and cross-checked against a real export. These
 * tests exist so that nobody has to measure it twice. If one fails, the geometry
 * changed and that is almost certainly a mistake.
 */

import { describe, expect, it } from 'vitest';
import { GLOVE80 } from '../../src/board/glove80.js';
import {
  assertValidBoard,
  describeKey,
  indexKeys,
  InvalidBoardError,
  type BoardDefinition,
  type ColumnKey,
  type KeyPosition,
  type ThumbKey,
} from '../../src/board/types.js';

const keys = indexKeys(GLOVE80);

function key(position: number): KeyPosition {
  const found = keys.get(position);
  expect(found, `no key at position ${position}`).toBeDefined();
  return found!;
}

function columnKey(position: number): ColumnKey {
  const found = key(position);
  expect(found.kind, `position ${position} should be a column key`).toBe('column');
  return found as ColumnKey;
}

function thumbKey(position: number): ThumbKey {
  const found = key(position);
  expect(found.kind, `position ${position} should be a thumb key`).toBe('thumb');
  return found as ThumbKey;
}

describe('the flat keymap array', () => {
  it('has exactly 80 positions', () => {
    expect(GLOVE80.keyCount).toBe(80);
    expect(GLOVE80.keys).toHaveLength(80);
  });

  it('defines every position from 0 to 79 exactly once', () => {
    expect([...keys.keys()].sort((a, b) => a - b)).toEqual([...Array(80).keys()]);
  });

  it('has 68 column keys and 12 thumb keys', () => {
    const columns = GLOVE80.keys.filter((k) => k.kind === 'column');
    const thumbs = GLOVE80.keys.filter((k) => k.kind === 'thumb');
    expect(columns).toHaveLength(68);
    expect(thumbs).toHaveLength(12);
  });
});

describe('physical grouping of the 80 positions', () => {
  // Straight from the derived geometry table. Boundaries, not every position,
  // because a wrong boundary is how this goes wrong.
  const boundaries: readonly [number, string, string, number][] = [
    [0, 'left', 'function', 0],
    [4, 'left', 'function', 4],
    [5, 'right', 'function', 1],
    [9, 'right', 'function', 5],
    [10, 'left', 'number', 0],
    [15, 'left', 'number', 5],
    [16, 'right', 'number', 0],
    [21, 'right', 'number', 5],
    [22, 'left', 'upper', 0],
    [27, 'left', 'upper', 5],
    [28, 'right', 'upper', 0],
    [33, 'right', 'upper', 5],
    [34, 'left', 'home', 0],
    [39, 'left', 'home', 5],
    [40, 'right', 'home', 0],
    [45, 'right', 'home', 5],
    [46, 'left', 'lower', 0],
    [51, 'left', 'lower', 5],
    [58, 'right', 'lower', 0],
    [63, 'right', 'lower', 5],
    [64, 'left', 'bottom', 0],
    [68, 'left', 'bottom', 4],
    [75, 'right', 'bottom', 1],
    [79, 'right', 'bottom', 5],
  ];

  it.each(boundaries)('position %i is the %s %s row, column %i', (position, hand, row, column) => {
    const k = columnKey(position);
    expect({ hand: k.hand, row: k.row, column: k.column }).toEqual({ hand, row, column });
  });

  const thumbSpans: readonly [number, string, string][] = [
    [52, 'left', 'upper'],
    [54, 'left', 'upper'],
    [55, 'right', 'upper'],
    [57, 'right', 'upper'],
    [69, 'left', 'lower'],
    [71, 'left', 'lower'],
    [72, 'right', 'lower'],
    [74, 'right', 'lower'],
  ];

  it.each(thumbSpans)('position %i is the %s thumb %s arc', (position, hand, arc) => {
    const k = thumbKey(position);
    expect({ hand: k.hand, arc: k.arc }).toEqual({ hand, arc });
  });
});

describe('finger ownership by column', () => {
  it('runs outer pinky to inner index on the left half', () => {
    const fingers = [0, 1, 2, 3, 4, 5].map((column) => columnKey(34 + column).finger);
    expect(fingers).toEqual(['pinky', 'pinky', 'ring', 'middle', 'index', 'index']);
  });

  it('runs inner index to outer pinky on the right half', () => {
    const fingers = [0, 1, 2, 3, 4, 5].map((column) => columnKey(40 + column).finger);
    expect(fingers).toEqual(['index', 'index', 'middle', 'ring', 'pinky', 'pinky']);
  });

  it('marks the spare pinky column an outer reach and the spare index column an inner reach', () => {
    expect([0, 1, 2, 3, 4, 5].map((c) => columnKey(34 + c).reach)).toEqual([
      'outer',
      'natural',
      'natural',
      'natural',
      'natural',
      'inner',
    ]);
    expect([0, 1, 2, 3, 4, 5].map((c) => columnKey(40 + c).reach)).toEqual([
      'inner',
      'natural',
      'natural',
      'natural',
      'natural',
      'outer',
    ]);
  });

  it('gives every thumb-cluster key to the thumb', () => {
    for (const k of GLOVE80.keys) {
      expect(k.finger === 'thumb').toBe(k.kind === 'thumb');
    }
  });
});

describe('rows and stagger', () => {
  it('takes the home row as zero', () => {
    const offsets = new Map<string, number>();
    for (const k of GLOVE80.keys) {
      if (k.kind === 'column') offsets.set(k.row, k.rowOffset);
    }
    expect(Object.fromEntries(offsets)).toEqual({
      function: -3,
      number: -2,
      upper: -1,
      home: 0,
      lower: 1,
      bottom: 2,
    });
  });

  it('staggers the middle column furthest away and the pinky columns closest', () => {
    const left = [0, 1, 2, 3, 4, 5].map((c) => round(columnKey(34 + c).y));
    expect(left).toEqual([0.52, 0.52, 0.16, 0.0, 0.16, 0.3]);
  });

  it('uses the left stagger reversed on the right half', () => {
    const left = [0, 1, 2, 3, 4, 5].map((c) => round(columnKey(34 + c).y));
    const right = [0, 1, 2, 3, 4, 5].map((c) => round(columnKey(40 + c).y));
    expect(right).toEqual([...left].reverse());
  });

  it('renders with a 54 unit pitch and a 47 unit cap', () => {
    expect(GLOVE80.render.keyPitch).toBe(54);
    expect(GLOVE80.render.capSize).toBe(47);
  });
});

describe('the two halves mirror about a single axis', () => {
  // The derived geometry gives the right half an origin 11.96 key units out and
  // five columns per half, which puts the mirror axis at 8.48. That one axis
  // governs the column keys and the thumb clusters alike.
  const AXIS = 8.48;

  it('puts the axis at 8.48 key units', () => {
    expect(round(GLOVE80.render.mirrorAxisX)).toBe(AXIS);
  });

  it('mirrors every column key onto its opposite-hand twin', () => {
    const columns = GLOVE80.keys.filter((k): k is ColumnKey => k.kind === 'column');
    expect(columns.length).toBeGreaterThan(0);

    for (const k of columns) {
      const twin = columns.find(
        (other) => other.row === k.row && other.hand !== k.hand && other.column === 5 - k.column,
      );
      expect(twin, `no mirror for position ${k.index}`).toBeDefined();
      expect((k.x + twin!.x) / 2).toBeCloseTo(AXIS, 5);
      expect(twin!.finger).toBe(k.finger);
      expect(twin!.reach).toBe(k.reach);
      expect(twin!.rowOffset).toBe(k.rowOffset);
    }
  });

  it('mirrors the thumb clusters, inner to outer, negating rotation', () => {
    // These pairings are the ones recorded in the derived geometry.
    const pairs: readonly [number, number][] = [
      [54, 55],
      [53, 56],
      [52, 57],
      [71, 72],
      [70, 73],
      [69, 74],
    ];
    for (const [left, right] of pairs) {
      const l = thumbKey(left);
      const r = thumbKey(right);
      expect(l.hand).toBe('left');
      expect(r.hand).toBe('right');
      expect((l.x + r.x) / 2).toBeCloseTo(AXIS, 5);
      expect(r.y).toBeCloseTo(l.y, 5);
      expect(r.rotation).toBeCloseTo(-l.rotation, 5);
      expect(r.arc).toBe(l.arc);
    }
  });

  it('places E and space at mirrored coordinates, the check named in the derivation', () => {
    // On the reference Maltron layout position 69 carries E and position 74 the
    // space. They are the same key on opposite hands.
    const e = thumbKey(69);
    const space = thumbKey(74);
    expect((e.x + space.x) / 2).toBeCloseTo(AXIS, 5);
    expect(space.y).toBeCloseTo(e.y, 5);
    expect(space.rotation).toBeCloseTo(-e.rotation, 5);
  });

  it('pins the measured left thumb coordinates', () => {
    expect(
      [52, 53, 54, 69, 70, 71].map((p) => {
        const k = thumbKey(p);
        return [k.index, round(k.x), round(k.y), k.rotation];
      }),
    ).toEqual([
      [52, 6.07, 1.96, 15],
      [53, 7.0, 2.3, 30],
      [54, 7.81, 3.0, 45],
      [69, 5.11, 2.85, 15],
      [70, 6.15, 3.22, 30],
      [71, 7.0, 3.93, 45],
    ]);
  });
});

describe('resting and reference positions', () => {
  it('rests the ten fingers on positions 35 to 44', () => {
    expect(GLOVE80.homePositions).toEqual([35, 36, 37, 38, 39, 40, 41, 42, 43, 44]);
  });

  it('puts five home keys on each hand, all in the home row', () => {
    const home = GLOVE80.homePositions.map((p) => columnKey(p));
    expect(home.filter((k) => k.hand === 'left')).toHaveLength(5);
    expect(home.filter((k) => k.hand === 'right')).toHaveLength(5);
    expect(home.every((k) => k.row === 'home')).toBe(true);
  });

  it('covers each of the four fingers once per hand, plus one reach column', () => {
    for (const hand of ['left', 'right'] as const) {
      const fingers = GLOVE80.homePositions
        .map((p) => columnKey(p))
        .filter((k) => k.hand === hand)
        .map((k) => k.finger);
      expect(new Set(fingers)).toEqual(new Set(['pinky', 'ring', 'middle', 'index']));
      // The index owns two home columns; the pinky's second column is a reach.
      expect(fingers.filter((f) => f === 'index')).toHaveLength(2);
    }
  });

  it('names position 74 as the space a typist should use', () => {
    expect(GLOVE80.spacePosition).toBe(74);
    expect(thumbKey(74).hand).toBe('right');
  });

  it('recommends taking shift with the opposite hand', () => {
    expect(GLOVE80.recommendedShift).toEqual({ left: 46, right: 63 });
    expect(columnKey(46).hand).toBe('left');
    expect(columnKey(63).hand).toBe('right');
  });
});

describe('describeKey, the primary channel for locating a key', () => {
  it('names hand, finger and row for a column key', () => {
    expect(describeKey(columnKey(37))).toBe('left hand, middle, home row');
  });

  it('names a reach so a learner can tell the two pinky columns apart', () => {
    expect(describeKey(columnKey(34))).toBe('left hand, pinky (outer reach), home row');
    expect(describeKey(columnKey(39))).toBe('left hand, index (inner reach), home row');
  });

  it('names hand and arc for a thumb key', () => {
    expect(describeKey(thumbKey(69))).toBe('left thumb, lower arc');
  });

  it('never returns an empty description', () => {
    for (const k of GLOVE80.keys) {
      expect(describeKey(k).length).toBeGreaterThan(0);
    }
  });
});

describe('assertValidBoard rejects malformed definitions', () => {
  function board(overrides: Partial<BoardDefinition>): BoardDefinition {
    return { ...GLOVE80, ...overrides };
  }

  it('accepts the real board', () => {
    expect(() => assertValidBoard(GLOVE80)).not.toThrow();
  });

  it('rejects a keyCount that disagrees with the key list', () => {
    expect(() => assertValidBoard(board({ keyCount: 79 }))).toThrow(InvalidBoardError);
  });

  it('rejects a duplicated position', () => {
    const first = GLOVE80.keys[0]!;
    expect(() =>
      assertValidBoard(board({ keys: [first, ...GLOVE80.keys.slice(2)], keyCount: 79 })),
    ).toThrow(InvalidBoardError);
  });

  it('rejects a reference to a position the board does not define', () => {
    expect(() => assertValidBoard(board({ spacePosition: 999 }))).toThrow(
      /references position 999/,
    );
  });

  it('rejects a non-finite coordinate', () => {
    const broken = { ...GLOVE80.keys[0]!, x: Number.NaN };
    expect(() => assertValidBoard(board({ keys: [broken, ...GLOVE80.keys.slice(1)] }))).toThrow(
      /non-finite/,
    );
  });
});

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
