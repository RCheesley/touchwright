/**
 * The views around the drill: the ladder, the statistics, and the export and
 * import of progress.
 *
 * Three things here are acceptance criteria rather than taste.
 *
 * **Everything loaded goes through `ProgressStore`, and nothing is merged by
 * reference.** Progress handed over by an external store can arrive deeply
 * frozen, and merging a frozen graph into live state made the statistics
 * immutable so the first keystroke threw. `ProgressStore.load` and
 * `ProgressStore.import` both thaw and validate, and the thawed copy is then
 * handed to `session.applyLoadedProgress`, which merges field by field. No object
 * from a file ever becomes live state. Regression 1.
 *
 * **Colour is never the only channel.** A star count is written in words beside
 * the row of glyphs, which is `aria-hidden`; a severity band is a word before it
 * is a tint; and the little miss-rate bars are decoration with the same number
 * printed next to them.
 *
 * **A partly unreadable import is reported, not refused.** `readProgress` keeps
 * what is usable and returns warnings; those warnings are printed, item by item,
 * so a learner knows exactly what was dropped. Only a file that is not JSON at
 * all is refused outright, and then the message says so.
 *
 * The grouping of weak keys by finger and row lives in `src/stats/keystats.ts`,
 * which has no DOM, so the diagnosis can be tested without a browser. This module
 * only turns it into markup.
 */

import type { BoardDefinition } from '../board/types.js';
import type { DrillSession } from '../drill/index.js';
import {
  advancesLesson,
  highestUnlockedLesson,
  levelFor,
  STARS_TO_ADVANCE,
} from '../drill/scoring.js';
import type { Lesson } from '../ladder/index.js';
import type { Keymap } from '../keymap/types.js';
import {
  summariseKeyStats,
  SEVERITY_WORDS,
  type FingerGroup,
  type KeyStatsReport,
  type RowGroup,
  type Severity,
  type WeakKey,
} from '../stats/keystats.js';
import type { ProgressStore } from '../stats/storage.js';
import { describeFailure, required } from './dom.js';

/** Stars a lesson can be worth. The ladder shows all three, earned or not. */
export const MAX_STARS = 3;

export interface LessonChoice {
  readonly lesson: Lesson;
  /** Index into the ladder, which is also what `progress.lesson` holds. */
  readonly index: number;
}

/**
 * How a file reaches the learner. Injected so that a test can watch the export
 * without a real browser, and so the default can state why it is a blob.
 */
export type DownloadJson = (fileName: string, json: string) => void;

export interface ProgressViewOptions {
  readonly board: BoardDefinition;
  readonly keymap: Keymap;
  /** The generated ladder, in order. */
  readonly lessons: readonly Lesson[];
  readonly session: DrillSession;
  readonly store: ProgressStore;
  /**
   * Warnings from the load that ran at startup. Passed in rather than re-read,
   * because the load has to happen before the first keystroke and this view is
   * only built once a layout has been chosen.
   */
  readonly startupWarnings?: readonly string[];
  /** Where saved progress lives, in words, for the learner to read. */
  readonly storageDescription?: string;
  readonly onChooseLesson?: (choice: LessonChoice) => void;
  readonly root?: ParentNode;
  readonly download?: DownloadJson;
  /** The clock the export filename is dated from. */
  readonly today?: () => Date;
}

export interface ProgressView {
  /** Re-render the ladder and the statistics from live progress. */
  refresh(): void;
  /** Write live progress to the store. A failure is shown, never swallowed. */
  save(): void;
  destroy(): void;
}

/**
 * A blob URL, deliberately.
 *
 * The site is served from a subpath on GitHub Pages (`/touchwright/`), and a
 * relative `href` would be resolved against whatever path the page is on, so an
 * export that worked at the root would 404 one directory down. An object URL is
 * absolute and origin-scoped, so it does not care what path the page is served
 * from.
 */
export function downloadJsonFile(fileName: string, json: string): void {
  let url: string;
  try {
    url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  } catch (cause) {
    throw new Error(`This browser would not build a file to download: ${describeFailure(cause)}`, {
      cause,
    });
  }

  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.rel = 'noopener';
    // Attached before the click: some browsers ignore a click on an anchor that
    // is not in the document.
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // Revoked whether or not the click worked, so a failed export leaks nothing.
    URL.revokeObjectURL(url);
  }
}

function starWords(stars: number): string {
  if (stars <= 0) return 'no stars yet';
  return stars === 1 ? `1 star of ${MAX_STARS}` : `${stars} stars of ${MAX_STARS}`;
}

/** Decoration only: the count beside this is the fact. */
function starGlyphs(stars: number): string {
  const earned = Math.max(0, Math.min(MAX_STARS, Math.floor(stars)));
  return '★'.repeat(earned) + '☆'.repeat(MAX_STARS - earned);
}

function percentage(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  textContent?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (textContent !== undefined) node.textContent = textContent;
  return node;
}

/** A word for every band, so the tint beside it never has to carry the meaning. */
function bandWord(severity: Severity): string {
  return SEVERITY_WORDS[severity];
}

/** A key as a cap: a space has no glyph, so it gets the open-box symbol. */
function keyGlyph(character: string): string {
  if (character === ' ') return '␣';
  if (character === '\n') return '⏎';
  if (character === '\t') return '⇥';
  return character;
}

function definitionList(list: HTMLElement, rows: readonly (readonly [string, string])[]): void {
  list.replaceChildren(
    ...rows.flatMap(([term, detail]) => [
      element('dt', undefined, term),
      element('dd', undefined, detail),
    ]),
  );
}

export function createProgressView(options: ProgressViewOptions): ProgressView {
  const root = options.root ?? document;
  const el = {
    ladderSection: required('#ladder-section', HTMLElement, root),
    ladderList: required('#ladder-list', HTMLElement, root),
    ladderCurrent: required('#ladder-current', HTMLElement, root),
    statsSection: required('#stats-section', HTMLElement, root),
    statsSummary: required('#stats-summary', HTMLElement, root),
    statsTotals: required('#stats-totals', HTMLElement, root),
    statsWeak: required('#stats-weak', HTMLElement, root),
    statsUnplaced: required('#stats-unplaced', HTMLElement, root),
    progressSection: required('#progress-section', HTMLElement, root),
    where: required('#progress-where', HTMLElement, root),
    exportButton: required('#progress-export', HTMLButtonElement, root),
    clearButton: required('#progress-clear', HTMLButtonElement, root),
    importInput: required('#progress-import', HTMLInputElement, root),
    status: required('#progress-status', HTMLElement, root),
    report: required('#progress-report', HTMLElement, root),
    reportIntro: required('#progress-report-intro', HTMLElement, root),
    reportList: required('#progress-report-list', HTMLElement, root),
    error: required('#progress-error', HTMLElement, root),
  };

  const download = options.download ?? downloadJsonFile;
  const today = options.today ?? ((): Date => new Date());
  const lessons = options.lessons;

  /** Clearing saved progress cannot be undone, so it takes two deliberate goes. */
  let clearArmed = false;
  const CLEAR_LABEL = 'Clear saved progress';
  const CLEAR_CONFIRM_LABEL = 'Really clear saved progress';

  function clearFeedback(): void {
    el.error.textContent = '';
    el.error.hidden = true;
    el.report.hidden = true;
    el.reportIntro.textContent = '';
    el.reportList.replaceChildren();
  }

  function showError(message: string): void {
    // Surfaced, never swallowed, and nothing else on the page is torn down: the
    // learner's progress is exactly as it was.
    el.error.textContent = message;
    el.error.hidden = false;
  }

  /**
   * Prints what an import dropped, one item per line. `readProgress` returns
   * these rather than throwing, precisely so that a partly corrupt file still
   * hands back the parts that are usable.
   */
  function showWarnings(intro: string, warnings: readonly string[]): void {
    if (warnings.length === 0) {
      el.report.hidden = true;
      return;
    }
    el.reportIntro.textContent = intro;
    el.reportList.replaceChildren(...warnings.map((warning) => element('li', undefined, warning)));
    el.report.hidden = false;
  }

  function disarmClear(): void {
    if (!clearArmed) return;
    clearArmed = false;
    el.clearButton.textContent = CLEAR_LABEL;
    delete el.clearButton.dataset['armed'];
    el.clearButton.removeAttribute('aria-describedby');
  }

  function save(): void {
    try {
      options.store.save(options.session.progress);
    } catch (cause) {
      // A private window and a full quota both land here. Surfaced with what to
      // do about it, and live progress is untouched, so the drill carries on.
      showError(
        `Your progress could not be saved in this browser: ${describeFailure(cause)} Export it to keep it.`,
      );
    }
  }

  /** Best stars per lesson, in ladder order, which is what unlocking reads. */
  function starsInLadderOrder(): readonly number[] {
    const stars = options.session.progress.stars;
    return lessons.map((lesson) => stars[lesson.id] ?? 0);
  }

  function renderLadder(): void {
    const progress = options.session.progress;
    const stars = starsInLadderOrder();
    const unlocked = lessons.length === 0 ? 0 : highestUnlockedLesson(stars);
    // The saved lesson can point past what is unlocked if a file from a longer
    // ladder was imported. Clamp for display rather than pretending it is open.
    const current = Math.min(Math.max(0, progress.lesson), unlocked);

    el.ladderList.replaceChildren(
      ...lessons.map((lesson, index) =>
        ladderRung({
          lesson,
          index,
          stars: stars[index] ?? 0,
          isUnlocked: index <= unlocked,
          isCurrent: index === current,
          previousName: lessons[index - 1]?.name ?? null,
        }),
      ),
    );

    // Short on purpose: the rung below repeats the blurb, and this is a live
    // region, so it should say the thing that changed and stop.
    const currentLesson = lessons[current];
    el.ladderCurrent.textContent =
      currentLesson === undefined
        ? 'This layout produced no lessons.'
        : `Current lesson: ${currentLesson.name}, ${current + 1} of ${lessons.length}. ` +
          `${unlocked + 1} of ${lessons.length} unlocked so far.`;
  }

  interface RungFacts {
    readonly lesson: Lesson;
    readonly index: number;
    readonly stars: number;
    readonly isUnlocked: boolean;
    readonly isCurrent: boolean;
    readonly previousName: string | null;
  }

  function ladderRung(facts: RungFacts): HTMLLIElement {
    const { lesson, stars, isUnlocked, isCurrent } = facts;
    const item = element('li', 'ladder-rung');
    item.dataset['state'] = isCurrent ? 'current' : isUnlocked ? 'unlocked' : 'locked';
    item.dataset['stage'] = lesson.stage;
    // A step in a sequence, which is what a ladder is.
    if (isCurrent) item.setAttribute('aria-current', 'step');

    const head = element('p', 'ladder-rung-head');
    head.append(element('span', 'ladder-rung-name', lesson.name));

    const glyphs = element('span', 'ladder-stars', starGlyphs(stars));
    glyphs.setAttribute('aria-hidden', 'true');
    glyphs.dataset['stars'] = String(Math.max(0, Math.min(MAX_STARS, stars)));
    head.append(glyphs);

    // The count in words is the fact; the glyphs above are decoration.
    head.append(element('span', 'ladder-stars-words', starWords(stars)));
    item.append(head);

    const state = element('p', 'ladder-state');
    if (!isUnlocked) {
      state.textContent =
        facts.previousName === null
          ? `Locked. Earn ${STARS_TO_ADVANCE} stars on the lesson before it to unlock this one.`
          : `Locked. Earn ${STARS_TO_ADVANCE} stars on ${facts.previousName} to unlock this one.`;
    } else if (isCurrent) {
      state.textContent = advancesLesson(stars)
        ? 'Unlocked, and this is your current lesson. Passed, so the next one is open too.'
        : 'Unlocked, and this is your current lesson.';
    } else {
      state.textContent = advancesLesson(stars)
        ? 'Unlocked and passed. You can come back to it whenever you like.'
        : 'Unlocked. Not passed yet.';
    }
    item.append(state);

    item.append(element('p', 'ladder-blurb', lesson.blurb));

    const added =
      lesson.addedKeys.length === 0
        ? 'No new keys: this one is a stage over the keys you already have.'
        : `New keys: ${lesson.addedKeys.map(keyGlyph).join(' ')}.`;
    item.append(
      element('p', 'ladder-keys', `${added} ${lesson.keys.length} keys in play altogether.`),
    );

    if (isUnlocked) {
      const action = element('p', 'ladder-action');
      const button = element('button', 'button button-outline');
      button.type = 'button';
      // Named with the lesson, so every button on the ladder is distinct to
      // anyone listening rather than a page full of "Practise".
      button.textContent = isCurrent ? `Practise ${lesson.name} again` : `Practise ${lesson.name}`;
      button.addEventListener('click', () => {
        chooseLesson(facts.index);
      });
      action.append(button);
      item.append(action);
    }

    return item;
  }

  function chooseLesson(index: number): void {
    const lesson = lessons[index];
    if (lesson === undefined) {
      // Prefer throwing to quietly switching to the wrong lesson.
      throw new RangeError(`There is no lesson at ladder index ${index}`);
    }
    disarmClear();
    options.session.progress.lesson = index;
    save();
    refresh();
    options.onChooseLesson?.({ lesson, index });
  }

  function renderStats(): void {
    const progress = options.session.progress;
    const report: KeyStatsReport = summariseKeyStats({
      keyStats: progress.keyStats,
      keymap: options.keymap,
      board: options.board,
    });

    el.statsSummary.textContent = report.summary;

    const level = levelFor(progress.xp);
    definitionList(el.statsTotals, [
      ['Presses', `${report.totalAttempts} (${report.totalMisses} missed)`],
      [
        'Accuracy',
        report.totalAttempts === 0 ? 'nothing to measure yet' : percentage(report.accuracy),
      ],
      [
        'Keys',
        `${report.keysPressed} pressed, ${report.keysMeasured} with enough presses to judge, ${report.keysClean} never missed`,
      ],
      [
        'Experience',
        `${progress.xp} XP — level ${level.level}, ${level.intoLevel} of ${level.levelSpan} into it`,
      ],
    ]);

    renderWeakGroups(report);

    if (report.unplaced.length === 0) {
      el.statsUnplaced.hidden = true;
      el.statsUnplaced.textContent = '';
    } else {
      const named = report.unplaced.map((key) => key.label).join(', ');
      el.statsUnplaced.textContent =
        `${report.unplaced.length} ${report.unplaced.length === 1 ? 'key' : 'keys'} in your statistics ` +
        `(${named}) are not bound on this layout, so they have no finger or row. They are kept, not grouped.`;
      el.statsUnplaced.hidden = false;
    }
  }

  /**
   * The diagnosis, worst first: fingers that need work in full, and the ones that
   * are behaving tucked into a disclosure so the thing to practise leads.
   */
  function renderWeakGroups(report: KeyStatsReport): void {
    if (report.fingers.length === 0) {
      el.statsWeak.replaceChildren(
        element(
          'p',
          'stats-empty',
          'Nothing recorded on this layout yet. Finish a drill and the breakdown by finger and row appears here.',
        ),
      );
      return;
    }

    const needWork = report.fingers.filter((group) => group.severity !== 'steady');
    const steady = report.fingers.filter((group) => group.severity === 'steady');
    const children: HTMLElement[] = [];

    if (needWork.length === 0) {
      children.push(
        element(
          'p',
          'stats-empty',
          'No finger and row needs work at the moment. Every group below is inside its margin.',
        ),
      );
    } else {
      children.push(...needWork.map(fingerPanel));
    }

    if (steady.length > 0) {
      const details = element('details', 'stats-steady');
      const summary = element(
        'summary',
        undefined,
        `${steady.length} ${steady.length === 1 ? 'finger that is' : 'fingers that are'} behaving`,
      );
      details.append(summary, ...steady.map(fingerPanel));
      children.push(details);
    }

    el.statsWeak.replaceChildren(...children);
  }

  function fingerPanel(group: FingerGroup): HTMLElement {
    const panel = element('div', 'stats-finger');
    panel.dataset['hand'] = group.hand;
    panel.dataset['finger'] = group.finger;
    panel.dataset['severity'] = group.severity;

    const heading = element('h4', 'stats-finger-name');
    heading.append(element('span', 'stats-finger-label', group.label));
    // The band is a word first. The tint on it is reinforcement.
    heading.append(element('span', 'stats-band', bandWord(group.severity)));
    panel.append(heading);

    // The heading above already names the finger, so only the numbers go here.
    panel.append(element('p', 'stats-finger-summary', `${group.counts}.`));

    const rows = element('ul', 'stats-rows');
    rows.append(...group.rows.map(rowItem));
    panel.append(rows);

    return panel;
  }

  function rowItem(row: RowGroup): HTMLLIElement {
    const item = element('li', 'stats-row');
    item.dataset['row'] = row.row;
    item.dataset['severity'] = row.severity;

    const head = element('p', 'stats-row-head');
    head.append(element('span', 'stats-row-name', row.rowLabel));
    head.append(element('span', 'stats-band', bandWord(row.severity)));
    head.append(missBar(row.missRate));
    item.append(head);

    item.append(element('p', 'stats-row-summary', `${row.counts}.`));

    const keys = element('ul', 'stats-keys');
    keys.append(...row.keys.map(keyItem));
    item.append(keys);

    return item;
  }

  /** Decoration. The same number is printed beside it in words. */
  function missBar(missRate: number): HTMLElement {
    const bar = element('span', 'stats-bar');
    bar.setAttribute('aria-hidden', 'true');
    const fill = element('span', 'stats-bar-fill');
    fill.style.inlineSize = `${Math.round(Math.min(1, Math.max(0, missRate)) * 100)}%`;
    bar.append(fill);
    return bar;
  }

  function keyItem(key: WeakKey): HTMLLIElement {
    const item = element('li', 'stats-key');
    item.dataset['severity'] = key.severity;

    const cap = element('span', 'stats-key-cap', keyGlyph(key.character));
    cap.setAttribute('aria-hidden', 'true');
    item.append(cap);

    // The finger and the row are in the headings above, so the only part of the
    // position worth repeating here is what they do not say: a sideways reach, or
    // which arc of the thumb cluster.
    const where = key.qualifier === null ? '' : ` (${key.qualifier})`;
    const pace = key.meanMs === null ? '' : ` About ${key.meanMs} ms a press.`;
    const judged = key.measured ? '' : ' Too few presses to judge yet.';
    item.append(element('span', 'stats-key-words', `${key.summary}${where}.${pace}${judged}`));

    return item;
  }

  function refresh(): void {
    renderLadder();
    renderStats();
    el.ladderSection.hidden = false;
    el.statsSection.hidden = false;
    el.progressSection.hidden = false;
    el.where.textContent =
      options.storageDescription ??
      'Your progress is saved in this browser as you practise, and the file below is how it leaves.';
  }

  function onExport(): void {
    disarmClear();
    clearFeedback();
    const stamp = today().toISOString().slice(0, 10);
    const fileName = `touchwright-progress-${stamp}.json`;
    try {
      download(fileName, options.store.export(options.session.progress));
    } catch (cause) {
      showError(`That export did not happen: ${describeFailure(cause)}`);
      return;
    }
    el.status.textContent = `Exported ${fileName}. Keep it somewhere you will find it again; importing it restores your progress in any browser.`;
  }

  function onClear(): void {
    clearFeedback();
    if (!clearArmed) {
      clearArmed = true;
      el.clearButton.textContent = CLEAR_CONFIRM_LABEL;
      el.clearButton.dataset['armed'] = 'true';
      el.status.textContent =
        'This will delete the progress saved in this browser, and it cannot be undone. Choose the button again to confirm, or press Escape to cancel. Export first if you want to keep it.';
      return;
    }

    disarmClear();
    try {
      options.store.clear();
    } catch (cause) {
      showError(`Saved progress could not be cleared: ${describeFailure(cause)}`);
      return;
    }

    // The session's own live Progress object is kept, because that is the object
    // it records keystrokes into; only its two maps are replaced, with fresh empty
    // ones of this realm. Nothing from a file or another realm is put in its place.
    const progress = options.session.progress;
    progress.lesson = 0;
    progress.xp = 0;
    progress.stars = {};
    progress.keyStats = {};

    refresh();
    el.status.textContent =
      'Saved progress cleared. The ladder is back at the first lesson and the statistics are empty.';
  }

  function onClearKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || !clearArmed) return;
    disarmClear();
    el.status.textContent = 'Clearing cancelled. Your saved progress is untouched.';
  }

  /**
   * Import, in one pass: read, validate through the store, merge into live state,
   * save the merged result, then say what happened and what was dropped.
   *
   * The merge takes the better of the two for every field, so importing your own
   * file can never cost you the drills you have done since exporting it.
   */
  async function importFile(file: File): Promise<void> {
    let text: string;
    try {
      text = await file.text();
    } catch (cause) {
      showError(`Could not read ${file.name}: ${describeFailure(cause)}`);
      return;
    }

    let loaded;
    try {
      // Through the store, which thaws and validates. Nothing from the file is
      // ever merged into live state by reference.
      loaded = options.store.import(text);
    } catch (cause) {
      showError(`${file.name} could not be imported. ${describeFailure(cause)}`);
      return;
    }

    let applied;
    try {
      applied = options.session.applyLoadedProgress(loaded.progress);
    } catch (cause) {
      showError(`${file.name} could not be applied: ${describeFailure(cause)}`);
      return;
    }

    save();
    refresh();

    const warnings = [...loaded.warnings, ...applied.warnings];
    const starsSeen = Object.keys(loaded.progress.stars).length;
    const parts = [
      `Imported ${file.name}.`,
      `${applied.mergedKeys} ${applied.mergedKeys === 1 ? 'key' : 'keys'} of statistics and`,
      `${starsSeen} ${starsSeen === 1 ? 'lesson' : 'lessons'} with stars were merged in, keeping the better of the file and this browser.`,
    ];
    if (!applied.lessonApplied) {
      parts.push(
        'You are partway through a drill, so the lesson in that file was left alone; nothing you are typing was disturbed.',
      );
    }
    if (warnings.length > 0) {
      parts.push(
        `${warnings.length} ${warnings.length === 1 ? 'part' : 'parts'} of it could not be read and ${warnings.length === 1 ? 'was' : 'were'} dropped; the rest was kept.`,
      );
    }
    el.status.textContent = parts.join(' ');

    showWarnings(
      warnings.length === 1
        ? 'One part of that file was dropped:'
        : `${warnings.length} parts of that file were dropped:`,
      warnings,
    );
  }

  function onImportChange(): void {
    disarmClear();
    clearFeedback();
    const file = el.importInput.files?.item(0) ?? null;
    if (file === null) {
      el.status.textContent = '';
      return;
    }
    el.status.textContent = `Reading ${file.name}…`;
    void importFile(file);
  }

  el.exportButton.addEventListener('click', onExport);
  el.clearButton.addEventListener('click', onClear);
  el.clearButton.addEventListener('keydown', onClearKeydown);
  el.importInput.addEventListener('change', onImportChange);

  el.clearButton.textContent = CLEAR_LABEL;
  clearFeedback();
  el.status.textContent = '';
  refresh();

  // Startup warnings last, so they are the thing on screen after first paint
  // rather than being overwritten by the first render.
  const startupWarnings = options.startupWarnings ?? [];
  if (startupWarnings.length > 0) {
    el.status.textContent =
      startupWarnings.length === 1
        ? 'One part of the progress saved in this browser could not be read. Everything else was kept.'
        : `${startupWarnings.length} parts of the progress saved in this browser could not be read. Everything else was kept.`;
    showWarnings('From the progress saved in this browser:', startupWarnings);
  }

  return {
    refresh,
    save,
    destroy(): void {
      el.exportButton.removeEventListener('click', onExport);
      el.clearButton.removeEventListener('click', onClear);
      el.clearButton.removeEventListener('keydown', onClearKeydown);
      el.importInput.removeEventListener('change', onImportChange);
    },
  };
}
