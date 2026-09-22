/**
 * Sprint mode: a timed run across everything unlocked, for measuring rather
 * than learning.
 *
 * Two jobs live here, and both are DOM-free like the rest of this layer.
 *
 * **What a sprint is made of.** `sprintLesson` folds every lesson the learner
 * has reached into one synthetic lesson, so the text generator can be handed a
 * sprint the same way it is handed a rung. A sprint is not lesson zero and it is
 * not the current lesson: it is all of them at once, which is the only reason it
 * measures anything.
 *
 * **The timer, and why it is here rather than in the UI.** Regression 3 is the
 * nastiest failure this project shipped: an abandoned sprint left its interval
 * running, the interval then acted on whichever drill was current, and because
 * an untimed drill carried a limit of zero, "elapsed is at least the limit" was
 * true on the very first keystroke. Every drill after that died instantly.
 *
 * Half of that is fixed in `limits.ts`, where `NO_LIMIT` is a real state. The
 * other half is fixed here, structurally: `startSprintTimer` captures the one
 * `Drill` it is for and never looks a drill up again. It also demands a
 * `currentDrill` reader and compares it with that captured object **by
 * identity** on every single tick, stopping itself the moment they differ. So a
 * teardown that is missed — which is exactly how this happened the first time —
 * costs one tick of nothing, not every drill that follows. The binding is a
 * required argument rather than a convention, so it cannot be forgotten: there
 * is no way to construct a timer that is not bound to a drill.
 *
 * The repeating callback itself is injected. Nothing in `src/drill/**` reaches
 * for `setInterval`, so every test drives this by calling the tick directly and
 * the engine's "the UI drives elapsed time" rule survives intact.
 */

import type { Lesson } from '../ladder/generate.js';
import { describeLimit, isTimed } from './limits.js';
import type { Drill, DrillResult } from './types.js';

export class SprintError extends Error {
  override readonly name = 'SprintError';
  constructor(problem: string, options?: ErrorOptions) {
    super(`Cannot build a sprint: ${problem}`, options);
  }
}

/**
 * A tick that failed. Thrown rather than swallowed, with the original attached,
 * and the timer is stopped first so a broken observer cannot leave an interval
 * running — which is the shape of the bug this module exists to prevent.
 */
export class SprintTimerError extends Error {
  override readonly name = 'SprintTimerError';
  constructor(options: ErrorOptions) {
    super('The sprint timer failed on a tick, so it has stopped itself.', options);
  }
}

/**
 * The id the synthetic sprint lesson carries. It is deliberately not an id any
 * generated ladder uses, because a sprint must never be able to write stars to a
 * rung: scoring refuses stars outside lesson mode, and this is the second lock
 * on the same door.
 */
export const SPRINT_LESSON_ID = 'sprint';

export const SPRINT_LESSON_NAME = 'Sprint';

/**
 * One lesson standing for everything unlocked.
 *
 * Lessons are cumulative, so the last unlocked rung's key set is already the
 * whole of it; the union is taken anyway because "every key unlocked" is the
 * thing being asked for, and a ladder that ever stops being cumulative should
 * change the sprint rather than quietly narrow it.
 *
 * The stage is the reached lesson's own stage, so a sprint drills prose once the
 * ladder has reached prose and capitals once it has reached capitals, and never
 * asks for a character the learner has not been shown.
 */
export function sprintLesson(lessons: readonly Lesson[], unlockedIndex: number): Lesson {
  if (lessons.length === 0) {
    throw new SprintError('this layout produced no ladder, so nothing is unlocked');
  }
  if (!Number.isInteger(unlockedIndex) || unlockedIndex < 0) {
    throw new SprintError(
      `the unlocked lesson index must be a non-negative whole number, got ${String(unlockedIndex)}`,
    );
  }
  // Clamped rather than refused: an imported progress file may have come from a
  // longer ladder than this layout produces, and sprinting everything this
  // ladder has is the right answer to that.
  const reachedIndex = Math.min(unlockedIndex, lessons.length - 1);
  const reached = lessons[reachedIndex];
  if (reached === undefined) {
    // Unreachable given the clamp above; prefer throwing to inventing a lesson.
    throw new SprintError(`no lesson at index ${reachedIndex} of ${lessons.length}`);
  }

  const keys: string[] = [];
  for (const lesson of lessons.slice(0, reachedIndex + 1)) {
    for (const key of lesson.keys) {
      if (!keys.includes(key)) keys.push(key);
    }
  }
  if (keys.length === 0) {
    throw new SprintError('the lessons unlocked so far contain no keys');
  }

  const rungs = reachedIndex + 1;
  return {
    id: SPRINT_LESSON_ID,
    name: SPRINT_LESSON_NAME,
    blurb:
      `Everything you have unlocked at once: ${keys.length} keys from ` +
      `${rungs === 1 ? '1 lesson' : `${rungs} lessons`}. A sprint measures where you are; ` +
      'it earns no stars.',
    addedKeys: [],
    keys,
    stage: reached.stage,
  };
}

/**
 * A brisk pace, used only to decide how much text a sprint needs. Higher than
 * anyone is expected to type, because a sprint that runs out of words before it
 * runs out of time stops measuring and starts being a lesson.
 */
export const SPRINT_PACE_WPM = 70;
/** Enough to score honestly even on the shortest sprint. */
export const SPRINT_MIN_WORDS = 24;
/** Past this the page is long enough that nobody reaches the end anyway. */
export const SPRINT_MAX_WORDS = 200;
/** An untimed sprint has to be finishable, so it gets a fixed length. */
export const SPRINT_UNTIMED_WORDS = 48;

export function sprintWordCount(limitMs: number): number {
  if (!isTimed(limitMs)) return SPRINT_UNTIMED_WORDS;
  const words = Math.ceil((limitMs / 60_000) * SPRINT_PACE_WPM);
  return Math.min(SPRINT_MAX_WORDS, Math.max(SPRINT_MIN_WORDS, words));
}

/**
 * A duration as a learner would choose it, for a control's option text. Not
 * `describeLimit` itself, because "untimed" on its own reads like a missing
 * value in a list of durations, and untimed is the opposite of missing.
 */
export function describeDurationChoice(limitMs: number): string {
  if (!isTimed(limitMs)) return 'Untimed — no limit, it never runs out';
  return describeLimit(limitMs);
}

/**
 * A duration chosen in the UI, checked against the durations actually offered.
 *
 * Prefer throwing to a wrong default: a limit that arrived from a control this
 * module did not populate is a sign the markup and the module have drifted, and
 * silently sprinting for a minute instead would be a wrong answer nobody sees.
 */
export function parseSprintLimit(value: string, durations: readonly number[]): number {
  // Checked before `Number`, because `Number('')` is zero and zero is `NO_LIMIT`:
  // an empty control would otherwise read as a deliberate choice of untimed.
  // Absent, zero and malformed are three different things.
  if (value.trim() === '') {
    throw new SprintError('no duration was chosen; an empty control is not the untimed option');
  }
  const limitMs = Number(value);
  if (!Number.isFinite(limitMs) || !durations.includes(limitMs)) {
    throw new SprintError(
      `${JSON.stringify(value)} is not one of the durations on offer (${durations.join(', ')})`,
    );
  }
  return limitMs;
}

/** Seconds left, rounded up, so the readout only reads zero when it is. */
export function secondsLeft(remainingMs: number): number {
  if (!Number.isFinite(remainingMs) || remainingMs < 0) {
    throw new RangeError(
      `Remaining time must be a non-negative number, got ${String(remainingMs)}`,
    );
  }
  return Math.ceil(remainingMs / 1000);
}

/**
 * The visible countdown.
 *
 * `null` means untimed, as it does everywhere else in this layer, and it says so
 * in words rather than showing a dash or a frozen zero.
 */
export function describeCountdown(remainingMs: number | null): string {
  if (remainingMs === null) return 'Untimed sprint. There is no time limit, so it never runs out.';
  const seconds = secondsLeft(remainingMs);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `Time left: ${minutes}:${String(rest).padStart(2, '0')}`;
}

/**
 * When to say something out loud, longest first.
 *
 * The countdown is a visible readout and nothing announces it, because a region
 * that spoke every second would make the drill unusable with a screen reader.
 * These milestones are the other channel: a handful of polite announcements, so
 * the time running out is never something only a sighted learner can know.
 */
export const SPRINT_WARNINGS_MS: readonly number[] = [60_000, 30_000, 10_000];

export interface SprintWarnings {
  /** What to announce now, or null when nothing is due. Never repeats itself. */
  due(remainingMs: number | null): string | null;
  /** The thresholds this sprint is long enough to use. */
  readonly armed: readonly number[];
}

/**
 * Milestone announcements for one sprint.
 *
 * A threshold at or above the whole limit is dropped: announcing "1 minute left"
 * as a one-minute sprint starts is noise, not information. Each armed threshold
 * fires once, and a tick that skips past several fires only the tightest of
 * them, so a slow tick cannot produce a burst.
 */
export function createSprintWarnings(
  limitMs: number,
  thresholds: readonly number[] = SPRINT_WARNINGS_MS,
): SprintWarnings {
  const armed = isTimed(limitMs)
    ? [...thresholds]
        .filter((threshold) => threshold > 0 && threshold < limitMs)
        .sort((a, b) => b - a)
    : [];
  const fired = new Set<number>();

  return {
    armed,
    due(remainingMs: number | null): string | null {
      // An untimed sprint has nothing to warn about, by definition.
      if (remainingMs === null) return null;
      const crossed = armed.filter(
        (threshold) => !fired.has(threshold) && remainingMs <= threshold,
      );
      if (crossed.length === 0) return null;
      for (const threshold of crossed) fired.add(threshold);
      const tightest = Math.min(...crossed);
      return `${describeLimit(tightest)} left in this sprint.`;
    },
  };
}

/** Why a timer stopped. Every path out of a running timer names itself. */
export type SprintStopReason =
  /** Its drill's limit ran out; the result has been handed on. */
  | 'expired'
  /** Its drill finished by being typed through. */
  | 'finished'
  /** Its drill is no longer the current one. This is regression 3's guard. */
  | 'abandoned'
  /** Someone called `stop`. */
  | 'stopped'
  /** A tick threw. The error is rethrown, never swallowed. */
  | 'error';

export interface SprintTimerOptions {
  /**
   * The drill this timer is for. Captured once, here, and never looked up
   * again: every tick acts on this object or on nothing at all.
   */
  readonly drill: Drill;
  /**
   * What the app has on screen now. Compared with `drill` by identity on every
   * tick, and the timer stops itself the instant they differ.
   *
   * Required rather than optional on purpose. The whole of regression 3 was a
   * timer that acted on whichever drill was current, so a timer that cannot be
   * built without being told how to recognise its own drill is the fix.
   */
  readonly currentDrill: () => Drill | null;
  /** Starts the repeating tick, and returns the function that cancels it. */
  readonly schedule: (tick: () => void) => () => void;
  /** Called on each tick the bound drill is still live. `null` when untimed. */
  readonly onTick?: (remainingMs: number | null, drill: Drill) => void;
  /** Called once, with the result, when the bound drill's own limit runs out. */
  readonly onExpire?: (result: DrillResult, drill: Drill) => void;
  readonly onStop?: (reason: SprintStopReason, drill: Drill) => void;
}

export interface SprintTimer {
  /** The one drill this timer may ever act on. */
  readonly drill: Drill;
  readonly stopped: boolean;
  /** Why it stopped, or null while it is still running. */
  readonly stopReason: SprintStopReason | null;
  /** Idempotent. Safe from inside a tick and safe twice. */
  stop(): void;
}

export function startSprintTimer(options: SprintTimerOptions): SprintTimer {
  // Captured once. Nothing below ever reads `options.drill` again, so there is
  // no later moment at which this timer could be pointed at another drill.
  const bound = options.drill;

  let cancel: (() => void) | null = null;
  let stopped = false;
  let stopReason: SprintStopReason | null = null;

  function isStopped(): boolean {
    return stopped;
  }

  function stop(reason: SprintStopReason): void {
    if (stopped) return;
    stopped = true;
    stopReason = reason;
    const cancelNow = cancel;
    cancel = null;
    if (cancelNow !== null) cancelNow();
    options.onStop?.(reason, bound);
  }

  function runTick(): void {
    if (stopped) return;

    // The binding, checked before anything else happens. A timer that has
    // outlived its drill does nothing and takes itself out of the world.
    if (options.currentDrill() !== bound) {
      stop('abandoned');
      return;
    }

    if (bound.isFinished) {
      stop('finished');
      return;
    }

    // Asked of the bound drill, so an untimed drill is asked about its own
    // absent limit and answers null, whatever any other drill's limit is.
    const expired = bound.checkTimeLimit();
    if (expired !== null) {
      // Stopped before the result is handed on, so an observer that throws
      // cannot leave this interval running behind it.
      stop('expired');
      options.onExpire?.(expired, bound);
      return;
    }

    options.onTick?.(bound.remainingMs(), bound);
  }

  function tick(): void {
    try {
      runTick();
    } catch (cause) {
      stop('error');
      throw new SprintTimerError({ cause });
    }
  }

  // Scheduled last, so that everything a tick reads is already in place. A
  // schedule that runs its tick synchronously can therefore stop this timer
  // before it has even handed back a cancel, so that cancel is honoured here
  // rather than quietly dropped and left running.
  const started = options.schedule(tick);
  if (isStopped()) {
    started();
  } else {
    cancel = started;
  }

  return {
    drill: bound,
    get stopped() {
      return stopped;
    },
    get stopReason() {
      return stopReason;
    },
    stop(): void {
      stop('stopped');
    },
  };
}
