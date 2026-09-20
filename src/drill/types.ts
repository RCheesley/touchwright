/**
 * The shapes the drill engine speaks in.
 *
 * Kept apart from the engine so that the UI can depend on the vocabulary
 * without depending on the implementation, and so that every outcome a
 * keystroke can have is written down in one place. Outcomes are discriminated
 * unions rather than booleans with nullable extras, because "ignored because the
 * drill is finished" and "ignored because the time ran out" are different
 * answers and the caller has to be able to tell them apart.
 */

import type { KeyStat } from '../stats/storage.js';

/** What has happened to one position in the drill text. */
export type Mark = 'pending' | 'correct' | 'wrong';

export type DrillStatus = 'awaiting-first-keystroke' | 'running' | 'finished';

/**
 * Per-key statistics, the same shape storage persists. Always keyed by the
 * code-point id from `keyStatId`, never by the character itself.
 */
export type PerKeyStats = ReadonlyMap<string, KeyStat>;

export interface DrillResult {
  readonly correctKeystrokes: number;
  readonly totalKeystrokes: number;
  readonly elapsedMs: number;
  readonly perKey: PerKeyStats;
  /** False when the drill was ended by a time limit rather than by finishing. */
  readonly completed: boolean;
}

/**
 * The next character the learner is expected to type, with its index into the
 * drill's character array, so the UI can look up the board position for it and
 * name hand, finger and row.
 */
export interface NextKey {
  readonly index: number;
  readonly character: string;
}

/**
 * One keystroke, as handed to an observer before the engine commits it. An
 * observer that throws aborts the commit, so the record describes a keystroke
 * that may never have happened.
 */
export interface KeystrokeRecord {
  readonly index: number;
  readonly expected: string;
  readonly typed: string;
  readonly correct: boolean;
  /** Code-point id for the expected character. Never the character itself. */
  readonly keyId: string;
  /** Since the previous keystroke, or since the drill started for the first. */
  readonly intervalMs: number;
  /** Elapsed drill time at this keystroke. */
  readonly elapsedMs: number;
  /**
   * Whether `intervalMs` is usable as a timing sample. A pause for a cup of tea
   * is not evidence about a key, so long intervals are counted as hits without
   * polluting the mean.
   */
  readonly timingSample: boolean;
}

export type KeystrokeObserver = (record: KeystrokeRecord) => void;

export interface DrillOptions {
  readonly text: string;
  /** `NO_LIMIT` (zero) or a positive number of milliseconds. Defaults to untimed. */
  readonly limitMs?: number;
  /**
   * The clock. The engine never creates a timer; the UI drives elapsed time by
   * calling in, which is also what makes these tests deterministic.
   */
  readonly now?: () => number;
  /**
   * Called with each keystroke before the engine commits it. If it throws, the
   * error is surfaced and the drill is left exactly as it was.
   */
  readonly onKeystroke?: KeystrokeObserver;
}

export type PressOutcome =
  | {
      readonly kind: 'correct';
      readonly index: number;
      readonly character: string;
      /** The result, when this keystroke completed the drill. */
      readonly result: DrillResult | null;
    }
  | {
      readonly kind: 'wrong';
      readonly index: number;
      readonly expected: string;
      readonly typed: string;
      readonly result: DrillResult | null;
    }
  | {
      readonly kind: 'ignored';
      readonly reason: 'finished' | 'out-of-time';
      readonly result: DrillResult;
    };

export type BackspaceOutcome =
  | { readonly kind: 'stepped-back'; readonly index: number; readonly cleared: Mark }
  | { readonly kind: 'ignored'; readonly reason: 'at-start' | 'finished' };

/**
 * Whether a key press should carry the learner on from the result screen.
 *
 * `within-grace` exists because accepting the overrun keystroke of someone who
 * was still typing skipped the result before it could be read.
 */
export interface ContinueDecision {
  readonly accepted: boolean;
  readonly reason: 'accepted' | 'not-finished' | 'within-grace' | 'not-a-continue-key';
  /** Milliseconds of grace left, zero once the grace has passed. */
  readonly remainingGraceMs: number;
}

export interface Drill {
  /** The drill text as given. */
  readonly text: string;
  /** The text split into code points; one entry per position a learner types. */
  readonly characters: readonly string[];
  readonly limitMs: number;
  readonly status: DrillStatus;
  readonly hasStarted: boolean;
  readonly isFinished: boolean;
  readonly cursor: number;
  readonly marks: readonly Mark[];
  /** Null once the drill has finished. */
  readonly next: NextKey | null;
  readonly correctKeystrokes: number;
  readonly totalKeystrokes: number;
  /** Null until the first keystroke, which is what starts the clock. */
  readonly startedAtMs: number | null;
  /** The result, or null while the drill is still live. */
  readonly result: DrillResult | null;

  press(character: string): PressOutcome;
  backspace(): BackspaceOutcome;
  /** Elapsed time by the caller's clock. Zero before the first keystroke. */
  elapsedMs(): number;
  /** Null for an untimed drill, so it cannot be mistaken for "no time left". */
  remainingMs(): number | null;
  /**
   * Ask the clock whether a timed drill has run out. The UI calls this; the
   * engine owns no timer of its own. Returns the result if the drill has ended,
   * null while it is still live. Always null for an untimed drill.
   */
  checkTimeLimit(): DrillResult | null;
  /** Statistics so far, keyed by code point. */
  perKey(): PerKeyStats;
  /** Whether this key should carry the learner on from the result. */
  requestContinue(key: string): ContinueDecision;
}
