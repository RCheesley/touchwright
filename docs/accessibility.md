# Accessibility

Target: WCAG 2.2 level AA.

This app has unusual accessibility problems because it captures the keyboard
globally. The requirements below are acceptance criteria, not aspirations: a
change that breaks one of them is a bug, not a polish item.

`@axe-core/playwright` runs against every view in both themes in CI. Axe cannot
see most of what matters here, so the manual checklist below is the real test.

## Automated coverage

| What                                                    | Where                                         |
| ------------------------------------------------------- | --------------------------------------------- |
| Axe, WCAG 2.0/2.1/2.2 A and AA rules                    | `tests/e2e/load-layout.spec.ts`               |
| Contrast, both themes, computed styles                  | `tests/e2e/contrast.spec.ts`                  |
| Contrast maths                                          | `tests/unit/contrast.test.ts`                 |
| Reflow at 320, 600 and 1280 px                          | `tests/e2e/reflow.spec.ts`                    |
| Visible focus ring                                      | `tests/e2e/load-layout.spec.ts`               |
| Keyboard-only reachability                              | `tests/e2e/load-layout.spec.ts`               |
| Adjustable and disableable time limits                  | `tests/unit/limits.test.ts`                   |
| Sprint duration control, countdown and warnings         | `tests/e2e/sprint.spec.ts`                    |
| A sprint timer never acting on another drill            | `tests/regression/prototype-failures.test.ts` |
| Escape releases capture, and Tab still moves focus      | `tests/e2e/pending.spec.ts`                   |
| Marks told apart by decoration, not colour alone        | `tests/e2e/drill.spec.ts`                     |
| The drill surface's name and its description            | `tests/e2e/drill.spec.ts`                     |
| Words never broken across lines, at three widths        | `tests/e2e/drill.spec.ts`                     |
| Both button variants, both themes                       | `tests/e2e/drill.spec.ts`                     |
| Nothing moves on the drill surface under reduced motion | `tests/e2e/drill.spec.ts`                     |
| Drill text, marks, capture and result behaviour         | `tests/functional/drill-view.test.ts`         |

## Manual checklist

Run through this before any release, and whenever the drill surface changes.

Items marked **automated** are also checked in CI, at the test named beside them;
the rest need a person. An automated item still belongs on this list, because a
test can only check what it was told to look for.

### Keyboard capture must be escapable

The drill surface captures printable keys at the document, in the capture phase,
and has no input element of its own. Three things make that escapable, and all
three are asserted: Escape releases capture, Tab is never consumed in any state,
and focus moving off the surface releases capture on its own.

- [x] Escape releases capture from anywhere in a drill, every time. **Automated**,
      mid-drill and from the result screen, in `tests/e2e/pending.spec.ts` and
      `tests/functional/drill-view.test.ts`.
- [x] After Escape, Tab moves through the page normally. **Automated**, forwards
      and backwards, in `tests/e2e/pending.spec.ts`.
- [x] How to escape is stated in visible text, not only in a tooltip or a title
      attribute. **Automated**: the visible text is asserted, and the absence of a
      `title` with it, in `tests/functional/drill-view.test.ts`.
- [x] Focus is never trapped. There is always a way out with the keyboard alone.
      **Automated** as far as a test can go: Tab is never consumed, in any drill
      state. Whether it feels escapable still needs a person.

### The drill surface

- [x] Printable keys are captured with no visible input element. **Automated** in
      `tests/e2e/drill.spec.ts`.
- [x] Correct, wrong and pending characters are told apart by text decoration and
      weight as well as by colour. **Automated** from computed styles, both themes,
      in `tests/e2e/drill.spec.ts`.
- [x] The next-key readout names hand, finger and row in words, and the board
      highlight follows it rather than leading. **Automated** in
      `tests/e2e/drill.spec.ts`.
- [x] The result is shown at the end with the next step named in scoring's own
      words. **Automated** in `tests/e2e/drill.spec.ts` and
      `tests/e2e/pending.spec.ts`.
- [x] A word is never broken across two lines, at 320, 600 and 1200 CSS pixels.
      **Automated** from client rects in `tests/e2e/drill.spec.ts`; the structure
      and width budget that guarantee it are in
      `tests/regression/prototype-failures.test.ts`.
- [ ] A drill the loaded layout cannot type is refused with a message, not by
      dropping characters. Automated as a thrown error; the wording still needs a
      person to read it.

### Screen reader output must be useful, not a firehose

Tested with VoiceOver on macOS and NVDA on Windows. The regions, roles and the
text put into them are asserted; what a screen reader actually says is not, and
cannot be, so every item here still needs a manual pass.

- [ ] Individual keystrokes are **not** announced. No live region is written per
      keystroke, which is asserted; the announcement itself is manual.
- [ ] The current word is announced when it changes. The text is asserted in
      `tests/functional/drill-view.test.ts`; the announcement is manual.
- [ ] Errors are announced. A wrong key writes the expected key, its finger and
      its row into the polite region, which is asserted; hearing it is manual.
- [ ] The end-of-drill result is announced once, via an assertive region.
- [ ] Progress uses a polite region; the result uses assertive. Not the reverse.
      The roles are asserted; the behaviour is manual.
- [x] The drill surface has an accessible name. **Automated** in
      `tests/e2e/drill.spec.ts`.
- [x] Its description states the next key, the finger and the row. **Automated**:
      the resolved `aria-describedby` text is asserted in
      `tests/e2e/drill.spec.ts`.

### Colour is never the only channel

- [ ] Finger identity is carried by text as well as colour, everywhere it appears.
- [ ] The board legend names each finger in words.
- [x] The next-key readout names hand, finger and row. That is the primary
      channel; colour reinforces it. **Automated** in `tests/e2e/drill.spec.ts` and
      `tests/functional/drill-view.test.ts`.
- [x] Nothing about progress, error state or key state is conveyed by colour alone.
      **Automated** for the drill marks, which carry `data-mark` and differ in
      decoration and weight; a person still has to check anything added later.

### The board diagram

- [ ] The SVG is `aria-hidden`, and nothing is available only there.
- [ ] Every fact the diagram shows is also in text.

### Contrast

- [ ] Every text pair passes AA, 4.5:1, in both themes.
- [ ] Key caps on the board pass against the board surface.
- [ ] Finger colours pass the non-text threshold, 3:1, against the board surface.
- [x] Both button variants pass in both themes. The prototype shipped an outline
      button that rendered white on white; this is why the contrast test exists.
      **Automated** twice over: from computed styles in `tests/e2e/drill.spec.ts`,
      and from the stylesheet's own tokens in
      `tests/regression/prototype-failures.test.ts`, which also refuses a button
      whose colour comes from anywhere but its own variant rule.
- [ ] Focus rings pass 3:1 against adjacent colours.

### Reduced motion

- [x] `prefers-reduced-motion: reduce` removes every transition. **Automated** for
      the drill surface, element by element, in `tests/e2e/drill.spec.ts`, and for
      the board in `tests/e2e/board.spec.ts`. The drill text carries no transition
      at all, in either mode: a mark has to land on the keystroke.
- [ ] It also removes any celebratory animation. There is no celebration yet.

### Timing

Sprint mode imposes a limit, so WCAG 2.2.1 applies. The exemption for essential
timing is deliberately not claimed: a sprint is a measurement, and a measurement
someone cannot take is not essential to anything.

- [x] A duration control is offered, built from `SPRINT_DURATIONS_MS` so the
      options and the durations cannot drift apart. **Automated** in
      `tests/functional/sprint-view.test.ts` and `tests/e2e/sprint.spec.ts`.
- [x] An untimed option is offered, and it genuinely never expires. **Automated**
      three times over, at three scales: `hasReachedLimit` at
      `Number.MAX_SAFE_INTEGER` in `tests/regression/prototype-failures.test.ts`,
      a century of elapsed time through a running sprint timer in
      `tests/unit/sprint.test.ts` and `tests/functional/sprint-view.test.ts`, and
      an hour of faked wall clock in a real browser in
      `tests/e2e/pending.spec.ts`.
- [x] The limit is adjustable before the sprint starts, and the current setting
      is stated in visible text rather than only shown as a selected option.
      **Automated** in `tests/e2e/sprint.spec.ts`.
- [x] The exemption for essential timing is not claimed.
- [x] The countdown is visible while a timed sprint runs, and is a `role="timer"`
      whose implicit live setting is off, so it is never announced per second.
      **Automated** in `tests/functional/sprint-view.test.ts` and
      `tests/e2e/sprint.spec.ts`.
- [x] Time running out is announced politely at a handful of milestones — a
      minute, thirty seconds, ten — so the countdown is never the only channel.
      **Automated**: the count of announcements over a whole sprint is asserted,
      in `tests/functional/sprint-view.test.ts`. Hearing it is still manual.
- [ ] A sprint feels escapable to someone using a screen reader: the milestones
      land without talking over the word announcements. Needs a person.

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

- Screen reader testing is manual. There is no automated substitute. The regions,
  their roles and the text written into them are asserted, and that is as far as a
  test reaches: no test can hear VoiceOver or NVDA.
- The repair drill does not exist yet, so nothing checks what it says about the
  keys it was built from.
- Nothing yet checks the drill surface at 400 per cent zoom by hand. Reflow at 320
  CSS pixels is automated, which is the same measurement from the other side, but
  it is not the same experience.
