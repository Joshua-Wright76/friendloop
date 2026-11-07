# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

A single private group of friends, mostly in their 30s, scattered across several
timezones. They want to stay close without another group chat. One of them (the
owner) sets it up and keeps it alive; the rest are contributors who answer when a
prompt arrives in their inbox and readers who enjoy the result.

The job: turn "we should catch up more" into something that actually happens once
a week, without anyone having to schedule a call or remember to write.

## Product Purpose

Friendloop is a private group newsletter. A loop asks everyone a small set of
questions on a recurring schedule, collects each person's answers privately
through a link in their email, and compiles them into a shared issue that is
delivered back to the whole group.

Success is a loop that keeps running: prompts go out on time, most people answer,
and the issue is something people are glad to read. It exists because the group
asked for it, it is meant to be genuinely nice to use, and it is free to run.

## Positioning

A Letterloop-shaped product that is free, open source, and self-hostable, and that
asks nothing of the people who only want to answer questions: no account, no app,
no password — a link from the inbox opens the form. Everything the owner needs
(questions, cadence, delivery) lives in one dashboard, and every reply is
attributed to a person the group already knows.

## Operating Context

- Most replies happen on a phone, inside a mail client, within a day of the prompt.
- The owner is the only person who manages anything, and does it in short bursts:
  set questions, invite someone, nudge stragglers.
- The loop is weekly or biweekly, opens a seven-day reply window, and closes on a
  fixed weekday and local hour in the loop's own timezone.
- Members live in different timezones; every deadline is shown in the loop's time
  and the reader's own.
- Email is the entire delivery surface: prompts, reminders, issues, and sign-in
  links all arrive by mail from one sender address with the loop's display name.

## Capabilities and Constraints

Confirmed for v1:

- Invite-only membership; anyone can create a loop, joining requires an invite.
- Roles are two axes: access (`owner` / `admin` / `member`) and participation
  (`contributor` / `reader`). The owner is always a contributor. `from_you` mode
  makes every non-owner a reader.
- Contributors reply through a tokenized link with no account. Management actions
  require a signed-in session.
- Question pool: themed packs of starter questions plus custom questions written by the owner. The owner can include every question or rotate a set number through the pool in order.
- One photo per reply.
- Delivered issues have comments and reactions, and a reaction can be any emoji, with no approval needed. Comments can be hung from a single answer, quote another comment, carry one photo, and @mention any member (readers included, who get an email). The owner can turn commenting off for the loop; nothing is deleted.
- Polls are a kind of question: two to six options, single or multiple choice. Contributors tap to answer, and the tally appears only once the issue is delivered.
- A loop can wear its owner's choice of stationery: a page background, one of a few curated colour schemes, an accent colour (nudged to stay readable), a pack of paper textures, a separate pack of washi tape, a mascot and a header picture. Colours, the mascot and the header picture reach the emails as well as the web pages; backgrounds, paper and tape stay on the web, where they can be relied on. Gingham Picnic stays the default, and the brand frame (voice, type, card conventions) is not editable.
- The owner can name a round ("Camping weekend"), and can hand the loop to an admin, who becomes the owner. Members can set a profile photo, a name charm and an avatar frame per loop.
- A delivered issue can be shared by secret link, off by default.
- Weekly or biweekly cadence, seven-day reply window, per-loop timezone.
- Late replies are never lost: answers stay editable after delivery, and the web
  issue is canonical while the email is a snapshot.
- Runs on free tiers: Vercel Hobby, Neon, Resend.

Explicitly undecided: whether a loop can be public/discoverable, native apps,
member-suggested questions.

## Brand Commitments

- The name is Friendloop. The loop is the unit; issues are "issues" because the
  group already says that.
- The voice is warm, plain, and a little playful. It reads like a note from a
  friend, never like SaaS. Exclamation marks are rare, emoji are rare and earned.
- Nothing about the product should feel like work software: no streaks, no
  productivity metrics, no "engagement".
- Light and dark are both first-class.
- The interface is deliberately conventional: a clean, quiet product surface with
  white cards, one blue accent, and no metaphor. Expressive visual worlds were
  explored and rejected; warmth comes from the words, not from the frame.

## Evidence on Hand

No testimonials, logos, customer counts, benchmarks, or press exist and none may
be invented. The only real content is the group's own names, questions, and
answers, which are seeded as sample data during development.

## Product Principles

1. **The reply is the product.** Every decision that makes answering slower,
   scarier, or more effortful is wrong, even if it is more correct.
2. **The link in the inbox is the front door.** No account walls on the path a
   contributor actually walks.
3. **Time is a promise, not a guess.** Deadlines are stated in the reader's own
   clock, and a late answer is never punished.
4. **The owner's job is small.** Managing a loop should fit in a couple of minutes
   a week, or the loop dies.
5. **It has to run for free.** Any dependency that costs money per month is out
   unless it is free at this scale.

## Accessibility & Inclusion

- The reply form is a phone-first surface used by non-technical people: 44px
  targets, visible focus, large tap areas, no hover-only affordances.
- Reading surfaces must hold up at 200% zoom and in both color schemes.
- Email HTML must be readable with images off and in a plain-text client, because
  that is how a chunk of the group will read it.
