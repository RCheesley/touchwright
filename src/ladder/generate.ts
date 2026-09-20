/**
 * Build a lesson ladder from a parsed keymap and the board it was written for.
 *
 * This is the piece the project is named for: the lessons come from the layout in
 * front of the learner rather than from someone hand writing a ladder per layout.
 * Nothing here knows about Maltron, about the Glove80, or about any particular
 * character. Everything is decided by two inputs:
 *
 *  - the board, which knows the finger, the row and the reach of every position;
 *  - English frequency data, which knows how much each key is worth learning.
 *
 * The rules, in the order they apply:
 *
 *  1. The keys the fingers already rest on come first, as one lesson. The space
 *     the board recommends joins them, because a word drill needs a separator
 *     from the very first lesson.
 *  2. Letters come next, most frequent first, because that is what makes the
 *     earliest lessons able to drill real words.
 *  3. A lesson adds two keys. Its second key is chosen from the next few by
 *     frequency — never from further down the list, so a rare key is never
 *     dragged forward — preferring the key that tells the same story as the
 *     first: the same finger on the other hand, then the same hand in the same
 *     row, then the same row, then the same finger in another row. A thumb key
 *     has no row and no column, so it can only pair with another thumb key,
 *     which is why a layout with one letter on a thumb teaches it alone.
 *  4. When three or fewer letters are left they become one final lesson. Three
 *     rare keys in one lesson cost a learner less than three lessons do, and it
 *     means no lesson ever introduces a single rare key on its own.
 *  5. Punctuation follows the alphabet, because punctuation is only drillable
 *     once the text can be sentences rather than word lists. The punctuation
 *     English prose uses comes as one lesson; everything else the layout binds
 *     comes as one more, ordered by how hard it is to reach, so that the last
 *     lesson's key set really is every character the layout binds.
 *  6. Capitals and then full prose are stages over that key set. They add no
 *     keys. Capitals appear only if the layout binds a shift and something to
 *     shift.
 *
 * Determinism is a requirement, not an accident: every ordering falls back
 * through frequency, then bigram weight, then reach effort, then code point, so
 * the same keymap and board always produce the same ladder. There is no
 * randomness here and so nothing to seed.
 *
 * Where this lands against the hand authored ladder in the prototype, and where
 * it deliberately does not, is written down in docs/ladder.md.
 */

import {
  describeKey,
  indexKeys,
  type BoardDefinition,
  type ColumnKey,
  type ColumnRow,
  type Finger,
  type KeyPosition,
  type Reach,
  type ThumbKey,
} from '../board/types.js';
import type { Keymap } from '../keymap/types.js';
import { letterFrequency, pairingWeight, prosePunctuationRank } from './frequency.js';

export interface Lesson {
  readonly id: string;
  readonly name: string;
  readonly blurb: string;
  /** New this lesson. Empty for a stage over an existing key set. */
  readonly addedKeys: readonly string[];
  /** Cumulative: everything unlocked up to and including this lesson. */
  readonly keys: readonly string[];
  readonly stage: 'keys' | 'capitals' | 'prose';
}

export interface LadderOptions {
  /**
   * How far down the frequency list a lesson may look for its second key.
   * Smaller keeps lessons strictly in frequency order; larger lets a lesson
   * reach a little further for a key that tells the same story. Two to five all
   * produce the same ladder for the reference layout, which is pinned by test.
   */
  readonly pairingWindow?: number;
}

export class LadderError extends Error {
  override readonly name = 'LadderError';
  constructor(problem: string, options?: ErrorOptions) {
    super(`Cannot build a lesson ladder: ${problem}`, options);
  }
}

const DEFAULT_PAIRING_WINDOW = 3;

/** At or below this many keys left, the remainder becomes one final lesson. */
const TAIL_GROUP_SIZE = 3;

/**
 * Relative effort of each digit, strongest first. Used for tie breaks, for
 * ordering the keys prose never uses, and for nothing else: frequency decides
 * the ladder, effort only settles what frequency cannot.
 */
const FINGER_EFFORT: Readonly<Record<Finger, number>> = {
  thumb: 0,
  index: 1,
  middle: 2,
  ring: 3,
  pinky: 4,
};

/** A reach is a sideways stretch out of the finger's own column. */
const REACH_EFFORT: Readonly<Record<Reach, number>> = { natural: 0, inner: 1, outer: 2 };

/** Reaching down is conventionally held to be worse than reaching up by the same distance. */
const DOWNWARD_ROW_EFFORT = 0.25;

/** The reference layout puts its thumb letter on the lower arc, which is the natural sweep. */
const THUMB_ARC_EFFORT: Readonly<Record<'upper' | 'lower', number>> = { lower: 0, upper: 0.5 };

/** How a row reads in a lesson name, relative to the home row. */
const ROW_PHRASE: Readonly<Record<ColumnRow, string>> = {
  home: 'on the home row',
  upper: 'up',
  lower: 'down',
  number: 'on the number row',
  bottom: 'on the bottom row',
  function: 'on the function row',
};

/**
 * Lesson ids are used as storage field names for stars and progress, so they are
 * restricted to characters that are legal everywhere. Regression 7 was exactly
 * this mistake made with per-key statistics: a full stop or a space in a field
 * name failed silently in a real store.
 */
const SAFE_ID = /^[a-z0-9][a-z0-9-]*$/;

/**
 * How hard a key is to reach, in arbitrary units that are only ever compared
 * with each other.
 */
export function keyEffort(key: KeyPosition): number {
  if (key.kind === 'thumb') {
    return FINGER_EFFORT.thumb + THUMB_ARC_EFFORT[key.arc];
  }
  const rows = Math.abs(key.rowOffset) + (key.rowOffset > 0 ? DOWNWARD_ROW_EFFORT : 0);
  return FINGER_EFFORT[key.finger] + REACH_EFFORT[key.reach] + rows;
}

type CharacterClass = 'letter' | 'punctuation' | 'other';

interface Candidate {
  readonly character: string;
  readonly position: number;
  readonly key: KeyPosition;
  /** Percentage of English prose letters. Absent for anything that is not a letter English uses. */
  readonly frequency: number | undefined;
  /** Zero is the most used mark. Absent for anything prose does not punctuate with. */
  readonly punctuationRank: number | undefined;
  readonly effort: number;
  readonly characterClass: CharacterClass;
}

interface Group {
  readonly keys: readonly Candidate[];
  /** True for the final group of a run, which absorbs whatever is left. */
  readonly tail: boolean;
  readonly characterClass: CharacterClass;
}

function classify(character: string): CharacterClass {
  if (/\p{L}/u.test(character)) return 'letter';
  return prosePunctuationRank(character) === undefined ? 'other' : 'punctuation';
}

/**
 * Whether two keys can share a lesson, and how well. Lower is a stronger story;
 * `null` means they have nothing in common worth putting in a blurb.
 *
 * A thumb key has neither a row nor a column, so it is only ever comparable with
 * another thumb key. That is a fact of the board's own type, not a special case.
 */
function pairingTier(seed: KeyPosition, candidate: KeyPosition): number | null {
  if (seed.index === candidate.index) return null;

  if (seed.kind === 'thumb') {
    if (candidate.kind !== 'thumb') return null;
    if (seed.arc === candidate.arc && seed.hand !== candidate.hand) return 0;
    return seed.hand === candidate.hand ? 1 : 2;
  }
  if (candidate.kind !== 'column') return null;

  const sameRow = seed.row === candidate.row;
  const sameFinger = seed.finger === candidate.finger;
  const sameReach = seed.reach === candidate.reach;
  const sameHand = seed.hand === candidate.hand;

  // The same key on the other hand: one movement, learned twice.
  if (sameFinger && sameReach && sameRow && !sameHand) return 0;
  // One hand's shape in one row.
  if (sameHand && sameRow) return 1;
  // The same row, so the same distance from home on both hands.
  if (sameRow) return 2;
  // One finger's column, up and down.
  if (sameHand && sameFinger && sameReach) return 3;
  return null;
}

function compareByFrequency(a: Candidate, b: Candidate, known: readonly string[]): number {
  if (a.frequency !== b.frequency) {
    if (a.frequency === undefined) return 1;
    if (b.frequency === undefined) return -1;
    return b.frequency - a.frequency;
  }
  // Equally common letters: prefer the one that makes more common pairs with
  // what the learner can already type, so the drill text gains more from it.
  const weightA = pairingWeight(a.character, known);
  const weightB = pairingWeight(b.character, known);
  if (weightA !== weightB) return weightB - weightA;
  return compareByEffort(a, b);
}

function compareByEffort(a: Candidate, b: Candidate): number {
  if (a.effort !== b.effort) return a.effort - b.effort;
  if (a.position !== b.position) return a.position - b.position;
  // Code point order, not locale order, because the ladder must not vary by host.
  return a.character < b.character ? -1 : a.character > b.character ? 1 : 0;
}

function compareByPunctuation(a: Candidate, b: Candidate): number {
  const rankA = a.punctuationRank;
  const rankB = b.punctuationRank;
  if (rankA === undefined || rankB === undefined) return compareByEffort(a, b);
  if (rankA !== rankB) return rankA - rankB;
  return compareByEffort(a, b);
}

/**
 * Walk a frequency-ordered run, taking the most useful key left and giving it the
 * best partner within the window.
 */
function groupInPairs(
  sorted: readonly Candidate[],
  characterClass: CharacterClass,
  window: number,
): readonly Group[] {
  const remaining = [...sorted];
  const groups: Group[] = [];

  while (remaining.length > 0) {
    if (remaining.length <= TAIL_GROUP_SIZE) {
      groups.push({ keys: remaining.splice(0, remaining.length), tail: true, characterClass });
      break;
    }

    const seed = remaining.shift();
    if (seed === undefined) {
      throw new LadderError('a non-empty list of keys yielded nothing to group');
    }

    let bestIndex = -1;
    let bestTier = Number.POSITIVE_INFINITY;
    const reach = Math.min(window, remaining.length);
    for (let index = 0; index < reach; index += 1) {
      const candidate = remaining[index];
      if (candidate === undefined) {
        throw new LadderError(`no key at index ${index} of ${remaining.length} while pairing`);
      }
      const tier = pairingTier(seed.key, candidate.key);
      // Strictly lower keeps the more frequent candidate when two tie.
      if (tier !== null && tier < bestTier) {
        bestTier = tier;
        bestIndex = index;
      }
    }

    if (bestIndex === -1) {
      groups.push({ keys: [seed], tail: false, characterClass });
      continue;
    }

    const partner = remaining.splice(bestIndex, 1)[0];
    if (partner === undefined) {
      throw new LadderError(`the chosen partner at index ${bestIndex} was not there to remove`);
    }
    groups.push({ keys: [seed, partner], tail: false, characterClass });
  }

  return groups;
}

function capitalise(text: string): string {
  const first = text.slice(0, 1);
  return first.toUpperCase() + text.slice(1);
}

/** "a", "a and b", "a, b and c" — so a name reads as a sentence fragment. */
function joinWords(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1] ?? ''}`;
}

/** How a key reads inside a blurb: a printable character, or a name for a space. */
function showCharacter(character: string): string {
  return character === ' ' ? 'Space' : character.toUpperCase();
}

function uniqueInOrder<T>(values: readonly T[]): readonly T[] {
  return [...new Set(values)];
}

function nameGroup(group: Group, isFirstOfClass: boolean): string {
  const { keys } = group;
  const columnKeys: ColumnKey[] = [];
  const thumbKeys: ThumbKey[] = [];
  for (const candidate of keys) {
    if (candidate.key.kind === 'column') columnKeys.push(candidate.key);
    else thumbKeys.push(candidate.key);
  }

  if (thumbKeys.length === keys.length && thumbKeys.length > 0) {
    const hands = uniqueInOrder(thumbKeys.map((key) => key.hand));
    const hand = hands[0];
    return hands.length === 1 && hand !== undefined ? `The ${hand} thumb` : 'The thumbs';
  }

  if (group.characterClass === 'punctuation') return 'Punctuation';

  if (group.characterClass === 'other') {
    const digits = keys.filter((candidate) => /\p{Nd}/u.test(candidate.character)).length;
    if (digits === keys.length) return 'The numbers';
    return digits > 0 ? 'Numbers and symbols' : 'Symbols';
  }

  // The rarest letters, swept up together. Only worth calling outliers if there
  // were earlier lessons for them to be outlying from.
  if (group.tail && !isFirstOfClass) return 'The outliers';

  if (columnKeys.length === keys.length && columnKeys.length > 0) {
    const rows = uniqueInOrder(columnKeys.map((key) => key.row));
    const fingers = uniqueInOrder(columnKeys.map((key) => key.finger));
    const reaches = uniqueInOrder(columnKeys.map((key) => key.reach));
    const row = rows[0];
    const reach = reaches[0];
    const finger = fingers[0];

    if (rows.length === 1 && row !== undefined) {
      if (
        fingers.length === 1 &&
        reaches.length === 1 &&
        finger !== undefined &&
        reach !== undefined &&
        reach !== 'natural'
      ) {
        // "Inner index": the stretch is the story, not the row.
        return `${capitalise(reach)} ${finger}`;
      }
      return `${capitalise(joinWords(fingers))} ${ROW_PHRASE[row]}`;
    }
  }

  return joinWords(keys.map((candidate) => showCharacter(candidate.character)));
}

function describeKeys(keys: readonly Candidate[]): string {
  return keys
    .map((candidate) => `${showCharacter(candidate.character)}: ${describeKey(candidate.key)}.`)
    .join(' ');
}

function blurbForGroup(group: Group): string {
  const detail = describeKeys(group.keys);
  switch (group.characterClass) {
    case 'punctuation':
      return `Punctuation, so the drills can be sentences rather than word lists. ${detail}`;
    case 'other':
      return `The keys English prose does not use, so that nothing the layout binds is left untaught. ${detail}`;
    case 'letter':
      return group.tail
        ? `The rarest letters the layout binds, so the awkward reaches cost you least. ${detail}`
        : detail;
  }
}

function preferredId(group: Group): string {
  if (group.keys.every((candidate) => candidate.key.kind === 'thumb') && group.keys.length > 0) {
    return 'thumb';
  }
  const joined = group.keys.map((candidate) => candidate.character).join('');
  if (SAFE_ID.test(joined)) return joined;
  if (group.characterClass === 'punctuation') return 'punct';
  if (group.characterClass === 'other') return 'symbols';
  return 'keys';
}

function claimId(preferred: string, used: Set<string>): string {
  const base = SAFE_ID.test(preferred) ? preferred : 'lesson';
  let id = base;
  let suffix = 2;
  while (used.has(id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  used.add(id);
  return id;
}

function readOptions(options: LadderOptions | undefined): { pairingWindow: number } {
  const pairingWindow = options?.pairingWindow ?? DEFAULT_PAIRING_WINDOW;
  if (!Number.isInteger(pairingWindow) || pairingWindow < 1) {
    throw new LadderError(
      `pairingWindow must be an integer of at least 1, got ${String(pairingWindow)}`,
    );
  }
  return { pairingWindow };
}

/**
 * Everything the layout binds on its base layer, once each, with the geometry
 * and the frequency data already attached.
 *
 * The keymap is the boundary here and it is not trusted: a character recorded as
 * typed but with no position, or at a position this board does not define, is a
 * contradiction that would otherwise surface as a lesson teaching a key that is
 * not there.
 */
function collectCandidates(keymap: Keymap, board: BoardDefinition): readonly Candidate[] {
  const byPosition = indexKeys(board);
  const characters = new Set(keymap.typedKeys.map((typed) => typed.character));
  if (characters.size === 0) {
    throw new LadderError(
      `the layout "${keymap.title}" binds no characters on its base layer, so there is nothing to teach`,
    );
  }

  const candidates: Candidate[] = [];
  for (const character of characters) {
    const position = keymap.charToPosition.get(character);
    if (position === undefined) {
      throw new LadderError(
        `the keymap records ${JSON.stringify(character)} as typed but gives it no position`,
      );
    }
    const key = byPosition.get(position);
    if (key === undefined) {
      throw new LadderError(
        `${JSON.stringify(character)} is bound at position ${position}, which a ${board.name} does not have`,
      );
    }
    candidates.push({
      character,
      position,
      key,
      frequency: letterFrequency(character),
      punctuationRank: prosePunctuationRank(character),
      effort: keyEffort(key),
      characterClass: classify(character),
    });
  }
  return candidates;
}

function homeLesson(
  candidates: readonly Candidate[],
  board: BoardDefinition,
  keymap: Keymap,
): { readonly keys: readonly Candidate[]; readonly blurb: string } | undefined {
  const homePositions = new Set(board.homePositions);
  const resting = candidates
    .filter((candidate) => homePositions.has(candidate.position))
    .sort((a, b) => a.position - b.position);

  // The space is a separator before it is a key: a word drill needs it in the
  // first lesson, whichever thumb the board says to use for it.
  const space = candidates.find((candidate) => candidate.character === ' ');
  const keys = space === undefined || resting.includes(space) ? resting : [...resting, space];
  if (keys.length === 0) return undefined;

  const left = resting
    .filter((candidate) => candidate.key.hand === 'left')
    .map((candidate) => candidate.character.toUpperCase())
    .join('');
  const right = resting
    .filter((candidate) => candidate.key.hand === 'right')
    .map((candidate) => candidate.character.toUpperCase())
    .join('');

  const parts = ['Both hands resting.'];
  if (left !== '') parts.push(`${left} on the left.`);
  if (right !== '') parts.push(`${right} on the right.`);
  if (space !== undefined) {
    parts.push(
      `Space is the ${describeKey(space.key)}, and you need it from the first word onwards.`,
    );
  }
  if (keymap.duplicates.has(' ')) {
    parts.push('This board binds more than one space; this is the one to use.');
  }

  return { keys, blurb: parts.join(' ') };
}

/**
 * Build the ordered ladder. Same keymap and board in, same ladder out, always.
 */
export function generateLadder(
  keymap: Keymap,
  board: BoardDefinition,
  options?: LadderOptions,
): readonly Lesson[] {
  const { pairingWindow } = readOptions(options);

  if (keymap.boardId !== board.id) {
    throw new LadderError(
      `the keymap is for "${keymap.boardId}" but the board given is "${board.id}"`,
    );
  }

  const candidates = collectCandidates(keymap, board);
  const lessons: Lesson[] = [];
  const usedIds = new Set<string>();
  const cumulative: string[] = [];

  const home = homeLesson(candidates, board, keymap);
  const taught = new Set<string>(home?.keys.map((candidate) => candidate.character) ?? []);

  if (home !== undefined) {
    const addedKeys = home.keys.map((candidate) => candidate.character);
    cumulative.push(...addedKeys);
    lessons.push({
      id: claimId('home', usedIds),
      name: 'Home keys',
      blurb: home.blurb,
      addedKeys,
      keys: [...cumulative],
      stage: 'keys',
    });
  }

  const outstanding = candidates.filter((candidate) => !taught.has(candidate.character));
  const known = [...cumulative];

  const letters = outstanding
    .filter((candidate) => candidate.characterClass === 'letter')
    .sort((a, b) => compareByFrequency(a, b, known));
  const punctuation = outstanding
    .filter((candidate) => candidate.characterClass === 'punctuation')
    .sort(compareByPunctuation);
  const others = outstanding
    .filter((candidate) => candidate.characterClass === 'other')
    .sort(compareByEffort);

  const groups: Group[] = [...groupInPairs(letters, 'letter', pairingWindow)];
  // Punctuation and the keys prose never uses are rare enough that splitting
  // them into pairs would add lessons without adding practice.
  if (punctuation.length > 0) {
    groups.push({ keys: punctuation, tail: true, characterClass: 'punctuation' });
  }
  if (others.length > 0) {
    groups.push({ keys: others, tail: true, characterClass: 'other' });
  }

  const firstOfClass = new Set<CharacterClass>();
  for (const group of groups) {
    const isFirstOfClass = !firstOfClass.has(group.characterClass);
    firstOfClass.add(group.characterClass);

    const addedKeys = group.keys.map((candidate) => candidate.character);
    if (addedKeys.length === 0) {
      throw new LadderError('a lesson was built with no keys to add');
    }
    cumulative.push(...addedKeys);
    lessons.push({
      id: claimId(preferredId(group), usedIds),
      name: nameGroup(group, isFirstOfClass),
      blurb: blurbForGroup(group),
      addedKeys,
      keys: [...cumulative],
      stage: 'keys',
    });
  }

  const unlocked = new Set(cumulative);
  const shiftBound =
    keymap.shiftPositions.left.length > 0 || keymap.shiftPositions.right.length > 0;
  const shiftable = [...keymap.shiftPairs.values()].some((base) => unlocked.has(base));

  if (shiftBound && shiftable) {
    const byPosition = indexKeys(board);
    const left = byPosition.get(board.recommendedShift.left);
    const right = byPosition.get(board.recommendedShift.right);
    if (left === undefined || right === undefined) {
      throw new LadderError(
        `the board recommends shift at positions ${board.recommendedShift.left} and ${board.recommendedShift.right}, and one of them is not defined`,
      );
    }
    lessons.push({
      id: claimId('caps', usedIds),
      name: 'Capitals',
      blurb:
        'Shift with the opposite hand, never the hand holding the letter. ' +
        `Left shift is the ${describeKey(left)}; right shift is the ${describeKey(right)}.`,
      addedKeys: [],
      keys: [...cumulative],
      stage: 'capitals',
    });
  }

  lessons.push({
    id: claimId('prose', usedIds),
    name: 'Full prose',
    blurb: `Real sentences, with all ${cumulative.length} keys of this layout in play.`,
    addedKeys: [],
    keys: [...cumulative],
    stage: 'prose',
  });

  assertLadder(lessons, candidates);
  return lessons;
}

/**
 * Check the ladder against its own promises before handing it out. A ladder that
 * teaches a key the layout does not bind, or that quietly drops one, would show
 * up much later as a drill nobody can complete.
 */
function assertLadder(lessons: readonly Lesson[], candidates: readonly Candidate[]): void {
  if (lessons.length === 0) {
    throw new LadderError('the ladder came out empty');
  }

  const bound = new Set(candidates.map((candidate) => candidate.character));
  const seen = new Set<string>();
  const ids = new Set<string>();

  for (const lesson of lessons) {
    if (!SAFE_ID.test(lesson.id)) {
      throw new LadderError(
        `lesson id ${JSON.stringify(lesson.id)} is not safe to use as a storage field name`,
      );
    }
    if (ids.has(lesson.id)) {
      throw new LadderError(`two lessons share the id ${JSON.stringify(lesson.id)}`);
    }
    ids.add(lesson.id);

    for (const character of lesson.addedKeys) {
      if (!bound.has(character)) {
        throw new LadderError(
          `lesson "${lesson.id}" adds ${JSON.stringify(character)}, which the layout does not bind`,
        );
      }
      if (seen.has(character)) {
        throw new LadderError(
          `lesson "${lesson.id}" adds ${JSON.stringify(character)} a second time`,
        );
      }
      seen.add(character);
    }

    if (lesson.keys.length !== seen.size) {
      throw new LadderError(
        `lesson "${lesson.id}" carries ${lesson.keys.length} cumulative keys but ${seen.size} have been taught`,
      );
    }
    if (lesson.stage !== 'keys' && lesson.addedKeys.length > 0) {
      throw new LadderError(`lesson "${lesson.id}" is a ${lesson.stage} stage but adds keys`);
    }
  }

  const missing = [...bound].filter((character) => !seen.has(character));
  if (missing.length > 0) {
    throw new LadderError(
      `the layout binds ${missing.map((character) => JSON.stringify(character)).join(', ')}, which no lesson teaches`,
    );
  }
}
