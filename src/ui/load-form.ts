/**
 * The load form.
 *
 * Exported rather than self-invoking so that importing this module has no side
 * effects and a test can drive it against a DOM it built itself.
 */

import { GLOVE80 } from '../board/index.js';
import { parseMoErgoLayoutText } from '../keymap/moergo.js';
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

  function showError(message: string): void {
    error.textContent = message;
    error.hidden = false;
    summary.hidden = true;
    status.textContent = '';
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
        status.textContent = `Loaded ${keymap.title}.`;
      } catch (cause) {
        // Surfaced, never swallowed: a parse failure is the user's problem to
        // fix and they can only fix what they can see.
        showError(describeFailure(cause));
      }
    })();
  });
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
