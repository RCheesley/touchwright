/**
 * Time limits for a drill.
 *
 * Small module, one bug's worth of history. An abandoned sprint left its
 * interval running, the interval then acted on whichever drill was current, and
 * because an untimed drill carried a limit of zero, "elapsed is at least the
 * limit" was true on the very first keystroke. Every drill after that died
 * instantly.
 *
 * So zero means no limit here, and asking whether an untimed drill has run out
 * is always answered no. WCAG 2.2.1 also requires an adjustable or disableable
 * limit, which is the same thing from the other direction: untimed has to be a
 * first-class state, not the absence of a number.
 */

/** An untimed drill. Not a missing value, a real state. */
export const NO_LIMIT = 0;

export class InvalidLimitError extends RangeError {
  override readonly name = 'InvalidLimitError';
  constructor(limitMs: unknown) {
    super(
      `A drill limit must be NO_LIMIT or a positive number of milliseconds, got ${String(limitMs)}`,
    );
  }
}

function checkLimit(limitMs: number): void {
  if (!Number.isFinite(limitMs) || limitMs < 0) {
    throw new InvalidLimitError(limitMs);
  }
}

export function isTimed(limitMs: number): boolean {
  checkLimit(limitMs);
  return limitMs > NO_LIMIT;
}

/** False for an untimed drill, whatever the elapsed time. */
export function hasReachedLimit(elapsedMs: number, limitMs: number): boolean {
  checkLimit(limitMs);
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    throw new RangeError(`Elapsed time must be a non-negative number, got ${String(elapsedMs)}`);
  }
  if (limitMs === NO_LIMIT) return false;
  return elapsedMs >= limitMs;
}

/** Null for an untimed drill, so callers cannot mistake it for "no time left". */
export function remainingMs(elapsedMs: number, limitMs: number): number | null {
  if (!isTimed(limitMs)) return null;
  return Math.max(0, limitMs - elapsedMs);
}

/** Durations a learner may choose, including untimed. WCAG 2.2.1. */
export const SPRINT_DURATIONS_MS: readonly number[] = [NO_LIMIT, 30_000, 60_000, 120_000, 300_000];

export function describeLimit(limitMs: number): string {
  if (!isTimed(limitMs)) return 'untimed';
  const seconds = Math.round(limitMs / 1000);
  if (seconds < 60) return `${seconds} seconds`;
  const minutes = seconds / 60;
  return minutes === 1 ? '1 minute' : `${String(minutes)} minutes`;
}
