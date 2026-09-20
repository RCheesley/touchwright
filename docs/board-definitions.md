# Board definitions

A board definition says where a keyboard's keys are and which finger owns each
one. It says nothing about what those keys type; that is the keymap's job. The
separation is what lets a second board be a data file rather than a rewrite.

Adding a board means writing one module under `src/board/`, registering it in
`src/board/index.ts`, and adding a section to this file recording how its
geometry was obtained.

## The shape of a definition

See `src/board/types.ts`. In outline:

- `keyCount` — the length of the flat keymap array the firmware exports.
- `keys` — one entry per position. A `ColumnKey` has a row, a column, a finger
  and a reach. A `ThumbKey` has an arc instead. The two are a discriminated
  union, so asking a thumb key for its column is a type error rather than a
  runtime `undefined`.
- `homePositions` — the positions the fingers rest on.
- `spacePosition` — the space bar a typist should actually use, where the board
  offers more than one.
- `recommendedShift` — ergonomic guidance, not keymap fact. A keymap may bind
  shift elsewhere too; those bindings are discovered from the keymap.
- `render` — key pitch, cap size and the x the two halves mirror about.

`assertValidBoard` runs at registration. It checks that every position from zero
to `keyCount - 1` is defined exactly once, that no coordinate is non-finite, and
that every referenced position exists. A malformed definition fails loudly there
rather than producing a silently wrong lesson ladder later.

## Do not re-derive geometry

Measuring a board's geometry is slow and easy to get subtly wrong. Whatever you
measure, record it here and pin it with a test, so the next person inherits it
instead of repeating it.

---

# MoErgo Glove80

MoErgo and Glove80 are trademarks of MoErgo. This project is not affiliated with
or endorsed by them; the names are used only to say which keyboard this geometry
describes.

Derived by measuring the MoErgo Layout Editor's own render of a real layout, then
cross-checking every position against that layout's exported JSON. Pinned by
`tests/unit/glove80.test.ts`.

## Key ordering

The keymap is a flat array of 80 entries. Physical grouping, confirmed against a
real export:

| Positions | Half  | What                     | Columns used |
| --------- | ----- | ------------------------ | ------------ |
| 0 to 4    | left  | function row             | 0 to 4       |
| 5 to 9    | right | function row             | 1 to 5       |
| 10 to 15  | left  | number row               | 0 to 5       |
| 16 to 21  | right | number row               | 0 to 5       |
| 22 to 27  | left  | upper row                | 0 to 5       |
| 28 to 33  | right | upper row                | 0 to 5       |
| 34 to 39  | left  | home row                 | 0 to 5       |
| 40 to 45  | right | home row                 | 0 to 5       |
| 46 to 51  | left  | lower row                | 0 to 5       |
| 52 to 54  | left  | thumb cluster, upper arc |              |
| 55 to 57  | right | thumb cluster, upper arc |              |
| 58 to 63  | right | lower row                | 0 to 5       |
| 64 to 68  | left  | bottom modifier row      | 0 to 4       |
| 69 to 71  | left  | thumb cluster, lower arc |              |
| 72 to 74  | right | thumb cluster, lower arc |              |
| 75 to 79  | right | bottom modifier row      | 1 to 5       |

Column index runs outer pinky to inner index on the left half, and inner index to
outer pinky on the right. On both halves the index increases left to right on
screen, so the left half reads pinky first and the right half reads index first.

## Finger ownership by column

```
left  columns 0..5  ->  pinky, pinky, ring, middle, index, index
right columns 0..5  ->  index, index, middle, ring, pinky, pinky
```

Two columns per hand belong to the pinky and two to the index. The column further
from the board's centre is the pinky's outer reach; the column nearer the centre
is the index's inner reach. `describeKey` reports those as "pinky (outer reach)"
and "index (inner reach)" so a learner can tell the two apart.

## Column stagger

Vertical offset per column in key units, positive meaning closer to the typist.
Consistent with finger length: the middle column sits furthest away and the pinky
columns closest.

```
left  = [0.52, 0.52, 0.16, 0.00, 0.16, 0.30]
right = [0.30, 0.16, 0.00, 0.16, 0.52, 0.52]
```

The right array is the left array reversed. That relationship is pinned by test,
but both are transcribed literally rather than one derived from the other, so a
transcription error shows up as a failure instead of being reproduced.

Row index, taking the home row as zero:

```
function row  -3
number row    -2
upper row     -1
home row       0
lower row      1
bottom row     2
```

A key pitch of 54 units with a 47 unit cap renders cleanly.

## Thumb clusters

Six keys per hand in two arcs of three, each key rotated progressively. Positions
are in key units measured from column 0 of the left half, with y measured from the
home row baseline.

| Position | Key on the reference layout | x    | y    | Rotation |
| -------- | --------------------------- | ---- | ---- | -------- |
| 52       | backspace                   | 6.07 | 1.96 | 15       |
| 53       | escape                      | 7.00 | 2.30 | 30       |
| 54       | magic                       | 7.81 | 3.00 | 45       |
| 69       | E                           | 5.11 | 2.85 | 15       |
| 70       | tab                         | 6.15 | 3.22 | 30       |
| 71       | lower                       | 7.00 | 3.93 | 45       |

Mirrored pairs, inner to outer:

```
right upper arc  55 up,    56 left,  57 right   mirrors  54 magic, 53 escape, 52 backspace
right lower arc  72 lower, 73 enter, 74 space   mirrors  71 lower, 70 tab,    69 E
```

## One mirror axis for the whole board

The right half's column zero sits 11.96 key units out from the left half's, and
each half is five columns wide, which puts the mirror axis at
`(11.96 + 5) / 2 = 8.48`.

That single axis governs the column keys and the thumb clusters alike: a right x
is `16.96 − left x`, y is unchanged and rotation is negated. This is a stronger
statement than the per-cluster mirroring originally recorded, and it is checked
across all 68 column keys and all six thumb pairs.

The named example worth keeping: on the reference layout, E at position 69 and
space at position 74 sit at mirrored coordinates. They are the same key on
opposite hands.

## Home keys

Positions 35 to 44 are the ten home keys. Position 74 is the space a typist should
use; the board also binds one at 51, and the trainer teaches 74. Whichever
position carries E is the thumb anchor, and on the Maltron reference layout that
is position 69.

## Shifted characters

Shift is taken with the opposite hand. Position 46 is the left shift and position
63 the right, so a shifted character on a left-hand key pairs with position 63 and
the reverse.

The pairing itself belongs to the host locale, not to the board. ZMK keycodes are
positional and named after a US board; what a position actually types depends on
the host. The reference layout is `en-GB-mac`, which puts `@` on 2 and `£` on 3 —
not what some other UK mappings do. `src/keymap/locales.ts` holds the tables and
refuses an unknown locale rather than guessing, because guessing the punctuation
would silently teach the wrong keys.

## Sources

MoErgo (no date) _glove80-zmk-config_. Available at
<https://github.com/moergo-sc/glove80-zmk-config> (Accessed 20 September 2026).

Caksoylar, C. (no date) _keymap-drawer_. Available at
<https://github.com/caksoylar/keymap-drawer> (Accessed 20 September 2026).
