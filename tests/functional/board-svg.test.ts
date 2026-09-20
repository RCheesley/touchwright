/**
 * The board renderer, against a real DOM but no browser.
 *
 * Two things are being guarded here. First, that the renderer draws the geometry
 * it is given and nothing else: the coordinates come from `src/board/glove80.ts`
 * and are pinned by `tests/unit/glove80.test.ts`, so anything this file asserts
 * about position is asserting that the renderer did not move it. Second, that
 * nothing in the renderer is specific to the Glove80 — a four-key invented board
 * has to come out just as correctly.
 *
 * Colour lives in the stylesheet, so it is checked in the browser instead:
 * tests/e2e/board.spec.ts.
 */

import { describe, expect, it } from 'vitest';
import { GLOVE80 } from '../../src/board/index.js';
import {
  describeKey,
  FINGERS,
  indexKeys,
  type BoardDefinition,
  type KeyPosition,
} from '../../src/board/types.js';
import {
  BoardRenderError,
  describeBoardKeys,
  fingersOnBoard,
  renderBoard,
} from '../../src/ui/board-svg.js';

const keys = indexKeys(GLOVE80);

function groups(svg: SVGSVGElement): readonly SVGGElement[] {
  return [...svg.querySelectorAll<SVGGElement>('g[data-position]')];
}

function group(svg: SVGSVGElement, position: number): SVGGElement {
  const found = svg.querySelector<SVGGElement>(`g[data-position="${position}"]`);
  expect(found, `no group drawn for position ${position}`).not.toBeNull();
  return found!;
}

interface Placement {
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
}

/** Reads back what the renderer actually wrote, rather than what it meant to. */
function placement(element: SVGGElement): Placement {
  const transform = element.getAttribute('transform') ?? '';
  const match = /^translate\((-?[\d.]+) (-?[\d.]+)\) rotate\((-?[\d.]+)\)$/.exec(transform);
  expect(match, `unexpected transform ${JSON.stringify(transform)}`).not.toBeNull();
  return {
    x: Number.parseFloat(match![1]!),
    y: Number.parseFloat(match![2]!),
    rotation: Number.parseFloat(match![3]!),
  };
}

/** A board that is not the Glove80, so nothing can pass by knowing the Glove80. */
function tinyBoard(render: Partial<BoardDefinition['render']> = {}): BoardDefinition {
  const boardKeys: readonly KeyPosition[] = [
    {
      kind: 'column',
      index: 0,
      hand: 'left',
      finger: 'index',
      reach: 'natural',
      row: 'home',
      rowOffset: 0,
      column: 0,
      x: 0,
      y: 0,
      rotation: 0,
    },
    {
      kind: 'column',
      index: 1,
      hand: 'right',
      finger: 'index',
      reach: 'natural',
      row: 'home',
      rowOffset: 0,
      column: 0,
      x: 4,
      y: 0,
      rotation: 0,
    },
    {
      kind: 'thumb',
      index: 2,
      hand: 'left',
      finger: 'thumb',
      row: 'thumb',
      arc: 'lower',
      x: 1,
      y: 1.5,
      rotation: 20,
    },
    {
      kind: 'thumb',
      index: 3,
      hand: 'right',
      finger: 'thumb',
      row: 'thumb',
      arc: 'lower',
      x: 3,
      y: 1.5,
      rotation: -20,
    },
  ];

  return {
    id: 'tiny',
    name: 'Tiny test board',
    keyCount: boardKeys.length,
    keys: boardKeys,
    homePositions: [0, 1],
    spacePosition: 3,
    recommendedShift: { left: 0, right: 1 },
    render: { keyPitch: 20, capSize: 16, mirrorAxisX: 2, ...render },
  };
}

describe('drawing a board', () => {
  const svg = renderBoard(GLOVE80);

  it('draws one group per position, in keymap order', () => {
    const positions = groups(svg).map((element) => Number(element.dataset.position));
    expect(positions).toEqual([...Array(GLOVE80.keyCount).keys()]);
  });

  it('places every key at its own coordinates, scaled by the board key pitch', () => {
    for (const key of GLOVE80.keys) {
      const where = placement(group(svg, key.index));
      expect(where.x, `position ${key.index} x`).toBeCloseTo(key.x * GLOVE80.render.keyPitch, 1);
      expect(where.y, `position ${key.index} y`).toBeCloseTo(key.y * GLOVE80.render.keyPitch, 1);
    }
  });

  it('draws the thumb keys at their rotations, and the column keys flat', () => {
    // Values from the pinned geometry, not re-derived: the left upper arc runs
    // 15, 30, 45 degrees and the right arc is its negative.
    expect(placement(group(svg, 52)).rotation).toBe(15);
    expect(placement(group(svg, 53)).rotation).toBe(30);
    expect(placement(group(svg, 54)).rotation).toBe(45);
    expect(placement(group(svg, 57)).rotation).toBe(-15);
    expect(placement(group(svg, 56)).rotation).toBe(-30);
    expect(placement(group(svg, 55)).rotation).toBe(-45);

    for (const key of GLOVE80.keys) {
      if (key.kind === 'column') {
        expect(placement(group(svg, key.index)).rotation, `position ${key.index}`).toBe(0);
      }
    }
  });

  it('mirrors the two halves about the board mirror axis, thumbs included', () => {
    const axis = GLOVE80.render.mirrorAxisX * GLOVE80.render.keyPitch;
    const right = new Map(
      GLOVE80.keys
        .filter((key) => key.hand === 'right')
        .map((key) => [key.index, placement(group(svg, key.index))]),
    );

    for (const key of GLOVE80.keys) {
      if (key.hand !== 'left') continue;
      const mine = placement(group(svg, key.index));
      const partner = [...right.values()].find(
        (other) =>
          Math.abs(other.x - (2 * axis - mine.x)) < 0.5 &&
          Math.abs(other.y - mine.y) < 0.5 &&
          other.rotation === -mine.rotation,
      );
      expect(
        partner,
        `position ${key.index} has no mirrored partner on the right half`,
      ).toBeDefined();
    }
  });

  it('frames the whole board, centred on the mirror axis', () => {
    const viewBox = svg.getAttribute('viewBox') ?? '';
    const [minX, minY, width, height] = viewBox.split(' ').map(Number);
    expect([minX, minY, width, height].every((value) => Number.isFinite(value))).toBe(true);
    expect(width!).toBeGreaterThan(0);
    expect(height!).toBeGreaterThan(0);

    const axis = GLOVE80.render.mirrorAxisX * GLOVE80.render.keyPitch;
    expect(minX! + width! / 2).toBeCloseTo(axis, 1);

    // Nothing is clipped, rotated thumb caps included.
    for (const key of GLOVE80.keys) {
      const where = placement(group(svg, key.index));
      expect(where.x, `position ${key.index}`).toBeGreaterThan(minX!);
      expect(where.x, `position ${key.index}`).toBeLessThan(minX! + width!);
      expect(where.y, `position ${key.index}`).toBeGreaterThan(minY!);
      expect(where.y, `position ${key.index}`).toBeLessThan(minY! + height!);
    }
  });

  it('gives every key its hand, finger and row as data, so the stylesheet needs no board knowledge', () => {
    for (const key of GLOVE80.keys) {
      const element = group(svg, key.index);
      expect(element.dataset.hand).toBe(key.hand);
      expect(element.dataset.finger).toBe(key.finger);
      expect(element.dataset.row).toBe(key.row);
      if (key.kind === 'thumb') {
        expect(element.dataset.arc).toBe(key.arc);
      } else {
        expect(element.dataset.reach).toBe(key.reach);
        expect(element.dataset.column).toBe(String(key.column));
      }
    }
  });

  it('marks the resting positions and no others', () => {
    const marked = groups(svg)
      .filter((element) => element.dataset.home === 'true')
      .map((element) => Number(element.dataset.position));
    expect(marked).toEqual([...GLOVE80.homePositions]);
    expect(svg.querySelectorAll('.board-nub')).toHaveLength(GLOVE80.homePositions.length);
  });

  it('paints a plate behind the keys for the caps to sit on', () => {
    expect(svg.querySelectorAll('.board-plate')).toHaveLength(1);
    expect(svg.querySelectorAll('.board-cap')).toHaveLength(GLOVE80.keyCount);
  });
});

describe('the diagram as an accessibility citizen', () => {
  it('is hidden from assistive technology, because everything it shows is in text', () => {
    const svg = renderBoard(GLOVE80);
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('focusable')).toBe('false');
  });

  it('carries no accessible name or role of its own, so it cannot be read twice', () => {
    const svg = renderBoard(GLOVE80);
    expect(svg.getAttribute('role')).toBeNull();
    expect(svg.getAttribute('aria-label')).toBeNull();
    expect(svg.querySelector('title')).toBeNull();
  });

  it('scales rather than fixing a pixel width, so the page can reflow to 320 pixels', () => {
    const svg = renderBoard(GLOVE80);
    expect(svg.getAttribute('width')).toBeNull();
    expect(svg.getAttribute('height')).toBeNull();
    expect(svg.getAttribute('viewBox')).not.toBeNull();
  });
});

describe('labelling the caps', () => {
  it('writes the character it is given, verbatim', () => {
    const svg = renderBoard(GLOVE80, { labels: new Map([[35, 'a']]) });
    expect(group(svg, 35).querySelector('text')?.textContent).toBe('a');
  });

  it('shows a visible glyph for a space, which would otherwise be a blank cap', () => {
    const svg = renderBoard(GLOVE80, { labels: new Map([[74, ' ']]) });
    expect(group(svg, 74).querySelector('text')?.textContent).toBe('␣');
  });

  it('leaves an unlabelled cap blank rather than inventing a label', () => {
    const svg = renderBoard(GLOVE80, { labels: new Map([[35, 'a']]) });
    expect(group(svg, 36).querySelector('text')).toBeNull();
    expect(svg.querySelectorAll('text')).toHaveLength(1);
  });

  it('sizes a multi-character label down so it stays on the cap', () => {
    const svg = renderBoard(GLOVE80, {
      labels: new Map([
        [35, 'a'],
        [36, 'esc'],
      ]),
    });
    const single = Number(group(svg, 35).querySelector('text')?.getAttribute('font-size'));
    const many = Number(group(svg, 36).querySelector('text')?.getAttribute('font-size'));
    expect(many).toBeLessThan(single);
  });

  it('refuses a label for a position the board does not define', () => {
    expect(() => renderBoard(GLOVE80, { labels: new Map([[999, 'x']]) })).toThrow(BoardRenderError);
    expect(() => renderBoard(GLOVE80, { labels: new Map([[999, 'x']]) })).toThrow(/position 999/);
  });

  it('refuses an empty label, because absent and empty are different things', () => {
    expect(() => renderBoard(GLOVE80, { labels: new Map([[35, '']]) })).toThrow(BoardRenderError);
  });
});

describe('highlighting the next key', () => {
  it('marks exactly one key, and says so in data as well as in a class', () => {
    const svg = renderBoard(GLOVE80, { highlight: 69 });
    const marked = groups(svg).filter((element) => element.dataset.next === 'true');
    expect(marked).toHaveLength(1);
    expect(marked[0]?.dataset.position).toBe('69');
    expect(marked[0]?.getAttribute('class')).toContain('board-key-next');
    expect(svg.querySelectorAll('.board-halo')).toHaveLength(1);
  });

  it('highlights nothing when there is nothing to highlight', () => {
    for (const options of [{}, { highlight: null }]) {
      const svg = renderBoard(GLOVE80, options);
      expect(svg.querySelectorAll('[data-next]')).toHaveLength(0);
      expect(svg.querySelectorAll('.board-halo')).toHaveLength(0);
    }
  });

  it('keeps the finger data on the highlighted key, so the colour still means something', () => {
    const svg = renderBoard(GLOVE80, { highlight: 69 });
    expect(group(svg, 69).dataset.finger).toBe('thumb');
  });

  it('refuses a position the board does not define, rather than highlighting nothing', () => {
    expect(() => renderBoard(GLOVE80, { highlight: 80 })).toThrow(BoardRenderError);
    expect(() => renderBoard(GLOVE80, { highlight: -1 })).toThrow(/does not define/);
    expect(() => renderBoard(GLOVE80, { highlight: 1.5 })).toThrow(/integer/);
  });
});

describe('any board, not this board', () => {
  const tiny = tinyBoard();
  const svg = renderBoard(tiny, { labels: new Map([[0, 'x']]), highlight: 2 });

  it('draws a four-key board with its own pitch and cap size', () => {
    expect(groups(svg)).toHaveLength(4);
    expect(placement(group(svg, 1)).x).toBeCloseTo(4 * 20, 5);
    expect(group(svg, 0).querySelector('.board-cap')?.getAttribute('width')).toBe('16');
  });

  it('names the board it drew, and knows nothing of any other', () => {
    expect(svg.dataset.board).toBe('tiny');
    expect(svg.outerHTML).not.toContain('glove80');
  });

  it('honours that board own mirror axis when framing', () => {
    const [minX, , width] = (svg.getAttribute('viewBox') ?? '').split(' ').map(Number);
    expect(minX! + width! / 2).toBeCloseTo(tiny.render.mirrorAxisX * tiny.render.keyPitch, 5);
  });

  it('rejects render metrics that could not produce a drawing', () => {
    expect(() => renderBoard(tinyBoard({ keyPitch: 0 }))).toThrow(BoardRenderError);
    expect(() => renderBoard(tinyBoard({ capSize: Number.NaN }))).toThrow(/capSize/);
    expect(() => renderBoard(tinyBoard({ keyPitch: -5 }))).toThrow(/keyPitch/);
    expect(() => renderBoard(tinyBoard({ mirrorAxisX: Number.POSITIVE_INFINITY }))).toThrow(
      /mirrorAxisX/,
    );
  });

  it('rejects a board whose positions do not add up, rather than drawing most of it', () => {
    const broken = { ...tinyBoard(), keyCount: 9 };
    expect(() => renderBoard(broken)).toThrow(/invalid/);
  });
});

describe('the text the diagram leans on', () => {
  it('describes every position, in order, in words', () => {
    const rows = describeBoardKeys(GLOVE80);
    expect(rows).toHaveLength(GLOVE80.keyCount);
    expect(rows.map((row) => row.position)).toEqual([...Array(GLOVE80.keyCount).keys()]);
    for (const row of rows) {
      expect(row.description).toBe(describeKey(keys.get(row.position)!));
      expect(row.description.length).toBeGreaterThan(0);
    }
  });

  it('says in words what the highlight and the colour would otherwise say alone', () => {
    const rows = describeBoardKeys(GLOVE80, new Map([[69, 'e']]));
    const e = rows.find((row) => row.position === 69);
    expect(e?.label).toBe('e');
    expect(e?.description).toBe('left thumb, lower arc');
    expect(e?.finger).toBe('thumb');
  });

  it('flags the resting positions, which the diagram marks with a bar', () => {
    const resting = describeBoardKeys(GLOVE80)
      .filter((row) => row.isHome)
      .map((row) => row.position);
    expect(resting).toEqual([...GLOVE80.homePositions]);
  });

  it('reports no label as null rather than as an empty string', () => {
    const rows = describeBoardKeys(GLOVE80, new Map([[35, 'a']]));
    expect(rows.find((row) => row.position === 35)?.label).toBe('a');
    expect(rows.find((row) => row.position === 36)?.label).toBeNull();
  });

  it('applies the same boundary checks as the renderer', () => {
    expect(() => describeBoardKeys(GLOVE80, new Map([[999, 'x']]))).toThrow(BoardRenderError);
  });

  it('lists the fingers a board uses, in a stable order, for the legend to name', () => {
    expect(fingersOnBoard(GLOVE80)).toEqual([...FINGERS]);
    expect(fingersOnBoard(tinyBoard())).toEqual(['index', 'thumb']);
  });
});
