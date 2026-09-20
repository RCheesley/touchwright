import { describe, expect, it } from 'vitest';
import {
  accuracy,
  advancesLesson,
  CHARACTERS_PER_WORD,
  EXPERIENCE_WEIGHTS,
  experienceFor,
  highestUnlockedLesson,
  InvalidStarThresholdsError,
  InvalidTotalsError,
  isScorable,
  LEVEL_BASE_COST,
  levelCost,
  levelFor,
  MAX_LEVEL,
  MIN_MEASURED_MS,
  nextStep,
  scoreDrill,
  STAR_THRESHOLDS,
  STARS_TO_ADVANCE,
  starsFor,
  wordsPerMinute,
  type DrillTotals,
  type NextStepInput,
  type StarThresholds,
} from '../../src/drill/scoring.js';

function totals(correct: number, total: number, elapsedMs: number): DrillTotals {
  return { correctKeystrokes: correct, totalKeystrokes: total, elapsedMs };
}

/** A clean two-star lesson run: 95% accuracy at 19 wpm. */
const TWO_STAR_RUN = totals(19, 20, 12_000);

describe('words per minute', () => {
  it('uses five characters to the word', () => {
    expect(CHARACTERS_PER_WORD).toBe(5);
    // 300 correct characters in one minute is 60 five-character words.
    expect(wordsPerMinute(totals(300, 300, 60_000))).toBe(60);
    expect(wordsPerMinute(totals(150, 150, 60_000))).toBe(30);
  });

  it('counts only correct keystrokes, so errors cost pace', () => {
    expect(wordsPerMinute(totals(150, 300, 60_000))).toBe(30);
  });

  it('scales with the elapsed time it is given, not with the clock', () => {
    expect(wordsPerMinute(totals(150, 150, 30_000))).toBe(60);
    expect(wordsPerMinute(totals(150, 150, 120_000))).toBe(15);
  });

  it('reports zero rather than Infinity when no time elapsed', () => {
    const result = wordsPerMinute(totals(10, 10, 0));
    expect(result).toBe(0);
    expect(Number.isFinite(result)).toBe(true);
  });

  it('reports zero for a drill too short to measure', () => {
    expect(wordsPerMinute(totals(10, 10, MIN_MEASURED_MS - 1))).toBe(0);
    expect(wordsPerMinute(totals(10, 10, MIN_MEASURED_MS))).toBeGreaterThan(0);
  });

  it('is zero, not NaN, for a drill with nothing typed at all', () => {
    const result = wordsPerMinute(totals(0, 0, 0));
    expect(result).toBe(0);
    expect(Number.isNaN(result)).toBe(false);
  });
});

describe('accuracy', () => {
  it('is correct keystrokes over total keystrokes', () => {
    expect(accuracy(totals(19, 20, 12_000))).toBe(0.95);
    expect(accuracy(totals(45, 50, 60_000))).toBe(0.9);
    expect(accuracy(totals(50, 50, 60_000))).toBe(1);
  });

  it('treats an untouched drill as zero accuracy, never as perfect', () => {
    // The prototype answered 1 here, which handed a star to a drill nobody
    // had typed in.
    const result = accuracy(totals(0, 0, 0));
    expect(result).toBe(0);
    expect(Number.isNaN(result)).toBe(false);
  });

  it('is zero when everything typed was wrong', () => {
    expect(accuracy(totals(0, 40, 60_000))).toBe(0);
  });

  it('stays within zero and one', () => {
    for (const drill of [totals(0, 1, 1000), totals(1, 1, 1000), totals(37, 91, 45_000)]) {
      const value = accuracy(drill);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});

describe('malformed totals', () => {
  it('refuses more correct keystrokes than total keystrokes', () => {
    expect(() => accuracy(totals(21, 20, 12_000))).toThrow(InvalidTotalsError);
  });

  it('refuses negative counts and negative time', () => {
    expect(() => accuracy(totals(-1, 20, 1000))).toThrow(InvalidTotalsError);
    expect(() => accuracy(totals(1, -20, 1000))).toThrow(InvalidTotalsError);
    expect(() => accuracy(totals(1, 20, -1))).toThrow(InvalidTotalsError);
  });

  it('refuses fractional keystroke counts', () => {
    expect(() => accuracy(totals(1.5, 20, 1000))).toThrow(InvalidTotalsError);
  });

  it('refuses NaN and Infinity rather than propagating them', () => {
    expect(() => wordsPerMinute(totals(10, 10, Number.NaN))).toThrow(InvalidTotalsError);
    expect(() => wordsPerMinute(totals(10, 10, Number.POSITIVE_INFINITY))).toThrow(
      InvalidTotalsError,
    );
    expect(() => wordsPerMinute(totals(Number.NaN, 10, 1000))).toThrow(InvalidTotalsError);
  });

  it('accepts a fractional elapsed time, because performance clocks produce them', () => {
    expect(wordsPerMinute(totals(100, 100, 30_000.5))).toBe(40);
  });
});

describe('star thresholds', () => {
  it('are documented constants, and rise from one rung to the next', () => {
    expect(STAR_THRESHOLDS.one.minAccuracy).toBeLessThan(STAR_THRESHOLDS.two.minAccuracy);
    expect(STAR_THRESHOLDS.two.minAccuracy).toBeLessThan(STAR_THRESHOLDS.three.minAccuracy);
    expect(STAR_THRESHOLDS.one.minWordsPerMinute).toBeLessThanOrEqual(
      STAR_THRESHOLDS.two.minWordsPerMinute,
    );
    expect(STAR_THRESHOLDS.two.minWordsPerMinute).toBeLessThan(
      STAR_THRESHOLDS.three.minWordsPerMinute,
    );
  });

  it('gates one star on accuracy alone, so a careful slow learner still scores', () => {
    expect(STAR_THRESHOLDS.one.minWordsPerMinute).toBe(0);
    expect(starsFor(totals(90, 100, 300_000))).toBe(1);
  });

  it('awards two stars exactly at the accuracy and pace bars', () => {
    expect(accuracy(TWO_STAR_RUN)).toBe(STAR_THRESHOLDS.two.minAccuracy);
    expect(wordsPerMinute(TWO_STAR_RUN)).toBeGreaterThanOrEqual(
      STAR_THRESHOLDS.two.minWordsPerMinute,
    );
    expect(starsFor(TWO_STAR_RUN)).toBe(2);
  });

  it('withholds the second star when accuracy is a hair under the bar', () => {
    // 94 of 100 at a comfortable pace: pace is fine, accuracy is not.
    expect(starsFor(totals(94, 100, 45_000))).toBe(1);
  });

  it('withholds the second star when pace is under the bar', () => {
    // Clean, but slow: 40 correct characters over two minutes is 4 wpm.
    const slowAndClean = totals(40, 40, 120_000);
    expect(accuracy(slowAndClean)).toBe(1);
    expect(wordsPerMinute(slowAndClean)).toBeLessThan(STAR_THRESHOLDS.two.minWordsPerMinute);
    expect(starsFor(slowAndClean)).toBe(1);
  });

  it('awards three stars for near-clean and quicker', () => {
    const run = totals(49, 50, 20_000);
    expect(accuracy(run)).toBe(STAR_THRESHOLDS.three.minAccuracy);
    expect(wordsPerMinute(run)).toBeGreaterThanOrEqual(STAR_THRESHOLDS.three.minWordsPerMinute);
    expect(starsFor(run)).toBe(3);
  });

  it('awards nothing below the first rung', () => {
    expect(starsFor(totals(89, 100, 60_000))).toBe(0);
    expect(starsFor(totals(0, 40, 60_000))).toBe(0);
  });

  it('never awards a star for a drill too short or too quick to mean anything', () => {
    // A perfect flick of a few keys is a fluke, not three stars.
    expect(isScorable(totals(6, 6, 2000))).toBe(false);
    expect(starsFor(totals(6, 6, 2000))).toBe(0);
    // Enough keystrokes, but no measurable time: an engine that never started
    // its clock must not unlock the ladder.
    expect(isScorable(totals(60, 60, 0))).toBe(false);
    expect(starsFor(totals(60, 60, 0))).toBe(0);
    expect(starsFor(totals(0, 0, 0))).toBe(0);
  });

  it('is scorable exactly at the keystroke and duration minimums', () => {
    expect(isScorable(totals(20, STAR_THRESHOLDS.minKeystrokes, MIN_MEASURED_MS))).toBe(true);
    expect(isScorable(totals(19, STAR_THRESHOLDS.minKeystrokes - 1, 60_000))).toBe(false);
    expect(isScorable(totals(20, 20, MIN_MEASURED_MS - 1))).toBe(false);
  });

  it('accepts a caller’s own thresholds', () => {
    const gentle: StarThresholds = {
      one: { minAccuracy: 0.5, minWordsPerMinute: 0 },
      two: { minAccuracy: 0.6, minWordsPerMinute: 1 },
      three: { minAccuracy: 0.7, minWordsPerMinute: 2 },
      minKeystrokes: 5,
    };
    expect(starsFor(totals(14, 20, 60_000), gentle)).toBe(3);
    expect(starsFor(totals(14, 20, 60_000))).toBe(0);
  });

  it('refuses thresholds that fall instead of rising, and says which rung', () => {
    const backwards: StarThresholds = {
      one: { minAccuracy: 0.9, minWordsPerMinute: 0 },
      two: { minAccuracy: 0.95, minWordsPerMinute: 18 },
      three: { minAccuracy: 0.8, minWordsPerMinute: 28 },
      minKeystrokes: 20,
    };
    expect(() => starsFor(TWO_STAR_RUN, backwards)).toThrow(InvalidStarThresholdsError);
    expect(() => starsFor(TWO_STAR_RUN, backwards)).toThrow(/three star/);
  });

  it('keeps the original error as the cause when it rejects thresholds', () => {
    const asPercentage: StarThresholds = {
      one: { minAccuracy: 90, minWordsPerMinute: 0 },
      two: { minAccuracy: 95, minWordsPerMinute: 18 },
      three: { minAccuracy: 98, minWordsPerMinute: 28 },
      minKeystrokes: 20,
    };
    let thrown: unknown;
    try {
      starsFor(TWO_STAR_RUN, asPercentage);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(InvalidStarThresholdsError);
    expect((thrown as InvalidStarThresholdsError).cause).toBeInstanceOf(RangeError);
    expect((thrown as InvalidStarThresholdsError).message).toMatch(/percentage/);
  });

  it('refuses a negative or fractional keystroke minimum', () => {
    const base = STAR_THRESHOLDS;
    expect(() => starsFor(TWO_STAR_RUN, { ...base, minKeystrokes: -1 })).toThrow(
      InvalidStarThresholdsError,
    );
    expect(() => starsFor(TWO_STAR_RUN, { ...base, minKeystrokes: 2.5 })).toThrow(
      InvalidStarThresholdsError,
    );
  });
});

describe('unlocking the next lesson', () => {
  it('unlocks on two stars', () => {
    expect(STARS_TO_ADVANCE).toBe(2);
    expect(advancesLesson(0)).toBe(false);
    expect(advancesLesson(1)).toBe(false);
    expect(advancesLesson(2)).toBe(true);
    expect(advancesLesson(3)).toBe(true);
  });

  it('refuses a nonsensical star count rather than guessing', () => {
    expect(() => advancesLesson(-1)).toThrow(RangeError);
    expect(() => advancesLesson(Number.NaN)).toThrow(RangeError);
  });

  it('opens the ladder up to the first lesson not yet cleared', () => {
    expect(highestUnlockedLesson([])).toBe(0);
    expect(highestUnlockedLesson([0, 0, 0])).toBe(0);
    expect(highestUnlockedLesson([3, 0, 0])).toBe(1);
    expect(highestUnlockedLesson([3, 2, 0, 0])).toBe(2);
    // One star is not enough to pass through.
    expect(highestUnlockedLesson([3, 1, 3, 3])).toBe(1);
  });

  it('never points past the end of the ladder', () => {
    expect(highestUnlockedLesson([3, 3, 3])).toBe(2);
  });

  it('leaves every earlier lesson reachable, because unlocking is one-way', () => {
    const highest = highestUnlockedLesson([3, 2, 0, 0]);
    for (let lesson = 0; lesson <= highest; lesson += 1) {
      expect(lesson).toBeLessThanOrEqual(highest);
    }
    expect(highest).toBe(2);
  });
});

describe('experience', () => {
  it('rewards volume, cleanliness and pace together', () => {
    const clean = experienceFor(totals(250, 250, 60_000));
    const sloppy = experienceFor(totals(250, 300, 60_000));
    const slower = experienceFor(totals(250, 250, 120_000));
    expect(clean).toBeGreaterThan(sloppy);
    expect(clean).toBeGreaterThan(slower);
    expect(clean).toBe(329);
  });

  it('gives more for a longer drill at the same quality', () => {
    expect(experienceFor(totals(500, 500, 120_000))).toBeGreaterThan(
      experienceFor(totals(250, 250, 60_000)),
    );
  });

  it('awards nothing at all for a drill with no correct keystrokes', () => {
    expect(experienceFor(totals(0, 0, 0))).toBe(0);
    expect(experienceFor(totals(0, 50, 60_000))).toBe(0);
  });

  it('awards at least the minimum once anything was typed correctly', () => {
    expect(experienceFor(totals(1, 100, 300_000))).toBe(EXPERIENCE_WEIGHTS.minimumAward);
  });

  it('applies a caller’s multiplier, and treats zero as no award', () => {
    const base = experienceFor(totals(250, 250, 60_000));
    expect(experienceFor(totals(250, 250, 60_000), 2)).toBeGreaterThan(base);
    expect(experienceFor(totals(250, 250, 60_000), 0)).toBe(0);
  });

  it('is finite for a zero-length drill', () => {
    const earned = experienceFor(totals(30, 30, 0));
    expect(Number.isFinite(earned)).toBe(true);
    expect(earned).toBeGreaterThan(0);
  });

  it('refuses a nonsensical multiplier or weighting', () => {
    expect(() => experienceFor(totals(10, 10, 1000), -1)).toThrow(RangeError);
    expect(() => experienceFor(totals(10, 10, 1000), Number.NaN)).toThrow(RangeError);
    expect(() =>
      experienceFor(totals(10, 10, 1000), 1, { ...EXPERIENCE_WEIGHTS, paceReference: 0 }),
    ).toThrow(RangeError);
  });
});

describe('the level curve', () => {
  it('is a pure function of experience', () => {
    expect(levelFor(1234)).toEqual(levelFor(1234));
  });

  it('charges the documented cost per level', () => {
    expect(levelCost(1)).toBe(LEVEL_BASE_COST);
    expect(levelCost(1)).toBe(120);
    expect(levelCost(2)).toBe(351);
    expect(levelCost(3)).toBe(659);
    expect(levelCost(10)).toBe(4258);
  });

  it('gets steeper, never flatter', () => {
    for (let level = 2; level <= MAX_LEVEL; level += 1) {
      expect(levelCost(level)).toBeGreaterThan(levelCost(level - 1));
    }
  });

  it('refuses a level off the curve', () => {
    expect(() => levelCost(0)).toThrow(RangeError);
    expect(() => levelCost(MAX_LEVEL + 1)).toThrow(RangeError);
    expect(() => levelCost(1.5)).toThrow(RangeError);
  });

  it('starts at level one with nothing earned', () => {
    expect(levelFor(0)).toEqual({ level: 1, intoLevel: 0, toNext: 120, levelSpan: 120 });
  });

  it('holds the level until the very last point of it', () => {
    expect(levelFor(119)).toEqual({ level: 1, intoLevel: 119, toNext: 1, levelSpan: 120 });
  });

  it('turns over exactly on the boundary', () => {
    expect(levelFor(120)).toEqual({ level: 2, intoLevel: 0, toNext: 351, levelSpan: 351 });
    expect(levelFor(470)).toEqual({ level: 2, intoLevel: 350, toNext: 1, levelSpan: 351 });
    // 120 + 351 = 471 finishes level two.
    expect(levelFor(471)).toEqual({ level: 3, intoLevel: 0, toNext: 659, levelSpan: 659 });
  });

  it('keeps the progress bar consistent at every level', () => {
    for (const experience of [0, 1, 119, 120, 470, 471, 5000, 99_999]) {
      const progress = levelFor(experience);
      expect(progress.intoLevel + progress.toNext).toBe(progress.levelSpan);
      expect(progress.levelSpan).toBe(levelCost(progress.level));
      expect(progress.intoLevel).toBeGreaterThanOrEqual(0);
      expect(progress.intoLevel).toBeLessThanOrEqual(progress.levelSpan);
    }
  });

  it('pins the bar full at the cap instead of rolling into a level that does not exist', () => {
    let toReachCap = 0;
    for (let level = 1; level < MAX_LEVEL; level += 1) toReachCap += levelCost(level);

    const atCap = levelFor(toReachCap);
    expect(atCap.level).toBe(MAX_LEVEL);
    expect(atCap.intoLevel).toBe(0);

    const wellPast = levelFor(toReachCap + levelCost(MAX_LEVEL) * 10);
    expect(wellPast.level).toBe(MAX_LEVEL);
    expect(wellPast.toNext).toBe(0);
    expect(wellPast.intoLevel).toBe(wellPast.levelSpan);
  });

  it('floors a fractional total rather than drifting', () => {
    expect(levelFor(119.9)).toEqual(levelFor(119));
  });

  it('refuses a negative or unreadable total', () => {
    expect(() => levelFor(-1)).toThrow(RangeError);
    expect(() => levelFor(Number.NaN)).toThrow(RangeError);
    expect(() => levelFor(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('the next step', () => {
  function step(overrides: Partial<NextStepInput> = {}): NextStepInput {
    return {
      mode: 'lesson',
      totals: TWO_STAR_RUN,
      stars: 2,
      weakKeys: [],
      lessonName: 'Home row',
      nextLessonName: 'W and G',
      ...overrides,
    };
  }

  it('advances on two stars, and says the ladder stays open', () => {
    const plan = nextStep(step());
    expect(plan.advances).toBe(true);
    expect(plan.label).toBe('Start W and G');
    expect(plan.why).toContain('come back to this lesson from the ladder');
    expect(plan.repairKeys).toEqual([]);
  });

  it('advances on three stars too', () => {
    expect(nextStep(step({ stars: 3 })).advances).toBe(true);
  });

  it('does not advance on one star', () => {
    const plan = nextStep(step({ stars: 1, totals: totals(94, 100, 45_000) }));
    expect(plan.advances).toBe(false);
  });

  it('does not advance off the end of the ladder', () => {
    const plan = nextStep(step({ nextLessonName: null }));
    expect(plan.advances).toBe(false);
    expect(plan.label).toBe('Run Home row again');
    expect(plan.why).toContain('last lesson');
  });

  it('offers a repair drill naming exactly the keys that slipped', () => {
    const plan = nextStep(step({ stars: 1, weakKeys: ['q', 'z', 'x'] }));
    expect(plan.advances).toBe(false);
    expect(plan.label).toBe('Repair drill · Q Z X');
    expect(plan.repairKeys).toEqual(['q', 'z', 'x']);
  });

  it('caps how many weak keys one repair drill takes on', () => {
    const plan = nextStep(step({ stars: 1, weakKeys: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] }));
    expect(plan.repairKeys).toHaveLength(6);
    expect(plan.repairKeys).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('drops whitespace and duplicates from the weak keys instead of showing a blank', () => {
    const plan = nextStep(step({ stars: 1, weakKeys: [' ', 'q', 'q', '\t', 'z'] }));
    expect(plan.repairKeys).toEqual(['q', 'z']);
    expect(plan.label).toBe('Repair drill · Q Z');
  });

  it('refuses an empty string as a weak key', () => {
    expect(() => nextStep(step({ stars: 1, weakKeys: [''] }))).toThrow(RangeError);
  });

  it('asks for pace when accuracy is already there', () => {
    // 96% accuracy, but only 12 wpm.
    const plan = nextStep(step({ stars: 1, totals: totals(48, 50, 48_000) }));
    expect(plan.label).toBe('Run it again for pace');
    expect(plan.why).toMatch(/wpm to go/);
    expect(plan.advances).toBe(false);
  });

  it('asks for accuracy when that is what is missing', () => {
    // 92% accuracy at a decent pace, and no single key to blame.
    const plan = nextStep(step({ stars: 1, totals: totals(92, 100, 30_000) }));
    expect(plan.label).toBe('Run it again for accuracy');
    expect(plan.why).toContain('92%');
    expect(plan.why).toContain('95%');
  });

  it('asks for a full run when the drill was too short to score', () => {
    const plan = nextStep(step({ stars: 0, totals: totals(6, 6, 2000) }));
    expect(plan.label).toBe('Run the drill through');
    expect(plan.why).toContain('20 keystrokes');
  });

  it('sends a clean repair drill back to its lesson', () => {
    const plan = nextStep(step({ mode: 'repair', stars: 0, weakKeys: [] }));
    expect(plan.label).toBe('Back to Home row');
    expect(plan.why).toContain('behaving');
    expect(plan.advances).toBe(false);
  });

  it('repairs again when a repair drill still leaves keys slipping', () => {
    const plan = nextStep(step({ mode: 'repair', stars: 0, weakKeys: ['z'] }));
    expect(plan.label).toBe('Repair drill · Z');
    expect(plan.repairKeys).toEqual(['z']);
  });

  it('keeps a repair drill from advancing the ladder even when it scores well', () => {
    const plan = nextStep(step({ mode: 'repair', stars: 0, totals: totals(49, 50, 20_000) }));
    expect(plan.advances).toBe(false);
  });

  it('keeps a sprint in sprint mode, repairing first if anything slipped', () => {
    expect(nextStep(step({ mode: 'sprint', stars: 0, weakKeys: [] })).label).toBe('Sprint again');
    const withMisses = nextStep(step({ mode: 'sprint', stars: 0, weakKeys: ['p', 'y'] }));
    expect(withMisses.label).toBe('Drill the 2 keys that slipped');
    expect(withMisses.repairKeys).toEqual(['p', 'y']);
    expect(withMisses.advances).toBe(false);
  });

  it('counts one slipped key in the singular', () => {
    const plan = nextStep(step({ mode: 'sprint', stars: 0, weakKeys: ['p'] }));
    expect(plan.label).toBe('Drill the 1 key that slipped');
  });

  it('always gives the UI something to render, for every combination', () => {
    const modes = ['lesson', 'sprint', 'repair'] as const;
    const starCounts = [0, 1, 2, 3] as const;
    for (const mode of modes) {
      for (const stars of starCounts) {
        for (const weakKeys of [[], ['q']]) {
          for (const nextLessonName of [null, 'W and G']) {
            const plan = nextStep(step({ mode, stars, weakKeys, nextLessonName }));
            expect(plan.label.length).toBeGreaterThan(0);
            expect(plan.why.length).toBeGreaterThan(0);
            if (plan.advances) expect(mode).toBe('lesson');
          }
        }
      }
    }
  });

  it('copes with no lesson name at all', () => {
    const plan = nextStep(step({ mode: 'repair', stars: 0, lessonName: null, weakKeys: [] }));
    expect(plan.label).toBe('Back to the lesson');
  });

  it('refuses a star count outside zero to three', () => {
    expect(() => nextStep(step({ stars: 4 as 3 }))).toThrow(RangeError);
    expect(() => nextStep(step({ stars: -1 as 0 }))).toThrow(RangeError);
  });
});

describe('scoring a whole drill', () => {
  it('gives the result card its numbers and its wording in one call', () => {
    const score = scoreDrill({
      mode: 'lesson',
      totals: TWO_STAR_RUN,
      weakKeys: [],
      lessonName: 'Home row',
      nextLessonName: 'W and G',
    });
    expect(score.wordsPerMinute).toBe(19);
    expect(score.accuracy).toBe(0.95);
    expect(score.stars).toBe(2);
    expect(score.experienceGained).toBe(15);
    expect(score.nextStep.advances).toBe(true);
    expect(score.nextStep.label).toBe('Start W and G');
  });

  it('awards no stars for a sprint or a repair drill, however well it went', () => {
    const brilliant = totals(300, 300, 60_000);
    for (const mode of ['sprint', 'repair'] as const) {
      const score = scoreDrill({
        mode,
        totals: brilliant,
        weakKeys: [],
        lessonName: 'Home row',
        nextLessonName: 'W and G',
      });
      expect(score.stars).toBe(0);
      expect(score.nextStep.advances).toBe(false);
      expect(score.experienceGained).toBeGreaterThan(0);
    }
    expect(starsFor(brilliant)).toBe(3);
  });

  it('produces no Infinity and no NaN for an abandoned drill', () => {
    const score = scoreDrill({
      mode: 'lesson',
      totals: totals(0, 0, 0),
      weakKeys: [],
      lessonName: 'Home row',
      nextLessonName: 'W and G',
    });
    expect(score).toMatchObject({
      wordsPerMinute: 0,
      accuracy: 0,
      stars: 0,
      experienceGained: 0,
    });
    for (const value of [score.wordsPerMinute, score.accuracy, score.experienceGained]) {
      expect(Number.isFinite(value)).toBe(true);
    }
    expect(score.nextStep.label.length).toBeGreaterThan(0);
  });

  it('surfaces malformed totals rather than scoring around them', () => {
    expect(() =>
      scoreDrill({
        mode: 'lesson',
        totals: totals(30, 20, 10_000),
        weakKeys: [],
        lessonName: 'Home row',
        nextLessonName: null,
      }),
    ).toThrow(InvalidTotalsError);
  });
});
