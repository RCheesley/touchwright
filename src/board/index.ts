/**
 * Board registry.
 *
 * Adding a board means adding it here and to docs/board-definitions.md. Nothing
 * else in the app may hard-code a board id.
 */

import { GLOVE80 } from './glove80.js';
import { assertValidBoard, type BoardDefinition } from './types.js';

const REGISTRY = new Map<string, BoardDefinition>();

export function registerBoard(board: BoardDefinition): void {
  assertValidBoard(board);
  if (REGISTRY.has(board.id)) {
    throw new Error(`A board with id "${board.id}" is already registered`);
  }
  REGISTRY.set(board.id, board);
}

export class UnknownBoardError extends Error {
  override readonly name = 'UnknownBoardError';
  constructor(
    readonly boardId: string,
    known: readonly string[],
  ) {
    super(
      `No board definition for "${boardId}". Known boards: ${known.length > 0 ? known.join(', ') : 'none'}.`,
    );
  }
}

/** Throws rather than returning undefined: a missing board is never recoverable. */
export function getBoard(boardId: string): BoardDefinition {
  const board = REGISTRY.get(boardId);
  if (board === undefined) {
    throw new UnknownBoardError(boardId, [...REGISTRY.keys()]);
  }
  return board;
}

export function knownBoardIds(): readonly string[] {
  return [...REGISTRY.keys()];
}

registerBoard(GLOVE80);

export { GLOVE80 };
export * from './types.js';
