import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CONTINUE_GRACE_MS,
  createDrill,
  createDrillSession,
  InvalidClockError,
  InvalidDrillTextError,
  InvalidKeystrokeError,
  KeystrokeHandlerError,
  TIMING_SAMPLE_MAX_MS,
} from '../../src/drill/engine.js';
import { InvalidLimitError, NO_LIMIT } from '../../src/drill/limits.js';
import { keyStatId } from '../../src/stats/storage.js';

/** A clock the test drives, because the engine never owns a timer. */
function testClock(start = 10_000) {
  let value = start;
  return {
    now: (): number => value,
    advance(ms: number): void {
      value += ms;
    },
    set(ms: number): void {
      value = ms;
    },
  };
}

/** Type the given characters, advancing the clock a little between each. */
function type(
  drill: ReturnType<typeof createDrill>,
  characters: string,
  clock: { advance(ms: number): void },
  gapMs = 100,
): void {
  for (const character of Array.from(characters)) {
    clock.advance(gapMs);
    drill.press(character);
  }
}

describe('drill engine, typing', () => {
  it('advances the cursor and marks the expected character correct', () => {
    const clock = testClock();
    const drill = createDrill({ text: 'ask', now: clock.now });

    expect(drill.next).toEqual({ index: 0, character: 'a' });
    expect(drill.status).toBe('awaiting-first-keystroke');

    clock.advance(120);
    const outcome = drill.press('a');

    expect(outcome).toEqual({ kind: 'correct', index: 0, character: 'a', result: null });
    expect(drill.cursor).toBe(1);
    expect(drill.marks).toEqual(['correct', 'pending', 'pending']);
    expect(drill.next).toEqual({ index: 1, character: 's' });
    expect(drill.status).toBe('running');
    expect(drill.correctKeystrokes).toBe(1);
    expect(drill.totalKeystrokes).toBe(1);
  });

  it('marks an error and still advances, the way a real typing test does', () => {
    const clock = testClock();
    const drill = createDrill({ text: 'ask', now: clock.now });

    clock.advance(90);
    const outcome = drill.press('z');

    expect(outcome).toEqual({ kind: 'wrong', index: 0, expected: 'a', typed: 'z', result: null });
    expect(drill.cursor).toBe(1);
    expect(drill.marks).toEqual(['wrong', 'pending', 'pending']);
    expect(drill.correctKeystrokes).toBe(0);
    expect(drill.totalKeystrokes).toBe(1);
  });

  it('starts the clock on the first keystroke, not at construction', () => {
    const clock = testClock();
    const drill = createDrill({ text: 'ask', now: clock.now });

    clock.advance(5000);
    expect(drill.startedAtMs).toBeNull();
    expect(drill.elapsedMs()).toBe(0);

    drill.press('a');
    expect(drill.startedAtMs).toBe(15_000);

    clock.advance(250);
    expect(drill.elapsedMs()).toBe(250);
  });

  it('never creates a timer of its own', () => {
    vi.useFakeTimers();
    try {
      const clock = testClock();
      const drill = createDrill({ text: 'ask', limitMs: 60_000, now: clock.now });
      type(drill, 'ask', clock);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('drill engine, backspace', () => {
  it('steps back and clears the mark it steps over', () => {
    const clock = testClock();
    const drill = createDrill({ text: 'ask', now: clock.now });
    type(drill, 'az', clock);
    expect(drill.marks).toEqual(['correct', 'wrong', 'pending']);

    const outcome = drill.backspace();

    expect(outcome).toEqual({ kind: 'stepped-back', index: 1, cleared: 'wrong' });
    expect(drill.cursor).toBe(1);
    expect(drill.marks).toEqual(['correct', 'pending', 'pending']);
    expect(drill.next).toEqual({ index: 1, character: 's' });
  });

  it('leaves the keystroke counters alone, because the keystroke really happened', () => {
    const clock = testClock();
    const drill = createDrill({ text: 'ask', now: clock.now });
    type(drill, 'az', clock);
    drill.backspace();

    expect(drill.totalKeystrokes).toBe(2);
    expect(drill.correctKeystrokes).toBe(1);
  });

  it('does nothing at the start of a drill', () => {
    const drill = createDrill({ text: 'ask', now: testClock().now });
    expect(drill.backspace()).toEqual({ kind: 'ignored', reason: 'at-start' });
    expect(drill.cursor).toBe(0);
  });

  it('does nothing once the drill has finished', () => {
    const clock = testClock();
    const drill = createDrill({ text: 'ask', now: clock.now });
    type(drill, 'ask', clock);

    expect(drill.backspace()).toEqual({ kind: 'ignored', reason: 'finished' });
    expect(drill.cursor).toBe(3);
  });
});

describe('drill engine, the result', () => {
  it('produces counts, elapsed time and per-key timings on completion', () => {
    const clock = testClock();
    const drill = createDrill({ text: 'ask', now: clock.now });

    clock.advance(100);
    drill.press('a');
    clock.advance(200);
    drill.press('z'); // wrong, where 's' was expected
    clock.advance(300);
    const last = drill.press('k');

    expect(last.kind).toBe('correct');
    const result = last.result;
    if (result === null) throw new Error('the last keystroke should have produced a result');

    expect(result.completed).toBe(true);
    expect(result.totalKeystrokes).toBe(3);
    expect(result.correctKeystrokes).toBe(2);
    expect(result.elapsedMs).toBe(500);
    expect(drill.isFinished).toBe(true);
    expect(drill.next).toBeNull();

    // The first keystroke has nothing to measure from, so it is a hit with no
    // timing sample rather than a suspiciously fast one.
    expect(result.perKey.get(keyStatId('a'))).toEqual({
      hits: 1,
      misses: 0,
      totalMs: 0,
      samples: 0,
    });
    // The miss belongs to the key the drill asked for.
    expect(result.perKey.get(keyStatId('s'))).toEqual({
      hits: 0,
      misses: 1,
      totalMs: 0,
      samples: 0,
    });
    expect(result.perKey.get(keyStatId('k'))).toEqual({
      hits: 1,
      misses: 0,
      totalMs: 300,
      samples: 1,
    });
  });

  it('keys per-key statistics by code point, never by the character', () => {
    const clock = testClock();
    const drill = createDrill({ text: 'a. £', now: clock.now });
    type(drill, 'a. £', clock);

    const keys = [...drill.perKey().keys()];
    expect(keys).toEqual(expect.arrayContaining([keyStatId('a'), keyStatId('.'), keyStatId(' ')]));
    for (const key of keys) {
      expect(key).toMatch(/^cp\d+$/);
    }
    expect(keys).not.toContain('.');
    expect(keys).not.toContain(' ');
  });

  it('counts a long pause as a hit but not as a timing sample', () => {
    const clock = testClock();
    const drill = createDrill({ text: 'as', now: clock.now });

    clock.advance(50);
    drill.press('a');
    clock.advance(TIMING_SAMPLE_MAX_MS + 1);
    drill.press('s');

    expect(drill.perKey().get(keyStatId('s'))).toEqual({
      hits: 1,
      misses: 0,
      totalMs: 0,
      samples: 0,
    });
  });

  it('ignores further keystrokes once finished, rather than throwing them away silently', () => {
    const clock = testClock();
    const drill = createDrill({ text: 'as', now: clock.now });
    type(drill, 'as', clock);

    const outcome = drill.press('x');
    expect(outcome.kind).toBe('ignored');
    if (outcome.kind !== 'ignored') throw new Error('expected the keystroke to be ignored');
    expect(outcome.reason).toBe('finished');
    expect(outcome.result.completed).toBe(true);
    expect(drill.totalKeystrokes).toBe(2);
  });

  it('hands out a detached result, so live state cannot be edited through it', () => {
    const clock = testClock();
    const drill = createDrill({ text: 'as', now: clock.now });
    type(drill, 'as', clock);
    const result = drill.result;
    if (result === null) throw new Error('the drill should have a result');

    const stat = result.perKey.get(keyStatId('a'));
    if (stat === undefined) throw new Error('expected statistics for a');
    stat.hits = 99;

    expect(drill.perKey().get(keyStatId('a'))?.hits).toBe(1);
  });

  it('treats a text of one code point outside the BMP as one position', () => {
    const clock = testClock();
    const drill = createDrill({ text: '𝔸b', now: clock.now });

    expect(drill.characters).toEqual(['𝔸', 'b']);
    type(drill, '𝔸b', clock);
    expect(drill.result?.completed).toBe(true);
    expect(drill.perKey().get(keyStatId('𝔸'))?.hits).toBe(1);
  });
});

describe('drill engine, time limits', () => {
  it('ends a timed drill when the limit is reached, without marking it completed', () => {
    const clock = testClock();
    const drill = createDrill({ text: 'ask more words', limitMs: 1000, now: clock.now });

    clock.advance(100);
    drill.press('a');
    expect(drill.checkTimeLimit()).toBeNull();
    expect(drill.remainingMs()).toBe(1000);

    clock.advance(1000);
    const result = drill.checkTimeLimit();
    if (result === null) throw new Error('the drill should have ended on its limit');

    expect(result.completed).toBe(false);
    expect(result.elapsedMs).toBe(1000);
    expect(drill.isFinished).toBe(true);
    expect(drill.remainingMs()).toBe(0);
  });

  it('never runs an untimed drill out of time, whatever the clock says', () => {
    const clock = testClock();
    const drill = createDrill({ text: 'ask', limitMs: NO_LIMIT, now: clock.now });

    clock.advance(10);
    drill.press('a');
    clock.advance(Number.MAX_SAFE_INTEGER - clock.now());

    expect(drill.checkTimeLimit()).toBeNull();
    expect(drill.remainingMs()).toBeNull();
    expect(drill.press('s').kind).toBe('correct');
    expect(drill.isFinished).toBe(false);
  });

  it('cannot run out before the first keystroke has started the clock', () => {
    const clock = testClock();
    const drill = createDrill({ text: 'ask', limitMs: 500, now: clock.now });

    clock.advance(60_000);
    expect(drill.checkTimeLimit()).toBeNull();
    expect(drill.press('a').kind).toBe('correct');
  });

  it('ends on the next keystroke when the limit passed between calls', () => {
    const clock = testClock();
    const drill = createDrill({ text: 'ask more', limitMs: 500, now: clock.now });

    clock.advance(10);
    drill.press('a');
    clock.advance(900);
    const outcome = drill.press('s');

    expect(outcome.kind).toBe('ignored');
    if (outcome.kind !== 'ignored') throw new Error('expected the keystroke to be ignored');
    expect(outcome.reason).toBe('out-of-time');
    expect(outcome.result.completed).toBe(false);
    // The out-of-time keystroke is not counted against the learner.
    expect(outcome.result.totalKeystrokes).toBe(1);
  });

  it('does not let a clock that steps backwards rewind elapsed time', () => {
    const clock = testClock();
    const drill = createDrill({ text: 'ask', limitMs: 1000, now: clock.now });

    clock.advance(100);
    drill.press('a');
    clock.advance(400);
    expect(drill.elapsedMs()).toBe(400);

    clock.set(0);
    expect(drill.elapsedMs()).toBe(400);
    expect(drill.remainingMs()).toBe(600);
  });
});

describe('drill engine, continuing from the result', () => {
  it('refuses to continue while the drill is still live', () => {
    const drill = createDrill({ text: 'ask', now: testClock().now });
    expect(drill.requestContinue('a')).toEqual({
      accepted: false,
      reason: 'not-finished',
      remainingGraceMs: 0,
    });
  });

  it('accepts any key once the grace has passed', () => {
    const clock = testClock();
    const drill = createDrill({ text: 'as', now: clock.now });
    type(drill, 'as', clock);
    clock.advance(CONTINUE_GRACE_MS);

    for (const key of ['a', ' ', 'Enter', 'Escape', '5', 'ArrowLeft', 'Backspace']) {
      expect(drill.requestContinue(key).accepted, `key ${JSON.stringify(key)}`).toBe(true);
    }
  });

  it('refuses a modifier and Tab, which belong to navigation', () => {
    const clock = testClock();
    const drill = createDrill({ text: 'as', now: clock.now });
    type(drill, 'as', clock);
    clock.advance(CONTINUE_GRACE_MS);

    for (const key of ['Shift', 'Control', 'Alt', 'Meta', 'Tab']) {
      const decision = drill.requestContinue(key);
      expect(decision.accepted, `key ${key}`).toBe(false);
      expect(decision.reason).toBe('not-a-continue-key');
    }
  });

  it('refuses the empty key a browser reports for some composition events', () => {
    const clock = testClock();
    const drill = createDrill({ text: 'as', now: clock.now });
    type(drill, 'as', clock);
    clock.advance(CONTINUE_GRACE_MS);

    expect(drill.requestContinue('').reason).toBe('not-a-continue-key');
    // A non-string is a programming error, not a stray keystroke.
    expect(() => drill.requestContinue(undefined as unknown as string)).toThrow(
      InvalidKeystrokeError,
    );
  });

  it('ignores an overrun keystroke inside the grace period', () => {
    const clock = testClock();
    const drill = createDrill({ text: 'as', now: clock.now });
    type(drill, 'as', clock);

    const decision = drill.requestContinue('k');
    expect(decision.accepted).toBe(false);
    expect(decision.reason).toBe('within-grace');
    expect(decision.remainingGraceMs).toBe(CONTINUE_GRACE_MS);
  });
});

describe('drill engine, a keystroke observer that throws', () => {
  it('surfaces the error with the original attached, and does not move the drill', () => {
    const clock = testClock();
    const boom = new Error('storage refused the write');
    const drill = createDrill({
      text: 'ask',
      now: clock.now,
      onKeystroke: () => {
        throw boom;
      },
    });

    clock.advance(100);
    let thrown: unknown;
    try {
      drill.press('a');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(KeystrokeHandlerError);
    expect((thrown as KeystrokeHandlerError).cause).toBe(boom);
    expect(drill.cursor).toBe(0);
    expect(drill.marks).toEqual(['pending', 'pending', 'pending']);
    expect(drill.totalKeystrokes).toBe(0);
    expect(drill.perKey().size).toBe(0);
    expect(drill.isFinished).toBe(false);
    expect(drill.startedAtMs).toBeNull();
  });

  it('is resumable once the observer stops throwing', () => {
    const clock = testClock();
    let fail = true;
    const drill = createDrill({
      text: 'ask',
      now: clock.now,
      onKeystroke: () => {
        if (fail) throw new Error('transient');
      },
    });

    clock.advance(50);
    expect(() => drill.press('a')).toThrow(KeystrokeHandlerError);
    fail = false;
    clock.advance(50);

    expect(drill.press('a').kind).toBe('correct');
    expect(drill.cursor).toBe(1);
  });
});

describe('drill engine, validation at the boundary', () => {
  it('refuses empty or non-string text rather than producing a drill of nothing', () => {
    expect(() => createDrill({ text: '' })).toThrow(InvalidDrillTextError);
    expect(() => createDrill({ text: 42 as unknown as string })).toThrow(InvalidDrillTextError);
  });

  it('refuses a nonsensical limit through the limits module', () => {
    expect(() => createDrill({ text: 'ask', limitMs: -1 })).toThrow(InvalidLimitError);
    expect(() => createDrill({ text: 'ask', limitMs: Number.NaN })).toThrow(InvalidLimitError);
  });

  it('refuses a keystroke that is not exactly one character', () => {
    const drill = createDrill({ text: 'ask', now: testClock().now });
    expect(() => drill.press('')).toThrow(InvalidKeystrokeError);
    expect(() => drill.press('ab')).toThrow(InvalidKeystrokeError);
    expect(() => drill.press('Enter')).toThrow(InvalidKeystrokeError);
    expect(() => drill.press(undefined as unknown as string)).toThrow(InvalidKeystrokeError);
  });

  it('refuses a clock that is not a function or does not return a number', () => {
    expect(() => createDrill({ text: 'ask', now: 5 as unknown as () => number })).toThrow(
      InvalidClockError,
    );
    const drill = createDrill({
      text: 'ask',
      now: () => Number.NaN,
    });
    expect(() => drill.press('a')).toThrow(InvalidClockError);
  });
});

describe('drill session, starting a fresh drill', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('carries nothing over from the drill before it', () => {
    const clock = testClock();
    const session = createDrillSession({ now: clock.now });
    const first = session.start({ text: 'ask', limitMs: 60_000 });
    type(first, 'azk', clock);

    const second = session.start({ text: 'the' });

    expect(second).not.toBe(first);
    expect(second.text).toBe('the');
    expect(second.cursor).toBe(0);
    expect(second.marks).toEqual(['pending', 'pending', 'pending']);
    expect(second.startedAtMs).toBeNull();
    expect(second.totalKeystrokes).toBe(0);
    expect(second.correctKeystrokes).toBe(0);
    expect(second.perKey().size).toBe(0);
    // The sprint's limit does not follow the learner into a lesson.
    expect(second.limitMs).toBe(NO_LIMIT);
    expect(second.remainingMs()).toBeNull();
    expect(session.drill).toBe(second);
  });

  it('writes per-key statistics into progress, keyed by code point', () => {
    const clock = testClock();
    const session = createDrillSession({ now: clock.now });
    const drill = session.start({ text: 'a.' });
    type(drill, 'a,', clock);

    expect(session.progress.keyStats[keyStatId('a')]).toEqual({
      hits: 1,
      misses: 0,
      totalMs: 0,
      samples: 0,
    });
    expect(session.progress.keyStats[keyStatId('.')]).toEqual({
      hits: 0,
      misses: 1,
      totalMs: 0,
      samples: 0,
    });
    expect(Object.keys(session.progress.keyStats).every((key) => /^cp\d+$/.test(key))).toBe(true);
  });

  it('knows whether a drill is in progress', () => {
    const clock = testClock();
    const session = createDrillSession({ now: clock.now });
    expect(session.drillInProgress).toBe(false);

    const drill = session.start({ text: 'as' });
    expect(session.drillInProgress).toBe(false);

    type(drill, 'a', clock);
    expect(session.drillInProgress).toBe(true);

    type(drill, 's', clock);
    expect(session.drillInProgress).toBe(false);
  });
});
