# Testing this with a screen reader

A typing trainer is close to the worst case for a live region. Announce every
keystroke and it becomes an unusable firehose; announce nothing and a screen
reader user has no idea where they are in the text. The only way to know which
side of that line we are on is for somebody to listen to it.

This is a script for doing that. It takes about twenty minutes. You do not need
to know the codebase.

**If you do this, please say what you found on
[issue #10](https://github.com/RCheesley/touchwright/issues/10), including the
parts that were fine.** Knowing which announcements already work is as useful as
knowing which do not.

## What you need

One of:

- **VoiceOver** on macOS — `Cmd + F5` to start and stop. Safari is the best pairing.
- **NVDA** on Windows — free from nvaccess.org. Firefox or Chrome.
- **Orca** on Linux — usually `Super + Alt + S`.

And the app: <https://rcheesley.github.io/touchwright/>

You will need a layout export to load. If you do not have a Glove80, grab
[the reference layout](https://github.com/RCheesley/touchwright/blob/main/tests/fixtures/macos-maltron.glove80.json)
(the "Download raw file" button) — it is a real Maltron layout and the app is
built around it.

## A note before you start

The drill **captures the keyboard**. While a drill is running, printable keys go
to the drill rather than to the page.

**Escape always gives the keyboard back.** If you get stuck, press Escape.

This is exactly the interaction most worth your scrutiny, because it is the part
most likely to trap somebody.

## The script

Work through these in order. For each, note what you heard, what you expected,
and anything that was too much, too little, or too late.

### 1. Loading a layout

- [ ] Reach the file input by keyboard alone. Is it clear what file it wants?
- [ ] Load the layout. Is the confirmation announced?
- [ ] Load something that is not a layout — any other JSON or text file. Is the
      error announced promptly, and does it tell you what to do about it?

### 2. The summary and the board

- [ ] The summary lists what the parser found. Does it read as a sensible list?
- [ ] The board diagram is deliberately hidden from screen readers
      (`aria-hidden`), because everything it shows is meant to be in text.
      **Check that claim.** Is anything about key positions available only in
      the picture? The "Every key on the board, in words" disclosure is the
      text equivalent — is it usable, or is 80 keys simply too many to hear?

### 3. Starting a drill — the important one

- [ ] Focus the drill surface. What is announced? You should hear its name and a
      description naming the next key, its finger and its row.
- [ ] Is it clear **that the keyboard has been captured** and how to release it?
- [ ] Start typing correctly. **Is each keystroke announced?** It should not be.
- [ ] Is the current word announced as you move through the text? Is that the
      right granularity — too often, not often enough?
- [ ] Do you always know what to type next without stopping to investigate?

### 4. Making mistakes

- [ ] Type a wrong key. Is the mistake announced? Does it name the key you
      should have pressed, and the finger?
- [ ] Type the **same wrong key twice in a row**. Is the second one announced?
      _(We think it may not be. See "What we already suspect" below.)_
- [ ] Press Backspace. Is anything said? Should something be?

### 5. Escape, and the trap question

- [ ] Press Escape mid-drill. Is the release announced?
- [ ] Can you now Tab through the page normally?
- [ ] Can you get back into the drill and resume?
- [ ] **At any point, were you stuck anywhere you could not leave by keyboard?**
      This is the single most important question in this document.

### 6. Finishing a drill

- [ ] Complete a drill. Is the result announced? Once, or more than once?
- [ ] Are the numbers comprehensible when heard rather than seen — words per
      minute, accuracy, stars?
- [ ] Is the next step clear? Do you know how to take it?

### 7. The ladder and the statistics

- [ ] Can you tell which lessons are locked and which are not, without seeing
      the stars?
- [ ] The weak-key report groups keys by finger and row. Does it read
      sensibly aloud? This is the app's whole point, so it matters most here.
- [ ] Are the severity bands (`steady`, `worth watching`, `needs work`)
      audible as words rather than only as colour?

### 8. Export and import

- [ ] Export your progress. Is the download announced?
- [ ] Import it back. Are any warnings about dropped fields announced?

## What we already suspect is wrong

Found by reading the code, not by listening. Confirming or dismissing any of
these is useful.

1. **A repeated identical message may be silent.** Announcements are made by
   setting the text of a live region. Setting it to the _same_ string changes
   nothing in the page, so a screen reader has nothing to notice. Mistyping the
   same key twice in a row may therefore announce once.
2. **No region is marked `aria-atomic`.** Multi-part messages may be announced
   in fragments rather than whole, depending on the screen reader.
3. **Five polite regions can speak.** The capture state, the drill progress, the
   current lesson, the load status and the progress status. If two change at
   once, the order is whatever the screen reader decides. We do not know whether
   this produces pile-ups in practice.
4. **The next-key description changes while the surface keeps focus.** It is
   referenced by `aria-describedby`, and screen readers vary a lot in whether
   they re-read a description that changes under them.

## What is already checked automatically

So you know what not to spend your time on. Every view is checked with axe in
both light and dark themes on every commit, and the end-to-end suite asserts:

- live regions exist with the politeness they are meant to have,
- the drill surface has an accessible name and a description naming the next key,
- the next key is named in words before it is highlighted in colour,
- individual keystrokes are **not** announced,
- Escape releases the keyboard, and Tab then moves normally,
- a whole drill can be completed without touching the mouse,
- nothing is conveyed by colour alone.

None of that tells us whether it is **usable**. That is what we are asking.
