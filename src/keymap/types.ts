import type { Hand } from '../board/types.js';

/** One entry in a ZMK keymap layer, e.g. `&kp A` or `&lt 1`. */
export interface KeyBinding {
  readonly behaviour: string;
  readonly params: readonly string[];
}

/** A base-layer position that produces a character a learner can be asked to type. */
export interface TypedKey {
  readonly position: number;
  readonly keycode: string;
  /** The unshifted character. */
  readonly character: string;
}

/** A base-layer position that produces no character: a modifier, layer key or arrow. */
export interface UntypedKey {
  readonly position: number;
  readonly behaviour: string;
  readonly keycode: string | null;
  readonly reason: 'not-a-keypress' | 'no-character-for-keycode';
}

export interface Keymap {
  readonly boardId: string;
  readonly title: string;
  readonly localeId: string;
  readonly layerNames: readonly string[];
  readonly layers: readonly (readonly KeyBinding[])[];

  readonly typedKeys: readonly TypedKey[];
  readonly untypedKeys: readonly UntypedKey[];

  readonly positionToChar: ReadonlyMap<number, string>;
  /** Where to send the learner for a character. One position per character. */
  readonly charToPosition: ReadonlyMap<string, number>;
  /** Shifted character -> the unshifted character sharing its position. */
  readonly shiftPairs: ReadonlyMap<string, string>;
  /** Every position bound to a shift, grouped by hand. */
  readonly shiftPositions: Readonly<Record<Hand, readonly number[]>>;
  /**
   * Characters bound at more than one position, with the ones not chosen. Kept
   * because a board with two space bars is normal and the UI should be able to
   * say which one it is teaching.
   */
  readonly duplicates: ReadonlyMap<string, readonly number[]>;
}

export class InvalidLayoutError extends Error {
  override readonly name = 'InvalidLayoutError';
  constructor(problem: string, options?: ErrorOptions) {
    super(`This does not look like a valid layout export: ${problem}`, options);
  }
}
