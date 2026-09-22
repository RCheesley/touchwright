/**
 * The two DOM chores every view in here needs.
 *
 * `required` is the reason this module exists: a missing or wrong-typed element
 * means the markup and a module have drifted apart, and a listener that silently
 * never fires is the hardest kind of bug to see. Failing loudly at startup is
 * cheaper, so nothing in the UI reaches for `querySelector` directly.
 */

/**
 * Finds an element and checks it is the kind expected.
 *
 * Throws rather than returning null, because every caller needs the element and
 * none of them has a sensible way to carry on without it.
 */
export function required<T extends Element>(
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

/** The message from a thrown value, without ever swallowing the value itself. */
export function describeFailure(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return 'Something went wrong.';
}

/**
 * Says something in a live region, in a way that a repeat is still heard.
 *
 * A live region speaks when its contents change. Setting it to the string it
 * already holds changes nothing, so an assistive technology has nothing to
 * notice and the message is silent. That matters here because the messages most
 * likely to repeat are the ones a learner most needs: mistyping the same key
 * twice in a row produces the same sentence twice, and the second one would
 * never be spoken.
 *
 * A single trailing space is toggled so that consecutive identical messages are
 * always a real change. A trailing space is chosen over a zero-width space
 * because it cannot be mistaken for a character and read out; it is invisible in
 * the rendering either way.
 *
 * Whether every screen reader treats a whitespace-only difference as a change is
 * not something we can assert from here. docs/screen-reader-testing.md asks
 * testers to confirm it, and it is the reason that document exists.
 */
export function announceInto(region: HTMLElement, message: string): void {
  const previous = region.textContent;
  region.textContent = previous === message ? `${message} ` : message;
}
