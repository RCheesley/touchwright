/**
 * Fixture loading that works in both test environments.
 *
 * Under jsdom, import.meta.url is an http URL, so it cannot be handed to
 * readFileSync. Resolving from the project root works everywhere.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURE_DIR = join(process.cwd(), 'tests', 'fixtures');

export const REFERENCE_LAYOUT = 'macos-maltron.glove80.json';

export function readFixture(name: string): string {
  const path = join(FIXTURE_DIR, name);
  try {
    return readFileSync(path, 'utf8');
  } catch (cause) {
    throw new Error(`Could not read the fixture at ${path}`, { cause });
  }
}

export function readReferenceLayout(): string {
  return readFixture(REFERENCE_LAYOUT);
}
