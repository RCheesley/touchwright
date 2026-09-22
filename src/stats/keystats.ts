/**
 * Weak keys, grouped by finger and by row.
 *
 * This is the point of the whole project. A per-character miss list tells a
 * learner that they keep fluffing `p`, `,` and `q`; grouping the same numbers by
 * the finger that presses them and the row it has to reach for tells them the
 * useful thing, which is that their left ring finger cannot find the upper row.
 * One is a list of characters, the other is a diagnosis, and the diagnosis is
 * what a lesson can be built from.
 *
 * So the shape here is deliberately two levels deep, finger then row, and every
 * level carries its own numbers, its own wording and its own severity band. The
 * wording is the primary channel: colour reinforces a band, it never carries it.
 * `describeKey` supplies the phrasing for an individual key so that this module
 * and the drill readout never disagree about what to call a position.
 *
 * Pure by design, and free of the DOM, so the grouping can be tested without a
 * browser. It knows about the board and the keymap because a finger and a row are
 * facts about a position, not about a character: the same `p` is a different
 * diagnosis on a different layout.
 *
 * Two boundary rules, both learned the hard way elsewhere in this codebase:
 *
 * Statistics are keyed by code point, never by the character, so every id comes
 * back through `characterFromKeyStatId` rather than being trusted as a character.
 * A malformed id throws rather than being skipped, because storage already drops
 * unreadable ids with a warning and anything that reaches here is meant to be
 * canonical.
 *
 * A key the current layout does not bind cannot be given a finger or a row, and
 * that is a real state rather than an error: a learner who swaps layouts still
 * owns those statistics. Those keys are reported separately, in `unplaced`, so
 * the total is never quietly short.
 */

import {
  describeKey,
  indexKeys,
  type BoardDefinition,
  type Finger,
  type Hand,
  type KeyPosition,
  type Row,
} from '../board/types.js';
import { characterFromKeyStatId, type KeyStat } from './storage.js';

/**
 * How a group or a key is doing, in three bands. Words, not a colour and not a
 * number: the view prints the wording and may tint it, never the other way
 * round.
 */
export type Severity = 'steady' | 'watch' | 'weak';

export const SEVERITY_WORDS: Readonly<Record<Severity, string>> = {
  steady: 'steady',
  watch: 'worth watching',
  weak: 'needs work',
};

export interface WeakKeyThresholds {
  /**
   * Below this many presses a miss rate is noise rather than evidence. Absent,
   * zero and malformed are three different things: a key with no presses at all
   * is reported as unmeasured, not as perfect.
   */
  readonly minAttempts: number;
  /** At or above this miss rate a key or a group is worth watching. */
  readonly watchMissRate: number;
  /** At or above this miss rate it needs work. */
  readonly weakMissRate: number;
}

/**
 * Tuned to be useful rather than flattering. One miss in twenty is worth
 * mentioning; one in seven is the thing to practise next. Four presses is the
 * smallest sample this will draw a conclusion from.
 */
export const WEAK_KEY_THRESHOLDS: WeakKeyThresholds = {
  minAttempts: 4,
  watchMissRate: 0.05,
  weakMissRate: 0.15,
};

export class InvalidThresholdsError extends RangeError {
  override readonly name = 'InvalidThresholdsError';
  constructor(problem: string) {
    super(`Weak-key thresholds are not usable: ${problem}`);
  }
}

function checkThresholds(thresholds: WeakKeyThresholds): void {
  const { minAttempts, watchMissRate, weakMissRate } = thresholds;
  if (!Number.isSafeInteger(minAttempts) || minAttempts < 1) {
    throw new InvalidThresholdsError(
      `minAttempts must be a whole number of at least 1, got ${String(minAttempts)}`,
    );
  }
  for (const [name, rate] of [
    ['watchMissRate', watchMissRate],
    ['weakMissRate', weakMissRate],
  ] as const) {
    if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
      throw new InvalidThresholdsError(
        `${name} must be a fraction from 0 to 1, got ${String(rate)}`,
      );
    }
  }
  if (weakMissRate < watchMissRate) {
    throw new InvalidThresholdsError('weakMissRate must not be lower than watchMissRate');
  }
}

/** One key, with the statistics behind it and the words for where it lives. */
export interface WeakKey {
  /** The code-point id the statistics are stored under. */
  readonly keyId: string;
  readonly character: string;
  /** The character named so it can be read aloud: `space`, not a blank. */
  readonly label: string;
  readonly position: number;
  /** Hand, finger, reach and row, from `describeKey`. */
  readonly description: string;
  /**
   * The part of the position its finger-and-row group does not already say: a
   * reach out of the finger's own column, or which arc of the thumb cluster.
   * Null when the group heading has said everything there is to say.
   */
  readonly qualifier: string | null;
  readonly hits: number;
  readonly misses: number;
  /** Hits plus misses. Zero is a real state: a key that has never been pressed. */
  readonly attempts: number;
  /** Misses over attempts, 0 to 1. Zero when there are no attempts. */
  readonly missRate: number;
  /** Mean milliseconds per correct press, or null when nothing was sampled. */
  readonly meanMs: number | null;
  /** False when there are too few presses to draw a conclusion from. */
  readonly measured: boolean;
  readonly severity: Severity;
  /** One sentence, numbers and all, for a view to print unchanged. */
  readonly summary: string;
}

/**
 * One row's worth of one finger's keys. This is the unit the project is about:
 * not "you miss `p`" but "your left ring finger cannot find the upper row".
 */
export interface RowGroup {
  readonly hand: Hand;
  readonly finger: Finger;
  readonly row: Row;
  /** `home row`, or `thumb cluster` for the row that has no row. */
  readonly rowLabel: string;
  /** The whole diagnosis in words: `left ring finger, upper row`. */
  readonly label: string;
  readonly keys: readonly WeakKey[];
  readonly hits: number;
  readonly misses: number;
  readonly attempts: number;
  readonly missRate: number;
  readonly severity: Severity;
  /** The numbers alone, for printing under a heading that already names the row. */
  readonly counts: string;
  /** Row-scoped, for printing inside a finger's panel. */
  readonly summary: string;
  /** Finger and row both named, for a list that stands on its own. */
  readonly standaloneSummary: string;
}

/** One finger of one hand, and every row it reaches for. */
export interface FingerGroup {
  readonly hand: Hand;
  readonly finger: Finger;
  /** `left ring finger`, or `left thumb`, which has no row to qualify it. */
  readonly label: string;
  readonly rows: readonly RowGroup[];
  readonly hits: number;
  readonly misses: number;
  readonly attempts: number;
  readonly missRate: number;
  readonly severity: Severity;
  /** The numbers alone, for printing under a heading that already names it. */
  readonly counts: string;
  readonly summary: string;
}

/** Statistics for a key this layout does not bind. Reported, never dropped. */
export interface UnplacedKey {
  readonly keyId: string;
  readonly character: string;
  readonly label: string;
  readonly hits: number;
  readonly misses: number;
  readonly attempts: number;
}

export interface KeyStatsReport {
  readonly totalHits: number;
  readonly totalMisses: number;
  readonly totalAttempts: number;
  /** Correct presses over all presses, 0 to 1. Zero when nothing was typed. */
  readonly accuracy: number;
  /** Keys with at least one press. */
  readonly keysPressed: number;
  /** Keys with enough presses to draw a conclusion from. */
  readonly keysMeasured: number;
  /** Keys pressed enough times, and never missed. */
  readonly keysClean: number;
  /**
   * Every finger that has pressed anything, worst first, each with its rows.
   * Fingers that are behaving are still here: a learner comparing one finger
   * against another needs the whole hand, not only the failures.
   */
  readonly fingers: readonly FingerGroup[];
  /** The rows that need work, worst first, across every finger. */
  readonly weakest: readonly RowGroup[];
  readonly unplaced: readonly UnplacedKey[];
  /** One sentence for the top of the view. Never empty. */
  readonly summary: string;
}

export interface KeyStatsInput {
  readonly keyStats: Readonly<Record<string, KeyStat>>;
  /** Only the character-to-position map is needed, so a test can pass a stub. */
  readonly keymap: { readonly charToPosition: ReadonlyMap<string, number> };
  readonly board: BoardDefinition;
  readonly thresholds?: WeakKeyThresholds;
}

/** The character named so that it can be spoken: a blank reads as nothing. */
export function nameKeyCharacter(character: string): string {
  if (character === ' ') return 'space';
  if (character === '\n') return 'enter';
  if (character === '\t') return 'tab';
  return `“${character}”`;
}

/** How a row reads in a sentence. The thumb cluster has no row, so it is named. */
export function rowLabel(row: Row): string {
  return row === 'thumb' ? 'thumb cluster' : `${row} row`;
}

/**
 * What a key's group heading does not already say. A finger-and-row heading
 * covers hand, finger and row, so all that is left is a sideways reach out of the
 * finger's own column, or which arc of the thumb cluster a thumb key is on.
 */
export function qualifierFor(key: KeyPosition): string | null {
  if (key.kind === 'thumb') return `${key.arc} arc`;
  return key.reach === 'natural' ? null : `${key.reach} reach`;
}

/** `left ring finger`. A thumb is a thumb; it is not a "thumb finger". */
export function fingerLabel(hand: Hand, finger: Finger): string {
  return finger === 'thumb' ? `${hand} thumb` : `${hand} ${finger} finger`;
}

function percent(fraction: number): number {
  return Math.round(fraction * 100);
}

function bandFor(
  attempts: number,
  missRate: number,
  thresholds: WeakKeyThresholds,
): { severity: Severity; measured: boolean } {
  if (attempts < thresholds.minAttempts) return { severity: 'steady', measured: false };
  if (missRate >= thresholds.weakMissRate) return { severity: 'weak', measured: true };
  if (missRate >= thresholds.watchMissRate) return { severity: 'watch', measured: true };
  return { severity: 'steady', measured: true };
}

/** `3 of 21 presses missed, 14%`, or the honest version when there are none. */
function countSentence(misses: number, attempts: number): string {
  if (attempts === 0) return 'not pressed yet';
  if (misses === 0) {
    return attempts === 1 ? '1 press, none missed' : `${attempts} presses, none missed`;
  }
  return `${misses} of ${attempts} presses missed, ${percent(misses / attempts)}%`;
}

/** Ordering: worst miss rate first, then whichever was pressed more. */
function byNeed(
  left: { missRate: number; attempts: number; misses: number },
  right: { missRate: number; attempts: number; misses: number },
): number {
  if (right.missRate !== left.missRate) return right.missRate - left.missRate;
  if (right.misses !== left.misses) return right.misses - left.misses;
  return right.attempts - left.attempts;
}

interface Totals {
  hits: number;
  misses: number;
  totalMs: number;
  samples: number;
}

function addTo(totals: Totals, stat: KeyStat): void {
  totals.hits += stat.hits;
  totals.misses += stat.misses;
  totals.totalMs += stat.totalMs;
  totals.samples += stat.samples;
}

function emptyTotals(): Totals {
  return { hits: 0, misses: 0, totalMs: 0, samples: 0 };
}

/** Row order as the hand meets them, so a group reads top to bottom. */
const ROW_ORDER: readonly Row[] = [
  'function',
  'number',
  'upper',
  'home',
  'lower',
  'bottom',
  'thumb',
];

function rowRank(row: Row): number {
  const rank = ROW_ORDER.indexOf(row);
  // Every Row is in ROW_ORDER; a new one added to the board types without being
  // added here would sort to the end rather than vanish.
  return rank === -1 ? ROW_ORDER.length : rank;
}

/** Fingers strongest first, so both hands read in the same direction. */
const FINGER_ORDER: readonly Finger[] = ['thumb', 'index', 'middle', 'ring', 'pinky'];

function fingerRank(finger: Finger): number {
  const rank = FINGER_ORDER.indexOf(finger);
  return rank === -1 ? FINGER_ORDER.length : rank;
}

interface Bucket {
  readonly hand: Hand;
  readonly finger: Finger;
  readonly row: Row;
  readonly keys: WeakKey[];
  readonly totals: Totals;
}

/**
 * Group per-key statistics by finger and row, and word every level of it.
 *
 * The report is complete rather than filtered: every finger that has pressed
 * anything appears, with a band of its own, because "your right hand is fine" is
 * as useful a thing to read as "your left ring finger is not". `weakest` is the
 * filtered view, for a UI that wants to lead with the diagnosis.
 */
export function summariseKeyStats(input: KeyStatsInput): KeyStatsReport {
  const thresholds = input.thresholds ?? WEAK_KEY_THRESHOLDS;
  checkThresholds(thresholds);

  const boardKeys = indexKeys(input.board);
  const buckets = new Map<string, Bucket>();
  const unplaced: UnplacedKey[] = [];
  const overall = emptyTotals();

  let keysPressed = 0;
  let keysMeasured = 0;
  let keysClean = 0;

  for (const [keyId, stat] of Object.entries(input.keyStats)) {
    // Throws on a malformed id rather than skipping it: storage already drops
    // unreadable ids with a warning, so anything here is meant to be canonical
    // and a silent skip would hide a corrupted store.
    const character = characterFromKeyStatId(keyId);
    const attempts = stat.hits + stat.misses;

    addTo(overall, stat);
    if (attempts > 0) keysPressed += 1;

    const position = input.keymap.charToPosition.get(character);
    const key: KeyPosition | undefined =
      position === undefined ? undefined : boardKeys.get(position);
    if (position === undefined || key === undefined) {
      // A key this layout does not bind has no finger and no row. Reported
      // rather than dropped, so the totals are never quietly short.
      unplaced.push({
        keyId,
        character,
        label: nameKeyCharacter(character),
        hits: stat.hits,
        misses: stat.misses,
        attempts,
      });
      continue;
    }

    const missRate = attempts === 0 ? 0 : stat.misses / attempts;
    const { severity, measured } = bandFor(attempts, missRate, thresholds);
    if (measured) {
      keysMeasured += 1;
      if (stat.misses === 0) keysClean += 1;
    }

    const bucketId = `${key.hand}/${key.finger}/${key.row}`;
    let bucket = buckets.get(bucketId);
    if (bucket === undefined) {
      bucket = {
        hand: key.hand,
        finger: key.finger,
        row: key.row,
        keys: [],
        totals: emptyTotals(),
      };
      buckets.set(bucketId, bucket);
    }
    addTo(bucket.totals, stat);

    bucket.keys.push({
      keyId,
      character,
      label: nameKeyCharacter(character),
      position,
      description: describeKey(key),
      qualifier: qualifierFor(key),
      hits: stat.hits,
      misses: stat.misses,
      attempts,
      missRate,
      meanMs: stat.samples === 0 ? null : Math.round(stat.totalMs / stat.samples),
      measured,
      severity,
      summary: `${nameKeyCharacter(character)}, ${countSentence(stat.misses, attempts)}`,
    });
  }

  const fingers = collectFingers(buckets, thresholds);
  const weakest = fingers
    .flatMap((group) => group.rows)
    .filter((row) => row.severity === 'weak' || row.severity === 'watch')
    .sort(byNeed);

  const totalAttempts = overall.hits + overall.misses;

  return {
    totalHits: overall.hits,
    totalMisses: overall.misses,
    totalAttempts,
    accuracy: totalAttempts === 0 ? 0 : overall.hits / totalAttempts,
    keysPressed,
    keysMeasured,
    keysClean,
    fingers,
    weakest,
    unplaced,
    summary: reportSummary(totalAttempts, overall.misses, weakest, thresholds),
  };
}

function collectFingers(
  buckets: ReadonlyMap<string, Bucket>,
  thresholds: WeakKeyThresholds,
): readonly FingerGroup[] {
  const byFinger = new Map<string, { hand: Hand; finger: Finger; buckets: Bucket[] }>();
  for (const bucket of buckets.values()) {
    const id = `${bucket.hand}/${bucket.finger}`;
    const existing = byFinger.get(id);
    if (existing === undefined) {
      byFinger.set(id, { hand: bucket.hand, finger: bucket.finger, buckets: [bucket] });
    } else {
      existing.buckets.push(bucket);
    }
  }

  const groups: FingerGroup[] = [];
  for (const { hand, finger, buckets: owned } of byFinger.values()) {
    const ownerLabel = fingerLabel(hand, finger);
    const rows: RowGroup[] = owned
      .map((bucket): RowGroup => {
        const attempts = bucket.totals.hits + bucket.totals.misses;
        const missRate = attempts === 0 ? 0 : bucket.totals.misses / attempts;
        const { severity } = bandFor(attempts, missRate, thresholds);
        const counts = countSentence(bucket.totals.misses, attempts);
        const name = rowLabel(bucket.row);
        return {
          hand,
          finger,
          row: bucket.row,
          rowLabel: name,
          label: `${ownerLabel}, ${name}`,
          // Worst key first inside the row, so the thing to practise reads first.
          keys: [...bucket.keys].sort(byNeed),
          hits: bucket.totals.hits,
          misses: bucket.totals.misses,
          attempts,
          missRate,
          severity,
          counts,
          summary: `${name}: ${counts}`,
          standaloneSummary: `${ownerLabel}, ${name}: ${counts}`,
        };
      })
      // Worst row first: the diagnosis leads, and the row order is the tie break
      // so a finger with nothing wrong still reads top to bottom.
      .sort((left, right) => {
        const need = byNeed(left, right);
        return need === 0 ? rowRank(left.row) - rowRank(right.row) : need;
      });

    const hits = rows.reduce((sum, row) => sum + row.hits, 0);
    const misses = rows.reduce((sum, row) => sum + row.misses, 0);
    const attempts = hits + misses;
    const missRate = attempts === 0 ? 0 : misses / attempts;
    const { severity } = bandFor(attempts, missRate, thresholds);

    groups.push({
      hand,
      finger,
      label: ownerLabel,
      rows,
      hits,
      misses,
      attempts,
      missRate,
      severity,
      counts: countSentence(misses, attempts),
      summary: `${ownerLabel}: ${countSentence(misses, attempts)}`,
    });
  }

  return groups.sort((left, right) => {
    const need = byNeed(left, right);
    if (need !== 0) return need;
    const byFingerRank = fingerRank(left.finger) - fingerRank(right.finger);
    return byFingerRank === 0 ? left.hand.localeCompare(right.hand) : byFingerRank;
  });
}

function reportSummary(
  totalAttempts: number,
  totalMisses: number,
  weakest: readonly RowGroup[],
  thresholds: WeakKeyThresholds,
): string {
  if (totalAttempts === 0) {
    return 'Nothing recorded yet. Type a drill and this fills in.';
  }
  if (totalAttempts < thresholds.minAttempts) {
    return `Only ${totalAttempts} ${totalAttempts === 1 ? 'press' : 'presses'} so far, which is too few to draw a conclusion from.`;
  }

  const accuracy = percent((totalAttempts - totalMisses) / totalAttempts);
  const worst = weakest[0];
  if (worst === undefined) {
    return `${accuracy}% of ${totalAttempts} presses were right, and no finger and row needs work.`;
  }
  return `${accuracy}% of ${totalAttempts} presses were right. Your ${worst.label} is where most of the misses are.`;
}

export interface WeakKeySelection {
  /**
   * Take the keys that are only worth watching as well as the ones that need
   * work. Off by default: a repair drill built from everything that has ever
   * wobbled is a lesson, not a repair.
   */
  readonly includeWatch?: boolean;
  /**
   * At most this many keys, worst first. Absent means every key that qualifies;
   * a caller with a limited amount of room says so rather than slicing after
   * the fact, so the ordering is decided in one place.
   */
  readonly limit?: number;
}

/**
 * The keys that need work, worst first, flattened out of the finger-and-row
 * report.
 *
 * `summariseKeyStats` already does the analysis: it bands every key, orders the
 * worst first inside each row, and refuses to draw a conclusion from too few
 * presses. What it does not do is hand back a plain list, because its shape is
 * deliberately two levels deep for the view that reads it. This is that list,
 * and it is what feeds `nextStep` and `generateRepairText`: a repair drill wants
 * keys, not a diagnosis.
 *
 * Only measured keys are ever returned. `WEAK_KEY_THRESHOLDS.minAttempts` is the
 * rule that stops one miss on a key pressed twice from being called a weakness,
 * and it is applied by `summariseKeyStats` when the report is built; the check
 * here is belt and braces, so that a hand-made report cannot sneak an unmeasured
 * key into a drill.
 *
 * Deterministic: equal need is settled by the character, so the same report
 * always produces the same list in the same order.
 */
export function selectWeakKeys(
  report: KeyStatsReport,
  options?: WeakKeySelection,
): readonly WeakKey[] {
  const limit = options?.limit;
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 0)) {
    throw new RangeError(`limit must be a non-negative whole number, got ${String(limit)}`);
  }

  const wanted: readonly Severity[] = options?.includeWatch === true ? ['weak', 'watch'] : ['weak'];

  const keys = report.fingers
    .flatMap((finger) => finger.rows)
    .flatMap((row) => row.keys)
    .filter((key) => key.measured && wanted.includes(key.severity))
    .sort((left, right) => {
      const need = byNeed(left, right);
      return need === 0 ? left.character.localeCompare(right.character) : need;
    });

  return limit === undefined ? keys : keys.slice(0, limit);
}

/**
 * The same list as characters, which is what both `nextStep` and
 * `generateRepairText` take. Statistics are keyed by code point, so the
 * character comes from the report rather than from an id being treated as one.
 */
export function weakKeyCharacters(
  report: KeyStatsReport,
  options?: WeakKeySelection,
): readonly string[] {
  return selectWeakKeys(report, options).map((key) => key.character);
}
