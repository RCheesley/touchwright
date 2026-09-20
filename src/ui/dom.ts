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
