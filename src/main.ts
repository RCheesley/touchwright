/**
 * Entry point.
 *
 * Choose a layout export, see what the parser made of it, see where those keys
 * are, and drill the lesson ladder generated from it.
 *
 * `?seed=` pins the drill text, which is otherwise seeded from the clock so that
 * each attempt at a lesson is different. A fixed seed makes a drill reproducible:
 * the end-to-end suite relies on it, and it is the only way to get the same drill
 * twice if you want to compare two runs.
 */

import './ui/theme.css';
import { wireUp } from './ui/load-form.js';

/** A seed from the query string, when it is one. Anything else is ignored. */
function seedFromLocation(search: string): number | null {
  const raw = new URLSearchParams(search).get('seed');
  if (raw === null || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

const pinned = seedFromLocation(globalThis.location.search);

wireUp(document, pinned === null ? {} : { seed: (): number => pinned });
