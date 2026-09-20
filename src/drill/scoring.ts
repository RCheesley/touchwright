/**
 * Scoring: what a finished drill was worth, and what to do next.
 *
 * Everything here is a pure function of plain numbers. Nothing in this module
 * reads the clock, touches the DOM, or knows the engine's or the ladder's
 * types: elapsed time arrives as a number and lesson names arrive as strings.
 * That is deliberate. Scoring is the part a learner argues with ("it said 18
 * wpm and gave me one star"), so it has to be reproducible from its inputs
 * alone, in a test, with no timers involved.
 *
 * Three rules the prototype got wrong, fixed here:
 *
 * An empty drill is not a perfect drill. The prototype answered "100%
 * accuracy" when nothing had been typed, because `typed ? correct / typed : 1`
 * reads better than it behaves. Zero keystrokes now scores zero accuracy, no
 * stars and no experience. Absent is not the same as perfect.
 *
 * Nothing divides by an unmeasured duration. A drill that ends within
 * `MIN_MEASURED_MS` reports a pace of zero rather than Infinity, because a
 * pace derived from a few milliseconds is noise, not speed.
 *
 * The number shown is the number compared. `wordsPerMinute` rounds, and the
 * star thresholds are checked against that same rounded value, so a result
 * card can never read "18 wpm" beside a missing second star.
 */

/** A drill earns nothing, or one, two or three stars. Never more. */
export type StarCount = 0 | 1 | 2 | 3;

/**
 * What the engine counted during one drill. Keystrokes are counts of typed
 * characters, not of keys pressed: modifiers and backspaces are the engine's
 * business, not scoring's.
 */
export interface DrillTotals {
  /** Characters typed that matched what was expected. */
  readonly correctKeystrokes: number;
  /** Characters typed in total, correct or not. Never less than the correct count. */
  readonly totalKeystrokes: number;
  /** Time the drill was actually running. Zero is a real state: an untouched drill. */
  readonly elapsedMs: number;
}

/** The standard typing-test convention: one "word" is five characters. */
export const CHARACTERS_PER_WORD = 5;

/**
 * Below this, a drill is too short to have a measurable pace. Divide by a
 * 2ms drill and you get thousands of words per minute; the prototype shipped
 * this guard for that reason and it is kept, as a named constant.
 */
export const MIN_MEASURED_MS = 400;

/** Two stars unlock the next lesson. */
export const STARS_TO_ADVANCE = 2;

/** At most this many weak keys are named in a repair step's wording. */
export const REPAIR_KEY_LIMIT = 6;

export class InvalidTotalsError extends RangeError {
  override readonly name = 'InvalidTotalsError';
  constructor(field: keyof DrillTotals | 'consistency', value: unknown, expectation: string) {
    super(`Drill totals are not usable: ${field} was ${String(value)}, expected ${expectation}`);
  }
}

export class InvalidStarThresholdsError extends RangeError {
  override readonly name = 'InvalidStarThresholdsError';
  constructor(cause: unknown) {
    super(
      `Star thresholds are not usable: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
}

/**
 * Validate at the boundary. The engine is trusted for types, not for values:
 * a drill whose totals disagree with each other is a bug worth surfacing, not
 * one worth scoring around.
 */
function checkTotals(totals: DrillTotals): void {
  const { correctKeystrokes, totalKeystrokes, elapsedMs } = totals;

  if (!Number.isSafeInteger(correctKeystrokes) || correctKeystrokes < 0) {
    throw new InvalidTotalsError(
      'correctKeystrokes',
      correctKeystrokes,
      'a non-negative whole number',
    );
  }
  if (!Number.isSafeInteger(totalKeystrokes) || totalKeystrokes < 0) {
    throw new InvalidTotalsError('totalKeystrokes', totalKeystrokes, 'a non-negative whole number');
  }
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    throw new InvalidTotalsError('elapsedMs', elapsedMs, 'a non-negative number of milliseconds');
  }
  if (correctKeystrokes > totalKeystrokes) {
    throw new InvalidTotalsError(
      'consistency',
      `${correctKeystrokes} correct of ${totalKeystrokes} typed`,
      'no more correct keystrokes than total keystrokes',
    );
  }
}

/**
 * Words per minute, five characters to the word, counting only correct
 * keystrokes. Rounded to a whole number, because that is the number the result
 * card shows and the number the star thresholds are checked against.
 *
 * A drill shorter than `MIN_MEASURED_MS` — including one that never started —
 * scores zero rather than Infinity. Zero here means "no measurable pace", and
 * `starsFor` treats it as such.
 */
export function wordsPerMinute(totals: DrillTotals): number {
  checkTotals(totals);
  if (totals.elapsedMs < MIN_MEASURED_MS) return 0;

  const words = totals.correctKeystrokes / CHARACTERS_PER_WORD;
  const minutes = totals.elapsedMs / 60_000;
  return Math.round(words / minutes);
}

/**
 * Correct keystrokes over total keystrokes, as a fraction from 0 to 1.
 *
 * A drill with no keystrokes scores 0, not 1. Nothing was demonstrated, and
 * calling that perfect once handed out stars for an untouched drill.
 */
export function accuracy(totals: DrillTotals): number {
  checkTotals(totals);
  if (totals.totalKeystrokes === 0) return 0;
  return totals.correctKeystrokes / totals.totalKeystrokes;
}

/** One rung of the star ladder: every gate has to be met to earn it. */
export interface StarThreshold {
  /** Minimum accuracy, 0 to 1. */
  readonly minAccuracy: number;
  /** Minimum rounded words per minute. Zero means pace is not gated at this rung. */
  readonly minWordsPerMinute: number;
}

export interface StarThresholds {
  readonly one: StarThreshold;
  readonly two: StarThreshold;
  readonly three: StarThreshold;
  /**
   * Stars need a drill long enough to mean something. Ten correct keystrokes
   * typed quickly is a fluke, not three stars, and without this a two-character
   * drill could unlock the whole ladder.
   */
  readonly minKeystrokes: number;
}

/**
 * The bars a learner is actually aiming at, ported from the prototype where
 * they were tuned against real learners.
 *
 * One star is an accuracy-only rung on purpose: a beginner typing carefully and
 * slowly should still leave the drill with something. Two stars adds a modest
 * pace gate and is what unlocks the next lesson. Three stars is near-clean and
 * noticeably quicker.
 *
 * These are the only numbers in the app that decide progression. Change them
 * here, not inline at a call site.
 */
export const STAR_THRESHOLDS: StarThresholds = {
  one: { minAccuracy: 0.9, minWordsPerMinute: 0 },
  two: { minAccuracy: 0.95, minWordsPerMinute: 18 },
  three: { minAccuracy: 0.98, minWordsPerMinute: 28 },
  minKeystrokes: 20,
};

function checkThreshold(name: string, threshold: StarThreshold): void {
  if (!Number.isFinite(threshold.minAccuracy) || threshold.minAccuracy < 0) {
    throw new RangeError(`${name}.minAccuracy must be a fraction from 0 to 1`);
  }
  if (threshold.minAccuracy > 1) {
    throw new RangeError(
      `${name}.minAccuracy must be a fraction from 0 to 1, not a percentage (${threshold.minAccuracy})`,
    );
  }
  if (!Number.isFinite(threshold.minWordsPerMinute) || threshold.minWordsPerMinute < 0) {
    throw new RangeError(`${name}.minWordsPerMinute must be a non-negative number`);
  }
}

/**
 * Thresholds have to rise. A set where three stars is easier than two would
 * quietly award the wrong rung, so it is refused rather than tolerated.
 */
function checkThresholds(thresholds: StarThresholds): void {
  try {
    checkThreshold('one', thresholds.one);
    checkThreshold('two', thresholds.two);
    checkThreshold('three', thresholds.three);

    if (!Number.isSafeInteger(thresholds.minKeystrokes) || thresholds.minKeystrokes < 0) {
      throw new RangeError('minKeystrokes must be a non-negative whole number');
    }

    const rising: readonly [string, StarThreshold][] = [
      ['one', thresholds.one],
      ['two', thresholds.two],
      ['three', thresholds.three],
    ];
    for (let index = 1; index < rising.length; index += 1) {
      const lower = rising[index - 1];
      const higher = rising[index];
      // Indexed access is checked, so prove both rungs exist before comparing.
      if (lower === undefined || higher === undefined) {
        throw new RangeError('star thresholds must define one, two and three');
      }
      if (
        higher[1].minAccuracy < lower[1].minAccuracy ||
        higher[1].minWordsPerMinute < lower[1].minWordsPerMinute
      ) {
        throw new RangeError(`${higher[0]} star must not be easier to earn than ${lower[0]}`);
      }
    }
  } catch (cause) {
    throw new InvalidStarThresholdsError(cause);
  }
}

/**
 * Whether a drill is substantial enough to be worth stars at all: enough
 * keystrokes to prove something, over a long enough span to have a measurable
 * pace. A drill that fails this earns no stars however clean it looks, because
 * an engine that forgot to start its clock must not be able to unlock the
 * ladder with a two-character drill.
 */
export function isScorable(
  totals: DrillTotals,
  thresholds: StarThresholds = STAR_THRESHOLDS,
): boolean {
  checkTotals(totals);
  checkThresholds(thresholds);
  return totals.totalKeystrokes >= thresholds.minKeystrokes && totals.elapsedMs >= MIN_MEASURED_MS;
}

/**
 * Stars for one drill, from zero to three.
 *
 * Every rung is checked independently and the highest one met wins, so a
 * learner is never held back by a rung they skipped past.
 */
export function starsFor(
  totals: DrillTotals,
  thresholds: StarThresholds = STAR_THRESHOLDS,
): 0 | 1 | 2 | 3 {
  if (!isScorable(totals, thresholds)) return 0;

  const achievedAccuracy = accuracy(totals);
  const achievedPace = wordsPerMinute(totals);

  const meets = (threshold: StarThreshold): boolean =>
    achievedAccuracy >= threshold.minAccuracy && achievedPace >= threshold.minWordsPerMinute;

  if (meets(thresholds.three)) return 3;
  if (meets(thresholds.two)) return 2;
  if (meets(thresholds.one)) return 1;
  return 0;
}

/** Two stars or better on a lesson unlocks the one after it. */
export function advancesLesson(stars: number): boolean {
  if (!Number.isFinite(stars) || stars < 0) {
    throw new RangeError(`A star count must be a non-negative number, got ${String(stars)}`);
  }
  return stars >= STARS_TO_ADVANCE;
}

/**
 * The highest lesson index a learner may start, given their best stars per
 * lesson in ladder order. Lesson zero is always open, and every lesson up to
 * and including the returned index stays open for good: unlocking is one-way,
 * so a learner can always drop back down the ladder to a lesson they have
 * already reached.
 */
export function highestUnlockedLesson(starsInLadderOrder: readonly number[]): number {
  let unlocked = 0;
  for (let index = 0; index < starsInLadderOrder.length; index += 1) {
    const stars = starsInLadderOrder[index];
    if (stars === undefined) {
      throw new RangeError(`Star counts must have no gaps; index ${index} was missing`);
    }
    if (!advancesLesson(stars)) break;
    unlocked = index + 1;
  }
  // Never point past the end of the ladder.
  return starsInLadderOrder.length === 0 ? 0 : Math.min(unlocked, starsInLadderOrder.length - 1);
}

/** The shape of the experience curve. Exported so a test can pin it. */
export interface ExperienceWeights {
  /** Accuracy is punished super-linearly: sloppy volume is worth little. */
  readonly accuracyExponent: number;
  /** What a drill is worth at zero pace, as a fraction of its keystroke count. */
  readonly paceFloor: number;
  /** Pace, in wpm, that adds a further 1.0 to the multiplier. */
  readonly paceReference: number;
  /** A drill that produced correct keystrokes is always worth at least this. */
  readonly minimumAward: number;
}

export const EXPERIENCE_WEIGHTS: ExperienceWeights = {
  accuracyExponent: 2.2,
  paceFloor: 0.6,
  paceReference: 70,
  minimumAward: 1,
};

/**
 * Experience for one drill: volume, weighted by how clean and how quick it was.
 *
 * `multiplier` is where the engine applies a streak or combo bonus; scoring
 * does not track streaks. A multiplier of zero means "this drill earns
 * nothing", which is a legitimate thing for a practice mode to ask for.
 *
 * A drill with no correct keystrokes earns nothing at all. The minimum award
 * exists so that a hard-won slow drill is not rounded down to zero, not so
 * that an untouched one pays out.
 */
export function experienceFor(
  totals: DrillTotals,
  multiplier = 1,
  weights: ExperienceWeights = EXPERIENCE_WEIGHTS,
): number {
  checkTotals(totals);

  if (!Number.isFinite(multiplier) || multiplier < 0) {
    throw new RangeError(
      `An experience multiplier must be a non-negative number, got ${String(multiplier)}`,
    );
  }
  if (
    !Number.isFinite(weights.accuracyExponent) ||
    !Number.isFinite(weights.paceFloor) ||
    !Number.isFinite(weights.minimumAward) ||
    weights.accuracyExponent < 0 ||
    weights.paceFloor < 0 ||
    weights.minimumAward < 0
  ) {
    throw new RangeError('Experience weights must be non-negative finite numbers');
  }
  if (!Number.isFinite(weights.paceReference) || weights.paceReference <= 0) {
    throw new RangeError('Experience weights need a positive paceReference to divide by');
  }

  if (totals.correctKeystrokes === 0 || multiplier === 0) return 0;

  const cleanliness = Math.pow(accuracy(totals), weights.accuracyExponent);
  const pace = weights.paceFloor + wordsPerMinute(totals) / weights.paceReference;
  const earned = totals.correctKeystrokes * cleanliness * pace * multiplier;

  return Math.max(weights.minimumAward, Math.round(earned));
}

/** Where a total of experience puts a learner on the level curve. */
export interface LevelProgress {
  /** One-based, and never above `MAX_LEVEL`. */
  readonly level: number;
  /** Experience earned inside the current level. */
  readonly intoLevel: number;
  /** Experience still needed to reach the next level. Zero at the cap. */
  readonly toNext: number;
  /** What the current level costs in full, so a progress bar has a denominator. */
  readonly levelSpan: number;
}

export const LEVEL_BASE_COST = 120;
export const LEVEL_CURVE_EXPONENT = 1.55;
/** The curve stops here. Beyond it, the bar simply stays full. */
export const MAX_LEVEL = 99;

/**
 * What level `level` costs to complete. A gentle super-linear curve: level one
 * is 120 experience, level ten a little over 4000, so early lessons feel quick
 * and the numbers never run away.
 */
export function levelCost(level: number): number {
  if (!Number.isSafeInteger(level) || level < 1 || level > MAX_LEVEL) {
    throw new RangeError(
      `A level must be a whole number from 1 to ${MAX_LEVEL}, got ${String(level)}`,
    );
  }
  return Math.round(LEVEL_BASE_COST * Math.pow(level, LEVEL_CURVE_EXPONENT));
}

/**
 * Level and progress within it, as a pure function of total experience.
 *
 * At `MAX_LEVEL` the bar pins full instead of rolling over into a level that
 * does not exist: `toNext` is 0 and `intoLevel` equals `levelSpan`, so a UI
 * dividing one by the other keeps working.
 */
export function levelFor(experience: number): LevelProgress {
  if (!Number.isFinite(experience) || experience < 0) {
    throw new RangeError(`Experience must be a non-negative number, got ${String(experience)}`);
  }

  let remaining = Math.floor(experience);
  let level = 1;
  let span = levelCost(level);

  while (level < MAX_LEVEL && remaining >= span) {
    remaining -= span;
    level += 1;
    span = levelCost(level);
  }

  if (level === MAX_LEVEL && remaining >= span) {
    return { level, intoLevel: span, toNext: 0, levelSpan: span };
  }
  return { level, intoLevel: remaining, toNext: span - remaining, levelSpan: span };
}

/** Which kind of drill was just finished. Only a lesson awards stars. */
export type DrillMode = 'lesson' | 'sprint' | 'repair';

/**
 * Everything `nextStep` needs to write its own copy. Lesson names arrive as
 * plain strings so that scoring never depends on the ladder's types, and
 * `null` is used rather than an omitted field: "there is no next lesson" and
 * "the caller forgot to say" must not look the same.
 */
export interface NextStepInput {
  readonly mode: DrillMode;
  readonly totals: DrillTotals;
  /** Stars just earned. Zero outside lesson mode. */
  readonly stars: StarCount;
  /** Keys that slipped, most-missed first. Empty when nothing did. */
  readonly weakKeys: readonly string[];
  /** The lesson this drill belongs to, or null when no lesson is in play. */
  readonly lessonName: string | null;
  /** The lesson two stars unlocks, or null when this is the last rung. */
  readonly nextLessonName: string | null;
  readonly thresholds?: StarThresholds;
}

/**
 * What the learner should do next, in the words the UI shows. The UI renders
 * `label` on the button and `why` underneath it, and never has to compose a
 * sentence of its own.
 */
export interface NextStep {
  /** Button text. Short, imperative. */
  readonly label: string;
  /** One sentence of reasoning. Never empty. */
  readonly why: string;
  /** True only when taking this step moves on to the next lesson. */
  readonly advances: boolean;
  /** Keys a repair drill should be built from. Empty unless this is a repair step. */
  readonly repairKeys: readonly string[];
}

function checkWeakKeys(weakKeys: readonly string[]): readonly string[] {
  const cleaned: string[] = [];
  for (let index = 0; index < weakKeys.length; index += 1) {
    const key = weakKeys[index];
    if (key === undefined) {
      throw new RangeError(`Weak keys must have no gaps; index ${index} was missing`);
    }
    if (key.length === 0) {
      throw new RangeError('A weak key cannot be an empty string');
    }
    // Whitespace is not drillable on its own and would render as a blank in the
    // label, so it is dropped rather than shown as a mystery gap.
    if (key.trim().length === 0) continue;
    if (!cleaned.includes(key)) cleaned.push(key);
  }
  return cleaned;
}

function percent(fraction: number): number {
  return Math.round(fraction * 100);
}

function listKeys(keys: readonly string[]): string {
  return keys.map((key) => key.toUpperCase()).join(' ');
}

function countKeys(keys: readonly string[]): string {
  return keys.length === 1 ? '1 key that slipped' : `${keys.length} keys that slipped`;
}

/**
 * Decide, and word, what comes next.
 *
 * The order of the cases is the priority order a learner needs: somewhere new
 * to go beats repairing keys, repairing keys beats grinding the same drill for
 * pace, and pace beats a bare "go again". Two stars is the only thing that
 * advances, and the wording says so, because the ladder stays open behind them.
 */
export function nextStep(input: NextStepInput): NextStep {
  checkTotals(input.totals);
  const thresholds = input.thresholds ?? STAR_THRESHOLDS;
  checkThresholds(thresholds);

  if (!Number.isInteger(input.stars) || input.stars < 0 || input.stars > 3) {
    throw new RangeError(
      `A star count must be a whole number from 0 to 3, got ${String(input.stars)}`,
    );
  }

  const weak = checkWeakKeys(input.weakKeys).slice(0, REPAIR_KEY_LIMIT);
  const pace = wordsPerMinute(input.totals);
  const achieved = accuracy(input.totals);

  const repairStep = (): NextStep => ({
    label: `Repair drill · ${listKeys(weak)}`,
    why: 'A short drill built from those keys, mixed with home row anchors.',
    advances: false,
    repairKeys: weak,
  });

  if (input.mode === 'sprint') {
    if (weak.length > 0) {
      return {
        label: `Drill the ${countKeys(weak)}`,
        why: 'A short repair drill first, then back to sprinting.',
        advances: false,
        repairKeys: weak,
      };
    }
    return {
      label: 'Sprint again',
      why: 'Nothing slipped. Go again whenever you are ready.',
      advances: false,
      repairKeys: [],
    };
  }

  if (input.mode === 'repair') {
    if (weak.length > 0) return repairStep();
    return {
      label: input.lessonName === null ? 'Back to the lesson' : `Back to ${input.lessonName}`,
      why: 'Repair clear. Those keys are behaving.',
      advances: false,
      repairKeys: [],
    };
  }

  if (input.stars >= STARS_TO_ADVANCE && input.nextLessonName !== null) {
    return {
      label: `Start ${input.nextLessonName}`,
      why: 'Unlocked. You can still come back to this lesson from the ladder.',
      advances: true,
      repairKeys: [],
    };
  }

  if (input.stars >= STARS_TO_ADVANCE) {
    return {
      label: input.lessonName === null ? 'Run it again' : `Run ${input.lessonName} again`,
      why: 'That is the last lesson on the ladder, so there is nothing left to unlock.',
      advances: false,
      repairKeys: [],
    };
  }

  if (weak.length > 0) return repairStep();

  if (!isScorable(input.totals, thresholds)) {
    return {
      label: 'Run the drill through',
      why: `Too short to score. Stars need at least ${thresholds.minKeystrokes} keystrokes at a measurable pace.`,
      advances: false,
      repairKeys: [],
    };
  }

  if (achieved >= thresholds.two.minAccuracy && pace < thresholds.two.minWordsPerMinute) {
    const toGo = thresholds.two.minWordsPerMinute - pace;
    return {
      label: 'Run it again for pace',
      why: `Accuracy is there. ${toGo} wpm to go for two stars.`,
      advances: false,
      repairKeys: [],
    };
  }

  if (achieved < thresholds.two.minAccuracy) {
    return {
      label: 'Run it again for accuracy',
      why: `${percent(achieved)}% this time, ${percent(thresholds.two.minAccuracy)}% for two stars.`,
      advances: false,
      repairKeys: [],
    };
  }

  return {
    label: 'Run it again',
    why: 'Two stars is the bar for the next lesson.',
    advances: false,
    repairKeys: [],
  };
}

/** Everything a result card needs, from one call. */
export interface DrillScore {
  readonly wordsPerMinute: number;
  /** 0 to 1. Multiply for display; do not round before comparing. */
  readonly accuracy: number;
  readonly stars: StarCount;
  readonly experienceGained: number;
  readonly nextStep: NextStep;
}

export interface ScoreDrillInput {
  readonly mode: DrillMode;
  readonly totals: DrillTotals;
  readonly weakKeys: readonly string[];
  readonly lessonName: string | null;
  readonly nextLessonName: string | null;
  /** Streak or combo bonus from the engine. Defaults to 1. */
  readonly experienceMultiplier?: number;
  readonly thresholds?: StarThresholds;
}

/**
 * Score a finished drill in one call, so the engine and the UI share one set of
 * numbers and one set of words.
 *
 * Only a lesson awards stars. A sprint measures pace and a repair drill fixes
 * keys; neither should be able to unlock a rung of the ladder.
 */
export function scoreDrill(input: ScoreDrillInput): DrillScore {
  const thresholds = input.thresholds ?? STAR_THRESHOLDS;
  const stars: StarCount = input.mode === 'lesson' ? starsFor(input.totals, thresholds) : 0;

  return {
    wordsPerMinute: wordsPerMinute(input.totals),
    accuracy: accuracy(input.totals),
    stars,
    experienceGained: experienceFor(input.totals, input.experienceMultiplier ?? 1),
    nextStep: nextStep({
      mode: input.mode,
      totals: input.totals,
      stars,
      weakKeys: input.weakKeys,
      lessonName: input.lessonName,
      nextLessonName: input.nextLessonName,
      thresholds,
    }),
  };
}
