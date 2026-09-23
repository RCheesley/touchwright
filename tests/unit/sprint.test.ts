/**
 * Sprint mode's pure half: what a sprint is made of, how long it asks for, how
 * it words itself, and the timer that must never outlive its drill.
 *
 * The timer is unit-testable at all because it takes its schedule as an
 * argument. Nothing here waits for a real second: the schedule is a list of
 * callbacks a test fires by hand, which is the same discipline the engine
 * follows with its clock.
 */

import { describe, expect, it } from 'vitest';
import { createDrill } from '../../src/drill/engine.js';
import { NO_LIMIT, SPRINT_DURATIONS_MS } from '../../src/drill/limits.js';
import {
  createSprintWarnings,
  describeCountdown,
  describeDurationChoice,
  parseSprintLimit,
  secondsLeft,
  SPRINT_LESSON_ID,
  SPRINT_MAX_WORDS,
  SPRINT_MIN_WORDS,
  SPRINT_UNTIMED_WORDS,
  SprintError,
  SprintTimerError,
  sprintLesson,
  sprintWordCount,
  startSprintTimer,
} from '../../src/drill/sprint.js';
import type { Lesson } from '../../src/ladder/generate.js';

function lesson(id: string, keys: readonly string[], stage: Lesson['stage'] = 'keys'): Lesson {
  return { id, name: id, blurb: id, addedKeys: [], keys, stage };
}

/** Three cumulative rungs, the way a generated ladder produces them. */
const LADDER: readonly Lesson[] = [
  lesson('one', ['a', 'n', ' ']),
  lesson('two', ['a', 'n', ' ', 'i', 's']),
  lesson('three', ['a', 'n', ' ', 'i', 's', 't', 'h'], 'prose'),
];

function testClock(start = 1_000) {
  let value = start;
  return {
    now: (): number => value,
    advance(ms: number): void {
      value += ms;
    },
  };
}

/**
 * A schedule a test fires by hand, and a count of how many cancels it has been
 * handed. `live` is the thing regression 3 is really about: a timer that has
 * stopped must leave nothing behind that can be fired again.
 */
function manualSchedule() {
  const ticks = new Set<() => void>();
  let cancelled = 0;
  // An arrow rather than a method, so it can be handed straight to the timer.
  const schedule = (tick: () => void): (() => void) => {
    ticks.add(tick);
    return (): void => {
      cancelled += 1;
      ticks.delete(tick);
    };
  };
  return {
    schedule,
    fire(): void {
      for (const tick of [...ticks]) tick();
    },
    get live(): number {
      return ticks.size;
    },
    get cancelled(): number {
      return cancelled;
    },
  };
}

describe('sprintLesson', () => {
  it('runs against every key unlocked so far, not one lesson', () => {
    const sprint = sprintLesson(LADDER, 2);
    expect(sprint.keys).toEqual(['a', 'n', ' ', 'i', 's', 't', 'h']);
    expect(sprint.id).toBe(SPRINT_LESSON_ID);
  });

  it('stops at the lesson actually unlocked, so it never asks for a key not yet taught', () => {
    expect(sprintLesson(LADDER, 0).keys).toEqual(['a', 'n', ' ']);
    expect(sprintLesson(LADDER, 1).keys).toEqual(['a', 'n', ' ', 'i', 's']);
  });

  it('takes the reached lesson stage, so prose only appears once the ladder has it', () => {
    expect(sprintLesson(LADDER, 1).stage).toBe('keys');
    expect(sprintLesson(LADDER, 2).stage).toBe('prose');
  });

  it('clamps an index from a longer ladder rather than refusing to sprint', () => {
    expect(sprintLesson(LADDER, 99).keys).toEqual(sprintLesson(LADDER, 2).keys);
  });

  it('carries no ladder id, so a sprint can never write stars to a rung', () => {
    expect(LADDER.map((rung) => rung.id)).not.toContain(SPRINT_LESSON_ID);
  });

  it('refuses a ladder with no lessons rather than inventing one', () => {
    expect(() => sprintLesson([], 0)).toThrow(SprintError);
  });

  it('refuses an index that is not a whole number', () => {
    expect(() => sprintLesson(LADDER, -1)).toThrow(SprintError);
    expect(() => sprintLesson(LADDER, 1.5)).toThrow(SprintError);
  });

  it('refuses lessons that contain no keys at all', () => {
    expect(() => sprintLesson([lesson('empty', [])], 0)).toThrow(SprintError);
  });
});

describe('sprintWordCount', () => {
  it('gives an untimed sprint a finishable length', () => {
    expect(sprintWordCount(NO_LIMIT)).toBe(SPRINT_UNTIMED_WORDS);
  });

  it('scales with the limit, so the words outlast the clock', () => {
    expect(sprintWordCount(60_000)).toBeGreaterThan(sprintWordCount(30_000));
    expect(sprintWordCount(300_000)).toBeGreaterThanOrEqual(sprintWordCount(120_000));
  });

  it('stays between its floor and its ceiling for every duration on offer', () => {
    for (const limitMs of SPRINT_DURATIONS_MS) {
      const words = sprintWordCount(limitMs);
      expect(words, `${limitMs} ms`).toBeGreaterThanOrEqual(
        Math.min(SPRINT_MIN_WORDS, SPRINT_UNTIMED_WORDS),
      );
      expect(words, `${limitMs} ms`).toBeLessThanOrEqual(SPRINT_MAX_WORDS);
    }
  });
});

describe('the duration control vocabulary', () => {
  it('names untimed as a choice rather than as a missing value', () => {
    expect(describeDurationChoice(NO_LIMIT).toLowerCase()).toContain('untimed');
    expect(describeDurationChoice(NO_LIMIT).toLowerCase()).toContain('never');
  });

  it('names every other duration in plain words', () => {
    expect(describeDurationChoice(30_000)).toBe('30 seconds');
    expect(describeDurationChoice(60_000)).toBe('1 minute');
    expect(describeDurationChoice(300_000)).toBe('5 minutes');
  });

  it('accepts only a duration that was actually offered', () => {
    for (const limitMs of SPRINT_DURATIONS_MS) {
      expect(parseSprintLimit(String(limitMs), SPRINT_DURATIONS_MS)).toBe(limitMs);
    }
  });

  it('throws rather than defaulting when a value did not come from the list', () => {
    expect(() => parseSprintLimit('45000', SPRINT_DURATIONS_MS)).toThrow(SprintError);
    expect(() => parseSprintLimit('', SPRINT_DURATIONS_MS)).toThrow(SprintError);
    expect(() => parseSprintLimit('a minute', SPRINT_DURATIONS_MS)).toThrow(SprintError);
  });
});

describe('the countdown readout', () => {
  it('says untimed in words rather than showing a frozen zero', () => {
    expect(describeCountdown(null)).toContain('no time limit');
    expect(describeCountdown(null)).not.toMatch(/\d:\d\d/u);
  });

  it('rounds up, so it only reads zero when the time really is gone', () => {
    expect(secondsLeft(1)).toBe(1);
    expect(secondsLeft(999)).toBe(1);
    expect(secondsLeft(0)).toBe(0);
    expect(describeCountdown(1)).toBe('Time left: 0:01');
    expect(describeCountdown(0)).toBe('Time left: 0:00');
  });

  it('reads as minutes and seconds', () => {
    expect(describeCountdown(30_000)).toBe('Time left: 0:30');
    expect(describeCountdown(60_000)).toBe('Time left: 1:00');
    expect(describeCountdown(125_000)).toBe('Time left: 2:05');
  });

  it('refuses a negative remaining time rather than showing a negative clock', () => {
    expect(() => secondsLeft(-1)).toThrow(RangeError);
  });
});

describe('the polite warnings beside the countdown', () => {
  it('never announces an untimed sprint, however long it runs', () => {
    const warnings = createSprintWarnings(NO_LIMIT);
    expect(warnings.armed).toEqual([]);
    expect(warnings.due(null)).toBeNull();
  });

  it('announces each milestone once and only once', () => {
    const warnings = createSprintWarnings(120_000);
    expect(warnings.due(90_000)).toBeNull();
    expect(warnings.due(60_000)).toContain('1 minute');
    expect(warnings.due(59_000)).toBeNull();
    expect(warnings.due(45_000)).toBeNull();
    expect(warnings.due(30_000)).toContain('30 seconds');
    expect(warnings.due(30_000)).toBeNull();
    expect(warnings.due(9_000)).toContain('10 seconds');
    expect(warnings.due(1_000)).toBeNull();
  });

  it('never announces every second: one sprint produces a handful at most', () => {
    const warnings = createSprintWarnings(120_000);
    const spoken: string[] = [];
    for (let remaining = 120_000; remaining >= 0; remaining -= 1000) {
      const said = warnings.due(remaining);
      if (said !== null) spoken.push(said);
    }
    expect(spoken).toHaveLength(warnings.armed.length);
    expect(spoken.length).toBeLessThanOrEqual(3);
  });

  it('drops a threshold at or above the whole limit, which would be noise', () => {
    expect(createSprintWarnings(30_000).armed).toEqual([10_000]);
    expect(createSprintWarnings(60_000).armed).toEqual([30_000, 10_000]);
  });

  it('fires only the tightest milestone when a tick skips past several', () => {
    const warnings = createSprintWarnings(300_000);
    expect(warnings.due(5_000)).toContain('10 seconds');
    expect(warnings.due(4_000)).toBeNull();
  });
});

describe('startSprintTimer', () => {
  it('counts down the drill it was given, tick by tick', () => {
    const clock = testClock();
    const drill = createDrill({ text: 'ask a task', limitMs: 30_000, now: clock.now });
    drill.press('a');
    const schedule = manualSchedule();
    const seen: (number | null)[] = [];

    startSprintTimer({
      drill,
      currentDrill: () => drill,
      schedule: schedule.schedule,
      onTick: (remaining) => seen.push(remaining),
    });

    clock.advance(10_000);
    schedule.fire();
    clock.advance(5_000);
    schedule.fire();

    expect(seen).toEqual([20_000, 15_000]);
  });

  it('ends the drill when its own limit runs out, once', () => {
    const clock = testClock();
    const drill = createDrill({ text: 'ask a task', limitMs: 30_000, now: clock.now });
    drill.press('a');
    const schedule = manualSchedule();
    const expired: number[] = [];

    const timer = startSprintTimer({
      drill,
      currentDrill: () => drill,
      schedule: schedule.schedule,
      onExpire: (result) => expired.push(result.elapsedMs),
    });

    clock.advance(30_000);
    schedule.fire();
    schedule.fire();

    expect(expired).toEqual([30_000]);
    expect(timer.stopped).toBe(true);
    expect(timer.stopReason).toBe('expired');
    expect(schedule.live).toBe(0);
  });

  it('stops itself when its drill finishes by being typed through', () => {
    const clock = testClock();
    const drill = createDrill({ text: 'ab', limitMs: 30_000, now: clock.now });
    const schedule = manualSchedule();
    const timer = startSprintTimer({
      drill,
      currentDrill: () => drill,
      schedule: schedule.schedule,
    });

    drill.press('a');
    clock.advance(500);
    drill.press('b');
    schedule.fire();

    expect(timer.stopReason).toBe('finished');
    expect(schedule.live).toBe(0);
  });

  it('is bound to its drill, so it will not act on whichever drill is current', () => {
    const clock = testClock();
    const sprint = createDrill({ text: 'ask a task', limitMs: 30_000, now: clock.now });
    sprint.press('a');
    const lessonDrill = createDrill({ text: 'ask a task', limitMs: NO_LIMIT, now: clock.now });

    const schedule = manualSchedule();
    let current = sprint;
    const ticks: unknown[] = [];
    const timer = startSprintTimer({
      drill: sprint,
      currentDrill: () => current,
      schedule: schedule.schedule,
      onTick: (remaining) => ticks.push(remaining),
      onExpire: () => ticks.push('expired'),
    });

    // The sprint is abandoned: another drill becomes the current one.
    current = lessonDrill;
    lessonDrill.press('a');
    clock.advance(60_000);
    schedule.fire();

    expect(timer.stopped).toBe(true);
    expect(timer.stopReason).toBe('abandoned');
    expect(ticks).toEqual([]);
    // The drill it was not started for is untouched, and still live.
    expect(lessonDrill.isFinished).toBe(false);
    expect(lessonDrill.result).toBeNull();
  });

  it('never expires an untimed drill, at any elapsed time at all', () => {
    const clock = testClock();
    const drill = createDrill({ text: 'ask a task', limitMs: NO_LIMIT, now: clock.now });
    drill.press('a');
    const schedule = manualSchedule();
    const seen: (number | null)[] = [];
    let expired = 0;

    const timer = startSprintTimer({
      drill,
      currentDrill: () => drill,
      schedule: schedule.schedule,
      onTick: (remaining) => seen.push(remaining),
      onExpire: () => {
        expired += 1;
      },
    });

    // A hundred thousand years, and then some.
    for (const jump of [1_000, 60_000, 86_400_000, 3_155_760_000_000]) {
      clock.advance(jump);
      schedule.fire();
    }

    expect(expired).toBe(0);
    expect(timer.stopped).toBe(false);
    expect(drill.isFinished).toBe(false);
    // Remaining time is null for every one of them: never zero, never negative.
    expect(seen).toEqual([null, null, null, null]);
  });

  it('is idempotent to stop, and stopping cancels exactly once', () => {
    const drill = createDrill({ text: 'ask', limitMs: 30_000 });
    const schedule = manualSchedule();
    const timer = startSprintTimer({
      drill,
      currentDrill: () => drill,
      schedule: schedule.schedule,
    });

    timer.stop();
    timer.stop();

    expect(schedule.cancelled).toBe(1);
    expect(schedule.live).toBe(0);
    expect(timer.stopReason).toBe('stopped');
  });

  it('stops itself before rethrowing a tick that failed, and keeps the cause', () => {
    const clock = testClock();
    const drill = createDrill({ text: 'ask a task', limitMs: 30_000, now: clock.now });
    drill.press('a');
    const schedule = manualSchedule();
    const boom = new Error('the countdown readout blew up');

    const timer = startSprintTimer({
      drill,
      currentDrill: () => drill,
      schedule: schedule.schedule,
      onTick: () => {
        throw boom;
      },
    });

    expect(() => {
      schedule.fire();
    }).toThrow(SprintTimerError);
    expect(timer.stopped).toBe(true);
    expect(timer.stopReason).toBe('error');
    expect(schedule.live).toBe(0);

    // Surfaced, never swallowed: the original is attached.
    let caught: unknown;
    const second = startSprintTimer({
      drill,
      currentDrill: () => drill,
      schedule: schedule.schedule,
      onTick: () => {
        throw boom;
      },
    });
    try {
      schedule.fire();
    } catch (error) {
      caught = error;
    }
    expect(second.stopped).toBe(true);
    expect(caught).toBeInstanceOf(SprintTimerError);
    expect((caught as SprintTimerError).cause).toBe(boom);
  });

  it('honours a cancel even when the schedule ran its tick synchronously', () => {
    const drill = createDrill({ text: 'ask', limitMs: 30_000 });
    let cancelled = 0;
    const other = createDrill({ text: 'ask', limitMs: 30_000 });

    const timer = startSprintTimer({
      drill,
      // Already abandoned before the schedule even returns.
      currentDrill: () => other,
      schedule: (tick) => {
        tick();
        return (): void => {
          cancelled += 1;
        };
      },
    });

    expect(timer.stopReason).toBe('abandoned');
    expect(cancelled).toBe(1);
  });
});
