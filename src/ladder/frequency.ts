/**
 * English frequency data, and the small amount of arithmetic the ladder does
 * with it.
 *
 * Three separate things live here, because they have three different levels of
 * confidence and the ladder leans on them differently:
 *
 *  - `LETTER_FREQUENCY` is measured data with a citable source. The ladder's
 *    ordering is driven by it.
 *  - `BIGRAM_FREQUENCY` is measured data rounded to two decimals, and it is a
 *    truncated table: only the common pairs are listed. It is used for tie
 *    breaks and for choosing drill clusters, never as a total.
 *  - `PROSE_PUNCTUATION` is editorial, not measured: an ordered list of the
 *    punctuation English prose actually uses, most used first. It says which
 *    non-letter keys belong in a punctuation lesson and in what order. There is
 *    no pretence of decimal places here, because there is no source for them.
 *
 * A lookup returns `undefined` for a character that is not in a table, and no
 * table contains a zero. Absent means "English prose does not use this", which
 * is a different statement from "it is used, vanishingly rarely", and the ladder
 * treats the two differently. A malformed argument throws rather than being
 * reported as absent.
 *
 * Sources:
 *   Lewand, R.E. (2000) _Cryptological Mathematics_. Washington, DC: The
 *   Mathematical Association of America. (Letter frequencies.)
 *   Norvig, P. (2013) _English Letter Frequency Counts: Mayzner Revisited_.
 *   Available at <https://norvig.com/mayzner.html> (Accessed 20 September 2026).
 *   (Bigram frequencies, rounded to two decimals.)
 */

/** Percentage of letters in English prose. Sums to about 100. */
export const LETTER_FREQUENCY: Readonly<Record<string, number>> = {
  a: 8.167,
  b: 1.492,
  c: 2.782,
  d: 4.253,
  e: 12.702,
  f: 2.228,
  g: 2.015,
  h: 6.094,
  i: 6.966,
  j: 0.153,
  k: 0.772,
  l: 4.025,
  m: 2.406,
  n: 6.749,
  o: 7.507,
  p: 1.929,
  q: 0.095,
  r: 5.987,
  s: 6.327,
  t: 9.056,
  u: 2.758,
  v: 0.978,
  w: 2.36,
  x: 0.15,
  y: 1.974,
  z: 0.074,
};

/**
 * Percentage of letter pairs in English prose, common pairs only.
 *
 * Deliberately truncated: a pair that is absent is rare, not impossible, so a
 * sum over this table is a lower bound and is only ever compared against another
 * sum over the same table. Values are rounded, so nothing should depend on the
 * third decimal of any one of them.
 */
export const BIGRAM_FREQUENCY: Readonly<Record<string, number>> = {
  th: 3.56,
  he: 3.07,
  in: 2.43,
  er: 2.05,
  an: 1.99,
  re: 1.85,
  on: 1.76,
  at: 1.49,
  en: 1.45,
  nd: 1.35,
  ti: 1.34,
  es: 1.34,
  or: 1.28,
  te: 1.2,
  of: 1.17,
  ed: 1.17,
  is: 1.13,
  it: 1.12,
  al: 1.09,
  ar: 1.07,
  st: 1.05,
  to: 1.04,
  nt: 1.04,
  ng: 0.95,
  se: 0.93,
  ha: 0.93,
  as: 0.87,
  ou: 0.87,
  io: 0.83,
  le: 0.83,
  ve: 0.83,
  co: 0.79,
  me: 0.79,
  de: 0.76,
  hi: 0.76,
  ri: 0.73,
  ro: 0.73,
  ic: 0.7,
  ne: 0.69,
  ea: 0.69,
  ra: 0.69,
  ce: 0.65,
  li: 0.62,
  ch: 0.6,
  ll: 0.58,
  be: 0.58,
  ma: 0.57,
  si: 0.55,
  om: 0.55,
  ur: 0.54,
  ca: 0.53,
  el: 0.52,
  ta: 0.52,
  la: 0.52,
  ns: 0.51,
  di: 0.5,
  fo: 0.49,
  ho: 0.46,
  pe: 0.45,
  ec: 0.45,
  pr: 0.45,
  no: 0.44,
  ct: 0.44,
  us: 0.43,
  ac: 0.43,
  ot: 0.43,
  il: 0.43,
  tr: 0.43,
  ly: 0.42,
  nc: 0.41,
  et: 0.41,
  ut: 0.4,
  ss: 0.4,
  so: 0.4,
  rs: 0.4,
  un: 0.39,
  lo: 0.39,
  wa: 0.39,
  ge: 0.39,
  ie: 0.38,
  wh: 0.38,
  ee: 0.38,
  wi: 0.37,
  em: 0.37,
  ad: 0.36,
  ol: 0.36,
  rt: 0.36,
  po: 0.36,
  we: 0.36,
  na: 0.35,
  ul: 0.35,
  ni: 0.34,
  ts: 0.34,
  mo: 0.34,
  ow: 0.33,
  pa: 0.32,
  im: 0.32,
  mi: 0.32,
  ai: 0.32,
  sh: 0.31,
  ir: 0.31,
  su: 0.31,
  id: 0.3,
  os: 0.3,
  iv: 0.3,
  ia: 0.3,
  am: 0.29,
  fi: 0.29,
  ci: 0.28,
  vi: 0.27,
  pl: 0.26,
  ig: 0.26,
  tu: 0.25,
  ev: 0.25,
  ld: 0.25,
  ry: 0.25,
};

/**
 * The punctuation English prose uses, most used first.
 *
 * Editorial, and openly so: full stop and comma dominate, then the apostrophe
 * and the hyphen, then the marks that end or join clauses, then the rest. It is
 * a rank, not a measurement, which is why it is a list and not a table of
 * numbers. Only the relative order matters, and only among non-letter keys.
 *
 * It names characters, not keys, so it covers marks a layout may bind unshifted
 * even though this project's reference locale shifts them.
 */
export const PROSE_PUNCTUATION: readonly string[] = [
  '.',
  ',',
  "'",
  '-',
  ';',
  ':',
  '?',
  '!',
  '"',
  '(',
  ')',
  '/',
];

export class FrequencyDataError extends Error {
  override readonly name = 'FrequencyDataError';
}

/**
 * One code point, and two. Matched rather than counted so that an astral
 * character counts as one character rather than two UTF-16 units.
 */
const ONE_CHARACTER = /^[\s\S]$/u;
const TWO_CHARACTERS = /^[\s\S][\s\S]$/u;

function assertSingleCharacter(value: string, what: string): void {
  // A string of the wrong length is a caller bug, not a character English does
  // not use, so it must not come back as `undefined`.
  if (!ONE_CHARACTER.test(value)) {
    throw new RangeError(`${what} must be exactly one character, got ${JSON.stringify(value)}`);
  }
}

/** Checked at module load, so bad data fails here rather than inside a lesson. */
function assertData(): void {
  const letters = Object.keys(LETTER_FREQUENCY);
  if (letters.length !== 26) {
    throw new FrequencyDataError(`LETTER_FREQUENCY has ${letters.length} entries, expected 26`);
  }

  let total = 0;
  for (const [letter, frequency] of Object.entries(LETTER_FREQUENCY)) {
    if (!/^[a-z]$/.test(letter)) {
      throw new FrequencyDataError(
        `LETTER_FREQUENCY key ${JSON.stringify(letter)} is not a letter`,
      );
    }
    if (!Number.isFinite(frequency) || frequency <= 0) {
      throw new FrequencyDataError(`LETTER_FREQUENCY["${letter}"] is not a positive number`);
    }
    total += frequency;
  }
  if (total < 99 || total > 101) {
    throw new FrequencyDataError(`LETTER_FREQUENCY sums to ${total}, expected about 100`);
  }

  for (const [bigram, frequency] of Object.entries(BIGRAM_FREQUENCY)) {
    if (!/^[a-z]{2}$/.test(bigram)) {
      throw new FrequencyDataError(
        `BIGRAM_FREQUENCY key ${JSON.stringify(bigram)} is not two letters`,
      );
    }
    if (!Number.isFinite(frequency) || frequency <= 0) {
      throw new FrequencyDataError(`BIGRAM_FREQUENCY["${bigram}"] is not a positive number`);
    }
  }

  const seen = new Set<string>();
  for (const mark of PROSE_PUNCTUATION) {
    if (!ONE_CHARACTER.test(mark)) {
      throw new FrequencyDataError(
        `PROSE_PUNCTUATION entry ${JSON.stringify(mark)} is not a single character`,
      );
    }
    if (/[\p{L}\p{N}]/u.test(mark)) {
      throw new FrequencyDataError(
        `PROSE_PUNCTUATION entry ${JSON.stringify(mark)} is a letter or a digit`,
      );
    }
    if (seen.has(mark)) {
      throw new FrequencyDataError(`PROSE_PUNCTUATION lists ${JSON.stringify(mark)} twice`);
    }
    seen.add(mark);
  }
}

assertData();

/**
 * Frequency of a letter as a percentage, or `undefined` for anything that is not
 * one of the 26. Case insensitive, because a capital is the same key.
 */
export function letterFrequency(character: string): number | undefined {
  assertSingleCharacter(character, 'character');
  return LETTER_FREQUENCY[character.toLowerCase()];
}

/** Zero is the most used mark. `undefined` means prose does not use it. */
export function prosePunctuationRank(character: string): number | undefined {
  assertSingleCharacter(character, 'character');
  const index = PROSE_PUNCTUATION.indexOf(character);
  return index === -1 ? undefined : index;
}

/** `undefined` for a pair the table does not list: uncommon, not impossible. */
export function bigramFrequency(bigram: string): number | undefined {
  if (!TWO_CHARACTERS.test(bigram)) {
    throw new RangeError(`bigram must be exactly two characters, got ${JSON.stringify(bigram)}`);
  }
  return BIGRAM_FREQUENCY[bigram.toLowerCase()];
}

/**
 * How much common English a character unlocks against a set already known: the
 * summed frequency of every listed bigram joining it to one of them, in either
 * direction, and with itself.
 *
 * A lower bound over a truncated table, so it is only meaningful compared with
 * another call on the same known set. Used as a tie break, never as a score in
 * its own right.
 */
export function pairingWeight(character: string, known: Iterable<string>): number {
  assertSingleCharacter(character, 'character');
  const lower = character.toLowerCase();
  if (!/^[a-z]$/.test(lower)) return 0;

  const partners = new Set<string>([lower]);
  for (const other of known) {
    const partner = other.toLowerCase();
    if (/^[a-z]$/.test(partner)) partners.add(partner);
  }

  let weight = 0;
  for (const partner of partners) {
    weight += BIGRAM_FREQUENCY[lower + partner] ?? 0;
    if (partner !== lower) weight += BIGRAM_FREQUENCY[partner + lower] ?? 0;
  }
  return weight;
}

export interface BigramWeight {
  readonly bigram: string;
  readonly frequency: number;
}

/**
 * The listed bigrams typable with `allowed`, most common first.
 *
 * This is the seam the drill text generator uses for cluster drills: a lesson
 * knows its own key set, and the clusters worth drilling are the common pairs
 * that set can actually type. Deterministic: equal frequencies are ordered
 * alphabetically.
 */
export function topBigrams(allowed: Iterable<string>, limit?: number): readonly BigramWeight[] {
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 0)) {
    throw new RangeError(`limit must be a non-negative integer, got ${String(limit)}`);
  }

  const letters = new Set<string>();
  for (const character of allowed) {
    const lower = character.toLowerCase();
    if (/^[a-z]$/.test(lower)) letters.add(lower);
  }

  const matches: BigramWeight[] = [];
  for (const [bigram, frequency] of Object.entries(BIGRAM_FREQUENCY)) {
    const first = bigram[0];
    const second = bigram[1];
    if (first === undefined || second === undefined) {
      throw new FrequencyDataError(`BIGRAM_FREQUENCY key ${JSON.stringify(bigram)} is too short`);
    }
    if (letters.has(first) && letters.has(second)) matches.push({ bigram, frequency });
  }

  matches.sort((a, b) =>
    b.frequency === a.frequency ? a.bigram.localeCompare(b.bigram) : b.frequency - a.frequency,
  );
  return limit === undefined ? matches : matches.slice(0, limit);
}
