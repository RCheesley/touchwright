/**
 * Parse a MoErgo Layout Editor JSON export into a Keymap.
 *
 * The input is a file a user chose, so nothing about it is trusted. Structural
 * problems throw InvalidLayoutError with a message a person can act on;
 * positions that simply do not type a character are recorded, not treated as
 * errors, because most of a keymap is modifiers and layer keys.
 *
 * Only `&kp` is read as character-producing in this version. Hold-taps and
 * macros can type too, and the seam for them is `readBinding`.
 */

import type { BoardDefinition, Hand } from '../board/types.js';
import { getLocale } from './locales.js';
import {
  InvalidLayoutError,
  type KeyBinding,
  type Keymap,
  type TypedKey,
  type UntypedKey,
} from './types.js';

const SHIFT_KEYCODES: Readonly<Record<string, Hand>> = {
  LSHFT: 'left',
  LEFT_SHIFT: 'left',
  RSHFT: 'right',
  RIGHT_SHIFT: 'right',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(source: Record<string, unknown>, field: string, fallback: string): string {
  const value = source[field];
  return typeof value === 'string' ? value : fallback;
}

/** Normalise one layer entry. Shape is checked here so callers can assume it. */
function readBinding(raw: unknown, layerIndex: number, position: number): KeyBinding {
  const where = `layer ${layerIndex}, position ${position}`;

  if (!isRecord(raw)) {
    throw new InvalidLayoutError(`${where} is not an object`);
  }
  const behaviour = raw['value'];
  if (typeof behaviour !== 'string' || behaviour.length === 0) {
    throw new InvalidLayoutError(`${where} has no behaviour name`);
  }

  const rawParams = raw['params'];
  if (rawParams === undefined || rawParams === null) {
    return { behaviour, params: [] };
  }
  if (!Array.isArray(rawParams)) {
    throw new InvalidLayoutError(`${where} has a "params" that is not an array`);
  }

  const params: string[] = [];
  for (const param of rawParams) {
    // Params nest (&kp with a modifier wraps another param). One level is all
    // this version reads; deeper ones are recorded as untyped rather than guessed.
    if (isRecord(param) && typeof param['value'] === 'string') {
      params.push(param['value']);
    } else if (typeof param === 'string') {
      params.push(param);
    } else if (isRecord(param) && typeof param['value'] === 'number') {
      params.push(String(param['value']));
    }
  }
  return { behaviour, params };
}

export interface ParseOptions {
  /** Used to resolve a character bound at several positions, and to check length. */
  readonly board: BoardDefinition;
}

export function parseMoErgoLayout(input: unknown, options: ParseOptions): Keymap {
  const { board } = options;

  if (typeof input === 'string') {
    throw new InvalidLayoutError('expected parsed JSON, not a string; parse it first');
  }
  if (!isRecord(input)) {
    throw new InvalidLayoutError('the file is not a JSON object');
  }

  const keyboard = readString(input, 'keyboard', '');
  if (keyboard === '') {
    throw new InvalidLayoutError('no "keyboard" field, so the board is unknown');
  }
  if (keyboard !== board.id) {
    throw new InvalidLayoutError(
      `the layout is for "${keyboard}" but it is being read as a "${board.id}"`,
    );
  }

  const rawLayers = input['layers'];
  if (!Array.isArray(rawLayers) || rawLayers.length === 0) {
    throw new InvalidLayoutError('no layers');
  }

  const layers: KeyBinding[][] = rawLayers.map((rawLayer, layerIndex) => {
    if (!Array.isArray(rawLayer)) {
      throw new InvalidLayoutError(`layer ${layerIndex} is not an array`);
    }
    if (rawLayer.length !== board.keyCount) {
      throw new InvalidLayoutError(
        `layer ${layerIndex} has ${rawLayer.length} positions, but a ${board.name} has ${board.keyCount}`,
      );
    }
    return rawLayer.map((raw, position) => readBinding(raw, layerIndex, position));
  });

  const base = layers[0];
  if (base === undefined) {
    throw new InvalidLayoutError('no base layer');
  }

  const localeId = readString(input, 'locale', '');
  if (localeId === '') {
    throw new InvalidLayoutError('no "locale" field, so the shift pairing is unknown');
  }
  const locale = getLocale(localeId);

  const rawLayerNames = input['layer_names'];
  const givenNames: readonly unknown[] = Array.isArray(rawLayerNames)
    ? (rawLayerNames as unknown[])
    : [];
  const layerNames = layers.map((_, index) => {
    const name = givenNames[index];
    return typeof name === 'string' && name.length > 0 ? name : `Layer ${index}`;
  });

  const typedKeys: TypedKey[] = [];
  const untypedKeys: UntypedKey[] = [];
  const shiftPositions: Record<Hand, number[]> = { left: [], right: [] };
  /** Every position each character appears at, in position order. */
  const positionsByChar = new Map<string, number[]>();

  base.forEach((binding, position) => {
    const keycode = binding.params[0] ?? null;

    if (binding.behaviour !== '&kp') {
      untypedKeys.push({
        position,
        behaviour: binding.behaviour,
        keycode,
        reason: 'not-a-keypress',
      });
      return;
    }
    if (keycode === null) {
      throw new InvalidLayoutError(`layer 0, position ${position} is a "&kp" with no keycode`);
    }

    const shiftHand = SHIFT_KEYCODES[keycode];
    if (shiftHand !== undefined) {
      shiftPositions[shiftHand].push(position);
    }

    const character = locale.keycodes[keycode];
    if (character === undefined) {
      untypedKeys.push({
        position,
        behaviour: binding.behaviour,
        keycode,
        reason: 'no-character-for-keycode',
      });
      return;
    }

    typedKeys.push({ position, keycode, character });
    const seen = positionsByChar.get(character);
    if (seen === undefined) {
      positionsByChar.set(character, [position]);
    } else {
      seen.push(position);
    }
  });

  const positionToChar = new Map(typedKeys.map((key) => [key.position, key.character]));
  const charToPosition = new Map<string, number>();
  const duplicates = new Map<string, readonly number[]>();

  for (const [character, positions] of positionsByChar) {
    // A board with two space bars is normal. Prefer the one the board says a
    // typist should use, so the trainer teaches the ergonomic choice.
    const preferred = positions.includes(board.spacePosition) ? board.spacePosition : positions[0];
    if (preferred === undefined) {
      throw new InvalidLayoutError(`character "${character}" was recorded with no position`);
    }
    charToPosition.set(character, preferred);
    if (positions.length > 1) {
      duplicates.set(
        character,
        positions.filter((position) => position !== preferred),
      );
    }
  }

  // Shift pairing comes from the locale, applied only to characters this layout
  // actually binds. A shifted character lives at its unshifted partner's position.
  const shiftPairs = new Map<string, string>();
  for (const [unshifted, shifted] of Object.entries(locale.shift)) {
    const position = charToPosition.get(unshifted);
    if (position === undefined) continue;
    shiftPairs.set(shifted, unshifted);
    if (!charToPosition.has(shifted)) {
      charToPosition.set(shifted, position);
    }
  }

  return {
    boardId: keyboard,
    title: readString(input, 'title', 'Untitled layout'),
    localeId,
    layerNames,
    layers,
    typedKeys,
    untypedKeys,
    positionToChar,
    charToPosition,
    shiftPairs,
    shiftPositions: { left: shiftPositions.left, right: shiftPositions.right },
    duplicates,
  };
}

/** Convenience for the file-upload path, where the input is text. */
export function parseMoErgoLayoutText(text: string, options: ParseOptions): Keymap {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new InvalidLayoutError(
      `the file is not valid JSON (${cause instanceof Error ? cause.message : 'unknown error'})`,
      { cause },
    );
  }
  return parseMoErgoLayout(parsed, options);
}
