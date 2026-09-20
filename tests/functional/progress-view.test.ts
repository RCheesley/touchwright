/**
 * The ladder, the statistics, and the export and import of progress, against the
 * real markup.
 *
 * The body of `index.html` is what these mount, so a rename in the markup fails
 * here rather than in a browser. What is checked here is the behaviour and the
 * words; the computed colours and the reflow live in the end-to-end suite, because
 * only a browser resolves a cascade or lays out a line.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { waitFor } from '@testing-library/dom';
import { afterEach, describe, expect, it } from 'vitest';
import { GLOVE80 } from '../../src/board/index.js';
import { createDrillSession } from '../../src/drill/index.js';
import { generateLadder, type Lesson } from '../../src/ladder/index.js';
import { parseMoErgoLayoutText } from '../../src/keymap/moergo.js';
import { SEVERITY_WORDS } from '../../src/stats/keystats.js';
import {
  emptyProgress,
  keyStatId,
  MemoryStorageDriver,
  PROGRESS_VERSION,
  ProgressStore,
  type Progress,
  type StorageDriver,
} from '../../src/stats/storage.js';
import { createProgressView, type LessonChoice } from '../../src/ui/progress-view.js';
import { readReferenceLayout } from '../fixtures/index.js';

const keymap = parseMoErgoLayoutText(readReferenceLayout(), { board: GLOVE80 });

/** The real page, so the markup and the module cannot drift apart unnoticed. */
const PAGE_BODY = (() => {
  const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
  const body = /<body>([\s\S]*)<\/body>/.exec(html);
  if (body?.[1] === undefined) {
    throw new Error('index.html has no <body> for the functional tests to mount');
  }
  return body[1].replace(/<script[\s\S]*?<\/script>/g, '');
})();

interface Download {
  readonly fileName: string;
  readonly json: string;
}

function find(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector);
  if (element === null) throw new Error(`index.html is missing ${selector}`);
  return element;
}

function text(selector: string): string {
  return find(selector).textContent;
}

function all(selector: string): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(selector)];
}

function rungs(): HTMLElement[] {
  return all('#ladder-list .ladder-rung');
}

function rung(index: number): HTMLElement {
  const found = rungs()[index];
  if (found === undefined) throw new Error(`the ladder has no rung ${index}`);
  return found;
}

function button(within: HTMLElement): HTMLButtonElement | null {
  return within.querySelector('button');
}

/**
 * Put a file on a file input. jsdom has no FileList constructor, so the property
 * is defined directly; the change event is what the view actually listens for.
 */
function chooseFile(input: HTMLInputElement, file: File): void {
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: {
      length: 1,
      item: (index: number): File | null => (index === 0 ? file : null),
      0: file,
    },
  });
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function jsonFile(name: string, body: string): File {
  return new File([body], name, { type: 'application/json' });
}

interface Mounted {
  readonly lessons: readonly Lesson[];
  readonly session: ReturnType<typeof createDrillSession>;
  readonly store: ProgressStore;
  readonly driver: StorageDriver;
  readonly downloads: readonly Download[];
  readonly chosen: readonly LessonChoice[];
  readonly view: ReturnType<typeof createProgressView>;
}

function mount(
  options: {
    progress?: Progress;
    driver?: StorageDriver;
    startupWarnings?: readonly string[];
  } = {},
): Mounted {
  document.body.innerHTML = PAGE_BODY;

  const driver = options.driver ?? new MemoryStorageDriver();
  const store = new ProgressStore(driver);
  const session = createDrillSession({
    ...(options.progress === undefined ? {} : { progress: options.progress }),
  });
  const lessons = generateLadder(keymap, GLOVE80);
  const downloads: Download[] = [];
  const chosen: LessonChoice[] = [];

  const view = createProgressView({
    board: GLOVE80,
    keymap,
    lessons,
    session,
    store,
    startupWarnings: options.startupWarnings ?? [],
    download: (fileName, json): void => {
      downloads.push({ fileName, json });
    },
    today: (): Date => new Date('2026-09-21T10:00:00.000Z'),
    onChooseLesson: (choice): void => {
      chosen.push(choice);
    },
  });

  return { lessons, session, store, driver, downloads, chosen, view };
}

function progressWith(fields: Partial<Progress>): Progress {
  return { ...emptyProgress(), ...fields };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('the ladder', () => {
  it('shows every lesson the layout produced', () => {
    const mounted = mount();

    expect(rungs()).toHaveLength(mounted.lessons.length);
    expect(mounted.lessons.length).toBeGreaterThan(5);
    for (const [index, lesson] of mounted.lessons.entries()) {
      expect(rung(index).textContent, `rung ${index}`).toContain(lesson.name);
      expect(rung(index).textContent, `rung ${index}`).toContain(lesson.blurb);
    }
    expect(find('#ladder-section').hidden).toBe(false);
  });

  it('says which lessons are unlocked and what unlocks the rest, in words', () => {
    const mounted = mount();

    expect(rung(0).dataset['state']).toBe('current');
    expect(rung(0).textContent).toContain('this is your current lesson');
    expect(rung(1).dataset['state']).toBe('locked');
    // Not merely dimmer: it says what to do about it, and names the lesson.
    expect(rung(1).textContent).toContain('Earn 2 stars on Home keys');

    // Only what is unlocked can be started, so there is exactly one button.
    expect(all('#ladder-list button')).toHaveLength(1);
    expect(button(rung(0))?.textContent).toBe('Practise Home keys again');
    expect(button(rung(1))).toBeNull();
    expect(mounted.lessons[1]?.name).toBe('The left thumb');
  });

  it('states the stars earned in words, with the glyphs as decoration only', () => {
    mount({ progress: progressWith({ stars: { home: 2 } }) });

    expect(rung(0).textContent).toContain('2 stars of 3');
    const glyphs = rung(0).querySelector<HTMLElement>('.ladder-stars');
    expect(glyphs?.getAttribute('aria-hidden')).toBe('true');
    expect(glyphs?.textContent).toBe('★★☆');

    // A rung with nothing on it says so rather than showing an empty gap.
    expect(rung(1).textContent).toContain('no stars yet');
  });

  it('unlocks the next lesson once two stars are earned, and keeps the old one open', () => {
    mount({ progress: progressWith({ stars: { home: 2 }, lesson: 1 }) });

    expect(rung(0).dataset['state']).toBe('unlocked');
    expect(rung(0).textContent).toContain('Unlocked and passed');
    expect(rung(1).dataset['state']).toBe('current');
    expect(rung(2).dataset['state']).toBe('locked');
    expect(all('#ladder-list button')).toHaveLength(2);
  });

  it('does not unlock anything on one star, and says what is still needed', () => {
    mount({ progress: progressWith({ stars: { home: 1 } }) });

    expect(rung(0).textContent).toContain('1 star of 3');
    expect(rung(1).dataset['state']).toBe('locked');
  });

  it('returns to an earlier lesson from the ladder, and remembers the choice', () => {
    const mounted = mount({
      progress: progressWith({ stars: { home: 3, thumb: 2 }, lesson: 2 }),
    });

    expect(rung(2).dataset['state']).toBe('current');

    button(rung(0))?.click();

    expect(mounted.chosen).toHaveLength(1);
    expect(mounted.chosen[0]?.index).toBe(0);
    expect(mounted.chosen[0]?.lesson.id).toBe('home');
    expect(mounted.session.progress.lesson).toBe(0);
    // Re-rendered, so the ladder agrees with the choice that was just made.
    expect(rung(0).dataset['state']).toBe('current');
    expect(rung(2).dataset['state']).toBe('unlocked');
    // And written down, so it is still lesson zero after a reload.
    expect(mounted.store.load().progress.lesson).toBe(0);
    expect(text('#ladder-current')).toContain('Home keys');
  });

  it('shows a lesson the imported progress points past as still locked', () => {
    // A file from a longer ladder should not silently open a rung that has not
    // been earned on this one.
    const mounted = mount({ progress: progressWith({ lesson: 99 }) });

    expect(rung(0).dataset['state']).toBe('current');
    expect(rungs().filter((item) => item.dataset['state'] === 'locked')).toHaveLength(
      mounted.lessons.length - 1,
    );
  });
});

describe('the statistics', () => {
  /** p is the left ring finger's upper row, m the right index finger's upper row. */
  function withKeyStats(): Mounted {
    const progress = progressWith({
      keyStats: {
        [keyStatId('p')]: { hits: 5, misses: 5, totalMs: 1000, samples: 5 },
        [keyStatId('m')]: { hits: 20, misses: 0, totalMs: 2000, samples: 20 },
      },
      xp: 240,
    });
    return mount({ progress });
  }

  it('groups the keys that slip by finger and by row, in words', () => {
    withKeyStats();
    const weak = find('#stats-weak');

    expect(weak.textContent).toContain('left ring finger');
    expect(weak.textContent).toContain('upper row');
    expect(weak.textContent).toContain('5 of 10 presses missed, 50%');
    // The individual key is named too, under the heading that places it.
    expect(weak.textContent).toContain('“p”');
    expect(weak.textContent).toContain('“p”, 5 of 10 presses missed, 50%');
  });

  it('adds the part of a position its finger and row heading does not say', () => {
    // b is the left index finger's upper row, but reached for inwards rather than
    // pressed in the finger's own column, and that is the useful bit.
    mount({
      progress: progressWith({
        keyStats: { [keyStatId('b')]: { hits: 5, misses: 5, totalMs: 500, samples: 5 } },
      }),
    });

    const weak = find('#stats-weak');
    expect(weak.textContent).toContain('left index finger');
    expect(weak.textContent).toContain('upper row');
    expect(weak.textContent).toContain('(inner reach)');
  });

  it('names the severity band rather than only tinting it', () => {
    withKeyStats();

    const bands = all('#stats-weak .stats-band');
    expect(bands.length).toBeGreaterThan(0);
    for (const band of bands) {
      expect(Object.values(SEVERITY_WORDS)).toContain(band.textContent);
    }
    expect(find('#stats-weak').textContent).toContain(SEVERITY_WORDS.weak);
  });

  it('leads with the fingers that need work and tucks the rest behind a disclosure', () => {
    withKeyStats();

    const panels = all('#stats-weak > .stats-finger');
    expect(panels).toHaveLength(1);
    expect(panels[0]?.dataset['finger']).toBe('ring');
    expect(panels[0]?.dataset['hand']).toBe('left');

    const steady = find('#stats-weak details.stats-steady');
    expect(steady.textContent).toContain('behaving');
    expect(steady.querySelectorAll('.stats-finger')).toHaveLength(1);
  });

  it('marks the miss-rate bar as decoration, because the number is beside it', () => {
    withKeyStats();

    const bars = all('#stats-weak .stats-bar');
    expect(bars.length).toBeGreaterThan(0);
    for (const bar of bars) {
      expect(bar.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('summarises the totals, and says where most of the misses are', () => {
    withKeyStats();

    expect(text('#stats-summary')).toContain('left ring finger, upper row');
    expect(text('#stats-totals')).toContain('30');
    expect(text('#stats-totals')).toContain('83%');
    expect(text('#stats-totals')).toContain('240 XP');
  });

  it('says plainly when nothing has been recorded yet', () => {
    mount();

    expect(text('#stats-summary')).toContain('Nothing recorded yet');
    expect(text('#stats-weak')).toContain('Finish a drill');
    expect(find('#stats-unplaced').hidden).toBe(true);
  });

  it('reports statistics for keys this layout does not bind, rather than dropping them', () => {
    mount({
      progress: progressWith({
        keyStats: { [keyStatId('☃')]: { hits: 3, misses: 1, totalMs: 0, samples: 0 } },
      }),
    });

    const unplaced = find('#stats-unplaced');
    expect(unplaced.hidden).toBe(false);
    expect(unplaced.textContent).toContain('“☃”');
    expect(unplaced.textContent).toContain('not bound on this layout');
  });
});

describe('exporting progress', () => {
  it('hands over a dated JSON file that round-trips', () => {
    const mounted = mount({
      progress: progressWith({
        lesson: 1,
        xp: 55,
        stars: { home: 3 },
        keyStats: { [keyStatId('.')]: { hits: 4, misses: 1, totalMs: 400, samples: 4 } },
      }),
    });

    find('#progress-export').click();

    expect(mounted.downloads).toHaveLength(1);
    expect(mounted.downloads[0]?.fileName).toBe('touchwright-progress-2026-09-21.json');

    const parsed: unknown = JSON.parse(mounted.downloads[0]?.json ?? 'null');
    expect(parsed).toEqual({
      version: PROGRESS_VERSION,
      lesson: 1,
      xp: 55,
      stars: { home: 3 },
      keyStats: { [keyStatId('.')]: { hits: 4, misses: 1, totalMs: 400, samples: 4 } },
    });
    expect(text('#progress-status')).toContain('touchwright-progress-2026-09-21.json');
  });

  it('surfaces a failure to build the file rather than looking as if it worked', () => {
    document.body.innerHTML = PAGE_BODY;
    const store = new ProgressStore(new MemoryStorageDriver());
    createProgressView({
      board: GLOVE80,
      keymap,
      lessons: generateLadder(keymap, GLOVE80),
      session: createDrillSession(),
      store,
      download: (): never => {
        throw new Error('no downloads in this browser');
      },
    });

    find('#progress-export').click();

    expect(find('#progress-error').hidden).toBe(false);
    expect(text('#progress-error')).toContain('no downloads in this browser');
  });
});

describe('importing progress', () => {
  const GOOD_FILE = JSON.stringify({
    version: PROGRESS_VERSION,
    lesson: 2,
    xp: 300,
    stars: { home: 3, thumb: 2 },
    keyStats: { [keyStatId('p')]: { hits: 40, misses: 6, totalMs: 4000, samples: 40 } },
  });

  it('brings an exported file back, into a browser that has nothing saved', async () => {
    const mounted = mount();
    chooseFile(find('#progress-import') as HTMLInputElement, jsonFile('mine.json', GOOD_FILE));

    await waitFor(() => {
      expect(text('#progress-status')).toContain('Imported mine.json');
    });

    expect(mounted.session.progress.xp).toBe(300);
    expect(mounted.session.progress.stars).toEqual({ home: 3, thumb: 2 });
    expect(mounted.session.progress.lesson).toBe(2);
    // Saved as well as applied, so the import survives the next reload too.
    expect(mounted.store.load().progress.xp).toBe(300);
    // And the ladder has caught up with it.
    expect(rung(2).dataset['state']).toBe('current');
    expect(find('#progress-report').hidden).toBe(true);
    expect(find('#progress-error').hidden).toBe(true);
  });

  it('leaves imported progress writable, so the next keystroke does not throw', async () => {
    // Regression 1: progress from an external store can arrive deeply frozen, and
    // merging it made the statistics immutable. Everything goes through the store,
    // which thaws, so the live object is always writable.
    const mounted = mount();
    chooseFile(find('#progress-import') as HTMLInputElement, jsonFile('mine.json', GOOD_FILE));
    await waitFor(() => {
      expect(text('#progress-status')).toContain('Imported');
    });

    const drill = mounted.session.start({ text: 'pa' });
    expect(() => drill.press('p')).not.toThrow();
    expect(mounted.session.progress.keyStats[keyStatId('p')]?.hits).toBe(41);
  });

  it('reports what a partly unreadable file dropped, and keeps the rest', async () => {
    const mounted = mount();
    const partial = JSON.stringify({
      version: 99,
      lesson: 1,
      xp: 120,
      stars: { home: 3 },
      keyStats: {
        [keyStatId('p')]: { hits: 10, misses: 2, totalMs: 900, samples: 10 },
        'not-a-key': { hits: 5, misses: 1, totalMs: 0, samples: 0 },
        [keyStatId('m')]: 'nonsense',
      },
    });

    chooseFile(find('#progress-import') as HTMLInputElement, jsonFile('partial.json', partial));

    await waitFor(() => {
      expect(text('#progress-status')).toContain('Imported partial.json');
    });

    // Not refused: the usable parts arrived.
    expect(mounted.session.progress.xp).toBe(120);
    expect(mounted.session.progress.stars).toEqual({ home: 3 });
    expect(mounted.session.progress.keyStats[keyStatId('p')]?.hits).toBe(10);

    // And what was dropped is named, item by item, rather than silently lost.
    const report = find('#progress-report');
    expect(report.hidden).toBe(false);
    const dropped = all('#progress-report-list li').map((item) => item.textContent);
    expect(dropped.length).toBeGreaterThanOrEqual(3);
    expect(dropped.join(' ')).toContain('version 99');
    expect(dropped.join(' ')).toContain('not-a-key');
    expect(text('#progress-status')).toContain('dropped');
    // Nothing failed, so no alert was raised.
    expect(find('#progress-error').hidden).toBe(true);
  });

  it('refuses a file that is not JSON at all, and leaves progress untouched', async () => {
    const mounted = mount({ progress: progressWith({ xp: 70, stars: { home: 2 } }) });
    chooseFile(find('#progress-import') as HTMLInputElement, jsonFile('broken.json', '{ not json'));

    await waitFor(() => {
      expect(find('#progress-error').hidden).toBe(false);
    });

    expect(text('#progress-error')).toContain('not valid JSON');
    expect(text('#progress-error')).toContain('broken.json');
    expect(mounted.session.progress.xp).toBe(70);
    expect(mounted.session.progress.stars).toEqual({ home: 2 });
    // The ladder is exactly as it was.
    expect(rung(0).dataset['state']).toBe('current');
  });

  it('keeps the drills done since the export, rather than overwriting them', async () => {
    // The merge takes the better of the two for every field, so importing your own
    // file can never cost you this morning's practice.
    const mounted = mount({
      progress: progressWith({ xp: 500, stars: { home: 3, thumb: 3 } }),
    });
    chooseFile(find('#progress-import') as HTMLInputElement, jsonFile('older.json', GOOD_FILE));

    await waitFor(() => {
      expect(text('#progress-status')).toContain('Imported');
    });

    expect(mounted.session.progress.xp).toBe(500);
    expect(mounted.session.progress.stars).toEqual({ home: 3, thumb: 3 });
  });

  it('says nothing was chosen when the file dialogue is dismissed', () => {
    mount();
    const input = find('#progress-import') as HTMLInputElement;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(text('#progress-status')).toBe('');
    expect(find('#progress-error').hidden).toBe(true);
  });
});

describe('progress that survives a reload', () => {
  it('reads back everything a session wrote, through one driver', () => {
    // One driver, two sessions: the second is the reload.
    const driver = new MemoryStorageDriver();
    const first = mount({
      driver,
      progress: progressWith({
        lesson: 1,
        xp: 300,
        stars: { home: 3 },
        keyStats: { [keyStatId('p')]: { hits: 9, misses: 3, totalMs: 900, samples: 9 } },
      }),
    });
    first.view.save();
    first.view.destroy();

    const reloaded = new ProgressStore(driver).load();
    expect(reloaded.warnings).toEqual([]);

    const second = mount({ driver, progress: reloaded.progress });
    expect(second.session.progress.xp).toBe(300);
    expect(rung(1).dataset['state']).toBe('current');
    expect(rung(0).textContent).toContain('3 stars of 3');
    expect(text('#stats-weak')).toContain('left ring finger');
  });

  it('surfaces a problem with the progress saved in this browser without losing it', () => {
    mount({
      progress: progressWith({ xp: 40 }),
      startupWarnings: ['Dropped unreadable key statistics for "nope".'],
    });

    expect(find('#progress-report').hidden).toBe(false);
    expect(text('#progress-report-intro')).toContain('saved in this browser');
    expect(all('#progress-report-list li').map((item) => item.textContent)).toEqual([
      'Dropped unreadable key statistics for "nope".',
    ]);
    expect(text('#progress-status')).toContain('could not be read');
  });
});

describe('clearing saved progress', () => {
  it('takes two deliberate goes, and says so in between', () => {
    const mounted = mount({ progress: progressWith({ xp: 90, stars: { home: 2 } }) });
    mounted.view.save();

    const clear = find('#progress-clear') as HTMLButtonElement;
    clear.click();

    // Armed, not done: nothing has been thrown away yet.
    expect(clear.dataset['armed']).toBe('true');
    expect(clear.textContent).toContain('Really clear');
    expect(text('#progress-status')).toContain('cannot be undone');
    expect(mounted.store.load().progress.xp).toBe(90);

    clear.click();

    expect(clear.dataset['armed']).toBeUndefined();
    expect(mounted.store.load().progress.xp).toBe(0);
    expect(mounted.session.progress.stars).toEqual({});
    expect(mounted.session.progress.lesson).toBe(0);
    expect(rung(0).dataset['state']).toBe('current');
    expect(text('#progress-status')).toContain('cleared');
  });

  it('cancels on Escape, leaving the saved progress alone', () => {
    const mounted = mount({ progress: progressWith({ xp: 90 }) });
    mounted.view.save();

    const clear = find('#progress-clear') as HTMLButtonElement;
    clear.click();
    clear.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(clear.dataset['armed']).toBeUndefined();
    expect(text('#progress-status')).toContain('untouched');

    // And the next click arms again rather than clearing straight away.
    clear.click();
    expect(mounted.store.load().progress.xp).toBe(90);
  });

  it('leaves the session with a live object it can still record into', () => {
    const mounted = mount({
      progress: progressWith({
        keyStats: { [keyStatId('p')]: { hits: 4, misses: 0, totalMs: 400, samples: 4 } },
      }),
    });

    const clear = find('#progress-clear') as HTMLButtonElement;
    clear.click();
    clear.click();

    const drill = mounted.session.start({ text: 'pa' });
    expect(() => drill.press('p')).not.toThrow();
    expect(mounted.session.progress.keyStats[keyStatId('p')]?.hits).toBe(1);
  });
});
