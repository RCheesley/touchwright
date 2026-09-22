/**
 * The drill surface: the text a learner types, the marks on it, the cursor, the
 * next-key readout, keyboard capture, and the result.
 *
 * Four decisions here are acceptance criteria rather than taste, and each one is
 * written down because it is easy to undo by accident.
 *
 * **Words are atomic.** The prototype rendered one element per character and let
 * a line break fall inside a word, which is disorienting when you are typing. So
 * characters are wrapped in a word element that cannot break internally, and the
 * break opportunities are the whitespace elements between them. Regression 6.
 *
 * **Colour is never the only channel.** Correct, wrong and pending characters
 * differ in text decoration and weight as well as in colour, and every character
 * carries `data-mark` so the state is readable without seeing it.
 *
 * **The readout is the primary channel.** `describeKey` names hand, finger and
 * row in words; the board highlight is reinforcement, handed to the caller
 * through `onNextKey` rather than drawn here.
 *
 * **Capture is escapable, always.** Escape releases it from anywhere, Tab is
 * never consumed, moving focus off the surface releases it, and how to escape is
 * stated in visible text in the markup. There is no focus trap anywhere in here:
 * nothing in this module moves focus except in response to Escape or a click, and
 * nothing listens for focus leaving in order to pull it back.
 *
 * **The engine owns no timer, and neither does this.** Elapsed time is driven by
 * calling `checkTimeLimit()` on each keystroke, which is all a lesson needs. A
 * sprint also needs a wall clock, because its limit can run out while nobody is
 * typing, so this module — never the engine — schedules one. It does it through
 * `startSprintTimer`, which captures the drill it is for and compares it by
 * identity on every tick, so a timer this module forgets to stop can still only
 * ever act on its own drill. That is regression 3, and the binding is structural
 * rather than a teardown anyone has to remember.
 */

import { describeKey, indexKeys, type BoardDefinition, type KeyPosition } from '../board/types.js';
import {
  createDrillSession,
  KeystrokeHandlerError,
  NO_LIMIT,
  type Drill,
  type DrillOptions,
  type DrillResult,
  type DrillSession,
  type Mark,
} from '../drill/index.js';
import { describeLimit } from '../drill/limits.js';
import { scoreDrill, type DrillMode, type DrillScore } from '../drill/scoring.js';
import {
  createSprintWarnings,
  describeCountdown,
  startSprintTimer,
  type SprintTimer,
  type SprintWarnings,
} from '../drill/sprint.js';
import type { Keymap } from '../keymap/types.js';
import { keyStatId } from '../stats/storage.js';
import { announceInto, required } from './dom.js';

/**
 * A sample drill, and the seam where generated text will arrive.
 *
 * ---------------------------------------------------------------------------
 * SEAM FOR ISSUE #3, drill text generation.
 *
 * `createDrillView` takes its text as a parameter and this constant is only the
 * demo wiring in `load-form.ts`. When #3 lands, pass its generated text in and
 * delete this constant; nothing else in this module has to change. Nothing here
 * knows about lessons, ladders or text generation, and it must stay that way.
 * ---------------------------------------------------------------------------
 */
export const SAMPLE_DRILL_TEXT = 'ask a task; a lad had a flask.';

/** Class names the stylesheet and the tests both rely on. */
export const DRILL_WORD_CLASS = 'drill-word';
export const DRILL_CHAR_CLASS = 'drill-char';

/**
 * How often a running sprint looks at the clock. A second, because the countdown
 * is shown to the second and a faster tick would only burn battery.
 */
export const SPRINT_TICK_MS = 1000;

/** The default schedule: a plain interval, and the cancel that clears it. */
function intervalSchedule(tick: () => void): () => void {
  const id = setInterval(tick, SPRINT_TICK_MS);
  return (): void => {
    clearInterval(id);
  };
}

/**
 * A drill text that this layout cannot type. Thrown rather than dropping the
 * characters, because a drill that asks for a key the keyboard does not have
 * teaches nothing and a silent omission would hide the mismatch.
 */
export class DrillTextNotTypeableError extends Error {
  override readonly name = 'DrillTextNotTypeableError';
  constructor(
    readonly missing: readonly string[],
    layoutTitle: string,
  ) {
    super(
      `${layoutTitle} has no key for ${missing.map((character) => JSON.stringify(character)).join(', ')}, so that drill cannot be typed on this layout.`,
    );
  }
}

/** Everything the UI needs about one key, in words as well as in numbers. */
export interface NextKeyFacts {
  /** Index into the drill's characters. */
  readonly index: number;
  readonly character: string;
  /** The character named so it can be read aloud: `space`, not a blank. */
  readonly label: string;
  readonly position: number;
  /** Hand, finger and row, from `describeKey`. */
  readonly description: string;
}

export interface DrillViewOptions {
  readonly board: BoardDefinition;
  readonly keymap: Keymap;
  /** The drill text. See `SAMPLE_DRILL_TEXT` for the seam this arrives through. */
  readonly text: string;
  /** `NO_LIMIT` or a positive number of milliseconds. */
  readonly limitMs?: number;
  readonly now?: () => number;
  /** Share a session to share progress. One is created when none is given. */
  readonly session?: DrillSession;
  /** Only a lesson awards stars, which is scoring's rule, not this module's. */
  readonly mode?: DrillMode;
  /**
   * The ladder id of the lesson this drill belongs to. Stars are written to
   * progress under it, so a drill with no id earns experience but no stars: the
   * ladder has nowhere to put them.
   */
  readonly lessonId?: string | null;
  readonly lessonName?: string | null;
  /** The lesson two stars unlocks. Null when there is no rung above this one. */
  readonly nextLessonName?: string | null;
  /**
   * Called when the learner takes up an offer to move on. Only ever called when
   * the result actually earned the advance, so the continue button can promise
   * the next lesson by name without lying: if the caller cannot move on, it does
   * not pass this, and the button offers another go at this lesson instead.
   */
  readonly onAdvance?: () => void;
  /**
   * Called when the learner takes up an offer to drill the keys that slipped,
   * with exactly the keys the scoring picked out. Like `onAdvance`, the offer is
   * only made when there is something wired up to deliver it.
   */
  readonly onRepair?: (weakKeys: readonly string[]) => void;
  /**
   * Called whenever the next key changes, and with null when there is none. The
   * board highlight is wired up through this, so that reinforcement is the
   * caller's business and this module never draws a keyboard.
   */
  readonly onNextKey?: (next: NextKeyFacts | null) => void;
  /**
   * Called once a finished drill has been scored and written to progress, so the
   * caller can persist it and refresh the views around the drill. It is never
   * called for an unfinished drill.
   */
  readonly onScored?: (scored: ScoredDrill) => void;
  /**
   * Starts the sprint countdown's repeating tick and returns the function that
   * cancels it. Defaults to `setInterval` at `SPRINT_TICK_MS`.
   *
   * Injected so that a test can step the clock itself and assert what the timer
   * did, rather than waiting a real second for it. A schedule is only ever asked
   * for in sprint mode; a lesson never creates one.
   */
  readonly schedule?: (tick: () => void) => () => void;
  readonly root?: ParentNode;
}

/** What one finished drill did to progress. */
export interface ScoredDrill {
  readonly score: DrillScore;
  readonly mode: DrillMode;
  readonly lessonId: string | null;
  /** True when this drill beat the stars already recorded for the lesson. */
  readonly starsImproved: boolean;
  /** Best stars for this lesson after the drill, or null when there is no lesson. */
  readonly bestStars: number | null;
}

export type CaptureRelease = 'escape' | 'focus-left' | 'teardown';

export interface DrillView {
  /** Whether the keyboard is currently being captured. */
  readonly captured: boolean;
  readonly drill: Drill | null;
  /** Start a fresh drill and take the keyboard. */
  start(): void;
  /** Give the keyboard back. Safe to call when it was never taken. */
  release(reason: CaptureRelease): void;
  /** Remove every listener. Nothing survives this. */
  destroy(): void;
}

export interface DrillTextRender {
  /** Words and the whitespace between them, in order, ready to be appended. */
  readonly nodes: readonly HTMLElement[];
  /** One element per code point, in text order, whitespace included. */
  readonly characters: readonly HTMLElement[];
  readonly words: readonly HTMLElement[];
  /** Per character: which word it belongs to, or -1 for whitespace. */
  readonly wordIndexOf: readonly number[];
  readonly wordTexts: readonly string[];
}

/** Space, tab and newline all break a word; everything else joins one. */
function isBreak(character: string): boolean {
  return /\s/u.test(character);
}

/**
 * Builds the drill text as words that cannot break internally, with the
 * whitespace between them as the only break opportunities.
 *
 * Exported because regression 6 is about this structure: the per-character
 * elements the marks need have to sit inside a word element, never loose in the
 * paragraph.
 */
export function renderDrillText(text: string): DrillTextRender {
  const characters = Array.from(text);
  const nodes: HTMLElement[] = [];
  const charElements: HTMLElement[] = [];
  const words: HTMLElement[] = [];
  const wordIndexOf: number[] = [];
  const wordTexts: string[] = [];

  let current: HTMLElement | null = null;
  let currentText = '';

  const closeWord = (): void => {
    if (current === null) return;
    wordTexts.push(currentText);
    current = null;
    currentText = '';
  };

  characters.forEach((character, index) => {
    const span = document.createElement('span');
    span.className = DRILL_CHAR_CLASS;
    span.dataset['index'] = String(index);
    span.dataset['mark'] = 'pending';
    span.textContent = character;
    charElements.push(span);

    if (isBreak(character)) {
      closeWord();
      // Whitespace sits at the top level, so it is where a line may break. It is
      // still a character the learner types, so it still carries a mark.
      span.classList.add('drill-char-space');
      nodes.push(span);
      wordIndexOf.push(-1);
      return;
    }

    if (current === null) {
      const word = document.createElement('span');
      word.className = DRILL_WORD_CLASS;
      words.push(word);
      nodes.push(word);
      current = word;
      currentText = '';
    }
    current.append(span);
    currentText += character;
    wordIndexOf.push(words.length - 1);
  });

  closeWord();

  return { nodes, characters: charElements, words, wordIndexOf, wordTexts };
}

/** The character named so that it can be spoken: a blank reads as nothing. */
export function nameCharacter(character: string): string {
  if (character === ' ') return 'space';
  if (character === '\n') return 'enter';
  if (character === '\t') return 'tab';
  return `“${character}”`;
}

/** A star count in words, which is the fact; any glyphs elsewhere are decoration. */
function starWords(stars: number): string {
  if (stars <= 0) return 'no stars of 3';
  return stars === 1 ? '1 star of 3' : `${stars} stars of 3`;
}

function percentage(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

/**
 * Keys that slipped, worst first, named as characters rather than as the code
 * point ids statistics are keyed by. Whitespace is dropped by scoring itself, so
 * it is passed through as it is.
 */
function weakKeysFrom(result: DrillResult, characters: readonly string[]): readonly string[] {
  const byId = new Map<string, string>();
  for (const character of characters) {
    byId.set(keyStatId(character), character);
  }

  return [...result.perKey]
    .filter(([, stat]) => stat.misses > 0)
    .sort((left, right) => right[1].misses - left[1].misses)
    .map(([keyId]) => {
      const character = byId.get(keyId);
      if (character === undefined) {
        // The drill's own statistics are keyed by its own characters, so this
        // cannot happen. Throwing beats naming a key we cannot identify.
        throw new Error(`No character in this drill has the statistics key ${keyId}`);
      }
      return character;
    });
}

export function createDrillView(options: DrillViewOptions): DrillView {
  const root = options.root ?? document;
  const el = {
    surface: required('#drill-surface', HTMLElement, root),
    text: required('#drill-text', HTMLElement, root),
    next: required('#drill-next', HTMLElement, root),
    capture: required('#drill-capture', HTMLElement, root),
    progress: required('#drill-progress', HTMLElement, root),
    error: required('#drill-error', HTMLElement, root),
    countdown: required('#sprint-countdown', HTMLElement, root),
    timeWarning: required('#sprint-warning', HTMLElement, root),
    result: required('#drill-result', HTMLElement, root),
    resultSummary: required('#drill-result-summary', HTMLElement, root),
    resultDetail: required('#drill-result-detail', HTMLElement, root),
    resultWhy: required('#drill-result-why', HTMLElement, root),
    start: required('#drill-start', HTMLButtonElement, root),
    reset: required('#drill-reset', HTMLButtonElement, root),
    continue: required('#drill-continue', HTMLButtonElement, root),
  };

  const boardKeys = indexKeys(options.board);
  const mode: DrillMode = options.mode ?? 'lesson';
  const lessonId = options.lessonId ?? null;
  const lessonName = options.lessonName ?? null;
  const nextLessonName = options.nextLessonName ?? null;
  const onAdvance = options.onAdvance ?? null;
  const onRepair = options.onRepair ?? null;
  /** Whether the result on screen earned a move to the next lesson. */
  let advanceEarned = false;
  /** The keys the result on screen offers to repair, empty when it offers none. */
  let repairOffered: readonly string[] = [];
  const limitMs = options.limitMs ?? NO_LIMIT;
  const session =
    options.session ?? createDrillSession(options.now === undefined ? {} : { now: options.now });

  const schedule = options.schedule ?? intervalSchedule;

  let drill: Drill | null = null;
  let rendered = renderDrillText(options.text);
  let captured = false;
  let announcedWord = -1;
  /**
   * The sprint's wall clock, and the milestones it announces.
   *
   * There is at most one, it belongs to exactly one drill, and it is replaced
   * rather than added to. Even so, nothing below relies on this variable being
   * tidied up: the timer stops itself as soon as the drill it was started for is
   * no longer the current one, which is the guarantee regression 3 needs.
   */
  let timer: SprintTimer | null = null;
  let warnings: SprintWarnings | null = null;

  /**
   * Every character has to be typeable on this keyboard before the drill starts.
   * Checked here rather than per keystroke, so the learner is told before they
   * have typed anything rather than halfway through.
   */
  function facts(index: number, character: string): NextKeyFacts {
    const position = options.keymap.charToPosition.get(character);
    if (position === undefined) {
      throw new DrillTextNotTypeableError([character], options.keymap.title);
    }
    const key: KeyPosition | undefined = boardKeys.get(position);
    if (key === undefined) {
      // The keymap was parsed against this board, so the board defines every
      // position it mentions. Prefer throwing to naming a key we cannot place.
      throw new Error(
        `${options.board.name} does not define position ${position}, which types ${JSON.stringify(character)}`,
      );
    }
    return {
      index,
      character,
      label: nameCharacter(character),
      position,
      description: describeKey(key),
    };
  }

  function checkTypeable(text: string): void {
    const missing = [
      ...new Set(
        Array.from(text).filter((character) => !options.keymap.charToPosition.has(character)),
      ),
    ];
    if (missing.length > 0) {
      throw new DrillTextNotTypeableError(missing, options.keymap.title);
    }
  }

  function mountText(text: string): void {
    rendered = renderDrillText(text);
    el.text.replaceChildren(...rendered.nodes);
  }

  function clearError(): void {
    el.error.textContent = '';
    el.error.hidden = true;
  }

  function showError(message: string): void {
    // Surfaced, never swallowed, and the drill is left exactly as it was so the
    // learner can carry on from where they are.
    el.error.textContent = message;
    el.error.hidden = false;
  }

  function hideResult(): void {
    el.result.hidden = true;
    // Cleared so that the next completion is a change the assertive region
    // actually announces, rather than the same text set twice.
    el.resultSummary.textContent = '';
    el.resultDetail.replaceChildren();
    el.resultWhy.textContent = '';
    el.continue.textContent = '';
    advanceEarned = false;
    repairOffered = [];
  }

  function announce(message: string): void {
    // Through the shared helper, because a live region only speaks when its
    // contents change: mistyping the same key twice in a row produces the same
    // sentence twice, and the second one was silent.
    announceInto(el.progress, message);
  }

  function setCaptureState(message: string): void {
    el.capture.textContent = message;
    el.surface.dataset['captured'] = captured ? 'true' : 'false';
  }

  /** The drill mode named in words, so the result card says what it was. */
  function describeMode(): string {
    if (mode === 'sprint') {
      return `sprint across every unlocked key, ${describeLimit(limitMs)}`;
    }
    if (mode === 'repair') return 'repair drill';
    return lessonName === null ? 'lesson' : `lesson: ${lessonName}`;
  }

  /**
   * The countdown, and the milestone announcements beside it.
   *
   * Two channels on purpose. The readout is a `role="timer"`, whose implicit
   * live setting is off, so the second-by-second number is never announced; the
   * polite region is written only when `warnings` says a milestone has been
   * crossed, which is a handful of times per sprint at most. WCAG 2.2.1 asks for
   * the limit to be knowable without watching a number tick down.
   */
  function paintCountdown(remaining: number | null): void {
    if (mode !== 'sprint') return;
    el.countdown.textContent = describeCountdown(remaining);
    el.countdown.hidden = false;
    const warning = warnings?.due(remaining) ?? null;
    if (warning !== null) el.timeWarning.textContent = warning;
  }

  function hideCountdown(): void {
    el.countdown.hidden = true;
    el.countdown.textContent = '';
    el.timeWarning.textContent = '';
  }

  /**
   * Stop whatever timer is running, if one is.
   *
   * Deliberately not the thing that makes this safe. A teardown that is missed
   * is exactly how regression 3 happened, so the timer also stops itself the
   * moment its own drill stops being the current one. This is the tidy path; the
   * identity check in `startSprintTimer` is the guarantee.
   */
  function stopTimer(): void {
    timer?.stop();
    timer = null;
  }

  /**
   * Give this drill, and only this drill, a wall clock.
   *
   * `currentDrill` reads the view's own `drill` variable, so the moment
   * `startDrill` replaces it — or anything else abandons it — the tick sees a
   * different object and the timer takes itself out of the world without
   * touching the new drill.
   */
  function startTimer(current: Drill): void {
    stopTimer();
    warnings = createSprintWarnings(limitMs);
    timer = startSprintTimer({
      drill: current,
      currentDrill: () => drill,
      schedule,
      onTick: (remaining) => {
        paintCountdown(remaining);
      },
      onExpire: (result, expiredDrill) => {
        finish(expiredDrill, result);
      },
    });
    paintCountdown(current.remainingMs());
  }

  function paintMarks(current: Drill | null): void {
    const marks: readonly Mark[] = current?.marks ?? [];
    const cursor = current === null || current.isFinished ? -1 : current.cursor;

    rendered.characters.forEach((span, index) => {
      const mark: Mark = marks[index] ?? 'pending';
      span.dataset['mark'] = mark;
      if (index === cursor) {
        span.dataset['cursor'] = 'true';
      } else {
        delete span.dataset['cursor'];
      }
    });
  }

  function announceWord(current: Drill): void {
    const wordIndex = rendered.wordIndexOf[current.cursor] ?? -1;
    if (wordIndex === -1 || wordIndex === announcedWord) return;
    announcedWord = wordIndex;
    const word = rendered.wordTexts[wordIndex];
    if (word === undefined) return;
    announce(`Word ${wordIndex + 1} of ${rendered.wordTexts.length}: ${word}`);
  }

  function describeNext(current: Drill | null): void {
    if (current === null) {
      const first = Array.from(options.text)[0];
      if (first === undefined) {
        // requireDrillText in the engine refuses empty text, and so does this.
        throw new Error('A drill needs at least one character');
      }
      const preview = facts(0, first);
      el.next.textContent = `First key: ${preview.label} — ${preview.description}. Choose “Start drill” to begin.`;
      options.onNextKey?.(null);
      return;
    }

    const next = current.next;
    if (next === null) {
      el.next.textContent = 'Drill finished. Nothing to type.';
      options.onNextKey?.(null);
      return;
    }

    const found = facts(next.index, next.character);
    el.next.textContent = `Next key: ${found.label} — ${found.description}. Character ${next.index + 1} of ${current.characters.length}.`;
    options.onNextKey?.(found);
  }

  function render(): void {
    paintMarks(drill);
    describeNext(drill);
    if (drill === null || drill.isFinished) return;
    announceWord(drill);
    // Between ticks as well as on them, so the readout answers to the keystroke
    // that was just typed rather than lagging up to a second behind it.
    paintCountdown(drill.remainingMs());
  }

  /**
   * Write what the drill earned into live progress.
   *
   * The stars a learner earns are the whole point of the ladder, and until this
   * existed they were computed, shown once, and thrown away. Experience is added
   * for every mode, because a sprint and a repair drill are still practice; stars
   * are only ever written for a lesson with an id, which is scoring's rule about
   * modes and the ladder's rule about ids, not this module's.
   *
   * Best-of, never last-of: a bad run on a lesson already passed must not take a
   * rung away. Nothing here catches anything, deliberately — progress arriving
   * frozen from an external store has to throw loudly rather than silently drop
   * the write, which is the whole of regression 1.
   */
  function recordScore(score: DrillScore): ScoredDrill {
    const progress = session.progress;
    let starsImproved = false;
    let bestStars: number | null = null;

    if (mode === 'lesson' && lessonId !== null) {
      const previous = progress.stars[lessonId] ?? 0;
      bestStars = Math.max(previous, score.stars);
      starsImproved = bestStars > previous;
      progress.stars[lessonId] = bestStars;
    }

    progress.xp += score.experienceGained;

    const scored: ScoredDrill = {
      score,
      mode,
      lessonId,
      starsImproved,
      bestStars,
    };
    options.onScored?.(scored);
    return scored;
  }

  /** Only shown when a lesson's best differs from the run just finished. */
  function bestStarsRow(scored: ScoredDrill): readonly [string, string][] {
    if (scored.bestStars === null || scored.bestStars === scored.score.stars) return [];
    return [['Best on this lesson', starWords(scored.bestStars)]];
  }

  /** How the assertive summary opens. A sprint says so; a lesson reads as before. */
  function completionLead(completed: boolean): string {
    if (mode === 'sprint') return completed ? 'Sprint complete' : 'Sprint over, time up';
    return completed ? 'Drill complete' : 'Time up';
  }

  function showResult(current: Drill, result: DrillResult): void {
    const score: DrillScore = scoreDrill({
      mode,
      totals: {
        correctKeystrokes: result.correctKeystrokes,
        totalKeystrokes: result.totalKeystrokes,
        elapsedMs: result.elapsedMs,
      },
      weakKeys: weakKeysFrom(result, current.characters),
      lessonName,
      nextLessonName,
    });

    // Written before anything is rendered, so the result card and the ladder
    // beneath it are looking at the same numbers.
    const recorded = recordScore(score);

    const rows: readonly [string, string][] = [
      ['Speed', `${score.wordsPerMinute} words per minute`],
      [
        'Accuracy',
        `${percentage(score.accuracy)} (${result.correctKeystrokes} of ${result.totalKeystrokes} keystrokes)`,
      ],
      ['Stars', mode === 'lesson' ? starWords(score.stars) : 'none, this was not a lesson'],
      ['Experience', `${score.experienceGained} XP`],
      // Named rather than left to be inferred from the star row: "the result
      // distinguishes a sprint from a lesson" is an acceptance criterion, and
      // "none, this was not a lesson" says what it was not, never what it was.
      ['Drill', describeMode()],
      ['Ended', result.completed ? 'you typed it through' : 'the time limit ran out'],
      ...bestStarsRow(recorded),
    ];

    el.resultDetail.replaceChildren(
      ...rows.flatMap(([term, detail]) => {
        const dt = document.createElement('dt');
        dt.textContent = term;
        const dd = document.createElement('dd');
        dd.textContent = detail;
        return [dt, dd];
      }),
    );
    el.resultWhy.textContent = score.nextStep.why;
    // Only promise the next lesson when there is something wired up to deliver
    // it. A button that names a rung and then restarts this one is worse than a
    // plain "go again".
    advanceEarned = score.nextStep.advances && onAdvance !== null;
    // A repair is offered only when scoring picked keys out AND something is
    // wired up to build one. Same rule as advancing: never name a thing on a
    // button that the button will not do.
    repairOffered =
      !advanceEarned && onRepair !== null && score.nextStep.repairKeys.length > 0
        ? score.nextStep.repairKeys
        : [];
    el.continue.textContent =
      advanceEarned || repairOffered.length > 0
        ? score.nextStep.label
        : `Drill this ${mode === 'lesson' ? 'lesson' : mode} again`;
    el.result.hidden = false;

    // Unhidden first, then written, so the assertive region announces the result
    // once rather than announcing an empty region and then its contents.
    el.resultSummary.textContent =
      `${completionLead(result.completed)}. ` +
      `${score.wordsPerMinute} words per minute, ${percentage(score.accuracy)} accuracy` +
      `${mode === 'lesson' ? `, ${starWords(score.stars)}` : ''}. ` +
      `Next: ${score.nextStep.label}. ${score.nextStep.why}`;

    el.start.textContent = mode === 'sprint' ? 'Start another sprint' : 'Start another drill';
  }

  function finish(current: Drill, result: DrillResult): void {
    // Before anything is rendered: a finished drill has no time left to count,
    // and a tick landing mid-render would only repaint a dead countdown.
    stopTimer();
    render();
    if (mode === 'sprint') {
      el.countdown.textContent = describeCountdown(result.completed ? current.remainingMs() : 0);
    }
    showResult(current, result);
  }

  function capture(): void {
    if (captured) return;
    // Capture phase, on the document: the drill takes printable keys wherever
    // they are typed, and there is no input element anywhere on the page.
    document.addEventListener('keydown', onKeydown, { capture: true });
    captured = true;
    setCaptureState('The drill has the keyboard. Press Escape to give it back.');
  }

  function release(reason: CaptureRelease): void {
    if (!captured) return;
    document.removeEventListener('keydown', onKeydown, { capture: true });
    captured = false;

    if (reason === 'escape') {
      setCaptureState(
        'Keyboard released. Tab moves through the page as usual. Choose “Resume drill” to carry on typing.',
      );
    } else if (reason === 'focus-left') {
      setCaptureState('Keyboard released, because focus moved off the drill.');
    } else {
      setCaptureState('');
    }

    if (drill !== null && !drill.isFinished) {
      el.start.textContent = mode === 'sprint' ? 'Resume sprint' : 'Resume drill';
    }
  }

  function startDrill(): void {
    checkTypeable(options.text);
    clearError();
    hideResult();
    // The outgoing drill is abandoned here, so its timer goes with it. Even if
    // this line were lost, the old timer could not touch the new drill: it
    // compares the drill it captured with the current one and stops instead.
    stopTimer();
    hideCountdown();
    announcedWord = -1;
    const drillOptions: DrillOptions = { text: options.text, limitMs };
    drill = session.start(drillOptions);
    mountText(options.text);
    el.start.textContent = mode === 'sprint' ? 'Resume sprint' : 'Resume drill';
    if (mode === 'sprint') startTimer(drill);
    render();
    announce(
      mode === 'sprint'
        ? `Sprint ready: ${rendered.wordTexts.length} words, ${describeLimit(limitMs)}. Type what you see.`
        : `Drill ready: ${rendered.wordTexts.length} words. Type what you see.`,
    );
    focusSurface();
  }

  /**
   * Put focus on the surface and take the keyboard.
   *
   * Capture is armed here as well as by the focusin listener, and not only there,
   * because a browser that refuses the focus call for its own reasons would
   * otherwise leave a drill that silently ignores every keystroke. Arming is
   * idempotent, so doing both is free.
   */
  function focusSurface(): void {
    el.surface.focus();
    capture();
  }

  function press(current: Drill, key: string): void {
    let outcome;
    try {
      outcome = current.press(key);
    } catch (error) {
      if (!(error instanceof KeystrokeHandlerError)) throw error;
      showError('That keystroke hit an error. Your drill is unchanged; keep typing.');
      return;
    }

    render();

    // After the render, so the mistake is the last thing said: a word
    // announcement must not talk over it.
    if (outcome.kind === 'wrong') {
      const expected = facts(outcome.index, outcome.expected);
      announce(
        `Wrong key. ${expected.label} was expected: ${expected.description}. Backspace steps back.`,
      );
    }

    if (outcome.result !== null) finish(current, outcome.result);
  }

  function onKeydown(event: KeyboardEvent): void {
    // Tab is never taken, in any state. That is the whole anti-trap guarantee:
    // focus can always leave, whatever the drill is doing.
    if (event.key === 'Tab') return;

    if (event.key === 'Escape') {
      event.preventDefault();
      release('escape');
      // Focus lands on a real, visible control, so Tab carries on from somewhere
      // sensible rather than from a surface that no longer takes keys.
      el.start.focus();
      return;
    }

    // Browser and operating-system shortcuts stay with the browser. AltGr, which
    // Chrome reports as control and alt together, is a printable key on plenty of
    // layouts, so it is deliberately not treated as a shortcut.
    if (event.metaKey || (event.ctrlKey && !event.altKey)) return;

    const current = drill;
    if (current === null) return;

    if (current.isFinished) {
      if (!current.requestContinue(event.key).accepted) return;
      event.preventDefault();
      startDrill();
      return;
    }

    const expired = current.checkTimeLimit();
    if (expired !== null) {
      event.preventDefault();
      finish(current, expired);
      return;
    }

    if (event.key === 'Backspace') {
      event.preventDefault();
      current.backspace();
      announcedWord = -1;
      render();
      return;
    }

    // One code point is a character the learner typed. Everything longer is a
    // named key such as ArrowLeft, and belongs to the browser.
    if (Array.from(event.key).length !== 1) return;
    event.preventDefault();
    press(current, event.key);
  }

  function onFocusIn(event: FocusEvent): void {
    const target = event.target;
    if (target instanceof Node && el.surface.contains(target)) {
      if (drill !== null) capture();
      return;
    }
    release('focus-left');
  }

  function onStartClick(): void {
    if (drill !== null && !drill.isFinished) {
      // Resume: the drill is untouched, it only needs the keyboard back.
      focusSurface();
      return;
    }
    startDrill();
  }

  el.start.addEventListener('click', onStartClick);
  el.reset.addEventListener('click', startDrill);
  function onContinue(): void {
    if (advanceEarned && onAdvance !== null) {
      advanceEarned = false;
      onAdvance();
      return;
    }
    if (repairOffered.length > 0 && onRepair !== null) {
      const keys = repairOffered;
      repairOffered = [];
      onRepair(keys);
      return;
    }
    startDrill();
  }

  el.continue.addEventListener('click', onContinue);
  document.addEventListener('focusin', onFocusIn);

  mountText(options.text);
  hideResult();
  clearError();
  // A fresh view owns the countdown whether or not it is a sprint: a lesson
  // built over an abandoned sprint must not leave that sprint's clock on screen.
  hideCountdown();
  // And it owns the start button's wording for the same reason. A lesson built
  // after a sprint was abandoned must not still be offering to resume it.
  el.start.textContent = mode === 'sprint' ? 'Restart this sprint' : 'Start drill';
  setCaptureState('');
  render();

  return {
    get captured() {
      return captured;
    },
    get drill() {
      return drill;
    },
    start: startDrill,
    release,
    destroy(): void {
      stopTimer();
      release('teardown');
      el.start.removeEventListener('click', onStartClick);
      el.reset.removeEventListener('click', startDrill);
      el.continue.removeEventListener('click', onContinue);
      document.removeEventListener('focusin', onFocusIn);
    },
  };
}
