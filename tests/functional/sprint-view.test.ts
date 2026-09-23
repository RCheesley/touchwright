/**
 * Sprint mode on the real markup, and the duration control beside it.
 *
 * The body of `index.html` is what these mount, so a rename fails here rather
 * than in a browser. Nothing waits for a real second: the drill surface takes
 * its schedule as an option, so a test holds the ticks and fires them by hand
 * against a clock it drives itself.
 *
 * What lives here rather than in `tests/unit/sprint.test.ts`: everything that
 * needs a DOM. The countdown text, the polite region beside it, the result card
 * naming what kind of drill it was, and the guarantee that a sprint abandoned
 * for a lesson leaves nothing behind that can touch that lesson.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GLOVE80 } from '../../src/board/index.js';
import { createDrillSession, type DrillSession } from '../../src/drill/index.js';
import { NO_LIMIT, SPRINT_DURATIONS_MS } from '../../src/drill/limits.js';
import { parseMoErgoLayoutText } from '../../src/keymap/moergo.js';
import { emptyProgress } from '../../src/stats/storage.js';
import { createDrillView, type DrillView } from '../../src/ui/drill-view.js';
import {
  createSprintControls,
  DEFAULT_SPRINT_LIMIT_MS,
  type SprintControls,
} from '../../src/ui/sprint-controls.js';
import { readReferenceLayout } from '../fixtures/index.js';

const keymap = parseMoErgoLayoutText(readReferenceLayout(), { board: GLOVE80 });

const PAGE_BODY = (() => {
  const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
  const body = /<body>([\s\S]*)<\/body>/.exec(html);
  if (body?.[1] === undefined) {
    throw new Error('index.html has no <body> for the functional tests to mount');
  }
  return body[1].replace(/<script[\s\S]*?<\/script>/g, '');
})();

/** Every character of it is on the reference layout's very first lesson. */
const SPRINT_TEXT = 'a task and a flask';

function testClock(start = 10_000) {
  let value = start;
  return {
    now: (): number => value,
    advance(ms: number): void {
      value += ms;
    },
  };
}

/** The ticks the view has scheduled, fired by hand. */
function manualSchedule() {
  const ticks = new Set<() => void>();
  const schedule = (tick: () => void): (() => void) => {
    ticks.add(tick);
    return (): void => {
      ticks.delete(tick);
    };
  };
  return {
    schedule,
    fire(): void {
      for (const tick of [...ticks]) tick();
    },
    /**
     * The ticks as they stand now, kept past their cancel.
     *
     * This is how a missed `clearInterval` is reproduced: the app stops the
     * timer properly, and the test fires the callback anyway, to prove that the
     * binding rather than the teardown is what keeps the next drill safe.
     */
    snapshot(): readonly (() => void)[] {
      return [...ticks];
    },
    get live(): number {
      return ticks.size;
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

function type(key: string, clock: { advance(ms: number): void }, gapMs = 90): void {
  clock.advance(gapMs);
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

interface Mounted {
  readonly clock: ReturnType<typeof testClock>;
  readonly schedule: ReturnType<typeof manualSchedule>;
  readonly session: DrillSession;
  sprint(limitMs?: number): DrillView;
  lesson(): DrillView;
  readonly views: DrillView[];
}

function mount(): Mounted {
  document.body.innerHTML = PAGE_BODY;
  find('#drill-section').hidden = false;
  find('#sprint-section').hidden = false;

  const clock = testClock();
  const schedule = manualSchedule();
  const session = createDrillSession({ now: clock.now, progress: emptyProgress() });
  const views: DrillView[] = [];

  return {
    clock,
    schedule,
    session,
    views,
    sprint(limitMs = 30_000): DrillView {
      const view = createDrillView({
        board: GLOVE80,
        keymap,
        text: SPRINT_TEXT,
        limitMs,
        mode: 'sprint',
        lessonId: null,
        lessonName: null,
        session,
        schedule: schedule.schedule,
      });
      views.push(view);
      return view;
    },
    lesson(): DrillView {
      const view = createDrillView({
        board: GLOVE80,
        keymap,
        text: SPRINT_TEXT,
        limitMs: NO_LIMIT,
        mode: 'lesson',
        lessonId: 'home',
        lessonName: 'Home row',
        session,
        schedule: schedule.schedule,
      });
      views.push(view);
      return view;
    },
  };
}

describe('a sprint on the drill surface', () => {
  let mounted: Mounted;

  beforeEach(() => {
    mounted = mount();
  });

  afterEach(() => {
    for (const view of mounted.views) view.destroy();
    document.body.replaceChildren();
  });

  it('shows a countdown as soon as a timed sprint starts', () => {
    const view = mounted.sprint(30_000);
    view.start();

    expect(find('#sprint-countdown').hidden).toBe(false);
    expect(text('#sprint-countdown')).toBe('Time left: 0:30');
  });

  it('counts down on its own, without a keystroke', () => {
    const view = mounted.sprint(30_000);
    view.start();
    type('a', mounted.clock);

    mounted.clock.advance(9_000);
    mounted.schedule.fire();
    expect(text('#sprint-countdown')).toBe('Time left: 0:21');

    mounted.clock.advance(10_000);
    mounted.schedule.fire();
    expect(text('#sprint-countdown')).toBe('Time left: 0:11');
  });

  it('never announces the countdown itself, which would speak every second', () => {
    const view = mounted.sprint(30_000);
    view.start();

    // role="timer" has an implicit aria-live of "off". The number changes every
    // second and must never be read out.
    expect(find('#sprint-countdown').getAttribute('role')).toBe('timer');
    expect(find('#sprint-countdown').getAttribute('aria-live')).toBeNull();
  });

  it('announces time running out politely, at milestones rather than every second', () => {
    const view = mounted.sprint(120_000);
    view.start();
    type('a', mounted.clock);

    const warning = find('#sprint-warning');
    expect(warning.getAttribute('aria-live')).toBe('polite');
    expect(warning.textContent).toBe('');

    const spoken: string[] = [];
    for (let elapsed = 0; elapsed < 120; elapsed += 1) {
      mounted.clock.advance(1_000);
      mounted.schedule.fire();
      const said = warning.textContent;
      if (said !== '' && spoken.at(-1) !== said) spoken.push(said);
    }

    // Three milestones over two minutes, not a hundred and twenty.
    expect(spoken).toHaveLength(3);
    expect(spoken[0]).toContain('1 minute left');
    expect(spoken[1]).toContain('30 seconds left');
    expect(spoken[2]).toContain('10 seconds left');
  });

  it('ends the sprint when its limit runs out, with nobody typing', () => {
    const view = mounted.sprint(30_000);
    view.start();
    type('a', mounted.clock);

    mounted.clock.advance(30_000);
    mounted.schedule.fire();

    expect(find('#drill-result').hidden).toBe(false);
    expect(text('#drill-result-summary')).toContain('Sprint over, time up');
    expect(text('#drill-result-detail')).toContain('the time limit ran out');
    expect(text('#sprint-countdown')).toBe('Time left: 0:00');
    // And nothing is left ticking once the result is on screen.
    expect(mounted.schedule.live).toBe(0);
  });

  it('tells a sprint apart from a lesson on the result card', () => {
    const view = mounted.sprint(30_000);
    view.start();
    for (const character of SPRINT_TEXT) type(character, mounted.clock);

    expect(find('#drill-result').hidden).toBe(false);
    expect(text('#drill-result-detail')).toContain('sprint across every unlocked key');
    expect(text('#drill-result-detail')).toContain('30 seconds');
    expect(text('#drill-result-detail')).toContain('none, this was not a lesson');
    expect(text('#drill-result-summary')).toContain('Sprint complete');
    expect(text('#drill-result-summary')).not.toContain('Drill complete');
  });

  it('says lesson on a lesson, so the two never read the same', () => {
    const view = mounted.lesson();
    view.start();
    for (const character of SPRINT_TEXT) type(character, mounted.clock);

    expect(text('#drill-result-detail')).toContain('lesson: Home row');
    expect(text('#drill-result-detail')).not.toContain('sprint');
    expect(text('#drill-result-summary')).toContain('Drill complete');
  });

  it('earns no stars, whatever the pace', () => {
    const view = mounted.sprint(60_000);
    view.start();
    for (const character of SPRINT_TEXT) type(character, mounted.clock, 40);

    expect(mounted.session.progress.stars).toEqual({});
    expect(mounted.session.progress.xp).toBeGreaterThan(0);
  });
});

describe('an untimed sprint', () => {
  let mounted: Mounted;

  beforeEach(() => {
    mounted = mount();
  });

  afterEach(() => {
    for (const view of mounted.views) view.destroy();
    document.body.replaceChildren();
  });

  it('says so in words rather than showing a clock that never moves', () => {
    const view = mounted.sprint(NO_LIMIT);
    view.start();

    expect(find('#sprint-countdown').hidden).toBe(false);
    expect(text('#sprint-countdown')).toContain('no time limit');
    expect(text('#sprint-countdown')).not.toMatch(/\d:\d\d/u);
  });

  it('genuinely never expires, at any elapsed time at all', () => {
    const view = mounted.sprint(NO_LIMIT);
    view.start();
    type('a', mounted.clock);

    // A minute, a day, a year, then a century. None of it ends the sprint.
    for (const jump of [60_000, 86_400_000, 31_557_600_000, 3_155_760_000_000]) {
      mounted.clock.advance(jump);
      mounted.schedule.fire();
      expect(find('#drill-result').hidden).toBe(true);
      expect(text('#sprint-countdown')).toContain('no time limit');
    }

    // And it is still typeable after all that: the next keystroke lands.
    type(' ', mounted.clock);
    expect(document.querySelectorAll('#drill-text .drill-char[data-mark="correct"]')).toHaveLength(
      2,
    );
    expect(find('#drill-result').hidden).toBe(true);
  });

  it('never announces a milestone, because there is no milestone to reach', () => {
    const view = mounted.sprint(NO_LIMIT);
    view.start();
    type('a', mounted.clock);

    for (let tick = 0; tick < 200; tick += 1) {
      mounted.clock.advance(1_000);
      mounted.schedule.fire();
    }

    expect(text('#sprint-warning')).toBe('');
  });
});

describe('abandoning a sprint', () => {
  let mounted: Mounted;

  beforeEach(() => {
    mounted = mount();
  });

  afterEach(() => {
    for (const view of mounted.views) view.destroy();
    document.body.replaceChildren();
  });

  it('leaves no timer running when the sprint view is destroyed', () => {
    const view = mounted.sprint(30_000);
    view.start();
    expect(mounted.schedule.live).toBe(1);

    view.destroy();
    expect(mounted.schedule.live).toBe(0);
  });

  it('leaves no timer running when another drill is started on the same view', () => {
    const view = mounted.sprint(30_000);
    view.start();
    type('a', mounted.clock);
    view.start();

    // One timer, for the drill now on screen. Not two.
    expect(mounted.schedule.live).toBe(1);
  });

  it('lets a lesson run normally after a sprint was started and abandoned', () => {
    const sprint = mounted.sprint(30_000);
    sprint.start();
    type('a', mounted.clock);

    // The tick is kept hold of before the sprint goes away, so that it can be
    // fired afterwards: this is a `clearInterval` that never happened, which is
    // the exact shape of the original failure.
    const stray = mounted.schedule.snapshot();
    expect(stray).toHaveLength(1);

    // Abandoned mid-sprint, the way a learner does: they go back to a lesson.
    sprint.destroy();
    const lesson = mounted.lesson();
    lesson.start();

    // Far past the abandoned sprint's limit, and the stray tick fires anyway.
    // It is bound to the sprint, so it can do nothing to the lesson.
    mounted.clock.advance(120_000);
    for (const tick of stray) tick();

    for (const character of SPRINT_TEXT) type(character, mounted.clock);

    expect(text('#drill-result-summary')).toContain('Drill complete');
    expect(document.querySelectorAll('#drill-text .drill-char[data-mark="correct"]')).toHaveLength(
      [...SPRINT_TEXT].length,
    );
    expect(text('#drill-result-detail')).toContain('you typed it through');
  });

  it('hides the countdown on a lesson, which has no time to count', () => {
    const sprint = mounted.sprint(30_000);
    sprint.start();
    expect(find('#sprint-countdown').hidden).toBe(false);

    sprint.destroy();
    const lesson = mounted.lesson();
    lesson.start();

    expect(find('#sprint-countdown').hidden).toBe(true);
    expect(text('#sprint-warning')).toBe('');
  });
});

describe('the duration control', () => {
  let controls: SprintControls | null = null;

  beforeEach(() => {
    document.body.innerHTML = PAGE_BODY;
    find('#sprint-section').hidden = false;
  });

  afterEach(() => {
    controls?.destroy();
    controls = null;
    document.body.replaceChildren();
  });

  function select(): HTMLSelectElement {
    const element = document.querySelector<HTMLSelectElement>('#sprint-duration');
    if (element === null) throw new Error('index.html is missing #sprint-duration');
    return element;
  }

  it('offers every duration the drill layer defines, untimed included', () => {
    controls = createSprintControls({ onStart: () => undefined });

    const values = [...select().options].map((option) => Number(option.value));
    expect(values).toEqual([...SPRINT_DURATIONS_MS]);
    expect(values).toContain(NO_LIMIT);
  });

  it('names the untimed option as a choice rather than as a blank', () => {
    controls = createSprintControls({ onStart: () => undefined });

    const untimed = [...select().options].find((option) => Number(option.value) === NO_LIMIT);
    expect(untimed?.textContent.toLowerCase()).toContain('untimed');
    expect(untimed?.textContent).not.toBe('');
  });

  it('states the current setting in visible text, not only as a selected option', () => {
    controls = createSprintControls({ onStart: () => undefined });

    expect(text('#sprint-setting')).toContain('Current setting: 1 minute');
    expect(controls.limitMs).toBe(DEFAULT_SPRINT_LIMIT_MS);
  });

  it('is adjustable before a sprint starts, and says so as it changes', () => {
    const started: number[] = [];
    const changed: number[] = [];
    controls = createSprintControls({
      onStart: (limitMs) => started.push(limitMs),
      onLimitChange: (limitMs) => changed.push(limitMs),
    });

    select().value = String(NO_LIMIT);
    select().dispatchEvent(new Event('change', { bubbles: true }));

    expect(changed).toEqual([NO_LIMIT]);
    expect(text('#sprint-setting')).toContain('untimed');
    expect(text('#sprint-setting')).toContain('never run out');

    find('#sprint-start').click();
    expect(started).toEqual([NO_LIMIT]);
  });

  it('starts a sprint with exactly the duration on screen', () => {
    const started: number[] = [];
    controls = createSprintControls({ onStart: (limitMs) => started.push(limitMs) });

    select().value = '300000';
    select().dispatchEvent(new Event('change', { bubbles: true }));
    find('#sprint-start').click();

    expect(started).toEqual([300_000]);
    expect(text('#sprint-setting')).toContain('5 minutes');
  });

  it('refuses a value the control never offered rather than guessing one', () => {
    controls = createSprintControls({ onStart: () => undefined });

    // A tampered or drifted control. Prefer throwing to sprinting for a
    // duration nobody chose.
    select().innerHTML = '<option value="45000" selected>45 seconds</option>';
    expect(() => controls?.limitMs).toThrow();
  });

  it('is a real control at least 24 by 24 CSS pixels, per WCAG 2.5.8', () => {
    controls = createSprintControls({ onStart: () => undefined });
    // jsdom has no layout, so the stylesheet's own rule is what is asserted
    // here; the measured size lives in tests/e2e/sprint.spec.ts.
    const css = readFileSync(join(process.cwd(), 'src', 'ui', 'theme.css'), 'utf8');
    expect(css).toMatch(/select\s*\{[^}]*min-height:\s*2\.25rem/u);
  });
});
