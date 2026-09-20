import { test } from '@playwright/test';

/**
 * The end-to-end journeys the brief requires, named now so they are tracked, and
 * marked fixme until the features they cover exist. Each one is filled in as its
 * feature lands.
 *
 * These have no assertions by design -- there is nothing yet to assert against --
 * so the rule that looks for them is turned off here and nowhere else.
 */
/* eslint-disable playwright/expect-expect */

test.describe('the trainer journeys', () => {
  test.fixme('completes a lesson from start to finish', () => {});

  test.fixme('earns two stars and advances to the next lesson', () => {});

  test.fixme('builds a repair drill from exactly the keys that were missed', () => {});

  test.fixme('runs a sprint to its limit, and offers an untimed option', () => {});

  test.fixme('keeps progress across a reload', () => {});

  test.fixme('exports progress, clears storage, and imports it back', () => {});

  test.fixme('completes a drill without ever touching the mouse', () => {});

  test.fixme('releases keyboard capture on Escape and restores tab navigation', () => {});

  test.fixme('announces the current word and the result, but not every keystroke', () => {});
});
