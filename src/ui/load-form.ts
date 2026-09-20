/**
 * The load form.
 *
 * Exported rather than self-invoking so that importing this module has no side
 * effects and a test can drive it against a DOM it built itself.
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
import { summariseKeymap } from './layout-summary.js';

/**
 * Finds an element and checks it is the kind expected.
 *
 * A missing or wrong-typed element means the markup and this module have drifted
 * apart. Failing loudly at startup beats a listener that silently never fires,
 * or a file input that turns out to be a div.
 */
function required<T extends Element>(
  selector: string,
  kind: abstract new (...args: never[]) => T,
  within: ParentNode = document,
): T {
  const found = within.querySelector(selector);
  if (found === null) {
    throw new Error(`Expected an element matching "${selector}"`);
  }
  if (!(found instanceof kind)) {
    throw new TypeError(
      `Expected "${selector}" to be a ${kind.name}, found a ${found.tagName.toLowerCase()}`,
    );
  }
  return found;
}

function describeFailure(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return 'Something went wrong reading that file.';
}

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

  function showError(message: string): void {
    error.textContent = message;
    error.hidden = false;
    summary.hidden = true;
    board.hidden = true;
    status.textContent = '';
  }

  /**
   * Draws the board, and states in text everything the drawing shows.
   *
   * The diagram is `aria-hidden`, so this is not decoration: the readout names the
   * highlighted key, the legend names each finger in words, and the list names
   * every cap's hand, finger and row. If the drawing were removed the page would
   * lose nothing but the picture.
   */
  function showBoard(keymap: Keymap): void {
    const labels = new Map(keymap.positionToChar);

    // There is no drill yet, so the diagram points at E. Where E sits is the most
    // telling thing about a layout, which is why the summary above names it too.
    // A layout with no E falls back to the space the trainer will teach.
    const highlight = keymap.charToPosition.get('e') ?? GLOVE80.spacePosition;
    const key = indexKeys(GLOVE80).get(highlight);
    if (key === undefined) {
      // Prefer throwing to drawing a diagram that points at nothing.
      throw new Error(
        `Cannot highlight position ${highlight}: ${GLOVE80.name} does not define it.`,
      );
    }

    nextKey.textContent = `Highlighted on the diagram: ${nameLabel(labels.get(highlight), highlight)} — ${describeKey(key)}.`;
    figure.replaceChildren(renderBoard(GLOVE80, { labels, highlight }));
    legend.replaceChildren(...fingersOnBoard(GLOVE80).map(legendItem));
    keyList.replaceChildren(...describeBoardKeys(GLOVE80, labels).map(keyListItem));
    board.hidden = false;
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
        status.textContent = `Loaded ${keymap.title}.`;
      } catch (cause) {
        // Surfaced, never swallowed: a parse failure is the user's problem to
        // fix and they can only fix what they can see.
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
  item.dataset.finger = finger;

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
