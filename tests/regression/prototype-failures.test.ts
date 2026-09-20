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

  it.todo('merges stats from a load that lands mid-drill without touching the drill');
  it.todo('leaves the drill text and cursor untouched when a load lands mid-drill');
  it.todo('applies the saved lesson when the load lands before a drill starts');
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

  it.todo('continues from the result screen on any key, not only space');
  it.todo('ignores keystrokes for a short grace period so an overrun cannot skip the result');
});

describe('regression 5: an error must not silently end a drill', () => {
  // The prototype caught keystroke errors and marked the drill complete, which
  // turned a hidden crash into a loop of new drills.
  //
  // Acceptance criteria:
  //  - a handler that throws surfaces an error to the user,
  //  - the drill is left intact and resumable, not marked complete,
  //  - and nothing is written to progress for the failed keystroke.

  it.todo('surfaces an error when a keystroke handler throws');
  it.todo('leaves the drill intact rather than marking it complete');
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
