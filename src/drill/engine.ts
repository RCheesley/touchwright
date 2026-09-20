/**
 * The drill engine: a pure state machine that turns keystrokes into progress
 * through a drill.
 *
 * Three constraints shape everything here, and each one is a bug the prototype
 * shipped.
 *
 * **No DOM.** The engine takes input and returns state. ESLint enforces it. That
 * is what makes the functional tests cheap and the regression suite possible.
 *
 * **No timers.** The clock arrives as `now()` and the UI drives elapsed time by
 * calling `checkTimeLimit()`. An interval owned by the engine outlived its drill
 * once already, and because an untimed drill carried a limit of zero it then
 * killed every drill that followed. Every time-limit question goes through
 * `limits.ts`, where `NO_LIMIT` is a real state rather than a missing number.
 *
 * **Nothing is swallowed and nothing is half-applied.** A keystroke is computed,
 * offered to the observer, and only then committed. An observer that throws gets
 * its error surfaced with the original attached as `cause`, and the drill is left
 * intact and resumable rather than quietly marked complete.
 */

import { hasReachedLimit, isTimed, NO_LIMIT, remainingMs as remainingLimitMs } from './limits.js';
import { emptyProgress, keyStatId, readProgress, type KeyStat } from '../stats/storage.js';
import type { Progress } from '../stats/storage.js';
import type {
  BackspaceOutcome,
  ContinueDecision,
  Drill,
  DrillOptions,
  DrillResult,
  DrillStatus,
  KeystrokeObserver,
  KeystrokeRecord,
  Mark,
  NextKey,
  PerKeyStats,
  PressOutcome,
} from './types.js';

/**
 * How long after a drill ends keystrokes are ignored. Long enough that the
 * overrun of someone still typing cannot skip the result, short enough that the
 * app never feels dead.
 */
export const CONTINUE_GRACE_MS = 350;

/**
 * Intervals longer than this are counted as hits but not as timing samples: a
 * pause is not evidence about a key.
 */
export const TIMING_SAMPLE_MAX_MS = 3000;

/**
 * Keys that must never carry the learner on from the result. Modifiers because
 * they are not a keystroke, and Tab because it belongs to focus navigation,
 * which the drill surface must never trap.
 */
const NON_CONTINUE_KEYS: ReadonlySet<string> = new Set([
  'Shift',
  'Control',
  'Alt',
  'AltGraph',
  'Meta',
  'CapsLock',
  'NumLock',
  'ScrollLock',
  'Fn',
  'FnLock',
  'Hyper',
  'Super',
  'Symbol',
  'SymbolLock',
  'Tab',
  'Dead',
  'Unidentified',
]);

export class InvalidDrillTextError extends RangeError {
  override readonly name = 'InvalidDrillTextError';
  constructor(problem: string) {
    super(`A drill needs usable text: ${problem}`);
  }
}

export class InvalidKeystrokeError extends RangeError {
  override readonly name = 'InvalidKeystrokeError';
  constructor(value: unknown) {
    super(
      `A keystroke must be exactly one character, got ${typeof value === 'string' ? JSON.stringify(value) : String(value)}`,
    );
  }
}

export class InvalidClockError extends TypeError {
  override readonly name = 'InvalidClockError';
  constructor(problem: string) {
    super(`The drill clock is unusable: ${problem}`);
  }
}

/**
 * A keystroke observer threw. The drill is untouched and resumable; this is
 * raised so the UI can say so instead of the drill ending on a hidden crash.
 */
export class KeystrokeHandlerError extends Error {
  override readonly name = 'KeystrokeHandlerError';
  constructor(
    readonly record: KeystrokeRecord,
    options: { cause: unknown },
  ) {
    super(
      `A keystroke handler threw on ${JSON.stringify(record.typed)} at index ${record.index}; the drill is unchanged`,
      options,
    );
  }
}

/** Internal invariant break. Thrown rather than guessed at, so it cannot hide. */
class DrillInvariantError extends Error {
  override readonly name = 'DrillInvariantError';
  constructor(problem: string) {
    super(`Drill engine invariant broken: ${problem}`);
  }
}

function requireDrillText(value: unknown): readonly string[] {
  if (typeof value !== 'string') {
    throw new InvalidDrillTextError(`expected a string, got ${typeof value}`);
  }
  if (value.length === 0) {
    throw new InvalidDrillTextError('the text is empty');
  }
  // Split by code point, so a character outside the BMP is one position rather
  // than two halves of a surrogate pair that can never be typed. Code points,
  // not grapheme clusters, because a keystroke produces one code point and
  // per-key statistics are keyed by code point.
  return Array.from(value);
}

function requireSingleCharacter(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new InvalidKeystrokeError(value);
  }
  const first = String.fromCodePoint(value.codePointAt(0) ?? Number.NaN);
  if (first !== value) {
    throw new InvalidKeystrokeError(value);
  }
  return value;
}

function requireClock(value: unknown): () => number {
  if (typeof value !== 'function') {
    throw new InvalidClockError(`expected a function, got ${typeof value}`);
  }
  return value as () => number;
}

function emptyKeyStat(): KeyStat {
  return { hits: 0, misses: 0, totalMs: 0, samples: 0 };
}

class DrillMachine implements Drill {
  readonly text: string;
  readonly characters: readonly string[];
  readonly limitMs: number;

  private readonly clock: () => number;
  private readonly observer: KeystrokeObserver | null;
  private readonly markState: Mark[];

  private cursorIndex = 0;
  private startedAt: number | null = null;
  private lastKeystrokeAt: number | null = null;
  private finishedAt: number | null = null;
  /** Highest elapsed seen, so a clock that steps backwards cannot rewind time. */
  private elapsedHighWater = 0;
  private correct = 0;
  private total = 0;
  private readonly stats = new Map<string, KeyStat>();
  private finishedResult: DrillResult | null = null;

  constructor(options: DrillOptions) {
    this.characters = requireDrillText(options.text);
    this.text = this.characters.join('');
    const limitMs = options.limitMs ?? NO_LIMIT;
    // Validates as a side effect: a nonsensical limit throws here rather than
    // producing a drill that behaves strangely later.
    isTimed(limitMs);
    this.limitMs = limitMs;
    this.clock = requireClock(options.now ?? Date.now);
    this.observer = options.onKeystroke ?? null;
    this.markState = this.characters.map(() => 'pending');
  }

  private readClock(): number {
    const reading = this.clock();
    if (typeof reading !== 'number' || !Number.isFinite(reading)) {
      throw new InvalidClockError(`now() returned ${String(reading)}`);
    }
    return reading;
  }

  get status(): DrillStatus {
    if (this.finishedResult !== null) return 'finished';
    return this.startedAt === null ? 'awaiting-first-keystroke' : 'running';
  }

  get hasStarted(): boolean {
    return this.startedAt !== null;
  }

  get isFinished(): boolean {
    return this.finishedResult !== null;
  }

  get cursor(): number {
    return this.cursorIndex;
  }

  /** A copy, so no caller can reach in and rewrite the drill's history. */
  get marks(): readonly Mark[] {
    return [...this.markState];
  }

  get next(): NextKey | null {
    if (this.finishedResult !== null) return null;
    const character = this.characters[this.cursorIndex];
    if (character === undefined) return null;
    return { index: this.cursorIndex, character };
  }

  get correctKeystrokes(): number {
    return this.correct;
  }

  get totalKeystrokes(): number {
    return this.total;
  }

  get startedAtMs(): number | null {
    return this.startedAt;
  }

  get result(): DrillResult | null {
    return this.finishedResult;
  }

  elapsedMs(): number {
    if (this.finishedResult !== null) return this.finishedResult.elapsedMs;
    if (this.startedAt === null) return 0;
    return this.measureElapsed(this.readClock(), this.startedAt);
  }

  /**
   * Wall clocks can step backwards, and elapsed time must not, or
   * `hasReachedLimit` would be asked about a negative duration and rightly
   * refuse it. So the highest reading is latched. That is a record of time
   * observed, which passes whether or not a keystroke is committed.
   */
  private measureElapsed(at: number, startedAt: number): number {
    const raw = at - startedAt;
    const elapsed = Math.max(this.elapsedHighWater, raw > 0 ? raw : 0);
    this.elapsedHighWater = elapsed;
    return elapsed;
  }

  remainingMs(): number | null {
    return remainingLimitMs(this.elapsedMs(), this.limitMs);
  }

  checkTimeLimit(): DrillResult | null {
    if (this.finishedResult !== null) return this.finishedResult;
    // An untimed drill can never run out, and a drill nobody has started yet has
    // no elapsed time to compare. Both are asked through limits.ts.
    if (this.startedAt === null || !isTimed(this.limitMs)) return null;
    const at = this.readClock();
    const elapsed = this.measureElapsed(at, this.startedAt);
    if (!hasReachedLimit(elapsed, this.limitMs)) return null;
    return this.finish({ completed: false, at, elapsedMs: elapsed });
  }

  perKey(): PerKeyStats {
    return snapshotStats(this.stats);
  }

  press(character: string): PressOutcome {
    const typed = requireSingleCharacter(character);
    if (this.finishedResult !== null) {
      return { kind: 'ignored', reason: 'finished', result: this.finishedResult };
    }

    const at = this.readClock();
    const startedAt = this.startedAt ?? at;
    const elapsed = this.measureElapsed(at, startedAt);

    // A drill that has already run out ends on this keystroke rather than
    // counting it. An untimed drill answers no here, always.
    if (this.startedAt !== null && hasReachedLimit(elapsed, this.limitMs)) {
      return {
        kind: 'ignored',
        reason: 'out-of-time',
        result: this.finish({ completed: false, at, elapsedMs: elapsed }),
      };
    }

    const index = this.cursorIndex;
    const expected = this.characters[index];
    if (expected === undefined) {
      throw new DrillInvariantError(
        `cursor is at ${index} but the text has ${this.characters.length} characters`,
      );
    }

    const sincePrevious = at - (this.lastKeystrokeAt ?? startedAt);
    const intervalMs = sincePrevious > 0 ? sincePrevious : 0;
    const correct = typed === expected;
    const record: KeystrokeRecord = {
      index,
      expected,
      typed,
      correct,
      // Keyed by code point, never by the character: a full stop or a space as a
      // field name made writes fail silently.
      keyId: keyStatId(expected),
      intervalMs,
      elapsedMs: elapsed,
      // The first keystroke of a drill has nothing to measure from, so it is a
      // hit with no timing sample rather than a suspiciously fast one.
      timingSample: correct && intervalMs > 0 && intervalMs < TIMING_SAMPLE_MAX_MS,
    };

    // Offer the keystroke before committing any of it. If the observer throws,
    // the drill has not moved, nothing has been recorded, and the drill is not
    // complete: the error is surfaced and the learner can carry on.
    if (this.observer !== null) {
      try {
        this.observer(record);
      } catch (cause) {
        throw new KeystrokeHandlerError(record, { cause });
      }
    }

    this.commit(record, at, startedAt);

    const finishedNow =
      this.cursorIndex >= this.characters.length
        ? this.finish({ completed: true, at, elapsedMs: elapsed })
        : null;

    return correct
      ? { kind: 'correct', index, character: expected, result: finishedNow }
      : { kind: 'wrong', index, expected, typed, result: finishedNow };
  }

  private commit(record: KeystrokeRecord, at: number, startedAt: number): void {
    this.startedAt = startedAt;
    this.lastKeystrokeAt = at;
    this.total += 1;
    if (record.correct) this.correct += 1;
    this.markState[record.index] = record.correct ? 'correct' : 'wrong';

    const stat = this.stats.get(record.keyId) ?? emptyKeyStat();
    if (record.correct) {
      stat.hits += 1;
      if (record.timingSample) {
        stat.totalMs += record.intervalMs;
        stat.samples += 1;
      }
    } else {
      // The miss belongs to the key the learner failed to hit, which is the one
      // the drill asked for.
      stat.misses += 1;
    }
    this.stats.set(record.keyId, stat);

    this.cursorIndex = record.index + 1;
  }

  backspace(): BackspaceOutcome {
    if (this.finishedResult !== null) return { kind: 'ignored', reason: 'finished' };
    if (this.cursorIndex === 0) return { kind: 'ignored', reason: 'at-start' };

    const index = this.cursorIndex - 1;
    const cleared = this.markState[index];
    if (cleared === undefined) {
      throw new DrillInvariantError(`no mark at index ${index}`);
    }
    // Only the mark and the cursor move. The keystroke counters are a record of
    // what was actually typed, and a correction does not unmake a keystroke.
    this.markState[index] = 'pending';
    this.cursorIndex = index;
    return { kind: 'stepped-back', index, cleared };
  }

  requestContinue(key: string): ContinueDecision {
    const pressed = requireContinueKey(key);
    if (this.finishedResult === null || this.finishedAt === null) {
      return { accepted: false, reason: 'not-finished', remainingGraceMs: 0 };
    }

    const sinceFinish = Math.max(0, this.readClock() - this.finishedAt);
    const remainingGraceMs = Math.max(0, CONTINUE_GRACE_MS - sinceFinish);
    if (remainingGraceMs > 0) {
      return { accepted: false, reason: 'within-grace', remainingGraceMs };
    }
    // An empty key is what a browser reports for some composition events. It is
    // not a keystroke, so it is refused rather than treated as one.
    if (pressed.length === 0 || NON_CONTINUE_KEYS.has(pressed)) {
      return { accepted: false, reason: 'not-a-continue-key', remainingGraceMs: 0 };
    }
    // Any other key. Accepting only space made the app look dead to someone who
    // was still typing.
    return { accepted: true, reason: 'accepted', remainingGraceMs: 0 };
  }

  private finish(ending: { completed: boolean; at: number; elapsedMs: number }): DrillResult {
    if (this.finishedResult !== null) return this.finishedResult;
    this.elapsedHighWater = ending.elapsedMs;
    this.finishedAt = ending.at;
    const result: DrillResult = Object.freeze({
      correctKeystrokes: this.correct,
      totalKeystrokes: this.total,
      elapsedMs: ending.elapsedMs,
      perKey: snapshotStats(this.stats),
      completed: ending.completed,
    });
    this.finishedResult = result;
    return result;
  }
}

/**
 * Looser than `requireSingleCharacter`, because a key name such as `Enter` is a
 * perfectly good way to continue. A non-string is still a programming error and
 * throws.
 */
function requireContinueKey(value: unknown): string {
  if (typeof value !== 'string') {
    throw new InvalidKeystrokeError(value);
  }
  return value;
}

/** A detached copy, so a result can never be edited through the live drill. */
function snapshotStats(stats: ReadonlyMap<string, KeyStat>): PerKeyStats {
  const copy = new Map<string, KeyStat>();
  for (const [keyId, stat] of stats) {
    copy.set(keyId, { ...stat });
  }
  return copy;
}

export function createDrill(options: DrillOptions): Drill {
  return new DrillMachine(options);
}

/**
 * What an arriving load did, so the UI can say so rather than guess.
 */
export interface AppliedLoad {
  /** True when the lesson was taken from the load. False mid-drill. */
  readonly lessonApplied: boolean;
  /** True when a started, unfinished drill was protected from the load. */
  readonly drillInProgress: boolean;
  readonly mergedKeys: number;
  /** Non-fatal problems from reading the load, for the UI to surface. */
  readonly warnings: readonly string[];
}

export interface DrillSessionOptions {
  readonly progress?: Progress;
  readonly now?: () => number;
}

/**
 * Holds the live progress and the current drill.
 *
 * It exists because of one specific failure: saved progress arrives a second or
 * two after first paint, and rebuilding the drill on arrival replaced the text
 * the learner was partway through. So the session, not the loader, decides what
 * an arriving load is allowed to touch.
 */
export interface DrillSession {
  readonly progress: Progress;
  readonly drill: Drill | null;
  /** A drill that has been started and not finished. */
  readonly drillInProgress: boolean;
  /** Starts a fresh drill. Nothing carries over from the previous one. */
  start(options: DrillOptions): Drill;
  /**
   * Merge progress that has arrived from storage. Statistics always merge; the
   * lesson is only taken when no drill is in progress, and the running drill's
   * text, cursor, marks and start time are never touched.
   */
  applyLoadedProgress(loaded: unknown): AppliedLoad;
}

class Session implements DrillSession {
  private readonly clock: () => number;
  private readonly live: Progress;
  private currentDrill: Drill | null = null;

  constructor(options: DrillSessionOptions) {
    this.clock = requireClock(options.now ?? Date.now);
    this.live = options.progress ?? emptyProgress();
  }

  get progress(): Progress {
    return this.live;
  }

  get drill(): Drill | null {
    return this.currentDrill;
  }

  get drillInProgress(): boolean {
    const drill = this.currentDrill;
    if (drill === null) return false;
    return drill.hasStarted && !drill.isFinished;
  }

  start(options: DrillOptions): Drill {
    const caller = options.onKeystroke ?? null;
    const drill = createDrill({
      text: options.text,
      limitMs: options.limitMs ?? NO_LIMIT,
      now: options.now ?? this.clock,
      onKeystroke: (record) => {
        // The caller's observer runs first, so if it throws nothing has been
        // written to progress for that keystroke.
        if (caller !== null) caller(record);
        this.record(record);
      },
    });
    this.currentDrill = drill;
    return drill;
  }

  private record(record: KeystrokeRecord): void {
    const existing = this.live.keyStats[record.keyId];
    const stat: KeyStat = existing ?? emptyKeyStat();
    if (record.correct) {
      stat.hits += 1;
      if (record.timingSample) {
        stat.totalMs += record.intervalMs;
        stat.samples += 1;
      }
    } else {
      stat.misses += 1;
    }
    // Assigned unconditionally, so a frozen progress object throws here rather
    // than silently dropping the write.
    this.live.keyStats[record.keyId] = stat;
  }

  applyLoadedProgress(loaded: unknown): AppliedLoad {
    // Everything crossing into live state is validated and thawed at the
    // boundary; a frozen graph from another realm must never reach the recorder.
    const { progress: incoming, warnings } = readProgress(loaded);
    const protectDrill = this.drillInProgress;

    this.live.xp = Math.max(this.live.xp, incoming.xp);

    for (const [lessonId, stars] of Object.entries(incoming.stars)) {
      this.live.stars[lessonId] = Math.max(this.live.stars[lessonId] ?? 0, stars);
    }

    let mergedKeys = 0;
    for (const [keyId, stat] of Object.entries(incoming.keyStats)) {
      const existing = this.live.keyStats[keyId];
      // Field-wise maximum rather than a sum: the saved record already contains
      // what earlier sessions wrote, so summing would double-count every reload,
      // and replacing would throw away the keystrokes typed since first paint.
      this.live.keyStats[keyId] =
        existing === undefined
          ? { ...stat }
          : {
              hits: Math.max(existing.hits, stat.hits),
              misses: Math.max(existing.misses, stat.misses),
              totalMs: Math.max(existing.totalMs, stat.totalMs),
              samples: Math.max(existing.samples, stat.samples),
            };
      mergedKeys += 1;
    }

    // The lesson is the one field that would move the ground under a learner who
    // is partway through a drill, so mid-drill it is left alone.
    if (!protectDrill) {
      this.live.lesson = Math.max(this.live.lesson, incoming.lesson);
    }

    return {
      lessonApplied: !protectDrill,
      drillInProgress: protectDrill,
      mergedKeys,
      warnings,
    };
  }
}

export function createDrillSession(options: DrillSessionOptions = {}): DrillSession {
  return new Session(options);
}
