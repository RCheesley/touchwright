/**
 * A live region speaks when its contents change, so the same message twice is
 * heard once. The messages most likely to repeat here are the ones a learner
 * most needs: mistyping the same key twice produces the same sentence twice.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { announceInto } from '../../src/ui/dom.js';

describe('announceInto', () => {
  let region: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '<p id="region" role="status" aria-live="polite"></p>';
    const found = document.querySelector<HTMLElement>('#region');
    if (found === null) throw new Error('fixture did not render');
    region = found;
  });

  it('says the message', () => {
    announceInto(region, 'Wrong key. “a” was expected.');
    expect(region.textContent).toBe('Wrong key. “a” was expected.');
  });

  it('changes the text when the same message is said twice', () => {
    announceInto(region, 'Wrong key.');
    const first = region.textContent;
    announceInto(region, 'Wrong key.');
    expect(region.textContent).not.toBe(first);
  });

  it('keeps changing across a long run of identical messages', () => {
    const seen: string[] = [];
    for (let time = 0; time < 6; time += 1) {
      announceInto(region, 'Wrong key.');
      seen.push(region.textContent);
    }
    // Every message differs from the one before it, which is what makes it heard.
    for (let time = 1; time < seen.length; time += 1) {
      expect(seen[time]).not.toBe(seen[time - 1]);
    }
  });

  it('differs only by trailing whitespace, so nothing extra can be read out', () => {
    announceInto(region, 'Wrong key.');
    announceInto(region, 'Wrong key.');
    expect(region.textContent.trim()).toBe('Wrong key.');
    // Not a zero-width space, which some screen readers announce as a character.
    expect(region.textContent).not.toContain('​');
  });

  it('still changes when a repeat follows a different message', () => {
    announceInto(region, 'Word 1 of 8: ask');
    announceInto(region, 'Wrong key.');
    const before = region.textContent;
    announceInto(region, 'Wrong key.');
    expect(region.textContent).not.toBe(before);
  });
});
