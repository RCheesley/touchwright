/**
 * The whole loop, wired up: load a layout, type a drill, have the stars written
 * down, and find them again after a reload.
 *
 * This is the layer where "progress survives a reload" can actually be asserted
 * without a browser: one storage driver, two `wireUp` calls, and the second one is
 * the reload. The end-to-end suite does the same journey against a real page.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { waitFor } from '@testing-library/dom';
import { afterEach, describe, expect, it } from 'vitest';
import { createDrillSession, type DrillSession } from '../../src/drill/index.js';
import {
  keyStatId,
  MemoryStorageDriver,
  ProgressStore,
  type StorageDriver,
} from '../../src/stats/storage.js';
import { chooseStorage, wireUp, type ChosenStorage } from '../../src/ui/load-form.js';
import { readReferenceLayout } from '../fixtures/index.js';

const PAGE_HTML = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
const PAGE_BODY = (() => {
  const body = /<body>([\s\S]*)<\/body>/.exec(PAGE_HTML);
  if (body?.[1] === undefined) {
    throw new Error('index.html has no <body> for the functional tests to mount');
  }
  return body[1].replace(/<script[\s\S]*?<\/script>/g, '');
})();

const LAYOUT_TEXT = readReferenceLayout();

function find(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector);
  if (element === null) throw new Error(`index.html is missing ${selector}`);
  return element;
}

function text(selector: string): string {
  return find(selector).textContent;
}

function rungs(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('#ladder-list .ladder-rung')];
}

function rung(index: number): HTMLElement {
  const found = rungs()[index];
  if (found === undefined) throw new Error(`the ladder has no rung ${index}`);
  return found;
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

interface Started {
  readonly session: DrillSession;
  readonly clock: ReturnType<typeof testClock>;
  readonly store: ProgressStore;
  readonly downloads: { fileName: string; json: string }[];
}

function memoryStorage(driver: StorageDriver): ChosenStorage {
  return { driver, description: 'Saved for this test.', persistent: true };
}

/** Mount the real page, wire it up, and choose the reference layout. */
async function start(driver: StorageDriver): Promise<Started> {
  document.body.innerHTML = PAGE_BODY;
  const clock = testClock();
  const session = createDrillSession({ now: clock.now });
  const downloads: { fileName: string; json: string }[] = [];

  wireUp(document, {
    storage: memoryStorage(driver),
    session,
    download: (fileName, json): void => {
      downloads.push({ fileName, json });
    },
  });

  chooseFile(
    find('#layout-file') as HTMLInputElement,
    new File([LAYOUT_TEXT], 'macos-maltron.glove80.json', { type: 'application/json' }),
  );

  await waitFor(() => {
    expect(find('#ladder-section').hidden).toBe(false);
  });

  return { session, clock, store: new ProgressStore(driver), downloads };
}

/** Type a whole drill, cleanly, at a pace that is worth three stars. */
/**
 * The text the drill is actually showing, read back from the surface.
 *
 * Deliberately not the sample constant: the drill text is generated from the
 * lesson now, so a test that assumed one fixed sentence would pass only until
 * the generator changed. Reading the rendered characters keeps these tests about
 * what they are really testing, which is that typing a drill cleanly scores it.
 */
function renderedDrillText(): string {
  const surface = document.querySelector('[aria-label="Drill text"]');
  if (surface === null) throw new Error('No drill surface is on the page');
  const characters = [...surface.querySelectorAll<HTMLElement>('[data-index]')]
    .map((element) => ({
      index: Number.parseInt(element.dataset['index'] ?? '', 10),
      text: element.textContent,
    }))
    .sort((a, b) => a.index - b.index);
  if (characters.length === 0) throw new Error('The drill surface rendered no characters');
  return characters.map((character) => character.text).join('');
}

function typeCleanly(clock: ReturnType<typeof testClock>): void {
  for (const character of Array.from(renderedDrillText())) {
    clock.advance(90);
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: character, bubbles: true, cancelable: true }),
    );
  }
}

afterEach(() => {
  // Escape releases keyboard capture, so a view from a finished test cannot keep
  // listening at the document once its markup has gone.
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  document.body.replaceChildren();
});

describe('choosing where progress lives', () => {
  it('uses localStorage when it is there, and says progress will survive a reload', () => {
    const chosen = chooseStorage();
    expect(chosen.persistent).toBe(true);
    expect(chosen.description).toContain('after a reload');

    // It really is localStorage, not a description of one.
    chosen.driver.write('touchwright.probe', 'yes');
    expect(globalThis.localStorage.getItem('touchwright.probe')).toBe('yes');
    chosen.driver.remove('touchwright.probe');
  });

  it('falls back to memory when the browser refuses, and says progress will not last', () => {
    // A private window throws on write rather than returning null, which is why
    // storage is probed and not assumed.
    const refusing = {
      localStorage: {
        setItem: (): never => {
          throw new Error('denied');
        },
      } as unknown as Storage,
    };

    const chosen = chooseStorage(refusing);
    expect(chosen.persistent).toBe(false);
    expect(chosen.description).toContain('until you close the tab');
    // And it still works, so the trainer is usable without saving anything.
    chosen.driver.write('a', 'b');
    expect(chosen.driver.read('a')).toBe('b');
  });
});

describe('a finished drill', () => {
  it('writes the stars it earned into progress, and saves them', async () => {
    const driver = new MemoryStorageDriver();
    const started = await start(driver);

    expect(started.session.progress.stars).toEqual({});

    find('#drill-start').click();
    typeCleanly(started.clock);

    await waitFor(() => {
      expect(find('#drill-result').hidden).toBe(false);
    });

    // Three stars on the first lesson of the generated ladder, under its own id.
    expect(started.session.progress.stars['home']).toBe(3);
    expect(started.session.progress.xp).toBeGreaterThan(0);

    // Written down, not only shown once and forgotten.
    const saved = started.store.load();
    expect(saved.warnings).toEqual([]);
    expect(saved.progress.stars['home']).toBe(3);
    expect(saved.progress.xp).toBe(started.session.progress.xp);
    expect(saved.progress.keyStats[keyStatId('a')]?.hits).toBeGreaterThan(0);
  });

  it('unlocks the next rung of the ladder and refreshes the statistics', async () => {
    const driver = new MemoryStorageDriver();
    const started = await start(driver);

    expect(rung(1).dataset['state']).toBe('locked');

    find('#drill-start').click();
    typeCleanly(started.clock);

    await waitFor(() => {
      expect(rung(1).dataset['state']).not.toBe('locked');
    });

    expect(rung(0).textContent).toContain('3 stars of 3');
    // And the breakdown by finger and row has something in it now.
    expect(text('#stats-summary')).not.toContain('Nothing recorded yet');
    expect(text('#stats-weak')).toMatch(/finger/);
  });

  it('never lowers the stars already earned on a lesson', async () => {
    const driver = new MemoryStorageDriver();
    const started = await start(driver);

    find('#drill-start').click();
    typeCleanly(started.clock);
    await waitFor(() => {
      expect(started.session.progress.stars['home']).toBe(3);
    });

    // A second, deliberately sloppy run: three stars are already banked and a bad
    // run must not take a rung of the ladder away.
    find('#drill-reset').click();
    started.clock.advance(100);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', bubbles: true }));

    expect(started.session.progress.stars['home']).toBe(3);
  });
});

describe('progress across a reload', () => {
  it('finds everything again when the page is wired up a second time', async () => {
    const driver = new MemoryStorageDriver();
    const first = await start(driver);

    first.clock.advance(0);
    find('#drill-start').click();
    typeCleanly(first.clock);
    await waitFor(() => {
      expect(first.session.progress.stars['home']).toBe(3);
    });
    const xpBefore = first.session.progress.xp;

    // The reload: same storage, a brand new session and a brand new page.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const second = await start(driver);

    expect(second.session.progress.stars['home']).toBe(3);
    expect(second.session.progress.xp).toBe(xpBefore);
    expect(rung(0).textContent).toContain('3 stars of 3');
    expect(rung(1).dataset['state']).not.toBe('locked');
    expect(text('#stats-summary')).not.toContain('Nothing recorded yet');
  });

  it('exports what was practised, and imports it into a browser with nothing saved', async () => {
    const driver = new MemoryStorageDriver();
    const first = await start(driver);

    find('#drill-start').click();
    typeCleanly(first.clock);
    await waitFor(() => {
      expect(first.session.progress.stars['home']).toBe(3);
    });

    find('#progress-export').click();
    const exported = first.downloads[0];
    expect(exported?.json).toBeDefined();

    // A different browser: a different store, with nothing in it at all.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const fresh = await start(new MemoryStorageDriver());
    expect(fresh.session.progress.stars).toEqual({});

    chooseFile(
      find('#progress-import') as HTMLInputElement,
      new File([exported?.json ?? ''], 'mine.json', { type: 'application/json' }),
    );

    await waitFor(() => {
      expect(text('#progress-status')).toContain('Imported mine.json');
    });

    expect(fresh.session.progress.stars['home']).toBe(3);
    expect(fresh.session.progress.xp).toBe(first.session.progress.xp);
    expect(rung(0).textContent).toContain('3 stars of 3');
    // And the fresh browser has saved it, so its own next reload keeps it.
    expect(fresh.store.load().progress.stars['home']).toBe(3);
  });
});
