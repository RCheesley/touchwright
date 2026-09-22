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

> **Status: it works.** Load a layout, and it generates a lesson ladder from
> your own keymap and drills you on it — reporting weak keys by finger and row.
> Repair drills, sprint mode and a screen-reader pass are still to come.

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

Working today:

- A lesson ladder **generated from your layout**, not hand-written for it. For
  the Maltron reference layout the keywell order comes out identical to a
  hand-authored ladder, derived rather than copied; the three places it
  deliberately differs are defended in [docs/ladder.md](docs/ladder.md).
- Drill text built from each lesson's own key set, so you are never shown a key
  the ladder has not given you yet.
- A drill surface with escapable keyboard capture, scoring, stars, and
  advancement through the ladder.
- The board drawn from its own geometry, with the next key named in words first
  and highlighted second.
- Weak keys grouped **by finger and row** rather than by letter — the thing the
  architecture exists for.
- Progress saved, exported and imported as JSON.

Still to come, all tracked below: repair drills, sprint mode, and a screen
reader pass that a person has to do.

Seven of the eight regressions in `tests/regression/` are asserted. The last is
the orphaned sprint timer, which lands with sprint mode. Each is filled in with
the feature it guards, never afterwards.

## Roadmap

Everything left for version one is tracked as an issue. Issues #1 to #6 and #9
are done.

| Issue                                                     | What                                       |
| --------------------------------------------------------- | ------------------------------------------ |
| [#7](https://github.com/RCheesley/touchwright/issues/7)   | Repair drills built from the keys you miss |
| [#8](https://github.com/RCheesley/touchwright/issues/8)   | Sprint mode, adjustable and disableable    |
| [#10](https://github.com/RCheesley/touchwright/issues/10) | Usable with a screen reader                |

[#8](https://github.com/RCheesley/touchwright/issues/8) owns the last unguarded
regression: a sprint timer that outlived its drill and then killed every drill
after it.

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
