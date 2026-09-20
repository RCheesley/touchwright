# Contributing

## The short version

- No merge on red. Lint, typecheck, unit, functional, end-to-end and axe all have
  to pass.
- Fixing a bug someone actually hit? Add a named test to `tests/regression/`
  **before** you fix it.
- Accessibility requirements in [docs/accessibility.md](docs/accessibility.md) are
  acceptance criteria. A change that breaks one is a bug.

## Getting set up

```bash
npm install
npx playwright install chromium
npm run verify
npm run test:e2e
```

Node 22 or 24. Older lines are not tested.

## Code style

Prettier and ESLint decide formatting and most style questions, so there is
nothing to argue about. `npm run lint:fix` settles it.

Beyond that, this codebase is written defensively, because its own bug history is
almost entirely defensive failures — a swallowed error that hid a crash, a timer
that outlived its drill, storage writes that failed silently on an illegal field
name, saved state that arrived frozen. Concretely:

- **Validate at the boundary.** Parsed layout files, loaded storage, anything
  crossing into the engine. Inside the boundary, types can be trusted.
- **Never swallow an error.** Surface it and leave state intact. An empty `catch`
  will not pass review.
- **Absent, zero and malformed are three different things.** `NO_LIMIT` in
  `src/drill/limits.ts` exists because they were once conflated.
- **Prefer throwing to a wrong default.** A clear failure beats silently teaching
  someone the wrong keys.
- **Attach `cause` when rethrowing.** The original error is the useful one.

## Testing layers

| Layer      | Runner             | What belongs there                         |
| ---------- | ------------------ | ------------------------------------------ |
| unit       | Vitest, node       | Pure functions. No DOM.                    |
| functional | Vitest, jsdom      | The engine plus a thin DOM.                |
| regression | Vitest, jsdom      | Named guards for failures we have shipped. |
| e2e        | Playwright, Chrome | Real journeys, both themes, axe.           |

`src/drill/engine.ts` and everything under `src/board/`, `src/keymap/` and
`src/ladder/` must stay free of the DOM. ESLint enforces it. That constraint is
what keeps the functional tests cheap.

## The regression suite

`tests/regression/prototype-failures.test.ts` holds the eight failures the
prototype shipped, every one found by a learner rather than by a test.

Some are `it.todo` with their acceptance criteria spelled out in the name and a
comment. **A todo there is a commitment, not a placeholder.** When you build the
feature a todo guards, fill in the body in the same change.

Do not delete one because it looks obvious. Each cost a real session.

## Adding a board

See [docs/board-definitions.md](docs/board-definitions.md). You will need a module
under `src/board/`, a registration, a test pinning the geometry, and a section in
that document recording how you obtained the numbers. That last part is not
optional: undocumented geometry has to be re-derived, and re-deriving it is the
expensive part.

## Adding a locale

`src/keymap/locales.ts`. A locale needs a keycode-to-character table and a shift
table. Check the punctuation carefully against a real keyboard — `en-GB-mac` puts
`@` on 2 and `£` on 3, which differs from other UK mappings, and getting it wrong
teaches people the wrong keys without any visible error.

## Commit messages

Say what changed and why. If it fixes something a person hit, say what they saw.
