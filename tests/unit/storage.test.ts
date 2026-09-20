import { describe, expect, it } from 'vitest';
import {
  characterFromKeyStatId,
  emptyProgress,
  keyStatId,
  LocalStorageDriver,
  MemoryStorageDriver,
  ProgressStore,
  PROGRESS_VERSION,
  readProgress,
  thaw,
  type Progress,
} from '../../src/stats/storage.js';

function store(): ProgressStore {
  return new ProgressStore(new MemoryStorageDriver());
}

describe('key-stat ids', () => {
  it('keys by code point, not by the character', () => {
    expect(keyStatId('a')).toBe('cp97');
    expect(keyStatId('.')).toBe('cp46');
    expect(keyStatId(' ')).toBe('cp32');
  });

  it('round-trips every character the trainer can teach', () => {
    const characters = [
      ...'abcdefghijklmnopqrstuvwxyz0123456789',
      ' ',
      '.',
      ',',
      "'",
      ';',
      '£',
      '"',
    ];
    for (const character of characters) {
      expect(characterFromKeyStatId(keyStatId(character))).toBe(character);
    }
  });

  it('round-trips a character outside the basic plane', () => {
    expect(characterFromKeyStatId(keyStatId('😀'))).toBe('😀');
  });

  it('refuses a multi-character string rather than merging two keys', () => {
    expect(() => keyStatId('ab')).toThrow(/exactly one character/);
  });

  it('refuses an empty string', () => {
    expect(() => keyStatId('')).toThrow();
  });

  it('refuses to decode something that is not an id', () => {
    expect(() => characterFromKeyStatId('a')).toThrow();
    expect(() => characterFromKeyStatId('cp')).toThrow();
    expect(() => characterFromKeyStatId('cp99999999')).toThrow(/out of range/);
  });
});

describe('thaw', () => {
  it('returns primitives unchanged', () => {
    expect(thaw(1)).toBe(1);
    expect(thaw('a')).toBe('a');
    expect(thaw(null)).toBeNull();
  });

  it('copies nested arrays and objects', () => {
    const original = { a: [1, { b: 2 }] };
    const copy = thaw(original);
    expect(copy).toEqual(original);
    expect(copy).not.toBe(original);
    expect(copy.a).not.toBe(original.a);
  });
});

describe('reading saved progress', () => {
  it('starts fresh when there is nothing saved', () => {
    const { progress, warnings } = store().load();
    expect(progress).toEqual(emptyProgress());
    expect(warnings).toEqual([]);
  });

  it('round-trips a full progress object', () => {
    const saved: Progress = {
      version: PROGRESS_VERSION,
      lesson: 4,
      xp: 1234,
      stars: { home: 3, thumb: 2 },
      keyStats: { [keyStatId('a')]: { hits: 10, misses: 2, totalMs: 900, samples: 10 } },
    };
    const s = store();
    s.save(saved);
    expect(s.load().progress).toEqual(saved);
  });

  it('round-trips through export and import', () => {
    const s = store();
    const saved: Progress = { ...emptyProgress(), lesson: 2, xp: 50 };
    const text = s.export(saved);
    expect(s.import(text).progress).toEqual(saved);
  });

  it('reports rather than throws when the saved value is not JSON', () => {
    const driver = new MemoryStorageDriver();
    driver.write('touchwright.progress.v1', '{ broken');
    const { progress, warnings } = new ProgressStore(driver).load();
    expect(progress).toEqual(emptyProgress());
    expect(warnings.join(' ')).toMatch(/not valid JSON/);
  });

  it('keeps what is usable when a field is corrupt', () => {
    const { progress, warnings } = readProgress({
      version: PROGRESS_VERSION,
      lesson: 3,
      xp: 'lots',
      stars: 'nope',
      keyStats: { [keyStatId('a')]: { hits: 5, misses: 1, totalMs: 100, samples: 5 } },
    });
    expect(progress.lesson).toBe(3);
    expect(progress.xp).toBe(0);
    expect(progress.stars).toEqual({});
    expect(progress.keyStats[keyStatId('a')]?.hits).toBe(5);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('rejects negative and non-finite numbers', () => {
    const { progress } = readProgress({
      version: PROGRESS_VERSION,
      lesson: -5,
      xp: Number.NaN,
      keyStats: { [keyStatId('a')]: { hits: -1, misses: Infinity, totalMs: -20, samples: 2.7 } },
    });
    expect(progress.lesson).toBe(0);
    expect(progress.xp).toBe(0);
    expect(progress.keyStats[keyStatId('a')]).toEqual({
      hits: 0,
      misses: 0,
      totalMs: 0,
      samples: 2,
    });
  });

  it('caps stars at three', () => {
    const { progress } = readProgress({ version: PROGRESS_VERSION, stars: { home: 99 } });
    expect(progress.stars['home']).toBe(3);
  });

  it('migrates a store that was keyed by the character itself', () => {
    // The original bug: writes keyed by "." failed silently in some stores. A
    // store written before the fix should still be readable.
    const { progress } = readProgress({
      version: PROGRESS_VERSION,
      keyStats: { '.': { hits: 3, misses: 1, totalMs: 60, samples: 3 } },
    });
    expect(progress.keyStats[keyStatId('.')]).toEqual({
      hits: 3,
      misses: 1,
      totalMs: 60,
      samples: 3,
    });
  });

  it('warns about a version it does not recognise but still reads what it can', () => {
    const { progress, warnings } = readProgress({ version: 99, lesson: 7 });
    expect(progress.lesson).toBe(7);
    expect(warnings.join(' ')).toMatch(/version/);
  });

  it('survives a driver that throws on read', () => {
    const angry = {
      read(): string {
        throw new Error('storage disabled');
      },
      write(): void {},
      remove(): void {},
    };
    const { progress, warnings } = new ProgressStore(angry).load();
    expect(progress).toEqual(emptyProgress());
    expect(warnings.join(' ')).toMatch(/storage disabled/);
  });

  it('throws a readable error on an import that is not JSON', () => {
    expect(() => store().import('nope')).toThrow(/not valid JSON/);
  });
});

describe('LocalStorageDriver availability probe', () => {
  it('reports unavailable when there is no localStorage', () => {
    expect(LocalStorageDriver.available({})).toBe(false);
  });

  it('reports unavailable when localStorage throws, as in a private window', () => {
    const throwing = {
      setItem(): void {
        throw new Error('denied');
      },
      removeItem(): void {},
    } as unknown as Storage;
    expect(LocalStorageDriver.available({ localStorage: throwing })).toBe(false);
  });
});
