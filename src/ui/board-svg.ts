/**
 * Draws a board definition as an SVG.
 *
 * Nothing here knows about any particular keyboard. Everything comes from the
 * definition: the key coordinates, the rotations, the mirror axis, the key pitch
 * and the cap size. A second board is a data file, not a change to this module.
 *
 * The geometry is not re-derived here and must not be. `src/board/glove80.ts`
 * holds the measured numbers and `tests/unit/glove80.test.ts` pins them; this
 * module only multiplies them by the pitch and draws what it is told.
 *
 * Accessibility: the SVG is decorative reinforcement, marked `aria-hidden`, so
 * every fact it shows has to exist in text elsewhere on the page. `describeKey`
 * is what provides that, and `describeBoardKeys` below hands the caller the rows
 * to render. The highlight is reinforcement of a text readout, never the only way
 * to know which key is next, and finger identity is carried by the legend's words
 * rather than by its colours.
 */

import {
  assertValidBoard,
  describeKey,
  FINGERS,
  indexKeys,
  type BoardDefinition,
  type Finger,
  type KeyPosition,
} from '../board/types.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Breathing room around the keys, as a fraction of a cap. */
const PADDING_RATIO = 0.4;
/** Cap label size, as a fraction of a cap. Smaller when a label is more than one character. */
const LABEL_RATIO = 0.44;
const LONG_LABEL_RATIO = 0.24;
const CORNER_RATIO = 0.14;
/** How far outside the cap the next-key halo sits, and how wide it is drawn. */
const HALO_GAP_RATIO = 0.13;
const HALO_WIDTH_RATIO = 0.07;
const CAP_STROKE_RATIO = 0.06;
/** The bar across the home keys: a reach of the cap's width, near its front edge. */
const NUB_REACH_RATIO = 0.17;
const NUB_DEPTH_RATIO = 0.3;
const NUB_WIDTH_RATIO = 0.055;

/** Shown in place of a label that is only whitespace, so a space bar is not blank. */
const OPEN_BOX = '␣';

export class BoardRenderError extends Error {
  override readonly name = 'BoardRenderError';
  constructor(boardId: string, problem: string, options?: ErrorOptions) {
    super(`Cannot render board "${boardId}": ${problem}`, options);
  }
}

export interface RenderBoardOptions {
  /** Position to the character shown on that cap. A position with no entry is drawn blank. */
  readonly labels?: ReadonlyMap<number, string>;
  /** Position of the next key. Null or absent highlights nothing. */
  readonly highlight?: number | null;
}

interface Metrics {
  readonly keyPitch: number;
  readonly capSize: number;
  readonly mirrorAxisX: number;
}

interface ViewBox {
  readonly minX: number;
  readonly minY: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Render metrics are checked rather than trusted. A pitch of zero would collapse
 * every key onto the same point and a non-finite one would produce an SVG the
 * browser silently refuses to draw, which is the kind of failure this project has
 * already paid for once.
 */
function readMetrics(board: BoardDefinition): Metrics {
  const { keyPitch, capSize, mirrorAxisX } = board.render;

  for (const [name, value] of [
    ['keyPitch', keyPitch],
    ['capSize', capSize],
  ] as const) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new BoardRenderError(
        board.id,
        `render.${name} must be a positive, finite number, but it is ${value}`,
      );
    }
  }
  if (!Number.isFinite(mirrorAxisX)) {
    throw new BoardRenderError(
      board.id,
      `render.mirrorAxisX must be a finite number, but it is ${mirrorAxisX}`,
    );
  }

  return { keyPitch, capSize, mirrorAxisX };
}

/**
 * Half the width of a square cap's upright bounding box once it is rotated. The
 * thumb clusters are rotated, so ignoring this clips them at the edge of the
 * viewBox.
 */
function rotatedHalfExtent(capSize: number, rotationDegrees: number): number {
  const radians = (rotationDegrees * Math.PI) / 180;
  return (capSize / 2) * (Math.abs(Math.cos(radians)) + Math.abs(Math.sin(radians)));
}

/**
 * The box that holds every cap, padded, and centred on the board's mirror axis
 * where that axis falls inside the board. Centring on it is what makes the two
 * halves sit symmetrically in the frame rather than drifting to one side.
 */
function computeViewBox(board: BoardDefinition, metrics: Metrics): ViewBox {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const key of board.keys) {
    const centreX = key.x * metrics.keyPitch;
    const centreY = key.y * metrics.keyPitch;
    const extent = rotatedHalfExtent(metrics.capSize, key.rotation);
    minX = Math.min(minX, centreX - extent);
    maxX = Math.max(maxX, centreX + extent);
    minY = Math.min(minY, centreY - extent);
    maxY = Math.max(maxY, centreY + extent);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    // assertValidBoard has already rejected a non-finite coordinate and a
    // keyCount of zero, so this is unreachable by a valid board. It stays
    // because an unreachable throw is cheaper than a silently empty diagram.
    throw new BoardRenderError(board.id, 'has no keys to draw');
  }

  const padding = metrics.capSize * PADDING_RATIO;
  minX -= padding;
  maxX += padding;
  minY -= padding;
  maxY += padding;

  const axis = metrics.mirrorAxisX * metrics.keyPitch;
  if (axis > minX && axis < maxX) {
    const half = Math.max(axis - minX, maxX - axis);
    minX = axis - half;
    maxX = axis + half;
  }

  return { minX, minY, width: maxX - minX, height: maxY - minY };
}

/** Two decimals is plenty at this scale, and it keeps the markup readable. */
function round(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

function svgElement<K extends keyof SVGElementTagNameMap>(
  name: K,
  attributes: Readonly<Record<string, string>>,
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, name);
  for (const [attribute, value] of Object.entries(attributes)) {
    element.setAttribute(attribute, value);
  }
  return element;
}

/**
 * Labels are caller data crossing into the renderer, so they are checked here. A
 * label for a position the board does not define means the keymap and the board
 * have drifted apart, and drawing 79 of 80 caps while quietly dropping the
 * eightieth would hide that.
 */
function checkLabels(
  board: BoardDefinition,
  keys: ReadonlyMap<number, KeyPosition>,
  labels: ReadonlyMap<number, string>,
): void {
  for (const [position, label] of labels) {
    if (!keys.has(position)) {
      throw new BoardRenderError(
        board.id,
        `a label was given for position ${position}, which the board does not define`,
      );
    }
    if (label.length === 0) {
      throw new BoardRenderError(
        board.id,
        `the label for position ${position} is empty; omit the position instead of labelling it with nothing`,
      );
    }
  }
}

function resolveHighlight(
  board: BoardDefinition,
  keys: ReadonlyMap<number, KeyPosition>,
  highlight: number | null | undefined,
): number | null {
  if (highlight === null || highlight === undefined) return null;
  if (!Number.isInteger(highlight)) {
    throw new BoardRenderError(
      board.id,
      `the highlighted position must be an integer, but it is ${highlight}`,
    );
  }
  if (!keys.has(highlight)) {
    throw new BoardRenderError(
      board.id,
      `position ${highlight} was highlighted, but the board does not define it`,
    );
  }
  return highlight;
}

/** What to paint on a cap: whitespace becomes visible, everything else is verbatim. */
function capText(label: string): string {
  return label.trim().length === 0 ? OPEN_BOX : label;
}

function keyDataAttributes(key: KeyPosition): Record<string, string> {
  const shared: Record<string, string> = {
    'data-position': String(key.index),
    'data-hand': key.hand,
    'data-finger': key.finger,
    'data-row': key.row,
  };
  if (key.kind === 'thumb') return { ...shared, 'data-arc': key.arc };
  return { ...shared, 'data-reach': key.reach, 'data-column': String(key.column) };
}

/**
 * Renders the board. The returned element is `aria-hidden`, which is only
 * legitimate because `describeBoardKeys` and the page's own readouts put the same
 * facts in text.
 */
export function renderBoard(
  board: BoardDefinition,
  options: RenderBoardOptions = {},
): SVGSVGElement {
  // The board crosses into the renderer from outside, so it is validated here
  // even though the registry validates it too. Inside this boundary the types
  // can be trusted.
  assertValidBoard(board);

  const metrics = readMetrics(board);
  const keys = indexKeys(board);
  const labels = options.labels ?? new Map<number, string>();
  checkLabels(board, keys, labels);
  const highlight = resolveHighlight(board, keys, options.highlight);

  const box = computeViewBox(board, metrics);
  const { capSize } = metrics;
  const half = capSize / 2;

  const svg = svgElement('svg', {
    xmlns: SVG_NS,
    class: 'board',
    viewBox: `${round(box.minX)} ${round(box.minY)} ${round(box.width)} ${round(box.height)}`,
    preserveAspectRatio: 'xMidYMid meet',
    // Decorative: everything it shows is in text. Not focusable, so the diagram
    // never appears in the tab order in the browsers that would otherwise let it.
    'aria-hidden': 'true',
    focusable: 'false',
    'data-board': board.id,
  });

  svg.append(
    svgElement('rect', {
      class: 'board-plate',
      x: round(box.minX),
      y: round(box.minY),
      width: round(box.width),
      height: round(box.height),
      rx: round(capSize * CORNER_RATIO * 2),
    }),
  );

  const homePositions = new Set(board.homePositions);
  const layer = svgElement('g', { class: 'board-keys' });

  // Sorted so the DOM order is the keymap order whatever order the definition
  // listed its keys in. A test that reads the nth group then means something.
  for (const key of [...board.keys].sort((a, b) => a.index - b.index)) {
    const isNext = key.index === highlight;
    const group = svgElement('g', {
      ...keyDataAttributes(key),
      class: `board-key${isNext ? ' board-key-next' : ''}`,
      transform: `translate(${round(key.x * metrics.keyPitch)} ${round(key.y * metrics.keyPitch)}) rotate(${round(key.rotation)})`,
      ...(isNext ? { 'data-next': 'true' } : {}),
      ...(homePositions.has(key.index) ? { 'data-home': 'true' } : {}),
    });

    group.append(
      svgElement('rect', {
        class: 'board-cap',
        x: round(-half),
        y: round(-half),
        width: round(capSize),
        height: round(capSize),
        rx: round(capSize * CORNER_RATIO),
        'stroke-width': round(capSize * CAP_STROKE_RATIO),
      }),
    );

    if (isNext) {
      const gap = capSize * HALO_GAP_RATIO;
      group.append(
        svgElement('rect', {
          class: 'board-halo',
          x: round(-half - gap),
          y: round(-half - gap),
          width: round(capSize + gap * 2),
          height: round(capSize + gap * 2),
          rx: round(capSize * CORNER_RATIO + gap),
          'stroke-width': round(capSize * HALO_WIDTH_RATIO),
        }),
      );
    }

    if (homePositions.has(key.index)) {
      const reach = capSize * NUB_REACH_RATIO;
      const depth = half - capSize * NUB_DEPTH_RATIO * 0.5;
      group.append(
        svgElement('line', {
          class: 'board-nub',
          x1: round(-reach),
          y1: round(depth),
          x2: round(reach),
          y2: round(depth),
          'stroke-width': round(capSize * NUB_WIDTH_RATIO),
        }),
      );
    }

    const label = labels.get(key.index);
    if (label !== undefined) {
      const text = capText(label);
      const size = capSize * (text.length > 1 ? LONG_LABEL_RATIO : LABEL_RATIO);
      const element = svgElement('text', {
        class: 'board-label',
        x: '0',
        y: '0',
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
        // A presentation attribute rather than a stylesheet rule, because the
        // size has to follow the board's own cap size, not a fixed pixel value.
        'font-size': round(size),
      });
      element.textContent = text;
      group.append(element);
    }

    layer.append(group);
  }

  svg.append(layer);
  return svg;
}

export interface BoardKeyDescription {
  readonly position: number;
  /** The character on the cap, or null where the diagram draws a blank cap. */
  readonly label: string | null;
  /** Hand, finger and row in words: the same fact the colour and position carry. */
  readonly description: string;
  readonly finger: Finger;
  readonly isHome: boolean;
}

/**
 * The text equivalent of the diagram, in keymap order.
 *
 * This is the other half of marking the SVG `aria-hidden`. Every cap the diagram
 * draws appears here, labelled or not, described in words.
 */
export function describeBoardKeys(
  board: BoardDefinition,
  labels: ReadonlyMap<number, string> = new Map<number, string>(),
): readonly BoardKeyDescription[] {
  assertValidBoard(board);
  const keys = indexKeys(board);
  checkLabels(board, keys, labels);
  const homePositions = new Set(board.homePositions);

  return [...board.keys]
    .sort((a, b) => a.index - b.index)
    .map((key) => ({
      position: key.index,
      label: labels.get(key.index) ?? null,
      description: describeKey(key),
      finger: key.finger,
      isHome: homePositions.has(key.index),
    }));
}

/**
 * The fingers this board actually uses, in a stable order, so a legend can name
 * them without assuming any particular board uses all five.
 */
export function fingersOnBoard(board: BoardDefinition): readonly Finger[] {
  const used = new Set(board.keys.map((key) => key.finger));
  return FINGERS.filter((finger) => used.has(finger));
}
