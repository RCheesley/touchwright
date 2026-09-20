# Accessibility

Target: WCAG 2.2 level AA.

This app has unusual accessibility problems because it captures the keyboard
globally. The requirements below are acceptance criteria, not aspirations: a
change that breaks one of them is a bug, not a polish item.

`@axe-core/playwright` runs against every view in both themes in CI. Axe cannot
see most of what matters here, so the manual checklist below is the real test.

## Automated coverage

| What                                   | Where                           |
| -------------------------------------- | ------------------------------- |
| Axe, WCAG 2.0/2.1/2.2 A and AA rules   | `tests/e2e/load-layout.spec.ts` |
| Contrast, both themes, computed styles | `tests/e2e/contrast.spec.ts`    |
| Contrast maths                         | `tests/unit/contrast.test.ts`   |
| Reflow at 320, 600 and 1280 px         | `tests/e2e/reflow.spec.ts`      |
| Visible focus ring                     | `tests/e2e/load-layout.spec.ts` |
| Keyboard-only reachability             | `tests/e2e/load-layout.spec.ts` |
| Adjustable and disableable time limits | `tests/unit/limits.test.ts`     |

## Manual checklist

Run through this before any release, and whenever the drill surface changes.

### Keyboard capture must be escapable

- [ ] Escape releases capture from anywhere in a drill, every time.
- [ ] After Escape, Tab moves through the page normally.
- [ ] How to escape is stated in visible text, not only in a tooltip or a title
      attribute.
- [ ] Focus is never trapped. There is always a way out with the keyboard alone.

### Screen reader output must be useful, not a firehose

Tested with VoiceOver on macOS and NVDA on Windows.

- [ ] Individual keystrokes are **not** announced.
- [ ] The current word is announced when it changes.
- [ ] Errors are announced.
- [ ] The end-of-drill result is announced once, via an assertive region.
- [ ] Progress uses a polite region; the result uses assertive. Not the reverse.
- [ ] The drill surface has an accessible name.
- [ ] Its description states the next key, the finger and the row.

### Colour is never the only channel

- [ ] Finger identity is carried by text as well as colour, everywhere it appears.
- [ ] The board legend names each finger in words.
- [ ] The next-key readout names hand, finger and row. That is the primary
      channel; colour reinforces it.
- [ ] Nothing about progress, error state or key state is conveyed by colour alone.

### The board diagram

- [ ] The SVG is `aria-hidden`, and nothing is available only there.
- [ ] Every fact the diagram shows is also in text.

### Contrast

- [ ] Every text pair passes AA, 4.5:1, in both themes.
- [ ] Key caps on the board pass against the board surface.
- [ ] Finger colours pass the non-text threshold, 3:1, against the board surface.
- [ ] Both button variants pass in both themes. The prototype shipped an outline
      button that rendered white on white; this is why the contrast test exists.
- [ ] Focus rings pass 3:1 against adjacent colours.

### Reduced motion

- [ ] `prefers-reduced-motion: reduce` removes every transition.
- [ ] It also removes any celebratory animation.

### Timing

Sprint mode imposes a limit, so WCAG 2.2.1 applies.

- [ ] A duration control is offered.
- [ ] An untimed option is offered, and it genuinely never expires.
- [ ] The exemption for essential timing is not claimed.

### Reflow and zoom

- [ ] Usable at 320 CSS pixels wide with no horizontal page scrolling.
- [ ] Usable at 400 per cent zoom.
- [ ] Only tables, diagrams and code may scroll horizontally, each inside its own
      container.

### Target size

- [ ] Every interactive control is at least 24 by 24 CSS pixels. WCAG 2.5.8.

### Focus appearance

- [ ] Every control has a visible focus style meeting 2.4.11.
- [ ] Focus is never obscured by a sticky header or overlay.

## Known gaps

Tracked rather than forgotten. Each becomes a checklist item once the feature
exists.

- The drill surface, the board render and the results view do not exist yet, so
  the screen reader and colour sections above are untested.
- Screen reader testing is manual. There is no automated substitute.
