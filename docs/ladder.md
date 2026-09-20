# The lesson ladder

`generateLadder(keymap, board)` in `src/ladder/generate.ts` turns a parsed layout
and the board it was written for into an ordered list of lessons. Each lesson adds
a small set of new keys and carries the cumulative set of everything unlocked so
far, so drill text can be filtered to what the learner actually knows.

Nothing in the module knows about Maltron, about the Glove80, or about any
particular character. Two inputs decide everything: the board, which knows the
finger, row and reach of every position, and English frequency data in
`src/ladder/frequency.ts`.

## How the order is derived

1. **Home first.** The keys the fingers already rest on — `board.homePositions` —
   are the first lesson, listed left to right across the board, because that is
   the one lesson whose keys nobody has to travel to. The space the board
   recommends joins them: a word drill needs a separator from the very first
   lesson, and `board.spacePosition` exists precisely so the trainer knows which
   space to teach when a board offers two.
2. **Then letters, most used first.** Letter frequency decides the sequence,
   because that is what lets the earliest lessons drill real words.
3. **Two keys per lesson, paired by geometry.** The most useful key left is the
   lesson's first key. Its partner is chosen from the next few keys by frequency —
   never from further down the list — preferring, in this order, the same finger
   on the other hand, then the same hand in the same row, then the same row, then
   the same finger in another row. A thumb key has neither a row nor a column, so
   it can only pair with another thumb key: that is a fact of the board's own
   discriminated union, not a special case, and it is why a layout with one letter
   on a thumb teaches that letter alone.
4. **Three or fewer left is one last lesson.** Three rare keys in one lesson cost
   a learner less than three lessons do, and it means no lesson ever introduces a
   single rare key on its own.
5. **Punctuation after the alphabet.** Punctuation is only drillable once the text
   can be sentences rather than word lists, so it follows the letters whatever its
   frequency. The punctuation English prose uses comes as one lesson, in order of
   use; everything else the layout binds comes as one more, ordered by how hard it
   is to reach, so that the last lesson's key set really is every character the
   layout binds.
6. **Capitals, then prose.** Both are stages over the existing key set and add no
   keys. Capitals appear only if the layout binds a shift and there is something
   to shift.

Frequency leads and geometry follows, which is the right way round: geometry says
which keys belong in the same lesson, frequency says when that lesson arrives.

### The one free parameter

`pairingWindow` is how far down the frequency list a lesson may look for its
second key. It defaults to 3. It has to be bounded: with an unbounded window the
first keywell lesson pairs L with Q, because Q is L's mirror on the other hand,
and the learner meets the rarest letter in English in lesson three. It also has to
be more than 1: with a window of 1 the pairing degenerates into plain frequency
order.

Any value from 2 to 6 produces exactly the same ladder for the reference layout.
That is asserted by test, so the reference result does not rest on the number 3.

### What effort is used for

`keyEffort` scores a key from its finger, its row and its reach. It is a tie
break, not a driver: it orders the keys prose never uses, and it settles
comparisons frequency cannot. Thumb keys cost least, then index, middle, ring,
pinky; a row costs its distance from home, with a small extra for reaching down
rather than up; an inner reach costs less than an outer one.

### The frequency data, and how much to trust it

`src/ladder/frequency.ts` holds three things with three different levels of
confidence, and says so:

- `LETTER_FREQUENCY` — measured, from Lewand (2000). This drives the ordering.
- `BIGRAM_FREQUENCY` — measured, from Norvig (2013), rounded to two decimals and
  truncated to the common pairs. Used as a tie break, and exported as `topBigrams`
  for the drill text generator to build cluster drills from a lesson's key set.
- `PROSE_PUNCTUATION` — editorial, and openly so: a rank, not a measurement, which
  is why it is a list and not a table of decimals. It decides which non-letter
  keys belong in a punctuation lesson and in what order.

A lookup returns `undefined` for a character a table does not cover, and no table
contains a zero. Absent means "English prose does not use this", which is not the
same statement as "used, vanishingly rarely", and the ladder treats the two
differently: a letter English does not use is still taught, after the ones it
does, ordered by reach.

## The reference layout

Maltron on a Glove80, `tests/fixtures/macos-maltron.glove80.json`, produces:

| #   | id        | name                | adds                            |
| --- | --------- | ------------------- | ------------------------------- |
| 1   | `home`    | Home keys           | `anisfdthor` + space            |
| 2   | `thumb`   | The left thumb      | `e`                             |
| 3   | `lu`      | Pinky and middle up | `lu`                            |
| 4   | `cm`      | Index up            | `cm`                            |
| 5   | `wg`      | Index down          | `wg`                            |
| 6   | `yp`      | Middle and ring up  | `yp`                            |
| 7   | `bv`      | Inner index         | `bv`                            |
| 8   | `kj`      | Middle down         | `kj`                            |
| 9   | `xqz`     | The outliers        | `xqz`                           |
| 10  | `punct`   | Punctuation         | `.,'-;/`                        |
| 11  | `symbols` | Numbers and symbols | `58467930` + `` ` `` + `2\[]1=` |
| 12  | `caps`    | Capitals            | nothing                         |
| 13  | `prose`   | Full prose          | nothing                         |

The hand authored ladder in `reference/prototype.html` is:

```
home(anisfdthor), thumb(e), lu, cm, wg, yp, bv, kj, xqz, punct(,.';), caps, prose
```

Lessons two to nine — the entire keywell, the part with the design risk — come out
identical: same lessons, same order, same keys, same ids. The lesson names fall
out of the geometry too, and six of them land word for word on what the prototype
wrote by hand: "Home keys", "The left thumb", "Pinky and middle up", "Index up",
"Index down", "Middle and ring up", "Inner index", "Middle down", "The outliers",
"Punctuation", "Capitals", "Full prose".

This is asserted in `tests/unit/ladder.test.ts` under "the generated ladder
against the prototype hand authored one".

## Where it diverges, and why

Three differences. Each is asserted by a test, so it cannot quietly become a
different difference.

### 1. The first lesson unlocks the space

The prototype set `CHAR_POS[" "] = 74` outside the ladder, so space was
permanently available and appeared in no lesson's key set. Here the first lesson
adds it.

**Why.** A lesson's cumulative key set is the filter drill text is built from, and
the acceptance criterion is that the last lesson's set is every character the
layout binds. Space is a character the layout binds — twice, on this board. Left
out of the ladder it becomes a key the trainer teaches without ever saying so, and
the completeness check becomes a lie by omission. Put in the first lesson it costs
the learner nothing: their thumb is already resting on it, and the blurb names it
and says which of the two spaces the board wants.

### 2. The punctuation lesson has six keys, not four

The prototype taught `, . ' ;`. The generated lesson teaches `. , ' - ; /`: the
same four, in order of use rather than of position, plus the hyphen and the slash.

**Why.** The hyphen and the slash are punctuation English prose uses — the hyphen
considerably more than the semicolon the prototype did teach. They are on the same
kind of pinky reach as the rest and they sit in the ladder at the same point. The
alternative is that a trainer which claims to build lessons from your layout
silently drops two keys of it because a hand written list did.

Order within the lesson is by use, so a learner meeting it reads the full stop and
comma first, which is what their drill text will be full of.

### 3. There is a thirteenth lesson for the keys prose never uses

`symbols` teaches the digits and `` ` `` `\` `[` `]` `=`, ordered by reach, so that
the strongest fingers' digits come first. The prototype taught none of them.

**Why.** The acceptance criterion is explicit: the cumulative set of the last
lesson is every character the layout binds. The fixture binds 48 characters; the
prototype's ladder reached 37. The keys it dropped are not hypothetical, either —
its own prose includes "How vexingly quick daft zebras jump!", and the exclamation
mark is shift and the `1` key, which its ladder never unlocked. A learner who got
to full prose met a key they had never been shown.

One lesson rather than several is a deliberate compromise: the ladder stays close
to the twelve lessons the brief describes, and these keys are rare enough that
pairing them off would add seven lessons without adding practice. They are taught
in one sweep, in reach order, with a blurb that says exactly what they are. If a
future locale or a programmer-oriented mode wants them broken up, that is a change
to one group in `generateLadder`, not to the ordering rules.

### What is not a divergence

The blurbs are generated rather than transcribed. They name the hand, finger, row
and reach of every key a lesson adds, using the same `describeKey` wording the rest
of the app uses as its primary, non-colour channel. Every finger claim the
prototype's blurbs made is asserted against the geometry in
`tests/unit/moergo.test.ts`, which is why the generated ones can say the same
things without anybody retyping them.

## Working on this module

- It must stay free of the DOM; ESLint enforces that for `src/ladder/**`.
- It must stay deterministic. Every comparison falls back through frequency, then
  bigram weight, then effort, then code point, so there is never a coin toss. If
  something here ever needs randomness it takes a seed.
- The keymap is a boundary and is not trusted: a character recorded as typed with
  no position, or at a position the board does not define, throws rather than
  producing a lesson that teaches a key which is not there. The finished ladder is
  checked against its own promises before it is returned.
- Lesson ids are restricted to `[a-z0-9-]` because progress and stars are stored
  under them. Regression 7 is the same mistake made with per-key statistics.
- If you change the ordering rules, the comparison tests will tell you what moved.
  Update this document in the same change: a divergence that is documented and
  defended is fine, and one that is neither is a bug.
