# Design

Clean SaaS, executed properly: a light gray page, white cards with a hairline and a
shadow you can barely see, one blue accent that means "act here", and a warm
neutral ramp so nothing reads as cold enterprise gray. Dark mode is built from the
same relationships, not inverted at the end.

Chosen deliberately over six more expressive worlds. The group using this writes
four sentences a week on a phone in bed; the interface should be obvious at 7am
and invisible at 11pm.

## Colour roles

| Token | Job | Never used for |
| --- | --- | --- |
| `--page` | the ground behind everything | text |
| `--card` | any surface carrying reading or writing | decoration |
| `--line` / `--line-strong` | hairlines, dividers, input hover | emphasis |
| `--field` | the writing area inside a card | page background |
| `--ink` / `--ink-soft` / `--ink-muted` | body, secondary, metadata on cards | text on accent fills |
| `--accent` | the one action that matters on the screen | anything decorative |
| `--accent-soft` / `--accent-line` | the "sent" confirmation, selection tints | primary buttons |
| `--danger` / `--success` | errors, confirmations | anything else |

Exactly one accent per screen. If two things on a screen are blue, one of them is
wrong — the only exception is the focus ring, which is the same blue because focus
*is* an action.

## Type

- **Everything** is Geist Sans. Questions at 16px/600, body at 15px/400, metadata
  at 13px, the round number at 30px/600 with −0.025em tracking. Nothing below 12px.
- Numbers that count (`1 of 4 answered`) are tabular so they don't jitter as you type.
- Geist Mono exists in the tokens for code and email addresses only; it is not a
  display face here.

## Surfaces

- **Card** (`.card`): 14px radius, 1px `--line`, one soft shadow. Cards are the only
  container; they never nest, and a card never sits inside another card.
- **Field** (`.field`): 10px radius, `--field` fill, transparent border that turns
  accent on focus with a 3px 16%-alpha ring. No placeholder is ever the only label.
- **Top bar**: sticky, 56px, blurred page tint, loop name on the left, a quiet count
  chip on the right. It never carries actions.
- **Action bar**: fixed bottom, opaque card, one line of state and one primary
  button. It never floats over the field you are typing in.

## Motion

Two moves, both short:

- Cards ride in 6px over 320ms on first paint, staggered only by document order.
- The sent banner settles from 96% scale over 220ms.

Nothing bounces, nothing loops, and `prefers-reduced-motion` removes both.

## Copy

Plain, second person, no exclamation marks. Buttons name their outcome ("Send
answers", "Save changes"), errors name the recovery, and the confirmation says what
happens next ("Sent. You can change these until Friday 9:00 AM."). Time is stated in
the loop's zone with the reader's own zone in parentheses when they differ.

## Email

Same voice, same one-accent discipline: light card, serif heading, one blue button.
Readable with images off, always with a plain-text twin.

## Not yet designed

The delivered issue view (`/i/<n>`) and the create-a-loop flow do not exist yet.
Both inherit this world; neither has needed its own decisions so far.
