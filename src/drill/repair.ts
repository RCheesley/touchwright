/**
 * Repair drills: given the keys that slipped, something that drills exactly
 * those keys and nothing else.
 *
 * `nextStep` in `scoring.ts` decides that a repair drill is what the learner
 * needs and hands over the keys, worded as "a short drill built from those keys,
 * mixed with home row anchors". This module is the other half of that sentence.
 *
 * Three rules, and the whole module is those rules:
 *
 * **Exactly those keys.** Every weak key handed in appears in the text, and
 * nothing outside the weak keys, the anchors and the separator ever does. A
 * repair drill that quietly drops a key is worse than no repair drill: the
 * learner practises and the miss survives. So the number of groups is at least
 * the number of weak keys, whatever length was asked for, and the text is
 * checked against both sets before it is handed out.
 *
 * **Anchors, so it reads like typing.** A bare run of the missed key is mashing,
 * not typing, and it drills the key out of the context a finger actually meets
 * it in. Each group sets the weak key among steady keys, chained through the
 * common bigrams that small alphabet can type, and a real word is used whenever
 * the pool holds one made only of those keys. The anchors default to the front
 * of the lesson's cumulative key set, which is the resting position:
 * `generateLadder` builds the home lesson from `board.homePositions` first, so
 * the earliest keys of `lesson.keys` are the ones the hands are already sitting
 * on. A caller that knows the board may say so instead, through `anchors`.
 *
 * **A caller's bug is not swallowed.** A weak key the lesson cannot type is a
 * fault in whatever selected it, and dropping it silently would hide that while
 * producing a drill that looks fine. It throws, naming the key. So does an empty
 * weak-key list: "repair nothing" is not an ordinary drill, it is a caller that
 * should not have asked.
 *
 * On which keys count as weak: that decision belongs to `summariseKeyStats` in
 * `../stats/keystats.ts`, and `selectWeakKeys` there is the ranked list this
 * function is meant to be fed. In particular `WEAK_KEY_THRESHOLDS.minAttempts`
 * is what stops one miss on a key pressed twice from being called a weakness.
 * Nothing here re-decides that; a key that arrives here is already weak.
 *
 * Seeded, like `text.ts`, and never `Math.random`: a repair drill that goes
 * wrong has to be reproducible from its lesson, its weak keys and its seed.
 *
 * DOM-free by rule, like the rest of the drill layer.
 */

import { topBigrams } from '../ladder/frequency.js';
import type { Lesson } from '../ladder/generate.js';
import { drillAlphabet, drillWordPool } from './text.js';

export interface RepairDrillOptions {
  /**
   * Target length in whitespace separated groups. A repair drill never comes
   * back shorter than the number of weak keys, because every one of them has to
   * appear, so asking for fewer groups than there are keys overshoots.
   */
  readonly words?: number;
  /**
   * Determinism. The same lesson, weak keys and seed always give the same text.
   * Defaults to a hash of the lesson id and the weak keys, so a call without one
   * is reproducible too, and two different sets of weak keys do not come back
   * with the same shape of drill.
   */
  readonly seed?: number;
  /**
   * The steady keys to set the weak ones among. Defaults to the resting keys of
   * the lesson, which is what "home row anchors" means when a lesson is all we
   * have; a caller holding the board and keymap can pass the real home row.
   *
   * Every anchor has to be typable by the lesson and must not itself be weak:
   * anchoring a miss against another miss is not an anchor. An empty list is
   * refused rather than taken to mean "no anchors", because it is far more
   * likely to be a caller whose own selection came back empty.
   */
  readonly anchors?: readonly string[];
}

export class RepairDrillError extends Error {
  override readonly name = 'RepairDrillError';
  constructor(problem: string, options?: ErrorOptions) {
    super(`Cannot build a repair drill: ${problem}`, options);
  }
}

/** Shorter than a lesson drill on purpose: a repair is a detour, not a lesson. */
export const DEFAULT_REPAIR_GROUP_COUNT = 10;

/**
 * How many steady keys a repair drill anchors against. Enough for the groups to
 * vary, few enough that they stay the keys the hands are resting on rather than
 * half the layout.
 */
export const MAX_REPAIR_ANCHORS = 6;

const MIN_GROUP_LENGTH = 3;
const MAX_GROUP_LENGTH = 5;

/** How often a group is a real word rather than a built cluster, when one fits. */
const WORD_BIAS = 0.5;

/** How often a filled slot follows a common bigram rather than choosing freely. */
const CHAIN_BIAS = 0.7;

/** How often a longer group gets the weak key a second time, never adjacent. */
const SECOND_WEAK_CHANCE = 0.4;

/** Only the common pairs make a group read like typing; the tail does not. */
const REPAIR_BIGRAM_LIMIT = 48;

/** One code point, matched rather than counted, so an astral character is one key. */
const ONE_CHARACTER = /^[\s\S]$/u;

const LOWER_CASE_LETTER = /^[a-z]$/u;

/**
 * mulberry32 and FNV-1a, the same pair `text.ts` uses. They are duplicated
 * rather than shared because they are four lines each and exporting a random
 * number generator from the text module would make it part of that module's
 * contract; what matters is that neither module ever reaches for `Math.random`.
 */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

function hashSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x0100_0193) >>> 0;
  }
  return hash >>> 0;
}

function pick<T>(random: () => number, items: readonly T[], what: string): T {
  if (items.length === 0) {
    throw new RepairDrillError(`there is no ${what} to choose from`);
  }
  // Clamped, so a generator that ever returned exactly 1 cannot walk off the end.
  const index = Math.min(Math.floor(random() * items.length), items.length - 1);
  const item = items[index];
  if (item === undefined) {
    throw new RepairDrillError(`choosing a ${what} fell off the end of a list of ${items.length}`);
  }
  return item;
}

function show(key: string): string {
  return JSON.stringify(key);
}

function list(keys: readonly string[]): string {
  return keys.map(show).join(', ');
}

/**
 * Every character this lesson can type. The lesson is the outer boundary: a
 * repair drill may narrow what it uses, never widen it.
 */
function alphabetFor(lesson: Lesson): ReadonlySet<string> {
  try {
    return drillAlphabet(lesson);
  } catch (cause) {
    throw new RepairDrillError(`lesson "${lesson.id}" has no usable key set`, { cause });
  }
}

/**
 * The weak keys, checked against the lesson and deduplicated.
 *
 * Nothing is dropped quietly. A key the lesson cannot type, a key that is not
 * one character, and whitespace are each a bug in whoever selected them, and
 * each throws with the key named. A key listed twice is the one harmless case:
 * it asks for nothing the first mention did not, so it collapses.
 */
function checkWeakKeys(
  lesson: Lesson,
  weakKeys: readonly string[],
  allowed: ReadonlySet<string>,
): readonly string[] {
  const cleaned: string[] = [];

  for (let index = 0; index < weakKeys.length; index += 1) {
    const key = weakKeys[index];
    if (key === undefined) {
      throw new RepairDrillError(`weak keys must have no gaps; index ${index} was missing`);
    }
    if (!ONE_CHARACTER.test(key)) {
      throw new RepairDrillError(`${show(key)} is not a single key, so it cannot be drilled`);
    }
    if (key.trim() === '') {
      throw new RepairDrillError(
        `${show(key)} is whitespace, which cannot be drilled on its own; scoring already strips it from its weak keys, so a caller reaching here with it has a bug`,
      );
    }
    if (!allowed.has(key)) {
      throw new RepairDrillError(
        `lesson "${lesson.id}" cannot type ${show(key)}, so a repair drill for it would be a drill the learner cannot finish`,
      );
    }
    if (!cleaned.includes(key)) cleaned.push(key);
  }

  return cleaned;
}

/**
 * The steady keys a repair drill sets its weak ones among.
 *
 * Lower case letters first, because those are what the word pool and the bigram
 * table are made of; a lesson whose key set holds nothing else anchors against
 * whatever it does have. In ladder order, which puts the resting keys first.
 *
 * Empty is a real answer: a lesson every one of whose keys is weak has nothing
 * steady left to lean on. The drill is then the weak keys alone, which is honest
 * rather than pretty, and it is the only case in which this module produces
 * something that reads like mashing.
 */
export function repairAnchors(
  lesson: Lesson,
  weakKeys: readonly string[],
  options?: RepairDrillOptions,
): readonly string[] {
  const allowed = alphabetFor(lesson);
  const weak = checkWeakKeys(lesson, weakKeys, allowed);
  return chooseAnchors(lesson, weak, allowed, options);
}

function chooseAnchors(
  lesson: Lesson,
  weak: readonly string[],
  allowed: ReadonlySet<string>,
  options: RepairDrillOptions | undefined,
): readonly string[] {
  const given = options?.anchors;
  if (given !== undefined) return checkAnchors(lesson, given, weak, allowed);

  const weakSet = new Set(weak);
  const seen = new Set<string>();
  const letters: string[] = [];
  const others: string[] = [];

  for (const key of lesson.keys) {
    if (weakSet.has(key) || seen.has(key)) continue;
    // A lesson lists its own keys, so anything it lists is typable; the check
    // costs nothing and means a hand-made lesson cannot smuggle a key in.
    if (!allowed.has(key) || key.trim() === '') continue;
    seen.add(key);
    if (LOWER_CASE_LETTER.test(key)) letters.push(key);
    else others.push(key);
  }

  const chosen = letters.length > 0 ? letters : others;
  return chosen.slice(0, MAX_REPAIR_ANCHORS);
}

function checkAnchors(
  lesson: Lesson,
  given: readonly string[],
  weak: readonly string[],
  allowed: ReadonlySet<string>,
): readonly string[] {
  if (given.length === 0) {
    throw new RepairDrillError(
      'an empty anchor list was given; leave anchors out to take the lesson’s resting keys, rather than asking for a drill with nothing to anchor against',
    );
  }

  const weakSet = new Set(weak);
  const cleaned: string[] = [];

  for (let index = 0; index < given.length; index += 1) {
    const anchor = given[index];
    if (anchor === undefined) {
      throw new RepairDrillError(`anchors must have no gaps; index ${index} was missing`);
    }
    if (!ONE_CHARACTER.test(anchor) || anchor.trim() === '') {
      throw new RepairDrillError(
        `${show(anchor)} is not a single typable key, so it cannot anchor`,
      );
    }
    if (!allowed.has(anchor)) {
      throw new RepairDrillError(`lesson "${lesson.id}" cannot type the anchor ${show(anchor)}`);
    }
    if (weakSet.has(anchor)) {
      throw new RepairDrillError(
        `${show(anchor)} is both an anchor and a weak key, and a key that slips cannot steady another one`,
      );
    }
    if (!cleaned.includes(anchor)) cleaned.push(anchor);
  }

  return cleaned;
}

interface Settings {
  readonly groups: number;
  readonly seed: number;
}

function readOptions(
  lesson: Lesson,
  weak: readonly string[],
  options: RepairDrillOptions | undefined,
): Settings {
  const groups = options?.words ?? DEFAULT_REPAIR_GROUP_COUNT;
  if (!Number.isInteger(groups) || groups < 1) {
    throw new RangeError(`words must be a positive integer, got ${JSON.stringify(options?.words)}`);
  }

  const seed = options?.seed ?? hashSeed(`${lesson.id}\u0000${weak.join('')}`);
  if (!Number.isInteger(seed)) {
    throw new RangeError(`seed must be an integer, got ${JSON.stringify(options?.seed)}`);
  }

  return { groups, seed: seed >>> 0 };
}

/**
 * Which key may follow which, over the repair drill's own small alphabet, so a
 * built group follows the pairs English actually uses instead of rattling.
 */
function chainsFor(keys: readonly string[]): ReadonlyMap<string, readonly string[]> {
  const chains = new Map<string, string[]>();
  for (const { bigram } of topBigrams(keys, REPAIR_BIGRAM_LIMIT)) {
    const first = bigram.slice(0, 1);
    const second = bigram.slice(1, 2);
    const followers = chains.get(first);
    if (followers === undefined) chains.set(first, [second]);
    else followers.push(second);
  }
  return chains;
}

/**
 * For each weak key, the words the lesson can type that are made only of the
 * repair drill's own keys and use that one. Usually a handful, often none: the
 * built clusters are the fallback and the common case.
 */
function wordsByWeakKey(
  lesson: Lesson,
  weak: readonly string[],
  anchors: readonly string[],
): ReadonlyMap<string, readonly string[]> {
  const usable = new Set([...weak, ...anchors]);
  const pool = drillWordPool(lesson).filter((word) =>
    Array.from(word).every((character) => usable.has(character)),
  );

  const byKey = new Map<string, readonly string[]>();
  for (const key of weak) {
    byKey.set(
      key,
      pool.filter((word) => word.includes(key)),
    );
  }
  return byKey;
}

/**
 * One group: the weak key set among the anchors, or a real word using it.
 *
 * The weak key lands in a random slot rather than always at the front, because a
 * finger has to find it mid-word as well as from rest, and a second placement is
 * never adjacent to the first: drilling `pp` trains a doubled key, which is a
 * different skill from the one that slipped.
 */
function buildGroup(
  random: () => number,
  weakKey: string,
  fill: readonly string[],
  chains: ReadonlyMap<string, readonly string[]>,
  words: readonly string[],
): string {
  if (words.length > 0 && random() < WORD_BIAS) return pick(random, words, 'word');

  const length =
    MIN_GROUP_LENGTH + Math.floor(random() * (MAX_GROUP_LENGTH - MIN_GROUP_LENGTH + 1));
  const slots: (string | null)[] = Array.from({ length }, () => null);

  const first = Math.min(Math.floor(random() * length), length - 1);
  slots[first] = weakKey;

  if (length >= 4 && random() < SECOND_WEAK_CHANCE) {
    const offset = 2 + Math.floor(random() * (length - 2));
    const second = (first + offset) % length;
    if (Math.abs(second - first) > 1) slots[second] = weakKey;
  }

  const out: string[] = [];
  for (let index = 0; index < length; index += 1) {
    const slot = slots[index];
    if (slot !== null && slot !== undefined) {
      out.push(slot);
      continue;
    }

    const previous = out.at(-1);
    const followers = previous === undefined ? undefined : chains.get(previous);
    const usable = followers?.filter((follower) => fill.includes(follower)) ?? [];
    const chained = usable.length > 0 && random() < CHAIN_BIAS;
    out.push(chained ? pick(random, usable, 'anchor') : pick(random, fill, 'anchor'));
  }

  return out.join('');
}

/**
 * Check the text before handing it out, the way `text.ts` does. Everything above
 * is meant to make each of these impossible; they are here because a repair
 * drill that quietly omitted the key it was built for would look perfectly fine
 * and teach nothing.
 */
function assertRepairText(
  text: string,
  lesson: Lesson,
  allowed: ReadonlySet<string>,
  weak: readonly string[],
  anchors: readonly string[],
  separator: string,
): void {
  if (text === '') {
    throw new RepairDrillError(
      `lesson "${lesson.id}" produced no text for ${list(weak)}, which admits nothing to drill`,
    );
  }
  if (text.trim() !== text || /\s\s/u.test(text)) {
    throw new RepairDrillError(
      `lesson "${lesson.id}" produced text with padding or doubled spaces: ${show(text)}`,
    );
  }

  const permitted = new Set<string>([...weak, ...anchors]);
  if (separator !== '') permitted.add(separator);

  for (const character of text) {
    if (!allowed.has(character)) {
      throw new RepairDrillError(
        `lesson "${lesson.id}" cannot type ${show(character)}, which its repair text contains`,
      );
    }
    if (!permitted.has(character)) {
      throw new RepairDrillError(
        `the repair text contains ${show(character)}, which is neither a weak key nor an anchor`,
      );
    }
  }

  const missing = weak.filter((key) => !text.includes(key));
  if (missing.length > 0) {
    throw new RepairDrillError(
      `the repair text never uses ${list(missing)}, and a repair drill has to drill every key it was given`,
    );
  }
}

/**
 * A drill built from exactly these weak keys, set among the lesson's steady
 * ones, and the same every time for the same seed.
 *
 * Throws rather than returning something unusable. An empty string would reach
 * the engine as a drill that is already finished; a weak key the lesson cannot
 * type is a fault in whoever selected it; and a drill missing one of the keys it
 * was built for is the bug this whole feature exists to prevent.
 */
export function generateRepairText(
  lesson: Lesson,
  weakKeys: readonly string[],
  options?: RepairDrillOptions,
): string {
  if (weakKeys.length === 0) {
    throw new RepairDrillError(
      `lesson "${lesson.id}" was asked to repair nothing; a repair drill targets the keys that slipped, and a drill with no target is an ordinary drill`,
    );
  }

  const allowed = alphabetFor(lesson);
  const weak = checkWeakKeys(lesson, weakKeys, allowed);
  const anchors = chooseAnchors(lesson, weak, allowed, options);
  const { groups: target, seed } = readOptions(lesson, weak, options);

  const random = createRandom(seed);
  const separator = allowed.has(' ') ? ' ' : '';
  const chains = chainsFor([...anchors, ...weak]);
  const words = wordsByWeakKey(lesson, weak, anchors);
  // Anchors are empty only when every key the lesson knows is weak, and then the
  // weak keys anchor each other. Never an empty alphabet: `weak` is checked to
  // be non-empty above.
  const fill = anchors.length > 0 ? anchors : weak;

  // Every weak key gets a group of its own before any key gets a second, so a
  // short drill can never leave one of them undrilled.
  const count = Math.max(target, weak.length);
  const built: string[] = [];

  try {
    for (let index = 0; index < count; index += 1) {
      const key = weak[index % weak.length];
      if (key === undefined) {
        throw new RepairDrillError(`weak key ${index % weak.length} went missing mid-build`);
      }
      built.push(buildGroup(random, key, fill, chains, words.get(key) ?? []));
    }
  } catch (cause) {
    throw new RepairDrillError(`lesson "${lesson.id}" admits no repair drill for ${list(weak)}`, {
      cause,
    });
  }

  const text = built.join(separator);
  assertRepairText(text, lesson, allowed, weak, anchors, separator);
  return text;
}
