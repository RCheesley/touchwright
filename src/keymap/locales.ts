/**
 * Host locale tables.
 *
 * ZMK keycodes are positional, named after a US board. What a position actually
 * types depends on the host's keyboard locale, so the keycode-to-character
 * mapping and the shift pairing both belong to the locale and must be read from
 * the layout rather than assumed. en-GB-mac puts @ on 2 and £ on 3, which is not
 * what some other UK mappings do.
 */

export interface Locale {
  readonly id: string;
  readonly name: string;
  /** ZMK keycode -> the character it types unshifted. */
  readonly keycodes: Readonly<Record<string, string>>;
  /** Unshifted character -> the character shift produces. */
  readonly shift: Readonly<Record<string, string>>;
}

const LETTERS: Record<string, string> = {};
const LETTER_SHIFTS: Record<string, string> = {};
for (const letter of 'abcdefghijklmnopqrstuvwxyz') {
  LETTERS[letter.toUpperCase()] = letter;
  LETTER_SHIFTS[letter] = letter.toUpperCase();
}

const DIGITS: Record<string, string> = {
  N1: '1',
  N2: '2',
  N3: '3',
  N4: '4',
  N5: '5',
  N6: '6',
  N7: '7',
  N8: '8',
  N9: '9',
  N0: '0',
};

const SHARED_PUNCTUATION: Record<string, string> = {
  MINUS: '-',
  EQUAL: '=',
  LBKT: '[',
  RBKT: ']',
  SQT: "'",
  COMMA: ',',
  DOT: '.',
  SEMI: ';',
  GRAVE: '`',
  BSLH: '\\',
  FSLH: '/',
  SPACE: ' ',
};

const SHARED_SHIFTS: Record<string, string> = {
  ...LETTER_SHIFTS,
  '1': '!',
  '2': '@',
  '4': '$',
  '5': '%',
  '6': '^',
  '7': '&',
  '8': '*',
  '9': '(',
  '0': ')',
  '-': '_',
  '=': '+',
  '[': '{',
  ']': '}',
  '\\': '|',
  ';': ':',
  "'": '"',
  ',': '<',
  '.': '>',
  '/': '?',
  '`': '~',
};

const EN_GB_MAC: Locale = {
  id: 'en-GB-mac',
  name: 'English (UK), macOS',
  keycodes: { ...LETTERS, ...DIGITS, ...SHARED_PUNCTUATION },
  // The one that differs: shift-3 is a pound sign, not a hash.
  shift: { ...SHARED_SHIFTS, '3': '£' },
};

const EN_US: Locale = {
  id: 'en-US',
  name: 'English (US)',
  keycodes: { ...LETTERS, ...DIGITS, ...SHARED_PUNCTUATION },
  shift: { ...SHARED_SHIFTS, '3': '#' },
};

const LOCALES: ReadonlyMap<string, Locale> = new Map(
  [EN_GB_MAC, EN_US].map((locale) => [locale.id, locale]),
);

export class UnsupportedLocaleError extends Error {
  override readonly name = 'UnsupportedLocaleError';
  constructor(
    readonly localeId: string,
    known: readonly string[],
  ) {
    super(
      `Layout locale "${localeId}" is not supported yet. Supported: ${known.join(', ')}. ` +
        `Add it in src/keymap/locales.ts; see docs/board-definitions.md.`,
    );
  }
}

/**
 * Throws rather than falling back to a default locale. Guessing the punctuation
 * mapping would silently teach the wrong keys, which is worse than refusing the
 * file.
 */
export function getLocale(localeId: string): Locale {
  const locale = LOCALES.get(localeId);
  if (locale === undefined) {
    throw new UnsupportedLocaleError(localeId, [...LOCALES.keys()]);
  }
  return locale;
}

export function knownLocaleIds(): readonly string[] {
  return [...LOCALES.keys()];
}

export { EN_GB_MAC, EN_US };
