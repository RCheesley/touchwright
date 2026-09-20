/**
 * MoErgo Glove80 physical geometry.
 *
 * Every number here is transcribed verbatim from docs/board-definitions.md,
 * which records how it was measured. Do not re-derive it and do not tidy the
 * literals into something computed: the tests in tests/unit/glove80.test.ts pin
 * both the values and the relationships between them, and a derived value would
 * hide a transcription error rather than catch it.
 *
 * MoErgo and Glove80 are trademarks of MoErgo. This project is not affiliated
 * with or endorsed by them; the names are used only to say which keyboard this
 * geometry describes.
 */

import {
  assertValidBoard,
  type BoardDefinition,
  type ColumnFinger,
  type ColumnKey,
  type ColumnRow,
  type Hand,
  type KeyPosition,
  type Reach,
  type ThumbKey,
} from './types.js';

/** The flat ZMK keymap array for this board has exactly this many entries. */
const KEY_COUNT = 80;

/** Offset of the right half's column zero from the left half's column zero. */
const RIGHT_HALF_ORIGIN_X = 11.96;
/** Columns per half. */
const HALF_WIDTH = 5;
/** Both halves mirror about this x. Pinned by test, for columns and thumbs alike. */
const MIRROR_AXIS_X = (RIGHT_HALF_ORIGIN_X + HALF_WIDTH) / 2;

/** Rows relative to the home row, which is zero. */
const ROW_OFFSETS: Readonly<Record<ColumnRow, number>> = {
  function: -3,
  number: -2,
  upper: -1,
  home: 0,
  lower: 1,
  bottom: 2,
};

/** Vertical offset per column in key units; larger is closer to the typist. */
const LEFT_STAGGER = [0.52, 0.52, 0.16, 0.0, 0.16, 0.3] as const;
const RIGHT_STAGGER = [0.3, 0.16, 0.0, 0.16, 0.52, 0.52] as const;

/** Column index runs outer pinky to inner index on the left half, reversed on the right. */
const LEFT_FINGERS: readonly ColumnFinger[] = [
  'pinky',
  'pinky',
  'ring',
  'middle',
  'index',
  'index',
];
const RIGHT_FINGERS: readonly ColumnFinger[] = [
  'index',
  'index',
  'middle',
  'ring',
  'pinky',
  'pinky',
];

/** Which of a two-column finger's columns is a reach rather than a rest. */
const LEFT_REACH: readonly Reach[] = ['outer', 'natural', 'natural', 'natural', 'natural', 'inner'];
const RIGHT_REACH: readonly Reach[] = [
  'inner',
  'natural',
  'natural',
  'natural',
  'natural',
  'outer',
];

interface RowSpan {
  readonly start: number;
  readonly hand: Hand;
  readonly row: ColumnRow;
  readonly columns: readonly number[];
}

/** Physical grouping of the 80 positions, confirmed against a real export. */
const ROW_SPANS: readonly RowSpan[] = [
  { start: 0, hand: 'left', row: 'function', columns: [0, 1, 2, 3, 4] },
  { start: 5, hand: 'right', row: 'function', columns: [1, 2, 3, 4, 5] },
  { start: 10, hand: 'left', row: 'number', columns: [0, 1, 2, 3, 4, 5] },
  { start: 16, hand: 'right', row: 'number', columns: [0, 1, 2, 3, 4, 5] },
  { start: 22, hand: 'left', row: 'upper', columns: [0, 1, 2, 3, 4, 5] },
  { start: 28, hand: 'right', row: 'upper', columns: [0, 1, 2, 3, 4, 5] },
  { start: 34, hand: 'left', row: 'home', columns: [0, 1, 2, 3, 4, 5] },
  { start: 40, hand: 'right', row: 'home', columns: [0, 1, 2, 3, 4, 5] },
  { start: 46, hand: 'left', row: 'lower', columns: [0, 1, 2, 3, 4, 5] },
  { start: 58, hand: 'right', row: 'lower', columns: [0, 1, 2, 3, 4, 5] },
  { start: 64, hand: 'left', row: 'bottom', columns: [0, 1, 2, 3, 4] },
  { start: 75, hand: 'right', row: 'bottom', columns: [1, 2, 3, 4, 5] },
];

interface ThumbSpec {
  readonly index: number;
  readonly arc: 'upper' | 'lower';
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
}

/** Left cluster, measured. x is in key units from column zero of the left half. */
const LEFT_THUMBS: readonly ThumbSpec[] = [
  { index: 52, arc: 'upper', x: 6.07, y: 1.96, rotation: 15 },
  { index: 53, arc: 'upper', x: 7.0, y: 2.3, rotation: 30 },
  { index: 54, arc: 'upper', x: 7.81, y: 3.0, rotation: 45 },
  { index: 69, arc: 'lower', x: 5.11, y: 2.85, rotation: 15 },
  { index: 70, arc: 'lower', x: 6.15, y: 3.22, rotation: 30 },
  { index: 71, arc: 'lower', x: 7.0, y: 3.93, rotation: 45 },
];

/** Right cluster position -> the left position it mirrors, inner to outer. */
const THUMB_MIRRORS: ReadonlyMap<number, number> = new Map([
  [55, 54],
  [56, 53],
  [57, 52],
  [72, 71],
  [73, 70],
  [74, 69],
]);

function at<T>(values: readonly T[], index: number, what: string): T {
  const value = values[index];
  if (value === undefined) {
    throw new RangeError(`Glove80 geometry: no ${what} defined for column ${index}`);
  }
  return value;
}

function buildColumnKeys(): ColumnKey[] {
  const keys: ColumnKey[] = [];

  for (const span of ROW_SPANS) {
    const isLeft = span.hand === 'left';
    const fingers = isLeft ? LEFT_FINGERS : RIGHT_FINGERS;
    const reaches = isLeft ? LEFT_REACH : RIGHT_REACH;
    const stagger = isLeft ? LEFT_STAGGER : RIGHT_STAGGER;
    const rowOffset = ROW_OFFSETS[span.row];

    span.columns.forEach((column, offset) => {
      keys.push({
        kind: 'column',
        index: span.start + offset,
        hand: span.hand,
        finger: at(fingers, column, 'finger'),
        reach: at(reaches, column, 'reach'),
        row: span.row,
        rowOffset,
        column,
        x: isLeft ? column : RIGHT_HALF_ORIGIN_X + column,
        y: rowOffset + at(stagger, column, 'stagger'),
        rotation: 0,
      });
    });
  }

  return keys;
}

function buildThumbKeys(): ThumbKey[] {
  const left: ThumbKey[] = LEFT_THUMBS.map((spec) => ({
    kind: 'thumb',
    index: spec.index,
    hand: 'left',
    finger: 'thumb',
    row: 'thumb',
    arc: spec.arc,
    x: spec.x,
    y: spec.y,
    rotation: spec.rotation,
  }));

  const byIndex = new Map(LEFT_THUMBS.map((spec) => [spec.index, spec]));

  const right: ThumbKey[] = [...THUMB_MIRRORS].map(([rightIndex, leftIndex]) => {
    const source = byIndex.get(leftIndex);
    if (source === undefined) {
      throw new RangeError(
        `Glove80 geometry: position ${rightIndex} mirrors ${leftIndex}, which is not a left thumb key`,
      );
    }
    return {
      kind: 'thumb',
      index: rightIndex,
      hand: 'right',
      finger: 'thumb',
      row: 'thumb',
      arc: source.arc,
      // The whole board mirrors about MIRROR_AXIS_X, thumbs included.
      x: 2 * MIRROR_AXIS_X - source.x,
      y: source.y,
      rotation: -source.rotation,
    };
  });

  return [...left, ...right];
}

const keys: readonly KeyPosition[] = [...buildColumnKeys(), ...buildThumbKeys()].sort(
  (a, b) => a.index - b.index,
);

export const GLOVE80: BoardDefinition = {
  id: 'glove80',
  name: 'MoErgo Glove80',
  keyCount: KEY_COUNT,
  keys,
  // Positions 35 to 44 are the ten keys the fingers rest on.
  homePositions: [35, 36, 37, 38, 39, 40, 41, 42, 43, 44],
  // The board has two space bars; this is the one a typist should use.
  spacePosition: 74,
  recommendedShift: { left: 46, right: 63 },
  render: { keyPitch: 54, capSize: 47, mirrorAxisX: MIRROR_AXIS_X },
};

assertValidBoard(GLOVE80);
