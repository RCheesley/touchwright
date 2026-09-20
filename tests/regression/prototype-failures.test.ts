/**
 * The eight failures the prototype shipped.
 *
 * Every one of these was found by a learner rather than by a test. They are
 * numbered as they are in the handoff brief and they are written before the
 * feature each one guards, so a few are still `todo`: the acceptance criteria are
 * spelled out in the test name and the comment, and the body gets filled in as
 * the feature lands. A todo here is a commitment, not a placeholder.
 *
 * Do not delete one of these because it looks obvious. Each cost a real session.
 */

import { describe, expect, it } from 'vitest';
import {
  CONTINUE_GRACE_MS,
  createDrill,
  createDrillSession,
  KeystrokeHandlerError,
} from '../../src/drill/engine.js';
import { hasReachedLimit, NO_LIMIT } from '../../src/drill/limits.js';
import {
  emptyProgress,
  keyStatId,
  MemoryStorageDriver,
  PROGRESS_VERSION,
  ProgressStore,
  readProgress,
  thaw,
  type Progress,
} from '../../src/stats/storage.js';
import { contrastRatio, AA_NON_TEXT, AA_TEXT } from '../../src/ui/contrast.js';

/** Deep-freeze, to stand in for progress arriving from an external store. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}

/**
 * A clock the test drives. The engine owns no timer, so every one of these
 * failures can be reproduced without waiting for real time to pass.
 */
function testClock(start = 10_000) {
  let value = start;
  return {
    now: (): number => value,
    advance(ms: number): void {
      value += ms;
    },
  };
}

describe('regression 1: progress loaded from an external store may arrive deeply frozen', () => {
  // Merging a frozen object into live state made the stats object immutable, and
  // the first keystroke threw inside the stats recorder.

  it('thaws a deeply frozen object into something writable', () => {
    const frozen = deepFreeze({
      version: PROGRESS_VERSION,
      lesson: 2,
      xp: 10,
      stars: { home: 3 },
      keyStats: { [keyStatId('a')]: { hits: 1, misses: 0, totalMs: 10, samples: 1 } },
    });
    expect(Object.isFrozen(frozen)).toBe(true);

    const copy = thaw(frozen);
    expect(Object.isFrozen(copy)).toBe(false);
    expect(Object.isFrozen(copy.keyStats)).toBe(false);
    expect(Object.isFrozen(copy.keyStats[keyStatId('a')])).toBe(false);
  });

  it('leaves loaded progress fully writable, including nested stats', () => {
    const frozen = deepFreeze({
      version: PROGRESS_VERSION,
      lesson: 0,
      xp: 0,
      stars: {},
      keyStats: { [keyStatId('a')]: { hits: 1, misses: 0, totalMs: 10, samples: 1 } },
    });

    const { progress } = readProgress(frozen);

    // The exact shape of the first keystroke after a load: bump an existing key,
    // then add a new one.
    expect(() => {
      const stat = progress.keyStats[keyStatId('a')]!;
      stat.hits += 1;
      progress.keyStats[keyStatId('.')] = { hits: 1, misses: 0, totalMs: 5, samples: 1 };
      progress.xp += 10;
      progress.stars['home'] = 2;
    }).not.toThrow();

    expect(progress.keyStats[keyStatId('a')]?.hits).toBe(2);
  });

  it('does not alias the object it was given', () => {
    const source = {
      version: PROGRESS_VERSION,
      keyStats: { [keyStatId('a')]: { hits: 1, misses: 0, totalMs: 0, samples: 0 } },
    };
    const { progress } = readProgress(source);
    progress.keyStats[keyStatId('a')]!.hits = 99;
    expect(source.keyStats[keyStatId('a')]!.hits).toBe(1);
  });
});

describe('regression 2: an async load must not destroy work in progress', () => {
  // Saved progress arrives a second or two after first paint. Rebuilding the
  // drill on arrival replaced the text the learner was partway through.
  //
  // Acceptance criteria, for when the drill engine exists:
  //  - a load that resolves while a drill is running merges the stats,
  //  - and leaves the drill's text, cursor and marks exactly as they were,
  //  - and does not reset the drill's start time,
  //  - while a load that resolves before any drill starts does set the lesson.

  it('merges stats from a load that lands mid-drill without touching the drill', () => {
    const clock = testClock();
    const session = createDrillSession({ now: clock.now });
    const drill = session.start({ text: 'ask', limitMs: NO_LIMIT });

    clock.advance(100);
    drill.press('a');
    clock.advance(120);
    drill.press('s');
    const startedAt = drill.startedAtMs;

    // Frozen, because that is how an external store hands progress over.
    const applied = session.applyLoadedProgress(
      deepFreeze({
        version: PROGRESS_VERSION,
        lesson: 4,
        xp: 120,
        stars: { home: 3 },
        keyStats: { [keyStatId('k')]: { hits: 9, misses: 2, totalMs: 900, samples: 9 } },
      }),
    );

    expect(applied.drillInProgress).toBe(true);
    expect(applied.warnings).toEqual([]);

    // The saved statistics arrive,
    expect(session.progress.keyStats[keyStatId('k')]).toEqual({
      hits: 9,
      misses: 2,
      totalMs: 900,
      samples: 9,
    });
    // and what was typed since first paint is still there.
    expect(session.progress.keyStats[keyStatId('a')]?.hits).toBe(1);
    expect(session.progress.keyStats[keyStatId('s')]?.hits).toBe(1);
    expect(session.progress.xp).toBe(120);
    expect(session.progress.stars['home']).toBe(3);

    // The drill is the same drill, still running, with its start time intact.
    expect(session.drill).toBe(drill);
    expect(drill.startedAtMs).toBe(startedAt);
    expect(drill.isFinished).toBe(false);

    // And it still works, which is what the learner found was untrue.
    clock.advance(100);
    expect(drill.press('k').kind).toBe('correct');
    expect(drill.result?.completed).toBe(true);
  });

  it('leaves the drill text and cursor untouched when a load lands mid-drill', () => {
    const clock = testClock();
    const session = createDrillSession({ now: clock.now });
    const drill = session.start({ text: 'ask the' });

    for (const character of ['a', 'z', 'k']) {
      clock.advance(110);
      drill.press(character);
    }
    const marksBefore = drill.marks;
    const startedAt = drill.startedAtMs;

    session.applyLoadedProgress(
      deepFreeze({
        version: PROGRESS_VERSION,
        lesson: 6,
        xp: 30,
        stars: {},
        keyStats: { [keyStatId('a')]: { hits: 40, misses: 1, totalMs: 4000, samples: 40 } },
      }),
    );

    expect(drill.text).toBe('ask the');
    expect(drill.cursor).toBe(3);
    expect(drill.marks).toEqual(marksBefore);
    expect(drill.marks.slice(0, 3)).toEqual(['correct', 'wrong', 'correct']);
    expect(drill.next).toEqual({ index: 3, character: ' ' });
    expect(drill.startedAtMs).toBe(startedAt);
    expect(drill.totalKeystrokes).toBe(3);

    // The lesson is the one field that would move the ground under a learner
    // partway through a drill, so mid-drill it waits.
    expect(session.progress.lesson).toBe(0);
  });

  it('applies the saved lesson when the load lands before a drill starts', () => {
    const clock = testClock();
    const session = createDrillSession({ now: clock.now });

    const first = session.applyLoadedProgress(
      deepFreeze({ version: PROGRESS_VERSION, lesson: 3, xp: 50, stars: {}, keyStats: {} }),
    );
    expect(first.lessonApplied).toBe(true);
    expect(first.drillInProgress).toBe(false);
    expect(session.progress.lesson).toBe(3);

    // A drill that exists but has had no keystroke is not work in progress
    // either, so a load landing then still sets the lesson.
    const drill = session.start({ text: 'ask' });
    const second = session.applyLoadedProgress({
      version: PROGRESS_VERSION,
      lesson: 5,
      xp: 0,
      stars: {},
      keyStats: {},
    });

    expect(second.lessonApplied).toBe(true);
    expect(session.progress.lesson).toBe(5);
    expect(drill.cursor).toBe(0);
    expect(drill.startedAtMs).toBeNull();
  });
});

describe('regression 3: timers must not outlive their drill', () => {
  // An abandoned sprint left its interval running. It then acted on whichever
  // drill was current, and because an untimed drill carried a limit of zero,
  // "elapsed is at least the limit" was true on the first keystroke, so every
  // subsequent drill died instantly.

  it('treats a limit of zero as no limit, not as already expired', () => {
    expect(hasReachedLimit(0, NO_LIMIT)).toBe(false);
    expect(hasReachedLimit(1, NO_LIMIT)).toBe(false);
    expect(hasReachedLimit(Number.MAX_SAFE_INTEGER, NO_LIMIT)).toBe(false);
  });

  it.todo('clears a sprint timer when the sprint is abandoned');
  it.todo('lets a lesson run normally after a sprint was started and abandoned');
  it.todo('never lets a timer act on a drill other than the one it was started for');
});

describe('regression 4: a finished drill must never swallow input', () => {
  // Accepting only space to continue made the app look dead to someone who was
  // still typing.
  //
  // Acceptance criteria:
  //  - any key advances past the result, not only space,
  //  - but a short grace period after the drill ends ignores keystrokes, so an
  //    overrun keystroke cannot skip the result before it has been read.

  it('continues from the result screen on any key, not only space', () => {
    const clock = testClock();
    const drill = createDrill({ text: 'as', now: clock.now });
    clock.advance(100);
    drill.press('a');
    clock.advance(100);
    drill.press('s');
    expect(drill.isFinished).toBe(true);

    clock.advance(CONTINUE_GRACE_MS);

    // The prototype accepted space alone, so to someone still typing letters the
    // app simply looked dead.
    for (const key of ['q', 'Enter', ' ', '7', '.', 'Escape', 'ArrowDown', 'Backspace']) {
      expect(drill.requestContinue(key).accepted, `key ${JSON.stringify(key)}`).toBe(true);
    }

    // Modifiers and Tab are the exception: a modifier is not a keystroke, and Tab
    // belongs to focus navigation, which this app must never trap.
    for (const key of ['Shift', 'Control', 'Alt', 'Meta', 'Tab']) {
      const decision = drill.requestContinue(key);
      expect(decision.accepted, `key ${key}`).toBe(false);
      expect(decision.reason).toBe('not-a-continue-key');
    }
  });

  it('ignores keystrokes for a short grace period so an overrun cannot skip the result', () => {
    const clock = testClock();
    const drill = createDrill({ text: 'as', now: clock.now });
    clock.advance(100);
    drill.press('a');
    clock.advance(100);
    drill.press('s');

    // The keystroke already in flight when the drill ended.
    const overrun = drill.requestContinue('k');
    expect(overrun.accepted).toBe(false);
    expect(overrun.reason).toBe('within-grace');
    expect(overrun.remainingGraceMs).toBe(CONTINUE_GRACE_MS);

    clock.advance(CONTINUE_GRACE_MS - 1);
    const stillTooSoon = drill.requestContinue('k');
    expect(stillTooSoon.accepted).toBe(false);
    expect(stillTooSoon.remainingGraceMs).toBe(1);

    clock.advance(1);
    expect(drill.requestContinue('k')).toEqual({
      accepted: true,
      reason: 'accepted',
      remainingGraceMs: 0,
    });
  });
});

describe('regression 5: an error must not silently end a drill', () => {
  // The prototype caught keystroke errors and marked the drill complete, which
  // turned a hidden crash into a loop of new drills.
  //
  // Acceptance criteria:
  //  - a handler that throws surfaces an error to the user,
  //  - the drill is left intact and resumable, not marked complete,
  //  - and nothing is written to progress for the failed keystroke.

  it('surfaces an error when a keystroke handler throws', () => {
    const clock = testClock();
    const boom = new Error('the stats recorder threw');
    const session = createDrillSession({ now: clock.now });
    const drill = session.start({
      text: 'ask',
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

    // Surfaced rather than swallowed, with the original error attached.
    expect(thrown).toBeInstanceOf(KeystrokeHandlerError);
    expect((thrown as KeystrokeHandlerError).cause).toBe(boom);

    // And nothing was written to progress for the keystroke that failed.
    expect(session.progress.keyStats).toEqual({});
    expect(session.progress.xp).toBe(0);
  });

  it('leaves the drill intact rather than marking it complete', () => {
    const clock = testClock();
    let failing = false;
    const session = createDrillSession({ now: clock.now });
    const drill = session.start({
      text: 'ask',
      onKeystroke: () => {
        if (failing) throw new Error('a hidden crash inside the recorder');
      },
    });

    clock.advance(100);
    drill.press('a');
    failing = true;
    clock.advance(100);
    expect(() => drill.press('s')).toThrow(KeystrokeHandlerError);

    // Not complete, and not advanced past the key that failed.
    expect(drill.isFinished).toBe(false);
    expect(drill.result).toBeNull();
    expect(drill.cursor).toBe(1);
    expect(drill.marks).toEqual(['correct', 'pending', 'pending']);
    expect(drill.totalKeystrokes).toBe(1);
    expect(session.progress.keyStats[keyStatId('s')]).toBeUndefined();

    // Resumable: the drill the learner was in the middle of is still theirs.
    failing = false;
    clock.advance(100);
    expect(drill.press('s').kind).toBe('correct');
    clock.advance(100);
    expect(drill.press('k').result?.completed).toBe(true);
    expect(session.progress.keyStats[keyStatId('s')]?.hits).toBe(1);
  });
});

describe('regression 6: words must not break across lines', () => {
  // Rendering each character as its own element let lines break mid-word, which
  // is disorienting when you are typing.
  //
  // Acceptance criteria: at 320, 600 and 1200 CSS pixels, no word straddles two
  // lines. Measured from client rects, not from the markup.

  it.todo('keeps every word on one line at 320 CSS pixels');
  it.todo('keeps every word on one line at 600 and 1200 CSS pixels');
});

describe('regression 7: storage keys must be safe', () => {
  // Per-key statistics were keyed by the character itself, and characters such
  // as full stop and space are not legal field names in some stores, so writes
  // failed silently.

  const awkward = ['.', ' ', ',', "'", ';', '/', '\\', '`', '£', '"', '#', '$', '[', ']'];

  it('keys by code point, so no key is ever an illegal field name', () => {
    for (const character of awkward) {
      const id = keyStatId(character);
      expect(id).toMatch(/^cp\d+$/);
      expect(id).not.toContain('.');
      expect(id).not.toContain(' ');
      expect(id).not.toContain('$');
      expect(id).not.toContain('/');
    }
  });

  it('round-trips the awkward characters through a save and load', () => {
    const progress: Progress = { ...emptyProgress() };
    for (const character of awkward) {
      progress.keyStats[keyStatId(character)] = { hits: 3, misses: 1, totalMs: 90, samples: 3 };
    }

    const store = new ProgressStore(new MemoryStorageDriver());
    store.save(progress);
    const { progress: loaded, warnings } = store.load();

    expect(warnings).toEqual([]);
    for (const character of awkward) {
      expect(
        loaded.keyStats[keyStatId(character)],
        `lost statistics for ${JSON.stringify(character)}`,
      ).toEqual({ hits: 3, misses: 1, totalMs: 90, samples: 3 });
    }
  });

  it('gives every awkward character a distinct key', () => {
    const ids = new Set(awkward.map((character) => keyStatId(character)));
    expect(ids.size).toBe(awkward.length);
  });
});

describe('regression 8: button contrast in both themes', () => {
  // A theme rule with higher specificity than the outline button's own colour
  // painted it white on white.
  //
  // The maths is unit-tested here. The computed-style check against both button
  // variants in both real themes lives in the end-to-end suite, because only a
  // browser resolves cascade and custom properties.

  it('fails a foreground that matches its background', () => {
    expect(contrastRatio('#ffffff', '#ffffff')).toBeLessThan(AA_NON_TEXT);
    expect(contrastRatio('rgb(255, 255, 255)', 'rgb(255, 255, 255)')).toBeLessThan(AA_TEXT);
  });

  it('fails a near-white on white, not just an exact match', () => {
    expect(contrastRatio('#fdfdfd', '#ffffff')).toBeLessThan(AA_NON_TEXT);
  });

  it.todo('checks both button variants against their real backgrounds in the light theme');
  it.todo('checks both button variants against their real backgrounds in the dark theme');
});
