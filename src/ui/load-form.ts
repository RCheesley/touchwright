/**
 * The load form, and the wiring between a loaded layout and the drill surface.
 *
 * Exported rather than self-invoking so that importing this module has no side
 * effects and a test can drive it against a DOM it built itself.
 *
 * This module owns the board diagram, so it also owns the highlight: the drill
 * surface hands it the next key through `onNextKey` and never draws a keyboard
 * itself. With no drill running the diagram points at E, which is the most
 * telling thing about a layout.
 */

import { describeKey, GLOVE80, indexKeys } from '../board/index.js';
import { createDrillSession, type DrillSession } from '../drill/index.js';
import { generateLadder, type Lesson } from '../ladder/index.js';
import { parseMoErgoLayoutText } from '../keymap/moergo.js';
import type { Keymap } from '../keymap/types.js';
import {
  LocalStorageDriver,
  MemoryStorageDriver,
  ProgressStore,
  type StorageDriver,
} from '../stats/storage.js';
import {
  describeBoardKeys,
  fingersOnBoard,
  renderBoard,
  type BoardKeyDescription,
} from './board-svg.js';
import { describeFailure, required } from './dom.js';
import { createDrillView, SAMPLE_DRILL_TEXT, type DrillView } from './drill-view.js';
import { DrillTextError, generateDrillText } from '../drill/text.js';
import { highestUnlockedLesson } from '../drill/scoring.js';
import { SprintError, sprintLesson, sprintWordCount } from '../drill/sprint.js';
import { summariseKeymap } from './layout-summary.js';
import { createProgressView, type ProgressView } from './progress-view.js';
import { createSprintControls, type SprintControls } from './sprint-controls.js';

/**
 * Where saved progress lives, and what to tell the learner about it.
 *
 * localStorage throws rather than returning null in a private window, so it is
 * probed rather than assumed. When it is unavailable the trainer still works: the
 * in-memory driver keeps the session together and the wording says plainly that
 * progress will not outlive the tab, so exporting is the way to keep it.
 */
export interface ChosenStorage {
  readonly driver: StorageDriver;
  readonly description: string;
  readonly persistent: boolean;
}

export function chooseStorage(scope: { localStorage?: Storage } = globalThis): ChosenStorage {
  if (LocalStorageDriver.available(scope) && scope.localStorage !== undefined) {
    return {
      driver: new LocalStorageDriver(scope.localStorage),
      description:
        'Your progress is saved in this browser as you practise, so it is still here after a reload. The file below is how it leaves this browser.',
      persistent: true,
    };
  }
  return {
    driver: new MemoryStorageDriver(),
    description:
      'This browser will not let the trainer save anything, so your progress lasts only until you close the tab. Export it if you want to keep it.',
    persistent: false,
  };
}

export interface WireUpOptions {
  /** Injected so a test can drive a store it owns, and watch what is written. */
  readonly storage?: ChosenStorage;
  readonly session?: DrillSession;
  /** Injected so a test can observe an export without a browser download. */
  readonly download?: (fileName: string, json: string) => void;
  /**
   * Seed for drill text. Defaults to the clock, so each attempt at a lesson is
   * different; a test passes a fixed one to get the same drill every run.
   */
  readonly seed?: () => number;
}

/** Words per drill. Long enough to score honestly, short enough to finish. */
const DRILL_WORDS = 12;

/**
 * The rung after this one, or null on the last — and null for a lesson that is
 * not on this ladder at all, which an imported file from a longer ladder can
 * produce. Identity is by id, never by object, because the ladder is rebuilt
 * whenever a layout is loaded.
 */
function nextAfter(lessons: readonly Lesson[], lesson: Lesson | null): Lesson | null {
  if (lesson === null) return null;
  const index = lessons.findIndex((candidate) => candidate.id === lesson.id);
  if (index < 0) return null;
  return lessons[index + 1] ?? null;
}

export function wireUp(root: ParentNode = document, options: WireUpOptions = {}): void {
  const input = required('#layout-file', HTMLInputElement, root);
  const status = required('#layout-status', HTMLElement, root);
  const error = required('#layout-error', HTMLElement, root);
  const summary = required('#summary', HTMLElement, root);
  const list = required('#summary-list', HTMLElement, root);
  const board = required('#board-section', HTMLElement, root);
  const figure = required('#board-figure', HTMLElement, root);
  const nextKey = required('#board-next', HTMLElement, root);
  const legend = required('#board-legend', HTMLElement, root);
  const keyList = required('#board-key-list', HTMLElement, root);
  const drillSection = required('#drill-section', HTMLElement, root);
  const sprintSection = required('#sprint-section', HTMLElement, root);
  const ladderSection = required('#ladder-section', HTMLElement, root);
  const statsSection = required('#stats-section', HTMLElement, root);
  const progressSection = required('#progress-section', HTMLElement, root);
  const drillStart = required('#drill-start', HTMLButtonElement, root);

  /** The board's state, so a highlight change does not need the keymap again. */
  let labels: ReadonlyMap<number, string> = new Map<number, string>();
  let restingHighlight = GLOVE80.spacePosition;
  let drillView: DrillView | null = null;
  let progressView: ProgressView | null = null;
  let sprintControls: SprintControls | null = null;

  /**
   * Storage, the session and the saved progress are set up once, here, before a
   * layout is chosen.
   *
   * The order matters and is the whole of regression 2: the load has to reach the
   * session before the first keystroke, and it has to go through `ProgressStore`,
   * which thaws and validates, so that nothing frozen from an external store can
   * become live state. The session then decides what an arriving load may touch.
   */
  const storage = options.storage ?? chooseStorage();
  const store = new ProgressStore(storage.driver);
  const session = options.session ?? createDrillSession();
  const seed = options.seed ?? ((): number => Date.now());
  const startupLoad = store.load();
  const startupApplied = session.applyLoadedProgress(startupLoad.progress);
  const startupWarnings = [...startupLoad.warnings, ...startupApplied.warnings];

  function showError(message: string): void {
    error.textContent = message;
    error.hidden = false;
    summary.hidden = true;
    board.hidden = true;
    drillSection.hidden = true;
    sprintSection.hidden = true;
    ladderSection.hidden = true;
    statsSection.hidden = true;
    progressSection.hidden = true;
    status.textContent = '';
  }

  /**
   * Draws the board with one key highlighted, and says in words which key that
   * is. The diagram is `aria-hidden`, so this sentence is not a caption: it is
   * the only place that fact exists for anyone not looking at the picture.
   */
  function highlight(position: number, lead: string): void {
    const key = indexKeys(GLOVE80).get(position);
    if (key === undefined) {
      // Prefer throwing to drawing a diagram that points at nothing.
      throw new Error(`Cannot highlight position ${position}: ${GLOVE80.name} does not define it.`);
    }
    nextKey.textContent = `${lead}: ${nameLabel(labels.get(position), position)} — ${describeKey(key)}.`;
    figure.replaceChildren(renderBoard(GLOVE80, { labels, highlight: position }));
  }

  function showBoard(keymap: Keymap): void {
    labels = new Map(keymap.positionToChar);

    // Where E sits is the most telling thing about a layout, which is why the
    // summary above names it too. A layout with no E falls back to the space the
    // trainer will teach.
    restingHighlight = keymap.charToPosition.get('e') ?? GLOVE80.spacePosition;
    highlight(restingHighlight, 'Highlighted on the diagram');

    legend.replaceChildren(...fingersOnBoard(GLOVE80).map(legendItem));
    keyList.replaceChildren(...describeBoardKeys(GLOVE80, labels).map(keyListItem));
    board.hidden = false;
  }

  /**
   * Builds the drill surface for one lesson of the ladder.
   *
   * The text is generated from the lesson's own key set, so a learner is never
   * asked for a key the ladder has not given them yet. With no lesson — which
   * only happens if a layout produces no ladder at all — the sample stands in.
   *
   * A lesson that cannot produce text is a bug in the generator or in the
   * ladder, so it is reported rather than papered over with the sample: a drill
   * that quietly practises the wrong keys is worse than no drill.
   */
  function showDrill(
    keymap: Keymap,
    lesson: Lesson | null,
    nextLesson: Lesson | null,
    lessons: readonly Lesson[] = [],
  ): void {
    let text: string;
    if (lesson === null) {
      text = SAMPLE_DRILL_TEXT;
    } else {
      try {
        text = generateDrillText(lesson, { seed: seed(), words: DRILL_WORDS });
      } catch (cause) {
        if (cause instanceof DrillTextError) {
          drillView?.destroy();
          drillView = null;
          drillSection.hidden = true;
          showError(`Could not build a drill for “${lesson.name}”: ${cause.message}`);
          return;
        }
        throw cause;
      }
    }

    drillView?.destroy();
    drillView = createDrillView({
      board: GLOVE80,
      keymap,
      text,
      session,
      lessonId: lesson?.id ?? null,
      lessonName: lesson?.name ?? 'the sample drill',
      // Named only when there is somewhere to advance to, so the result card
      // never offers a rung that does not exist.
      nextLessonName: nextLesson?.name ?? null,
      // And the offer is real: taking it rebuilds the drill on the next lesson
      // and remembers where the learner has got to.
      ...(nextLesson === null
        ? {}
        : {
            onAdvance: (): void => {
              session.progress.lesson = lessons.findIndex(
                (candidate) => candidate.id === nextLesson.id,
              );
              showDrill(keymap, nextLesson, nextAfter(lessons, nextLesson));
              progressView?.save();
              progressView?.refresh();
              drillStart.focus();
            },
          }),
      root,
      onNextKey: followNextKey,
      onScored: saveAndRefresh,
    });
    drillSection.hidden = false;
  }

  /** The board highlight follows the drill rather than leading it. */
  function followNextKey(next: { readonly position: number } | null): void {
    if (next === null) {
      highlight(restingHighlight, 'Highlighted on the diagram');
      return;
    }
    highlight(next.position, 'Highlighted on the diagram, the next key');
  }

  function saveAndRefresh(): void {
    // The stars and the experience are already in live progress by now. This is
    // where they are written down and where the ladder learns about them.
    progressView?.save();
    progressView?.refresh();
  }

  /**
   * Replaces the drill surface with a sprint and starts it.
   *
   * A sprint is not a rung: it runs against every key unlocked so far, folded
   * into one synthetic lesson by `sprintLesson`, and it carries no lesson id, so
   * it earns experience and no stars. Scoring refuses stars outside lesson mode
   * anyway; passing null here means there is nowhere for them to go either.
   *
   * Building the drill destroys the previous view, which stops that drill's
   * timer. Nothing depends on that happening: a sprint timer is bound to its own
   * drill and stops itself when another drill becomes current. Regression 3.
   */
  function showSprint(keymap: Keymap, lessons: readonly Lesson[], limitMs: number): void {
    const stars = lessons.map((lesson) => session.progress.stars[lesson.id] ?? 0);
    const unlocked = highestUnlockedLesson(stars);

    let text: string;
    try {
      const lesson = sprintLesson(lessons, unlocked);
      text = generateDrillText(lesson, { seed: seed(), words: sprintWordCount(limitMs) });
    } catch (cause) {
      // Surfaced, never swallowed, and the drill already on screen is left
      // exactly as it was: a sprint that cannot be built must not take the
      // learner's lesson away with it.
      if (cause instanceof SprintError || cause instanceof DrillTextError) {
        showSprintError(`Could not build a sprint: ${cause.message}`);
        return;
      }
      throw cause;
    }

    clearError();
    drillView?.destroy();
    drillView = createDrillView({
      board: GLOVE80,
      keymap,
      text,
      limitMs,
      session,
      mode: 'sprint',
      lessonId: null,
      lessonName: null,
      nextLessonName: null,
      root,
      onNextKey: followNextKey,
      onScored: saveAndRefresh,
    });
    drillSection.hidden = false;
    // Start it here rather than making the learner press a second button: they
    // have already said "Start sprint", and the duration was set before that.
    drillView.start();
  }

  /**
   * A sprint that could not be built, reported without tearing the page down.
   *
   * `showError` hides every section, which is right for a layout that would not
   * parse and wrong here: the lesson on screen is still perfectly good.
   */
  function showSprintError(message: string): void {
    error.textContent = message;
    error.hidden = false;
  }

  /**
   * Builds the ladder, the statistics and the export and import controls.
   *
   * The ladder is generated from the layout in front of the learner, which is the
   * thing this project is named for, so it cannot exist before a layout is chosen.
   */
  function showProgress(keymap: Keymap): void {
    progressView?.destroy();
    const lessons = generateLadder(keymap, GLOVE80);

    progressView = createProgressView({
      board: GLOVE80,
      keymap,
      lessons,
      session,
      store,
      root,
      startupWarnings,
      storageDescription: storage.description,
      ...(options.download === undefined ? {} : { download: options.download }),
      onChooseLesson: ({ lesson }): void => {
        // Returning to an earlier lesson rebuilds the drill for it. Focus lands on
        // the start button, so a keyboard learner is left somewhere they can act
        // rather than on a button whose meaning has just changed.
        showDrill(keymap, lesson, nextAfter(lessons, lesson), lessons);
        drillStart.focus();
      },
    });

    // The lesson the learner left off on, clamped to a ladder this layout can
    // actually produce: an imported file may have come from a longer one.
    const current = lessons[Math.min(Math.max(0, session.progress.lesson), lessons.length - 1)];
    showDrill(keymap, current ?? null, nextAfter(lessons, current ?? null), lessons);

    sprintControls?.destroy();
    sprintControls = createSprintControls({
      root,
      onStart: (limitMs): void => {
        showSprint(keymap, lessons, limitMs);
      },
    });
    sprintSection.hidden = false;
  }

  function clearError(): void {
    error.textContent = '';
    error.hidden = true;
  }

  input.addEventListener('change', (): void => {
    void (async (): Promise<void> => {
      clearError();
      const file = input.files?.item(0) ?? null;
      if (file === null) {
        status.textContent = '';
        return;
      }

      status.textContent = `Reading ${file.name}…`;

      let text: string;
      try {
        text = await file.text();
      } catch (cause) {
        showError(`Could not read that file: ${describeFailure(cause)}`);
        return;
      }

      try {
        const keymap = parseMoErgoLayoutText(text, { board: GLOVE80 });
        render(list, summariseKeymap(keymap, GLOVE80));
        summary.hidden = false;
        showBoard(keymap);
        // The ladder comes before the drill: it decides which lesson the drill is
        // for, and a drill with no lesson could not write its stars anywhere.
        showProgress(keymap);
        status.textContent = `Loaded ${keymap.title}.`;
      } catch (cause) {
        // Surfaced, never swallowed: a parse failure is the user's problem to
        // fix and they can only fix what they can see. A drill text this layout
        // cannot type arrives here too, which is why it throws rather than
        // quietly dropping the characters.
        showError(describeFailure(cause));
      }
    })();
  });
}

/**
 * Names a cap in words. The glyph alone is not enough: an unlabelled cap has no
 * glyph at all, and a space bar's glyph is an open box that reads as nothing.
 */
function nameLabel(label: string | undefined, position: number): string {
  if (label === undefined) return `no character bound (position ${position})`;
  if (label.trim().length === 0) return 'the space key';
  return `“${label}”`;
}

/** A finger named in words, with its colour alongside rather than instead. */
function legendItem(finger: string): HTMLLIElement {
  const item = document.createElement('li');
  item.dataset['finger'] = finger;

  const swatch = document.createElement('span');
  swatch.className = 'board-legend-swatch';
  swatch.setAttribute('aria-hidden', 'true');

  item.append(swatch, document.createTextNode(finger));
  return item;
}

function keyListItem(row: BoardKeyDescription): HTMLLIElement {
  const item = document.createElement('li');

  // The cap is the picture of the key; the sentence after it carries the facts.
  const cap = document.createElement('span');
  cap.className = 'board-key-list-cap';
  cap.setAttribute('aria-hidden', 'true');
  cap.textContent = row.label === null ? '—' : row.label.trim().length === 0 ? '␣' : row.label;

  const words = `${nameLabel(row.label ?? undefined, row.position)} — ${row.description}${
    row.isHome ? ', a resting position' : ''
  }`;

  item.append(cap, document.createTextNode(` ${words}`));
  return item;
}

function render(list: HTMLElement, rows: readonly { term: string; detail: string }[]): void {
  list.replaceChildren(
    ...rows.flatMap((row) => {
      const term = document.createElement('dt');
      term.textContent = row.term;
      const detail = document.createElement('dd');
      detail.textContent = row.detail;
      return [term, detail];
    }),
  );
}
