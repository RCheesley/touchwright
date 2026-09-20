/**
 * Keymap parsing, against the real MoErgo export used as the reference fixture.
 *
 * The fixture is a Maltron layout for en-GB-mac with E on the left thumb. Maltron
 * is a trademark of PCD Maltron Ltd and the layout is used here only as test data.
 */

import { describe, expect, it } from 'vitest';
import { GLOVE80 } from '../../src/board/glove80.js';
import { indexKeys } from '../../src/board/types.js';
import { parseMoErgoLayout, parseMoErgoLayoutText } from '../../src/keymap/moergo.js';
import { InvalidLayoutError } from '../../src/keymap/types.js';
import { UnsupportedLocaleError } from '../../src/keymap/locales.js';
import { readReferenceLayout } from '../fixtures/index.js';

const fixtureText = readReferenceLayout();
const fixture: unknown = JSON.parse(fixtureText);

function parse(): ReturnType<typeof parseMoErgoLayout> {
  return parseMoErgoLayout(fixture, { board: GLOVE80 });
}

describe('reading the reference layout', () => {
  it('reads the metadata', () => {
    const keymap = parse();
    expect(keymap.boardId).toBe('glove80');
    expect(keymap.localeId).toBe('en-GB-mac');
    expect(keymap.title).toBe('macOS Maltron');
  });

  it('reads all four layers at 80 positions each', () => {
    const keymap = parse();
    expect(keymap.layerNames).toEqual(['Base', 'Lower', 'Magic', 'Factory']);
    expect(keymap.layers).toHaveLength(4);
    for (const layer of keymap.layers) {
      expect(layer).toHaveLength(80);
    }
  });

  it('accepts the same file as text', () => {
    expect(parseMoErgoLayoutText(fixtureText, { board: GLOVE80 }).title).toBe('macOS Maltron');
  });
});

describe('the Maltron base layer', () => {
  it('puts A N I S F D T H O R on the ten home positions', () => {
    const keymap = parse();
    const home = GLOVE80.homePositions.map((p) => keymap.positionToChar.get(p));
    expect(home).toEqual(['a', 'n', 'i', 's', 'f', 'd', 't', 'h', 'o', 'r']);
  });

  it('puts E on the left thumb, which is the whole point of the layout', () => {
    const keymap = parse();
    const position = keymap.charToPosition.get('e');
    expect(position).toBe(69);

    const key = indexKeys(GLOVE80).get(69);
    expect(key?.kind).toBe('thumb');
    expect(key?.hand).toBe('left');
  });

  it('maps all 26 letters exactly once', () => {
    const keymap = parse();
    for (const letter of 'abcdefghijklmnopqrstuvwxyz') {
      expect(keymap.charToPosition.get(letter), `no position for "${letter}"`).toBeDefined();
    }
    const letterPositions = [...'abcdefghijklmnopqrstuvwxyz'].map((l) =>
      keymap.charToPosition.get(l)!,
    );
    expect(new Set(letterPositions).size).toBe(26);
  });

  it('agrees with the derived geometry about which finger owns each letter', () => {
    // Every one of these is a claim the hand-authored lesson ladder makes in its
    // own blurbs. If the geometry and the keymap ever disagree, the generated
    // ladder would teach the wrong finger.
    const keymap = parse();
    const board = indexKeys(GLOVE80);
    const expected: readonly [string, string, string][] = [
      ['c', 'left', 'index'],
      ['m', 'right', 'index'],
      ['w', 'right', 'index'],
      ['g', 'left', 'index'],
      ['l', 'right', 'pinky'],
      ['u', 'right', 'middle'],
      ['y', 'left', 'middle'],
      ['p', 'left', 'ring'],
      ['k', 'right', 'middle'],
      ['j', 'left', 'middle'],
      ['e', 'left', 'thumb'],
    ];

    for (const [character, hand, finger] of expected) {
      const position = keymap.charToPosition.get(character);
      expect(position, `no position for "${character}"`).toBeDefined();
      const key = board.get(position!);
      expect({ character, hand: key?.hand, finger: key?.finger }).toEqual({
        character,
        hand,
        finger,
      });
    }
  });

  it('puts B and V on the two inner index columns', () => {
    const keymap = parse();
    const board = indexKeys(GLOVE80);
    for (const character of ['b', 'v']) {
      const key = board.get(keymap.charToPosition.get(character)!);
      expect(key?.kind).toBe('column');
      expect(key?.finger).toBe('index');
      expect(key && key.kind === 'column' ? key.reach : null).toBe('inner');
    }
  });

  it('puts comma and full stop on the left pinky and ring', () => {
    const keymap = parse();
    const board = indexKeys(GLOVE80);
    const comma = board.get(keymap.charToPosition.get(',')!);
    const stop = board.get(keymap.charToPosition.get('.')!);
    expect({ hand: comma?.hand, finger: comma?.finger }).toEqual({ hand: 'left', finger: 'pinky' });
    expect({ hand: stop?.hand, finger: stop?.finger }).toEqual({ hand: 'left', finger: 'ring' });
  });

  it('puts the apostrophe on the right outer pinky', () => {
    const keymap = parse();
    const key = indexKeys(GLOVE80).get(keymap.charToPosition.get("'")!);
    expect({ hand: key?.hand, finger: key?.finger }).toEqual({ hand: 'right', finger: 'pinky' });
    expect(key && key.kind === 'column' ? key.reach : null).toBe('outer');
  });
});

describe('positions that do not type a character', () => {
  it('records the non-keypress behaviours rather than failing on them', () => {
    const keymap = parse();
    const behaviours = keymap.untypedKeys
      .filter((k) => k.reason === 'not-a-keypress')
      .map((k) => k.behaviour);
    expect(new Set(behaviours)).toEqual(new Set(['&magic', '&lower', '&lt']));
  });

  it('records modifiers and arrows as having no character', () => {
    const keymap = parse();
    const byPosition = new Map(keymap.untypedKeys.map((k) => [k.position, k]));
    // 46 is the left shift, 34 is caps lock, 55 is an arrow key.
    for (const position of [34, 46, 55, 63, 66]) {
      expect(byPosition.get(position), `position ${position} should be untyped`).toBeDefined();
      expect(keymap.positionToChar.has(position)).toBe(false);
    }
  });

  it('accounts for all 80 positions as either typed or untyped', () => {
    const keymap = parse();
    expect(keymap.typedKeys.length + keymap.untypedKeys.length).toBe(80);
    const positions = [...keymap.typedKeys, ...keymap.untypedKeys].map((k) => k.position);
    expect(new Set(positions).size).toBe(80);
  });
});

describe('shift', () => {
  it('finds both shift keys on each hand', () => {
    const keymap = parse();
    expect(keymap.shiftPositions.left).toContain(46);
    expect(keymap.shiftPositions.right).toContain(63);
  });

  it('pairs a shifted character with its unshifted partner on the same position', () => {
    const keymap = parse();
    expect(keymap.shiftPairs.get('A')).toBe('a');
    expect(keymap.charToPosition.get('A')).toBe(keymap.charToPosition.get('a'));
  });

  it('uses the en-GB-mac pairing, so shift-3 is a pound sign and shift-2 an at sign', () => {
    const keymap = parse();
    expect(keymap.shiftPairs.get('£')).toBe('3');
    expect(keymap.shiftPairs.get('@')).toBe('2');
    expect(keymap.shiftPairs.has('#')).toBe(false);
  });

  it('pairs the apostrophe with a double quote', () => {
    const keymap = parse();
    expect(keymap.shiftPairs.get('"')).toBe("'");
  });

  it('never pairs a character the layout does not bind', () => {
    const keymap = parse();
    for (const unshifted of keymap.shiftPairs.values()) {
      expect(keymap.charToPosition.has(unshifted)).toBe(true);
    }
  });
});

describe('a character bound at more than one position', () => {
  it('teaches the space the board recommends and records the other one', () => {
    // This layout binds space at both 51 and 74. The board names 74 as the one
    // a typist should use, so that is where the trainer must send them.
    const keymap = parse();
    expect(keymap.charToPosition.get(' ')).toBe(GLOVE80.spacePosition);
    expect(keymap.duplicates.get(' ')).toEqual([51]);
  });
});

describe('refusing input that cannot be trusted', () => {
  function reject(mutate: (copy: Record<string, unknown>) => void): void {
    const copy = JSON.parse(fixtureText) as Record<string, unknown>;
    mutate(copy);
    expect(() => parseMoErgoLayout(copy, { board: GLOVE80 })).toThrow(InvalidLayoutError);
  }

  it('rejects a non-object', () => {
    expect(() => parseMoErgoLayout(42, { board: GLOVE80 })).toThrow(InvalidLayoutError);
    expect(() => parseMoErgoLayout(null, { board: GLOVE80 })).toThrow(InvalidLayoutError);
  });

  it('rejects a JSON string that was not parsed first', () => {
    expect(() => parseMoErgoLayout(fixtureText, { board: GLOVE80 })).toThrow(/parse it first/);
  });

  it('rejects text that is not JSON, naming the problem', () => {
    expect(() => parseMoErgoLayoutText('{ not json', { board: GLOVE80 })).toThrow(/not valid JSON/);
  });

  it('rejects a layout for a different keyboard', () => {
    reject((copy) => {
      copy['keyboard'] = 'somethingelse';
    });
  });

  it('rejects a layer with the wrong number of positions', () => {
    reject((copy) => {
      const layers = copy['layers'] as unknown[][];
      layers[0] = layers[0]!.slice(0, 79);
    });
  });

  it('rejects a missing locale, because the shift pairing would be a guess', () => {
    reject((copy) => {
      delete copy['locale'];
    });
  });

  it('refuses an unsupported locale rather than guessing the punctuation', () => {
    const copy = JSON.parse(fixtureText) as Record<string, unknown>;
    copy['locale'] = 'de-DE';
    expect(() => parseMoErgoLayout(copy, { board: GLOVE80 })).toThrow(UnsupportedLocaleError);
  });

  it('rejects a malformed binding', () => {
    reject((copy) => {
      const layers = copy['layers'] as unknown[][];
      layers[0]![0] = { notAValue: true };
    });
  });

  it('rejects a keypress with no keycode', () => {
    reject((copy) => {
      const layers = copy['layers'] as unknown[][];
      layers[0]![0] = { value: '&kp', params: [] };
    });
  });

  it('names the layer and position in the message, so a person can find it', () => {
    const copy = JSON.parse(fixtureText) as Record<string, unknown>;
    const layers = copy['layers'] as unknown[][];
    layers[1]![7] = 'nonsense';
    expect(() => parseMoErgoLayout(copy, { board: GLOVE80 })).toThrow(/layer 1, position 7/);
  });
});
