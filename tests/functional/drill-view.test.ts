/**
 * The drill surface, against the real markup.
 *
 * The body of `index.html` is what these mount, so a rename in the markup fails
 * here rather than in a browser. The engine is driven by real keydown events on
 * the document, because that is how keyboard capture actually works: there is no
 * input element anywhere on the drill surface.
 *
 * What is checked here versus elsewhere: the behaviour and the text live here,
 * the computed colours and the line breaking live in `tests/e2e/drill.spec.ts`,
 * because only a browser resolves a cascade or lays out a line.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GLOVE80 } from '../../src/board/index.js';
import { CONTINUE_GRACE_MS, createDrillSession } from '../../src/drill/index.js';
import { parseMoErgoLayoutText } from '../../src/keymap/moergo.js';
import { emptyProgress } from '../../src/stats/storage.js';
import {
  createDrillView,
  DrillTextNotTypeableError,
  renderDrillText,
  SAMPLE_DRILL_TEXT,
  type DrillView,
  type NextKeyFacts,
} from '../../src/ui/drill-view.js';
import { readReferenceLayout } from '../fixtures/index.js';

const keymap = parseMoErgoLayoutText(readReferenceLayout(), { board: GLOVE80 });

/** The real page, so the markup and the module cannot drift apart unnoticed. */
const PAGE_BODY = (() => {
  const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
  const body = /<body>([\s\S]*)<\/body>/.exec(html);
  if (body?.[1] === undefined) {
    throw new Error('index.html has no <body> for the functional tests to mount');
  }
  // The module script is loaded by the browser, never by these tests: they wire
  // the view up themselves so that nothing depends on load order.
  return body[1].replace(/<script[\s\S]*?<\/script>/g, '');
})();

function testClock(start = 10_000) {
  let value = start;
  return {
    now: (): number => value,
    advance(ms: number): void {
      value += ms;
    },
  };
}

function find(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector);
  if (element === null) throw new Error(`index.html is missing ${selector}`);
  return element;
}

function text(selector: string): string {
  return find(selector).textContent;
}

function type(key: string, clock: { advance(ms: number): void }, gapMs = 90): KeyboardEvent {
  clock.advance(gapMs);
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  document.dispatchEvent(event);
  return event;
}

function marks(): string[] {
  return [...document.querySelectorAll<HTMLElement>('#drill-text .drill-char')].map(
    (span) => span.dataset['mark'] ?? 'missing',
  );
}

function cursorIndex(): number {
  const spans = [...document.querySelectorAll<HTMLElement>('#drill-text .drill-char')];
  return spans.findIndex((span) => span.dataset['cursor'] === 'true');
}

interface Mounted {
  readonly view: DrillView;
  readonly clock: ReturnType<typeof testClock>;
  readonly highlights: NextKeyFacts[];
}

function mount(options: { text?: string; frozenProgress?: boolean } = {}): Mounted {
  document.body.innerHTML = PAGE_BODY;
  // Sections start hidden in the markup, and a hidden element cannot take focus.
  find('#drill-section').hidden = false;

  const clock = testClock();
  const highlights: NextKeyFacts[] = [];
  const progress = emptyProgress();
  if (options.frozenProgress === true) {
    // Exactly the shape of the original failure: a store that hands over frozen
    // progress, so the recorder throws on the first keystroke.
    Object.freeze(progress.keyStats);
  }

  const view = createDrillView({
    board: GLOVE80,
    keymap,
    text: options.text ?? SAMPLE_DRILL_TEXT,
    session: createDrillSession({ now: clock.now, progress }),
    lessonName: 'the sample drill',
    nextLessonName: null,
    onNextKey: (next): void => {
      if (next !== null) highlights.push(next);
    },
  });

  return { view, clock, highlights };
}

describe('the drill text', () => {
  it('wraps each word so a line can only break between words', () => {
    const rendered = renderDrillText('ask a task');

    expect(rendered.wordTexts).toEqual(['ask', 'a', 'task']);
    expect(rendered.words).toHaveLength(3);
    // Every non-space character sits inside a word, and every space sits outside
    // one: those spaces are the only break opportunities in the paragraph.
    for (const [index, character] of [...'ask a task'].entries()) {
      const span = rendered.characters[index]!;
      const parentIsWord = span.parentElement?.classList.contains('drill-word') === true;
      expect(parentIsWord, `character ${index} (${JSON.stringify(character)})`).toBe(
        character !== ' ',
      );
    }
  });

  it('keeps the space characters as characters, marks and all', () => {
    const rendered = renderDrillText('ask a');
    const space = rendered.characters[3]!;
    expect(space.textContent).toBe(' ');
    expect(space.dataset['mark']).toBe('pending');
    expect(space.classList.contains('drill-char-space')).toBe(true);
  });
});

describe('a mounted drill surface', () => {
  let mounted: Mounted;

  beforeEach(() => {
    mounted = mount();
  });

  afterEach(() => {
    mounted.view.destroy();
    document.body.replaceChildren();
  });

  it('has no input element of its own, and still takes printable keys', () => {
    mounted.view.start();

    expect(find('#drill-section').querySelectorAll('input, textarea, [contenteditable]')).toEqual(
      expect.objectContaining({ length: 0 }),
    );

    const event = type('a', mounted.clock);
    expect(event.defaultPrevented).toBe(true);
    expect(mounted.view.drill?.cursor).toBe(1);
    expect(marks()[0]).toBe('correct');
  });

  it('distinguishes correct, wrong and pending by state, not only by colour', () => {
    mounted.view.start();

    type('a', mounted.clock);
    type('z', mounted.clock);

    // data-mark is the channel a stylesheet turns into a decoration and a test
    // can read without seeing a colour at all.
    expect(marks().slice(0, 4)).toEqual(['correct', 'wrong', 'pending', 'pending']);
    expect(cursorIndex()).toBe(2);
  });

  it('steps back on Backspace and clears the mark it steps over', () => {
    mounted.view.start();
    type('a', mounted.clock);
    type('z', mounted.clock);

    type('Backspace', mounted.clock);

    expect(marks().slice(0, 2)).toEqual(['correct', 'pending']);
    expect(cursorIndex()).toBe(1);
  });

  it('names hand, finger and row for the next key as the primary channel', () => {
    mounted.view.start();
    expect(text('#drill-next')).toContain('“a” — left hand, pinky, home row');

    type('a', mounted.clock);
    // The Maltron layout puts s on the left index finger, not where QWERTY does.
    expect(text('#drill-next')).toContain('“s” — left hand, index, home row');

    type('s', mounted.clock);
    type('k', mounted.clock);
    // A space is a board position like any other, and it is named, not shown blank.
    expect(text('#drill-next')).toContain('space — right thumb, lower arc');
  });

  it('describes the surface by its next key and finger, and gives it a name', () => {
    mounted.view.start();
    const surface = find('#drill-surface');

    expect(surface.getAttribute('aria-label')).toBe('Drill text');
    const described = (surface.getAttribute('aria-describedby') ?? '').split(/\s+/);
    expect(described).toContain('drill-next');
    for (const id of described) {
      expect(find(`#${id}`).textContent, `#${id} is empty, so it describes nothing`).not.toBe('');
    }
    expect(text('#drill-next')).toMatch(/finger|pinky|ring|middle|index|thumb/);
  });

  it('hands the next key to the caller so the board can reinforce the words', () => {
    mounted.view.start();
    const first = mounted.highlights.at(-1);
    expect(first?.character).toBe('a');
    expect(first?.position).toBe(keymap.charToPosition.get('a'));

    type('a', mounted.clock);
    expect(mounted.highlights.at(-1)?.character).toBe('s');
  });

  it('announces the word politely, and not a keystroke at a time', () => {
    mounted.view.start();
    expect(text('#drill-progress')).toContain('Type what you see');

    type('a', mounted.clock);
    type('s', mounted.clock);
    const duringFirstWord = text('#drill-progress');

    type('k', mounted.clock);
    type(' ', mounted.clock);
    expect(text('#drill-progress')).not.toBe(duringFirstWord);
    expect(text('#drill-progress')).toContain('Word 2 of');
    expect(find('#drill-progress').getAttribute('aria-live')).toBe('polite');
  });

  it('announces a mistake, saying which key was expected and where it is', () => {
    mounted.view.start();
    type('z', mounted.clock);

    expect(text('#drill-progress')).toContain('Wrong key');
    expect(text('#drill-progress')).toContain('left hand, pinky, home row');
  });

  it('shows the result at the end, with the next step named', () => {
    mounted.view.start();
    for (const character of Array.from(SAMPLE_DRILL_TEXT)) type(character, mounted.clock, 100);

    expect(mounted.view.drill?.isFinished).toBe(true);
    expect(find('#drill-result').hidden).toBe(false);

    const summary = text('#drill-result-summary');
    expect(summary).toContain('Drill complete');
    expect(summary).toContain('words per minute');
    expect(summary).toContain('accuracy');
    expect(summary).toContain('Next:');

    // The words come from scoring's nextStep, never invented here.
    expect(text('#drill-continue')).not.toBe('');
    expect(text('#drill-result-why')).not.toBe('');
    expect(text('#drill-result-detail')).toContain('stars of 3');
    // Assertive, as the brief requires: progress is polite, the result is not.
    expect(find('#drill-result-summary').getAttribute('role')).toBe('alert');
  });

  it('carries on to a new drill on any key, once the grace has passed', () => {
    mounted.view.start();
    for (const character of Array.from(SAMPLE_DRILL_TEXT)) type(character, mounted.clock, 100);
    const finished = mounted.view.drill;

    // The overrun keystroke of someone still typing must not skip the result.
    type('k', mounted.clock, 10);
    expect(mounted.view.drill).toBe(finished);
    expect(find('#drill-result').hidden).toBe(false);

    type('k', mounted.clock, CONTINUE_GRACE_MS);

    expect(mounted.view.drill).not.toBe(finished);
    expect(mounted.view.drill?.cursor).toBe(0);
    expect(find('#drill-result').hidden).toBe(true);
    expect(marks().every((mark) => mark === 'pending')).toBe(true);
  });
});

describe('keyboard capture', () => {
  let mounted: Mounted;

  beforeEach(() => {
    mounted = mount();
  });

  afterEach(() => {
    mounted.view.destroy();
    document.body.replaceChildren();
  });

  it('releases on Escape, from the middle of a drill', () => {
    mounted.view.start();
    type('a', mounted.clock);
    expect(mounted.view.captured).toBe(true);

    const escape = type('Escape', mounted.clock);

    expect(escape.defaultPrevented).toBe(true);
    expect(mounted.view.captured).toBe(false);
    expect(find('#drill-surface').dataset['captured']).toBe('false');
    // And the keyboard really is back: a printable key no longer types.
    const after = type('s', mounted.clock);
    expect(after.defaultPrevented).toBe(false);
    expect(mounted.view.drill?.cursor).toBe(1);
  });

  it('releases on Escape from the result screen too', () => {
    mounted.view.start();
    for (const character of Array.from(SAMPLE_DRILL_TEXT)) type(character, mounted.clock, 100);

    type('Escape', mounted.clock, CONTINUE_GRACE_MS);

    expect(mounted.view.captured).toBe(false);
    const after = type('k', mounted.clock);
    expect(after.defaultPrevented).toBe(false);
  });

  it('says in visible text how to escape, and what happened when you did', () => {
    // Visible text in the markup, not a title attribute: an acceptance criterion.
    expect(text('#drill-escape')).toContain('Escape');
    expect(find('#drill-escape').hasAttribute('title')).toBe(false);
    expect(text('#drill-how')).toContain('Escape');

    mounted.view.start();
    expect(text('#drill-capture')).toContain('Escape');

    type('Escape', mounted.clock);
    expect(text('#drill-capture')).toContain('Tab');
    expect(text('#drill-capture')).toContain('Resume drill');
  });

  it('moves focus to a real control on Escape, so Tab carries on from there', () => {
    mounted.view.start();
    type('Escape', mounted.clock);

    expect(document.activeElement).toBe(find('#drill-start'));
    expect(text('#drill-start')).toBe('Resume drill');
  });

  it('never consumes Tab, whatever state the drill is in', () => {
    mounted.view.start();
    const beforeTyping = type('Tab', mounted.clock);
    expect(beforeTyping.defaultPrevented).toBe(false);

    type('a', mounted.clock);
    const midDrill = type('Tab', mounted.clock);
    expect(midDrill.defaultPrevented).toBe(false);
    // Tab is not a keystroke either: the drill did not move.
    expect(mounted.view.drill?.cursor).toBe(1);

    for (const character of Array.from(SAMPLE_DRILL_TEXT).slice(1)) {
      type(character, mounted.clock, 100);
    }
    const afterResult = type('Tab', mounted.clock, CONTINUE_GRACE_MS);
    expect(afterResult.defaultPrevented).toBe(false);
  });

  it('leaves browser and system shortcuts alone', () => {
    mounted.view.start();

    for (const modifiers of [{ ctrlKey: true }, { metaKey: true }]) {
      const event = new KeyboardEvent('keydown', {
        key: 'r',
        bubbles: true,
        cancelable: true,
        ...modifiers,
      });
      document.dispatchEvent(event);
      expect(event.defaultPrevented, `${JSON.stringify(modifiers)} was swallowed`).toBe(false);
    }
    expect(mounted.view.drill?.cursor).toBe(0);
  });

  it('releases when focus moves to something else on the page', () => {
    mounted.view.start();
    expect(mounted.view.captured).toBe(true);

    find('#layout-file').dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

    expect(mounted.view.captured).toBe(false);
    expect(type('a', mounted.clock).defaultPrevented).toBe(false);
  });

  it('takes the keyboard back when the surface is focused again', () => {
    mounted.view.start();
    type('Escape', mounted.clock);
    expect(mounted.view.captured).toBe(false);

    find('#drill-surface').dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

    expect(mounted.view.captured).toBe(true);
    expect(type('a', mounted.clock).defaultPrevented).toBe(true);
  });

  it('stops listening for keys once it is destroyed', () => {
    mounted.view.start();
    mounted.view.destroy();

    expect(mounted.view.captured).toBe(false);
    expect(type('a', mounted.clock).defaultPrevented).toBe(false);
  });
});

describe('the drill surface under failure', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('surfaces a keystroke error and leaves the drill exactly where it was', () => {
    const mounted = mount({ frozenProgress: true });
    mounted.view.start();

    type('a', mounted.clock);

    expect(find('#drill-error').hidden).toBe(false);
    expect(text('#drill-error')).toMatch(/unchanged/);
    expect(mounted.view.drill?.cursor).toBe(0);
    expect(mounted.view.drill?.isFinished).toBe(false);
    expect(marks()[0]).toBe('pending');
    expect(find('#drill-result').hidden).toBe(true);

    mounted.view.destroy();
  });

  it('refuses a drill this layout cannot type, rather than dropping characters', () => {
    const mounted = mount({ text: 'ask ☃ a task' });

    expect(() => {
      mounted.view.start();
    }).toThrow(DrillTextNotTypeableError);

    mounted.view.destroy();
  });
});
