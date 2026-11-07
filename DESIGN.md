# Design

Friendloop uses **Gingham Picnic**, selected from the stationery directions in
`public/design/design-samples.html`. The complete responsive flow reference is in
`public/design/flow-screens.html` (also available at `/design/flow-screens.html`).

The product should feel like a small letter exchanged by friends, not enterprise
software: warm gingham, cream paper, handwritten-style display type, taped notes,
and stitched dividers. The playfulness lives in the surfaces; controls and copy
remain direct and easy to use on a phone.

## Typography

- **Gaegu 700** for the wordmark, page titles, questions, and section headings.
- **Nunito 400/700/800** for body copy, controls, labels, and metadata.
- Body copy is generally 15–17px. Nothing meaningful is below 12px.
- Counts use tabular numerals so progress does not shift as it changes.
- Both families are self-hosted through `next/font` in `src/app/layout.tsx`.

## Colour and texture

| Token | Job |
| --- | --- |
| `--page` / `--check` | warm pink ground and its gingham pattern |
| `--card` | cream stationery carrying reading or writing |
| `--line` / `--line-strong` | borders, dividers, and quiet controls |
| `--rule` / `--margin` | blue notebook rules and red notebook margin |
| `--ink` / `--ink-soft` / `--ink-muted` | reading, supporting copy, and metadata |
| `--accent` / `--accent-deep` | primary action and its pressed edge |
| `--accent-soft` / `--accent-line` | confirmation washes and dashed stitching |
| `--danger` / `--success` | destructive and successful states |

A very faint film of grain sits over every page, so flat colour and crisp patterns
read as paper. It takes no taps, and it's gone in print and for people who ask their
device for more contrast.

Dark mode is a deliberately tuned evening stationery palette, not an inversion.
It preserves the same contrast relationships and gingham texture.

## Surfaces and controls

- **Cards:** 6px corners, cream fill, a hairline, and one soft pink shadow.
- **Paper:** the `.paper` treatment adds a notebook margin. Reply fields use
  `.lined-field` for 28px writing rules.
- **Tape:** four tones (`dots`, `stripe`, `mint`, `check`), drawn from the loop's tape
  pack, decorate important notes. Tape is always aria-hidden and never carries information.
- **Buttons:** pill-shaped, Nunito 800. Primary actions have a 3px pressed edge;
  quiet actions use an inset border. Minimum target height is 44px.
- **Fields:** cream fill, visible border, and a soft accent focus ring. Every input
  has a label or accessible name.
- **Navigation:** loop sections use stitched headers and underline tabs. Reply
  screens keep the loop name and answer count in a sticky top bar, with draft
  state and the primary action in a fixed bottom bar.
- **Brand:** the cherry illustration and Gaegu wordmark are shared by the landing,
  account, reply, and issue experiences.

## What a loop can choose

Everything below is a set of custom properties from `src/lib/stationery.ts`, read by the
stylesheet with a fallback. A loop that chose nothing gets no CSS and is plain Gingham.

- **Page background:** gingham or a tile pattern, in the colour scheme's own `--check`. A
  pattern prints exactly as strong as gingham's stripe crossings, so the contrast the
  accent was derived against still holds.
- **Colors:** the five curated schemes plus the accent.
- **Paper pack:** one texture each for answers, polls, playlists and notes, marked with
  `data-paper`. Hairlines use `--texture-line`, and ruled answers rule the words themselves
  (`--answer-lines`, spaced by `1lh`) so the text always sits on the line.
- **Washi tape:** four tones, chosen separately from the paper.
- **Mascot:** replaces the cherry mark on the loop's pages and in its emails. The art lives
  in `public/stickers`, with PNGs for email from `scripts/render-stickers.mjs`.

A member chooses a **name charm** (a die-cut sticker beside their name) and an **avatar
frame**, which overflows the picture so choosing one never moves the words beside it. All of
it is decoration: names are always printed, and pattern, tape and stickers carry no meaning.

## Motion

Cards may ride in 6px over 320ms; confirmations settle from 96% over 220ms.
A chosen tape pack unrolls across its preview over 520ms, and a chosen paper pack's fan opens over 320ms. Nothing loops or bounces. `prefers-reduced-motion` removes both effects.

## Copy

Plain, warm, second person, with no exclamation marks. Buttons name their outcome
("Send answers", "Save changes"), errors name the recovery, and confirmations say
what happens next. Time is shown in the loop's zone and the reader's own zone when
they differ.

## Implementation

Shared tokens and stationery primitives live in `src/app/globals.css`. Reusable
brand, cherry, tape, envelope, and loop-navigation components live in
`src/components/`. Route behavior, server actions, autosave, and permissions are
independent of the visual system.
