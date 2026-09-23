/**
 * The sprint's duration control.
 *
 * WCAG 2.2.1 applies to sprint mode, because a sprint imposes a time limit, and
 * the brief declines to argue the "essential timing" exemption. So the limit is
 * adjustable before a sprint starts, the current setting is stated in visible
 * text beside the control rather than only implied by the selected option, and
 * one of the options genuinely never expires — `NO_LIMIT` is a real state in
 * `limits.ts`, not a zero that reads as "already out of time".
 *
 * The options are built from `SPRINT_DURATIONS_MS` rather than written into the
 * markup, so a duration added there appears here without anyone remembering to
 * add it twice, and a value that did not come from that list is refused rather
 * than quietly rounded to something else.
 */

import { describeLimit, isTimed, SPRINT_DURATIONS_MS } from '../drill/limits.js';
import { describeDurationChoice, parseSprintLimit } from '../drill/sprint.js';
import { required } from './dom.js';

/** The duration a learner is offered first. A minute is a sprint; untimed is a choice. */
export const DEFAULT_SPRINT_LIMIT_MS = 60_000;

export interface SprintControlsOptions {
  /** Called when the learner starts a sprint, with the limit they chose. */
  readonly onStart: (limitMs: number) => void;
  /** Called whenever the chosen limit changes, before any sprint is started. */
  readonly onLimitChange?: (limitMs: number) => void;
  readonly initialLimitMs?: number;
  readonly durations?: readonly number[];
  readonly root?: ParentNode;
}

export interface SprintControls {
  /** The limit a sprint started now would run under. */
  readonly limitMs: number;
  /** Remove every listener. Nothing survives this. */
  destroy(): void;
}

/** The sentence under the control. The setting is a fact, not a tooltip. */
export function describeSetting(limitMs: number): string {
  if (!isTimed(limitMs)) {
    return 'Current setting: untimed. This sprint will never run out of time; finish it or press Escape whenever you like.';
  }
  return `Current setting: ${describeLimit(limitMs)}. You can change this before you start; it stays put once a sprint is running.`;
}

export function createSprintControls(options: SprintControlsOptions): SprintControls {
  const root = options.root ?? document;
  const durations = options.durations ?? SPRINT_DURATIONS_MS;
  if (durations.length === 0) {
    // Prefer throwing to offering a control with nothing in it.
    throw new RangeError('A sprint duration control needs at least one duration to offer');
  }

  const select = required('#sprint-duration', HTMLSelectElement, root);
  const setting = required('#sprint-setting', HTMLElement, root);
  const start = required('#sprint-start', HTMLButtonElement, root);

  select.replaceChildren(
    ...durations.map((limitMs) => {
      const option = document.createElement('option');
      option.value = String(limitMs);
      option.textContent = describeDurationChoice(limitMs);
      return option;
    }),
  );

  const wanted = options.initialLimitMs ?? DEFAULT_SPRINT_LIMIT_MS;
  const first = durations[0];
  if (first === undefined) throw new RangeError('A sprint duration control needs a first duration');
  select.value = String(durations.includes(wanted) ? wanted : first);

  /** Read back through the parser, so the control and the sprint agree or throw. */
  function chosen(): number {
    return parseSprintLimit(select.value, durations);
  }

  function showSetting(): void {
    setting.textContent = describeSetting(chosen());
  }

  function onChange(): void {
    showSetting();
    options.onLimitChange?.(chosen());
  }

  function onStart(): void {
    options.onStart(chosen());
  }

  select.addEventListener('change', onChange);
  start.addEventListener('click', onStart);
  showSetting();

  return {
    get limitMs() {
      return chosen();
    },
    destroy(): void {
      select.removeEventListener('change', onChange);
      start.removeEventListener('click', onStart);
    },
  };
}
