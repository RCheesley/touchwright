/**
 * Physical description of a keyboard, independent of what is mapped onto it.
 *
 * A board says where the keys are and which finger owns each one. A keymap says
 * what each position types. Keeping them apart is what lets a second board be a
 * data file rather than a rewrite.
 */

export const FINGERS = ['pinky', 'ring', 'middle', 'index', 'thumb'] as const;
export type Finger = (typeof FINGERS)[number];

export const HANDS = ['left', 'right'] as const;
export type Hand = (typeof HANDS)[number];

export const ROWS = ['function', 'number', 'upper', 'home', 'lower', 'bottom', 'thumb'] as const;
export type Row = (typeof ROWS)[number];

/** Columns a finger reaches for rather than rests on. */
export const REACHES = ['natural', 'outer', 'inner'] as const;
export type Reach = (typeof REACHES)[number];

export type ColumnFinger = Exclude<Finger, 'thumb'>;
export type ColumnRow = Exclude<Row, 'thumb'>;

/** A key in the main keywell, addressed by row and column. */
export interface ColumnKey {
  readonly kind: 'column';
  readonly index: number;
  readonly hand: Hand;
  readonly finger: ColumnFinger;
  readonly reach: Reach;
  readonly row: ColumnRow;
  /** Rows relative to the home row, which is zero. Negative is further away. */
  readonly rowOffset: number;
  readonly column: number;
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
}

/** A key in a thumb cluster. It has no row or column; it has an arc. */
export interface ThumbKey {
  readonly kind: 'thumb';
  readonly index: number;
  readonly hand: Hand;
  readonly finger: 'thumb';
  readonly row: 'thumb';
  readonly arc: 'upper' | 'lower';
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
}

/**
 * Discriminated rather than one shape with nullable fields, so that asking a
 * thumb key for its column is a type error instead of a runtime undefined.
 */
export type KeyPosition = ColumnKey | ThumbKey;

export interface BoardDefinition {
  readonly id: string;
  readonly name: string;
  /** Length of the flat keymap array this board expects. */
  readonly keyCount: number;
  readonly keys: readonly KeyPosition[];
  /** Positions the fingers rest on. */
  readonly homePositions: readonly number[];
  /** The space bar a typist should actually use, where a board offers several. */
  readonly spacePosition: number;
  /**
   * Ergonomic guidance, not keymap fact: the shift a typist should reach for
   * with each hand. A keymap may bind shift to other positions too; those are
   * discovered from the bindings, not from here.
   */
  readonly recommendedShift: { readonly left: number; readonly right: number };
  readonly render: {
    /** Distance between key centres, in the same units as x and y. */
    readonly keyPitch: number;
    readonly capSize: number;
    /** x that the two halves mirror about. */
    readonly mirrorAxisX: number;
  };
}

export class InvalidBoardError extends Error {
  override readonly name = 'InvalidBoardError';
  constructor(boardId: string, problem: string) {
    super(`Board "${boardId}" is invalid: ${problem}`);
  }
}

/**
 * Checked at registration rather than trusted, because board definitions are
 * meant to be contributed as data and a malformed one should fail loudly here
 * instead of producing a silently wrong lesson ladder later.
 */
export function assertValidBoard(board: BoardDefinition): void {
  const { id, keyCount, keys } = board;

  if (!Number.isInteger(keyCount) || keyCount <= 0) {
    throw new InvalidBoardError(id, `keyCount must be a positive integer, got ${String(keyCount)}`);
  }
  if (keys.length !== keyCount) {
    throw new InvalidBoardError(id, `keyCount is ${keyCount} but ${keys.length} keys are defined`);
  }

  const seen = new Set<number>();
  for (const key of keys) {
    if (!Number.isInteger(key.index) || key.index < 0 || key.index >= keyCount) {
      throw new InvalidBoardError(
        id,
        `key index ${String(key.index)} is outside 0..${keyCount - 1}`,
      );
    }
    if (seen.has(key.index)) {
      throw new InvalidBoardError(id, `key index ${key.index} is defined more than once`);
    }
    seen.add(key.index);

    if (!Number.isFinite(key.x) || !Number.isFinite(key.y) || !Number.isFinite(key.rotation)) {
      throw new InvalidBoardError(id, `key index ${key.index} has a non-finite coordinate`);
    }
  }
  if (seen.size !== keyCount) {
    const missing = [...Array(keyCount).keys()].filter((i) => !seen.has(i));
    throw new InvalidBoardError(id, `no key defined at position(s) ${missing.join(', ')}`);
  }

  for (const position of [
    ...board.homePositions,
    board.spacePosition,
    board.recommendedShift.left,
    board.recommendedShift.right,
  ]) {
    if (!seen.has(position)) {
      throw new InvalidBoardError(
        id,
        `references position ${position}, which the board does not define`,
      );
    }
  }
}

/** Index by position for the many lookups that need it. */
export function indexKeys(board: BoardDefinition): ReadonlyMap<number, KeyPosition> {
  return new Map(board.keys.map((key) => [key.index, key]));
}

/**
 * The primary channel for telling a learner where to go. Colour only ever
 * reinforces this, it never replaces it.
 */
export function describeKey(key: KeyPosition): string {
  if (key.kind === 'thumb') {
    return `${key.hand} thumb, ${key.arc} arc`;
  }
  const reach =
    key.reach === 'natural' ? '' : key.reach === 'outer' ? ' (outer reach)' : ' (inner reach)';
  return `${key.hand} hand, ${key.finger}${reach}, ${key.row} row`;
}
