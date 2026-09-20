import { describe, expect, it } from 'vitest';
import {
  AA_NON_TEXT,
  AA_TEXT,
  contrastRatio,
  meetsContrast,
  parseColour,
  relativeLuminance,
  UnreadableColourError,
} from '../../src/ui/contrast.js';

describe('parsing colours', () => {
  it('reads the rgb forms a browser returns', () => {
    expect(parseColour('rgb(255, 255, 255)')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseColour('rgba(0, 0, 0, 0.5)')).toEqual({ r: 0, g: 0, b: 0 });
    expect(parseColour('rgb(18 18 18 / 100%)')).toEqual({ r: 18, g: 18, b: 18 });
  });

  it('reads hex, short and long', () => {
    expect(parseColour('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseColour('#1a2b3c')).toEqual({ r: 26, g: 43, b: 60 });
    expect(parseColour('#1a2b3cff')).toEqual({ r: 26, g: 43, b: 60 });
  });

  it('throws rather than defaulting to black, which is how the original bug hid', () => {
    expect(() => parseColour('rebeccapurple')).toThrow(UnreadableColourError);
    expect(() => parseColour('')).toThrow(UnreadableColourError);
    expect(() => parseColour('var(--surface)')).toThrow(UnreadableColourError);
  });
});

describe('contrast ratios', () => {
  it('puts black on white at 21 to 1', () => {
    expect(contrastRatio('#000', '#fff')).toBeCloseTo(21, 2);
  });

  it('puts a colour against itself at 1 to 1', () => {
    expect(contrastRatio('#7f7f7f', '#7f7f7f')).toBeCloseTo(1, 5);
  });

  it('does not care which argument is which', () => {
    expect(contrastRatio('#123456', '#fedcba')).toBeCloseTo(contrastRatio('#fedcba', '#123456'), 9);
  });

  it('catches white on white, the failure this exists for', () => {
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    expect(meetsContrast('#ffffff', '#ffffff', AA_TEXT)).toBe(false);
    expect(meetsContrast('#ffffff', '#ffffff', AA_NON_TEXT)).toBe(false);
  });

  it('applies the WCAG luminance curve', () => {
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBeCloseTo(0, 6);
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 6);
    // Green carries most of the weight.
    expect(relativeLuminance({ r: 0, g: 255, b: 0 })).toBeGreaterThan(
      relativeLuminance({ r: 255, g: 0, b: 0 }),
    );
  });

  it('measures against the AA thresholds', () => {
    expect(AA_TEXT).toBe(4.5);
    expect(AA_NON_TEXT).toBe(3);
    expect(meetsContrast('#595959', '#ffffff', AA_TEXT)).toBe(true);
    expect(meetsContrast('#949494', '#ffffff', AA_TEXT)).toBe(false);
    expect(meetsContrast('#949494', '#ffffff', AA_NON_TEXT)).toBe(true);
  });
});
