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
import { parseMoErgoLayoutText } from '../keymap/moergo.js';
import type { Keymap } from '../keymap/types.js';
import {
  describeBoardKeys,
  fingersOnBoard,
  renderBoard,
  type BoardKeyDescription,
} from './board-svg.js';
import { describeFailure, required } from './dom.js';
import { createDrillView, SAMPLE_DRILL_TEXT, type DrillView } from './drill-view.js';
import { summariseKeymap } from './layout-summary.js';

export function wireUp(root: ParentNode = document): void {
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

  /** The board's state, so a highlight change does not need the keymap again. */
  let labels: ReadonlyMap<number, string> = new Map<number, string>();
  let restingHighlight = GLOVE80.spacePosition;
  let drillView: DrillView | null = null;

  function showError(message: string): void {
    error.textContent = message;
    error.hidden = false;
    summary.hidden = true;
    board.hidden = true;
    drillSection.hidden = true;
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
   * Builds the drill surface for this layout.
   *
   * The text is a parameter, not a decision made here: generated text arrives
   * from issue #3 through `SAMPLE_DRILL_TEXT`'s seam, and the ladder will choose
   * the lesson name. Nothing else about this call changes when they land.
   */
  function showDrill(keymap: Keymap): void {
    drillView?.destroy();
    drillView = createDrillView({
      board: GLOVE80,
      keymap,
      text: SAMPLE_DRILL_TEXT,
      lessonName: 'the sample drill',
      nextLessonName: null,
      root,
      onNextKey: (next): void => {
        if (next === null) {
          highlight(restingHighlight, 'Highlighted on the diagram');
          return;
        }
        highlight(next.position, 'Highlighted on the diagram, the next key');
      },
    });
    drillSection.hidden = false;
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
        showDrill(keymap);
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
