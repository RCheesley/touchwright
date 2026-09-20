/**
 * The engine plus a thin DOM.
 *
 * The point of these is that the surface is genuinely thin: the engine is driven
 * by real keydown events and returns state, and everything the learner sees is
 * derived from that state. Nothing here reaches into the engine, and the engine
 * reaches into nothing here.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GLOVE80, describeKey, indexKeys } from '../../src/board/index.js';
import {
  CONTINUE_GRACE_MS,
  createDrillSession,
  KeystrokeHandlerError,
  type Drill,
  type DrillOptions,
  type KeystrokeObserver,
} from '../../src/drill/index.js';
import { parseMoErgoLayoutText } from '../../src/keymap/moergo.js';
import { readReferenceLayout } from '../fixtures/index.js';

const keymap = parseMoErgoLayoutText(readReferenceLayout(), { board: GLOVE80 });
const boardKeys = indexKeys(GLOVE80);

/** Exactly what the UI will do: index and character in, words out. */
function nameNextKey(drill: Drill): string {
  const next = drill.next;
  if (next === null) return 'drill finished';
  const position = keymap.charToPosition.get(next.character);
  if (position === undefined) return `no key types ${JSON.stringify(next.character)}`;
  const key = boardKeys.get(position);
  if (key === undefined) return `no board position ${position}`;
  const label = next.character === ' ' ? 'space' : next.character;
  return `${label} at ${next.index}: ${describeKey(key)}`;
}

function testClock(start = 10_000) {
  let value = start;
  return {
    now: (): number => value,
    advance(ms: number): void {
      value += ms;
    },
  };
}

interface Harness {
  readonly drill: Drill;
  /** The classes rendered per character, which is all the marks are in the DOM. */
  marks(): string[];
  nextReadout(): string;
  resultText(): string;
  errorText(): string;
  /** How many drills the surface has started, so a reset is observable. */
  started(): number;
}

/**
 * A surface thin enough to fit in a test: one span per character, a readout for
 * the next key, a polite error region and an assertive result region.
 */
function mountSurface(clock: { now: () => number }, observer?: KeystrokeObserver) {
  const root = document.createElement('div');
  root.innerHTML = `
    <p id="next-key"></p>
    <p id="drill-error" role="status"></p>
    <div id="drill"></div>
    <p id="result" role="alert"></p>
  `;
  document.body.append(root);

  const textEl = mustFind('#drill');
  const nextEl = mustFind('#next-key');
  const errorEl = mustFind('#drill-error');
  const resultEl = mustFind('#result');

  const session = createDrillSession({ now: clock.now });
  let drill: Drill;
  let startCount = 0;

  function begin(text: string, limitMs = 0): void {
    const options: DrillOptions =
      observer === undefined ? { text, limitMs } : { text, limitMs, onKeystroke: observer };
    drill = session.start(options);
    startCount += 1;
    errorEl.textContent = '';
    resultEl.textContent = '';
    textEl.replaceChildren(
      ...drill.characters.map((character) => {
        const span = document.createElement('span');
        span.className = 'ch pending';
        span.textContent = character === ' ' ? '\u00a0' : character;
        return span;
      }),
    );
    render();
  }

  function render(): void {
    const marks = drill.marks;
    const cursor = drill.cursor;
    [...textEl.children].forEach((child, index) => {
      const mark = marks[index] ?? 'pending';
      child.className = `ch ${mark}${index === cursor && !drill.isFinished ? ' cursor' : ''}`;
    });
    nextEl.textContent = nameNextKey(drill);
    const result = drill.result;
    if (result !== null) {
      resultEl.textContent = `${result.correctKeystrokes} of ${result.totalKeystrokes} in ${result.elapsedMs} ms, ${result.completed ? 'completed' : 'time up'}`;
    }
  }

  function onKeydown(event: KeyboardEvent): void {
    if (drill.isFinished) {
      // Any key carries on, once the grace has passed.
      if (drill.requestContinue(event.key).accepted) begin('the next drill');
      return;
    }
    if (event.key === 'Backspace') {
      drill.backspace();
      render();
      return;
    }
    if (Array.from(event.key).length !== 1) return;
    try {
      drill.press(event.key);
    } catch (error) {
      // Surfaced, never swallowed: the learner is told, and the drill is left as
      // it was so they can carry on.
      if (!(error instanceof KeystrokeHandlerError)) throw error;
      errorEl.textContent = 'That keystroke hit an error. Your drill is unchanged; keep going.';
    }
    render();
  }

  document.addEventListener('keydown', onKeydown);
  begin('ask a task');

  const harness: Harness = {
    get drill() {
      return drill;
    },
    marks: () => [...textEl.children].map((child) => child.className),
    nextReadout: () => nextEl.textContent,
    resultText: () => resultEl.textContent,
    errorText: () => errorEl.textContent,
    started: () => startCount,
  };

  return {
    harness,
    unmount(): void {
      document.removeEventListener('keydown', onKeydown);
      root.remove();
    },
  };
}

function mustFind(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector);
  if (element === null) throw new Error(`the harness is missing ${selector}`);
  return element;
}

function press(key: string, clock: { advance(ms: number): void }, gapMs = 90): void {
  clock.advance(gapMs);
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
}

describe('a drill driven by real keydown events', () => {
  const clock = testClock();
  let mounted: ReturnType<typeof mountSurface>;

  beforeEach(() => {
    mounted = mountSurface(clock);
  });

  afterEach(() => {
    mounted.unmount();
    document.body.replaceChildren();
  });

  it('advances and marks the character correct', () => {
    press('a', clock);

    expect(mounted.harness.marks().slice(0, 2)).toEqual(['ch correct', 'ch pending cursor']);
    expect(mounted.harness.drill.cursor).toBe(1);
  });

  it('marks a wrong character and still advances', () => {
    press('x', clock);

    expect(mounted.harness.marks().slice(0, 2)).toEqual(['ch wrong', 'ch pending cursor']);
    expect(mounted.harness.drill.cursor).toBe(1);
  });

  it('steps back on Backspace and clears the mark it steps over', () => {
    press('a', clock);
    press('x', clock);
    expect(mounted.harness.marks().slice(0, 2)).toEqual(['ch correct', 'ch wrong']);

    press('Backspace', clock);

    expect(mounted.harness.marks().slice(0, 2)).toEqual(['ch correct', 'ch pending cursor']);
  });

  it('names hand, finger and row for the next key, from the index and character', () => {
    expect(mounted.harness.nextReadout()).toBe('a at 0: left hand, pinky, home row');

    press('a', clock);
    // The Maltron layout puts s on the left index finger, not where QWERTY does.
    expect(mounted.harness.nextReadout()).toBe('s at 1: left hand, index, home row');

    press('s', clock);
    press('k', clock);
    // A space is a board position like any other, named the same way.
    expect(mounted.harness.nextReadout()).toBe('space at 3: right thumb, lower arc');
  });

  it('announces a result with counts and elapsed time when the text is finished', () => {
    for (const character of Array.from('ask a task')) press(character, clock, 100);

    expect(mounted.harness.drill.isFinished).toBe(true);
    expect(mounted.harness.resultText()).toBe('10 of 10 in 900 ms, completed');
    expect(mounted.harness.nextReadout()).toBe('drill finished');
  });

  it('continues on any key once the grace has passed, and resets the surface', () => {
    for (const character of Array.from('ask a task')) press(character, clock, 100);
    const drillsStarted = mounted.harness.started();

    // Still inside the grace: the overrun keystroke does not skip the result.
    press('k', clock, 10);
    expect(mounted.harness.started()).toBe(drillsStarted);
    expect(mounted.harness.resultText()).not.toBe('');

    press('k', clock, CONTINUE_GRACE_MS);

    expect(mounted.harness.started()).toBe(drillsStarted + 1);
    expect(mounted.harness.drill.text).toBe('the next drill');
    expect(mounted.harness.drill.cursor).toBe(0);
    expect(mounted.harness.marks()[0]).toBe('ch pending cursor');
    expect(mounted.harness.resultText()).toBe('');
  });
});

describe('a keystroke that throws inside the surface', () => {
  const clock = testClock();
  let mounted: ReturnType<typeof mountSurface>;

  beforeEach(() => {
    mounted = mountSurface(clock, () => {
      throw new Error('the recorder threw');
    });
  });

  afterEach(() => {
    mounted.unmount();
    document.body.replaceChildren();
  });

  it('tells the learner and leaves the drill exactly where it was', () => {
    press('a', clock);

    expect(mounted.harness.errorText()).toMatch(/unchanged/);
    expect(mounted.harness.drill.isFinished).toBe(false);
    expect(mounted.harness.drill.cursor).toBe(0);
    expect(mounted.harness.marks()[0]).toBe('ch pending cursor');
    expect(mounted.harness.resultText()).toBe('');
  });
});
