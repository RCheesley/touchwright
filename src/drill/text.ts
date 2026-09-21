/**
 * Drill text: given a lesson, something worth typing.
 *
 * The engine in `engine.ts` consumes a plain string. This module produces it,
 * and the one rule it exists to enforce is that every character of what it
 * produces is a character the lesson can type. A drill containing a key the
 * learner has never been shown is not a cosmetic flaw: it is a drill that cannot
 * be completed, and the prototype shipped exactly that. Its prose included "How
 * vexingly quick daft zebras jump!", and the exclamation mark is shift and the
 * `1` key, which its ladder never taught. That sentence is still in
 * `DRILL_SENTENCES` below, deliberately, because the filter has to drop it.
 *
 * Three kinds of text, in `DrillTextKind`:
 *
 *  - `clusters` — Maltron-style non-blocking letter groups, built from the
 *    common bigrams the lesson's own key set can type. What the earliest
 *    lessons get when a word pool would be too thin or too repetitive to drill.
 *  - `words` — real words filtered to the lesson's cumulative key set, biased
 *    towards the keys the lesson has just added, with punctuation and capitals
 *    added only once a lesson has unlocked them.
 *  - `prose` — real sentences, once everything is in play.
 *
 * The lesson's `stage` chooses between prose and the rest; how much the key set
 * admits chooses between words and clusters, because that is a property of the
 * layout rather than of the ladder. Maltron's first lesson — `anisfdthor` plus
 * space — admits 127 of the words below, so it drills real words with a cluster
 * group in front of them. A home row of `asdfghjkl` admits sixteen, and one of
 * two letters admits one, so those fall back to clusters. Nothing here assumes
 * which case it is in.
 *
 * Determinism is a requirement: a drill that fails is only reproducible in a
 * test if the same seed and lesson give the same text, so the randomness is a
 * seeded generator and `Math.random` is never called. Without a seed the lesson
 * id is hashed into one, which keeps the function pure; a caller that wants
 * variety between drills passes a changing seed.
 *
 * On capitals: the `capitals` stage produces them, because the ladder only adds
 * that stage when the layout binds a shift and there is something to shift. The
 * `prose` stage does not, because a `Lesson` on its own cannot say whether shift
 * was ever bound — the ladder appends `prose` either way — and inventing a
 * capital the layout cannot type is the same bug as the exclamation mark above.
 * Prose is therefore lower case until the caller can tell us; see the note in
 * the pull request for the one-line widening that lands with the integration.
 *
 * DOM-free by rule, like the engine it feeds.
 */

import type { Lesson } from '../ladder/generate.js';
import { letterFrequency, PROSE_PUNCTUATION, topBigrams } from '../ladder/frequency.js';

export interface DrillTextOptions {
  /**
   * Target length in whitespace separated groups: words, clusters, or the words
   * of a sentence. A prose sentence is never cut in half to hit it, so the
   * result can overshoot by the tail of one sentence.
   */
  readonly words?: number;
  /**
   * Determinism. The same seed and the same lesson always give the same text.
   * Defaults to a hash of the lesson id, so a call without one is reproducible
   * too — it is the same drill every time, which is why a caller wanting variety
   * supplies a changing seed.
   */
  readonly seed?: number;
}

/** Which of the three kinds of text a lesson gets. */
export type DrillTextKind = 'clusters' | 'words' | 'prose';

export class DrillTextError extends Error {
  override readonly name = 'DrillTextError';
  constructor(problem: string, options?: ErrorOptions) {
    super(`Cannot build drill text: ${problem}`, options);
  }
}

/** Roughly a line and a half at a comfortable width. */
export const DEFAULT_WORD_COUNT = 12;

/**
 * Below this many typable words, a word drill would repeat itself into
 * nonsense, so the lesson gets clusters instead.
 */
const MIN_POOL = 8;

/**
 * While fewer than a dozen letters are in play the pool is small enough that a
 * word drill alone would recycle the same handful of words, so the drill leads
 * with a cluster group. For the reference ladder this is the home lesson and the
 * thumb lesson, which is where the prototype seeded clusters by hand.
 */
const CLUSTER_LEAD_LETTERS = 12;

/** How many groups of the target length a lead segment may take. */
const LEAD_GROUPS = 4;

/**
 * Below this target there is no room for a fresh-key group as well as a word, so
 * a very short drill is words only rather than overshooting the length asked for.
 */
const MIN_FRESH_TARGET = 4;

const MIN_CLUSTER_LENGTH = 3;
const MAX_CLUSTER_LENGTH = 5;

/** How often a cluster extends itself through a common bigram rather than freely. */
const CHAIN_BIAS = 0.75;

/** How often a word drill reaches for a word using one of the new keys. */
const FRESH_BIAS = 0.62;

/** Enough fresh words to be worth biasing towards; below it, bias on nothing. */
const MIN_FRESH_POOL = 8;

/** Only the common pairs make good clusters; the tail of the table does not. */
const CLUSTER_BIGRAM_LIMIT = 48;

/** A comma or a semicolon lands after every third word, never twice running. */
const PUNCTUATION_EVERY = 3;

/** How often an apostrophe gets an outing, once the lesson has one to give. */
const POSSESSIVE_CHANCE = 0.15;

/**
 * The word pool: 1339 words, every one of them lower case ASCII letters only,
 * two letters or more, deduplicated and sorted.
 *
 * Derived from the prototype's `WORDS` list, normalised — it held duplicates,
 * one capitalised proper noun, and single letters that make a poor drill. The
 * list is not sacred and nothing here depends on its contents beyond those
 * properties, which `assertData` checks at load. Words carry no punctuation of
 * their own, so an apostrophe or a hyphen only ever reaches the text through a
 * lesson that unlocked it.
 */
export const DRILL_WORDS: readonly string[] = `
about above across act actual ad add after again against age ago agree ahead aid air all
almost alone along already also although always among amount an ancient and animal another
answer ant any appear apply area argue arid arm around arrive art as ask at attempt attend
august author available average avoid away back bad bag balance ball band bank bar base basic
be bear beat beauty because become bed been before begin behind being believe below beside
best better between beyond big bill bird birth bit black block blood blue board boat body book
born both bottom box boy branch bread break bridge bright bring broad broken brother brought
brown build built burn business but buy by call calm came camp can cannot capital car card
care carry case cast catch cause cell center central century certain chain chair chance change
chapter character charge check chief child choice choose church circle city civil claim class
clean clear climb clock close cloth cloud coast coat cold collect college color come comfort
command common company compare complete computer concern condition connect consider contain
continue control cook cool copy corner correct cost could count country couple course court
cover create cross crowd cry culture current cut daily damage dance danger dark dart dash data
date daughter day dead deal dear death decide deep degree deliver demand depend describe
design desire desk detail develop die differ different difficult dinner direct dirt discover
discuss dish distance district divide do doctor dog dollar don door dot double doubt down
dozen draw dream dress drink drive drop dry during duty each ear early earn earth east easy
eat edge effect effort egg eight either elect else empty end enemy energy engine english enjoy
enough enter entire equal escape especially even evening event ever every evidence exact
example except exchange exist expect experience explain express extra eye face fact fail fair
faith fall familiar family famous far farm fast fat father favor fear feature federal feed
feel feet fell few field fifth fight figure file fill final find fine finger finish fire firm
first fish fit five fix flat floor flow flower fly follow fond food for force foreign forest
forget form former fort forth fortune forward found four frame free french fresh friend from
front fruit full fun further future gain game garden gas gate gather gave general gentle get
gift girl give glad glass go god gold gone good got govern grade grain grand grant grass gray
great green grew ground group grow guard guess guide gun had hair half hall halt hand hang
happen happy harbor hard harm has hat hate have head hear heart heat heavy held help here hero
herself hide high hill himself hint his history hit hold hole holy home honor hope horse
hospital host hot hour house how however huge human humor hundred hunt hurry hurt husband ice
idea if ill image imagine impact import important improve in include increase indeed
independent indicate individual industry influence inform inside instance instead institute
instrument intend interest internal into introduce invite involve iron is island issue it item
its itself join joint journey joy judge jump just keep kept key kill kind king kitchen knee
knew knife knock know known labor lack lady lake land language large last late later laugh law
lay lead leaf learn least leave led left leg legal length less lesson let letter level library
lie life lift light like limit line lip liquid list listen little live local lock long look
lose loss lost lot loud love low luck lunch machine made magic mail main maintain major make
man manage manner many map march mark market marry mass master match material matter may maybe
mean measure meat medical meet member memory mention mere metal method middle might mile
military milk million mind mine minute miss mission mix model modern moment money month moon
moral more morning most mother motion mount mouth move movie much music must myself name
nation native natural nature near nearly necessary neck need neighbor neither nerve net never
new news next nice night nine no nod noise none noon nor normal north nose not note notice
novel now number oat object observe occur ocean odd of off offer office officer official often
oh oil okay old on once one only open operate opinion opportunity oppose option or orange
order organ origin original other ought ounce our ourselves out outside oven over own owner
pace pack page pain paint pair pale paper parent park part particular partner party pass past
path patient pattern pay peace people perfect perform perhaps period permit person physical
pick picture piece place plain plan plane plant plate play please pleasure plenty plus pocket
poem point police policy political poor popular population port position possible post pound
pour power practice praise prepare present press pressure pretty prevent price pride primary
prime print prior private prize probably problem process produce product professor profit
program progress project promise proper protect proud prove provide public pull pure purpose
push put quality quarter queen question quick quiet quite race radio raid railroad rain raise
range rank rapid rare rat rate rather ratio reach read ready real reason receive recent record
red reduce refer reflect refuse regard region regular reject relate release remain remember
remove repeat reply report represent request require rescue research respect respond rest
result return reveal review rich ride right ring rise risk river road roast rock rod role roll
roof room root rose rot rough round route row royal rule run rural rush sad safe said sail
saint salt same sample sand sat save saw say scale scene school science score sea search
season seat second secret section secure see seed seek seem seen select self sell send sense
sentence separate serious serve service set settle seven several shade shaft shake shall shape
share sharp she sheet shell shelter shift shine ship shirt shock shoot shop shore short shot
should show shut sick side sign signal silence silver similar simple since sing single sink
sir sister sit site situation six size skill skin sky sleep slight slip slow small smell smile
smoke snow so social society soft soil soldier solid solution solve some son song soon sort
sound source south space speak special speed spell spend spirit spoke sport spot spread spring
square staff stage stair stamp stand standard star start stat state statement station stay
steady steal steam steel step stick still stir stock stone stood stop store storm story
straight strand strange stream street strength stress stretch strike string strong structure
struggle student study stuff style subject succeed such sudden suffer sugar suggest summer sun
supply support suppose sure surface surprise surround survey sweet swim switch symbol system
table take talk tall tan tart task taste tax teach team tear technology tell temperature ten
term terrible test text than thank that the their them then theory there these they thick thin
thing think third thirst thirty this thorn those though thought thousand three throat through
thus tie tight till time tiny tire title to today together told tomorrow tone tongue tonight
too tool tooth top torn total touch tough toward tower town trace track trade traffic trail
train transit travel treat tree trial trip trod trouble truck true trust truth try turn twelve
twenty twice two type typical unable uncle under understand union unit unite universe
university unless unlike until up upon upper urban urge us use usual valley value variety
various vast vehicle version very victory view village visit voice volume vote wage wait wake
walk wall want war warm warn was wash waste watch water wave way we weak wealth wear weather
week weight welcome well went were west wet what wheel when where whether which while white
who whole whose why wide wife wild will win wind window wine wing winter wire wise wish with
within without witness woman women wonder wood wool word work world worry worth would wound
wrap write wrong yard year yes yet yield you young your yourself youth zone
`
  .split(/\s+/u)
  .filter((word) => word !== '');

/**
 * Sentences for the prose stage, filtered to the lesson's key set like
 * everything else.
 *
 * Most are the prototype's, which were written for this layout and say useful
 * things about it. The pangrams earn their place by covering the rare letters.
 * "How vexingly quick daft zebras jump!" is kept on purpose: its exclamation
 * mark needs shift and the `1` key, the reference ladder never unlocks it, and
 * so the filter must drop the sentence. A few sentences use no punctuation at
 * all, so that a layout binding none still reaches prose.
 */
export const DRILL_SENTENCES: readonly string[] = [
  'The home row holds the letters you reach for most, so your hands can stay still.',
  'Frequency of use decided where every one of these keys went.',
  'A split keyboard lets the shoulders open, which is half the battle.',
  'Type slowly and correctly first; speed is the reward for accuracy, not the route to it.',
  'The thumb is the strongest digit on the hand, and here it carries the busiest letter.',
  'Columns instead of rows means the fingers travel straight up and down.',
  'Rest the wrists, drop the shoulders, and let the keywell come to you.',
  'Every wrong key you practise is a key you will have to unlearn twice.',
  'Short sessions every day beat one long session every week.',
  'Watch the screen, not your hands; the map is already in your fingers.',
  'A layout is only as good as the habits you build on top of it.',
  'The quick brown fox jumps over the lazy dog.',
  'Pack my box with five dozen liquor jugs.',
  'How vexingly quick daft zebras jump!',
  'Open tools survive because people keep choosing to maintain them.',
  'Small, steady contributions compound into something nobody could build alone.',
  'A steady hand beats a fast one and always will',
  'This trainer reads your keyboard and builds the ladder out of it',
  'Your fingers learn what your eyes have stopped watching',
  'Practise the keys you miss and the rest of them will follow',
];

/** Checked at module load, so bad data fails here rather than inside a drill. */
function assertData(): void {
  if (DRILL_WORDS.length === 0) {
    throw new DrillTextError('the word pool is empty');
  }

  const seen = new Set<string>();
  let previous = '';
  for (const word of DRILL_WORDS) {
    if (!/^[a-z]{2,}$/u.test(word)) {
      throw new DrillTextError(
        `the word pool holds ${JSON.stringify(word)}, which is not two or more lower case letters`,
      );
    }
    if (seen.has(word)) {
      throw new DrillTextError(`the word pool holds ${JSON.stringify(word)} twice`);
    }
    if (word < previous) {
      throw new DrillTextError(
        `the word pool is not sorted: ${JSON.stringify(word)} follows ${JSON.stringify(previous)}`,
      );
    }
    seen.add(word);
    previous = word;
  }

  if (DRILL_SENTENCES.length === 0) {
    throw new DrillTextError('there are no prose sentences');
  }
  for (const sentence of DRILL_SENTENCES) {
    if (sentence.trim() !== sentence || sentence === '') {
      throw new DrillTextError(`the sentence ${JSON.stringify(sentence)} is padded or empty`);
    }
    if (/\s\s|\n/u.test(sentence)) {
      throw new DrillTextError(`the sentence ${JSON.stringify(sentence)} has run-together spaces`);
    }
  }
}

assertData();

/**
 * mulberry32. Small, fast, and good enough for choosing words; chosen over
 * anything cleverer because a drill only needs to be reproducible, and over
 * `Math.random` because that cannot be reproduced at all.
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

/** FNV-1a, so a lesson without a seed still gets a stable one of its own. */
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
    throw new DrillTextError(`there is no ${what} to choose from`);
  }
  // Math.random-style generators return [0, 1), but clamping means a generator
  // that ever returned 1 cannot walk off the end of the array.
  const index = Math.min(Math.floor(random() * items.length), items.length - 1);
  const item = items[index];
  if (item === undefined) {
    throw new DrillTextError(`choosing a ${what} fell off the end of a list of ${items.length}`);
  }
  return item;
}

interface Settings {
  readonly words: number;
  readonly seed: number;
}

function readOptions(lesson: Lesson, options: DrillTextOptions | undefined): Settings {
  const words = options?.words ?? DEFAULT_WORD_COUNT;
  if (!Number.isInteger(words) || words < 1) {
    throw new RangeError(`words must be a positive integer, got ${JSON.stringify(options?.words)}`);
  }

  const seed = options?.seed ?? hashSeed(lesson.id);
  if (!Number.isInteger(seed)) {
    throw new RangeError(`seed must be an integer, got ${JSON.stringify(options?.seed)}`);
  }

  return { words, seed: seed >>> 0 };
}

/** One code point, matched rather than counted, so an astral character is one key. */
const ONE_CHARACTER = /^[\s\S]$/u;

/**
 * Split by code point, the same way the engine splits the text it is given, so
 * that a character outside the BMP counts as the one keystroke it is rather than
 * as two halves of a surrogate pair.
 */
function characters(value: string): readonly string[] {
  return Array.from(value);
}

/**
 * Every character this lesson can type, capitals included where the stage has
 * unlocked them. This is the filter everything else in the module goes through.
 */
export function drillAlphabet(lesson: Lesson): ReadonlySet<string> {
  if (lesson.keys.length === 0) {
    throw new DrillTextError(`lesson "${lesson.id}" has no keys`);
  }

  const allowed = new Set<string>();
  for (const key of lesson.keys) {
    if (!ONE_CHARACTER.test(key)) {
      throw new DrillTextError(
        `lesson "${lesson.id}" lists ${JSON.stringify(key)} as a key, which is not one character`,
      );
    }
    allowed.add(key);
  }

  if (lesson.stage === 'capitals') {
    for (const key of lesson.keys) {
      const upper = key.toUpperCase();
      if (upper !== key && ONE_CHARACTER.test(upper)) allowed.add(upper);
    }
  }

  return allowed;
}

function lettersOf(allowed: ReadonlySet<string>): readonly string[] {
  return [...allowed].filter((character) => /^[a-z]$/u.test(character)).sort();
}

/**
 * The most used of these letters, most used first. A letter the frequency table
 * does not cover sorts last rather than being dropped: absent means English does
 * not use it, not that it cannot be typed.
 */
function commonest(letters: readonly string[], count: number): readonly string[] {
  return [...letters]
    .sort((a, b) => {
      const difference = (letterFrequency(b) ?? 0) - (letterFrequency(a) ?? 0);
      return difference === 0 ? a.localeCompare(b) : difference;
    })
    .slice(0, count);
}

/** The words of `DRILL_WORDS` this lesson can type, in the pool's own order. */
export function drillWordPool(lesson: Lesson): readonly string[] {
  const allowed = drillAlphabet(lesson);
  return DRILL_WORDS.filter((word) =>
    characters(word).every((character) => allowed.has(character)),
  );
}

/** The sentences this lesson can type, as it would have to type them. */
export function drillProsePool(lesson: Lesson): readonly string[] {
  const allowed = drillAlphabet(lesson);
  const capitals = lesson.stage === 'capitals';
  return DRILL_SENTENCES.map((sentence) => (capitals ? sentence : sentence.toLowerCase())).filter(
    (sentence) => characters(sentence).every((character) => allowed.has(character)),
  );
}

/**
 * Everything the three builders share, worked out once so that
 * `drillTextKind` and `generateDrillText` cannot disagree about which kind of
 * text a lesson gets.
 */
interface Plan {
  readonly kind: DrillTextKind;
  readonly allowed: ReadonlySet<string>;
  readonly letters: readonly string[];
  readonly pool: readonly string[];
  readonly fresh: readonly string[];
  readonly sentences: readonly string[];
  /** A space when the lesson has one, otherwise nothing: groups run together. */
  readonly separator: string;
  readonly marks: readonly string[];
}

function planFor(lesson: Lesson): Plan {
  const allowed = drillAlphabet(lesson);
  const letters = lettersOf(allowed);
  const separator = allowed.has(' ') ? ' ' : '';
  const pool = drillWordPool(lesson);
  const sentences = drillProsePool(lesson);
  const marks = PROSE_PUNCTUATION.filter((mark) => allowed.has(mark));

  const added = new Set(
    lesson.addedKeys.filter((key) => /^[a-z]$/u.test(key)).map((key) => key.toLowerCase()),
  );
  const withNewKeys = pool.filter((word) =>
    characters(word).some((character) => added.has(character)),
  );
  const fresh = withNewKeys.length >= MIN_FRESH_POOL ? withNewKeys : pool;

  // A word drill needs a separator to be readable at all, so a layout that has
  // not unlocked a space gets clusters however rich its pool is.
  const wordsWorkable = separator !== '' && pool.length >= MIN_POOL;
  const kind: DrillTextKind =
    lesson.stage === 'prose' && sentences.length > 0
      ? 'prose'
      : wordsWorkable
        ? 'words'
        : 'clusters';

  return { kind, allowed, letters, pool, fresh, sentences, separator, marks };
}

/**
 * Which kind of text this lesson gets. Exported because the drill surface wants
 * to say so, and because a test asserting "the earliest lessons get clusters"
 * should not have to infer it from the text.
 *
 * A `prose` lesson whose layout binds no full stop has no typable sentence and
 * falls back to words, and a lesson whose pool is too thin falls back to
 * clusters. Degrading is deliberate: a shorter drill the learner can finish
 * beats a richer one they cannot.
 */
export function drillTextKind(lesson: Lesson): DrillTextKind {
  return planFor(lesson).kind;
}

/**
 * Which letters may follow which, drawn from the common bigrams this key set can
 * type. Ordered by frequency, so an even choice among a handful of followers
 * still favours the pairs English actually uses.
 */
function chainsFor(letters: readonly string[]): ReadonlyMap<string, readonly string[]> {
  const chains = new Map<string, string[]>();
  for (const { bigram } of topBigrams(letters, CLUSTER_BIGRAM_LIMIT)) {
    const first = bigram.slice(0, 1);
    const second = bigram.slice(1, 2);
    const followers = chains.get(first);
    if (followers === undefined) {
      chains.set(first, [second]);
    } else {
      followers.push(second);
    }
  }
  return chains;
}

function buildClusters(
  random: () => number,
  alphabet: readonly string[],
  count: number,
): readonly string[] {
  if (alphabet.length === 0) {
    throw new DrillTextError('a cluster drill needs at least one key and this lesson has none');
  }

  const chains = chainsFor(alphabet);
  const clusters: string[] = [];

  for (let group = 0; group < count; group += 1) {
    const length =
      MIN_CLUSTER_LENGTH + Math.floor(random() * (MAX_CLUSTER_LENGTH - MIN_CLUSTER_LENGTH + 1));
    let cluster = pick(random, alphabet, 'key');
    while (characters(cluster).length < length) {
      const followers = chains.get(cluster.slice(-1));
      const chained = followers !== undefined && followers.length > 0 && random() < CHAIN_BIAS;
      cluster += chained ? pick(random, followers, 'key') : pick(random, alphabet, 'key');
    }
    clusters.push(cluster);
  }

  return clusters;
}

/**
 * A short group drilling the keys this lesson added that no word can contain —
 * digits, brackets, the backtick. Without it the lesson that introduces them
 * would hand the learner a word drill that never touches a single new key.
 */
function freshKeyGroups(
  random: () => number,
  lesson: Lesson,
  plan: Plan,
  text: string,
  count: number,
): readonly string[] {
  const missing = lesson.addedKeys.filter(
    (key) => key !== ' ' && plan.allowed.has(key) && !text.includes(key),
  );
  if (missing.length === 0) return [];

  // One missing key on its own would drill nothing but that key, so the two most
  // used letters already in play come along to break it up.
  const alphabet = missing.length > 1 ? missing : [...missing, ...commonest(plan.letters, 2)];
  return buildClusters(random, alphabet, count);
}

function capitalise(word: string, allowed: ReadonlySet<string>): string {
  const first = word.slice(0, 1);
  const upper = first.toUpperCase();
  return upper !== first && allowed.has(upper) ? upper + word.slice(1) : word;
}

/**
 * Punctuation, and only the punctuation this lesson has unlocked. A mark that is
 * not in the key set is never reached for, so the first ten lessons of the
 * reference ladder come out as bare words and the eleventh starts using stops
 * and commas.
 */
function punctuate(groups: readonly string[], plan: Plan, random: () => number): readonly string[] {
  if (plan.marks.length === 0) return groups;

  const stop = plan.marks.includes('.') ? '.' : undefined;
  const joiners = plan.marks.filter((mark) => mark === ',' || mark === ';');
  const possessive = plan.allowed.has("'") && plan.allowed.has('s');

  const out = groups.map((group, index) => {
    const last = index === groups.length - 1;
    if (!last && index > 0 && index % PUNCTUATION_EVERY === 0 && joiners.length > 0) {
      return group + pick(random, joiners, 'mark');
    }
    if (!last && possessive && index % PUNCTUATION_EVERY === 1 && random() < POSSESSIVE_CHANCE) {
      return `${group}'s`;
    }
    return group;
  });

  const tail = out.at(-1);
  if (stop !== undefined && tail !== undefined) {
    out[out.length - 1] = tail + stop;
  }
  return out;
}

function buildWords(random: () => number, lesson: Lesson, plan: Plan, target: number): string {
  const lead = plan.letters.length < CLUSTER_LEAD_LETTERS && target > LEAD_GROUPS * 2;
  const leadCount = lead ? LEAD_GROUPS : 0;

  const chosen: string[] = [];
  for (let index = 0; index < Math.max(1, target - leadCount); index += 1) {
    const source = random() < FRESH_BIAS ? plan.fresh : plan.pool;
    chosen.push(pick(random, source, 'word'));
  }

  const cased =
    lesson.stage === 'capitals'
      ? chosen.map((word, index) => (index % 2 === 0 ? capitalise(word, plan.allowed) : word))
      : chosen;
  const punctuated = punctuate(cased, plan, random);
  const leadClusters = lead ? buildClusters(random, plan.letters, leadCount) : [];

  // A fresh-key group takes the place of words rather than being added to them,
  // so the target holds. Words are dropped from the front, because the last one
  // carries the full stop.
  const budget = target >= MIN_FRESH_TARGET ? Math.min(LEAD_GROUPS, target - 1) : 0;
  const fresh =
    budget === 0
      ? []
      : freshKeyGroups(random, lesson, plan, [...leadClusters, ...punctuated].join(' '), budget);
  const keep = Math.max(1, target - leadCount - fresh.length);
  const words = punctuated.slice(Math.max(0, punctuated.length - keep));

  return [...fresh, ...leadClusters, ...words].join(plan.separator);
}

function buildProse(random: () => number, plan: Plan, target: number): string {
  const remaining = [...plan.sentences];
  const chosen: string[] = [];
  let words = 0;

  while (words < target && remaining.length > 0) {
    const sentence = pick(random, remaining, 'sentence');
    remaining.splice(remaining.indexOf(sentence), 1);
    chosen.push(sentence);
    words += sentence.split(' ').length;
  }

  if (chosen.length === 0) {
    throw new DrillTextError(
      'no sentence survived the key set, which should have been a word drill',
    );
  }
  return chosen.join(plan.separator === '' ? '' : ' ');
}

/**
 * Check the text against the lesson before handing it out, the way the ladder
 * checks itself. Everything above is meant to make this impossible to fail; it
 * is here because "meant to" is not a guarantee, and a throw is a far better
 * outcome than a learner hunting for a key they were never taught.
 */
function assertTypable(text: string, lesson: Lesson, allowed: ReadonlySet<string>): void {
  if (text === '') {
    throw new DrillTextError(`lesson "${lesson.id}" produced no text`);
  }
  for (const character of text) {
    if (!allowed.has(character)) {
      throw new DrillTextError(
        `lesson "${lesson.id}" cannot type ${JSON.stringify(character)}, which its drill text contains`,
      );
    }
  }
  if (text.trim() !== text || /\s\s/u.test(text)) {
    throw new DrillTextError(
      `lesson "${lesson.id}" produced text with padding or doubled spaces: ${JSON.stringify(text)}`,
    );
  }
}

/**
 * Drill text for a lesson: clusters, words or prose, filtered to the keys the
 * lesson has taught, and the same every time for the same seed.
 *
 * Throws rather than returning something unusable: an empty string would reach
 * the engine as a drill that is already finished, and text the lesson cannot
 * type would reach the learner as a drill that can never finish.
 */
export function generateDrillText(lesson: Lesson, options?: DrillTextOptions): string {
  const { words, seed } = readOptions(lesson, options);
  const plan = planFor(lesson);
  const random = createRandom(seed);

  let text: string;
  try {
    switch (plan.kind) {
      case 'prose':
        text = buildProse(random, plan, words);
        break;
      case 'words':
        text = buildWords(random, lesson, plan, words);
        break;
      case 'clusters': {
        const alphabet =
          plan.letters.length > 0
            ? plan.letters
            : [...plan.allowed].filter((character) => character !== ' ').sort();
        text = buildClusters(random, alphabet, words).join(plan.separator);
        break;
      }
    }
  } catch (cause) {
    throw new DrillTextError(`lesson "${lesson.id}" admits no ${plan.kind} drill`, { cause });
  }

  assertTypable(text, lesson, plan.allowed);
  return text;
}
