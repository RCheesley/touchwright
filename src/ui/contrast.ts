/**
 * WCAG contrast maths.
 *
 * Here because the prototype shipped an outline button that rendered white on
 * white: a theme rule with higher specificity than the button's own colour won,
 * and nothing caught it. Colour choices get a test like anything else.
 *
 * The ratios come from WCAG 2.2: 4.5:1 for body text, 3:1 for large text and for
 * non-text such as a focus ring, a key cap border or a finger colour.
 */

export const AA_TEXT = 4.5;
export const AA_LARGE_TEXT = 3;
export const AA_NON_TEXT = 3;

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export class UnreadableColourError extends Error {
  override readonly name = 'UnreadableColourError';
  constructor(value: string) {
    super(`Could not read a colour from ${JSON.stringify(value)}`);
  }
}

function clampChannel(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(255, Math.max(0, Math.round(value)));
}

/**
 * Parses the forms a browser actually hands back from getComputedStyle, plus hex
 * for values written in a stylesheet. Throws rather than defaulting to black,
 * because a silently wrong colour is how the original bug survived.
 */
export function parseColour(value: string): Rgb {
  const input = value.trim().toLowerCase();

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(input);
  if (hex?.[1] !== undefined) {
    const digits = hex[1];
    const short = digits.length <= 4;
    const pair = (index: number): number => {
      const slice = short
        ? digits.slice(index, index + 1).repeat(2)
        : digits.slice(index * 2, index * 2 + 2);
      return Number.parseInt(slice, 16);
    };
    return { r: clampChannel(pair(0)), g: clampChannel(pair(1)), b: clampChannel(pair(2)) };
  }

  const rgb = /^rgba?\(([^)]+)\)$/.exec(input);
  if (rgb?.[1] !== undefined) {
    const parts = rgb[1]
      .split(/[\s,/]+/)
      .filter((part) => part.length > 0)
      .map((part) =>
        part.endsWith('%') ? (Number.parseFloat(part) / 100) * 255 : Number.parseFloat(part),
      );
    const [r, g, b] = parts;
    if (r === undefined || g === undefined || b === undefined) {
      throw new UnreadableColourError(value);
    }
    return { r: clampChannel(r), g: clampChannel(g), b: clampChannel(b) };
  }

  throw new UnreadableColourError(value);
}

/** WCAG relative luminance. */
export function relativeLuminance(colour: Rgb): number {
  const channel = (raw: number): number => {
    const c = clampChannel(raw) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(colour.r) + 0.7152 * channel(colour.g) + 0.0722 * channel(colour.b);
}

/** Contrast ratio, between 1 and 21. Order of the arguments does not matter. */
export function contrastRatio(a: Rgb | string, b: Rgb | string): number {
  const first = typeof a === 'string' ? parseColour(a) : a;
  const second = typeof b === 'string' ? parseColour(b) : b;
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

export function meetsContrast(
  foreground: Rgb | string,
  background: Rgb | string,
  required: number = AA_TEXT,
): boolean {
  return contrastRatio(foreground, background) >= required;
}
