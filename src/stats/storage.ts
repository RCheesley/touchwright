/**
 * Progress persistence.
 *
 * Deliberately narrow: three methods, all synchronous, all string in and string
 * out. That is enough for localStorage today and small enough that a sync
 * backend could be added behind it without touching anything else.
 *
 * Two hard-won rules are enforced here rather than left to callers.
 *
 * Per-key statistics are keyed by code point, never by the character itself.
 * Keying by the character meant that a full stop or a space became a field name,
 * and some stores reject those, so the write failed with no error.
 *
 * Everything loaded is deep-copied before it reaches live state. Progress that
 * arrives from an external store can be deeply frozen, and merging a frozen
 * object into live state made the stats immutable, so the first keystroke threw
 * inside the recorder.
 */

export interface StorageDriver {
  read(key: string): string | null;
  write(key: string, value: string): void;
  remove(key: string): void;
}

export const STORAGE_KEY = 'touchwright.progress.v1';
export const PROGRESS_VERSION = 1;

export interface KeyStat {
  hits: number;
  misses: number;
  /** Total time spent on correct presses, for a mean that ignores misses. */
  totalMs: number;
  samples: number;
}

export interface Progress {
  version: typeof PROGRESS_VERSION;
  /** Index into the generated ladder. */
  lesson: number;
  xp: number;
  /** Lesson id -> best star count. */
  stars: Record<string, number>;
  /** Code-point key -> statistics. Never keyed by the character. */
  keyStats: Record<string, KeyStat>;
}

export function emptyProgress(): Progress {
  return { version: PROGRESS_VERSION, lesson: 0, xp: 0, stars: {}, keyStats: {} };
}

/**
 * Code-point key for a single character. Uses the full code point so that
 * characters outside the BMP round-trip.
 */
export function keyStatId(character: string): string {
  const codePoint = character.codePointAt(0);
  if (codePoint === undefined) {
    throw new RangeError('keyStatId needs a non-empty string');
  }
  // Reject a multi-character string rather than silently keying on its first
  // code point, which would merge two different keys' statistics.
  if (String.fromCodePoint(codePoint) !== character) {
    throw new RangeError(`keyStatId needs exactly one character, got ${JSON.stringify(character)}`);
  }
  return `cp${codePoint.toString(10)}`;
}

export function characterFromKeyStatId(id: string): string {
  const match = /^cp(\d+)$/.exec(id);
  if (match?.[1] === undefined) {
    throw new RangeError(`Not a key-stat id: ${JSON.stringify(id)}`);
  }
  const codePoint = Number.parseInt(match[1], 10);
  if (!Number.isSafeInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
    throw new RangeError(`Key-stat id is out of range: ${JSON.stringify(id)}`);
  }
  return String.fromCodePoint(codePoint);
}

/**
 * Deep copy that drops any frozen-ness. Structured clone where available,
 * falling back to a manual walk, because the input may be a frozen object
 * graph from another realm.
 */
export function thaw<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    return (value as unknown[]).map((item) => thaw(item)) as T;
  }

  const copy: Record<string, unknown> = {};
  for (const [field, item] of Object.entries(value as Record<string, unknown>)) {
    copy[field] = thaw(item);
  }
  return copy as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function nonNegativeInt(value: unknown, fallback: number): number {
  const n = finiteNumber(value, fallback);
  return n >= 0 ? Math.floor(n) : fallback;
}

function readKeyStat(value: unknown): KeyStat | null {
  if (!isRecord(value)) return null;
  return {
    hits: nonNegativeInt(value['hits'], 0),
    misses: nonNegativeInt(value['misses'], 0),
    totalMs: Math.max(0, finiteNumber(value['totalMs'], 0)),
    samples: nonNegativeInt(value['samples'], 0),
  };
}

export interface LoadResult {
  readonly progress: Progress;
  /**
   * Non-fatal problems, for the UI to surface. Nothing here is thrown, because
   * losing a corrupt field should not lock a learner out of their progress.
   */
  readonly warnings: readonly string[];
}

/** Coerce unknown input into a Progress, keeping whatever is usable. */
export function readProgress(input: unknown): LoadResult {
  const warnings: string[] = [];
  const progress = emptyProgress();

  if (!isRecord(input)) {
    return { progress, warnings: ['Saved progress was not an object; starting fresh.'] };
  }

  const version = input['version'];
  if (version !== PROGRESS_VERSION) {
    warnings.push(
      `Saved progress is version ${String(version)}, expected ${PROGRESS_VERSION}; reading what is usable.`,
    );
  }

  progress.lesson = nonNegativeInt(input['lesson'], 0);
  progress.xp = nonNegativeInt(input['xp'], 0);

  const stars = input['stars'];
  if (isRecord(stars)) {
    for (const [lessonId, count] of Object.entries(stars)) {
      const value = nonNegativeInt(count, 0);
      if (value > 0) progress.stars[lessonId] = Math.min(value, 3);
    }
  } else if (stars !== undefined) {
    warnings.push('Saved star counts were unreadable and have been reset.');
  }

  const keyStats = input['keyStats'];
  if (isRecord(keyStats)) {
    for (const [id, raw] of Object.entries(keyStats)) {
      let canonical: string;
      try {
        // Re-derive the id so a legacy character-keyed store migrates instead
        // of being silently ignored.
        canonical = /^cp\d+$/.test(id) ? id : keyStatId(id);
      } catch {
        warnings.push(`Dropped unreadable key statistics for ${JSON.stringify(id)}.`);
        continue;
      }
      const stat = readKeyStat(raw);
      if (stat === null) {
        warnings.push(`Dropped unreadable key statistics for ${JSON.stringify(id)}.`);
        continue;
      }
      const existing = progress.keyStats[canonical];
      progress.keyStats[canonical] =
        existing === undefined
          ? stat
          : {
              hits: existing.hits + stat.hits,
              misses: existing.misses + stat.misses,
              totalMs: existing.totalMs + stat.totalMs,
              samples: existing.samples + stat.samples,
            };
    }
  } else if (keyStats !== undefined) {
    warnings.push('Saved key statistics were unreadable and have been reset.');
  }

  return { progress, warnings };
}

/** In-memory driver, for tests and for when localStorage is unavailable. */
export class MemoryStorageDriver implements StorageDriver {
  private readonly entries = new Map<string, string>();

  read(key: string): string | null {
    return this.entries.get(key) ?? null;
  }
  write(key: string, value: string): void {
    this.entries.set(key, value);
  }
  remove(key: string): void {
    this.entries.delete(key);
  }
}

/**
 * localStorage, which throws rather than returning null in a private window and
 * when a quota is exceeded. Failures are reported, never swallowed.
 */
export class LocalStorageDriver implements StorageDriver {
  constructor(private readonly backing: Storage) {}

  static available(scope: { localStorage?: Storage } = globalThis): boolean {
    try {
      const store = scope.localStorage;
      if (store === undefined) return false;
      const probe = '__touchwright_probe__';
      store.setItem(probe, '1');
      store.removeItem(probe);
      return true;
    } catch {
      return false;
    }
  }

  read(key: string): string | null {
    return this.backing.getItem(key);
  }
  write(key: string, value: string): void {
    this.backing.setItem(key, value);
  }
  remove(key: string): void {
    this.backing.removeItem(key);
  }
}

export class ProgressStore {
  constructor(
    private readonly driver: StorageDriver,
    private readonly key: string = STORAGE_KEY,
  ) {}

  load(): LoadResult {
    let raw: string | null;
    try {
      raw = this.driver.read(this.key);
    } catch (cause) {
      return {
        progress: emptyProgress(),
        warnings: [`Could not read saved progress: ${describe(cause)}`],
      };
    }
    if (raw === null) return { progress: emptyProgress(), warnings: [] };

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (cause) {
      return {
        progress: emptyProgress(),
        warnings: [`Saved progress was not valid JSON and has been ignored: ${describe(cause)}`],
      };
    }
    // thaw before reading, so a frozen graph can never reach live state.
    return readProgress(thaw(parsed));
  }

  save(progress: Progress): void {
    this.driver.write(this.key, JSON.stringify(progress));
  }

  clear(): void {
    this.driver.remove(this.key);
  }

  /** Explicit export, so progress is never trapped in one browser. */
  export(progress: Progress): string {
    return JSON.stringify(progress, null, 2);
  }

  import(text: string): LoadResult {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (cause) {
      throw new Error(`That file is not valid JSON: ${describe(cause)}`, { cause });
    }
    return readProgress(thaw(parsed));
  }
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
