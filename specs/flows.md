# Flow inventory

Every user-visible flow in Friendloop. **One flow ID = one Playwright spec** at
`e2e/flows/<ID>.spec.ts`.

Two gates enforce this:

- `npm run check:flows` — a flow marked `done` must have a spec file, and every
  spec file must map to a flow. Runs on every PR.
- `npm run check:flows -- --strict` — additionally requires **zero** `todo` flows.
  Runs in the release workflow, so nothing ships at less than full coverage.

Status: `todo` (not built) · `done` (built and covered).

## A · Auth

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| A1 | Request a magic link | Submitting a known email writes one `outbox` row of kind `signin` containing a `…/signin/confirm?token=` URL, and the UI says "check your inbox". | done |
| A2 | Sign in with a valid link | Following that URL from the email sets a session cookie, redirects to `/you`, and the header shows the address that just signed in. | done |
| A3 | Expired or reused link | A second visit to the same confirm URL (or one past its 15-minute TTL) shows a recoverable "this link has expired" screen with a "send me a new one" action, never a 500. | done |
| A4 | Unknown email | An address with no account gets the identical "check your inbox" screen and the same email; the account only comes into existence when the link is used. | done |
| A5 | Sign out | Sign out clears the session, `/you` redirects to `/signin`, and the previous cookie no longer authenticates. | done |
| A6 | Revoked reply token | Opening a reply link whose token was rotated shows a "this link was replaced" page with no form and no data leak. | done |

## B · Create and invite

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| B1 | Create a loop | Owner picks name, mode, cadence, timezone and hour; the loop is created with them as owner+contributor, and lands on the loop dashboard. | done |
| B2 | Pick starting questions | During creation the owner selects at least one question from the preset bank; those questions exist on the loop in the chosen order. | done |
| B3 | Invite several members | Pasting three addresses creates three pending memberships with distinct reply tokens and three `invite` rows in the outbox; each email names the loop and contains that member's own link. | done |
| B4 | Accept an invitation | A contributor opening their invite link lands on the reply form for the current issue with their name shown, without signing in. | done |
| B5 | Resend an invitation | Resending re-sends to a pending member, does not rotate the token, and does not create a duplicate membership. | done |
| B6 | Expired invitation | An invite older than its TTL renders an "ask the owner for a new link" screen and creates no session. | done |

## C · Questions

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| C1 | Add a custom question | A new question appears at the end of the pool, is active, and is available to the next issue. | done |
| C2 | Reorder questions | Moving a question changes the order shown in the pool and the order used by the next issue. | done |
| C3 | Archive a question | Archiving removes it from the pool's active list and from future issues, while past issues still render its original text. | done |
| C4 | Choose the next issue's questions | Deselecting a question excludes it from the next issue only; the question stays in the pool. | done |
| C5 | Rotate questions | Setting a count of two selects questions 1–2, then 3–4, then wraps to 5 and 1. "Send now" uses the same cursor, while "All questions" preserves the original behavior. | done |

## D · The issue cycle

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| D1 | Open an issue on schedule | With the clock past the loop's slot, the sweep creates exactly one issue with a snapshot of the selected questions and one `prompt` outbox row per contributor. | done |
| D2 | Do not open early or twice | Running the sweep before the slot creates nothing; running it twice for the same slot creates no second issue and no duplicate email. | done |
| D3 | Start an issue manually | "Send now" opens an issue immediately, emails contributors, and does not create a duplicate when the scheduled slot later arrives. | done |
| D4 | Draft autosaves | Typing an answer persists it as a draft; reloading the reply page restores every draft. | done |
| D5 | Submit answers | Submitting marks replies submitted with a timestamp, the bar shows "sent", and the owner's progress count increases. | done |
| D6 | Edit a submitted answer | Before delivery, editing and re-submitting updates the reply and its timestamp without creating a duplicate row. | done |
| D7 | Deliver the issue | With the clock past the delivery instant, the sweep sends one issue email per member containing every submitted answer, and the issue's status becomes `delivered`. | done |
| D8 | Nothing to deliver | An issue reaching its delivery instant with zero submitted replies is marked `skipped`, sends no delivery email, and pauses the loop with an explanation to the owner. | done |
| D9 | Nudge the stragglers | 48 hours before delivery, contributors with nothing submitted get exactly one reminder; anyone who submitted gets none, and a second sweep sends no duplicate. | done |
| D10 | Nudge by hand | From the dashboard the owner sees who has not answered and can send one more reminder; anyone who already answered gets none, and each nudge is its own email rather than a duplicate. | done |

## E · Reading and reacting

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| E1 | Read a delivered issue | A member opening `/i/<n>` sees every question with each contributor's answer, their own marked, and the issue's date. | done |
| E2 | Read by share link | With sharing enabled, an anonymous visitor at the share URL reads the same issue and sees no other loop data or navigation. | done |
| E3 | Comment on an issue | A member posts a comment, it appears for other members immediately, and an empty comment is rejected. | done |
| E4 | React to an answer | A member adds a reaction to someone's answer, the count updates for everyone, and toggling removes it. | done |
| E5 | Browse the archive | The archive lists delivered issues newest-first; opening an older one renders without needing the current issue to exist. | done |

## F · Loop settings

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| F1 | Change cadence or timezone | Saving a new weekday, hour, cadence or timezone changes the next send time shown to the owner and does not move an already-open issue's deadline. | done |
| F2 | Pause and resume | Pausing stops new issues from opening and says so on the dashboard; resuming schedules the next slot from the resume moment. | done |
| F3 | Remove a member | Removing a member stops their emails and revokes their links; their past answers remain in delivered issues. | done |
| F4 | Delete a loop | The owner confirms by typing the loop name; the loop, its issues, replies and outbox rows disappear and `/g/<id>` 404s. | done |
| F5 | Non-owner is refused | A plain member visiting an owner route gets a 404/403 page, and the same request as a POST is rejected server-side. | done |
| F6 | Reset share links | Resetting gives every delivered round a new share URL; a URL handed out before the reset 404s, and turning sharing off disables every existing link. | done |

## G · Roles and permissions

| ID | Flow | Acceptance criteria | Status |
| --- | --- | --- | --- |
| G3 | Promote to admin | Promoting a member to admin lets them manage questions and members, while the owner-only actions stay unavailable to them. | done |
| G4 | Reader cannot reply | A direct POST to the reply endpoint from a reader is rejected with 403 and writes nothing. | done |
| G5 | Transfer ownership | The owner transfers ownership, becomes an admin+contributor, and the new owner gains owner-only actions while the old owner loses them. | done |
| G6 | `from_you` mode | In `from_you`, every non-owner is forced to reader on invite and cannot be made a contributor. | done |

IDs are stable handles, not positions: a retired flow leaves its number out
rather than renumbering the rest.

---

**42 flows.** A flow is only `done` when its spec passes locally and in CI.
