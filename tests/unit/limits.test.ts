import { describe, expect, it } from 'vitest';
import {
  describeLimit,
  hasReachedLimit,
  InvalidLimitError,
  isTimed,
  NO_LIMIT,
  remainingMs,
  SPRINT_DURATIONS_MS,
} from '../../src/drill/limits.js';

describe('drill time limits', () => {
  it('treats zero as no limit', () => {
    expect(isTimed(NO_LIMIT)).toBe(false);
    expect(NO_LIMIT).toBe(0);
  });

  it('treats a positive limit as timed', () => {
    expect(isTimed(60_000)).toBe(true);
  });

  it('never reports an untimed drill as out of time', () => {
    for (const elapsed of [0, 1, 1000, 60_000, 10_000_000]) {
      expect(hasReachedLimit(elapsed, NO_LIMIT)).toBe(false);
    }
  });

  it('reports a timed drill as out of time only once the limit is reached', () => {
    expect(hasReachedLimit(59_999, 60_000)).toBe(false);
    expect(hasReachedLimit(60_000, 60_000)).toBe(true);
    expect(hasReachedLimit(60_001, 60_000)).toBe(true);
  });

  it('gives no remaining time for an untimed drill, rather than zero', () => {
    expect(remainingMs(5000, NO_LIMIT)).toBeNull();
  });

  it('counts down and stops at zero', () => {
    expect(remainingMs(0, 60_000)).toBe(60_000);
    expect(remainingMs(59_000, 60_000)).toBe(1000);
    expect(remainingMs(75_000, 60_000)).toBe(0);
  });

  it('refuses a nonsensical limit instead of guessing', () => {
    expect(() => isTimed(-1)).toThrow(InvalidLimitError);
    expect(() => isTimed(Number.NaN)).toThrow(InvalidLimitError);
    expect(() => hasReachedLimit(0, Number.POSITIVE_INFINITY)).toThrow(InvalidLimitError);
  });

  it('refuses a nonsensical elapsed time', () => {
    expect(() => hasReachedLimit(-1, 60_000)).toThrow(/non-negative/);
    expect(() => hasReachedLimit(Number.NaN, 60_000)).toThrow(/non-negative/);
  });

  it('offers an untimed option, as WCAG 2.2.1 requires', () => {
    expect(SPRINT_DURATIONS_MS).toContain(NO_LIMIT);
    expect(SPRINT_DURATIONS_MS.filter((d) => d > 0).length).toBeGreaterThan(1);
  });

  it('describes a limit in words', () => {
    expect(describeLimit(NO_LIMIT)).toBe('untimed');
    expect(describeLimit(30_000)).toBe('30 seconds');
    expect(describeLimit(60_000)).toBe('1 minute');
    expect(describeLimit(300_000)).toBe('5 minutes');
  });
});
