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

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
import {
  renderDrillText,
  SAMPLE_DRILL_TEXT,
  type DrillTextRender,
} from '../../src/ui/drill-view.js';

/**
 * The stylesheet the app actually ships, comments stripped.
 *
 * Read from disk rather than described here, because regressions 6 and 8 are
 * both about what the stylesheet says: a rule renamed or deleted has to fail
 * these, not pass them.
 */
function readTheme(): string {
  return readFileSync(join(process.cwd(), 'src', 'ui', 'theme.css'), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  );
}

/** Every leaf rule in source order. An at-rule prelude carries no declarations. */
function leafRules(css: string): readonly { selector: string; body: string }[] {
  const found: { selector: string; body: string }[] = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let match = pattern.exec(css);
  while (match !== null) {
    found.push({ selector: (match[1] ?? '').trim(), body: match[2] ?? '' });
    match = pattern.exec(css);
  }
  return found;
}

function parseDeclarations(body: string): Map<string, string> {
  const declarations = new Map<string, string>();
  for (const part of body.split(';')) {
    const colon = part.indexOf(':');
    if (colon === -1) continue;
    declarations.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim());
  }
  return declarations;
}

/**
 * The declarations of one rule. Throws when the selector is not in the
 * stylesheet, because a test that silently found nothing would pass for the
 * wrong reason, which is exactly how the original bug survived.
 */
function declarationsFor(css: string, selector: string): Map<string, string> {
  const rule = leafRules(css).find((candidate) => candidate.selector === selector);
  if (rule === undefined) {
    throw new Error(`theme.css has no rule for "${selector}"`);
  }
  return parseDeclarations(rule.body);
}

/** The custom properties in force in one theme; dark overlays light. */
function themeTokens(css: string, theme: 'light' | 'dark'): Map<string, string> {
  const darkAt = css.search(/@media\s*\(\s*prefers-color-scheme:\s*dark\s*\)/);
  if (darkAt === -1) {
    throw new Error('theme.css declares no dark theme');
  }
  const scope = theme === 'light' ? css.slice(0, darkAt) : css.slice(darkAt);
  const root = leafRules(scope).find((rule) => rule.selector === ':root');
  if (root === undefined) {
    throw new Error(`theme.css has no :root block for the ${theme} theme`);
  }

  const tokens = theme === 'dark' ? themeTokens(css, 'light') : new Map<string, string>();
  for (const [property, value] of parseDeclarations(root.body)) {
    if (property.startsWith('--')) tokens.set(property, value);
  }
  return tokens;
}

/** Resolve var() against a theme's tokens. A missing token throws. */
function resolveColour(value: string, tokens: ReadonlyMap<string, string>): string {
  let resolved = value;
  for (let depth = 0; depth < 10; depth += 1) {
    const reference = /var\(\s*(--[\w-]+)\s*(?:,[^()]*)?\)/.exec(resolved);
    if (reference?.[1] === undefined) return resolved.trim();
    const token = tokens.get(reference[1]);
    if (token === undefined) {
      throw new Error(`theme.css uses ${reference[1]}, which no :root block defines`);
    }
    resolved = resolved.replace(reference[0], token);
  }
  throw new Error(`Could not resolve ${value}: custom properties nest too deeply`);
}

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
  //
  // Both halves of that are here. jsdom has no layout engine, so the client-rect
  // measurement itself lives in `tests/e2e/drill.spec.ts`, under these same
  // names, where a real browser lays the paragraph out at all three widths in
  // both themes. What these two guard is everything that measurement depends on:
  // the structure that makes an internal break impossible, the stylesheet rule
  // that forbids one, and the width budget that keeps the longest word inside
  // the narrowest line. A sample text with a 40-character word would pass the
  // structural half and fail here, which is the point.

  /** Space each side of the page, from --space, applied to main. */
  const PAGE_GUTTER_PX = 16;
  /** .drill-surface: 0.75rem of padding and a 2px border, each side. */
  const SURFACE_INSET_PX = 12 + 2;
  /** --measure, 38rem, caps how wide the column ever gets. */
  const MEASURE_PX = 38 * 16;
  /** A monospace advance is close to 0.6em; rounded up, so the budget is cautious. */
  const ADVANCE_RATIO = 0.62;

  /** .drill-text: clamp(1rem, 0.85rem + 1.2vw, 1.375rem). */
  function drillFontSizePx(viewportWidth: number): number {
    const preferred = 0.85 * 16 + (1.2 * viewportWidth) / 100;
    return Math.min(Math.max(16, preferred), 1.375 * 16);
  }

  /** How many characters of drill text fit on one line at this viewport width. */
  function lineBudgetChars(viewportWidth: number): number {
    const column = Math.min(viewportWidth, MEASURE_PX) - PAGE_GUTTER_PX * 2 - SURFACE_INSET_PX * 2;
    return Math.floor(column / (drillFontSizePx(viewportWidth) * ADVANCE_RATIO));
  }

  /** The words the surface will render, and the elements they are rendered as. */
  function renderSample(): DrillTextRender {
    return renderDrillText(SAMPLE_DRILL_TEXT);
  }

  function longestWord(rendered: DrillTextRender): string {
    return rendered.wordTexts.reduce(
      (longest, word) => (word.length > longest.length ? word : longest),
      '',
    );
  }

  /** `white-space` for .drill-word, read from the stylesheet the app ships. */
  function drillWordWhiteSpace(): string | undefined {
    return declarationsFor(readTheme(), '.drill-word').get('white-space');
  }

  it('keeps every word on one line at 320 CSS pixels', () => {
    const rendered = renderSample();

    // Structure: every character of a word is inside that word's element, so
    // there is no break opportunity between two characters of the same word.
    expect(rendered.words.length).toBeGreaterThan(1);
    for (const [index, word] of rendered.words.entries()) {
      expect(word.textContent, `word ${index}`).toBe(rendered.wordTexts[index]);
      expect(word.textContent).not.toMatch(/\s/u);
    }
    // And no loose character is left in the paragraph except the whitespace that
    // is meant to be where a line breaks.
    for (const node of rendered.nodes) {
      const loose = node.classList.contains('drill-char');
      expect(loose ? node.textContent : ' ').toMatch(/\s/u);
    }

    // The rule that forbids an internal break, stated by the stylesheet itself.
    expect(drillWordWhiteSpace()).toBe('nowrap');

    // And the narrowest line still has room for the longest word, so nothing has
    // to overflow to stay unbroken.
    const widest = longestWord(rendered);
    expect(widest.length, `"${widest}" at 320 CSS pixels`).toBeLessThanOrEqual(
      lineBudgetChars(320),
    );
  });

  it('keeps every word on one line at 600 and 1200 CSS pixels', () => {
    const rendered = renderSample();
    const widest = longestWord(rendered);

    for (const width of [600, 1200]) {
      const budget = lineBudgetChars(width);
      expect(budget, `line budget at ${width} CSS pixels`).toBeGreaterThan(0);
      expect(widest.length, `"${widest}" at ${width} CSS pixels`).toBeLessThanOrEqual(budget);
    }

    // A wider viewport must not change the structure that keeps a word together:
    // it is the same markup and the same rule at every width.
    expect(drillWordWhiteSpace()).toBe('nowrap');
    expect(declarationsFor(readTheme(), '.drill-text').get('overflow-wrap')).toBe('normal');
  });
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

  /** Both variants, so neither can be added without being measured. */
  const VARIANTS = ['.button-solid', '.button-outline'] as const;
  /** The two surfaces a button can sit on: the page, and a sunken panel. */
  const BEHIND = ['--surface', '--surface-sunken'] as const;

  interface Painted {
    readonly ink: string;
    readonly background: string;
    readonly borderColour: string;
    readonly behind: readonly string[];
  }

  /**
   * What a variant actually paints in one theme, resolved through the same
   * custom properties the browser resolves. A variant that declares no colour or
   * no background of its own throws, because that is the hole the theme rule fell
   * through the first time.
   */
  function painted(variant: string, theme: 'light' | 'dark'): Painted {
    const css = readTheme();
    const tokens = themeTokens(css, theme);
    const declarations = declarationsFor(css, variant);

    const ink = declarations.get('color');
    const background = declarations.get('background') ?? declarations.get('background-color');
    const borderColour = declarations.get('border-color');
    if (ink === undefined || background === undefined || borderColour === undefined) {
      throw new Error(
        `${variant} must declare its own color, background and border-color, or a theme rule can outrank it`,
      );
    }

    return {
      ink: resolveColour(ink, tokens),
      background: resolveColour(background, tokens),
      borderColour: resolveColour(borderColour, tokens),
      behind: BEHIND.map((token) => resolveColour(`var(${token})`, tokens)),
    };
  }

  function expectReadable(variant: string, theme: 'light' | 'dark'): void {
    const { ink, background, borderColour, behind } = painted(variant, theme);

    expect(
      contrastRatio(ink, background),
      `${variant} in the ${theme} theme: ${ink} on ${background}`,
    ).toBeGreaterThanOrEqual(AA_TEXT);

    // The shape of the original bug, stated directly: white on white.
    expect(
      contrastRatio(ink, background),
      `${variant} in the ${theme} theme is invisible`,
    ).toBeGreaterThan(1.5);

    // And the button's own edge has to be findable on either page surface, which
    // is what makes an outline button a button at all.
    for (const surface of behind) {
      expect(
        contrastRatio(borderColour, surface),
        `${variant} border ${borderColour} on ${surface} in the ${theme} theme`,
      ).toBeGreaterThanOrEqual(AA_NON_TEXT);
    }
  }

  it('checks both button variants against their real backgrounds in the light theme', () => {
    for (const variant of VARIANTS) expectReadable(variant, 'light');

    // The cascade shape, not just the numbers: only the variant rules may give a
    // button a colour. A theme rule that painted one would show up here.
    const painters = leafRules(readTheme())
      .filter((rule) => /button/i.test(rule.selector))
      .filter((rule) => {
        const declarations = parseDeclarations(rule.body);
        return (
          declarations.has('color') ||
          declarations.has('background') ||
          declarations.has('background-color')
        );
      })
      .map((rule) => rule.selector);
    expect(painters.sort()).toEqual([...VARIANTS].sort());
  });

  it('checks both button variants against their real backgrounds in the dark theme', () => {
    for (const variant of VARIANTS) expectReadable(variant, 'dark');

    // Every variant is re-measured in the dark theme rather than assumed, because
    // the dark theme is where the specificity accident happened.
    for (const variant of VARIANTS) {
      const light = painted(variant, 'light');
      const dark = painted(variant, 'dark');
      expect(dark.ink, `${variant} did not change with the theme`).not.toBe(light.ink);
    }
  });
});
