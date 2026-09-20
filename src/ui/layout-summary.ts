/**
 * Turns a parsed keymap into the rows of a summary list.
 *
 * DOM-free so it can be tested without a browser. The UI only has to render the
 * pairs this returns.
 */

import { describeKey, indexKeys, type BoardDefinition } from '../board/types.js';
import type { Keymap } from '../keymap/types.js';

export interface SummaryRow {
  readonly term: string;
  readonly detail: string;
}

export function summariseKeymap(keymap: Keymap, board: BoardDefinition): readonly SummaryRow[] {
  const keys = indexKeys(board);

  const homeCharacters = board.homePositions
    .map((position) => keymap.positionToChar.get(position) ?? '·')
    .join(' ');

  const rows: SummaryRow[] = [
    { term: 'Layout', detail: keymap.title },
    { term: 'Keyboard', detail: board.name },
    { term: 'Host locale', detail: keymap.localeId },
    { term: 'Layers', detail: keymap.layerNames.join(', ') },
    { term: 'Home keys', detail: homeCharacters },
    { term: 'Keys that type a character', detail: String(keymap.typedKeys.length) },
  ];

  // Where E sits is the single most telling thing about a layout, because moving
  // it off the fingers is the whole idea behind several of them.
  const ePosition = keymap.charToPosition.get('e');
  if (ePosition !== undefined) {
    const key = keys.get(ePosition);
    rows.push({
      term: 'E is on',
      detail: key === undefined ? `position ${ePosition}` : describeKey(key),
    });
  }

  const spacePosition = keymap.charToPosition.get(' ');
  if (spacePosition !== undefined) {
    const key = keys.get(spacePosition);
    const others = keymap.duplicates.get(' ') ?? [];
    const also = others.length > 0 ? ` (this board has ${others.length + 1} space keys)` : '';
    rows.push({
      term: 'Space is on',
      detail: `${key === undefined ? `position ${spacePosition}` : describeKey(key)}${also}`,
    });
  }

  return rows;
}
