/**
 * Ladder generation, against the real MoErgo export used as the reference
 * fixture and against two layouts that are not Maltron.
 *
 * The centrepiece is the comparison with the hand authored ladder in the
 * prototype. Where the generated ladder agrees with it, this file asserts the
 * agreement; where it deliberately differs, it asserts the difference, so that a
 * divergence documented in docs/ladder.md cannot quietly become a different one.
 *
 * Maltron is a trademark of PCD Maltron Ltd and the layout is used here only as
 * test data.
 */

import { describe, expect, it } from 'vitest';
import { GLOVE80 } from '../../src/board/glove80.js';
import {
  assertValidBoard,
  type BoardDefinition,
  type Hand,
  type KeyPosition,
} from '../../src/board/types.js';
import { parseMoErgoLayout, parseMoErgoLayoutText } from '../../src/keymap/moergo.js';
import type { Keymap } from '../../src/keymap/types.js';
import { generateLadder, keyEffort, LadderError, type Lesson } from '../../src/ladder/index.js';
import { readReferenceLayout } from '../fixtures/index.js';

const fixtureText = readReferenceLayout();

function referenceKeymap(): Keymap {
  return parseMoErgoLayoutText(fixtureText, { board: GLOVE80 });
}

function ladder(): readonly Lesson[] {
  return generateLadder(referenceKeymap(), GLOVE80);
}

function added(lessons: readonly Lesson[]): readonly string[] {
  return lessons.map((lesson) => lesson.addedKeys.join(''));
}

/**
 * The hand authored ladder from prototype.html, transcribed verbatim: lesson id
 * and the keys that lesson adds. This is the bar the brief sets.
 */
const HAND_AUTHORED: readonly (readonly [string, string])[] = [
  ['home', 'anisfdthor'],
  ['thumb', 'e'],
  ['lu', 'lu'],
  ['cm', 'cm'],
  ['wg', 'wg'],
  ['yp', 'yp'],
  ['bv', 'bv'],
  ['kj', 'kj'],
  ['xqz', 'xqz'],
  ['punct', ",.';"],
  ['caps', ''],
  ['prose', ''],
];

describe('the ladder generated for the reference layout', () => {
  it('runs home keys, thumb, the keywell, punctuation, then the two stages', () => {
    expect(ladder().map((lesson) => lesson.id)).toEqual([
      'home',
      'thumb',
      'lu',
      'cm',
      'wg',
      'yp',
      'bv',
      'kj',
      'xqz',
      'punct',
      'symbols',
      'caps',
      'prose',
    ]);
  });

  it('names every lesson from the geometry, not from a table of names', () => {
    // Each of these names is assembled out of the finger, row and reach the board
    // reports. Six of them come out word for word as the prototype wrote them.
    expect(ladder().map((lesson) => lesson.name)).toEqual([
      'Home keys',
      'The left thumb',
      'Pinky and middle up',
      'Index up',
      'Index down',
      'Middle and ring up',
      'Inner index',
      'Middle down',
      'The outliers',
      'Punctuation',
      'Numbers and symbols',
      'Capitals',
      'Full prose',
    ]);
  });

  it('gives every lesson a blurb that names the hand, finger and row of what it adds', () => {
    const lessons = ladder();
    for (const lesson of lessons) {
      expect(lesson.blurb.length, `lesson "${lesson.id}" has no blurb`).toBeGreaterThan(0);
    }
    const thumb = lessons.find((lesson) => lesson.id === 'thumb');
    expect(thumb?.blurb).toBe('E: left thumb, lower arc.');
    const inner = lessons.find((lesson) => lesson.id === 'bv');
    expect(inner?.blurb).toContain('index (inner reach)');
  });

  it('teaches the space the board recommends, and says the board binds another', () => {
    const home = ladder()[0]!;
    expect(home.addedKeys).toContain(' ');
    expect(home.blurb).toContain('right thumb, lower arc');
    expect(home.blurb).toContain('more than one space');
  });
});

describe('the generated ladder against the prototype hand authored one', () => {
  it('teaches the same keywell lessons, in the same order, with the same keys', () => {
    // Lessons two to nine, the whole of the keywell: identical, id for id.
    const generated = ladder().slice(1, 9);
    expect(generated.map((lesson) => [lesson.id, lesson.addedKeys.join('')])).toEqual(
      HAND_AUTHORED.slice(1, 9).map(([id, keys]) => [id, keys]),
    );
  });

  it('teaches the same home keys, and adds the space the prototype left implicit', () => {
    // Divergence 1 in docs/ladder.md. The prototype made space permanently
    // available outside the ladder; here the first lesson unlocks it, so the
    // cumulative key set can honestly claim to cover everything the layout binds.
    const home = ladder()[0]!;
    const handAuthoredHome = HAND_AUTHORED[0]![1];

    expect(home.addedKeys.filter((key) => key !== ' ').join('')).toBe(handAuthoredHome);
    expect(home.addedKeys.join('')).toBe(`${handAuthoredHome} `);
  });

  it('teaches six punctuation keys where the prototype taught four', () => {
    // Divergence 2. The hyphen and the slash are punctuation English prose uses,
    // so they are taught with the comma, full stop, apostrophe and semicolon
    // rather than left with the symbols. The order is by use, not by position.
    const punct = ladder().find((lesson) => lesson.id === 'punct');
    expect(punct?.addedKeys.join('')).toBe(".,'-;/");

    const handAuthored = [...HAND_AUTHORED[9]![1]];
    for (const mark of handAuthored) {
      expect(punct?.addedKeys, `the prototype taught ${JSON.stringify(mark)}`).toContain(mark);
    }
    expect(punct?.addedKeys.filter((key) => !handAuthored.includes(key))).toEqual(['-', '/']);
  });

  it('adds one lesson the prototype does not have, for the keys prose never uses', () => {
    // Divergence 3. Thirteen lessons rather than twelve. The prototype's own
    // prose contains "How vexingly quick daft zebras jump!", and the exclamation
    // mark is shift and the 1 key, which its ladder never unlocked.
    const ladderIds = ladder().map((lesson) => lesson.id);
    const handAuthoredIds = HAND_AUTHORED.map(([id]) => id);

    expect(ladderIds.filter((id) => !handAuthoredIds.includes(id))).toEqual(['symbols']);
    expect(handAuthoredIds.filter((id) => !ladderIds.includes(id))).toEqual([]);

    const symbols = ladder().find((lesson) => lesson.id === 'symbols');
    expect(symbols?.addedKeys).toContain('1');
    expect(symbols?.addedKeys.join('')).toBe('58467930`2\\[]1=');
  });

  it('is the same ladder whether a lesson may look two, three or six keys ahead', () => {
    // The pairing window is the one free parameter in the ordering. Nothing
    // about the reference ladder hangs on its exact value.
    const keymap = referenceKeymap();
    const shapes = [2, 3, 4, 5, 6].map((pairingWindow) =>
      added(generateLadder(keymap, GLOVE80, { pairingWindow })),
    );
    for (const shape of shapes) {
      expect(shape).toEqual(shapes[0]);
    }
    expect(shapes[0]?.slice(1, 9)).toEqual(['e', 'lu', 'cm', 'wg', 'yp', 'bv', 'kj', 'xqz']);
  });

  it('falls back to plain frequency order when a lesson may not look ahead at all', () => {
    // Evidence that geometry, and not only frequency, decides the pairing: with a
    // window of one, L is stuck with C and U with M. The prototype pairs L with U
    // and C with M, which is what the mirror and same-hand rules recover.
    const narrow = added(generateLadder(referenceKeymap(), GLOVE80, { pairingWindow: 1 }));
    expect(narrow.slice(2, 4)).toEqual(['lc', 'um']);
  });

  it('drags rare keys forward if a lesson may look arbitrarily far ahead', () => {
    // The other end of the same argument: an unbounded window pairs L with Q,
    // because Q is L's mirror. That is why the window exists.
    const wide = added(generateLadder(referenceKeymap(), GLOVE80, { pairingWindow: 99 }));
    expect(wide[2]).toBe('lq');
  });
});

describe('the acceptance criteria for a ladder', () => {
  it('ends with a cumulative set that is every character the layout binds', () => {
    const keymap = referenceKeymap();
    const bound = new Set(keymap.typedKeys.map((key) => key.character));
    const last = generateLadder(keymap, GLOVE80).at(-1)!;

    expect(new Set(last.keys)).toEqual(bound);
    expect(last.keys).toHaveLength(bound.size);
  });

  it('never introduces a key the keymap does not bind, and never twice', () => {
    const keymap = referenceKeymap();
    const bound = new Set(keymap.typedKeys.map((key) => key.character));
    const seen = new Set<string>();

    for (const lesson of generateLadder(keymap, GLOVE80)) {
      for (const key of lesson.addedKeys) {
        expect(bound.has(key), `lesson "${lesson.id}" adds an unbound ${JSON.stringify(key)}`).toBe(
          true,
        );
        expect(seen.has(key), `lesson "${lesson.id}" adds ${JSON.stringify(key)} again`).toBe(
          false,
        );
        seen.add(key);
      }
    }
  });

  it('carries a cumulative set that is exactly the keys added so far', () => {
    const accumulated: string[] = [];
    for (const lesson of ladder()) {
      accumulated.push(...lesson.addedKeys);
      expect(lesson.keys).toEqual(accumulated);
    }
  });

  it('makes capitals and prose stages over the existing key set, adding no keys', () => {
    const lessons = ladder();
    const stages = lessons.filter((lesson) => lesson.stage !== 'keys');
    expect(stages.map((lesson) => lesson.stage)).toEqual(['capitals', 'prose']);

    const lastKeyLesson = lessons.filter((lesson) => lesson.stage === 'keys').at(-1)!;
    for (const stage of stages) {
      expect(stage.addedKeys).toEqual([]);
      expect(stage.keys).toEqual(lastKeyLesson.keys);
    }
  });

  it('is deterministic: the same inputs give an identical ladder every time', () => {
    const first = generateLadder(referenceKeymap(), GLOVE80);
    const second = generateLadder(referenceKeymap(), GLOVE80);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));

    // Re-parsing gives differently ordered maps in principle; the ladder must not care.
    const reparsed = generateLadder(
      parseMoErgoLayout(JSON.parse(fixtureText), { board: GLOVE80 }),
      GLOVE80,
    );
    expect(JSON.stringify(reparsed)).toBe(JSON.stringify(first));
  });

  it('gives every lesson an id that is unique and legal as a storage field name', () => {
    // Regression 7 was this mistake made with per-key statistics: stars are
    // stored under the lesson id, and a full stop in a field name failed silently.
    const ids = ladder().map((lesson) => lesson.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id, `lesson id ${JSON.stringify(id)} is not storage safe`).toMatch(
        /^[a-z0-9][a-z0-9-]*$/,
      );
    }
  });

  it('leaves no lesson without keys to drill', () => {
    for (const lesson of ladder()) {
      expect(lesson.keys.length, `lesson "${lesson.id}" has nothing to drill`).toBeGreaterThan(0);
    }
  });
});

describe('the effort model the ordering leans on', () => {
  const byIndex = new Map(GLOVE80.keys.map((key) => [key.index, key]));
  function key(index: number): KeyPosition {
    return byIndex.get(index)!;
  }

  it('costs a thumb less than any finger, and a home key less than a reach', () => {
    expect(keyEffort(key(69))).toBeLessThan(keyEffort(key(38))); // left thumb vs left index home
    expect(keyEffort(key(38))).toBeLessThan(keyEffort(key(26))); // index home vs index upper
    expect(keyEffort(key(26))).toBeLessThan(keyEffort(key(23))); // index upper vs pinky upper
  });

  it('costs an inner reach less than an outer one on the same row', () => {
    expect(keyEffort(key(27))).toBeLessThan(keyEffort(key(22))); // inner index vs outer pinky
  });

  it('costs reaching down slightly more than reaching up the same distance', () => {
    expect(keyEffort(key(50))).toBeGreaterThan(keyEffort(key(26))); // index lower vs index upper
  });

  it('costs a row further from home more', () => {
    expect(keyEffort(key(14))).toBeGreaterThan(keyEffort(key(26))); // index number row vs upper
  });
});

/** A synthetic Keymap, for layouts and failures the reference fixture cannot show. */
function craftKeymap(
  boardId: string,
  characters: ReadonlyMap<number, string>,
  options: {
    readonly shiftPairs?: ReadonlyMap<string, string>;
    readonly shiftPositions?: Readonly<Record<Hand, readonly number[]>>;
  } = {},
): Keymap {
  const charToPosition = new Map<string, number>();
  for (const [position, character] of characters) {
    if (!charToPosition.has(character)) charToPosition.set(character, position);
  }
  return {
    boardId,
    title: 'Synthetic layout',
    localeId: 'en-GB-mac',
    layerNames: ['Base'],
    layers: [[]],
    typedKeys: [...characters].map(([position, character]) => ({
      position,
      keycode: character.toUpperCase(),
      character,
    })),
    untypedKeys: [],
    positionToChar: new Map(characters),
    charToPosition,
    shiftPairs: options.shiftPairs ?? new Map(),
    shiftPositions: options.shiftPositions ?? { left: [], right: [] },
    duplicates: new Map(),
  };
}

/**
 * A board that is nothing like a Glove80: eight positions, six in the keywell and
 * two thumbs. If the generator has learned anything about the Glove80, this fails.
 */
function tinyBoard(): BoardDefinition {
  const column = (
    index: number,
    hand: Hand,
    finger: 'index' | 'pinky',
    row: 'home' | 'upper' | 'lower',
    rowOffset: number,
  ): KeyPosition => ({
    kind: 'column',
    index,
    hand,
    finger,
    reach: 'natural',
    row,
    rowOffset,
    column: hand === 'left' ? 0 : 1,
    x: hand === 'left' ? 0 : 1,
    y: rowOffset,
    rotation: 0,
  });

  const board: BoardDefinition = {
    id: 'tiny',
    name: 'Tiny test board',
    keyCount: 8,
    keys: [
      column(0, 'left', 'index', 'home', 0),
      column(1, 'right', 'index', 'home', 0),
      column(2, 'left', 'index', 'upper', -1),
      column(3, 'right', 'index', 'upper', -1),
      column(4, 'left', 'pinky', 'lower', 1),
      column(5, 'right', 'pinky', 'lower', 1),
      {
        kind: 'thumb',
        index: 6,
        hand: 'right',
        finger: 'thumb',
        row: 'thumb',
        arc: 'lower',
        x: 2,
        y: 2,
        rotation: 0,
      },
      {
        kind: 'thumb',
        index: 7,
        hand: 'left',
        finger: 'thumb',
        row: 'thumb',
        arc: 'lower',
        x: -1,
        y: 2,
        rotation: 0,
      },
    ],
    homePositions: [0, 1],
    spacePosition: 6,
    recommendedShift: { left: 4, right: 5 },
    render: { keyPitch: 10, capSize: 9, mirrorAxisX: 0.5 },
  };
  assertValidBoard(board);
  return board;
}

describe('a layout that is not Maltron', () => {
  /** QWERTY laid onto the same Glove80 geometry. */
  function qwertyKeymap(): Keymap {
    const layout = JSON.parse(fixtureText) as Record<string, unknown>;
    const layers = layout['layers'] as Record<string, unknown>[][];
    const base = layers[0]!;
    const place = (position: number, keycode: string): void => {
      base[position] = { value: '&kp', params: [{ value: keycode }] };
    };

    const rows: readonly (readonly [number, readonly string[]])[] = [
      [23, ['Q', 'W', 'E', 'R', 'T']],
      [28, ['Y', 'U', 'I', 'O', 'P']],
      [35, ['A', 'S', 'D', 'F', 'G']],
      [40, ['H', 'J', 'K', 'L', 'SEMI']],
      [47, ['Z', 'X', 'C', 'V', 'B']],
      [58, ['N', 'M', 'COMMA', 'DOT', 'FSLH']],
    ];
    for (const [start, keycodes] of rows) {
      keycodes.forEach((keycode, offset) => {
        place(start + offset, keycode);
      });
    }
    // The thumb and the second slash carried letters on Maltron; QWERTY does not.
    place(69, 'TAB');
    place(78, 'RGUI');

    return parseMoErgoLayout(layout, { board: GLOVE80 });
  }

  it('starts from whatever the board calls home, punctuation included', () => {
    const lessons = generateLadder(qwertyKeymap(), GLOVE80);
    // ; sits on a home position in QWERTY, so it is a home key here. The board
    // decides that, not the character.
    expect(lessons[0]?.addedKeys.join('')).toBe('asdfghjkl; ');
  });

  it('has no thumb lesson, because this layout puts no letter on a thumb', () => {
    expect(generateLadder(qwertyKeymap(), GLOVE80).map((lesson) => lesson.id)).not.toContain(
      'thumb',
    );
  });

  it('still teaches the most useful letter first and covers every bound character', () => {
    const keymap = qwertyKeymap();
    const lessons = generateLadder(keymap, GLOVE80);

    expect(lessons[1]?.addedKeys).toContain('e');
    expect(new Set(lessons.at(-1)!.keys)).toEqual(
      new Set(keymap.typedKeys.map((key) => key.character)),
    );
    expect(lessons.at(-1)?.stage).toBe('prose');
  });

  it('is deterministic for that layout too', () => {
    expect(JSON.stringify(generateLadder(qwertyKeymap(), GLOVE80))).toBe(
      JSON.stringify(generateLadder(qwertyKeymap(), GLOVE80)),
    );
  });

  it('builds a ladder for a board with eight keys and no punctuation at all', () => {
    const board = tinyBoard();
    const keymap = craftKeymap(
      board.id,
      new Map([
        [0, 't'],
        [1, 'n'],
        [2, 'o'],
        [3, 'i'],
        [4, 'z'],
        [5, 'q'],
        [6, ' '],
        [7, 'e'],
      ]),
    );

    const lessons = generateLadder(keymap, board);
    expect(lessons.map((lesson) => [lesson.id, lesson.addedKeys.join('')])).toEqual([
      ['home', 'tn '],
      ['thumb', 'e'],
      ['oi', 'oi'],
      ['qz', 'qz'],
      ['prose', ''],
    ]);
    // The thumb letter is taught alone: a thumb key shares no row or column with
    // a keywell key, so it has nothing to be paired with.
    expect(lessons[1]?.name).toBe('The left thumb');
    expect(lessons[2]?.name).toBe('Index up');
  });

  it('leaves out the capitals stage when the layout binds no shift', () => {
    const board = tinyBoard();
    const keymap = craftKeymap(board.id, new Map([[0, 'a']]));
    expect(generateLadder(keymap, board).map((lesson) => lesson.stage)).toEqual(['keys', 'prose']);
  });

  it('includes the capitals stage as soon as a shift and something to shift exist', () => {
    const board = tinyBoard();
    const keymap = craftKeymap(board.id, new Map([[0, 'a']]), {
      shiftPairs: new Map([['A', 'a']]),
      shiftPositions: { left: [4], right: [5] },
    });
    const lessons = generateLadder(keymap, board);
    expect(lessons.map((lesson) => lesson.stage)).toEqual(['keys', 'capitals', 'prose']);
    expect(lessons[1]?.blurb).toContain('opposite hand');
  });

  it('teaches a letter English does not use after the ones it does, easiest reach first', () => {
    const board = tinyBoard();
    const keymap = craftKeymap(
      board.id,
      new Map([
        [0, 'a'],
        [2, 'ø'],
        [4, 'ß'],
        [3, 't'],
      ]),
    );
    const lessons = generateLadder(keymap, board);
    const keyLessons = lessons.filter((lesson) => lesson.stage === 'keys');
    // t is known English; the two others are not, so they come last, and the
    // upper-row index key comes before the lower-row pinky one.
    expect(keyLessons.map((lesson) => lesson.addedKeys.join(''))).toEqual(['a', 'tøß']);
  });
});

describe('refusing input that cannot be trusted', () => {
  it('refuses a keymap written for a different board', () => {
    const keymap = referenceKeymap();
    const otherBoard: BoardDefinition = { ...GLOVE80, id: 'not-a-glove80' };
    expect(() => generateLadder(keymap, otherBoard)).toThrow(LadderError);
    expect(() => generateLadder(keymap, otherBoard)).toThrow(/"glove80".*"not-a-glove80"/);
  });

  it('refuses a layout that binds no characters at all, rather than returning nothing', () => {
    const keymap: Keymap = { ...referenceKeymap(), typedKeys: [] };
    expect(() => generateLadder(keymap, GLOVE80)).toThrow(/binds no characters/);
  });

  it('refuses a keymap that records a character with no position', () => {
    const source = referenceKeymap();
    const charToPosition = new Map(source.charToPosition);
    charToPosition.delete('q');
    expect(() => generateLadder({ ...source, charToPosition }, GLOVE80)).toThrow(
      /"q" as typed but gives it no position/,
    );
  });

  it('refuses a character bound at a position the board does not have', () => {
    const source = referenceKeymap();
    const charToPosition = new Map(source.charToPosition);
    charToPosition.set('q', 4242);
    expect(() => generateLadder({ ...source, charToPosition }, GLOVE80)).toThrow(
      /position 4242, which a MoErgo Glove80 does not have/,
    );
  });

  it('refuses a board whose recommended shift is not one of its own keys', () => {
    const board: BoardDefinition = { ...GLOVE80, recommendedShift: { left: 46, right: 999 } };
    expect(() => generateLadder(referenceKeymap(), board)).toThrow(/recommends shift at positions/);
  });

  it('refuses a pairing window that is not a whole number of at least one', () => {
    const keymap = referenceKeymap();
    for (const pairingWindow of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => generateLadder(keymap, GLOVE80, { pairingWindow })).toThrow(LadderError);
    }
    expect(() => generateLadder(keymap, GLOVE80, { pairingWindow: 0 })).toThrow(
      /pairingWindow must be an integer of at least 1/,
    );
  });

  it('says what a ladder error was about, so a contributor can act on it', () => {
    try {
      generateLadder({ ...referenceKeymap(), typedKeys: [] }, GLOVE80);
      expect.unreachable('a layout with no characters should not produce a ladder');
    } catch (error) {
      expect(error).toBeInstanceOf(LadderError);
      expect((error as LadderError).name).toBe('LadderError');
      expect((error as LadderError).message).toContain('Cannot build a lesson ladder');
      expect((error as LadderError).message).toContain('macOS Maltron');
    }
  });
});
