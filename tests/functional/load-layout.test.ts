/**
 * The upload path, with a real DOM but no browser.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/dom';
import { GLOVE80 } from '../../src/board/index.js';
import { parseMoErgoLayoutText } from '../../src/keymap/moergo.js';
import { summariseKeymap } from '../../src/ui/layout-summary.js';

import { readReferenceLayout } from '../fixtures/index.js';

const fixtureText = readReferenceLayout();

describe('summarising a parsed layout', () => {
  const keymap = parseMoErgoLayoutText(fixtureText, { board: GLOVE80 });
  const rows = summariseKeymap(keymap, GLOVE80);
  const byTerm = new Map(rows.map((row) => [row.term, row.detail]));

  it('names the layout and the board', () => {
    expect(byTerm.get('Layout')).toBe('macOS Maltron');
    expect(byTerm.get('Keyboard')).toBe('MoErgo Glove80');
  });

  it('names the host locale, because the shift pairing depends on it', () => {
    expect(byTerm.get('Host locale')).toBe('en-GB-mac');
  });

  it('spells out the home keys in order', () => {
    expect(byTerm.get('Home keys')).toBe('a n i s f d t h o r');
  });

  it('says where E is in words, not in colour or position number', () => {
    expect(byTerm.get('E is on')).toBe('left thumb, lower arc');
  });

  it('says which space it will teach, and that there is more than one', () => {
    expect(byTerm.get('Space is on')).toBe('right thumb, lower arc (this board has 2 space keys)');
  });

  it('never produces an empty term or detail', () => {
    for (const row of rows) {
      expect(row.term.length).toBeGreaterThan(0);
      expect(row.detail.length).toBeGreaterThan(0);
    }
  });
});

describe('the load form', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <input id="layout-file" type="file" />
      <p id="layout-status" role="status"></p>
      <div id="layout-error" role="alert" hidden></div>
      <section id="summary" hidden><dl id="summary-list"></dl></section>
    `;
  });

  it('starts with the error region hidden and the summary hidden', () => {
    expect(screen.getByRole('alert', { hidden: true })).toHaveProperty('hidden', true);
    expect(document.querySelector('#summary')).toHaveProperty('hidden', true);
  });

  it('refuses to wire up against markup it does not recognise', async () => {
    document.body.innerHTML = '<p>nothing useful here</p>';
    const { wireUp } = await import('../../src/ui/load-form.js');
    expect(() => wireUp()).toThrow(/Expected an element/);
  });
});
