# Touchwright

[![CI](https://github.com/RCheesley/touchwright/actions/workflows/ci.yml/badge.svg)](https://github.com/RCheesley/touchwright/actions/workflows/ci.yml)

**[Try it](https://rcheesley.github.io/touchwright/)**

A typing trainer that reads your keyboard's firmware keymap and builds the lesson
ladder around it.

Because it knows which finger owns which key on your physical board, it can report
weak keys **by finger and row** rather than by letter, build repair drills around a
single finger, and generate lessons from your layout instead of someone
hand-writing one per layout.

The first supported combination is the Maltron layout on a MoErgo Glove80. The
architecture does not assume it: board geometry and the lesson ladder are data, so
adding a second board is a config file rather than a rewrite.

> **Status: early.** The layout parser, the board geometry and the persistence
> layer are built and tested. The board render, the lesson ladder and the drill
> itself are not. See [Where this is up to](#where-this-is-up-to).

## Exporting your layout

1. Open your layout in the [MoErgo Layout Editor](https://my.glove80.com/).
2. Choose **Export** and save the JSON file.
3. Open Touchwright and choose that file.

Nothing is uploaded anywhere. The file is read in your browser, the app makes no
network calls at runtime, and it works offline.

Your layout's `locale` field decides how shifted characters pair up. `en-GB-mac`
and `en-US` are supported; anything else is refused with a clear message rather
than guessed at, because guessing the punctuation would silently teach you the
wrong keys. Adding a locale is a few lines in `src/keymap/locales.ts`.

## Running it locally

Requires Node 22 or 24.

```bash
npm install
npm run dev
```

Other tasks:

```bash
npm run verify     # lint, typecheck, unit + functional + regression tests
npm test           # just the tests
npm run test:e2e   # Playwright, including axe, in both themes
npm run build      # typecheck and produce dist/
```

The end-to-end suite needs browsers once:

```bash
npx playwright install chromium
```

It can also be pointed at a deployed site, to check that what is published
actually works rather than only what builds locally:

```bash
E2E_BASE_URL=https://rcheesley.github.io/touchwright/ npx playwright test
```

Navigation in those tests is relative, so the suite exercises the real base path.
An absolute `/` would resolve against the origin and quietly test the wrong
site — which is exactly what happened the first time.

## How it is put together

```
src/
  board/      physical geometry: where keys are, which finger owns each
  keymap/     parsing a layout export, and the host locale tables
  ladder/     building lessons from a keymap plus a board
  drill/      the typing engine, deliberately free of the DOM
  stats/      per-key statistics and persistence
  ui/         rendering
tests/
  unit/       pure functions
  functional/ the engine plus a thin DOM
  regression/ the eight failures the prototype shipped
  e2e/        Playwright, real browser, both themes
docs/
```

Two rules hold the shape:

**The drill engine never touches the DOM.** It takes input events and returns
state. That is what makes the functional tests cheap and the regression suite
possible. ESLint enforces it.

**A board is data.** Nothing outside `src/board/` hard-codes a board id. See
[docs/board-definitions.md](docs/board-definitions.md), which also records how the
Glove80 geometry was measured — that geometry is expensive knowledge and is pinned
by test so nobody has to derive it twice.

## Accessibility

Target WCAG 2.2 AA, treated as acceptance criteria rather than aspiration. This
app captures the keyboard globally, which creates problems most apps do not have:
capture must always be escapable, screen reader output must be useful rather than a
firehose of keystrokes, and colour can never be the only channel for finger
identity.

Axe runs against every view in both themes in CI. Axe cannot see most of what
matters here, so there is a manual checklist:
[docs/accessibility.md](docs/accessibility.md).

## Where this is up to

Built and tested:

- Glove80 geometry, pinned by 40-odd assertions including a single-mirror-axis
  invariant across all 80 positions.
- MoErgo layout export parsing, with the host locale driving shift pairing, and
  validation that refuses untrusted input with a message you can act on.
- Progress persistence behind a narrow storage interface, with JSON export and
  import.
- Drill time limits, where untimed is a real state rather than a zero.
- WCAG contrast maths, checked against computed styles in both themes.

Not built yet — and this is the honest state of it: **you can load a layout and
see what it found, but you cannot yet type against it.**

Of the eight regressions in `tests/regression/`, four are asserted and four are
named `todo` with their acceptance criteria written out. They are filled in as
the features they guard land, never afterwards.

## Roadmap

Everything left for version one is tracked as an issue, in dependency order.

| Issue                                                     | What                                      | Needs  |
| --------------------------------------------------------- | ----------------------------------------- | ------ |
| [#1](https://github.com/RCheesley/touchwright/issues/1)   | Generate the lesson ladder                | —      |
| [#2](https://github.com/RCheesley/touchwright/issues/2)   | Drill engine, a pure state machine        | —      |
| [#4](https://github.com/RCheesley/touchwright/issues/4)   | Scoring: wpm, accuracy, xp, stars         | —      |
| [#5](https://github.com/RCheesley/touchwright/issues/5)   | Render the board as SVG                   | —      |
| [#3](https://github.com/RCheesley/touchwright/issues/3)   | Drill text: clusters, words, prose        | #1     |
| [#6](https://github.com/RCheesley/touchwright/issues/6)   | Drill surface, escapable keyboard capture | #2, #5 |
| [#7](https://github.com/RCheesley/touchwright/issues/7)   | Per-key statistics and repair drills      | #2, #3 |
| [#8](https://github.com/RCheesley/touchwright/issues/8)   | Sprint mode, adjustable and disableable   | #2, #3 |
| [#9](https://github.com/RCheesley/touchwright/issues/9)   | Ladder, statistics, export and import     | #1, #4 |
| [#10](https://github.com/RCheesley/touchwright/issues/10) | Usable with a screen reader               | #6     |

[#1](https://github.com/RCheesley/touchwright/issues/1) is the only one with real
design risk: the brief requires the generated ladder to match the prototype's
hand-authored one or to differ only in documented, defended ways.

[#10](https://github.com/RCheesley/touchwright/issues/10) is marked help wanted.
If you use a screen reader, that feedback is worth more than anything the tooling
can tell us.

Out of scope for version one, with the seams designed but nothing built: ZMK
`.keymap` devicetree parsing, a second board, contributed board definitions, and
any server.

## Deployment

The build is a plain static bundle: no server, no runtime network calls, offline
capable. That makes the host interchangeable, and only the last step of
`.github/workflows/deploy.yml` is host-specific.

Published to GitHub Pages at <https://rcheesley.github.io/touchwright/>.

Deployment runs only after CI has gone green for a commit, and it deploys that
same commit, so nothing reaches the site without its tests having passed. It is
also behind a `PAGES_ENABLED` repository variable: GitHub Pages cannot publish
from a private repository without a paid plan, so the switch exists for any
period when this repository is private. With it off, CI still keeps the built
site as a downloadable artifact on every run.

`VITE_BASE` controls the base path, so moving to Cloudflare Pages or any other
static host means changing the last three steps of one workflow.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). In short: no merge on red, and if you are
fixing a bug a learner found, add a named test to `tests/regression/` before you
fix it.

## Licence

[MIT](LICENSE), matching ZMK and MoErgo's own configuration repository.

## Trademarks

MoErgo and Glove80 are trademarks of MoErgo. Maltron is a trademark of PCD Maltron
Ltd. This project is not affiliated with, endorsed by, or sponsored by either
company. Their names are used only descriptively, to say which keyboard and which
layout this software works with.
